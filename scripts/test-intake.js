/**
 * AMZ Prep Freight Agent — Local Test Script
 *
 * Simulates a full intake → rate collection → quote → approval flow
 * without needing real emails. Run with: node scripts/test-intake.js
 *
 * Requires: ANTHROPIC_API_KEY in .env
 */

require('dotenv').config({ path: '../.env' });

const {
  extractFreightFields,
  parseCarrierRate,
  generateQuoteEmail,
  classifyCustomerResponse
} = require('../backend/services/claude');

const { applyMarkup } = require('../backend/config/carriers');

// ── Mock email data ──────────────────────────────────────────
const MOCK_RFQ_EMAIL = {
  subject: 'Freight Quote Needed ASAP',
  from: 'sarah@sportgear.com',
  body: `Hi,

We need to ship a pallet from our Chicago warehouse to a customer in Dallas.

Weight: 800 lbs
Dimensions: 48x40x60 inches
No hazmat
Pickup needed by Friday April 10th

Thanks,
Sarah Chen
SportGear Co.`
};

const MOCK_CARRIER_RESPONSE = {
  subject: 'Re: Freight RFQ — FQ-1743610234000',
  from: 'quotes@amazon-freight.com',
  body: `Hello,

Thank you for the rate request.

Our best rate for this shipment is $840.
Transit time: 3 business days
No accessorial charges.
We are available for the requested pickup date.

Amazon Freight Team`
};

const MOCK_APPROVAL = {
  subject: 'Re: Freight Quote FQ-1743610234000 — $970',
  body: `Looks great, we approve. Please go ahead and confirm the booking.

Thanks,
Sarah`
};

// ── Run the test ─────────────────────────────────────────────
async function runTest() {
  console.log('\n========================================');
  console.log('  AMZ Prep Freight Agent — Full Test');
  console.log('========================================\n');

  try {
    // STEP 1: Extract freight fields from RFQ
    console.log('📧 STEP 1: Extracting freight fields from RFQ email...');
    const fields = await extractFreightFields(
      MOCK_RFQ_EMAIL.subject,
      MOCK_RFQ_EMAIL.from,
      MOCK_RFQ_EMAIL.body
    );
    console.log('✅ Extracted:\n', JSON.stringify(fields, null, 2));

    // STEP 2: Parse carrier rate response
    console.log('\n📦 STEP 2: Parsing carrier rate response...');
    const rate = await parseCarrierRate(
      MOCK_CARRIER_RESPONSE.subject,
      MOCK_CARRIER_RESPONSE.from,
      MOCK_CARRIER_RESPONSE.body
    );
    console.log('✅ Parsed rate:\n', JSON.stringify(rate, null, 2));

    // STEP 3: Apply markup and calculate sell rate
    console.log('\n💰 STEP 3: Applying markup (15%)...');
    const markup = applyMarkup(rate.total_rate, 0.15);
    console.log(`✅ Cost: $${rate.total_rate} → Sell: $${markup.sellRate} | Margin: $${markup.grossProfitUsd} (${markup.grossProfitPct}%)`);

    // STEP 4: Generate customer quote email
    console.log('\n✉️  STEP 4: Generating customer quote email...');
    const quoteEmail = await generateQuoteEmail({
      quoteId: 'FQ-1743610234000',
      origin: fields.origin,
      destination: fields.destination,
      sellRate: markup.sellRate,
      transitDays: rate.transit_days,
      pickupDate: fields.required_pickup_date,
      expiryHours: 4
    });
    console.log('✅ Generated email:\n');
    console.log('---');
    console.log(quoteEmail);
    console.log('---');

    // STEP 5: Classify customer approval
    console.log('\n🔀 STEP 5: Classifying customer response...');
    const approval = await classifyCustomerResponse(
      MOCK_APPROVAL.subject,
      MOCK_APPROVAL.body
    );
    console.log('✅ Classification:\n', JSON.stringify(approval, null, 2));

    // Summary
    console.log('\n========================================');
    console.log('  TEST COMPLETE ✅');
    console.log('========================================');
    console.log(`  Quote:    FQ-1743610234000`);
    console.log(`  Route:    ${fields.origin} → ${fields.destination}`);
    console.log(`  Cost:     $${rate.total_rate}`);
    console.log(`  Sell:     $${markup.sellRate}`);
    console.log(`  Margin:   $${markup.grossProfitUsd} (${markup.grossProfitPct}%)`);
    console.log(`  Outcome:  ${approval.classification}`);
    console.log('========================================\n');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    if (err.message.includes('API key')) {
      console.error('   → Check ANTHROPIC_API_KEY in your .env file');
    }
    process.exit(1);
  }
}

runTest();
