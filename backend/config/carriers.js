/**
 * AMZ Prep — Carrier Configuration
 *
 * carrierRules: maps customer email → allowed carriers
 * markupRules:  maps customer email → markup percentage (0.15 = 15%)
 * carrierEmails: maps carrier name → email address
 */

const carrierRules = {
  // Default: all carriers eligible
  default: [
    'Amazon Freight',
    'UPS Freight',
    'FedEx Freight',
    'XPO Logistics',
    'Old Dominion',
    'Estes Express'
  ],

  // Customer-specific overrides
  // 'customer@example.com': ['Amazon Freight', 'UPS Freight'],
};

const markupRules = {
  default: 0.15,       // 15% — applied to all customers without explicit rule

  // Customer-specific markup
  // 'vip@client.com': 0.08,     // 8% for high-volume client
  // 'new@client.com': 0.25,     // 25% for new/small client
};

const carrierEmails = {
  'Amazon Freight':  process.env.CARRIER_EMAIL_AMAZON      || 'amazon-freight@placeholder.com',
  'UPS Freight':     process.env.CARRIER_EMAIL_UPS          || 'ups-freight@placeholder.com',
  'FedEx Freight':   process.env.CARRIER_EMAIL_FEDEX        || 'fedex-freight@placeholder.com',
  'XPO Logistics':   process.env.CARRIER_EMAIL_XPO          || 'xpo@placeholder.com',
  'Old Dominion':    process.env.CARRIER_EMAIL_OLD_DOMINION || 'odfl@placeholder.com',
  'Estes Express':   process.env.CARRIER_EMAIL_ESTES        || 'estes@placeholder.com',
};

/**
 * Get eligible carriers for a customer
 */
function getCarriersForCustomer(customerEmail) {
  return carrierRules[customerEmail] || carrierRules.default;
}

/**
 * Get markup rate for a customer
 */
function getMarkupForCustomer(customerEmail) {
  return markupRules[customerEmail] ?? markupRules.default;
}

/**
 * Get email address for a carrier
 */
function getCarrierEmail(carrierName) {
  return carrierEmails[carrierName] || null;
}

/**
 * Calculate sell rate and margin
 */
function applyMarkup(costRate, markupPct) {
  const sellRate = Math.ceil(costRate * (1 + markupPct));
  const grossProfitUsd = sellRate - costRate;
  const grossProfitPct = parseFloat(((grossProfitUsd / sellRate) * 100).toFixed(1));
  return { sellRate, grossProfitUsd, grossProfitPct };
}

module.exports = {
  getCarriersForCustomer,
  getMarkupForCustomer,
  getCarrierEmail,
  applyMarkup
};
