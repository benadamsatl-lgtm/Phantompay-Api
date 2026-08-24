/**
 * Lithic Card Engine Adapter
 * Swappable — replace with Marqeta or Stripe Issuing by swapping this file
 */
const axios = require('axios');

const lithicClient = axios.create({
  baseURL: process.env.LITHIC_BASE_URL || 'https://sandbox.lithic.com/v1',
  headers: {
    'Authorization': process.env.LITHIC_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

const LithicAdapter = {
  /**
   * Create a single-use virtual card
   */
  async createCard({ spendingLimitCents, merchantHint, memo }) {
    try {
      const payload = {
        type: 'SINGLE_USE',
        state: 'OPEN',
        memo: memo || `PhantomPay - ${merchantHint || 'Purchase'}`,
      };

      if (spendingLimitCents) {
        payload.spending_limits = [{
          amount: spendingLimitCents,
          interval: 'TRANSACTION',
        }];
      }

      const response = await lithicClient.post('/cards', payload);
      const card = response.data;

      return {
        lithicCardToken: card.token,
        cardNumber: card.pan,
        expirationMonth: card.exp_month,
        expirationYear: card.exp_year,
        cvv: card.cvv,
        lastFour: card.last_four,
      };
    } catch (err) {
      console.error('Lithic createCard error:', err.response?.data || err.message);
      throw { code: 'LITHIC_ERROR', message: 'Failed to create virtual card.' };
    }
  },

  /**
   * Freeze a card (reversible)
   */
  async freezeCard(lithicCardToken) {
    try {
      await lithicClient.patch(`/cards/${lithicCardToken}`, { state: 'PAUSED' });
      return { success: true };
    } catch (err) {
      console.error('Lithic freezeCard error:', err.response?.data || err.message);
      throw { code: 'LITHIC_ERROR', message: 'Failed to freeze card.' };
    }
  },

  /**
   * Cancel a card permanently
   */
  async cancelCard(lithicCardToken) {
    try {
      await lithicClient.patch(`/cards/${lithicCardToken}`, { state: 'CLOSED' });
      return { success: true };
    } catch (err) {
      console.error('Lithic cancelCard error:', err.response?.data || err.message);
      throw { code: 'LITHIC_ERROR', message: 'Failed to cancel card.' };
    }
  },

  /**
   * Verify webhook signature from Lithic
   */
  verifyWebhookSignature(rawBody, signature) {
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', process.env.LITHIC_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },
};

module.exports = LithicAdapter;
