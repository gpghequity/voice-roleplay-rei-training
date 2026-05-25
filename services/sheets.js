const { getAccessToken } = require('./auth');

async function appendRow(values) {
  const token = await getAccessToken();
  const id = process.env.SHEETS_ID;
  const range = encodeURIComponent('Sheet1!A:U');

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] })
    }
  );

  const result = await res.json();
  if (result.error) throw new Error('Sheets append failed: ' + JSON.stringify(result.error));
  return result;
}

async function getYesterdayRows() {
  const token = await getAccessToken();
  const id = process.env.SHEETS_ID;
  const range = encodeURIComponent('Sheet1!A:U');

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const data = await res.json();
  if (data.error) throw new Error('Sheets read failed: ' + JSON.stringify(data.error));

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  const rows = data.values || [];
  return rows.slice(1).filter(row => row[2] === yDate);
}

module.exports = { appendRow, getYesterdayRows };
