const pool = require("./pool");
const { CATEGORIES } = require("../validation");
const { countStreak, longestStreak } = require("../streak");

// Every query filters on user_id, so a user can only ever see or change their own rows.

// ---------- Sessions ----------

// 1. This user's latest 50 sessions, with the task title when the session was for a task
// One page of this user's sessions, newest first, using keyset pagination:
// `before` is the id of the last session on the previous page (null for the first page).
// One extra row is fetched to know whether another page exists, without a COUNT(*).
async function getSessionsPage(userId, limit, before) {
  const { rows } = await pool.query(
    `SELECT s.id, s.label, s.minutes, s.category, s.task_id, s.rating, s.started_at,
            t.title AS task_title
     FROM sessions s
     LEFT JOIN tasks t ON t.id = s.task_id
     WHERE s.user_id = $1 AND ($2::int IS NULL OR s.id < $2)
     ORDER BY s.id DESC
     LIMIT $3`,
    [userId, before, limit + 1]
  );
  const hasMore = rows.length > limit;
  const sessions = rows.slice(0, limit);
  return { sessions, nextBefore: hasMore ? sessions[sessions.length - 1].id : null };
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
    bestStreak: longestStreak(days.rows.map((r) => toIsoDate(r.day))),
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

// Minutes per day and category for the last `days` days in Brisbane time, starting at midnight
// of the first day. Days with no sessions are still returned (with 0 minutes), so gaps show up.
async function getReport(userId, days) {
  const { rows } = await pool.query(
    `SELECT d::date AS day, s.category, COALESCE(SUM(s.minutes), 0)::int AS minutes
     FROM generate_series(${TODAY} - ($2::int - 1), ${TODAY}, interval '1 day') AS d
     LEFT JOIN sessions s
       ON s.user_id = $1 AND (s.started_at AT TIME ZONE 'Australia/Brisbane')::date = d::date
     GROUP BY d, s.category
     ORDER BY d`,
    [userId, days]
  );

  // One entry per day: { day, study, reading, work, journal }, plus totals per category
  const byDay = new Map();
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const r of rows) {
    const day = toIsoDate(r.day);
    if (!byDay.has(day)) byDay.set(day, { day, ...Object.fromEntries(CATEGORIES.map((c) => [c, 0])) });
    if (r.category) {
      byDay.get(day)[r.category] += r.minutes;
      totals[r.category] += r.minutes;
    }
  }
  return { days: [...byDay.values()], totals };
}

// ---------- Habits ----------
// Every query filters by user_id, so one person can never read or change another's habits.

async function getHabits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, category, target_sessions, created_at
     FROM habits WHERE user_id = $1 ORDER BY created_at, id`,
    [userId]
  );
  return rows;
}

async function insertHabit(userId, { name, category, target_sessions }) {
  const { rows } = await pool.query(
    `INSERT INTO habits (user_id, name, category, target_sessions) VALUES ($1, $2, $3, $4)
     RETURNING id, name, category, target_sessions, created_at`,
    [userId, name, category, target_sessions]
  );
  return rows[0];
}

// Only the fields sent change (COALESCE keeps the old value for the others). null = not found or not yours.
async function updateHabit(id, userId, { name, category, target_sessions }) {
  const { rows } = await pool.query(
    `UPDATE habits SET name = COALESCE($3, name), category = COALESCE($4, category),
            target_sessions = COALESCE($5, target_sessions)
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, category, target_sessions, created_at`,
    [id, userId, name ?? null, category ?? null, target_sessions ?? null]
  );
  return rows[0] ?? null;
}

async function deleteHabit(id, userId) {
  const result = await pool.query("DELETE FROM habits WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount;
}

module.exports = {
  getHabits,
  insertHabit,
  updateHabit,
  deleteHabit,
  getReport,
  getSessionsPage,
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
