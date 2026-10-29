const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "focus_tracker.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("Connected to local SQLite database for Focus Tracker.");
  }
});

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = {
  query: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve({ rows });
        });
      } else {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ rowCount: this.changes });
        });
      }
    });
  },
};