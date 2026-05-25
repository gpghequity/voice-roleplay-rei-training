const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function scoreSession({ persona, callType, finalState, transcript }) {
  const transcriptText = transcript
    .map(t => `${t.role === 'user' ? 'USER' : t.label.toUpperCase()}: ${t.content}`)
    .join('\n');

  const prompt = `You are a real estate acquisition call coach scoring a training session.

PERSONA: ${persona.name} — ${persona.label}
CALL TYPE: ${callType}
FINAL STATE: trust=${finalState.trust} irritation=${finalState.irritation} openness=${finalState.openness} rapport=${finalState.rapport}
TRANSCRIPT:
${transcriptText}

H4H STANDARDS:
- Never quote a price. Deflect to qualifying questions when asked.
- Uncover four pillars: motivation, timeline, condition, price expectation.
- No price language before turn 3.
- When seller goes cold, adjust energy — never push harder.
- Ask more than pitch.

SCORE 7 ITEMS — pass/partial/fail + one sentence referencing a specific moment:
1. Opening quality
2. Motivation uncovered
3. Timeline uncovered
4. Condition uncovered
5. Price handling (N/A if seller never asked)
6. Objection/defensiveness recovery
7. Rapport built

CRITICAL FLAG CHECK — flag if any of these are true:
- USER quoted a dollar amount when seller asked what you'll pay
- finalState irritation >= 8
- Session ended in 3 turns or fewer
- USER said "how much" or "what will you pay" in turn 1 or 2

Return JSON only — no other text:
{
  "items": [
    { "name": "string", "result": "pass|partial|fail|N/A", "feedback": "string" }
  ],
  "overall": "X/7",
  "summary": "string",
  "top_priority": "string",
  "flagged": true,
  "flag_reasons": ["string"]
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1400,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content[0].text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in scoring response');
  return JSON.parse(match[0]);
}

module.exports = { scoreSession };
