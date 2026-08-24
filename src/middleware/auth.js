const jwt = require('jsonwebtoken');
const db = require('../models/db');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({
      error: { code: 'AUTH_REQUIRED', message: 'Access token required' }
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user from DB to catch deactivated accounts
    const result = await db.query(
      'SELECT id, email, full_name, tier, cards_used_this_month, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({
        error: { code: 'AUTH_REQUIRED', message: 'Invalid or expired token' }
      });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({
      error: { code: 'AUTH_REQUIRED', message: 'Invalid or expired token' }
    });
  }
};

// Enforce card limits by tier
const checkCardLimit = async (req, res, next) => {
  const limits = { free: 5, payg: null, plus: 50, unlimited: null };
  const userTier = req.user.tier;
  const limit = limits[userTier];

  if (limit !== null && req.user.cards_used_this_month >= limit) {
    return res.status(402).json({
      error: {
        code: 'CARD_LIMIT_REACHED',
        message: `You've used all ${limit} cards for this month on the ${userTier} plan.`,
        upgrade_url: 'https://phantompay.online/upgrade'
      }
    });
  }

  next();
};

module.exports = { authenticateToken, checkCardLimit };
