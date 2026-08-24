const express = require('express');
const db = require('../models/db');

const router = express.Router();

// ── GET /transactions ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, from, to } = req.query;
    const offset = (page - 1) * limit;
    const params = [req.user.id];
    let dateFilter = '';

    if (from) { params.push(from); dateFilter += ` AND t.created_at >= $${params.length}`; }
    if (to)   { params.push(to);   dateFilter += ` AND t.created_at <= $${params.length}`; }

    params.push(limit, offset);

    const result = await db.query(
      `SELECT t.id, t.card_id, vc.last_four as card_last_four,
              t.amount_cents, t.merchant, t.merchant_category, t.status, t.created_at
       FROM transactions t
       JOIN virtual_cards vc ON vc.id = t.card_id
       WHERE t.user_id = $1 ${dateFilter}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await db.query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [req.user.id]);

    res.json({
      transactions: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].count) }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /transactions/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT t.*, vc.last_four as card_last_four, vc.funding_source_id
       FROM transactions t
       JOIN virtual_cards vc ON vc.id = t.card_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Transaction not found.' } });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
