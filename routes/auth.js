const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db');
const verifyToken = require('../middleware/auth');
const { sendResetCodeEmail } = require('../utils/mailer');

// REGISTER
router.post('/register', (req, res) => {
  const { name, email, password, role, contactNumber } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }
  db.query('SELECT * FROM Users WHERE Email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (results.length > 0) return res.status(409).json({ message: 'Email already registered.' });
    const hashedPassword = bcrypt.hashSync(password, 10);
    const sql = 'INSERT INTO Users (Name, Email, Password, Role, ContactNumber) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [name, email, hashedPassword, role || 'Owner', contactNumber || null], (err, result) => {
      if (err) return res.status(500).json({ message: 'Could not register user.', error: err.message });
      return res.status(201).json({ message: 'Registration successful.', userID: result.insertId });
    });
  });
});

// LOGIN
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  db.query('SELECT * FROM Users WHERE Email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (results.length === 0) return res.status(401).json({ message: 'Invalid email or password.' });
    const user = results[0];
    if (!bcrypt.compareSync(password, user.Password)) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    const token = jwt.sign(
      { userID: user.UserID, role: user.Role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        userID:       user.UserID,
        name:         user.Name,
        email:        user.Email,
        role:         user.Role,
        photoBase64:  user.PhotoBase64 || null,
      },
    });
  });
});

// LOGOUT
router.post('/logout', (req, res) => {
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// FORGOT PASSWORD — generates a 6-digit code, emails it, stores it with a
// 15-minute expiry. Always returns a generic success message even if the
// email isn't registered, so this endpoint can't be used to check which
// emails have accounts (a common security practice for reset flows).
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required.' });

  db.query('SELECT UserID, ResetCodeExpiry FROM Users WHERE Email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

    if (results.length === 0) {
      // Don't reveal whether the email exists — respond the same either way.
      return res.status(200).json({ message: 'If that email is registered, a reset code has been sent.' });
    }

    // Rate limiting: derived from the existing ResetCodeExpiry field instead
    // of adding a new column. A code lasts 15 minutes (900s); if more than
    // 840s remain until it expires, the previous request was made less than
    // 60 seconds ago — block a resend until that cooldown passes.
    const existingExpiry = results[0].ResetCodeExpiry;
    if (existingExpiry) {
      const secondsUntilExpiry = (new Date(existingExpiry) - new Date()) / 1000;
      if (secondsUntilExpiry > 840) {
        const waitSeconds = Math.ceil(secondsUntilExpiry - 840);
        return res.status(429).json({
          message: `Please wait ${waitSeconds} seconds before requesting another code.`,
          waitSeconds,
        });
      }
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

    db.query(
      'UPDATE Users SET ResetCode = ?, ResetCodeExpiry = ? WHERE Email = ?',
      [code, expiry, email],
      async (err) => {
        if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
        try {
          await sendResetCodeEmail(email, code);
        } catch (emailErr) {
          console.error('Failed to send reset email:', emailErr.message);
          return res.status(500).json({ message: 'Could not send reset email. Please try again.' });
        }
        return res.status(200).json({ message: 'If that email is registered, a reset code has been sent.' });
      }
    );
  });
});

// RESET PASSWORD — verifies the code and expiry, then updates the password
// and clears the reset fields so the code can't be reused.
router.post('/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: 'Email, code and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  db.query('SELECT * FROM Users WHERE Email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (results.length === 0) return res.status(400).json({ message: 'Invalid code or email.' });

    const user = results[0];
    if (!user.ResetCode || user.ResetCode !== code) {
      return res.status(400).json({ message: 'Invalid code.' });
    }
    if (!user.ResetCodeExpiry || new Date(user.ResetCodeExpiry) < new Date()) {
      return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.query(
      'UPDATE Users SET Password = ?, ResetCode = NULL, ResetCodeExpiry = NULL WHERE Email = ?',
      [hashedPassword, email],
      (err) => {
        if (err) return res.status(500).json({ message: 'Could not reset password.', error: err.message });
        return res.status(200).json({ message: 'Password reset successful. You can now log in.' });
      }
    );
  });
});

// UPDATE PROFILE PHOTO
router.put('/photo', verifyToken, (req, res) => {
  const { photoBase64 } = req.body;
  const userID = req.user.userID;
  if (!photoBase64) return res.status(400).json({ message: 'Photo data is required.' });
  db.query('UPDATE Users SET PhotoBase64 = ? WHERE UserID = ?', [photoBase64, userID], (err) => {
    if (err) {
      console.error('PUT photo error:', err.message);
      return res.status(500).json({ message: 'Could not update photo.', error: err.message });
    }
    return res.status(200).json({ message: 'Profile photo updated.', photoBase64 });
  });
});

// GET PROFILE
router.get('/profile', verifyToken, (req, res) => {
  const userID = req.user.userID;
  db.query('SELECT UserID, Name, Email, Role, ContactNumber, PhotoBase64 FROM Users WHERE UserID = ?', [userID], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (results.length === 0) return res.status(404).json({ message: 'User not found.' });
    return res.status(200).json({ user: results[0] });
  });
});

// UPDATE PROFILE
router.put('/profile', verifyToken, (req, res) => {
  const { name, contactNumber } = req.body;
  const userID = req.user.userID;
  if (!name) return res.status(400).json({ message: 'Name is required.' });
  const sql = 'UPDATE Users SET Name = ?, ContactNumber = ? WHERE UserID = ?';
  db.query(sql, [name, contactNumber || null, userID], (err) => {
    if (err) return res.status(500).json({ message: 'Could not update profile.' });
    return res.status(200).json({ message: 'Profile updated.' });
  });
});

module.exports = router;
