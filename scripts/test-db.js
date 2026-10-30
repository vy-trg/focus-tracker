require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

console.log("Attempting to connect to Neon PostgreSQL...");

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ DATABASE CONNECTION ERROR:", err);
  } else {
    console.log("✅ CONNECTION SUCCESSFUL! Server timestamp from DB:", res.rows[0].now);
  }
  pool.end();
});