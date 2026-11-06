# Focus Tracker ⏱️
![CI](https://github.com/vy-trg/focus-tracker/actions/workflows/ci.yml/badge.svg)

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
| `GET` | `/api/sessions?limit=20&before=123` | **Requires login.** One page of your sessions, newest first: `{ sessions, nextBefore }`. `limit` 1–100 (default 20); pass `nextBefore` as `before` for the next page (`null` = no more). See [Pagination](#pagination) |
| `POST` | `/api/sessions` | **Requires login.** Create a session. Body: `{ "label": "Odin Project", "minutes": 25, "category": "study", "task_id": 3 }` (`category` and `task_id` optional). Returns `201` with the new session, or `400` with `errors`. Linking a task that isn't yours returns `400` |
| `PATCH` | `/api/sessions/:id` | **Requires login.** Rate a session: `{ "rating": 1-5 }` |
| `DELETE` | `/api/sessions/:id` | **Requires login.** Delete one of your sessions. `204` on success, `404` if it doesn't exist or isn't yours |
| `GET` | `/api/stats` | **Requires login.** Today, all time, last 7 days, streak and best hour |
| `GET` | `/api/reports?range=day\|week\|month` | **Requires login.** Minutes per day and category for 1, 7 or 30 days (Brisbane time, from midnight; empty days included) and totals. Other ranges return `400` |
| `GET`, `POST` | `/api/tasks` | **Requires login.** Your to-do list / add a task: `{ "title": "...", "estimate": 1-12 }` |
| `PATCH`, `DELETE` | `/api/tasks/:id` | **Requires login.** Mark done or rename / delete. `404` if the task isn't yours |
| `GET` | `/api/health` | `{ ok: true }` (no login needed) |

API routes that require login return `401 { "error": "Please log in" }` without a valid session cookie. `/api` allows 100 requests per 15 minutes per IP; `/login` and `/signup` allow 10.

All queries use parameters (`$1`, `$2`), never string concatenation, so user input can't change the SQL.

---

### Authentication

- **Passwords** are hashed with bcrypt (cost 10) before they reach the database. Only the hash is stored (`$2b$10$…`), and login compares hashes with `bcrypt.compare`.
- **Login sessions** use a signed cookie (`httpOnly`, `sameSite=lax`, `secure` in production). The session itself lives in Postgres (`user_sessions` table, via `connect-pg-simple`), so users stay logged in when Render restarts the app.
- **Every query filters by `user_id`**, taken from the logged-in session, never from the request body. Deleting uses `WHERE id = $1 AND user_id = $2`, so trying to delete someone else's session matches no rows and returns `404`.
- **Login errors don't reveal accounts:** a wrong username and a wrong password show the same message.

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

### Run with Docker

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/). No `.env` or Neon account needed: Compose starts a local PostgreSQL and creates the tables from `db/schema.sql`.

```bash
docker compose up --build
```

Open http://localhost:3000 and sign up. Stop with `Ctrl + C`, then `docker compose down` (add `-v` to also delete the local database).

Production still uses Neon; the Docker database is only for development.

The live demo on Render uses Render's Node runtime; CI builds the Docker image on every pull request to check the Dockerfile still works.

---

## Testing

```bash
npm test
```

Unit tests use Node's built-in test runner (`node:test`), so there's nothing extra to install. They cover `validation.js`, the checks every API request goes through:

- a normal session passes; a 60-character label passes but 61 fails
- minutes must be a whole number from 1 to 180 (`"abc"`, `25.5`, `0`, `-5`, `181`, `null` are rejected)
- an empty, blank or missing label is rejected
- a request with no body returns errors instead of crashing
- `parseId` only accepts positive whole numbers

These tests don't need a database, so they run anywhere, including CI.

---

## Project structure

```
app.js             Express app: routes, validation, API, login sessions
auth.js            Passport login strategy and the requireAuth guard
db/pool.js         PostgreSQL connection pool (SSL for Neon)
db/queries.js      All SQL queries
db/schema.sql      Table definition with CHECK constraints
views/index.ejs    Page layout
views/login.ejs    Log in page
views/signup.ejs   Sign up page
public/timer.js    Timer and API calls in the browser
public/style.css   Styles (light + dark)
scripts/test-db.js Checks the database connection
validation.js      Input checks for the API (unit tested)
test/              Unit tests (npm test)
Dockerfile         Builds the app image (Node 22, runs as a non-root user)
compose.yaml       Local app + PostgreSQL for development
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

## Pagination

`GET /api/sessions` used to return only the latest 50 sessions. Anyone with more than 50 could never see the older ones, and the API didn't say there were more.

There are two common ways to page through a list:

- **OFFSET** (`?page=3` → `LIMIT 20 OFFSET 40`): simple, but the database still reads and throws away the skipped rows, and when a new session is added while you're paging, everything shifts by one, so a page can repeat or skip a session.
- **Keyset / cursor** (`?before=123` → `WHERE id < 123 ORDER BY id DESC LIMIT 20`): each page starts right after the last row you saw. It uses an index, so page 50 is as fast as page 1, and new sessions don't shift older pages.

I used keyset pagination:

```sql
SELECT ... FROM sessions
WHERE user_id = $1 AND ($2::int IS NULL OR id < $2)
ORDER BY id DESC
LIMIT $3 + 1;
```

It fetches one extra row to know whether there is another page, without a `COUNT(*)`. The response is `{ sessions, nextBefore }`, and the "Show more" button asks for the next 10 with `before=nextBefore`. The index `(user_id, id DESC)` (migration `002`) matches the `WHERE` and `ORDER BY`.

## Known limitations & next steps

- No password reset or email verification yet: a forgotten password means a new account.
- Reports group by the day a session **started**, so a session that starts at 11:50pm counts for that day even if it ends after midnight.
