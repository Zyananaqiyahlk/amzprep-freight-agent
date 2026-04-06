const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

async function getSheets() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Append a new freight quote record to the pipeline tab
 */
async function logFreightRecord(record) {
  const sheets = await getSheets();
  const row = [
    record.quote_id,
    record.status,
    record.customer_name,
    record.customer_email,
    record.origin,
    record.destination,
    record.weight_lbs,
    record.dimensions,
    record.freight_class || '',
    record.hazmat ? 'YES' : 'NO',
    record.pickup_date || '',
    record.markup_pct,
    record.intake_time,
    record.bid_deadline,
    '', '', '', '', '', // winning_carrier, carrier_rate, sell_rate, margin$, margin%
    '', '', ''          // approval_time, lost_reason, competitor_rate
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Freight Pipeline!A:V',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] }
  });

  console.log(`[Sheets] Logged freight record: ${record.quote_id}`);
}

/**
 * Log a carrier rate response to the Rate Responses tab
 */
async function logCarrierRate(rateData) {
  const sheets = await getSheets();
  const row = [
    rateData.quote_id,
    rateData.carrier_name,
    rateData.round || 1,
    rateData.rate_usd,
    rateData.transit_days,
    rateData.accessorial_charges || 0,
    rateData.total_rate,
    rateData.availability_confirmed ? 'YES' : 'NO',
    new Date().toISOString(),
    rateData.notes || ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Rate Responses!A:J',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] }
  });

  console.log(`[Sheets] Logged rate: ${rateData.carrier_name} @ $${rateData.total_rate} for ${rateData.quote_id}`);
}

/**
 * Get all rate responses for a specific quote ID
 */
async function getRatesForQuote(quoteId) {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Rate Responses!A:J'
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return [];

  const headers = ['quote_id', 'carrier_name', 'round', 'rate_usd', 'transit_days', 'accessorial_charges', 'total_rate', 'availability_confirmed', 'timestamp', 'notes'];

  return rows.slice(1)
    .filter(row => row[0] === quoteId)
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

/**
 * Update a freight pipeline record status and fields
 */
async function updateFreightRecord(quoteId, updates) {
  const sheets = await getSheets();

  // Find the row with this quote_id
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Freight Pipeline!A:A'
  });

  const rows = response.data.values || [];
  const rowIndex = rows.findIndex(row => row[0] === quoteId);

  if (rowIndex === -1) {
    console.error(`[Sheets] Quote not found: ${quoteId}`);
    return;
  }

  // Column map: A=1, B=2 etc (1-indexed for Sheets API)
  const colMap = {
    status: 'B',
    winning_carrier: 'O',
    carrier_rate: 'P',
    sell_rate: 'Q',
    gross_profit_usd: 'R',
    gross_profit_pct: 'S',
    approval_time: 'T',
    lost_reason: 'U',
    competitor_rate: 'V'
  };

  const sheetRow = rowIndex + 1;

  for (const [field, value] of Object.entries(updates)) {
    if (!colMap[field]) continue;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Freight Pipeline!${colMap[field]}${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[value]] }
    });
  }

  console.log(`[Sheets] Updated ${quoteId}: ${JSON.stringify(updates)}`);
}

module.exports = { logFreightRecord, logCarrierRate, getRatesForQuote, updateFreightRecord };
