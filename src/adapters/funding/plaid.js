/**
 * Plaid Funding Source Adapter
 * Used to link Chime (and later any bank) as a funding source
 * Swappable — add Chase, Capital One etc. by extending this adapter
 */
const axios = require('axios');

const plaidClient = axios.create({
  baseURL: process.env.PLAID_BASE_URL || 'https://sandbox.plaid.com',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

const plaidAuth = {
  client_id: process.env.PLAID_CLIENT_ID,
  secret: process.env.PLAID_SECRET,
};

const PlaidAdapter = {
  /**
   * Create a link token to start Plaid Link UI on client
   */
  async createLinkToken(userId, bankHint = 'chime') {
    try {
      const response = await plaidClient.post('/link/token/create', {
        ...plaidAuth,
        user: { client_user_id: userId },
        client_name: 'PhantomPay',
        products: ['auth', 'transactions'],
        country_codes: ['US'],
        language: 'en',
        // Pre-select Chime in the Plaid UI if hint is provided
        institution_id: bankHint === 'chime' ? 'ins_116794' : undefined,
      });

      return {
        linkToken: response.data.link_token,
        expiration: response.data.expiration,
      };
    } catch (err) {
      console.error('Plaid createLinkToken error:', err.response?.data || err.message);
      throw { code: 'PLAID_ERROR', message: 'Failed to initiate bank linking.' };
    }
  },

  /**
   * Exchange public token for access token after user completes Plaid Link
   */
  async exchangePublicToken(publicToken) {
    try {
      const response = await plaidClient.post('/item/public_token/exchange', {
        ...plaidAuth,
        public_token: publicToken,
      });

      return {
        accessToken: response.data.access_token,
        itemId: response.data.item_id,
      };
    } catch (err) {
      console.error('Plaid exchangePublicToken error:', err.response?.data || err.message);
      throw { code: 'PLAID_ERROR', message: 'Failed to complete bank linking.' };
    }
  },

  /**
   * Get account details from a linked Plaid item
   */
  async getAccountDetails(accessToken, accountId) {
    try {
      const response = await plaidClient.post('/accounts/get', {
        ...plaidAuth,
        access_token: accessToken,
      });

      const accounts = response.data.accounts;
      const account = accountId
        ? accounts.find(a => a.account_id === accountId)
        : accounts[0];

      if (!account) throw new Error('Account not found');

      return {
        accountId: account.account_id,
        accountType: account.subtype,
        lastFour: account.mask,
        institutionName: response.data.item?.institution_id || 'Chime',
      };
    } catch (err) {
      console.error('Plaid getAccountDetails error:', err.response?.data || err.message);
      throw { code: 'PLAID_ERROR', message: 'Failed to retrieve account details.' };
    }
  },

  /**
   * Remove a linked bank account from Plaid
   */
  async removeItem(accessToken) {
    try {
      await plaidClient.post('/item/remove', {
        ...plaidAuth,
        access_token: accessToken,
      });
      return { success: true };
    } catch (err) {
      console.error('Plaid removeItem error:', err.response?.data || err.message);
      throw { code: 'PLAID_ERROR', message: 'Failed to unlink bank account.' };
    }
  },
};

module.exports = PlaidAdapter;
