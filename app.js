const express = require("express");
const app = express();

const db = require("./db/queries");

// Set EJS as the template engine
app.set("view engine", "ejs");

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve browser files (timer.js) from the public folder
app.use(express.static("public"));

// --- EJS VIEW ROUTES ---
// The page is a shell; timer.js loads sessions and stats from the API.
app.get("/", (req, res) => {
  res.render("index");
});

// --- VALIDATION HELPERS ---
// Returns a list of problems with the body; an empty list means it is valid.
function validateSession({ label, minutes }) {
  const errors = [];
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 60) {
    errors.push({ field: "label", message: "Label must be 1-60 characters" });
  }
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1 || mins > 180) {
    errors.push({ field: "minutes", message: "Minutes must be a whole number from 1 to 180" });
  }
  return errors;
}

// Route ids must be positive whole numbers, otherwise Postgres throws an error.
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// --- API ENDPOINTS ---

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// 1. GET /api/sessions: Fetch latest 50 sessions as JSON
app.get("/api/sessions", async (req, res) => {
  try {
    const sessions = await db.getAllSessions();
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 2. POST /api/sessions: Create a new session via API
app.post("/api/sessions", async (req, res) => {
  try {
    const errors = validateSession(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const session = await db.insertSession(req.body.label.trim(), Number(req.body.minutes));
    res.status(201).json(session); // includes the new id
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 3. DELETE /api/sessions/:id: Delete a session by ID
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const sessionId = parseId(req.params.id);
    if (sessionId === null) {
      return res.status(400).json({ error: "Id must be a positive whole number" });
    }
    const rowCount = await db.deleteSession(sessionId);

    if (rowCount === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.status(204).send(); // No content for successful deletion
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 4. GET /api/stats: Get focus statistics
app.get("/api/stats", async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// Render (and most hosts) set PORT for you; 3000 is the local default.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Focus Tracker app listening on port ${PORT}!`);
});