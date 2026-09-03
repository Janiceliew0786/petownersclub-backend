const db = require('../db');
const { sendPushNotification } = require('../utils/pushNotifications');

// Finds health records whose NextDueDate has arrived or passed, that
// haven't already triggered a notification, and pushes one reminder per
// record to the pet's owner (if they have a saved push token).
function checkAndSendHealthReminders() {
  const sql = `
    SELECT hr.RecordID, hr.ReminderType, hr.NextDueDate,
           p.Name AS PetName, u.UserID, u.PushToken
    FROM HealthRecords hr
    JOIN Pets p  ON hr.PetID = p.PetID
    JOIN Users u ON p.OwnerID = u.UserID
    WHERE hr.NextDueDate IS NOT NULL
      AND hr.NextDueDate <= CURDATE()
      AND hr.ReminderSent = 0
      AND u.PushToken IS NOT NULL
  `;

  db.query(sql, async (err, results) => {
    if (err) {
      console.error('Health reminder job — query error:', err.message);
      return;
    }
    if (results.length === 0) return;

    console.log(`Health reminder job: sending ${results.length} notification(s).`);

    for (const record of results) {
      const isOverdue = new Date(record.NextDueDate) < new Date(new Date().toDateString());
      const title = isOverdue
        ? `⚠️ ${record.PetName}'s ${record.ReminderType} is overdue`
        : `🔔 ${record.PetName}'s ${record.ReminderType} is due today`;
      const body = isOverdue
        ? `This was due on ${new Date(record.NextDueDate).toLocaleDateString()}. Don't forget to take care of it.`
        : `Reminder: today's the day for ${record.PetName}'s ${record.ReminderType.toLowerCase()}.`;

      await sendPushNotification(record.PushToken, title, body, {
        type: 'healthReminder',
        recordID: record.RecordID,
      });

      // Mark sent regardless of whether the push actually succeeded (e.g.
      // a stale/invalid token) — avoids retrying a dead token every day.
      db.query('UPDATE HealthRecords SET ReminderSent = 1 WHERE RecordID = ?', [record.RecordID], (err) => {
        if (err) console.error('Health reminder job — could not mark sent:', err.message);
      });
    }
  });
}

module.exports = { checkAndSendHealthReminders };
