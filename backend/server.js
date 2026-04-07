require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const intakeRoutes = require('./routes/intake');
const carrierRoutes = require('./routes/carriers');
const approvalRoutes = require('./routes/approval');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AMZ Prep Freight Bidding Agent',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── Routes ──────────────────────────────────────────────────
app.use('/api/intake', intakeRoutes);
app.use('/api/carriers', carrierRoutes);
app.use('/api/approval', approvalRoutes);

// ── Error handling ──────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚚 AMZ Prep Freight Agent running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Intake: POST http://localhost:${PORT}/api/intake`);
  console.log(`   Carriers: POST http://localhost:${PORT}/api/carriers/response`);
  console.log(`   Approval: POST http://localhost:${PORT}/api/approval\n`);
});

module.exports = app;
