// A newer expo-server-sdk version ships as an ES Module, which cannot be
// loaded with a top-level require() from this CommonJS file (Node throws
// ERR_REQUIRE_ESM and the whole server crashes on startup). Dynamic
// import() works from CommonJS files even for ESM-only packages, so the
// Expo client is loaded lazily inside an async function instead of at
// module load time.
let expoClientPromise = null;
function getExpo() {
  if (!expoClientPromise) {
    expoClientPromise = import('expo-server-sdk').then(({ Expo }) => new Expo());
  }
  return expoClientPromise;
}

// Sends one push notification. pushToken must be a valid Expo push token
// (starts with "ExponentPushToken[...]") — anything else is silently
// skipped, since a malformed token would otherwise throw and could crash
// the caller (e.g. the nightly reminder job) partway through a batch.
async function sendPushNotification(pushToken, title, body, data = {}) {
  const { Expo } = await import('expo-server-sdk');
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn('Skipping invalid Expo push token:', pushToken);
    return;
  }

  const expo = await getExpo();
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
