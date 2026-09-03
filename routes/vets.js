const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// GET all verified vets, sorted by how many helpful marks their comments
// have received (most helpful first) — a discoverability reward for vets
// who actively answer questions, not just for being credentialed.
router.get('/', (req, res) => {
  const sql = `
    SELECT u.UserID, u.Name, u.Email, u.ContactNumber, u.PhotoBase64,
      (SELECT COUNT(*) FROM HelpfulMarks h JOIN PostComments c ON h.CommentID = c.CommentID
       WHERE c.UserID = u.UserID) AS HelpfulCount
    FROM Users u
    WHERE u.Role = 'Veterinarian' AND u.VerificationStatus = 'Verified'
    ORDER BY HelpfulCount DESC, u.Name ASC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    return res.status(200).json({ vets: results });
  });
});

module.exports = router;
