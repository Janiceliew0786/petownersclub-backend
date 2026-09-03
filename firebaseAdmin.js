const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const path = require('path');

// The service account key file — never committed to git (see .gitignore).
// Locally: place the downloaded JSON at backend/firebase-service-account.json.
// On Railway: read from an environment variable instead, since the file
// itself can't be uploaded the same way.
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else {
  serviceAccount = require(path.join(__dirname, 'firebase-service-account.json'));
}

admin.initializeApp({
  credential: admin.cert(serviceAccount),
});

const auth = getAuth();

module.exports = { admin, auth };