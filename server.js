const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
require('dotenv').config();

const { checkAndSendHealthReminders } = require('./jobs/healthReminders');

const app = express();

// Railway (and most PaaS hosts) sit behind a reverse proxy — this makes
// req.ip and secure-cookie handling behave correctly.
app.set('trust proxy', 1);

// In FYP1 this was open CORS for local/ngrok testing. In FYP2 restrict it to
// your actual mobile app + any admin web dashboard origins via env var,
// while still allowing no-origin requests (native app HTTP clients don't
// send an Origin header).
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));

// Kept from FYP1 — harmless in production, still needed if you test through ngrok.
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/pets',      require('./routes/pets'));
app.use('/api/community', require('./routes/community'));
app.use('/api/health',    require('./routes/health'));
app.use('/api/adoption',  require('./routes/adoption'));
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/chat',      require('./routes/chat'));
app.use('/api/vets',      require('./routes/vets'));

app.get('/', (req, res) => {
  res.json({ message: 'A Pet Owners Club API is running.' });
});

// Railway/uptime monitors expect a lightweight health check route that
// doesn't touch the database.
app.get('/api/health-check', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Catch-all error handler — without this, an uncaught error in a route
// callback crashes the whole process on a cloud host instead of just
// failing that one request.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ message: 'Server error.', error: err.message });
});

app.use('/api/health-ai', require('./routes/healthAI'));

// Check for due/overdue health reminders once a day at 8:00 AM server time.
cron.schedule('0 8 * * *', () => {
  console.log('Running daily health reminder check...');
  checkAndSendHealthReminders();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
