# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What the app does

Focus Tracker is a Pomodoro timer. Logged-in users run focus and break timers, and every finished focus session is saved to their account with a category (study, reading, work, journal) and an optional task. The app also has reports, a streak, habits that tick themselves from logged sessions, live study rooms (shared timer over Socket.IO), eye and water reminders, and offline support. Users only ever see their own data.

Stack: Node 20+ (Node 22 in Docker and CI), Express 5, EJS views, vanilla JS frontend (no bundler), PostgreSQL via `pg`, Passport (local) with sessions stored in Postgres, Socket.IO.

## Folder structure

```
app.js             Express app: middleware, page routes, all /api routes, starts the HTTP server
auth.js            Passport local strategy and the requireAuth guard
db/pool.js         pg Pool (SSL comes from the DATABASE_URL sslmode)
db/queries.js      All SQL, parameterized, always filtered by user_id
db/schema.sql      Full schema for fresh databases (also used by Docker)
db/migrations/     Numbered NNN-*.sql changes, applied by hand
validation.js      Input checks for the API
streak.js, habits.js  Pure logic (no I/O)
rooms.js           In-memory study-room state machine (injectable clock, no I/O)
rooms-socket.js    Socket.IO layer for rooms, reuses the session and passport middleware
views/             EJS pages: landing (logged out), index (the app), login, signup
public/timer.js    The whole client (timer, tasks, reports, habits, rooms, offline queue)
public/sw.js       Service worker for offline loading
public/reminders.js  Eye and water reminders
test/              node:test unit tests
docs/              Feature write-ups (habits, study rooms, offline) and README images
focus-ARCHITECTURE.md  Diagrams: components, data flow, timer states, errors
BUGS.md            Log of past incidents and lessons
```

## Run locally

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and SESSION_SECRET
npm run test-db          # checks the database connection
npm run dev              # node --watch, listens on PORT or 3000
```

- `npm run dev` only watches `app.js`, `auth.js`, `db/` and `views/`. Changes to other server files or `public/` need a manual restart or a browser reload.
- Without Neon: `docker compose up --build` starts the app and a local Postgres, and creates the tables from `db/schema.sql`. No `.env` needed.
- For quick manual testing, open the app with `?fast` (for example `http://localhost:3000/?fast`): the timer counts seconds instead of minutes. It only works on `localhost` (`public/timer.js`).

## Tests

```bash
npm test                                                   # all tests
node --test test/streak.test.js                            # one file
node --test --test-name-pattern="pattern" test/*.test.js   # one test by name
```

- `npm test` is `node --test test/*.test.js` on purpose. Plain `node --test` would also run `scripts/test-db.js`, which connects to the real database.
- Tests need no database. Tests that `require("../app")` set a dummy `SESSION_SECRET` and listen on port 0. `rooms-socket.test.js` passes its own `getUser` to `attachRooms` instead of logging in.
- There is no linter or build step.
- CI (`.github/workflows/`): `ci.yml` runs `npm ci && npm test` and a `docker build`; `security.yml` runs Semgrep and Trivy; `gitleaks.yml` scans for secrets.

## Database (Neon) and deploy (Render)

- Production and dev databases are PostgreSQL on Neon. `DATABASE_URL` uses `sslmode=verify-full` for Neon and `sslmode=disable` for local or Docker Postgres. `db/pool.js` logs idle-connection errors instead of crashing, because Neon closes idle connections.
- Login sessions live in the `user_sessions` table (`connect-pg-simple`), so users stay logged in across restarts.
- Schema changes: add a numbered file in `db/migrations/` **and** update `db/schema.sql`. Migrations are applied by hand (Neon SQL Editor), not by the app. Constraints also exist as `CHECK`s in SQL, in addition to `validation.js`.
- Deploy: a Render web service (Node runtime, not Docker) auto-deploys from `main`. Render sets `PORT`. The free tier sleeps, so the first request can take 30 to 60 seconds. `/api/health` returns `{ ok: true }` without login and is used by the Docker `HEALTHCHECK`.
- Environment variables: `DATABASE_URL` and `SESSION_SECRET`; `NODE_ENV=production` makes the session cookie `secure`.

## Gotchas

- `requireAuth` is applied per prefix in `app.js` (`app.use("/api/<x>", requireAuth)`). A new `/api/...` prefix must be added to that list or it is public.
- Every query takes `userId` from `req.user`, never from the request body. Updates and deletes use `WHERE id = $1 AND user_id = $2`, so someone else's id returns `404`, not `403`.
- Time zone: timestamps are `TIMESTAMPTZ` in UTC. "Today", streaks and reports are computed in `Australia/Brisbane` in SQL. Reports group by the day a session started.
- `GET /api/sessions` uses keyset pagination (`before=<id>`, fetches `limit + 1` rows to build `nextBefore`), backed by the `(user_id, id DESC)` index from migration 002.
- Study rooms live in process memory: a restart loses them and they won't work across multiple instances. The server owns each room's clock.
- Habits have no manual tick: progress is derived from logged sessions by category and target.
- The timer counts to a fixed end timestamp rather than ticking, so background tabs stay accurate. Sessions finished offline are queued on the device and deduplicated when sent (`docs/offline.md`).
- `test/landing.test.js` fails if a landing-page tile mentions a feature the app doesn't have.
- `.gitignore` covers `.env.*` except `.env.example`, and `.pre-commit-config.yaml` runs a gitleaks hook (see BUGS.md for why it is set up that way).
