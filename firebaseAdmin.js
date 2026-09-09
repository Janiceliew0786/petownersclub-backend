const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const path = require('path');

// IMPORTANT: this project is pinned to firebase-admin ^13.x, not the
// latest v14. Firebase Admin SDK v14 requires Node.js 22.12+ (it depends
// on `jose`, an ESM-only package, reached through jwks-rsa — require(ESM)
// only became stable in Node 22.12). Railway's default Node runtime here
// is v18, which cannot load it at all, crashing the entire server with
// ERR_REQUIRE_ESM on startup. v13.x still uses the older jwks-rsa/jose
// version, which is CommonJS-compatible and works fine on Node 18.
//
// v13's credential-loading API is also the OLDER style — admin.credential
// .cert() — not v14's flattened admin.cert(). If firebase-admin is ever
// upgraded back to v14+ (and the Node runtime is upgraded to 22.12+ to
// match), this line needs to change to admin.cert(serviceAccount) instead.
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else {
  serviceAccount = require(path.join(__dirname, 'firebase-service-account.json'));
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = getAuth();

module.exports = { admin, auth };
