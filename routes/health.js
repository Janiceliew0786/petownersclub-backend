const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// ── RULE-BASED SYMPTOM ENGINE ─────────────────────────────────
// Maps symptom keywords to advice and severity
const symptomRules = [
  {
    keywords: ['vomit', 'vomiting', 'throw up', 'nausea'],
    advice: 'Vomiting can be caused by dietary indiscretion, infections, or more serious conditions. Withhold food for 12 hours but ensure fresh water is available. If vomiting persists more than 24 hours or contains blood, visit a veterinarian immediately.',
    severity: 'Medium',
  },
  {
    keywords: ['diarrhea', 'loose stool', 'watery stool', 'runny'],
    advice: 'Mild diarrhea may resolve on its own with a bland diet (boiled chicken and rice). Ensure hydration. If diarrhea contains blood, lasts more than 48 hours, or is accompanied by lethargy, seek veterinary care.',
    severity: 'Medium',
  },
  {
    keywords: ['not eating', 'loss of appetite', 'refuse food', 'no appetite'],
    advice: 'Loss of appetite lasting more than 24 hours warrants attention. Try offering a different food or warming it slightly. If accompanied by lethargy or vomiting, consult a veterinarian as it may indicate illness or dental pain.',
    severity: 'Medium',
  },
  {
    keywords: ['scratch', 'itching', 'itchy', 'licking paws', 'skin'],
    advice: 'Excessive scratching or licking may indicate allergies, parasites (fleas/mites), or skin infections. Check the skin for redness, rashes, or parasites. Consider an antiparasitic treatment and consult a vet if symptoms persist.',
    severity: 'Low',
  },
  {
    keywords: ['limp', 'limping', 'leg pain', 'cannot walk', 'joint'],
    advice: 'Limping may be caused by injury, arthritis, or paw irritation. Check the paw for cuts, splinters, or swelling. Rest the animal and avoid strenuous activity. If limping persists beyond 24 hours or the animal refuses to bear weight, seek veterinary care.',
    severity: 'Medium',
  },
  {
    keywords: ['cough', 'coughing', 'sneezing', 'runny nose', 'nasal'],
    advice: 'Occasional coughing or sneezing may be due to minor irritants. Persistent coughing may indicate kennel cough, respiratory infection, or heart disease. Ensure vaccinations are up to date. Consult a vet if symptoms last more than 3 days.',
    severity: 'Medium',
  },
  {
    keywords: ['seizure', 'convulsion', 'shaking', 'trembling', 'collapse'],
    advice: 'Seizures or collapse are medical emergencies. Keep the animal calm and away from hazards during a seizure. Do not restrain. Note the duration and seek emergency veterinary care immediately after the episode ends.',
    severity: 'High',
  },
  {
    keywords: ['blood', 'bleeding', 'wound', 'cut', 'injury'],
    advice: 'Apply gentle pressure to any external wound with a clean cloth. For minor cuts, clean with saline solution. Deep wounds, punctures, or uncontrolled bleeding require immediate veterinary attention. Do not apply tourniquet unless trained to do so.',
    severity: 'High',
  },
  {
    keywords: ['lethargy', 'tired', 'weak', 'no energy', 'lazy'],
    advice: 'Sudden lethargy or weakness can indicate many conditions including infection, pain, or organ issues. Monitor for 12-24 hours. If accompanied by other symptoms such as vomiting, pale gums, or difficulty breathing, seek veterinary care promptly.',
    severity: 'Medium',
  },
  {
    keywords: ['drinking', 'thirst', 'urination', 'excessive water'],
    advice: 'Excessive thirst and urination may indicate diabetes, kidney disease, or hormonal disorders. Note the frequency and amount. This warrants a veterinary consultation and blood/urine tests to rule out underlying conditions.',
    severity: 'Medium',
  },
  {
    keywords: ['eye', 'discharge', 'cloudy', 'red eye', 'squinting'],
    advice: 'Eye discharge or redness may indicate conjunctivitis, injury, or infection. Clean gently with a damp cloth. Avoid home eye drops unless prescribed. Cloudy eyes or squinting warrant prompt veterinary attention to prevent vision damage.',
    severity: 'Low',
  },
  {
    keywords: ['breath', 'bad smell', 'dental', 'teeth', 'mouth'],
    advice: 'Bad breath is often a sign of dental disease, which is common in pets. Regular tooth brushing and dental chews can help. A professional dental cleaning by a veterinarian may be necessary for advanced cases.',
    severity: 'Low',
  },
];

function analyseSymptoms(text) {
  const lower = text.toLowerCase();
  const matches = symptomRules.filter(rule =>
    rule.keywords.some(kw => lower.includes(kw))
  );

  if (matches.length === 0) {
    return {
      advice: 'No specific condition was identified from the symptoms described. Monitor your pet closely. If symptoms worsen, persist for more than 24 hours, or you are concerned, consult a veterinarian for a professional examination.',
      severity: 'Low',
    };
  }

  // Return highest severity match
  const high   = matches.find(m => m.severity === 'High');
  const medium = matches.find(m => m.severity === 'Medium');
  const result = high || medium || matches[0];

  // Combine advice if multiple matches
  const allAdvice = matches.map(m => m.advice).join('\n\n');
  return { advice: allAdvice, severity: result.severity };
}

// ── CHECK SYMPTOMS ────────────────────────────────────────────
router.post('/symptoms', (req, res) => {
  const { petID, symptoms } = req.body;
  const userID = req.user.userID;

  if (!petID || !symptoms) {
    return res.status(400).json({ message: 'Pet ID and symptoms are required.' });
  }

  const { advice, severity } = analyseSymptoms(symptoms);

  const sql = 'INSERT INTO SymptomChecks (PetID, UserID, Symptoms, Advice, Severity) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [petID, userID, symptoms, advice, severity], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    return res.status(200).json({ advice, severity, checkID: result.insertId });
  });
});

// ── GET SYMPTOM HISTORY FOR PET ───────────────────────────────
router.get('/symptoms/:petID', (req, res) => {
  const { petID } = req.params;

  const sql = 'SELECT * FROM SymptomChecks WHERE PetID = ? ORDER BY CheckedAt DESC';
  db.query(sql, [petID], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    return res.status(200).json({ history: results });
  });
});

// ── ADD HEALTH RECORD / REMINDER ─────────────────────────────
router.post('/records', (req, res) => {
  const { petID, date, reminderType, notes, nextDueDate } = req.body;

  if (!petID || !date || !reminderType) {
    return res.status(400).json({ message: 'Pet ID, date and reminder type are required.' });
  }

  const sql = 'INSERT INTO HealthRecords (PetID, Date, ReminderType, Notes, NextDueDate) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [petID, date, reminderType, notes || null, nextDueDate || null], (err, result) => {
    if (err) return res.status(500).json({ message: 'Could not save record.', error: err.message });
    return res.status(201).json({ message: 'Health record saved.', recordID: result.insertId });
  });
});

// ── GET HEALTH RECORDS FOR PET ────────────────────────────────
router.get('/records/:petID', (req, res) => {
  const { petID } = req.params;

  const sql = 'SELECT * FROM HealthRecords WHERE PetID = ? ORDER BY Date DESC';
  db.query(sql, [petID], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    return res.status(200).json({ records: results });
  });
});

// ── DELETE HEALTH RECORD ──────────────────────────────────────
router.delete('/records/:id', (req, res) => {
  const { id } = req.params;

  const sql = 'DELETE FROM HealthRecords WHERE RecordID = ?';
  db.query(sql, [id], (err) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    return res.status(200).json({ message: 'Record deleted.' });
  });
});

module.exports = router;
