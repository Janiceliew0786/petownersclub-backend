const { Expo } = require('expo-server-sdk');

const expo = new Expo();

// Sends one push notification. pushToken must be a valid Expo push token
// (starts with "ExponentPushToken[...]") — anything else is silently
// skipped, since a malformed token would otherwise throw and could crash
// the caller (e.g. the nightly reminder job) partway through a batch.
async function sendPushNotification(pushToken, title, body, data = {}) {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn('Skipping invalid Expo push token:', pushToken);
    return;
  }

  const message = { to: pushToken, sound: 'default', title, body, data };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    console.error('Push notification send error:', err.message);
  }
}

module.exports = { sendPushNotification };
