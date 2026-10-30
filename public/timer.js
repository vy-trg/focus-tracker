// Test tip: change to 10 while testing, set back to 25 * 60 before deploying
const FOCUS_SECONDS = 25 * 60;

let remaining = FOCUS_SECONDS; // seconds left
let endAt = null;              // timestamp (ms) when the session ends
let timerId = null;            // null = timer is not running

const labelInput = document.getElementById("label-input");
const timeDisplay = document.getElementById("time-display");
const message = document.getElementById("message");
const startBtn = document.getElementById("start-btn");
const pauseBtn = document.getElementById("pause-btn");
const resetBtn = document.getElementById("reset-btn");
const sessionList = document.getElementById("session-list");

function showMessage(text, kind = "") {
  message.textContent = text;
  message.className = kind;
}

function formatTime(seconds) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function renderTime() {
  timeDisplay.textContent = formatTime(remaining);
  // Show the countdown in the browser tab too
  document.title = timerId !== null ? `${formatTime(remaining)} · Focus Tracker` : "Focus Tracker";
}

function updateButtons() {
  const running = timerId !== null;
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  labelInput.disabled = running;
  startBtn.textContent = remaining < FOCUS_SECONDS && !running ? "Resume" : "Start";
}

// --- TIMER ---
// Count down to a fixed end time instead of subtracting 1 each second.
// Phones slow down timers in background tabs, so "remaining--" would fall
// behind; working it out from the clock stays correct.

function startTimer() {
  if (timerId !== null) return; // already running
  if (labelInput.value.trim() === "") {
    showMessage("Please type what you're focusing on first.", "error");
    labelInput.focus();
    return;
  }
  showMessage("");
  endAt = Date.now() + remaining * 1000;
  timerId = setInterval(tick, 250);
  updateButtons();
  renderTime();
}

function tick() {
  remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  renderTime();
  if (remaining === 0) {
    pauseTimer();
    finishSession();
  }
}

function pauseTimer() {
  clearInterval(timerId);
  timerId = null;
  updateButtons();
  renderTime();
}

function resetTimer() {
  pauseTimer();
  remaining = FOCUS_SECONDS;
  renderTime();
  updateButtons();
}

startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);

// Pressing Enter in the label box starts the timer
labelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startTimer();
});

// --- API CALLS ---

async function finishSession() {
  // Server only accepts 1–180 minutes, so a 10-second test still saves as 1
  const minutes = Math.max(1, Math.round(FOCUS_SECONDS / 60));
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: labelInput.value.trim(), minutes }),
    });
    if (!res.ok) throw new Error(`Couldn't save the session (error ${res.status}).`);
    showMessage("Session saved. Nice work!", "ok");
    resetTimer();
    loadSessions();
    loadStats();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function loadSessions() {
  try {
    const res = await fetch("/api/sessions");
    if (!res.ok) throw new Error();
    const sessions = await res.json();

    sessionList.innerHTML = ""; // clear old list
    if (sessions.length === 0) {
      sessionList.innerHTML = '<li class="empty">No sessions yet. Start your first one above.</li>';
      return;
    }

    sessions.forEach((s) => {
      const li = document.createElement("li");

      // textContent (not innerHTML) so a label like "<script>" shows as plain text
      const info = document.createElement("div");
      info.className = "info";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = s.label;
      const meta = document.createElement("span");
      meta.className = "meta";
      const when = new Date(s.started_at).toLocaleString("en-AU", {
        timeZone: "Australia/Brisbane",
        dateStyle: "medium",
        timeStyle: "short",
      });
      meta.textContent = `${s.minutes} min · ${when}`;
      info.append(label, meta);

      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.setAttribute("aria-label", `Delete session "${s.label}"`);
      delBtn.addEventListener("click", () => deleteSession(s.id));

      li.append(info, delBtn);
      sessionList.appendChild(li);
    });
  } catch {
    sessionList.innerHTML = '<li class="empty">Couldn\'t load sessions. Refresh to try again.</li>';
  }
}

async function deleteSession(id) {
  try {
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error();
    loadSessions();
    loadStats();
  } catch {
    showMessage("Couldn't delete that session. Try again.", "error");
  }
}

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error();
    const stats = await res.json();
    document.getElementById("today-count").textContent = stats.today.count;
    document.getElementById("today-minutes").textContent = stats.today.total_minutes;
    document.getElementById("all-minutes").textContent = stats.allTime.total_minutes;
  } catch {
    // Leave the "–" placeholders if stats can't load
  }
}

// Run once when the page opens
renderTime();
updateButtons();
loadSessions();
loadStats();
