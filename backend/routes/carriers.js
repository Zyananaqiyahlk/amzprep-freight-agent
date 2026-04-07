const express = require('express');
const router = express.Router();
const { parseCarrierRate, generateQuoteEmail } = require('../services/claude');
const { logCarrierRate, getRatesForQuote, updateFreightRecord } = require('../services/sheets');
const { updateDeal, findDealByQuoteId } = require('../services/hubspot');
const { getMarkupForCustomer, applyMarkup } = require('../config/carriers');

/**
 * POST /api/carriers/response
 *
 * Triggered by n8n when a carrier reply arrives containing FQ- in subject.
 * Parses the rate via Claude, logs it, checks if re-bid window should trigger.
 *
 * Body: { subject, from, text, quoteId? }
 */
router.post('/response', async (req, res, next) => {
  try {
    const { subject, from, text } = req.body;

    if (!subject || !from || !text) {
      return res.status(400).json({ error: 'Missing required fields: subject, from, text' });
    }

    console.log(`[Carriers] Parsing rate response from: ${from}`);

    // ── Step 1: Claude parses the carrier email ────────────
    const rateData = await parseCarrierRate(subject, from, text);
    console.log(`[Carriers] Parsed rate:`, rateData);

    if (!rateData.quote_id) {
      return res.status(422).json({ error: 'Could not extract quote_id from email' });
    }

    // ── Step 2: Log rate to Google Sheets ─────────────────
    await logCarrierRate({ ...rateData, round: 1 });

    return res.json({
      success: true,
      parsed_rate: rateData,
      message: 'Rate logged. Check /api/carriers/benchmark to trigger re-bid.'
    });

  } catch (err) {
    console.error('[Carriers] Error:', err.message);
    next(err);
  }
});

/**
 * POST /api/carriers/benchmark
 *
 * Called by n8n after timer expires OR all carriers have responded.
 * Compares all rates, triggers re-bid round, sends best-and-final emails.
 *
 * Body: { quoteId, customerEmail, forceRebid? }
 */
router.post('/benchmark', async (req, res, next) => {
  try {
    const { quoteId, customerEmail, forceRebid = false } = req.body;

    if (!quoteId) {
      return res.status(400).json({ error: 'quoteId required' });
    }

    // ── Step 1: Fetch all rates for this quote ─────────────
    const rates = await getRatesForQuote(quoteId);

    if (rates.length === 0) {
      return res.status(404).json({ error: 'No rates found for this quote' });
    }

    // ── Step 2: Sort and find winner ───────────────────────
    const sorted = rates
      .filter(r => r.availability_confirmed === 'YES')
      .sort((a, b) => parseFloat(a.total_rate) - parseFloat(b.total_rate));

    if (sorted.length === 0) {
      return res.status(422).json({ error: 'No available carriers in rate responses' });
    }

    const winner = sorted[0];
    const losers = sorted.slice(1);

    // ── Step 3: Build re-bid message for non-winners ───────
    const rebidMessage = {
      subject: `Re-Bid Request — ${quoteId} | Best Rate: $${winner.total_rate} | 30 Min Window`,
      body: `Re-Bid Opportunity — Final Round\n\nThank you for your quote on ${quoteId}.\n\nWe have received a competitive rate of $${winner.total_rate} for this shipment.\n\nThis is your final opportunity to submit your best rate.\n\nDeadline: 30 minutes from receipt of this email.\n\nPlease reply with your absolute best rate.\nInclude ${quoteId} in your reply subject line.\n\nAMZ Prep Logistics`,
      carriers_to_rebid: losers.map(l => l.carrier_name),
      rebid_deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };

    // ── Step 4: Update pipeline stage ─────────────────────
    await updateFreightRecord(quoteId, { status: 'REBID_ROUND' });
    const dealId = await findDealByQuoteId(quoteId);
    if (dealId) await updateDeal(dealId, 'REBID_ROUND');

    console.log(`[Benchmark] ${quoteId} — Winner: ${winner.carrier_name} @ $${winner.total_rate}`);
    console.log(`[Benchmark] Re-bid going to: ${rebidMessage.carriers_to_rebid.join(', ')}`);

    return res.json({
      success: true,
      current_winner: winner,
      rebid_message: rebidMessage,
      all_rates: sorted
    });

  } catch (err) {
    console.error('[Benchmark] Error:', err.message);
    next(err);
  }
});

/**
 * POST /api/carriers/quote
 *
 * Called after re-bid window closes. Selects final winner,
 * applies markup, generates customer quote via Claude.
 *
 * Body: { quoteId, customerEmail, origin, destination, pickupDate }
 */
router.post('/quote', async (req, res, next) => {
  try {
    const { quoteId, customerEmail, origin, destination, pickupDate } = req.body;

    if (!quoteId || !customerEmail) {
      return res.status(400).json({ error: 'quoteId and customerEmail required' });
    }

    // ── Step 1: Get all rates and select final winner ──────
    const rates = await getRatesForQuote(quoteId);
    const sorted = rates
      .filter(r => r.availability_confirmed === 'YES')
      .sort((a, b) => parseFloat(a.total_rate) - parseFloat(b.total_rate));

    if (sorted.length === 0) {
      return res.status(422).json({ error: 'No available rates to quote from' });
    }

    const winner = sorted[0];
    const winnerRate = parseFloat(winner.total_rate);
    const transitDays = parseInt(winner.transit_days);

    // ── Step 2: Apply customer markup ─────────────────────
    const markupPct = getMarkupForCustomer(customerEmail);
    const { sellRate, grossProfitUsd, grossProfitPct } = applyMarkup(winnerRate, markupPct);

    // ── Step 3: Claude generates professional quote email ──
    const quoteEmailBody = await generateQuoteEmail({
      quoteId,
      origin: origin || winner.origin || 'Origin TBD',
      destination: destination || winner.destination || 'Destination TBD',
      sellRate,
      transitDays,
      pickupDate,
      expiryHours: 4
    });

    // ── Step 4: Update records with final pricing ──────────
    await updateFreightRecord(quoteId, {
      status: 'QUOTE_SENT',
      winning_carrier: winner.carrier_name,
      carrier_rate: winnerRate,
      sell_rate: sellRate,
      gross_profit_usd: grossProfitUsd,
      gross_profit_pct: grossProfitPct
    });

    const dealId = await findDealByQuoteId(quoteId);
    if (dealId) {
      await updateDeal(dealId, 'QUOTE_SENT', {
        amount: sellRate,
        quote_sent_time: new Date().toISOString()
      });
    }

    console.log(`[Quote] ${quoteId} — Sell rate: $${sellRate} (cost $${winnerRate}, margin $${grossProfitUsd} / ${grossProfitPct}%)`);

    return res.json({
      success: true,
      quote_id: quoteId,
      winning_carrier: winner.carrier_name,
      carrier_rate: winnerRate,
      sell_rate: sellRate,
      gross_profit_usd: grossProfitUsd,
      gross_profit_pct: grossProfitPct,
      markup_pct: markupPct,
      quote_email_body: quoteEmailBody,
      quote_expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    });

  } catch (err) {
    console.error('[Quote] Error:', err.message);
    next(err);
  }
});

module.exports = router;
