const { google } = require('googleapis');
const { makeAuth } = require('./auth');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function sheetsClient() {
  return google.sheets({ version: 'v4', auth: makeAuth([SHEETS_SCOPE]) });
}

async function appendRow(values) {
  const sheets = sheetsClient();
  const id = process.env.SHEETS_ID;

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: 'Sheet1!A:U',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });

  if (res.data.updates) return res.data.updates;
  throw new Error('Sheets append returned no updates');
}

async function getYesterdayRows() {
  const sheets = sheetsClient();
  const id = process.env.SHEETS_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Sheet1!A:U'
  });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  const rows = res.data.values || [];
  return rows.slice(1).filter(row => row[2] === yDate);
}

module.exports = { appendRow, getYesterdayRows };
