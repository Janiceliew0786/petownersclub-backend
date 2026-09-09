const express = require('express');
const router  = express.Router();
const db      = require('../db');
const verifyToken   = require('../middleware/auth');
const requireAdmin  = require('../middleware/requireAdmin');
const { checkAndSendHealthReminders } = require('../jobs/healthReminders');

// GET all veterinarian accounts awaiting verification.
router.get('/pending-vets', verifyToken, requireAdmin, (req, res) => {
  const sql = `SELECT UserID, Name, Email, ContactNumber, LicenseNumber, LicensePhotoBase64, LicensePhotosJSON, CreatedAt
               FROM Users
               WHERE Role = 'Veterinarian' AND VerificationStatus = 'Pending'
               ORDER BY CreatedAt ASC`;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    return res.status(200).json({ pendingVets: results });
  });
});

// Approve a vet — sets VerificationStatus to 'Verified'.
router.put('/verify-vet/:userID', verifyToken, requireAdmin, (req, res) => {
  const { userID } = req.params;
  const sql = `UPDATE Users SET VerificationStatus = 'Verified'
               WHERE UserID = ? AND Role = 'Veterinarian'`;
  db.query(sql, [userID], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Veterinarian account not found.' });
    }
    return res.status(200).json({ message: 'Veterinarian verified.' });
  });
});

// Reject a vet — sets VerificationStatus to 'Rejected'. They keep their
// account and can still use the app as a regular Owner-equivalent, they
// just won't get the vet badge.
router.put('/reject-vet/:userID', verifyToken, requireAdmin, (req, res) => {
  const { userID } = req.params;
  const sql = `UPDATE Users SET VerificationStatus = 'Rejected'
               WHERE UserID = ? AND Role = 'Veterinarian'`;
  db.query(sql, [userID], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Veterinarian account not found.' });
    }
    return res.status(200).json({ message: 'Veterinarian rejected.' });
  });
});

// ── USER MANAGEMENT ─────────────────────────────────────────────

// GET all users, with optional search (name/email) and role filter.
router.get('/users', verifyToken, requireAdmin, (req, res) => {
  const { search, role } = req.query;
  let sql = `SELECT UserID, Name, Email, Role, ContactNumber, IsActive, VerificationStatus, CreatedAt,
             (SELECT COUNT(*) FROM HelpfulMarks h JOIN PostComments c ON h.CommentID = c.CommentID
              WHERE c.UserID = Users.UserID) AS HelpfulCount
             FROM Users WHERE 1=1`;
  const params = [];

  if (search) {
    sql += ' AND (Name LIKE ? OR Email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (role && role !== 'All') {
    sql += ' AND Role = ?';
    params.push(role);
  }
  sql += ' ORDER BY CreatedAt DESC';

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    return res.status(200).json({ users: results });
  });
});

// Deactivate a user — they can no longer log in, but their data (pets,
// posts, etc.) is preserved. Admins can't deactivate themselves or other
// admins through this route, to avoid accidentally locking everyone out.
router.put('/users/:userID/deactivate', verifyToken, requireAdmin, (req, res) => {
  const { userID } = req.params;
  if (Number(userID) === req.user.userID) {
    return res.status(400).json({ message: 'You cannot deactivate your own account.' });
  }
  db.query(
    `UPDATE Users SET IsActive = 0 WHERE UserID = ? AND Role != 'Admin'`,
    [userID],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'User not found, or is an Admin account (cannot be deactivated here).' });
      }
      return res.status(200).json({ message: 'User deactivated.' });
    }
  );
});

// Reactivate a previously deactivated user.
router.put('/users/:userID/activate', verifyToken, requireAdmin, (req, res) => {
  const { userID } = req.params;
  db.query('UPDATE Users SET IsActive = 1 WHERE UserID = ?', [userID], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found.' });
    return res.status(200).json({ message: 'User reactivated.' });
  });
});

// Permanently delete a user account (and, via your FYP1 schema's cascade
// delete rules, all their pets/posts/etc.). More destructive than
// deactivating — kept as a separate, explicit action.
router.delete('/users/:userID', verifyToken, requireAdmin, (req, res) => {
  const { userID } = req.params;
  if (Number(userID) === req.user.userID) {
    return res.status(400).json({ message: 'You cannot delete your own account.' });
  }
  db.query(`DELETE FROM Users WHERE UserID = ? AND Role != 'Admin'`, [userID], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found, or is an Admin account (cannot be deleted here).' });
    }
    return res.status(200).json({ message: 'User deleted.' });
  });
});

// TEST-ONLY: manually trigger the health reminder check instead of waiting
// for the daily 8 AM schedule. Admin-only.
router.post('/trigger-health-reminders', verifyToken, requireAdmin, (req, res) => {
  checkAndSendHealthReminders();
  return res.status(200).json({ message: 'Health reminder check triggered. Check server logs for details.' });
});

module.exports = router;
