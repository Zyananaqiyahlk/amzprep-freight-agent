const express = require('express');
const router = express.Router();
const { classifyCustomerResponse } = require('../services/claude');
const { updateFreightRecord } = require('../services/sheets');
const { updateDeal, findDealByQuoteId } = require('../services/hubspot');

/**
 * POST /api/approval
 *
 * Triggered by n8n when a customer reply arrives.
 * Claude classifies it as APPROVED/REJECTED/NEGOTIATING/UNCLEAR.
 * Routes to WIN or LOSS branch accordingly.
 *
 * Body: { subject, text, quoteId, winningCarrier, sellRate }
 */
router.post('/', async (req, res, next) => {
  try {
    const { subject, text, quoteId, winningCarrier, sellRate } = req.body;

    if (!subject || !text || !quoteId) {
      return res.status(400).json({ error: 'Missing required fields: subject, text, quoteId' });
    }

    console.log(`[Approval] Classifying customer response for ${quoteId}`);

    // ── Step 1: Claude classifies the response ─────────────
    const classification = await classifyCustomerResponse(subject, text);
    console.log(`[Approval] Classification:`, classification);

    const dealId = await findDealByQuoteId(quoteId);

    // ── Step 2: Route based on classification ──────────────
    if (classification.classification === 'APPROVED') {
      await updateFreightRecord(quoteId, {
        status: 'APPROVED',
        approval_time: new Date().toISOString()
      });
      if (dealId) await updateDeal(dealId, 'APPROVED', {
        closedate: new Date().toISOString().split('T')[0]
      });

      console.log(`[Approval] ✅ WON — ${quoteId}`);

      return res.json({
        success: true,
        outcome: 'WIN',
        quote_id: quoteId,
        classification,
        next_steps: [
          `Notify ${winningCarrier} to proceed`,
          'Request Bill of Lading (BOL)',
          `Generate PandaDoc invoice for $${sellRate}`,
          'Await payment confirmation',
          'Schedule pickup'
        ],
        carrier_notification: {
          subject: `✅ PROCEED — ${quoteId} | Customer Approved`,
          body: `The customer has approved this shipment.\n\nPlease proceed with booking for quote ${quoteId}.\n\nSend the Bill of Lading (BOL) to freight@amzprep.com.\n\nReference all communications with: ${quoteId}\n\nThank you,\nAMZ Prep Logistics`
        }
      });
    }

    if (classification.classification === 'REJECTED') {
      await updateFreightRecord(quoteId, {
        status: 'LOST',
        lost_reason: classification.lost_reason || 'unknown',
        competitor_rate: classification.competitor_rate || ''
      });
      if (dealId) await updateDeal(dealId, 'LOST');

      console.log(`[Approval] ❌ LOST — ${quoteId} | Reason: ${classification.lost_reason}`);

      return res.json({
        success: true,
        outcome: 'LOSS',
        quote_id: quoteId,
        classification,
        carrier_notification: {
          subject: `❌ CANCELLED — ${quoteId} | Do Not Proceed`,
          body: `Unfortunately the customer has declined this shipment for quote ${quoteId}.\n\nPlease do not proceed with booking.\n\nWe appreciate your competitive pricing.\n\nAMZ Prep Logistics`
        }
      });
    }

    // NEGOTIATING or UNCLEAR — flag for human review
    console.log(`[Approval] ⚠️  NEEDS REVIEW — ${quoteId} | ${classification.classification}`);

    return res.json({
      success: true,
      outcome: 'NEEDS_REVIEW',
      quote_id: quoteId,
      classification,
      message: 'Customer response requires human review — routed to freight team'
    });

  } catch (err) {
    console.error('[Approval] Error:', err.message);
    next(err);
  }
});

module.exports = router;
