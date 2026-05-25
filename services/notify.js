const { google } = require('googleapis');
const { makeAuth } = require('./auth');

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function gmailClient() {
  return google.gmail({
    version: 'v1',
    auth: makeAuth([GMAIL_SCOPE], process.env.IMPERSONATE_USER)
  });
}

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail(toAddresses, subject, body) {
  const gmail = gmailClient();
  const toLine = Array.isArray(toAddresses) ? toAddresses.join(', ') : toAddresses;
  const raw = [`To: ${toLine}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: base64url(raw) }
  });

  if (!res.data.id) throw new Error('Gmail send returned no message id');
  return res.data;
}

async function sendAlert({ callerName, callerEmail, personaLabel, callType, datetime, flagReasons, overall, filename }) {
  const alertTo = (process.env.ALERT_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.ALERT_PHONE_EMAIL) alertTo.push(process.env.ALERT_PHONE_EMAIL);
  if (!alertTo.length) { console.warn('ALERT_TO not set — skipping alert email'); return; }

  const subject = `REIPractice ALERT — ${callerName} | ${personaLabel} | ${flagReasons.join(', ')}`;
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
