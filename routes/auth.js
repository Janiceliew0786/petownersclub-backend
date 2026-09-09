const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db');
const verifyToken = require('../middleware/auth');
const { sendResetCodeEmail } = require('../utils/mailer');
const { auth: firebaseAuth } = require('../firebaseAdmin');

// REGISTER
router.post('/register', (req, res) => {
  const { name, email, password, role, contactNumber, licenseNumber, licensePhotos } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }
  const finalRole = role || 'Owner';
  if (finalRole === 'Veterinarian' && !licenseNumber) {
    return res.status(400).json({ message: 'A license number is required to register as a Veterinarian.' });
  }

  // licensePhotos is an array of data URIs (or null/empty). The first photo
  // is also stored in the original single-photo column for backward
  // compatibility with any code that still reads it directly.
  const photosArray = Array.isArray(licensePhotos) ? licensePhotos : [];
  const firstPhoto = photosArray[0] || null;
  const photosJSON = photosArray.length > 0 ? JSON.stringify(photosArray) : null;

  db.query('SELECT * FROM Users WHERE Email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
    if (results.length > 0) return res.status(409).json({ message: 'Email already registered.' });
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Vets start Pending until an admin reviews their license — the vet
    // badge only shows once VerificationStatus is 'Verified'. Owners are
    // 'Not Applicable' since verification doesn't apply to them.
    const verificationStatus = finalRole === 'Veterinarian' ? 'Pending' : 'Not Applicable';

    const sql = `INSERT INTO Users
      (Name, Email, Password, Role, ContactNumber, VerificationStatus, LicenseNumber, LicensePhotoBase64, LicensePhotosJSON)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(
      sql,
      [
        name, email, hashedPassword, finalRole, contactNumber || null,
        verificationStatus, licenseNumber || null, firstPhoto, photosJSON,
      ],
      (err, result) => {
        if (err) return res.status(500).json({ message: 'Could not register user.', error: err.message });
        return res.status(201).json({
          message: finalRole === 'Veterinarian'
            ? 'Registration successful. Your veterinarian account is pending verification.'
            : 'Registration successful.',
          userID: result.insertId,
        });
      }
    );
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
    if (user.IsActive === 0) {
      return res.status(403).json({ message: 'This account has been deactivated. Contact support if you believe this is a mistake.' });
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
        userID:             user.UserID,
        name:               user.Name,
        email:              user.Email,
        role:               user.Role,
        photoBase64:        user.PhotoBase64 || null,
        verificationStatus: user.VerificationStatus,
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
  db.query(
    `SELECT UserID, Name, Email, Role, ContactNumber, PhotoBase64, VerificationStatus, LicenseNumber, LicensePhotoBase64, LicensePhotosJSON,
      (SELECT COUNT(*) FROM HelpfulMarks h JOIN PostComments c ON h.CommentID = c.CommentID
       WHERE c.UserID = Users.UserID) AS HelpfulCount
     FROM Users WHERE UserID = ?`,
    [userID],
    (err, results) => {
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

// UPDATE VET LICENSE / CREDENTIALS
// Any change to license number or certificate photo resets VerificationStatus
// back to Pending — a verified vet who edits their credentials must be
// re-reviewed, otherwise editing would let someone bypass verification
// entirely after the fact.
router.put('/license', verifyToken, (req, res) => {
  const userID = req.user.userID;
  const { licenseNumber, licensePhotos } = req.body;

  if (req.user.role !== 'Veterinarian') {
    return res.status(403).json({ message: 'Only veterinarian accounts have license credentials.' });
  }
  if (!licenseNumber || !licenseNumber.trim()) {
    return res.status(400).json({ message: 'License number is required.' });
  }

  const photosArray = Array.isArray(licensePhotos) ? licensePhotos : [];
  const firstPhoto = photosArray[0] || null;
  const photosJSON = photosArray.length > 0 ? JSON.stringify(photosArray) : null;

  const sql = `UPDATE Users
               SET LicenseNumber = ?, LicensePhotoBase64 = ?, LicensePhotosJSON = ?, VerificationStatus = 'Pending'
               WHERE UserID = ?`;
  db.query(sql, [licenseNumber.trim(), firstPhoto, photosJSON, userID], (err) => {
    if (err) return res.status(500).json({ message: 'Could not update credentials.', error: err.message });
    return res.status(200).json({
      message: 'Credentials updated. Your account is pending verification again.',
      verificationStatus: 'Pending',
    });
  });
});

// PUBLIC PROFILE — safe, non-sensitive fields for viewing another user's
// profile (e.g. tapping their name on a post/comment/listing). Excludes
// Password, ResetCode, and other private fields.
router.get('/public-profile/:userID', verifyToken, (req, res) => {
  const { userID } = req.params;
  db.query(
    `SELECT UserID, Name, Email, ContactNumber, Role, PhotoBase64, VerificationStatus,
      (SELECT COUNT(*) FROM HelpfulMarks h JOIN PostComments c ON h.CommentID = c.CommentID
       WHERE c.UserID = Users.UserID) AS HelpfulCount
     FROM Users WHERE UserID = ?`,
    [userID],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
      if (results.length === 0) return res.status(404).json({ message: 'User not found.' });
      return res.status(200).json({ user: results[0] });
    }
  );
});

// SAVE PUSH TOKEN — called once on login/app start so this device can
// receive healthcare reminder notifications.
router.put('/push-token', verifyToken, (req, res) => {
  const userID = req.user.userID;
  const { pushToken } = req.body;
  if (!pushToken) return res.status(400).json({ message: 'pushToken is required.' });

  db.query('UPDATE Users SET PushToken = ? WHERE UserID = ?', [pushToken, userID], (err) => {
    if (err) return res.status(500).json({ message: 'Could not save push token.', error: err.message });
    return res.status(200).json({ message: 'Push token saved.' });
  });
});

// FIREBASE TOKEN — mints a Firebase custom auth token tied to this user's
// MySQL UserID, so the app can sign into Firestore as the SAME verified
// identity used everywhere else. Firestore security rules then check
// request.auth.uid, which will equal this UserID (as a string).
router.get('/firebase-token', verifyToken, async (req, res) => {
  try {
    const uid = String(req.user.userID);
    const customToken = await firebaseAuth.createCustomToken(uid);
    return res.status(200).json({ token: customToken });
  } catch (err) {
    console.error('Firebase token error:', err.message);
    return res.status(500).json({ message: 'Could not create Firebase token.', error: err.message });
  }
});

// SUPPORT CONTACT — lets any logged-in user (Owner/Vet) find an Admin to
// reach out to for help. Deliberately NOT gated by requireAdmin, since
// regular users (who aren't Admins) are exactly who needs this.
router.get('/support-contact', verifyToken, (req, res) => {
  db.query(
    "SELECT UserID, Name, Email FROM Users WHERE Role = 'Admin' ORDER BY UserID ASC LIMIT 1",
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error.', error: err.message });
      if (results.length === 0) return res.status(404).json({ message: 'No admin account found.' });
      return res.status(200).json({ admin: results[0] });
    }
  );
});

module.exports = router;
