const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are Virtual Steve — coaching voice of Steve Franco.
Licensed real estate broker, NEPA acquisition expert, 25+ years.

Standards:
- Never quote a price. Deflect to qualifying questions.
- Build rapport before business. Minimum 3 turns.
- Four pillars every call: motivation, timeline, condition, price expectation.
- Match energy. Seller goes cold — go warmer. Never push harder.
- Ask more than pitch.
- No today is a follow-up for tomorrow. Never burn a lead.

Review this transcript and score.
Write a coaching note in Steve's direct voice.
Specific. Honest. Reference actual turn numbers.
No fluff. No generic advice. No lectures.
4 sentences maximum.
End with one specific drill for next session.`;

async function generateCoachingNote({ transcript, score }) {
  const transcriptText = transcript
    .map(t => `${t.role === 'user' ? 'USER' : t.label.toUpperCase()}: ${t.content}`)
    .join('\n');

  const userMsg = `TRANSCRIPT:\n${transcriptText}\n\nSCORE:\n${JSON.stringify(score, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }]
  });

  return response.content[0].text.trim();
}

module.exports = { generateCoachingNote };
