const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// ── GET ALL ADOPTION POSTS ────────────────────────────────────
router.get('/', (req, res) => {
  const { species, status } = req.query;

  let sql = `
    SELECT a.*, u.Name AS PosterName, u.ContactNumber AS PosterContact,
      (SELECT COUNT(*) FROM AdoptionComments c WHERE c.AdoptionID = a.AdoptionID) AS CommentCount
    FROM AdoptionPosts a
    JOIN Users u ON a.UserID = u.UserID
    WHERE 1=1
  `;
  const params = [];

  if (species && species !== 'All') {
    sql += ' AND a.Species = ?';
    params.push(species);
  }
  if (status) {
    sql += ' AND a.Status = ?';
    params.push(status);
  } else {
    sql += ' AND a.Status = "Available"';
  }

  sql += ' ORDER BY a.CreatedAt DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('GET adoption error:', err.message);
      return res.status(500).json({ message: 'Database error.', error: err.message });
    }

    const posts = results.map(post => ({
      ...post,
      photos: post.PhotosJSON ? JSON.parse(post.PhotosJSON) : (post.PhotoBase64 ? [post.PhotoBase64] : []),
    }));
    return res.status(200).json({ posts });
  });
});

// ── GET SINGLE ADOPTION POST ──────────────────────────────────
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const sql = `
    SELECT a.*, u.Name AS PosterName, u.ContactNumber AS PosterContact
    FROM AdoptionPosts a
    JOIN Users u ON a.UserID = u.UserID
    WHERE a.AdoptionID = ?
  `;
  db.query(sql, [id], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (results.length === 0) return res.status(404).json({ message: 'Post not found.' });
    const post = {
      ...results[0],
      photos: results[0].PhotosJSON
        ? JSON.parse(results[0].PhotosJSON)
        : (results[0].PhotoBase64 ? [results[0].PhotoBase64] : []),
    };
    return res.status(200).json({ post });
  });
});

// ── CREATE ADOPTION POST ──────────────────────────────────────
router.post('/', (req, res) => {
  const {
    petName, species, breed, age, gender,
    description, contactInfo, location,
    photos, // array of base64 strings
  } = req.body;
  const userID = req.user.userID;

  if (!petName || !species || !description || !contactInfo) {
    return res.status(400).json({ message: 'Pet name, species, description and contact are required.' });
  }

  // Store first photo in PhotoBase64 for backward compatibility, Store all photos in PhotosJSON
  const photoBase64  = photos && photos.length > 0 ? photos[0] : null;
  const photosJSON   = photos && photos.length > 0 ? JSON.stringify(photos) : null;

  const sql = `
    INSERT INTO AdoptionPosts
      (UserID, PetName, Species, Breed, Age, Gender, Description, ContactInfo, Location, PhotoBase64, PhotosJSON)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(sql, [
    userID, petName, species, breed || null, age || null,
    gender || 'Unknown', description, contactInfo,
    location || null, photoBase64, photosJSON,
  ], (err, result) => {
    if (err) {
      console.error('POST adoption error:', err.message);
      return res.status(500).json({ message: 'Could not create post.', error: err.message });
    }
    return res.status(201).json({ message: 'Adoption post created.', adoptionID: result.insertId });
  });
});

// ── MARK AS ADOPTED ───────────────────────────────────────────
router.put('/:id/adopted', (req, res) => {
  const { id }  = req.params;
  const userID  = req.user.userID;
  db.query(
    'UPDATE AdoptionPosts SET Status = "Adopted" WHERE AdoptionID = ? AND UserID = ?',
    [id, userID],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error.' });
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Post not found.' });
      return res.status(200).json({ message: 'Marked as adopted.' });
    }
  );
});

// ── DELETE ADOPTION POST ──────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id }  = req.params;
  const userID  = req.user.userID;
  db.query(
    'DELETE FROM AdoptionPosts WHERE AdoptionID = ? AND UserID = ?',
    [id, userID],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error.' });
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Post not found.' });
      return res.status(200).json({ message: 'Post deleted.' });
    }
  );
});

// ── GET COMMENTS ──────────────────────────────────────────────
router.get('/:id/comments', (req, res) => {
  const { id } = req.params;
  const sql = `
    SELECT c.*, u.Name AS AuthorName, u.PhotoBase64 AS AuthorPhoto
    FROM AdoptionComments c
    JOIN Users u ON c.UserID = u.UserID
    WHERE c.AdoptionID = ?
    ORDER BY c.CreatedAt ASC
  `;
  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error('GET adoption comments error:', err.message);
      return res.status(500).json({ message: 'Database error.' });
    }
    return res.status(200).json({ comments: results });
  });
});

// ── ADD COMMENT ───────────────────────────────────────────────
router.post('/:id/comments', (req, res) => {
  const { id }      = req.params;
  const userID      = req.user.userID;
  const { content } = req.body;

  if (!content) return res.status(400).json({ message: 'Comment content is required.' });

  db.query(
    'INSERT INTO AdoptionComments (AdoptionID, UserID, Content) VALUES (?, ?, ?)',
    [id, userID, content],
    (err, result) => {
      if (err) {
        console.error('POST adoption comment error:', err.message);
        return res.status(500).json({ message: 'Could not add comment.' });
      }
      return res.status(201).json({ message: 'Comment added.', commentID: result.insertId });
    }
  );
});

// ── DELETE COMMENT ────────────────────────────────────────────
router.delete('/:id/comments/:commentID', (req, res) => {
  const { commentID } = req.params;
  const userID        = req.user.userID;
  db.query(
    'DELETE FROM AdoptionComments WHERE CommentID = ? AND UserID = ?',
    [commentID, userID],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error.' });
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Comment not found.' });
      return res.status(200).json({ message: 'Comment deleted.' });
    }
  );
});

module.exports = router;
