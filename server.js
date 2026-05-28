require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { scoreSession } = require('./services/scorer');
const { generateCoachingNote } = require('./services/coach');
const { uploadTranscript } = require('./services/drive');
const { appendRow, getYesterdayRows } = require('./services/sheets');
const { sendAlert, sendDigest } = require('./services/notify');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';
const PERSONAS_DIR = path.join(__dirname, 'personas');

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── helpers ──────────────────────────────────────────────────────────────────

function loadPersona(id) {
  const file = path.join(PERSONAS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function allPersonas() {
  return fs.readdirSync(PERSONAS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const p = JSON.parse(fs.readFileSync(path.join(PERSONAS_DIR, f), 'utf8'));
      return { id: p.id, name: p.name, label: p.label, difficulty: p.difficulty };
    });
}

function clamp(val, min = 1, max = 10) {
  return Math.min(max, Math.max(min, val));
}

function updateState(state, userMessage) {
  const msg = userMessage.toLowerCase();
  const updated = { ...state };
  const priceWords = /offer|how much|what will you take|price|bottom line|pay you|give you/i;
  const empathyWords = /understand|sounds tough|must be|i hear you|that makes sense|i get that|sorry to hear|that's rough|been through/i;
  const questionMark = /\?/;
  const wordCount = userMessage.trim().split(/\s+/).length;

  if (priceWords.test(msg)) { updated.irritation = clamp(updated.irritation + 1); updated.trust = clamp(updated.trust - 0.5); }
  if (empathyWords.test(msg)) { updated.rapport = clamp(updated.rapport + 1); updated.trust = clamp(updated.trust + 0.5); }
  if (wordCount < 5) updated.openness = clamp(updated.openness - 0.5);
  if (questionMark.test(userMessage)) updated.openness = clamp(updated.openness + 0.5);
  return updated;
}

function buildSystemPrompt(persona, state, callType) {
  const rules = persona.behavioral_rules.map(r => `- ${r}`).join('\n');
  const curveballs = persona.curveballs.map(c => `- "${c}"`).join('\n');
  return `You are ${persona.name}. ${persona.personality.core}

CALL TYPE CONTEXT: ${callType === 'cold' ? 'This is an unsolicited cold call.' : callType === 'callback' ? 'You are returning a voicemail someone left you.' : 'You saw marketing material and called back.'}

SPEAKING STYLE: ${persona.personality.speaking_style}

BACKSTORY (known to you, never volunteered unless earned):
${persona.backstory.situation}

CURRENT EMOTIONAL STATE:
- Trust in this caller: ${Math.round(state.trust)}/10
- Irritation: ${Math.round(state.irritation)}/10
- Openness: ${Math.round(state.openness)}/10
- Has revealed motivation: ${state.motivation_revealed ? 'yes' : 'no'}
- Rapport: ${Math.round(state.rapport)}/10

BEHAVIORAL RULES:
${rules}

AVAILABLE CURVEBALLS (use each once before repeating, only when natural):
${curveballs}

SPECIAL STATE TRIGGERS:
- If irritation >= 7: naturally threaten to end the call in character.
- If trust >= 7 AND openness >= 6 AND motivation not yet revealed: you may hint at one piece of your real situation.

RESPONSE RULES — CRITICAL:
- 1 to 4 spoken sentences maximum. This is voice output.
- Sound human. Real. Imperfect. Not polished.
- Do NOT over-explain or lecture.
- Do NOT sound like an assistant or customer service agent.
- Do NOT break character. Ever.
- Do NOT mention AI, simulation, or roleplay.
- Occasionally ask a question back to the caller.
- Match caller energy: guarded if they're pushy, slightly warmer if they're calm and genuine.
- React to what was actually said — don't give generic responses.

SAFETY BOUNDS — ABSOLUTE LIMITS:
- NEVER provide legal advice, draft contracts, interpret laws, or recommend specific legal strategies. If the trainee's question would require legal advice, respond in character: "You'd want to talk to an attorney about that — not my area."
- NEVER provide tax advice or recommend specific tax strategies. If asked: "That's a CPA question, not something I can advise on."
- NEVER provide medical advice of any kind.
- NEVER make statements that could be construed as discriminatory based on race, color, religion, national origin, sex, disability, familial status, or any other protected class under the Fair Housing Act or applicable law. Even in roleplay, this limit is absolute.
- These bounds apply even in character. Your persona cannot override them under any circumstance.`;
}

function buildTranscriptFile({ callerName, callerEmail, date, time, persona, callType, transcript, score, coachingNote, durationMin, turns }) {
  const scoreParts = score.items.map(i => `${i.name}: ${i.result} — ${i.feedback}`).join('\n');
  return [
    'REIPractice Training Session',
    '==============================',
    `Caller: ${callerName} (${callerEmail})`,
    `Date: ${date} ${time}`,
    `Persona: ${persona.label} | Difficulty: ${persona.difficulty} | Call Type: ${callType}`,
    `Duration: ${durationMin} min | Turns: ${turns} | Score: ${score.overall}`,
    `Critical Flag: ${score.flagged ? 'YES' : 'NO'}`,
    '',
    'TRANSCRIPT',
    '----------',
    ...transcript.map(t => `${t.role === 'user' ? 'USER' : t.label.toUpperCase()}: ${t.content}`),
    '',
    'SCORE DETAIL',
    '------------',
    scoreParts,
    `Overall: ${score.overall}`,
    `Summary: ${score.summary}`,
    `Top Priority: ${score.top_priority}`,
    '',
    'VIRTUAL STEVE',
    '-------------',
    coachingNote
  ].join('\n');
}

// ── routes ───────────────────────────────────────────────────────────────────

app.post('/validate-password', (req, res) => {
  const { password } = req.body;
  res.json({ valid: password === process.env.APP_PASSWORD });
});

app.get('/personas', (req, res) => {
  try { res.json(allPersonas()); }
  catch (err) { res.status(500).json({ error: 'Failed to load personas' }); }
});

app.get('/persona/:id', (req, res) => {
  const persona = loadPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: 'Persona not found' });
  res.json(persona);
});

