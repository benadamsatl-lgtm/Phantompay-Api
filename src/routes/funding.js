const express = require('express');
const db = require('../models/db');
const PlaidAdapter = require('../adapters/funding/plaid');

const router = express.Router();

// ── POST /funding-sources/link/initiate ───────────────────────────────────────
router.post('/link/initiate', async (req, res, next) => {
  try {
    const { bank_hint = 'chime' } = req.body;
    const result = await PlaidAdapter.createLinkToken(req.user.id, bank_hint);
    res.json({ link_token: result.linkToken, expiration: result.expiration });
  } catch (err) {
    if (err.code === 'PLAID_ERROR') return res.status(502).json({ error: err });
    next(err);
  }
});

// ── POST /funding-sources/link/complete ───────────────────────────────────────
router.post('/link/complete', async (req, res, next) => {
  try {
    const { public_token, account_id } = req.body;
    if (!public_token) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'public_token required.' } });
    }

    // Exchange for access token
    const { accessToken, itemId } = await PlaidAdapter.exchangePublicToken(public_token);

    // Get account details
    const accountDetails = await PlaidAdapter.getAccountDetails(accessToken, account_id);

    // Save to DB
    const result = await db.query(
      `INSERT INTO funding_sources
        (user_id, bank_adapter, plaid_access_token, plaid_account_id, plaid_item_id,
         account_type, last_four, institution_name, status)
       VALUES ($1, 'chime', $2, $3, $4, $5, $6, $7, 'active')
       RETURNING id, bank_adapter, account_type, last_four, institution_name, status, linked_at`,
      [req.user.id, accessToken, accountDetails.accountId, itemId,
       accountDetails.accountType, accountDetails.lastFour, accountDetails.institutionName]
    );

    res.status(201).json({ funding_source: result.rows[0] });
  } catch (err) {
    if (err.code === 'PLAID_ERROR') return res.status(502).json({ error: err });
    next(err);
  }
});

// ── GET /funding-sources ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, bank_adapter as bank, account_type, last_four, institution_name, status, linked_at
       FROM funding_sources WHERE user_id = $1 ORDER BY linked_at DESC`,
      [req.user.id]
    );
    res.json({ funding_sources: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /funding-sources/:id ───────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM funding_sources WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Funding source not found.' } });
    }

    const fs = result.rows[0];

    // Remove from Plaid
    if (fs.plaid_access_token) {
      await PlaidAdapter.removeItem(fs.plaid_access_token);
    }

    await db.query('DELETE FROM funding_sources WHERE id = $1', [fs.id]);

    res.json({ message: 'Funding source removed.', funding_source_id: fs.id });
  } catch (err) {
    if (err.code === 'PLAID_ERROR') return res.status(502).json({ error: err });
    next(err);
  }
});

module.exports = router;
