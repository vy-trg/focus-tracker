# Focus Tracker ⏱️

A Pomodoro timer that saves every finished focus session to PostgreSQL and shows how much you focused today. Built with Express and a small REST API; the browser talks to the API with `fetch`.

🔗 **[Live Demo](https://focus-tracker-2ooe.onrender.com)** *(free hosting: the first load can take 30–60 seconds while the server wakes up)*

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
    <img src="docs/screenshot-light.png" alt="Focus Tracker showing the timer, today's stats and recent sessions" width="360">
  </picture>
</p>

---

## Features

- **User accounts:** sign up and log in; each person only sees, adds and deletes their own sessions.
- **25-minute focus timer** with Start, Pause/Resume and Reset. The countdown also shows in the browser tab.
- **Sessions saved automatically** when the timer finishes (`POST /api/sessions`).
- **Recent sessions** list with delete, and **stats** for today and all time.
- **Accurate on phones:** the timer counts down to a fixed end time, so it stays correct even when the phone slows down a background tab.
- **Validation on the server and in the database:** labels must be 1–60 characters and minutes 1–180; bad input gets a `400` with a clear message.
- **"Today" means today in Brisbane:** the database runs in UTC, so stats convert to `Australia/Brisbane` first.
- Light and dark mode, sized for phones.

---

## Tech Stack

| Area | Tools |
|---|---|
| Server | Node.js 20+, Express 5, EJS |
| Database | PostgreSQL on [Neon](https://neon.tech), `pg` driver |
| Auth | Passport (local strategy), bcrypt, express-session with sessions stored in Postgres |
| Security | helmet (security headers), express-rate-limit, gitleaks (secret scanning) |
| Frontend | HTML, CSS, vanilla JavaScript (`fetch`) |
| Hosting | Render (free web service) |

---

## API

| Method | Path | What it does |
|---|---|---|
| `GET` | `/signup`, `/login` | Sign up and log in pages |
| `POST` | `/signup` | Create an account and log in. Username 3–30 letters, numbers or `_`; password at least 8 characters |
| `POST` | `/login` | Log in. Wrong username or password both show the same message |
| `POST` | `/logout` | Log out (POST, so a link on another site can't log you out) |
| `GET` | `/api/sessions` | **Requires login.** Your latest 50 sessions, newest first |
| `POST` | `/api/sessions` | **Requires login.** Create a session. Body: `{ "label": "Odin Project", "minutes": 25 }`. Returns `201` with the new session, or `400` with `errors` |
| `DELETE` | `/api/sessions/:id` | **Requires login.** Delete one of your sessions. `204` on success, `404` if it doesn't exist or isn't yours |
| `GET` | `/api/stats` | **Requires login.** `{ today: { count, total_minutes }, allTime: { count, total_minutes } }` for you |
| `GET` | `/api/health` | `{ ok: true }` (no login needed) |

API routes that require login return `401 { "error": "Please log in" }` without a valid session cookie. `/api` allows 100 requests per 15 minutes per IP; `/login` and `/signup` allow 10.

All queries use parameters (`$1`, `$2`), never string concatenation, so user input can't change the SQL.

---

## Run it locally

**Needs:** Node.js 20 or newer and a PostgreSQL database (a free [Neon](https://neon.tech) project works).

```bash
git clone https://github.com/vy-trg/focus-tracker.git
cd focus-tracker
npm install
cp .env.example .env
```

1. Fill in `.env`:
   - `DATABASE_URL=postgresql://...` (I use a separate Neon **dev branch** locally, so testing never touches the live data)
   - `SESSION_SECRET=` a long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Create the tables: run `db/schema.sql` once in the Neon SQL Editor.
3. Check the connection: `npm run test-db`
4. Start the app: `npm run dev`, then open http://localhost:3000

**Testing tip:** set `FOCUS_SECONDS` in `public/timer.js` to `10` so you don't wait 25 minutes. Set it back before committing.

---

## Project structure

```
app.js            Express app: routes, validation, API, login sessions
auth.js           Passport login strategy and the requireAuth guard
db/pool.js        PostgreSQL connection pool (SSL for Neon)
db/queries.js     All SQL queries
db/schema.sql     Table definition with CHECK constraints
views/index.ejs   Page layout
views/login.ejs   Log in page
views/signup.ejs  Sign up page
public/timer.js   Timer and API calls in the browser
public/style.css  Styles (light + dark)
scripts/test-db.js  Checks the database connection
```

---

## What I learned

- Designing a small REST API and returning the right status codes (`201`, `204`, `400`, `404`).
- Validating input twice: in Express for clear error messages, and with `CHECK` constraints so the database never stores bad data.
- Time zones: storing `TIMESTAMPTZ` in UTC and converting to Brisbane time when counting "today".
- Why `setInterval` timers drift on phones, and how counting to an end time fixes it.
- Deploying to Render with the database URL as an environment variable, never in the repo.
- Authentication: hashing passwords with bcrypt, cookie-based sessions stored in Postgres, and scoping every query by `user_id` so users can't read or delete each other's data.
- Testing a database change on a Neon branch first, then running it on production right before merging, so the live app was only down for a few minutes.

---

## Known limitations & next steps

- The focus length is fixed at 25 minutes. Next: let the user pick the length and add short breaks between sessions.
- A notification or sound when the timer ends, so it works with the tab in the background.
- No password reset or email verification yet: a forgotten password means a new account.

---

### Authentication

- **Passwords** are hashed with bcrypt (cost 10) before they reach the database. Only the hash is stored (`$2b$10$…`), and login compares hashes with `bcrypt.compare`.
- **Login sessions** use a signed cookie (`httpOnly`, `sameSite=lax`, `secure` in production). The session itself lives in Postgres (`user_sessions` table, via `connect-pg-simple`), so users stay logged in when Render restarts the app.
- **Every query filters by `user_id`**, taken from the logged-in session, never from the request body. Deleting uses `WHERE id = $1 AND user_id = $2`, so trying to delete someone else's session matches no rows and returns `404`.
- **Login errors don't reveal accounts:** a wrong username and a wrong password show the same message.