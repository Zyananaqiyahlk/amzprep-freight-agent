/**
 * AMZ Prep — Freight Bidding Agent MVP
 * ─────────────────────────────────────
 * Self-contained demo. Runs with: node agent.js
 * No API keys, no external services needed.
 *
 * To use real Claude API: set ANTHROPIC_API_KEY in .env
 * and the agent will automatically use it instead of mock responses.
 */

require('dotenv').config();

// ── Colour helpers for clean terminal output ─────────────────
const c = {
  blue:   (s) => `\x1b[34m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Mock carrier data ─────────────────────────────────────────
const MOCK_CARRIERS = [
  { name: 'Amazon Freight',  email: 'amazon@carrier.com' },
  { name: 'UPS Freight',     email: 'ups@carrier.com'    },
  { name: 'FedEx Freight',   email: 'fedex@carrier.com'  },
  { name: 'XPO Logistics',   email: 'xpo@carrier.com'    },
  { name: 'Old Dominion',    email: 'odfl@carrier.com'   },
];

// Simulates carrier rate responses with realistic variability
function mockCarrierRate(carrierName, weightLbs, origin, destination) {
  const baseRates = {
    'Amazon Freight': 0.95,
    'UPS Freight':    1.10,
    'FedEx Freight':  1.05,
    'XPO Logistics':  0.98,
    'Old Dominion':   1.02,
  };
  const base = baseRates[carrierName] || 1.0;
  const distanceFactor = 1.0; // simplified — real system uses lane data
  const weightRate = (weightLbs / 100) * 12 * base * distanceFactor;
  const jitter = (Math.random() * 0.2 - 0.1); // ±10% variability
  const rate = Math.round((weightRate * (1 + jitter)) * 100) / 100;
  const transitDays = Math.floor(Math.random() * 3) + 2; // 2-4 days

  return {
    carrier_name: carrierName,
    rate_usd: rate,
    transit_days: transitDays,
    accessorial_charges: 0,
    total_rate: rate,
    availability_confirmed: Math.random() > 0.1, // 90% available
    notes: null
  };
}

// ── Markup rules ─────────────────────────────────────────────
const MARKUP_RULES = {
  default:              0.10,  // 10% default
  preferred:            0.05,  // 5% preferred customer
  'sarah@sportgear.com': 0.08, // 8% specific customer
};

function getMarkup(customerEmail) {
  return MARKUP_RULES[customerEmail] || MARKUP_RULES.default;
}

function applyMarkup(costRate, markupPct) {
  const sellRate      = Math.ceil(costRate * (1 + markupPct) * 100) / 100;
  const grossProfit   = Math.round((sellRate - costRate) * 100) / 100;
  const grossProfitPct = Math.round((grossProfit / sellRate) * 1000) / 10;
  return { sellRate, grossProfit, grossProfitPct };
}

// ── LLM: Claude API or smart mock ────────────────────────────
async function callLLM(prompt, context = '') {
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();
    const res = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });
    return res.content[0].text.trim();
  }

  // ── Smart mock responses ──────────────────────────────────
  if (context === 'extract') {
    return JSON.stringify({
      origin:               'Chicago, IL',
      destination:          'Dallas, TX',
      weight_lbs:           800,
      dimensions:           '48x40x60 inches',
      freight_class:        '70',
      hazmat:               false,
      accessorials:         [],
      required_pickup_date: '2026-04-10',
      customer_name:        'Sarah Chen',
      customer_email:       'sarah@sportgear.com',
      special_notes:        null
    });
  }

  if (context === 'quote') {
    const data = JSON.parse(prompt.match(/DATA:(.*?)END/s)[1]);
    return `Dear ${data.customer_name},

Thank you for your freight inquiry. We're pleased to provide the following quote:

Quote Reference: ${data.quote_id}
Route: ${data.origin} → ${data.destination}
Total Rate: $${data.sell_rate}
Estimated Transit: ${data.transit_days} business days
Pickup: ${data.pickup_date || 'Flexible'}

This quote is valid for 4 hours. To confirm, please reply APPROVED.

Best regards,
AMZ Prep Logistics Team`;
  }

  if (context === 'classify') {
    const text = prompt.toLowerCase();
    if (text.includes('approve') || text.includes('yes') || text.includes('go ahead') || text.includes('confirmed')) {
      return JSON.stringify({ classification: 'APPROVED', confidence: 'HIGH', lost_reason: null, competitor_rate: null });
    }
    if (text.includes('no') || text.includes('cancel') || text.includes('decline') || text.includes('too expensive')) {
      return JSON.stringify({ classification: 'REJECTED', confidence: 'HIGH', lost_reason: 'price_too_high', competitor_rate: null });
    }
    return JSON.stringify({ classification: 'UNCLEAR', confidence: 'LOW', lost_reason: null, competitor_rate: null });
  }

  return '{}';
}

// ── AGENT STATE MACHINE ───────────────────────────────────────
class FreightAgent {
  constructor(rawRequest) {
    this.state = {
      stage:          'INIT',
      quote_id:       `FQ-${Date.now()}`,
      raw_request:    rawRequest,
      freight_fields: null,
      carrier_rates:  [],
      winning_rate:   null,
      markup_pct:     null,
      sell_rate:      null,
      gross_profit:   null,
      quote_email:    null,
      approval:       null,
      started_at:     Date.now(),
      log:            []
    };
  }

  log(msg, level = 'info') {
    const ts = new Date().toISOString().split('T')[1].slice(0, 8);
    const prefix = {
      info:    c.dim(`[${ts}]`) + ' ',
      success: c.green(`[${ts}] ✓`) + ' ',
      ai:      c.cyan(`[${ts}] ◆`) + ' ',
      warn:    c.yellow(`[${ts}] ⚠`) + ' ',
      error:   c.red(`[${ts}] ✗`) + ' ',
    }[level] || '';
    const line = prefix + msg;
    console.log(line);
    this.state.log.push({ ts, level, msg });
  }

  transition(newStage) {
    this.log(c.blue(`Stage: ${this.state.stage} → ${newStage}`));
    this.state.stage = newStage;
  }

  // ── Step 1: Extract structured fields from raw request ──────
  async extractFields() {
    this.transition('EXTRACTING');
    this.log('Sending request to Claude for field extraction...', 'ai');

    const prompt = `Extract freight shipment details and return ONLY valid JSON:
{
  "origin": "city, state",
  "destination": "city, state",
  "weight_lbs": number,
  "dimensions": "string or null",
  "freight_class": "string or null",
  "hazmat": boolean,
  "accessorials": [],
  "required_pickup_date": "YYYY-MM-DD or null",
  "customer_name": "string",
  "customer_email": "string",
  "special_notes": "string or null"
}

Request: ${this.state.raw_request}
Return ONLY JSON. No explanation.`;

    const response = await callLLM(prompt, 'extract');
    this.state.freight_fields = JSON.parse(response);

    this.log(`Origin: ${c.bold(this.state.freight_fields.origin)}`, 'success');
    this.log(`Destination: ${c.bold(this.state.freight_fields.destination)}`, 'success');
    this.log(`Weight: ${c.bold(this.state.freight_fields.weight_lbs + ' lbs')}`, 'success');
    this.log(`Customer: ${c.bold(this.state.freight_fields.customer_email)}`, 'success');
  }

  // ── Step 2: Collect rates from carriers ──────────────────────
  async collectRates() {
    this.transition('COLLECTING_RATES');
    this.log(`Sending RFQ to ${MOCK_CARRIERS.length} carriers simultaneously...`);

    // Simulate async carrier responses with staggered delays
    const ratePromises = MOCK_CARRIERS.map(async (carrier, i) => {
      await sleep(200 + i * 150); // staggered responses
      const rate = mockCarrierRate(
        carrier.name,
        this.state.freight_fields.weight_lbs,
        this.state.freight_fields.origin,
        this.state.freight_fields.destination
      );
      if (rate.availability_confirmed) {
        this.log(`${carrier.name}: $${rate.total_rate} (${rate.transit_days} days)`, 'success');
      } else {
        this.log(`${carrier.name}: unavailable for this lane`, 'warn');
      }
      return rate;
    });

    const allRates = await Promise.all(ratePromises);
    this.state.carrier_rates = allRates.filter(r => r.availability_confirmed);
    this.log(`${this.state.carrier_rates.length}/${MOCK_CARRIERS.length} carriers responded`);
  }

  // ── Step 3: Benchmark and re-bid ─────────────────────────────
  async benchmark() {
    this.transition('BENCHMARKING');

    const sorted = [...this.state.carrier_rates]
      .sort((a, b) => a.total_rate - b.total_rate);

    const winner    = sorted[0];
    const nonWinners = sorted.slice(1);

    this.log(`Lowest rate: ${c.bold(winner.carrier_name)} @ $${c.bold(winner.total_rate)}`);
    this.log(`Sending best-and-final re-bid to ${nonWinners.length} carriers (30min window)...`);

    // Simulate re-bid responses — some carriers improve their rate
    await sleep(500);
    const rebidResponses = nonWinners.map(c => {
      const improved = Math.random() > 0.5;
      if (improved) {
        const newRate = Math.round((winner.total_rate * (0.97 + Math.random() * 0.05)) * 100) / 100;
        return { ...c, total_rate: newRate, rate_usd: newRate };
      }
      return c;
    });

    // Final selection from all round 2 rates + original winner
    const allRound2 = [winner, ...rebidResponses].sort((a, b) => a.total_rate - b.total_rate);
    this.state.winning_rate = allRound2[0];

    this.log(`Final winner: ${c.bold(this.state.winning_rate.carrier_name)} @ $${c.bold(this.state.winning_rate.total_rate)}`, 'success');
  }

  // ── Step 4: Apply markup and calculate sell rate ─────────────
  async applyMarkupRule() {
    this.transition('APPLYING_MARKUP');

    const customerEmail = this.state.freight_fields.customer_email;
    this.state.markup_pct = getMarkup(customerEmail);

    const { sellRate, grossProfit, grossProfitPct } = applyMarkup(
      this.state.winning_rate.total_rate,
      this.state.markup_pct
    );

    this.state.sell_rate    = sellRate;
    this.state.gross_profit = grossProfit;

    this.log(`Markup rule: ${c.bold((this.state.markup_pct * 100) + '%')} for ${customerEmail}`);
    this.log(`Cost: $${this.state.winning_rate.total_rate} → Sell: $${c.bold(sellRate)} | Margin: $${grossProfit} (${grossProfitPct}%)`, 'success');
  }

  // ── Step 5: Generate quote email via Claude ───────────────────
  async generateQuote() {
    this.transition('GENERATING_QUOTE');
    this.log('Generating customer quote email via Claude...', 'ai');

    const data = {
      quote_id:      this.state.quote_id,
      customer_name: this.state.freight_fields.customer_name,
      origin:        this.state.freight_fields.origin,
      destination:   this.state.freight_fields.destination,
      sell_rate:     this.state.sell_rate,
      transit_days:  this.state.winning_rate.transit_days,
      pickup_date:   this.state.freight_fields.required_pickup_date,
    };

    const prompt = `Write a professional freight quote email. Return ONLY the email body.
DATA:${JSON.stringify(data)}END
- Professional, confident, 4-6 sentences
- Do NOT reveal carrier name or cost
- End with: reply APPROVED to confirm
- Sign off as AMZ Prep Logistics Team`;

    this.state.quote_email = await callLLM(prompt, 'quote');
    this.log('Quote email generated', 'success');
  }

  // ── Step 6: Classify customer response ──────────────────────
  async classifyResponse(customerReply) {
    this.transition('CLASSIFYING_RESPONSE');
    this.log(`Classifying customer response: "${customerReply}"`, 'ai');

    const prompt = `Classify this customer reply: "${customerReply}"
Return ONLY JSON: {"classification":"APPROVED"|"REJECTED"|"NEGOTIATING"|"UNCLEAR","confidence":"HIGH"|"MEDIUM"|"LOW","lost_reason":null,"competitor_rate":null}`;

    const result = await callLLM(prompt, 'classify');
    this.state.approval = JSON.parse(result);

    const icon = this.state.approval.classification === 'APPROVED' ? '✓' : '✗';
    this.log(`${icon} ${c.bold(this.state.approval.classification)} (${this.state.approval.confidence} confidence)`,
      this.state.approval.classification === 'APPROVED' ? 'success' : 'warn');
  }

  // ── Final structured output ──────────────────────────────────
  buildOutput() {
    const elapsed = ((Date.now() - this.state.started_at) / 1000).toFixed(1);
    return {
      quote_id:         this.state.quote_id,
      status:           this.state.approval?.classification || 'QUOTE_SENT',
      elapsed_seconds:  parseFloat(elapsed),
      freight: {
        origin:      this.state.freight_fields.origin,
        destination: this.state.freight_fields.destination,
        weight_lbs:  this.state.freight_fields.weight_lbs,
        pickup_date: this.state.freight_fields.required_pickup_date,
      },
      pricing: {
        winning_carrier:   this.state.winning_rate.carrier_name,
        carrier_cost:      this.state.winning_rate.total_rate,
        markup_pct:        this.state.markup_pct,
        sell_rate:         this.state.sell_rate,
        gross_profit_usd:  this.state.gross_profit,
        transit_days:      this.state.winning_rate.transit_days,
      },
      quote_email: this.state.quote_email,
      approval:    this.state.approval,
    };
  }
}

// ── MAIN — Run the agent end to end ──────────────────────────
async function main() {
  console.log('\n' + c.bold('═'.repeat(56)));
  console.log(c.bold('  AMZ Prep — Freight Bidding Agent MVP'));
  console.log(c.bold('  github.com/Zyananaqiyahlk/amzprep-freight-agent'));
  console.log(c.bold('═'.repeat(56)));

  const usingRealClaude = !!process.env.ANTHROPIC_API_KEY;
  console.log(c.dim(`\n  Mode: ${usingRealClaude ? c.green('Real Claude API') : c.yellow('Smart mock (no API key needed)')}`));
  console.log(c.dim('  To use Claude: add ANTHROPIC_API_KEY to .env\n'));

  // ── Inbound freight request ──────────────────────────────────
  const INBOUND_REQUEST = `
    We need to ship a pallet from our Chicago warehouse to a customer in Dallas.
    Weight: 800 lbs, Dimensions: 48x40x60 inches, No hazmat.
    Pickup needed by April 10th.
    Contact: Sarah Chen, sarah@sportgear.com
  `;

  const CUSTOMER_REPLY = 'Looks great, we approve. Please go ahead and confirm the booking.';

  console.log(c.blue('─── Inbound RFQ ───────────────────────────────────'));
  console.log(c.dim(INBOUND_REQUEST.trim()));
  console.log(c.blue('───────────────────────────────────────────────────\n'));

  const agent = new FreightAgent(INBOUND_REQUEST);

  try {
    // Run the agent loop
    await agent.extractFields();
    console.log('');
    await agent.collectRates();
    console.log('');
    await agent.benchmark();
    console.log('');
    await agent.applyMarkupRule();
    console.log('');
    await agent.generateQuote();
    console.log('');
    await agent.classifyResponse(CUSTOMER_REPLY);

    // Final output
    const output = agent.buildOutput();

    console.log('\n' + c.bold('═'.repeat(56)));
    console.log(c.bold(c.green('  STRUCTURED QUOTE OUTPUT')));
    console.log(c.bold('═'.repeat(56)));
    console.log(JSON.stringify(output, null, 2));

    console.log('\n' + c.bold('═'.repeat(56)));
    console.log(c.bold('  QUOTE EMAIL (sent to customer)'));
    console.log(c.bold('─'.repeat(56)));
    console.log(output.quote_email);

    console.log('\n' + c.bold('═'.repeat(56)));
    console.log(c.bold('  SUMMARY'));
    console.log(c.bold('─'.repeat(56)));
    console.log(`  Quote ID:    ${c.bold(output.quote_id)}`);
    console.log(`  Route:       ${c.bold(output.freight.origin + ' → ' + output.freight.destination)}`);
    console.log(`  Carrier:     ${c.bold(output.pricing.winning_carrier)}`);
    console.log(`  Cost:        ${c.bold('$' + output.pricing.carrier_cost)}`);
    console.log(`  Markup:      ${c.bold((output.pricing.markup_pct * 100) + '%')}`);
    console.log(`  Sell rate:   ${c.bold('$' + output.pricing.sell_rate)}`);
    console.log(`  Margin:      ${c.bold('$' + output.pricing.gross_profit_usd)}`);
    console.log(`  Transit:     ${c.bold(output.pricing.transit_days + ' days')}`);
    console.log(`  Outcome:     ${c.bold(output.status)}`);
    console.log(`  Total time:  ${c.bold(output.elapsed_seconds + 's')} (vs 3-24 hours manual)`);
    console.log(c.bold('═'.repeat(56)) + '\n');

  } catch (err) {
    console.error(c.red('\n  Error: ' + err.message));
    if (err.message.includes('Cannot find module')) {
      console.error(c.yellow('  → Run: npm install'));
    }
    process.exit(1);
  }
}

main();
