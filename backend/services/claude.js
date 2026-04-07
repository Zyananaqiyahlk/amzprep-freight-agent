const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

/**
 * Extract structured freight fields from a raw RFQ email
 */
async function extractFreightFields(emailSubject, emailFrom, emailBody) {
  const prompt = `Extract freight shipment details from this email and return ONLY valid JSON.

{
  "origin": "city, state",
  "destination": "city, state",
  "weight_lbs": number or null,
  "dimensions": "LxWxH inches or null",
  "freight_class": "string or null",
  "hazmat": boolean,
  "accessorials": ["list of special requirements"],
  "required_pickup_date": "YYYY-MM-DD or null",
  "customer_name": "string",
  "customer_email": "string",
  "special_notes": "string or null"
}

Email:
Subject: ${emailSubject}
From: ${emailFrom}
Body: ${emailBody}

Return ONLY the JSON object. No explanation. No markdown. No backticks.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

/**
 * Parse a carrier rate response email into structured data
 */
async function parseCarrierRate(emailSubject, emailFrom, emailBody) {
  const prompt = `Extract freight rate details from this carrier response email and return ONLY valid JSON.

{
  "quote_id": "extract the FQ-XXXXXXXXXX reference from the subject or body",
  "carrier_name": "sender company name",
  "rate_usd": number,
  "transit_days": number,
  "accessorial_charges": number or 0,
  "total_rate": number,
  "availability_confirmed": boolean,
  "notes": "any special conditions or null"
}

Email:
Subject: ${emailSubject}
From: ${emailFrom}
Body: ${emailBody}

Return ONLY the JSON. No explanation. No markdown. No backticks.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

/**
 * Generate a professional customer-facing quote email
 */
async function generateQuoteEmail({ quoteId, origin, destination, sellRate, transitDays, pickupDate, expiryHours = 4 }) {
  const expiry = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short'
  });

  const prompt = `Write a professional freight quote email. Return ONLY the email body — no subject line, no JSON, no markdown.

Details:
- Quote Reference: ${quoteId}
- Origin: ${origin}
- Destination: ${destination}
- Total Rate: $${sellRate}
- Transit Time: ${transitDays} business days
- Pickup Date: ${pickupDate || 'Flexible'}
- Quote valid until: ${expiry}

Tone requirements:
- Professional and confident
- Brief — 4-6 sentences maximum
- End with a clear call to action: reply APPROVED to confirm
- Do NOT mention carrier names, our cost, or markup percentage
- Sign off as "AMZ Prep Logistics Team"`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text.trim();
}

/**
 * Classify a customer's reply as APPROVED, REJECTED, NEGOTIATING, or UNCLEAR
 */
async function classifyCustomerResponse(emailSubject, emailBody) {
  const prompt = `Classify this customer email response to a freight quote. Return ONLY valid JSON.

{
  "classification": "APPROVED" | "REJECTED" | "NEGOTIATING" | "UNCLEAR",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "lost_reason": "price_too_high" | "used_competitor" | "shipment_cancelled" | "other" | null,
  "competitor_rate": number or null,
  "customer_notes": "any specific feedback or counter-offer from customer or null"
}

Email:
Subject: ${emailSubject}
Body: ${emailBody}

Classification rules:
- APPROVED: customer confirms, says yes, approved, go ahead, proceed, looks good
- REJECTED: customer declines, cancels, went with someone else, too expensive
- NEGOTIATING: customer wants a lower rate, asks questions, requests changes
- UNCLEAR: ambiguous response that needs human review

Return ONLY the JSON. No explanation. No markdown. No backticks.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

module.exports = {
  extractFreightFields,
  parseCarrierRate,
  generateQuoteEmail,
  classifyCustomerResponse
};
