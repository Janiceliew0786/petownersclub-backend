const express     = require('express');
const router      = express.Router();
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// Uses Gemini's free-tier API. Node 18+ has fetch built in, no extra
// dependency needed.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

const SYSTEM_PROMPT = `You are a veterinary symptom-triage assistant inside a pet-care app called "A Pet Owners Club". You are NOT a substitute for a real veterinarian and must never claim to give a definitive diagnosis.

Given a pet's species and a description of its symptoms, respond with ONLY a JSON object (no markdown, no code fences, no extra text) in exactly this shape:
{
  "possibleCondition": "short plain-language guess at what might be going on",
  "severity": "Low" | "Medium" | "High",
  "explanation": "2-3 sentences explaining the reasoning in plain language a pet owner can understand",
  "recommendations": "concrete next steps the owner can take at home",
  "seekVetImmediately": true or false
}

Rules:
- If symptoms could indicate something life-threatening (difficulty breathing, suspected poisoning, severe bleeding, collapse, seizures), set severity to "High" and seekVetImmediately to true.
- Always be cautious — when uncertain, lean toward recommending a vet visit rather than downplaying symptoms.
- Keep language simple and reassuring, not alarming, while still being medically sensible.
- Respond with ONLY the JSON object, nothing else.`;

router.post('/', async (req, res) => {
  const { species, symptoms } = req.body;

  if (!symptoms || !symptoms.trim()) {
    return res.status(400).json({ message: 'Please describe the symptoms.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ message: 'AI analysis is not configured on the server.' });
  }

  const userPrompt = `Species: ${species || 'unknown'}\nSymptoms described by the owner: ${symptoms}`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.4 },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ message: 'AI analysis service is unavailable right now. Please try the rule-based checker instead.' });
    }

    const data = await response.json();
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Models sometimes wrap JSON in ```json ... ``` fences despite
    // instructions not to — strip that if present before parsing.
    rawText = rawText.replace(/```json\s*|```\s*/g, '').trim();

    let result;
    try {
      result = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('Could not parse Gemini response as JSON:', rawText);
      return res.status(502).json({ message: 'AI gave an unexpected response format. Please try again or use the rule-based checker.' });
    }

    return res.status(200).json({ result });
  } catch (err) {
    console.error('AI symptom check error:', err.message);
    return res.status(500).json({ message: 'Could not complete AI analysis.', error: err.message });
  }
});

module.exports = router;