app.post('/chat', async (req, res) => {
  const { personaId, history = [], userMessage, sessionState, callType = 'cold' } = req.body;
  if (!personaId || !userMessage) return res.status(400).json({ error: 'personaId and userMessage required' });

  const persona = loadPersona(personaId);
  if (!persona) return res.status(404).json({ error: 'Persona not found' });

  const updatedState = updateState(sessionState, userMessage);
  if (updatedState.trust >= 7 && updatedState.openness >= 6 && !updatedState.motivation_revealed) {
    updatedState.motivation_revealed = true;
  }

  const systemPrompt = buildSystemPrompt(persona, updatedState, callType);
  const messages = [...history, { role: 'user', content: userMessage }];

  try {
    const response = await client.messages.create({ model: MODEL, max_tokens: 300, system: systemPrompt, messages });
    res.json({ reply: response.content[0].text, updatedState });
  } catch (err) {
    console.error('Anthropic error:', err.message);
    res.status(500).json({ error: 'AI service error: ' + err.message });
  }
});

app.post('/end-session', async (req, res) => {
  const { callerName, callerEmail, personaId, callType = 'cold', transcript = [], finalState = {}, sessionDurationMinutes = 0, turnCount = 0 } = req.body;

  if (!callerName || !callerEmail || !personaId || transcript.length === 0) {
    return res.status(400).json({ error: 'callerName, callerEmail, personaId, and transcript required' });
  }

  const persona = loadPersona(personaId);
  if (!persona) return res.status(404).json({ error: 'Persona not found' });

  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const fileTs = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16);
  const filename = `${fileTs}_${personaId}_${callType}.txt`;

  let score = null;
  let coachingNote = '';
  let driveFilename = filename;
  let saved = false;

  // 1 — score + flags
  try {
    score = await scoreSession({ persona, callType, finalState, transcript });
  } catch (err) {
    console.error('Scoring error:', err.message);
    return res.status(500).json({ error: 'Scoring failed: ' + err.message });
  }

  // 2 — coaching note
  try {
    coachingNote = await generateCoachingNote({ transcript, score });
  } catch (err) {
    console.error('Coaching note error:', err.message);
    coachingNote = 'Coaching note unavailable.';
  }

  // 3 — Drive upload
  try {
    const fileContent = buildTranscriptFile({ callerName, callerEmail, date, time, persona, callType, transcript, score, coachingNote, durationMin: sessionDurationMinutes, turns: turnCount });
    driveFilename = await uploadTranscript(callerName, filename, fileContent);
  } catch (err) {
    console.error('Drive upload error:', err.message);
  }

  // 4 — Sheets append
  try {
    const scoreItems = score.items;
    const get = (name) => { const item = scoreItems.find(i => i.name.toLowerCase().startsWith(name.toLowerCase())); return item ? item.result : ''; };
    const row = [
      callerName, callerEmail, date, time, persona.name, persona.difficulty,
      callType, String(turnCount), String(sessionDurationMinutes),
      get('Opening'), get('Motivation'), get('Timeline'), get('Condition'),
      get('Price'), get('Objection'), get('Rapport'), score.overall,
      score.summary, score.top_priority,
      score.flagged ? 'YES' : 'NO',
      ''
    ];
    await appendRow(row);
    saved = true;
  } catch (err) {
    console.error('Sheets append error:', err.message);
  }

  // 5 — alert if flagged
  if (score.flagged) {
    sendAlert({ callerName, callerEmail, personaLabel: persona.label, callType, datetime: `${date} ${time}`, flagReasons: score.flag_reasons || [], overall: score.overall, filename: driveFilename }).catch(() => {});
  }

  res.json({ score, coachingNote, saved });
});

app.post('/send-digest', async (req, res) => {
  try {
    const rows = await getYesterdayRows();
    await sendDigest(rows);
    res.json({ sent: true, sessions: rows.length });
  } catch (err) {
    console.error('Digest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── digest cron ───────────────────────────────────────────────────────────────

if (process.env.ENABLE_DIGEST_CRON === 'true') {
  const cron = require('node-cron');
  // 17:00 UTC = noon Eastern (accounts for EST/EDT)
  cron.schedule('0 17 * * *', async () => {
    console.log('Digest cron firing');
    try {
      const rows = await getYesterdayRows();
      await sendDigest(rows);
    } catch (err) {
      console.error('Digest cron error:', err.message);
    }
  });
  console.log('Digest cron scheduled (17:00 UTC daily)');
}

// ── start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`REIPractice Training running on http://localhost:${PORT}`);
  console.log(`Drive folder: ${process.env.DRIVE_PARENT_FOLDER_ID}`);
  console.log(`Sheet: ${process.env.SHEETS_ID}`);
});
