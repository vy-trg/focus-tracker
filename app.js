const path = require("node:path");
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const { attachRooms } = require("./rooms-socket");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");

const db = require("./db/queries");
const { pool } = require("./db/pool");
const { passport, requireAuth } = require("./auth");
const {
  validateSession,
  validateTask,
  validateTaskUpdate,
  validateRating,
  parseId,
  parseRange,
  parseLimit,
  validateHabit,
} = require("./validation");

const app = express();

// Render sits in front of the app as a proxy; trust it so rate limiting
// sees the real visitor IP and secure cookies work over HTTPS.
app.set("trust proxy", 1);

// Security headers (Content-Security-Policy, no sniffing, etc.)
app.use(helmet());

// Set EJS as the template engine
app.set("view engine", "ejs");

// Parse JSON and form bodies, capped at 10kb so nobody can send a huge payload
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// Serve browser files (timer.js, style.css) from the public folder
app.use(express.static("public"));
// The DM Sans font files come from an npm package and are served by the app itself,
// so the page needs no Google Fonts request and the CSP can stay strict.
app.use(
  "/fonts/dm-sans",
  express.static(path.join(__dirname, "node_modules/@fontsource-variable/dm-sans/files"), { maxAge: "30d" })
);

// --- LOGIN SESSIONS ---
// The login session lives in Postgres (table user_sessions), so users stay
// logged in when Render restarts the app.
const sessionMiddleware = session({
  store: new PgStore({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true, // page JavaScript can't read the cookie
    sameSite: "lax", // not sent on cross-site POSTs
    secure: process.env.NODE_ENV === "production", // HTTPS only on Render
  },
});
app.use(sessionMiddleware);
app.use(passport.session());

// --- RATE LIMITS ---
// Every visitor (by IP): at most 100 API requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
// Login and signup: at most 10 tries per 15 minutes, to slow down password guessing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// --- AUTH ROUTES ---
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

app.get("/signup", (req, res) => {
  res.render("signup", { error: null, username: "" });
});

app.post("/signup", authLimiter, async (req, res, next) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!USERNAME_RE.test(username)) {
    return res.status(400).render("signup", { error: "Username: 3-30 letters, numbers or _", username });
  }
  if (password.length < 8) {
    return res.status(400).render("signup", { error: "Password must be at least 8 characters", username });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, hash]
    );
    // Log the new user straight in
    req.login(rows[0], (err) => (err ? next(err) : res.redirect("/")));
  } catch (err) {
    if (err.code === "23505") {
      // 23505 = unique_violation: username already taken
      return res.status(400).render("signup", { error: "That username is taken", username });
    }
    next(err);
  }
});

app.get("/login", (req, res) => {
  res.render("login", { error: req.query.error ? "Incorrect username or password" : null });
});

app.post(
  "/login",
  authLimiter,
  passport.authenticate("local", { successRedirect: "/", failureRedirect: "/login?error=1" })
);

app.post("/logout", (req, res, next) => {
  req.logout((err) => (err ? next(err) : res.redirect("/login")));
});

// --- EJS VIEW ROUTES ---
// The page is a shell; timer.js loads sessions and stats from the API.
// Logged out: the landing page. Logged in: the timer app.
app.get("/", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.render("landing");
  }
  res.render("index", { username: req.user.username });
});

