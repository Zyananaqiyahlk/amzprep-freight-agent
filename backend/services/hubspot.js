const axios = require('axios');

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE_URL = 'https://api.hubapi.com';

const headers = () => ({
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
});

const PIPELINE_STAGES = {
  INTAKE: 'appointmentscheduled',
  OUT_TO_CARRIERS: 'qualifiedtobuy',
  FIRST_ROUND_RECEIVED: 'presentationscheduled',
  REBID_ROUND: 'decisionmakerboughtin',
  QUOTE_SENT: 'contractsent',
  AWAITING_APPROVAL: 'contractsent',
  APPROVED: 'closedwon',
  LOST: 'closedlost'
};

/**
 * Create a new HubSpot deal for an incoming freight quote
 */
async function createDeal(record) {
  const res = await axios.post(`${BASE_URL}/crm/v3/objects/deals`, {
    properties: {
      dealname: `${record.quote_id} — ${record.origin} → ${record.destination}`,
      dealstage: PIPELINE_STAGES.INTAKE,
      amount: 0,
      closedate: record.pickup_date || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      description: `Weight: ${record.weight_lbs} lbs | Hazmat: ${record.hazmat ? 'YES' : 'No'} | Customer: ${record.customer_email}`,
      quote_id: record.quote_id
    }
  }, { headers: headers() });

  console.log(`[HubSpot] Created deal: ${res.data.id} for ${record.quote_id}`);
  return res.data.id;
}

/**
 * Update a deal stage and properties
 */
async function updateDeal(dealId, stage, extraProps = {}) {
  if (!dealId) return;
  await axios.patch(`${BASE_URL}/crm/v3/objects/deals/${dealId}`, {
    properties: {
      dealstage: PIPELINE_STAGES[stage] || stage,
      ...extraProps
    }
  }, { headers: headers() });

  console.log(`[HubSpot] Updated deal ${dealId} → ${stage}`);
}

/**
 * Find a deal by quote_id custom property
 */
async function findDealByQuoteId(quoteId) {
  const res = await axios.post(`${BASE_URL}/crm/v3/objects/deals/search`, {
    filterGroups: [{
      filters: [{
        propertyName: 'quote_id',
        operator: 'EQ',
        value: quoteId
      }]
    }]
  }, { headers: headers() });

  return res.data.results?.[0]?.id || null;
}

module.exports = { createDeal, updateDeal, findDealByQuoteId };
