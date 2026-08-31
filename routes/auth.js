const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const verifyToken = require('../middleware/auth');

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