// --- API ENDPOINTS ---
// Everything under /api/sessions and /api/stats needs a logged-in user
app.use("/api/sessions", requireAuth);
app.use("/api/stats", requireAuth);
app.use("/api/tasks", requireAuth);
app.use("/api/habits", requireAuth);
app.use("/api/reports", requireAuth);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// 1. GET /api/sessions?limit=20&before=123: one page of this user's sessions, newest first.
// Returns { sessions, nextBefore }; pass nextBefore as `before` to get the next page (null = no more).
app.get("/api/sessions", async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const before = req.query.before === undefined ? null : parseId(req.query.before);
  if (limit === null || (req.query.before !== undefined && before === null)) {
    return res.status(400).json({ error: "limit must be 1-100 and before must be a positive whole number" });
  }
  try {
    res.json(await db.getSessionsPage(req.user.id, limit, before));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 2. POST /api/sessions: save a finished focus session for this user
app.post("/api/sessions", async (req, res) => {
  try {
    const errors = validateSession(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const taskId = req.body.task_id == null ? null : Number(req.body.task_id);
    // A task id from the browser can't be trusted: it must be one of THIS user's tasks
    if (taskId !== null && !(await db.taskBelongsToUser(taskId, req.user.id))) {
      return res.status(400).json({ errors: [{ field: "task_id", message: "Unknown task" }] });
    }
    const session = await db.insertSession(req.user.id, {
      label: req.body.label.trim(),
      minutes: Number(req.body.minutes),
      category: req.body.category || "study",
      taskId,
    });
    res.status(201).json(session); // includes the new id
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// PATCH /api/sessions/:id: save "How focused did you feel?" (1-5)
app.patch("/api/sessions/:id", async (req, res) => {
  try {
    const sessionId = parseId(req.params.id);
    if (sessionId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const errors = validateRating(req.body.rating);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const rowCount = await db.rateSession(sessionId, req.user.id, req.body.rating);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 3. DELETE /api/sessions/:id: delete one of this user's sessions
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const sessionId = parseId(req.params.id);
    if (sessionId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const rowCount = await db.deleteSession(sessionId, req.user.id);

    if (rowCount === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.status(204).send(); // No content for successful deletion
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 4. GET /api/stats: this user's focus statistics
app.get("/api/stats", async (req, res) => {
  try {
    const stats = await db.getStats(req.user.id);
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 5. GET /api/reports?range=day|week|month: minutes per day and category
app.get("/api/reports", async (req, res) => {
  const days = parseRange(req.query.range);
  if (days === null) {
    return res.status(400).json({ error: "range must be day, week or month" });
  }
  try {
    res.json(await db.getReport(req.user.id, days));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// --- TASKS (to-do list) ---
app.get("/api/tasks", async (req, res) => {
  try {
    res.json(await db.getTasks(req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const errors = validateTask(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const task = await db.insertTask(req.user.id, req.body.title.trim(), Number(req.body.estimate ?? 1));
    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const taskId = parseId(req.params.id);
    if (taskId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const errors = validateTaskUpdate(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const title = typeof req.body.title === "string" ? req.body.title.trim() : undefined;
    const task = await db.updateTask(taskId, req.user.id, { done: req.body.done, title });
    if (!task) {
      return res.status(404).json({ error: "Task not found" }); // not found OR not yours
    }
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const taskId = parseId(req.params.id);
    if (taskId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const rowCount = await db.deleteTask(taskId, req.user.id);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// ---------- Habits ----------
// "2 study sessions a day". Done-today and streak are worked out from sessions (see habits.js).

app.get("/api/habits", async (req, res) => {
  try {
    res.json(await db.getHabitsWithProgress(req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

app.post("/api/habits", async (req, res) => {
  try {
    const errors = validateHabit(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const { name, category, target_sessions } = req.body;
    const habit = await db.insertHabit(req.user.id, { name: name.trim(), category, target_sessions });
    res.status(201).json(habit);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

app.patch("/api/habits/:id", async (req, res) => {
  try {
    const habitId = parseId(req.params.id);
    if (habitId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const errors = validateHabit(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const { name, category, target_sessions } = req.body;
    const habit = await db.updateHabit(habitId, req.user.id, {
      name: typeof name === "string" ? name.trim() : undefined,
      category,
      target_sessions,
    });
    if (!habit) {
      return res.status(404).json({ error: "Habit not found" }); // not found OR not yours
    }
    res.json(habit);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

app.delete("/api/habits/:id", async (req, res) => {
  try {
    const habitId = parseId(req.params.id);
    if (habitId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const rowCount = await db.deleteHabit(habitId, req.user.id);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Habit not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// Render (and most hosts) set PORT for you; 3000 is the local default.
// Only start the server when run directly (node app.js), not when a test imports the app.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // One http server for the pages and the study rooms (Socket.IO). The rooms read the same
  // login cookie as the pages, so only logged-in people can join.
  const server = http.createServer(app);
  attachRooms(server, { middlewares: [sessionMiddleware, passport.session()] });
  server.listen(PORT, () => {
    console.log(`Focus Tracker app listening on port ${PORT}!`);
  });
}

module.exports = app;