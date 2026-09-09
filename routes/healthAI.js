const express     = require('express');
const router      = express.Router();
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// Uses Gemini's free-tier API. Node 18+ has fetch built in, no extra
// dependency needed.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

const SYSTEM_PROMPT = `You are a friendly, knowledgeable veterinary assistant chatting with a pet owner inside a mobile app called "A Pet Owners Club". You are NOT a substitute for a real veterinarian and must never claim to give a definitive diagnosis.

Have a natural, conversational back-and-forth about their pet's symptoms or health concerns, the same way a helpful, cautious vet friend would text with them. Ask clarifying questions when they'd genuinely help (e.g. how long symptoms have lasted, the pet's age, other symptoms present) rather than always jumping straight to a verdict. Keep responses concise and easy to read on a mobile screen — a few short sentences or a short paragraph, not a long essay, unless the owner is asking for detail.

Always be cautious: if anything described sounds potentially serious or life-threatening (difficulty breathing, suspected poisoning, severe bleeding, collapse, seizures), clearly and directly recommend seeking in-person veterinary care immediately, without downplaying it. When uncertain, lean toward recommending a vet visit rather than reassuring the owner not to worry.`;

// Accepts the full conversation history and returns the AI's next reply,
// rather than a single one-shot structured analysis — lets the owner have
// an actual back-and-forth, asking follow-up questions the same way they
// would in a real chat.
router.post('/', async (req, res) => {
  const { species, messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: 'A messages array is required.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ message: 'AI chat is not configured on the server.' });
  }

  const speciesContext = species
    ? `${SYSTEM_PROMPT}\n\nThe pet in this conversation is a ${species}.`
    : SYSTEM_PROMPT;

  // Gemini's multi-turn format alternates user/model roles. The system
  // prompt is injected as the first "user" turn, with a short model
  // acknowledgement, so every real message after that is genuine
  // conversation history rather than instructions.
  const contents = [
    { role: 'user', parts: [{ text: speciesContext }] },
    { role: 'model', parts: [{ text: "Got it — I'm here to help think through what's going on with your pet. What's up?" }] },
    ...messages.map(m => ({
      role: (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  try {
    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.6 },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ message: 'AI chat is unavailable right now. Please try again shortly.' });
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!reply) {
      return res.status(502).json({ message: 'AI gave an empty response. Please try again.' });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('AI chat error:', err.message);
    return res.status(500).json({ message: 'Could not reach the AI service.', error: err.message });
  }
});

module.exports = router;
