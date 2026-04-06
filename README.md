# AMZ Prep — Freight Bidding Agent

> Automated freight quoting engine. Replaces a 3–24 hour manual process with a sub-30-minute AI-powered pipeline.

Built by [Naqiyah Lakdawala](https://zyanacosystems.com) · [naqiyahlk@gmail.com](mailto:naqiyahlk@gmail.com)

---

## The Problem

AMZ Prep was losing freight contracts not on price — but on speed.

The current workflow:
1. Customer emails `freight@amzprep.com`
2. Broker manually forwards to 5–6 carriers
3. Rates arrive over 3–24 hours
4. Broker compares manually, triggers re-bid, applies markup, emails customer
5. Competitor with automation responds in **minutes** — deal is gone

**This system eliminates every manual step.**

---

## How It Works

```
Customer Email (freight@amzprep.com)
          │
          ▼
    Intake Service
  Claude extracts fields
  Creates pipeline record
          │
          ▼
  Carrier Distribution
  RFQ sent to 5-6 carriers
  2-hour bidding window starts
          │
          ▼
  Rate Collection Engine
  Claude parses each response
  Rates logged to Google Sheets
          │
          ▼
    Re-Bid Engine
  Identifies lowest rate
  Sends best-and-final (30 min)
          │
          ▼
  Markup + Quote Engine
  Applies customer-specific rules
  Claude generates quote email
          │
      ┌───┴───┐
    WIN      LOSS
      │         │
  Carrier    Log reason
  notified   + competitor
  PandaDoc   rate stored
  invoice
```

**Target:** Response time from 3–24 hours → under 30 minutes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI / LLM | Claude Sonnet (Anthropic API) |
| Workflow Orchestration | n8n (self-hosted or cloud) |
| Backend API | Node.js + Express |
| CRM | HubSpot (Deals pipeline) |
| Data / Reporting | Google Sheets |
| Email | Gmail API (via n8n OAuth2) |
| Invoicing | PandaDoc |
| Billing | QuickBooks |

No rip-and-replace. All integrations use AMZ Prep's existing stack.

---

## Repository Structure

```
amzprep-freight-agent/
├── backend/
│   ├── server.js              # Express entry point
│   ├── routes/
│   │   ├── intake.js          # POST /api/intake — process inbound RFQ
│   │   ├── carriers.js        # POST /api/carriers/response|benchmark|quote
│   │   └── approval.js        # POST /api/approval — WIN/LOSS branching
│   ├── services/
│   │   ├── claude.js          # All Claude API calls
│   │   ├── sheets.js          # Google Sheets read/write
│   │   └── hubspot.js         # HubSpot CRM operations
│   ├── config/
│   │   └── carriers.js        # Carrier rules + markup config
│   └── middleware/
│       └── errorHandler.js    # Centralised error handling
├── n8n/
│   └── workflows/
│       └── AMZPrep_FreightAgent_n8n_Workflow.json   # Import into n8n
├── scripts/
│   └── test-intake.js         # Run full flow test without real emails
├── .env.example               # All required environment variables
└── README.md
```

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/amzprep-freight-agent.git
cd amzprep-freight-agent/backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp ../.env.example .env
```

Edit `.env` with your keys:

```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SHEET_ID=your-sheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="..."
HUBSPOT_ACCESS_TOKEN=pat-na1-...
```

### 4. Run the test (no real emails needed)

```bash
node ../scripts/test-intake.js
```

This runs a full simulated flow using mock email data — extracts freight fields, parses a carrier rate, applies markup, generates a quote email, and classifies an approval. All via real Claude API calls.

Expected output:
```
========================================
  AMZ Prep Freight Agent — Full Test
========================================

📧 STEP 1: Extracting freight fields from RFQ email...
✅ Extracted: { origin: "Chicago, IL", destination: "Dallas, TX", weight_lbs: 800 ... }

📦 STEP 2: Parsing carrier rate response...
✅ Parsed rate: { carrier_name: "Amazon Freight", rate_usd: 840 ... }

💰 STEP 3: Applying markup (15%)...
✅ Cost: $840 → Sell: $966 | Margin: $126 (13.0%)

✉️  STEP 4: Generating customer quote email...
✅ Generated email: [professional quote text]

🔀 STEP 5: Classifying customer response...
✅ Classification: { classification: "APPROVED", confidence: "HIGH" ... }

========================================
  TEST COMPLETE ✅
========================================
```

### 5. Start the server

```bash
npm run dev   # development (with nodemon)
npm start     # production
```

### 6. Import n8n workflow

1. Open your n8n instance
2. New Workflow → ⋮ menu → **Import from File**
3. Select `n8n/workflows/AMZPrep_FreightAgent_n8n_Workflow.json`
4. Configure credentials (Gmail OAuth2, HubSpot, Anthropic API)
5. Activate

---

## API Reference

### `POST /api/intake`

Triggered by n8n when a new RFQ email arrives.

```json
// Request
{
  "subject": "Freight Quote Needed ASAP",
  "from": "sarah@sportgear.com",
  "text": "We need to ship 800lbs from Chicago to Dallas...",
  "messageId": "gmail-message-id"
}

// Response
{
  "success": true,
  "quote_id": "FQ-1743610234000",
  "record": { ... },
  "next_step": "carrier_distribution",
  "carriers_to_contact": ["Amazon Freight", "UPS Freight", ...],
  "bid_deadline": "2026-04-02T16:00:00Z"
}
```

### `POST /api/carriers/response`

Triggered when a carrier reply arrives.

```json
// Request
{
  "subject": "Re: Freight RFQ — FQ-1743610234000",
  "from": "quotes@amazon-freight.com",
  "text": "Our rate is $840. Transit 3 days..."
}
```

### `POST /api/carriers/benchmark`

Triggered after 2-hour bidding window expires.

```json
// Request
{ "quoteId": "FQ-1743610234000", "customerEmail": "sarah@sportgear.com" }

// Response — includes re-bid message to send non-winners
{
  "current_winner": { "carrier_name": "FedEx Freight", "total_rate": 875 },
  "rebid_message": { "subject": "...", "body": "...", "carriers_to_rebid": [...] }
}
```

### `POST /api/carriers/quote`

Generates final customer quote after re-bid window closes.

```json
// Response
{
  "winning_carrier": "Amazon Freight",
  "carrier_rate": 840,
  "sell_rate": 966,
  "gross_profit_usd": 126,
  "gross_profit_pct": 13.0,
  "quote_email_body": "Dear Sarah Chen, ..."
}
```

### `POST /api/approval`

Triggered when customer replies to quote.

```json
// Response — WIN
{
  "outcome": "WIN",
  "classification": { "classification": "APPROVED", "confidence": "HIGH" },
  "carrier_notification": { "subject": "✅ PROCEED...", "body": "..." }
}

// Response — LOSS
{
  "outcome": "LOSS",
  "classification": { "classification": "REJECTED", "lost_reason": "price_too_high" }
}
```

---

## Google Sheets Setup

Create a spreadsheet with these tabs:

**Tab 1: Freight Pipeline**
```
quote_id | status | customer_name | customer_email | origin | destination |
weight_lbs | dimensions | freight_class | hazmat | pickup_date | markup_pct |
intake_time | bid_deadline | winning_carrier | carrier_rate | sell_rate |
gross_profit_usd | gross_profit_pct | approval_time | lost_reason | competitor_rate
```

**Tab 2: Rate Responses**
```
quote_id | carrier_name | round | rate_usd | transit_days |
accessorial_charges | total_rate | availability_confirmed | timestamp | notes
```

---

## Configuring Carrier Rules

Edit `backend/config/carriers.js`:

```js
// Add customer-specific carrier restrictions
const carrierRules = {
  default: ['Amazon Freight', 'UPS Freight', 'FedEx Freight', ...],
  'customer@example.com': ['Amazon Freight'],  // Customer A only uses Amazon
};

// Add customer-specific markup rates
const markupRules = {
  default: 0.15,              // 15% default
  'vip@client.com': 0.08,    // 8% for high-volume VIP
  'new@client.com': 0.25,    // 25% for new clients
};
```

---

## Expected ROI

Based on conservative estimates (50 quotes/month, $225 avg gross profit):

| Metric | Before | After |
|---|---|---|
| Response time | 3–24 hours | < 30 minutes |
| Win rate | ~30% | ~50% |
| Monthly gross profit | $3,375 | $5,625 |
| Monthly uplift | — | +$2,250 |
| Annual uplift | — | +$27,000 |
| Payback period | — | ~8 months |

---

## Built By

**Naqiyah Lakdawala** — AI Automation Engineer & Founder, Zyana Systems Co.

- 🌐 [zyanacosystems.com](https://zyanacosystems.com)
- 📧 [naqiyahlk@gmail.com](mailto:naqiyahlk@gmail.com)
- 🏭 Background: Toyota (Industry 4.0, IIoT), Cepheid (AI pipelines, AWS), MSc Information Systems (Northeastern)
