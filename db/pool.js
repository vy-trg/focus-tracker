require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

// Neon needs SSL; a local Postgres (e.g. Docker) usually does not.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// Neon closes connections that sit idle. That fires an error on the idle
// client; log it and let the pool open a fresh connection next time,
// instead of crashing the whole server.
pool.on("error", (err) => {
  console.error("Idle database client error:", err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};