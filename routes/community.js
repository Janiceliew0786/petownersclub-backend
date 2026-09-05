const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// GET ALL POSTS
router.get('/', (req, res) => {
  const { category, topic, search } = req.query;
  const userID = req.user.userID;

  let sql = `
    SELECT
      p.PostID, p.UserID, p.Category, p.Topic, p.Content, p.MediaURL, p.CreatedAt,
      u.Name AS AuthorName, u.Role AS AuthorRole, u.PhotoBase64 AS AuthorPhoto,
      u.VerificationStatus AS AuthorVerificationStatus,
      (SELECT COUNT(*) FROM PostLikes l WHERE l.PostID = p.PostID) AS LikeCount,
      (SELECT COUNT(*) FROM PostComments c WHERE c.PostID = p.PostID) AS CommentCount,
      (SELECT COUNT(*) FROM PostLikes l WHERE l.PostID = p.PostID AND l.UserID = ?) AS UserLiked,
      (SELECT COUNT(*) FROM HelpfulMarks h JOIN PostComments c2 ON h.CommentID = c2.CommentID
       WHERE c2.UserID = p.UserID) AS AuthorHelpfulCount
    FROM CommunityPosts p
    JOIN Users u ON p.UserID = u.UserID
    WHERE 1=1
  `;
  const params = [userID];

  if (category && category !== 'All') {
    sql += ' AND p.Category = ?';
    params.push(category);
  }
  if (topic && topic !== 'All Topics') {
    sql += ' AND p.Topic = ?';
    params.push(topic);
  }
  if (search) {
    sql += ' AND p.Content LIKE ?';
    params.push(`%${search}%`);
  }
  sql += ' ORDER BY p.CreatedAt DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('GET /community error:', err.message);
      return res.status(500).json({ message: 'Database error.', error: err.message });
    }
    return res.status(200).json({ posts: results });
  });
});

// CREATE POST
router.post('/', (req, res) => {
  const { category, topic, content, mediaURL } = req.body;
  const userID = req.user.userID;

  if (!category || !content) {
    return res.status(400).json({ message: 'Category and content are required.' });
  }

  const sql = 'INSERT INTO CommunityPosts (UserID, Category, Topic, Content, MediaURL) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [userID, category, topic || 'General', content, mediaURL || null], (err, result) => {
    if (err) {
      console.error('POST /community error:', err.message);
      return res.status(500).json({ message: 'Could not create post.', error: err.message });
    }
    return res.status(201).json({ message: 'Post created.', postID: result.insertId });
  });
});

// DELETE POST — the owner can delete their own; an Admin can delete any
// post (content moderation).
router.delete('/:id', (req, res) => {
  const postID = req.params.id;
  const userID = req.user.userID;
  const isAdmin = req.user.role === 'Admin';

  const sql = isAdmin
    ? 'DELETE FROM CommunityPosts WHERE PostID = ?'
    : 'DELETE FROM CommunityPosts WHERE PostID = ? AND UserID = ?';
  const params = isAdmin ? [postID] : [postID, userID];

  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Post not found.' });
    return res.status(200).json({ message: 'Post deleted.' });
  });
});

// LIKE / UNLIKE
router.post('/:id/like', (req, res) => {
  const postID = req.params.id;
  const userID = req.user.userID;

  db.query('SELECT * FROM PostLikes WHERE PostID = ? AND UserID = ?', [postID, userID], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (rows.length > 0) {
      db.query('DELETE FROM PostLikes WHERE PostID = ? AND UserID = ?', [postID, userID], (err) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        return res.status(200).json({ message: 'Unliked.', liked: false });
      });
    } else {
      db.query('INSERT INTO PostLikes (PostID, UserID) VALUES (?, ?)', [postID, userID], (err) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        return res.status(200).json({ message: 'Liked.', liked: true });
      });
    }
  });
});

// GET COMMENTS
router.get('/:id/comments', (req, res) => {
  const postID = req.params.id;
  const myID   = req.user.userID;
  const sql = `
    SELECT c.*, u.Name AS AuthorName, u.Role AS AuthorRole, u.PhotoBase64 AS AuthorPhoto,
      u.VerificationStatus AS AuthorVerificationStatus,
      (SELECT COUNT(*) FROM HelpfulMarks h WHERE h.CommentID = c.CommentID) AS HelpfulCount,
      (SELECT COUNT(*) FROM HelpfulMarks h WHERE h.CommentID = c.CommentID AND h.UserID = ?) AS UserMarkedHelpful,
      (SELECT COUNT(*) FROM HelpfulMarks h2 JOIN PostComments c2 ON h2.CommentID = c2.CommentID
       WHERE c2.UserID = c.UserID) AS AuthorHelpfulCount
    FROM PostComments c
    JOIN Users u ON c.UserID = u.UserID
    WHERE c.PostID = ?
    ORDER BY c.CreatedAt ASC
  `;
  db.query(sql, [myID, postID], (err, results) => {
    if (err) {
      console.error('GET comments error:', err.message);
      return res.status(500).json({ message: 'Database error.' });
    }
    return res.status(200).json({ comments: results });
  });
});

// ADD COMMENT
router.post('/:id/comments', (req, res) => {
  const postID = req.params.id;
  const userID = req.user.userID;
  const { content } = req.body;

  if (!content) return res.status(400).json({ message: 'Comment content is required.' });

  db.query('INSERT INTO PostComments (PostID, UserID, Content) VALUES (?, ?, ?)', [postID, userID, content], (err, result) => {
    if (err) {
      console.error('POST comment error:', err.message);
      return res.status(500).json({ message: 'Could not add comment.' });
    }
    return res.status(201).json({ message: 'Comment added.', commentID: result.insertId });
  });
});

// TOGGLE HELPFUL MARK — mainly used on vet answers, but not restricted to
// them at the database level (frontend decides where to show the button).
router.post('/comments/:commentID/helpful', (req, res) => {
  const { commentID } = req.params;
  const userID = req.user.userID;

  db.query('SELECT * FROM HelpfulMarks WHERE CommentID = ? AND UserID = ?', [commentID, userID], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    if (rows.length > 0) {
      db.query('DELETE FROM HelpfulMarks WHERE CommentID = ? AND UserID = ?', [commentID, userID], (err) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        return res.status(200).json({ message: 'Helpful mark removed.', marked: false });
      });
    } else {
      db.query('INSERT INTO HelpfulMarks (CommentID, UserID) VALUES (?, ?)', [commentID, userID], (err) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        return res.status(200).json({ message: 'Marked as helpful.', marked: true });
      });
    }
  });
});

module.exports = router;
