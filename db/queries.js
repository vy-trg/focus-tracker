const pool = require("./pool");

// 1. Fetch this user's latest 50 sessions
async function getAllSessions(userId) {
  const { rows } = await pool.query(
    "SELECT id, label, minutes, started_at FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 50",
    [userId]
  );
  return rows;
}

// 2. Insert a new focus session for this user (PostgreSQL uses $1, $2 and RETURNING)
async function insertSession(userId, label, minutes) {
  const result = await pool.query(
    "INSERT INTO sessions (user_id, label, minutes) VALUES ($1, $2, $3) RETURNING id, label, minutes, started_at",
    [userId, label, minutes]
  );
  return result.rows[0];
}

// 3. Delete one of this user's sessions
async function deleteSession(id, userId) {
  // user_id in the WHERE: deleting someone else's session matches 0 rows -> 404
  const result = await pool.query("DELETE FROM sessions WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount; // number of rows deleted
}

// 4. Get this user's focus statistics (today and all time).
// The database runs in UTC, so "today" is converted to Brisbane time first,
// otherwise sessions before 10am Brisbane time would count as yesterday.
async function getStats(userId) {
  const today = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(minutes), 0)::int AS total_minutes
     FROM sessions
     WHERE user_id = $1
       AND (started_at AT TIME ZONE 'Australia/Brisbane')::date
         = (now() AT TIME ZONE 'Australia/Brisbane')::date`,
    [userId]
  );

  const allTime = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(minutes), 0)::int AS total_minutes
     FROM sessions
     WHERE user_id = $1`,
    [userId]
  );

  return {
    today: today.rows[0],
    allTime: allTime.rows[0],
  };
}

module.exports = {
  getAllSessions,
  insertSession,
  deleteSession,
  getStats,
};