# Offline (Focus Tracker v3)

The problem: a focus block finished on a train or with patchy Wi-Fi used to be kept only in the open page. Close the tab, or let the phone reload it, and the session was gone.

## What happens now

| Situation | What you see |
|---|---|
| Open the page with no connection | The timer page opens from the copy on this device (sw.js). Your log, stats and tasks show the last copy the page saw. |
| A focus block ends offline | It goes into a queue on this device: "You're offline. This session is kept on this device…", and a note under the timer: "1 session saved on this device, waiting to be sent". |
| Close the tab, reopen later | The queue is still there (localStorage), and is sent as soon as the page opens online. |
| Connection comes back | Sent straight away, oldest first: "Back online: 2 sessions saved." |
| The same session is sent twice (the reply got lost) | Saved once. Each session has an id made on the device (`client_id`); the server answers 200 with the one it already has. |
| Log out | The stored copies of your pages and data are removed from the device. Unsent sessions stay, in a queue for that account only, and go the next time that account logs in here. |

A session sent later keeps the time it really happened (`finished_at`), so it counts for the right day in stats, streaks and habits. The server accepts up to 30 days back and nothing in the future (5 minutes leeway for a phone clock that's ahead).

## How

- `public/sw.js`: the page and `/api` reads come from the network first and from the stored copy when there's no connection; styles, scripts and fonts come from the device and are refreshed in the background. Saving, logging in, music and the study room are never cached.
- `public/timer.js`: the queue (`ft-unsent-<username>` in localStorage), sent on page load, on the `online` event, and every 30 s while anything waits.
- `db/migrations/004-offline-sessions.sql`: `client_id` column and a unique index per user.

## Limits

- The study room needs the connection (it's live by nature).
- While offline, Today (minutes, sessions, streak) already counts sessions waiting to be sent; the log, reports and habits show them once they're sent.
- Logging in needs the connection (the password is checked by the server). Already logged in, you stay logged in offline.
- The very first visit stores the page and your data as soon as sw.js takes over, so it works offline from then on.
