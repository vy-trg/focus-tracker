const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");

const db = require("./db/queries");
const { pool } = require("./db/pool");
const { passport, requireAuth } = require("./auth");
const { validateSession, parseId } = require("./validation");

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

// --- LOGIN SESSIONS ---
// The login session lives in Postgres (table user_sessions), so users stay
// logged in when Render restarts the app.
app.use(
  session({
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
  })
);
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
app.get("/", requireAuth, (req, res) => {
  res.render("index", { username: req.user.username });
});

// --- API ENDPOINTS ---
// Everything under /api/sessions and /api/stats needs a logged-in user
app.use("/api/sessions", requireAuth);
app.use("/api/stats", requireAuth);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// 1. GET /api/sessions: this user's latest 50 sessions
app.get("/api/sessions", async (req, res) => {
  try {
    const sessions = await db.getAllSessions(req.user.id);
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 2. POST /api/sessions: save a session for this user
app.post("/api/sessions", async (req, res) => {
  try {
    const errors = validateSession(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const session = await db.insertSession(req.user.id, req.body.label.trim(), Number(req.body.minutes));
    res.status(201).json(session); // includes the new id
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

// Render (and most hosts) set PORT for you; 3000 is the local default.
// Only start the server when run directly (node app.js), not when a test imports the app.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Focus Tracker app listening on port ${PORT}!`);
  });
}

module.exports = app;