const express = require('express');
const db = require('../models/db');

const router = express.Router();

const PLANS = [
  { tier: 'free',      price_cents: 0,   per_card_fee_cents: 0,  cards_limit: 5,    label: 'Free' },
  { tier: 'payg',      price_cents: 0,   per_card_fee_cents: 7,  cards_limit: null, label: 'Pay As You Go' },
  { tier: 'plus',      price_cents: 199, per_card_fee_cents: 0,  cards_limit: 50,   label: 'Plus' },
  { tier: 'unlimited', price_cents: 499, per_card_fee_cents: 0,  cards_limit: null, label: 'Unlimited' },
];

// ── GET /billing/plan ─────────────────────────────────────────────────────────
router.get('/plan', async (req, res, next) => {
  try {
    const userResult = await db.query(
      'SELECT tier, cards_used_this_month, billing_period_start FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = userResult.rows[0];
    const periodStart = new Date(user.billing_period_start);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(periodEnd.getDate() - 1);

    res.json({
      tier: user.tier,
      cards_used_this_month: user.cards_used_this_month,
      cards_limit: PLANS.find(p => p.tier === user.tier)?.cards_limit,
      billing_period_start: periodStart.toISOString().split('T')[0],
      billing_period_end: periodEnd.toISOString().split('T')[0],
      available_plans: PLANS,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /billing/upgrade ─────────────────────────────────────────────────────
router.post('/upgrade', async (req, res, next) => {
  try {
    const { tier } = req.body;
    const validTiers = PLANS.map(p => p.tier);

    if (!validTiers.includes(tier)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid tier. Choose from: ${validTiers.join(', ')}` } });
    }

    // TODO: Integrate Stripe here for paid tiers
    // For now, update tier directly (add Stripe payment flow before launch)
    await db.query('UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2', [tier, req.user.id]);

    const plan = PLANS.find(p => p.tier === tier);
    const nextBilling = new Date();
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    res.json({
      tier,
      effective_date: new Date().toISOString().split('T')[0],
      next_billing_date: plan.price_cents > 0 ? nextBilling.toISOString().split('T')[0] : null,
      amount_cents: plan.price_cents,
      message: plan.price_cents === 0 ? 'Plan updated.' : 'Stripe integration required for paid plans.'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
