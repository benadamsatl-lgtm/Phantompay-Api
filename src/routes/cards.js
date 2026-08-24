const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../models/db');
const LithicAdapter = require('../adapters/card/lithic');
const { checkCardLimit } = require('../middleware/auth');

const router = express.Router();

// ── POST /cards/create ────────────────────────────────────────────────────────
router.post('/create', checkCardLimit, [
  body('funding_source_id').isUUID(),
  body('spending_limit_cents').optional().isInt({ min: 1 }),
  body('merchant_hint').optional().isString().trim(),
  body('idempotency_key').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', fields: errors.array() } });
    }

    const { funding_source_id, spending_limit_cents, merchant_hint, idempotency_key } = req.body;
    const userId = req.user.id;

    // Verify funding source belongs to user and is active
    const fsResult = await db.query(
      'SELECT id FROM funding_sources WHERE id = $1 AND user_id = $2 AND status = $3',
      [funding_source_id, userId, 'active']
    );
    if (!fsResult.rows.length) {
      return res.status(422).json({ error: { code: 'FUNDING_SOURCE_INACTIVE', message: 'Funding source not found or inactive.' } });
    }

    // Check idempotency — return existing card if same key
    const existing = await db.query(
      'SELECT * FROM virtual_cards WHERE idempotency_key = $1 AND user_id = $2',
      [idempotency_key, userId]
    );
    if (existing.rows.length) {
      return res.status(200).json({ ...existing.rows[0], idempotent: true });
    }

    // Create card via Lithic
    const lithicCard = await LithicAdapter.createCard({
      spendingLimitCents: spending_limit_cents,
      merchantHint: merchant_hint,
      memo: `PhantomPay - ${merchant_hint || 'Purchase'}`,
    });

    // Save to DB
    const dbClient = await db.getClient();
    try {
      await dbClient.query('BEGIN');

      const cardResult = await dbClient.query(
        `INSERT INTO virtual_cards
          (user_id, funding_source_id, lithic_card_token, last_four, status,
           spending_limit_cents, merchant_hint, auto_freeze_after_use, idempotency_key)
         VALUES ($1,$2,$3,$4,'active',$5,$6,true,$7)
         RETURNING *`,
        [userId, funding_source_id, lithicCard.lithicCardToken, lithicCard.lastFour,
         spending_limit_cents || null, merchant_hint || null, idempotency_key]
      );

      // Increment monthly card counter
      await dbClient.query(
        'UPDATE users SET cards_used_this_month = cards_used_this_month + 1 WHERE id = $1',
        [userId]
      );

      await dbClient.query('COMMIT');

      const card = cardResult.rows[0];

      // Return full card details (only time we return full PAN + CVV)
      res.status(201).json({
        card_id: card.id,
        card_number: lithicCard.cardNumber,
        expiration_month: lithicCard.expirationMonth,
        expiration_year: lithicCard.expirationYear,
        cvv: lithicCard.cvv,
        last_four: card.last_four,
        status: card.status,
        spending_limit_cents: card.spending_limit_cents,
        merchant_hint: card.merchant_hint,
        funding_source_id: card.funding_source_id,
        auto_freeze_after_use: card.auto_freeze_after_use,
        created_at: card.created_at,
      });
    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      dbClient.release();
    }
  } catch (err) {
    if (err.code === 'LITHIC_ERROR') {
      return res.status(502).json({ error: err });
    }
    next(err);
  }
});

// ── GET /cards ────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT id, last_four, status, merchant_hint, spending_limit_cents, amount_charged_cents, created_at, frozen_at, cancelled_at FROM virtual_cards WHERE user_id = $1';
    const params = [req.user.id];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    const countResult = await db.query('SELECT COUNT(*) FROM virtual_cards WHERE user_id = $1', [req.user.id]);

    res.json({
      cards: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].count) }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /cards/:id ────────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const cardResult = await db.query(
      'SELECT * FROM virtual_cards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!cardResult.rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Card not found.' } });
    }

    const card = cardResult.rows[0];
    const txResult = await db.query(
      'SELECT id, amount_cents, merchant, status, created_at FROM transactions WHERE card_id = $1 ORDER BY created_at DESC',
      [card.id]
    );

    res.json({ ...card, transactions: txResult.rows });
  } catch (err) {
    next(err);
  }
});

// ── POST /cards/:id/freeze ────────────────────────────────────────────────────
router.post('/:id/freeze', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM virtual_cards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Card not found.' } });
    }

    const card = result.rows[0];
    if (card.status === 'cancelled') {
      return res.status(409).json({ error: { code: 'CARD_ALREADY_CANCELLED', message: 'Cannot freeze a cancelled card.' } });
    }

    await LithicAdapter.freezeCard(card.lithic_card_token);

    const updated = await db.query(
      `UPDATE virtual_cards SET status = 'frozen', frozen_at = NOW() WHERE id = $1 RETURNING id, status, frozen_at`,
      [card.id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    if (err.code === 'LITHIC_ERROR') return res.status(502).json({ error: err });
    next(err);
  }
});

// ── POST /cards/:id/cancel ────────────────────────────────────────────────────
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM virtual_cards WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Card not found.' } });
    }

    const card = result.rows[0];
    if (card.status === 'cancelled') {
      return res.status(409).json({ error: { code: 'CARD_ALREADY_CANCELLED', message: 'Card is already cancelled.' } });
    }

    await LithicAdapter.cancelCard(card.lithic_card_token);

    const updated = await db.query(
      `UPDATE virtual_cards SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1 RETURNING id, status, cancelled_at`,
      [card.id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    if (err.code === 'LITHIC_ERROR') return res.status(502).json({ error: err });
    next(err);
  }
});

module.exports = router;
