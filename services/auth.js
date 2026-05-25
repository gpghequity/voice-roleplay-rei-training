const { google } = require('googleapis');

function makeAuth(scopes, subject) {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    scopes,
    subject || process.env.IMPERSONATE_USER || null
  );
}

module.exports = { makeAuth };
