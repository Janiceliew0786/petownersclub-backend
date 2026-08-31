// UPDATE PROFILE
router.put('/profile', verifyToken, (req, res) => {
  const { name, contactNumber } = req.body;
  const userID = req.user.userID;

  if (!name) return res.status(400).json({ message: 'Name is required.' });

  const sql = 'UPDATE Users SET Name = ?, ContactNumber = ? WHERE UserID = ?';
  db.query(sql, [name, contactNumber || null, userID], (err) => {
    if (err) {
      console.error('PUT profile error:', err.message);
      return res.status(500).json({ message: 'Could not update profile.', error: err.message });
    }
    return res.status(200).json({ message: 'Profile updated.' });
  });
});
