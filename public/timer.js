// Test tip: change to 10 while testing, set back to 25 * 60 before deploying
const FOCUS_SECONDS = 25 * 60;

let remaining = FOCUS_SECONDS; // seconds left
let timerId = null;            // null = timer is not running

const labelInput = document.getElementById("label-input");
const timeDisplay = document.getElementById("time-display");
const message = document.getElementById("message");
const statsEl = document.getElementById("stats");
const sessionList = document.getElementById("session-list");

function renderTime() {
  const mins = String(Math.floor(remaining / 60)).padStart(2, "0");
  const secs = String(remaining % 60).padStart(2, "0");
  timeDisplay.textContent = `${mins}:${secs}`;
}

function startTimer() {
  if (timerId !== null) return; // already running
  if (labelInput.value.trim() === "") {
    message.textContent = "Please type a label first.";
    return;
  }
  message.textContent = "";
  timerId = setInterval(tick, 1000); // run tick() every second
}

function tick() {
  remaining--;
  renderTime();
  if (remaining <= 0) {
    pauseTimer();
    finishSession();
  }
}

function pauseTimer() {
  clearInterval(timerId);
  timerId = null;
}

function resetTimer() {
  pauseTimer();
  remaining = FOCUS_SECONDS;
  renderTime();
}

document.getElementById("start-btn").addEventListener("click", startTimer);
document.getElementById("pause-btn").addEventListener("click", pauseTimer);
document.getElementById("reset-btn").addEventListener("click", resetTimer);

async function finishSession() {
  // Server only accepts 1–180 minutes, so a 10-second test still saves as 1
  const minutes = Math.max(1, Math.round(FOCUS_SECONDS / 60));
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: labelInput.value.trim(), minutes }),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    message.textContent = "Session saved!";
    resetTimer();
    loadSessions();
    loadStats();
  } catch (err) {
    message.textContent = err.message;
  }
}

async function loadSessions() {
  const res = await fetch("/api/sessions");
  const sessions = await res.json();

  sessionList.innerHTML = ""; // clear old list
  if (sessions.length === 0) {
    sessionList.innerHTML = "<li>No sessions yet.</li>";
    return;
  }

  sessions.forEach((s) => {
    const li = document.createElement("li");
    const when = new Date(s.started_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" });
    li.textContent = `${s.label} – ${s.minutes} min (${when}) `;

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      await fetch(`/api/sessions/${s.id}`, { method: "DELETE" });
      loadSessions();
      loadStats();
    });

    li.appendChild(delBtn);
    sessionList.appendChild(li);
  });
}

async function loadStats() {
  const res = await fetch("/api/stats");
  const stats = await res.json();
  statsEl.textContent = `${stats.today.count} sessions · ${stats.today.total_minutes} minutes`;
}

// Run once when the page opens
renderTime();
loadSessions();
loadStats();