const express = require('express');
const router = express.Router();
const { extractFreightFields } = require('../services/claude');
const { logFreightRecord } = require('../services/sheets');
const { createDeal } = require('../services/hubspot');
const { getCarriersForCustomer, getMarkupForCustomer } = require('../config/carriers');

/**
 * POST /api/intake
 *
 * Triggered by n8n when a new email arrives at freight@amzprep.com
 * Extracts freight fields via Claude, creates pipeline record,
 * and returns structured data for carrier distribution step.
 *
 * Body: { subject, from, text, messageId }
 */
router.post('/', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { subject, from, text, messageId } = req.body;

    if (!subject || !from || !text) {
      return res.status(400).json({
        error: 'Missing required fields: subject, from, text'
      });
    }

    console.log(`[Intake] Processing RFQ from: ${from}`);

    // ── Step 1: Claude extracts structured freight fields ──
    const freightFields = await extractFreightFields(subject, from, text);
    console.log(`[Intake] Extracted fields:`, freightFields);

    // ── Step 2: Build complete freight record ──────────────
    const quoteId = `FQ-${Date.now()}`;
    const intakeTime = new Date().toISOString();
    const bidDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const customerEmail = freightFields.customer_email || from;
    const eligibleCarriers = getCarriersForCustomer(customerEmail);
    const markupPct = getMarkupForCustomer(customerEmail);

    const record = {
      quote_id: quoteId,
      status: 'INTAKE',
      intake_time: intakeTime,
      bid_deadline: bidDeadline,
      customer_email: customerEmail,
      customer_name: freightFields.customer_name || 'Unknown',
      origin: freightFields.origin,
      destination: freightFields.destination,
      weight_lbs: freightFields.weight_lbs,
      dimensions: freightFields.dimensions,
      freight_class: freightFields.freight_class,
      hazmat: freightFields.hazmat || false,
      accessorials: freightFields.accessorials || [],
      pickup_date: freightFields.required_pickup_date,
      special_notes: freightFields.special_notes,
      eligible_carriers: eligibleCarriers,
      markup_pct: markupPct,
      original_message_id: messageId
    };

    // ── Step 3: Log to Google Sheets + HubSpot in parallel ──
    const [hubspotDealId] = await Promise.allSettled([
      createDeal(record),
      logFreightRecord(record)
    ]);

    if (hubspotDealId.status === 'fulfilled') {
      record.hubspot_deal_id = hubspotDealId.value;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Intake] ✅ Quote ${quoteId} created in ${elapsed}ms`);

    return res.status(201).json({
      success: true,
      quote_id: quoteId,
      record,
      next_step: 'carrier_distribution',
      carriers_to_contact: eligibleCarriers,
      bid_deadline: bidDeadline,
      elapsed_ms: elapsed
    });

  } catch (err) {
    console.error('[Intake] Error:', err.message);
    next(err);
  }
});

module.exports = router;
