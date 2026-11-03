const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const db = require("./db/pool");

// How passport checks a username and password on login
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const { rows } = await db.query("SELECT * FROM users WHERE username = $1", [username]);
      const user = rows[0];
      // Same message for both cases, so nobody can tell which usernames exist
      if (!user) return done(null, false, { message: "Incorrect username or password" });
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return done(null, false, { message: "Incorrect username or password" });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// Only the user id is stored in the login session...
passport.serializeUser((user, done) => done(null, user.id));

// ...and turned back into a user on every request
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await db.query("SELECT id, username FROM users WHERE id = $1", [id]);
    done(null, rows[0] || false);
  } catch (err) {
    done(err);
  }
});

// Protects pages and API routes
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.originalUrl.startsWith("/api")) {
    return res.status(401).json({ error: "Please log in" });
  }
  res.redirect("/login");
}

module.exports = { passport, requireAuth };