const pool = require("./pool");
const { countStreak } = require("../streak");

// Every query filters on user_id, so a user can only ever see or change their own rows.

// ---------- Sessions ----------

// 1. This user's latest 50 sessions, with the task title when the session was for a task
async function getAllSessions(userId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.label, s.minutes, s.category, s.task_id, s.rating, s.started_at,
            t.title AS task_title
     FROM sessions s
     LEFT JOIN tasks t ON t.id = s.task_id
     WHERE s.user_id = $1
     ORDER BY s.started_at DESC
     LIMIT 50`,
    [userId]
  );
  return rows;
}

// 2. Save a finished focus session
async function insertSession(userId, { label, minutes, category, taskId }) {
  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id, label, minutes, category, task_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, label, minutes, category, task_id, rating, started_at`,
    [userId, label, minutes, category, taskId]
  );
  return rows[0];
}

// 3. Delete one of this user's sessions (0 rows deleted -> the route answers 404)
async function deleteSession(id, userId) {
  const result = await pool.query("DELETE FROM sessions WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount;
}

// 4. Save "How focused did you feel?" (1-5) on one of this user's sessions
async function rateSession(id, userId, rating) {
  const result = await pool.query("UPDATE sessions SET rating = $3 WHERE id = $1 AND user_id = $2", [
    id,
    userId,
    rating,
  ]);
  return result.rowCount;
}

// ---------- Stats ----------
// The database runs in UTC, so dates are converted to Brisbane time first,
// otherwise sessions before 10am Brisbane time would count as yesterday.
const LOCAL_DAY = "(started_at AT TIME ZONE 'Australia/Brisbane')::date";
const TODAY = "(now() AT TIME ZONE 'Australia/Brisbane')::date";

async function getStats(userId) {
  const today = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(minutes), 0)::int AS total_minutes
     FROM sessions WHERE user_id = $1 AND ${LOCAL_DAY} = ${TODAY}`,
    [userId]
  );

  const allTime = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(minutes), 0)::int AS total_minutes
     FROM sessions WHERE user_id = $1`,
    [userId]
  );

  // Minutes per day for the last 7 days, including days with 0 minutes
  const week = await pool.query(
    `SELECT d::date AS day, COALESCE(SUM(s.minutes), 0)::int AS minutes
     FROM generate_series(${TODAY} - 6, ${TODAY}, interval '1 day') AS d
     LEFT JOIN sessions s
       ON s.user_id = $1 AND (s.started_at AT TIME ZONE 'Australia/Brisbane')::date = d::date
     GROUP BY d ORDER BY d`,
    [userId]
  );

  // Streak: how many days in a row (ending today, or yesterday if nothing yet today) had a session
  const days = await pool.query(
    `SELECT DISTINCT ${LOCAL_DAY} AS day FROM sessions
     WHERE user_id = $1 AND ${LOCAL_DAY} > ${TODAY} - 366
     ORDER BY day DESC`,
    [userId]
  );

  // Which hour of the day most focus minutes happen in (null when there is no data yet)
  const bestHour = await pool.query(
    `SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'Australia/Brisbane')::int AS hour
     FROM sessions WHERE user_id = $1
     GROUP BY hour ORDER BY SUM(minutes) DESC, hour LIMIT 1`,
    [userId]
  );

  return {
    today: today.rows[0],
    allTime: allTime.rows[0],
    week: week.rows.map((r) => ({ day: toIsoDate(r.day), minutes: r.minutes })),
    streak: countStreak(days.rows.map((r) => toIsoDate(r.day)), todayInBrisbane()),
    bestHour: bestHour.rows[0] ? bestHour.rows[0].hour : null,
  };
}

// node-postgres turns a DATE into a JS Date at local midnight; turn it back into "YYYY-MM-DD"
function toIsoDate(d) {
  if (typeof d === "string") return d.slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayInBrisbane() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());
}

// ---------- Tasks ----------

// Open tasks first (oldest first), then done ones; with how many focus sessions each has had
async function getTasks(userId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.estimate, t.done, t.created_at,
            COUNT(s.id)::int AS pomodoros
     FROM tasks t
     LEFT JOIN sessions s ON s.task_id = t.id
     WHERE t.user_id = $1
     GROUP BY t.id
     ORDER BY t.done, t.created_at
     LIMIT 100`,
    [userId]
  );
  return rows;
}

async function insertTask(userId, title, estimate) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (user_id, title, estimate) VALUES ($1, $2, $3)
     RETURNING id, title, estimate, done, created_at, 0 AS pomodoros`,
    [userId, title, estimate]
  );
  return rows[0];
}

// Change done and/or title. COALESCE keeps the old value when a field is not sent.
async function updateTask(id, userId, { done, title }) {
  const { rows } = await pool.query(
    `UPDATE tasks SET done = COALESCE($3, done), title = COALESCE($4, title)
     WHERE id = $1 AND user_id = $2
     RETURNING id, title, estimate, done, created_at`,
    [id, userId, done ?? null, title ?? null]
  );
  return rows[0] || null;
}

async function deleteTask(id, userId) {
  const result = await pool.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount;
}

// Used before saving a session: the task must exist AND belong to this user
async function taskBelongsToUser(taskId, userId) {
  const { rowCount } = await pool.query("SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
  return rowCount === 1;
}

module.exports = {
  getAllSessions,
  insertSession,
  deleteSession,
  rateSession,
  getStats,
  getTasks,
  insertTask,
  updateTask,
  deleteTask,
  taskBelongsToUser,
};
