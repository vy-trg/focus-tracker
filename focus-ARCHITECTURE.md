# Focus Tracker – Architecture

Covers accounts, categories, tasks, reports, habits, study rooms, offline sessions, health reminders, CI and Docker. If this file and the code disagree, the code is right: please fix this file.

## 1. Architecture diagram

Components, libraries, servers and APIs, and how they connect.

```mermaid
flowchart LR
    subgraph Browser["Browser (desktop or phone)"]
        UI["landing.ejs, index.ejs,<br/>login/signup.ejs + style.css"]
        JS["timer.js, reminders.js<br/>vanilla JS, fetch()"]
        Queue["Offline queue<br/>(localStorage)"]
        SW["sw.js<br/>service worker"]
    end

    subgraph Render["Render – free web service"]
        subgraph Node["Node.js + Express 5 (app.js)"]
            Sec["helmet + express-rate-limit"]
            Auth["Passport local + bcrypt<br/>express-session (cookie)"]
            View["GET / → landing or app<br/>/login, /signup, /logout"]
            API["REST API (requireAuth)<br/>/api/sessions, /api/tasks, /api/stats,<br/>/api/reports, /api/habits, /api/reminders"]
            Health["GET /api/health<br/>(no login)"]
            Val["validation.js<br/>validateSession(), parseRange()…"]
            Logic["streak.js, habits.js<br/>pure logic, no I/O"]
            Sock["rooms-socket.js<br/>Socket.IO, same login cookie"]
            Rooms["rooms.js<br/>study rooms, in memory"]
        end
        Q["db/queries.js<br/>SQL with $1, every query filters by user_id"]
        Pool["db/pool.js<br/>pg Pool, SSL verify-full"]
    end

    DB[("Neon PostgreSQL<br/>users, sessions, tasks, habits,<br/>health_breaks, user_sessions")]
    subgraph GH["GitHub"]
        CI["Actions on every PR<br/>tests · gitleaks · Semgrep · Trivy · Docker build"]
        Main["main (protected)"]
    end
    Docker["docker compose<br/>app + Postgres locally"]

    UI --- JS
    UI -- "pages" --> View
    JS --- Queue
    SW -. "caches the app files" .-> UI
    JS -- "JSON over HTTP + session cookie" --> Sec --> Auth --> API
    JS -- "WebSocket (study rooms)" --> Sock --> Rooms
    Sock -. "reuses session + passport" .-> Auth
    API --> Val --> Q --> Pool
    Q --> Logic
    Auth --> Q
    Pool -- "TLS" --> DB
    CI -. "green before merge" .-> Main
    Main -. "auto-deploy" .-> Render
    Docker -. "same app, local database" .-> Node
```

| Layer | Technology |
|---|---|
| Frontend | HTML (EJS), CSS, vanilla JavaScript, service worker |
| Server | Node.js, Express 5, EJS |
| Realtime | Socket.IO (study rooms) |
| Database access | `pg` (node-postgres), `dotenv` |
| Database | PostgreSQL on Neon (free tier) |
| Hosting | Render (free web service), GitHub for source and deploys |

## 2. Data flow: finishing a focus session

Every finished session goes into a queue on the device first (`localStorage`), with an id made in the browser (`client_id`) and the time it finished (`finished_at`). The queue is then sent to the server. That way a session finished offline is not lost, and a session sent twice is saved once.

```mermaid
sequenceDiagram
    actor User
    participant B as Browser (timer.js)
    participant S as Express (app.js)
    participant D as Neon PostgreSQL

    User->>B: Type label, press Start
    Note over B: Count down to a fixed end time<br/>(stays correct in background tabs)
    B->>B: Timer reaches 00:00
    B->>B: Add {label, minutes, category, task_id,<br/>client_id, finished_at} to the queue
    B->>S: POST /api/sessions
    alt no connection (offline)
        S--xB: request fails
        B-->>User: "Kept on this device, sent when you're back online"
        Note over B: Sent again when the browser comes back online,<br/>when the page loads, and every 30 seconds while it keeps failing
    else reached the server
        S->>S: validateSession()
        alt invalid input
            S-->>B: 400 {errors: [...]}
            B-->>User: Show message, session leaves the queue
        else task_id is not this user's task
            S-->>B: 400 {errors: [{field: "task_id"}]}
        else valid
            S->>D: INSERT ... ON CONFLICT (user_id, client_id) DO NOTHING RETURNING ...
            alt new session
                D-->>S: new row
                S-->>B: 201 + session
            else same client_id already saved
                D-->>S: no row, SELECT the old one
                S-->>B: 200 + the existing session (no second copy)
            end
            par refresh the page data
                B->>S: GET /api/sessions?limit=20
                S->>D: SELECT ... WHERE id < before ORDER BY id DESC LIMIT 21
                D-->>S: rows
                S-->>B: 200 {sessions, nextBefore}
            and
                B->>S: GET /api/stats
                S->>D: COUNT / SUM for today (Brisbane time) and all time
                D-->>S: numbers
                S-->>B: 200 {today, allTime, ...}
            end
            B-->>User: "Session saved", list and stats updated
            User->>B: Pick a rating (1-5), optional
            B->>S: PATCH /api/sessions/:id {rating}
        end
    end
```

## 3. State diagram: the timer

The timer has three modes: focus, short break and long break. After `settings.every` focus sessions the next break is a long one.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Idle: Start with empty label (focus) / show error
    Idle --> Running: Start
    Running --> Paused: Pause
    Paused --> Running: Resume
    Running --> Idle: Reset
    Paused --> Idle: Reset
    Idle --> Idle: Skip (to the next mode, nothing is saved)
    Running --> Saving: focus reaches 00:00
    Saving --> BreakReady: queued and sent (saved, or kept on the device if offline)
    BreakReady --> Running: Start break (or automatically if "auto" is on)
    Running --> Idle: break reaches 00:00 / back to focus
```

`BreakReady` shows the "Nice work" panel with the 1-5 rating. A request that fails because of the connection or a server error does not lose the session: it stays in the queue and is retried. A session the server refuses for good (for example, its task was deleted, or it is too old) is dropped from the queue with a message, so it does not block the sessions behind it.

## 4. Error handling

| Situation | Response |
|---|---|
| Not logged in | `401 { "error": "Please log in" }` |
| Too many requests | `429` (100 per 15 minutes on `/api`, 10 on `/login` and `/signup`, per IP) |
| Bad label or minutes | `400` with field errors |
| Id is not a positive integer | `400` |
| `task_id` is not this user's task | `400` (`Unknown task`) |
| Session id not found, or not yours | `404` |
| The same offline session is sent twice | `200` with the existing session |
| Database or unexpected error | `500` (no SQL details leaked) |
| Neon drops an idle connection | Logged; the pool opens a new connection next time |

## 5. Study rooms

Study rooms are a live shared timer over Socket.IO (`rooms-socket.js`). The socket reads the same login cookie as the pages, so only logged-in users can connect. `rooms.js` holds the room state in the server's memory and the server owns the clock, so rooms are lost on a restart and do not work across several server instances. Details: `docs/study-rooms.md`. Habits and offline sessions are explained in `docs/habits.md` and `docs/offline.md`.
