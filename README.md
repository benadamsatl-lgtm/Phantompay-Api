# PhantomPay API 👻

Single-use virtual card engine. A card appears, pays, then vanishes.

**Live at:** https://api.phantompay.online

---

## Stack
- **Runtime:** Node.js + Express
- **Database:** PostgreSQL
- **Card Engine:** Lithic (swappable)
- **Bank Linking:** Plaid → Chime (swappable)
- **Billing:** Stripe (coming soon)

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Fill in your Lithic, Plaid, and database credentials
```

### 3. Set up database
```bash
# Create your PostgreSQL database
createdb phantompay

# Run migrations
npm run migrate
```

### 4. Start the server
```bash
npm run dev      # development
npm start        # production
```

---

## API Keys You Need

| Service | Where to get it | Cost |
|---------|----------------|------|
| **Lithic** | lithic.com → sign up → sandbox keys | Free sandbox |
| **Plaid** | plaid.com → sign up → sandbox keys | Free sandbox |
| **PostgreSQL** | Local or Railway.app | Free tier |
| **Stripe** | stripe.com | Free (pay per transaction) |

---

## Project Structure

```
src/
├── index.js                    # App entry point
├── routes/
│   ├── auth.js                 # Register, login, refresh, logout
│   ├── user.js                 # User profile
│   ├── cards.js                # Virtual card CRUD + freeze/cancel
│   ├── funding.js              # Bank account linking via Plaid
│   ├── transactions.js         # Transaction history
│   ├── billing.js              # Plans and upgrades
│   └── webhooks.js             # Lithic webhook → auto-freeze
├── middleware/
│   ├── auth.js                 # JWT verification + tier limit checks
│   └── errorHandler.js         # Global error handler
├── adapters/
│   ├── card/
│   │   └── lithic.js           # Lithic card engine (swappable)
│   └── funding/
│       └── plaid.js            # Plaid bank linking (swappable)
└── models/
    ├── db.js                   # PostgreSQL connection pool
    └── migrate.js              # Database migrations
```

---

## Tier Limits

| Tier | Price | Cards/Month |
|------|-------|-------------|
| Free | $0 | 5 |
| Pay As You Go | $0.07/card | Unlimited |
| Plus | $1.99/mo | 50 |
| Unlimited | $4.99/mo | Unlimited |

---

## The Magic Flow

1. User hits checkout → browser extension calls `POST /cards/create`
2. Backend calls Lithic → fresh virtual card number generated
3. Extension auto-fills card number, expiry, CVV into checkout form
4. User completes purchase
5. Lithic fires webhook to `POST /webhooks/lithic`
6. Backend auto-freezes card — it's dead in under a second
7. Nobody can charge that number again. Ever.

---

## Adding a New Bank (Adapter Pattern)

To add Chase, Capital One, etc.:

1. Create `src/adapters/funding/chase.js` mirroring `plaid.js`
2. Update `funding_sources.bank_adapter` field to `'chase'`
3. Route `link/initiate` to the correct adapter based on `bank_hint`

Zero changes to card logic, billing, or any other layer.

---

## Next Steps
- [ ] Chrome browser extension
- [ ] React Native mobile app (iOS + Android)
- [ ] Stripe billing integration
- [ ] Safari extension
- [ ] Add Chase as second funding adapter
