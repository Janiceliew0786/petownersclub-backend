const mysql = require('mysql2');
require('dotenv').config();

// A single db.connect() connection (your FYP1 setup) drops silently if the
// cloud MySQL host closes an idle connection, which happens often on
// Railway/PlanetScale/Aiven free tiers. A pool reconnects per-query instead,
// so the API doesn't die after sitting idle for a few minutes.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'petownersclub',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Most managed MySQL providers (Railway, PlanetScale, Aiven) require TLS.
  // Set DB_SSL=true in production; leave unset for local MySQL Workbench.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Fail fast on startup if the database is unreachable, instead of only
// discovering it on the first API request.
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
  console.log('Connected to MySQL database.');
  connection.release();
});

module.exports = pool;