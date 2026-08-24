const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../models/db');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
  const refreshToken = jwt.sign(
    { userId, jti: uuidv4() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
  return { accessToken, refreshToken };
};

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('full_name').trim().notEmpty(),
  body('phone').optional().isMobilePhone(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', fields: errors.array() } });
    }

    const { email, password, full_name, phone } = req.body;

    // Check existing user
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ error: { code: 'EMAIL_TAKEN', message: 'Email already registered.' } });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, tier, cards_used_this_month, created_at`,
      [email, passwordHash, full_name, phone || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', fields: errors.array() } });
    }

    const { email, password } = req.body;

    const result = await db.query(
      'SELECT id, email, password_hash, full_name, tier, is_active FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token hash
    const tokenHash = await bcrypt.hash(refreshToken, 8);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      user_id: user.id,
      tier: user.tier
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Refresh token required.' } });
    }

    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    // Find matching token in DB
    const tokens = await db.query(
      'SELECT * FROM refresh_tokens WHERE user_id = $1 AND expires_at > NOW()',
      [decoded.userId]
    );

    let validToken = null;
    for (const row of tokens.rows) {
      const match = await bcrypt.compare(refresh_token, row.token_hash);
      if (match) { validToken = row; break; }
    }

    if (!validToken) {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Invalid refresh token.' } });
    }

    const { accessToken } = generateTokens(decoded.userId);
    res.json({ access_token: accessToken, expires_in: 3600 });
  } catch (err) {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Invalid refresh token.' } });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      const decoded = jwt.decode(refresh_token);
      if (decoded?.userId) {
        await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [decoded.userId]);
      }
    }
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
