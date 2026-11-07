# Focus Tracker – Architecture

Updated 8 Nov: accounts, categories, tasks, reports, CI and Docker.

## 1. Architecture diagram

Components, libraries, servers and APIs, and how they connect.

```mermaid
flowchart LR
    subgraph Browser["Browser (desktop or phone)"]
        UI["landing.ejs, index.ejs,<br/>login/signup.ejs + style.css"]
        JS["timer.js<br/>vanilla JS, fetch()"]
    end

    subgraph Render["Render – free web service"]
        subgraph Node["Node.js + Express 5 (app.js)"]
            Sec["helmet + express-rate-limit"]
            Auth["Passport local + bcrypt<br/>express-session (cookie)"]
            View["GET / → landing or app<br/>/login, /signup, /logout"]
            API["REST API (requireAuth)<br/>/api/sessions, /api/tasks,<br/>/api/stats, /api/reports"]
            Val["validation.js<br/>validateSession(), parseRange()…"]
        end
        Q["db/queries.js<br/>SQL with $1, every query filters by user_id"]
        Pool["db/pool.js<br/>pg Pool, SSL verify-full"]
    end

    DB[("Neon PostgreSQL<br/>users, sessions, tasks,<br/>user_sessions")]
    subgraph GH["GitHub"]
        CI["Actions on every PR<br/>tests · gitleaks · Docker build"]
        Main["main (protected)"]
    end
    Docker["docker compose<br/>app + Postgres locally"]

    UI --- JS
    UI -- "pages" --> View
    JS -- "JSON over HTTP + session cookie" --> Sec --> Auth --> API
    API --> Val --> Q --> Pool
    Auth --> Q
    Pool -- "TLS" --> DB
    CI -. "green before merge" .-> Main
    Main -. "auto-deploy" .-> Render
    Docker -. "same app, local database" .-> Node
```

| Layer | Technology |
|---|---|
| Frontend | HTML (EJS), CSS, vanilla JavaScript |
| Server | Node.js, Express 5, EJS |
| Database access | `pg` (node-postgres), `dotenv` |
| Database | PostgreSQL on Neon (free tier) |
| Hosting | Render (free web service), GitHub for source and deploys |

## 2. Data flow: finishing a focus session

```mermaid
sequenceDiagram
    actor User
    participant B as Browser (timer.js)
    participant S as Express (app.js)
    participant D as Neon PostgreSQL

    User->>B: Type label, press Start
    Note over B: Count down to a fixed end time<br/>(stays correct in background tabs)
    B->>B: Timer reaches 00:00
    B->>S: POST /api/sessions {label, minutes}
    S->>S: validateSession()
    alt invalid input
        S-->>B: 400 {errors: [...]}
        B-->>User: Show error message
    else valid
        S->>D: INSERT ... VALUES ($1, $2) RETURNING *
        D-->>S: new row (id, label, minutes, started_at)
        S-->>B: 201 + session
        par refresh the page data
            B->>S: GET /api/sessions
            S->>D: SELECT ... ORDER BY started_at DESC LIMIT 50
            D-->>S: rows
            S-->>B: 200 [sessions]
        and
            B->>S: GET /api/stats
            S->>D: COUNT / SUM for today (Brisbane time) and all time
            D-->>S: numbers
            S-->>B: 200 {today, allTime}
        end
        B-->>User: "Session saved", list and stats updated
    end
```

## 3. State diagram: the timer

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Running: Start (label not empty)
    Idle --> Idle: Start with empty label / show error
    Running --> Paused: Pause
    Paused --> Running: Resume
    Running --> Idle: Reset
    Paused --> Idle: Reset
    Running --> Saving: reaches 00:00
    Saving --> Idle: 201 saved / reset timer, reload list and stats
    Saving --> Idle: request failed / show error
```

## 4. Error handling

| Situation | Response |
|---|---|
| Bad label or minutes | `400` with field errors |
| Id is not a positive integer | `400` |
| Session id not found | `404` |
| Database or unexpected error | `500` (no SQL details leaked) |
| Neon drops an idle connection | Logged; the pool opens a new connection next time |
