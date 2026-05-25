const { google } = require('googleapis');

function makeAuth(scopes, subject) {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').replace(/^﻿/, '');
  const creds = JSON.parse(raw);
  return new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    scopes,
    subject || process.env.IMPERSONATE_USER || null
  );
}

module.exports = { makeAuth };
