require('dotenv').config();
const db = require('./db');

async function migrate() {
  console.log('🔄 Running PhantomPay migrations...');

  await db.query(`
    -- ── Users ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email                     VARCHAR(255) UNIQUE NOT NULL,
      password_hash             VARCHAR(255) NOT NULL,
      full_name                 VARCHAR(255) NOT NULL,
      phone                     VARCHAR(50),
      tier                      VARCHAR(20) NOT NULL DEFAULT 'free',
      cards_used_this_month     INTEGER NOT NULL DEFAULT 0,
      billing_period_start      DATE NOT NULL DEFAULT CURRENT_DATE,
      is_active                 BOOLEAN NOT NULL DEFAULT true,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Refresh tokens ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  VARCHAR(255) NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Funding sources (bank adapter layer) ────────────────────────────────
    CREATE TABLE IF NOT EXISTS funding_sources (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bank_adapter        VARCHAR(50) NOT NULL DEFAULT 'chime',
      plaid_access_token  VARCHAR(500),
      plaid_account_id    VARCHAR(255),
      plaid_item_id       VARCHAR(255),
      account_type        VARCHAR(50),
      last_four           VARCHAR(4),
      institution_name    VARCHAR(255),
      status              VARCHAR(20) NOT NULL DEFAULT 'active',
      linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Virtual cards (card engine layer) ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS virtual_cards (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      funding_source_id       UUID REFERENCES funding_sources(id),
      lithic_card_token       VARCHAR(255) UNIQUE,
      last_four               VARCHAR(4),
      status                  VARCHAR(20) NOT NULL DEFAULT 'active',
      spending_limit_cents    INTEGER,
      amount_charged_cents    INTEGER NOT NULL DEFAULT 0,
      merchant_hint           VARCHAR(255),
      auto_freeze_after_use   BOOLEAN NOT NULL DEFAULT true,
      idempotency_key         VARCHAR(255) UNIQUE,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      frozen_at               TIMESTAMPTZ,
      cancelled_at            TIMESTAMPTZ
    );

    -- ── Transactions ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS transactions (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id                   UUID NOT NULL REFERENCES virtual_cards(id),
      user_id                   UUID NOT NULL REFERENCES users(id),
      lithic_transaction_token  VARCHAR(255) UNIQUE,
      amount_cents              INTEGER NOT NULL,
      currency                  VARCHAR(10) NOT NULL DEFAULT 'USD',
      merchant                  VARCHAR(255),
      merchant_category         VARCHAR(100),
      status                    VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at                TIMESTAMPTZ
    );

    -- ── Billing records ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS billing_records (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID NOT NULL REFERENCES users(id),
      tier                  VARCHAR(20) NOT NULL,
      stripe_customer_id    VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      per_card_fee_cents    INTEGER DEFAULT 0,
      period_start          DATE NOT NULL,
      period_end            DATE NOT NULL,
      cards_used            INTEGER NOT NULL DEFAULT 0,
      amount_billed_cents   INTEGER NOT NULL DEFAULT 0,
      status                VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Indexes ─────────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_virtual_cards_user_id ON virtual_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_virtual_cards_lithic_token ON virtual_cards(lithic_card_token);
    CREATE INDEX IF NOT EXISTS idx_transactions_card_id ON transactions(card_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_funding_sources_user_id ON funding_sources(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
  `);

  console.log('✅ Migrations complete!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
