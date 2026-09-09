const express     = require('express');
const router      = express.Router();
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// Overpass's public instances (particularly overpass-api.de) recently
// started rejecting requests that look like they're coming from an
// app/browser client, regardless of headers set, with HTTP 406 — this is
// a documented, widespread issue affecting many client apps, not
// something specific to our request format. Making the request from this
// backend server instead (rather than the React Native app directly)
// avoids that client-side blocking, since it's a normal server-to-server
// HTTP request rather than an app-originated one.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

router.get('/', async (req, res) => {
  const { lat, lon, radius } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ message: 'lat and lon query parameters are required.' });
  }

  const searchRadius = radius || 15000; // metres, matches the app's default (15 km)

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="veterinary"](around:${searchRadius},${lat},${lon});
      way["amenity"="veterinary"](around:${searchRadius},${lat},${lon});
      relation["amenity"="veterinary"](around:${searchRadius},${lat},${lon});
    );
    out center;
  `;

  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'APetOwnersClubBackend/1.0 (FYP server; contact via app support)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Overpass returned ${response.status}: ${text.slice(0, 200)}`);
      }

      const json = await response.json();
      // Return the raw Overpass response as-is — the app already has all
      // the logic to map elements into clinic objects (distance, opening
      // hours parsing, etc.), so the backend's only job here is fetching
      // the data from an environment Overpass doesn't block.
      return res.status(200).json(json);
    } catch (err) {
      lastError = err;
      console.error('[NearbyClinics backend] endpoint failed:', endpoint, err.message);
    }
  }

  return res.status(502).json({
    message: 'Could not reach any Overpass endpoint right now. Please try again shortly.',
    error: lastError?.message,
  });
});

module.exports = router;
