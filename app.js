const express = require("express");
const app = express();

const db = require("./db/queries");

// Set EJS as the template engine
app.set("view engine", "ejs");

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- EJS VIEW ROUTES ---
app.get("/", async (req, res) => {
  try {
    const sessions = await db.getAllSessions();
    res.render("index", { sessions });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// --- API ENDPOINTS ---

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
    const { label, minutes } = req.body;
    if (!label || !minutes || minutes <= 0) {
      return res.status(400).json({ error: "Invalid label or minutes" });
    }
    await db.insertSession(label, minutes);
    res.status(201).json({ message: "Session created successfully", label, minutes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  }
});

// 3. DELETE /api/sessions/:id: Delete a session by ID
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const sessionId = req.params.id;
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Focus Tracker app listening on port ${PORT}!`);
});