const { getAccessToken } = require('./auth');

async function sendEmail(toAddresses, subject, body) {
  const token = await getAccessToken();
  const toLine = Array.isArray(toAddresses) ? toAddresses.join(', ') : toAddresses;
  const raw = [`To: ${toLine}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded })
  });

  const result = await res.json();
  if (result.error) throw new Error('Gmail send failed: ' + JSON.stringify(result.error));
  return result;
}

async function sendAlert({ callerName, callerEmail, personaLabel, callType, datetime, flagReasons, overall, filename }) {
  const alertTo = (process.env.ALERT_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.ALERT_PHONE_EMAIL) alertTo.push(process.env.ALERT_PHONE_EMAIL);
  if (!alertTo.length) { console.warn('ALERT_TO not set — skipping alert email'); return; }

  const subject = `⚠️ REIPractice ALERT — ${callerName} | ${personaLabel} | ${flagReasons.join(', ')}`;
  const body = [
    'Critical failure flagged in training session.',
    '',
    `Caller: ${callerName} (${callerEmail})`,
    `Persona: ${personaLabel} | Call Type: ${callType}`,
    `Date/Time: ${datetime}`,
    '',
    'Flag reasons:',
    ...flagReasons.map(r => `- ${r}`),
    '',
    `Score: ${overall}`,
    `Session file: ${filename}`,
    '',
    'Review recommended.'
  ].join('\n');

  try {
    await sendEmail(alertTo, subject, body);
    console.log('Alert email sent to:', alertTo.join(', '));
  } catch (err) {
    console.error('Alert email failed:', err.message);
  }
}

async function sendDigest(yesterdayRows) {
  const digestTo = (process.env.DIGEST_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!digestTo.length) { console.warn('DIGEST_TO not set — skipping digest'); return; }
  if (!yesterdayRows.length) { console.log('No sessions yesterday — digest skipped'); return; }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const lines = yesterdayRows.map(row => {
    const name = row[0] || '';
    const persona = row[4] || '';
    const callType = row[6] || '';
    const overall = row[16] || '';
    const flag = row[19] || '';
    return `${name} | ${persona} | ${callType} | ${overall} | Flag: ${flag}`;
  });

  const sheetsUrl = `https://docs.google.com/spreadsheets/d/${process.env.SHEETS_ID}`;
  const subject = `REIPractice Daily — ${dateStr} | ${yesterdayRows.length} session${yesterdayRows.length === 1 ? '' : 's'}`;
  const body = [
    'REIPractice Training — Daily Summary',
    `${dateStr} | ${yesterdayRows.length} session${yesterdayRows.length === 1 ? '' : 's'}`,
    '',
    ...lines,
    '',
    'Full log:',
    sheetsUrl
  ].join('\n');

  try {
    await sendEmail(digestTo, subject, body);
    console.log('Digest sent to:', digestTo.join(', '));
  } catch (err) {
    console.error('Digest email failed:', err.message);
  }
}

module.exports = { sendAlert, sendDigest };
