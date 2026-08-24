const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../models/db');

const router = express.Router();

// ── GET /user/me ──────────────────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const userResult = await db.query(
      `SELECT id, email, full_name, phone, tier, cards_used_this_month, billing_period_start, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    const fsResult = await db.query(
      `SELECT id as funding_source_id, bank_adapter as bank, last_four, status, linked_at
       FROM funding_sources WHERE user_id = $1 AND status = 'active'`,
      [req.user.id]
    );

    const tierLimits = { free: 5, payg: null, plus: 50, unlimited: null };
    const user = userResult.rows[0];

    res.json({
      ...user,
      cards_limit: tierLimits[user.tier],
      funding_sources: fsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /user/me ────────────────────────────────────────────────────────────
router.patch('/me', [
  body('full_name').optional().trim().notEmpty(),
  body('phone').optional().isMobilePhone(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', fields: errors.array() } });
    }

    const { full_name, phone } = req.body;
    const updates = [];
    const values = [];

    if (full_name) { values.push(full_name); updates.push(`full_name = $${values.length}`); }
    if (phone)     { values.push(phone);     updates.push(`phone = $${values.length}`); }

    if (!updates.length) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'No fields to update.' } });
    }

    values.push(req.user.id);
    updates.push(`updated_at = NOW()`);

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING id, email, full_name, phone, updated_at`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
