const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// GET ALL PETS (the logged-in user's own)
router.get('/', (req, res) => {
  const ownerID = req.user.userID;
  const sql = 'SELECT * FROM Pets WHERE OwnerID = ? ORDER BY CreatedAt DESC';
  db.query(sql, [ownerID], (err, results) => {
    if (err) {
      console.error('GET pets error:', err.message);
      return res.status(500).json({ message: 'Database error.', error: err.message });
    }
    return res.status(200).json({ pets: results });
  });
});

// GET ANOTHER USER'S PETS — public read-only view for their profile page.
// Placed BEFORE '/:id' below so Express doesn't match "user" as a PetID.
router.get('/user/:userID', (req, res) => {
  const { userID } = req.params;
  const sql = 'SELECT * FROM Pets WHERE OwnerID = ? ORDER BY CreatedAt DESC';
  db.query(sql, [userID], (err, results) => {
    if (err) {
      console.error('GET user pets error:', err.message);
      return res.status(500).json({ message: 'Database error.', error: err.message });
    }
    return res.status(200).json({ pets: results });
  });
});

// GET SINGLE PET (must own it)
router.get('/:id', (req, res) => {
  const petID   = req.params.id;
  const ownerID = req.user.userID;
  db.query('SELECT * FROM Pets WHERE PetID = ? AND OwnerID = ?', [petID, ownerID], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (results.length === 0) return res.status(404).json({ message: 'Pet not found.' });
    return res.status(200).json({ pet: results[0] });
  });
});

// ADD NEW PET
router.post('/', (req, res) => {
  const { name, species, breed, age, healthStatus, photoBase64, gender } = req.body;
  const ownerID = req.user.userID;

  if (!name || !species) {
    return res.status(400).json({ message: 'Pet name and species are required.' });
  }

  const sql = `
    INSERT INTO Pets (OwnerID, Name, Species, Breed, Age, HealthStatus, PhotoBase64, Gender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(sql, [ownerID, name, species, breed || null, age || null, healthStatus || null, photoBase64 || null, gender || 'Unknown'], (err, result) => {
    if (err) {
      console.error('POST pet error:', err.message);
      return res.status(500).json({ message: 'Could not add pet.', error: err.message });
    }
    return res.status(201).json({ message: 'Pet added successfully.', petID: result.insertId });
  });
});

// UPDATE PET
router.put('/:id', (req, res) => {
  const petID   = req.params.id;
  const ownerID = req.user.userID;
  const { name, species, breed, age, healthStatus, photoBase64, gender } = req.body;

  const sql = `
    UPDATE Pets
    SET Name = ?, Species = ?, Breed = ?, Age = ?, HealthStatus = ?, PhotoBase64 = ?, Gender = ?
    WHERE PetID = ? AND OwnerID = ?
  `;
  db.query(sql, [name, species, breed || null, age || null, healthStatus || null, photoBase64 || null, gender || 'Unknown', petID, ownerID], (err, result) => {
    if (err) {
      console.error('PUT pet error:', err.message);
      return res.status(500).json({ message: 'Could not update pet.', error: err.message });
    }
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Pet not found.' });
    return res.status(200).json({ message: 'Pet updated successfully.' });
  });
});

// DELETE PET
router.delete('/:id', (req, res) => {
  const petID   = req.params.id;
  const ownerID = req.user.userID;
  db.query('DELETE FROM Pets WHERE PetID = ? AND OwnerID = ?', [petID, ownerID], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Pet not found.' });
    return res.status(200).json({ message: 'Pet deleted successfully.' });
  });
});

module.exports = router;
