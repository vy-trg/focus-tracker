const pool = require("./pool");

// 1. Fetch all focus sessions (limit to 50 latest as requested)
async function getAllSessions() {
  const { rows } = await pool.query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT 50");
  return rows;
}

// 2. Insert a new focus session (PostgreSQL uses $1, $2 and RETURNING)
async function insertSession(label, minutes) {
  const result = await pool.query(
    "INSERT INTO sessions (label, minutes) VALUES ($1, $2) RETURNING *",
    [label, minutes]
  );
  return result.rows[0];
}

// 3. Delete a session by ID (PostgreSQL uses $1)
async function deleteSession(id) {
  const result = await pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  return result.rowCount; // returns number of affected rows
}

// 4. Get focus statistics (today and overall) using Postgres date casting
async function getStats() {
  const todayStatsQuery = await pool.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(minutes), 0) as total_minutes 
     FROM sessions 
     WHERE started_at::date = CURRENT_DATE`
  );

  const allTimeStatsQuery = await pool.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(minutes), 0) as total_minutes 
     FROM sessions`
  );

  return {
    today: todayStatsQuery.rows[0],
    allTime: allTimeStatsQuery.rows[0],
  };
}

module.exports = {
  getAllSessions,
  insertSession,
  deleteSession,
  getStats,
};