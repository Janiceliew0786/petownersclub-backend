const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// ── GET OR CREATE CONVERSATION ────────────────────────────────
// POST /api/chat/conversation
router.post('/conversation', (req, res) => {
  const { otherUserID } = req.body;
  const myID = req.user.userID;

  if (!otherUserID) return res.status(400).json({ message: 'otherUserID is required.' });
  if (otherUserID === myID) return res.status(400).json({ message: 'Cannot chat with yourself.' });

  // Always store with smaller ID as User1ID for uniqueness
  const user1 = Math.min(myID, otherUserID);
  const user2 = Math.max(myID, otherUserID);

  // Check if conversation exists
  db.query(
    'SELECT * FROM Conversations WHERE User1ID = ? AND User2ID = ?',
    [user1, user2],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

      if (results.length > 0) {
        return res.status(200).json({ conversationID: results[0].ConversationID });
      }

      // Create new conversation
      db.query(
        'INSERT INTO Conversations (User1ID, User2ID) VALUES (?, ?)',
        [user1, user2],
        (err, result) => {
          if (err) return res.status(500).json({ message: 'Could not create conversation.', error: err.message });
          return res.status(201).json({ conversationID: result.insertId });
        }
      );
    }
  );
});

// ── GET ALL MY CONVERSATIONS ──────────────────────────────────
// GET /api/chat/conversations
router.get('/conversations', (req, res) => {
  const myID = req.user.userID;

  const sql = `
    SELECT
      c.ConversationID,
      c.LastMessage,
      c.LastMessageAt,
      CASE WHEN c.User1ID = ? THEN c.User2ID ELSE c.User1ID END AS OtherUserID,
      u.Name AS OtherUserName,
      u.PhotoBase64 AS OtherUserPhoto,
      u.Role AS OtherUserRole,
      (SELECT COUNT(*) FROM Messages m 
       WHERE m.ConversationID = c.ConversationID 
       AND m.SenderID != ? AND m.IsRead = 0) AS UnreadCount
    FROM Conversations c
    JOIN Users u ON u.UserID = CASE WHEN c.User1ID = ? THEN c.User2ID ELSE c.User1ID END
    WHERE c.User1ID = ? OR c.User2ID = ?
    ORDER BY c.LastMessageAt DESC
  `;
  db.query(sql, [myID, myID, myID, myID, myID], (err, results) => {
    if (err) {
      console.error('GET conversations error:', err.message);
      return res.status(500).json({ message: 'Database error.', error: err.message });
    }
    return res.status(200).json({ conversations: results });
  });
});

// ── GET MESSAGES IN CONVERSATION ──────────────────────────────
// GET /api/chat/messages/:conversationID
router.get('/messages/:conversationID', (req, res) => {
  const { conversationID } = req.params;
  const myID = req.user.userID;

  // Mark messages as read
  db.query(
    'UPDATE Messages SET IsRead = 1 WHERE ConversationID = ? AND SenderID != ?',
    [conversationID, myID],
    () => {}
  );

  const sql = `
    SELECT m.*, u.Name AS SenderName
    FROM Messages m
    JOIN Users u ON m.SenderID = u.UserID
    WHERE m.ConversationID = ?
    ORDER BY m.CreatedAt ASC
  `;
  db.query(sql, [conversationID], (err, results) => {
    if (err) {
      console.error('GET messages error:', err.message);
      return res.status(500).json({ message: 'Database error.', error: err.message });
    }
    return res.status(200).json({ messages: results });
  });
});

// ── SEND MESSAGE ──────────────────────────────────────────────
// POST /api/chat/messages/:conversationID
router.post('/messages/:conversationID', (req, res) => {
  const { conversationID } = req.params;
  const { content }        = req.body;
  const senderID           = req.user.userID;

  if (!content) return res.status(400).json({ message: 'Message content is required.' });

  db.query(
    'INSERT INTO Messages (ConversationID, SenderID, Content) VALUES (?, ?, ?)',
    [conversationID, senderID, content],
    (err, result) => {
      if (err) {
        console.error('POST message error:', err.message);
        return res.status(500).json({ message: 'Could not send message.', error: err.message });
      }

      // Update last message in conversation
      db.query(
        'UPDATE Conversations SET LastMessage = ?, LastMessageAt = NOW() WHERE ConversationID = ?',
        [content, conversationID],
        () => {}
      );

      return res.status(201).json({ message: 'Message sent.', messageID: result.insertId });
    }
  );
});

// ── GET UNREAD COUNT ──────────────────────────────────────────
// GET /api/chat/unread
router.get('/unread', (req, res) => {
  const myID = req.user.userID;
  const sql = `
    SELECT COUNT(*) AS unread
    FROM Messages m
    JOIN Conversations c ON m.ConversationID = c.ConversationID
    WHERE (c.User1ID = ? OR c.User2ID = ?)
    AND m.SenderID != ?
    AND m.IsRead = 0
  `;
  db.query(sql, [myID, myID, myID], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.' });
    return res.status(200).json({ unread: results[0].unread });
  });
});

module.exports = router;
