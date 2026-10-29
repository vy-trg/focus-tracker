const pool = require("./pool");

// 1. Fetch all focus sessions (limit to 50 latest as requested)
async function getAllSessions() {
  const { rows } = await pool.query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT 50");
  return rows;
}

// 2. Insert a new focus session
async function insertSession(label, minutes) {
  // Use RETURNING equivalent for SQLite or standard INSERT
  const result = await pool.query(
    "INSERT INTO sessions (label, minutes) VALUES (?, ?)",
    [label, minutes]
  );
  return result;
}

// 3. Delete a session by ID
async function deleteSession(id) {
  const result = await pool.query("DELETE FROM sessions WHERE id = ?", [id]);
  return result.rowCount; // returns number of affected rows
}

// 4. Get focus statistics (today and overall/weekly)
async function getStats() {
  // For SQLite, we use date('now') for current date comparison
  const todayStatsQuery = await pool.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(minutes), 0) as total_minutes 
     FROM sessions 
     WHERE date(started_at) = date('now')`
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