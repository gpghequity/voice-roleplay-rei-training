'use strict';
/**
 * Auth middleware — AUTH_ENABLED guard + crypto.timingSafeEqual
 *
 * AUTH_ENABLED not set or !== 'true'  →  pass-through (testing mode)
 * AUTH_ENABLED=true                   →  enforce Basic Auth — three tiers:
 *
 *   Public:  process.env.PUBLIC_USERNAME  / process.env.PUBLIC_PASSWORD
 *   Team:    process.env.TEAM_USERNAME    / process.env.TEAM_PASSWORD
 *   Steve:   process.env.STEVE_USERNAME   / process.env.STEVE_PASSWORD
 *
 * Set all six vars in Railway at launch. AUTH_ENABLED stays false until Steve says go.
 */
const crypto = require('crypto');
const { google } = require('googleapis');

function safeCompare(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) {
      crypto.timingSafeEqual(ba, ba); // constant-time even on length mismatch
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function parseBasicAuth(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  try {
    const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = dec.indexOf(':');
    if (i < 0) return null;
    return { user: dec.slice(0, i), pass: dec.slice(i + 1) };
  } catch {
    return null;
  }
}

function requireOperator(req, res, next) {
  if (process.env.AUTH_ENABLED !== 'true') return next();

  const publicUser = process.env.PUBLIC_USERNAME || '';
  const publicPwd  = process.env.PUBLIC_PASSWORD || '';
  const teamUser   = process.env.TEAM_USERNAME   || '';
  const teamPwd    = process.env.TEAM_PASSWORD   || '';
  const steveUser  = process.env.STEVE_USERNAME  || '';
  const stevePwd   = process.env.STEVE_PASSWORD  || '';

  const creds = parseBasicAuth(req);

  if (creds) {
    const isPublic = publicUser && publicPwd && safeCompare(creds.user, publicUser) && safeCompare(creds.pass, publicPwd);
    const isTeam   = teamUser   && teamPwd   && safeCompare(creds.user, teamUser)   && safeCompare(creds.pass, teamPwd);
    const isSteve  = steveUser  && stevePwd  && safeCompare(creds.user, steveUser)  && safeCompare(creds.pass, stevePwd);
    if (isPublic || isTeam || isSteve) return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="PwP Platform"');
  return res.status(401).type('application/json').json({ ok: false, error: 'Unauthorized.' });
}

function requireSharedKey(req, res, next) {
  if (process.env.AUTH_ENABLED !== 'true') return next();
  const key = process.env.SHARED_KEY || '';
  if (!key) return res.status(503).json({ ok: false, error: 'Shared key not configured.' });
  const provided = req.headers['x-shared-key'] || '';
  if (!provided || !safeCompare(provided, key)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }
  return next();
}

function requireWebhookKey(req, res, next) {
  if (process.env.AUTH_ENABLED !== 'true') return next();
  const key = process.env.WEBHOOK_KEY || '';
  if (!key) return next(); // webhook key is optional
  const provided = req.headers['x-webhook-key'] || '';
  if (!provided || !safeCompare(provided, key)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }
  return next();
}

// makeAuth — returns a googleapis JWT auth client for Drive/Sheets/Gmail DWD calls.
// scopes: string[] of Google OAuth scope URLs
// impersonateUser: optional email to impersonate (for DWD gmail.send etc.)
function makeAuth(scopes, impersonateUser) {
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  } catch {
    credentials = {};
  }
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: scopes || [],
    subject: impersonateUser || undefined
  });
}

module.exports = { requireOperator, requireSharedKey, requireWebhookKey, makeAuth };
