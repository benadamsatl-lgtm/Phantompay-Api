require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const fundingRoutes = require('./routes/funding');
const cardRoutes = require('./routes/cards');
const transactionRoutes = require('./routes/transactions');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');

const { errorHandler } = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/auth');

const app = express();

// ── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://phantompay.online', 'chrome-extension://*']
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));

// ── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' } }
});
app.use('/api/', limiter);

// ── Body parsing ─────────────────────────────────────────────────────────────
// Webhooks need raw body for signature verification
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);
app.use('/api/v1/user',         authenticateToken, userRoutes);
app.use('/api/v1/funding-sources', authenticateToken, fundingRoutes);
app.use('/api/v1/cards',        authenticateToken, cardRoutes);
app.use('/api/v1/transactions', authenticateToken, transactionRoutes);
app.use('/api/v1/billing',      authenticateToken, billingRoutes);
app.use('/api/v1/webhooks',     webhookRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'PhantomPay API', version: '1.0.0' });
});

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PhantomPay API running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

module.exports = app;
