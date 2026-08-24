const express = require('express');
const db = require('../models/db');
const LithicAdapter = require('../adapters/card/lithic');

const router = express.Router();

// ── POST /webhooks/lithic ─────────────────────────────────────────────────────
// Lithic sends transaction events here — we auto-freeze after first use
router.post('/lithic', async (req, res) => {
  try {
    const signature = req.headers['x-lithic-signature'];

    // Verify signature
    if (signature && !LithicAdapter.verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString());
    console.log(`📨 Lithic webhook: ${event.event_type}`);

    // We care about transaction settled events
    if (event.event_type === 'transaction.settled' || event.event_type === 'transaction.created') {
      const lithicCardToken = event.card_token;
      const amountCents = event.amount;
      const merchant = event.merchant?.descriptor || 'Unknown';
      const merchantCategory = event.merchant?.mcc || null;
      const lithicTransactionToken = event.token;

      // Find the card in our DB
      const cardResult = await db.query(
        'SELECT * FROM virtual_cards WHERE lithic_card_token = $1',
        [lithicCardToken]
      );

      if (!cardResult.rows.length) {
        console.warn(`⚠️  Card not found for token: ${lithicCardToken}`);
        return res.status(200).json({ received: true });
      }

      const card = cardResult.rows[0];

      // Save transaction record
      await db.query(
        `INSERT INTO transactions
          (card_id, user_id, lithic_transaction_token, amount_cents, merchant, merchant_category, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (lithic_transaction_token) DO NOTHING`,
        [card.id, card.user_id, lithicTransactionToken, amountCents, merchant, merchantCategory,
         event.event_type === 'transaction.settled' ? 'settled' : 'pending']
      );

      // Update amount charged on card
      await db.query(
        'UPDATE virtual_cards SET amount_charged_cents = amount_charged_cents + $1 WHERE id = $2',
        [amountCents, card.id]
      );

      // Auto-freeze after use if enabled and card still active
      if (card.auto_freeze_after_use && card.status === 'active') {
        try {
          await LithicAdapter.freezeCard(lithicCardToken);
          await db.query(
            `UPDATE virtual_cards SET status = 'frozen', frozen_at = NOW() WHERE id = $1`,
            [card.id]
          );
          console.log(`🔒 Auto-froze card ${card.id} after transaction`);
        } catch (freezeErr) {
          console.error(`❌ Failed to auto-freeze card ${card.id}:`, freezeErr);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ received: true }); // Always 200 to Lithic to prevent retries
  }
});

module.exports = router;
