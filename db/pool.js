require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

// SSL settings come from DATABASE_URL: sslmode=verify-full for Neon
// (checks the server certificate), sslmode=disable for a local or Docker Postgres.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Neon closes connections that sit idle. That fires an error on the idle
// client; log it and let the pool open a fresh connection next time,
// instead of crashing the whole server.
pool.on("error", (err) => {
  console.error("Idle database client error:", err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};