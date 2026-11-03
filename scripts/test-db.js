const db = require("../db/pool");

console.log("Attempting to connect to PostgreSQL...");

db.query("SELECT NOW()")
  .then((res) => console.log("✅ CONNECTION SUCCESSFUL! Server time:", res.rows[0].now))
  .catch((err) => console.error("❌ DATABASE CONNECTION ERROR:", err.message))
  .finally(() => db.pool.end());