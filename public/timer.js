// Focus Tracker in the browser: timer with breaks, presets, tasks, insights and history.
// Talks to the API with fetch; every request is answered only with the logged-in user's data.

// ---------- Settings (saved in this browser) ----------
const PRESETS = {
  classic: { focus: 25, short: 5, long: 15, name: "Classic", hint: "Study" },
  coding: { focus: 50, short: 10, long: 20, name: "Coding", hint: "Writing" },
  deep: { focus: 90, short: 20, long: 30, name: "Deep work", hint: "Big tasks" },
  sprint: { focus: 15, short: 3, long: 10, name: "Sprint", hint: "Get started" },
};
const DEFAULTS = { preset: "classic", ...PRESETS.classic, every: 4, sound: true, notify: false, auto: true, lofi: false, lofiVolume: 0.5 };

// localStorage can throw (private mode, blocked storage), so every access is wrapped
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("ft-settings"));
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try {
    localStorage.setItem("ft-settings", JSON.stringify(settings));
  } catch {
    // Not saved: the timer still works for this visit
  }
}
let settings = loadSettings();
// Set once the background sound code below has loaded; render() calls it on every tick
let syncSound = () => {};

// Test mode, only on your own computer: http://localhost:3000/?fast counts seconds instead of minutes
const FAST = location.hostname === "localhost" && new URLSearchParams(location.search).has("fast");
const UNIT = FAST ? 1000 : 60 * 1000;

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const els = {
  tabs: document.querySelectorAll(".tab"),
  label: $("label-input"),
  taskSelect: $("task-select"),
  category: $("category"),
  time: $("time-display"),
  ofTotal: $("of-total"),
  status: $("status"),
  ring: $("ring-progress"),
  roundDots: $("round-dots"),
  roundText: $("round-text"),
  start: $("start-btn"),
  startIcon: $("start-icon"),
  reset: $("reset-btn"),
  skip: $("skip-btn"),
  message: $("message"),
  completePanel: $("complete-panel"),
  completeText: $("complete-text"),
  ratingButtons: document.querySelectorAll(".rating button"),
  startBreak: $("start-break-btn"),
  skipBreak: $("skip-break-btn"),
  presets: document.querySelector(".presets"),
  setFocus: $("set-focus"),
  setShort: $("set-short"),
  setLong: $("set-long"),
  setEvery: $("set-every"),
  setSound: $("set-sound"),
  setAuto: $("set-auto"),
  setNotify: $("set-notify"),
  startLabel: $("start-label"),
  navTimes: document.querySelectorAll(".nav-time"),
  navStarts: document.querySelectorAll(".nav-start"),
  navIcons: document.querySelectorAll(".nav-icon"),
  viewLinks: document.querySelectorAll("[data-view]"),
  focusModeBtn: $("focus-mode-btn"),
  showMore: $("show-more"),
  taskForm: $("task-form"),
  taskTitle: $("task-title"),
  taskEstimate: $("task-estimate"),
  taskList: $("task-list"),
  filterButtons: document.querySelectorAll("#tasks .filter button"),
  rangeTabs: document.querySelectorAll("#insights [data-range]"),
  sessionList: $("session-list"),
  toast: $("toast"),
  toastText: $("toast-text"),
  toastUndo: $("toast-undo"),
};

// ---------- Timer state ----------
// endAt is a timestamp, so the countdown stays right even when the browser slows down a background tab.
let mode = "focus"; // "focus" | "short" | "long"
let round = 0; // focus sessions finished in this cycle (resets after a long break)
let endAt = null; // when running: the time it ends
let remainingMs = minutesFor("focus") * UNIT; // when paused or stopped
let tick = null;
let lastSessionId = null; // the session the rating buttons apply to
// Study room (further down): the room's last state, and whether my timer follows it
let roomState = null;
let roomFollowing = false;

const RING_LENGTH = 2 * Math.PI * 52;
els.ring.style.strokeDasharray = RING_LENGTH;

function minutesFor(m) {
  return Number(settings[m]);
}
function format(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function isRunning() {
  return endAt !== null;
}
function currentRemaining() {
  return isRunning() ? endAt - Date.now() : remainingMs;
}

// Length of a phase in ms: the room's lengths while you follow the room timer, your own otherwise
function totalFor(m) {
  return roomFollowing && roomState && roomState.phase !== "idle"
    ? roomState.preset[m] * roomState.unitMs
    : minutesFor(m) * UNIT;
}

function render() {
  const total = totalFor(mode);
  const left = currentRemaining();
  els.time.textContent = format(left);
  els.ofTotal.textContent = `of ${format(total)}`;
  els.ring.style.strokeDashoffset = RING_LENGTH * (1 - Math.min(1, Math.max(0, (total - left) / total)));

  const label = { focus: "Focus", short: "Short break", long: "Long break" }[mode];
  const ready = { focus: "Ready to focus", short: "Ready for a short break", long: "Ready for a long break" }[mode];
  els.status.textContent = isRunning()
    ? mode === "focus"
      ? "Focusing"
      : "On a break"
    : left < total
      ? "Paused"
      : ready;
  document.title = isRunning() ? `${format(left)} · ${label}` : "Focus Tracker";

  const icon = isRunning() ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  const action = isRunning() ? "Pause" : left < total ? "Resume" : "Start";
  if (els.startIcon.innerHTML !== icon) {
    els.startIcon.innerHTML = icon;
    replayAnimation(els.startIcon, "icon-swap");
  }
  els.startLabel.textContent = action;
  // The small timers (bottom bar on phones, top bar on the Reports page) mirror the big one
  els.navTimes.forEach((el) => (el.textContent = format(left)));
  els.navIcons.forEach((el) => (el.innerHTML = icon));
  els.navStarts.forEach((el) => el.setAttribute("aria-label", action));

  document.body.dataset.mode = mode;
  // Position of the sliding highlight behind the Focus / Short break / Long break tabs
  els.tabs[0].parentElement.style.setProperty("--tab", ["focus", "short", "long"].indexOf(mode));
  els.tabs.forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.mode === mode)));

  const every = Number(settings.every);
  els.roundDots.innerHTML = "";
  for (let i = 0; i < every; i++) {
    const dot = document.createElement("i");
    if (i < round) dot.className = "done";
    els.roundDots.append(dot);
  }
  els.roundText.textContent = `Session ${Math.min(round + 1, every)} of ${every}`;
  syncSound();
}

function setMode(next) {
  stop();
  mode = next;
  remainingMs = minutesFor(mode) * UNIT;
  render();
}

function start() {
  if (mode === "focus" && els.label.value.trim() === "") {
    showMessage("What are you working on? Type it above, then press Start.", true);
    els.label.focus();
    return;
  }
  showMessage("");
  askNotificationPermission();
  // Keep the "rate this session" panel open during the break; close it once focus starts again
  if (mode === "focus") els.completePanel.hidden = true;
  endAt = Date.now() + remainingMs;
  tick = setInterval(onTick, 250);
  render();
}

function pause() {
  remainingMs = currentRemaining();
  stop();
  render();
}

function stop() {
  clearInterval(tick);
  tick = null;
  endAt = null;
}

function onTick() {
  if (currentRemaining() <= 0) {
    finish();
  } else {
    render();
  }
}

async function finish() {
  stop();
  beep();
  notify(mode === "focus" ? "Focus session done. Time for a break!" : "Break's over. Ready to focus?");
  if (roomFollowing) return finishWithRoom();
  if (mode === "focus") {
    round += 1;
    const minutes = minutesFor("focus");
    await saveSession(minutes);
    const next = round >= Number(settings.every) ? "long" : "short";
    mode = next;
    remainingMs = minutesFor(next) * UNIT;
    els.startBreak.textContent = `Start ${minutesFor(next)} min ${next === "long" ? "long " : ""}break`;
    els.completeText.textContent = `Nice work on “${els.label.value.trim()}”. Take a breather, you earned it.`;
    els.ratingButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
    els.completePanel.hidden = false;
    els.startBreak.hidden = settings.auto;
    render();
    if (settings.auto) start();
  } else {
    if (mode === "long") round = 0;
    els.completePanel.hidden = true;
    mode = "focus";
    remainingMs = minutesFor("focus") * UNIT;
    showMessage("Break's over. Press Start when you're ready.");
    render();
  }
}

function skip() {
  els.completePanel.hidden = true;
  if (mode === "focus") {
    // Skipping focus does not save a session; just move on to the break
    setMode(round + 1 >= Number(settings.every) ? "long" : "short");
  } else {
    if (mode === "long") round = 0;
    setMode("focus");
  }
}

// A short two-note chime made in the browser (no audio file needed)
function beep() {
  if (!settings.sound) return;
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.25 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.45);
    });
  } catch {
    // No sound support: the message and title still show the timer ended
  }
}

// Browser notification when the timer ends while you're in another tab (only if you turned it on)
function askNotificationPermission() {
  if (settings.notify && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}
function notify(text) {
  if (!settings.notify || !document.hidden) return;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Focus Tracker", { body: text });
  }
}

function showMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle("error", isError);
}

// ---------- Presets and settings ----------
function renderPresets() {
  els.presets.innerHTML = "";
  for (const [key, p] of Object.entries(PRESETS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    btn.setAttribute("aria-pressed", String(settings.preset === key));
    btn.innerHTML = `<b>${p.focus}/${p.short}</b><span></span>`;
    btn.querySelector("span").textContent = p.name;
    btn.title = `${p.name}: ${p.focus} min focus, ${p.short} min break (${p.hint})`;
    btn.addEventListener("click", () => applyPreset(key));
    els.presets.append(btn);
  }
}

function applyPreset(key) {
  if ((isRunning() || roomFollowing) && !confirmChange()) return;
  settings = { ...settings, preset: key, ...pick(PRESETS[key], ["focus", "short", "long"]) };
  saveSettings();
  fillSettingsForm();
  renderPresets();
  setMode(mode);
}

function confirmChange() {
  showMessage(roomFollowing
    ? "You're on the room timer. Switch off \"Follow the room timer\" to change your own lengths."
    : "The timer is running. Pause it first, then change the length.", true);
  return false;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

function fillSettingsForm() {
  els.setFocus.value = settings.focus;
  els.setShort.value = settings.short;
  els.setLong.value = settings.long;
  els.setEvery.value = settings.every;
  els.setSound.checked = settings.sound;
  els.setAuto.checked = settings.auto;
  els.setNotify.checked = settings.notify;
}

function readNumber(input, min, max, fallback) {
  const n = Number(input.value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function onSettingsChange() {
  settings = {
    ...settings,
    preset: "custom",
    focus: readNumber(els.setFocus, 1, 180, settings.focus),
    short: readNumber(els.setShort, 1, 60, settings.short),
    long: readNumber(els.setLong, 1, 60, settings.long),
    every: readNumber(els.setEvery, 2, 8, settings.every),
    sound: els.setSound.checked,
    auto: els.setAuto.checked,
    notify: els.setNotify.checked,
  };
  // If the numbers match a preset, highlight it again
  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.focus === settings.focus && p.short === settings.short && p.long === settings.long) settings.preset = key;
  }
  saveSettings();
  renderPresets();
  if (settings.notify) askNotificationPermission();
  if (!isRunning()) setMode(mode);
}

// ---------- API helper ----------
// 401 means the login session ended: go to the login page
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your internet connection.");
  }
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Not logged in");
  }
  if (res.status === 429) {
    throw new Error("Too many requests in a short time. Wait a minute and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // 400 errors explain what to fix; anything else is our fault, not yours
    const msg = data.errors
      ? data.errors.map((e) => e.message).join(", ")
      : "The server had a problem. Try again in a moment.";
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Sessions ----------
// Every finished session goes into a queue on this device first (localStorage), then is sent.
// Offline, or if the server can't be reached, it simply waits there, even if the page is closed,
// and is sent when the connection comes back (or the next time the page opens). Each one carries
// an id made here (client_id) so it is never saved twice, and the time it finished, so it counts
// for the right day. One queue per account, so a shared device never sends one person's session
// as another's.
const QUEUE_KEY = `ft-unsent-${document.body.dataset.username}`;
function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full or blocked: still tried once */ }
  renderOfflineNote(q.length);
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

async function saveSession(minutes) {
  const q = readQueue();
  q.push({
    client_id: newId(),
    label: els.label.value.trim(),
    minutes,
    category: els.category.value,
    task_id: els.taskSelect.value ? Number(els.taskSelect.value) : null,
    finished_at: new Date().toISOString(),
  });
  writeQueue(q);
  await sendQueued(true);
}

// Sends what's waiting, oldest first. justFinished: the last one is the session that just ended
// (so "How focused did you feel?" can be saved on it).
let sending = false;
async function sendQueued(justFinished = false) {
  if (sending) return;
  sending = true;
  let sent = 0;
  try {
    for (let q = readQueue(); q.length > 0; q = readQueue()) {
      const item = q[0];
      let saved;
      try {
        saved = await api("/api/sessions", { method: "POST", body: JSON.stringify(item) });
      } catch (err) {
        // The server said no (e.g. the task was deleted, or it's over a week old): it can never be
        // saved as it is, so it leaves the queue with a message instead of blocking the rest
        if (navigator.onLine && /must|Unknown|week/.test(err.message)) {
          writeQueue(readQueue().filter((x) => x.client_id !== item.client_id));
          showMessage(`A session from ${new Date(item.finished_at).toLocaleString("en-AU")} couldn't be saved: ${err.message}`, true);
          continue;
        }
        lastSessionId = null;
        const n = readQueue().length;
        showMessage(navigator.onLine
          ? `Couldn't save yet: ${err.message} It's kept on this device and will be sent again.`
          : `You're offline. ${n === 1 ? "This session is" : `${n} sessions are`} kept on this device and will be sent when you're back online.`);
        setTimeout(() => sendQueued(), 30000);
        return;
      }
      writeQueue(readQueue().filter((x) => x.client_id !== item.client_id));
      sent += 1;
      if (justFinished && readQueue().length === 0) lastSessionId = saved.id;
    }
    if (sent > 0) {
      showMessage(justFinished && sent === 1 ? "Saved. Nice!" : `Back online: ${sent} session${sent === 1 ? "" : "s"} saved.`);
      refreshAll();
    }
  } finally {
    sending = false;
  }
}
window.addEventListener("online", () => sendQueued());

// "2 sessions waiting to be sent" under the timer while anything is queued
function renderOfflineNote(n = readQueue().length) {
  const note = document.getElementById("offline-note");
  if (!note) return;
  note.hidden = n === 0;
  note.textContent = n === 0 ? "" : `${n} session${n === 1 ? "" : "s"} saved on this device, waiting to be sent${navigator.onLine ? "…" : " (you're offline)."}`;
}
window.addEventListener("offline", () => renderOfflineNote());

// The app's files stay on this device (sw.js), so the page opens and the timer runs offline
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
// Logging out removes the stored copies of your pages and data from this device
document.querySelector('form[action="/logout"]')?.addEventListener("submit", () => {
  navigator.serviceWorker?.controller?.postMessage("clear");
});

async function rate(value) {
  if (!lastSessionId) return;
  els.ratingButtons.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.rating) === value)));
  try {
    await api(`/api/sessions/${lastSessionId}`, { method: "PATCH", body: JSON.stringify({ rating: value }) });
    loadSessions();
  } catch (err) {
    showMessage(err.message, true);
  }
}

const CATEGORY_NAMES = { study: "Study", reading: "Reading", work: "Work", journal: "Journal" };
const RATING_NAMES = ["", "Scattered", "Okay", "Good", "Great", "In flow"];

// The log starts with 5 rows; "Show more" adds 10 at a time
let nextBefore = null; // id to ask for the next page of sessions; null = no more
let allSessions = [];

// First page: 5 sessions. "Show more" asks the server for the next 10 (keyset pagination).
async function loadSessions() {
  try {
    const page = await api("/api/sessions?limit=5");
    allSessions = page.sessions;
    nextBefore = page.nextBefore;
    renderSessions();
  } catch (err) {
    showMessage(`Couldn't load your session log. ${err.message}`, true);
  }
}

function renderSessions() {
  els.sessionList.removeAttribute("aria-busy");
  els.sessionList.innerHTML = "";
  els.showMore.hidden = nextBefore === null;
  if (allSessions.length === 0) {
    els.sessionList.innerHTML = '<li class="empty">No sessions yet. Finish a focus block and it shows up here.</li>';
    return;
  }
  for (const s of allSessions) {
    const li = document.createElement("li");
    li.className = "session";
    li.innerHTML = `
      <span class="tag"></span>
      <div class="session-main"><div class="session-title"></div><div class="session-meta"></div></div>
      <span class="mins"></span>
      <button class="icon-btn" type="button" aria-label="Delete session">×</button>`;
    const tag = li.querySelector(".tag");
    tag.classList.add(`tag-${s.category}`);
    tag.textContent = CATEGORY_NAMES[s.category] || s.category;
    // textContent, never innerHTML, for anything the user typed
    li.querySelector(".session-title").textContent = s.label;
    const when = new Date(s.started_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    const parts = [when];
    if (s.task_title) parts.push(`Task: ${s.task_title}`);
    if (s.rating) parts.push(RATING_NAMES[s.rating]);
    li.querySelector(".session-meta").textContent = parts.join(" · ");
    li.querySelector(".mins").textContent = `${s.minutes}m`;
    li.querySelector("button").addEventListener("click", () =>
      deleteWithUndo(li, "Session deleted", () => api(`/api/sessions/${s.id}`, { method: "DELETE", keepalive: true })),
    );
    els.sessionList.append(li);
  }
  staggerOnce(els.sessionList);
}

// ---------- Tasks ----------
let tasks = [];
let filter = "open";

async function loadTasks() {
  try {
    tasks = await api("/api/tasks");
    els.taskList.removeAttribute("aria-busy");
    renderTasks();
    renderTaskSelect();
  } catch (err) {
    showMessage(`Couldn't load your tasks. ${err.message}`, true);
  }
}

function renderTasks() {
  const doneCount = tasks.filter((t) => t.done).length;
  els.filterButtons.forEach((b) => {
    if (b.dataset.filter === "done") b.textContent = doneCount ? `Done (${doneCount})` : "Done";
  });
  const shown = tasks.filter((t) => (filter === "done" ? t.done : !t.done));
  els.taskList.innerHTML = "";
  if (shown.length === 0) {
    els.taskList.innerHTML =
      filter === "done"
        ? '<li class="empty">Nothing ticked off yet.</li>'
        : '<li class="empty">No tasks yet. Add what you\'re working on, then press ▶ to focus on it.</li>';
    return;
  }
  for (const t of shown) {
    const li = document.createElement("li");
    li.className = "task" + (t.done ? " done" : "") + (String(t.id) === els.taskSelect.value ? " current" : "");
    li.innerHTML = `
      <input type="checkbox">
      <div><div class="task-title"></div><div class="pips"></div></div>
      <button class="icon-btn play" type="button"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <button class="icon-btn" type="button">×</button>`;
    const checkbox = li.querySelector("input");
    checkbox.checked = t.done;
    checkbox.setAttribute("aria-label", `Done: ${t.title}`);
    li.querySelector(".task-title").textContent = t.title;

    const pips = li.querySelector(".pips");
    for (let i = 0; i < t.estimate; i++) {
      const pip = document.createElement("i");
      if (i < t.pomodoros) pip.className = "on";
      pips.append(pip);
    }
    const count = document.createElement("span");
    count.textContent = t.pomodoros >= t.estimate ? ` ${t.pomodoros}/${t.estimate} done` : ` ${t.pomodoros}/${t.estimate}`;
    if (t.pomodoros >= t.estimate) count.className = "reached";
    pips.append(count);

    const [playBtn, deleteBtn] = li.querySelectorAll("button");
    playBtn.setAttribute("aria-label", `Focus on ${t.title}`);
    playBtn.hidden = t.done;
    deleteBtn.setAttribute("aria-label", `Delete ${t.title}`);

    checkbox.addEventListener("change", () => toggleTask(t, checkbox.checked));
    playBtn.addEventListener("click", () => focusOnTask(t));
    deleteBtn.addEventListener("click", () =>
      deleteWithUndo(li, "Task deleted", async () => {
        await api(`/api/tasks/${t.id}`, { method: "DELETE", keepalive: true });
        await loadTasks();
      }),
    );
    els.taskList.append(li);
  }
  staggerOnce(els.taskList);
}

function renderTaskSelect() {
  const current = els.taskSelect.value;
  els.taskSelect.innerHTML = '<option value="">No task</option>';
  for (const t of tasks.filter((t) => !t.done)) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title;
    els.taskSelect.append(opt);
  }
  els.taskSelect.value = tasks.some((t) => String(t.id) === current && !t.done) ? current : "";
}

function focusOnTask(t) {
  els.taskSelect.value = t.id;
  els.label.value = t.title.slice(0, 60);
  if (mode !== "focus" && !isRunning()) setMode("focus");
  renderTasks();
  els.label.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function toggleTask(t, done) {
  try {
    await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
    await loadTasks();
    // Ticked tasks move to the Done tab; say so, so it doesn't look like the task vanished
    if (done) {
      showUndo("Task moved to Done", () => toggleTask(t, false));
      replayAnimation(document.querySelector('#tasks .filter [data-filter="done"]'), "pulse");
    }
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function addTask(event) {
  event.preventDefault();
  const title = els.taskTitle.value.trim();
  if (!title) return;
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, estimate: Number(els.taskEstimate.value) }),
    });
    els.taskTitle.value = "";
    filter = "open";
    els.filterButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === "open")));
    await loadTasks();
  } catch (err) {
    showMessage(err.message, true);
  }
}

// ---------- Delete with Undo ----------
// The row disappears at once, but the DELETE request waits 5 seconds.
// Undo inside those 5 seconds simply puts the row back; nothing was deleted on the server.
let pendingDelete = null;

// The toast leaves with a short exit animation (a little faster than it came in), then hides
function hideToast() {
  if (els.toast.hidden) return;
  if (reduceMotion()) {
    els.toast.hidden = true;
    return;
  }
  els.toast.classList.add("leaving");
  setTimeout(() => {
    els.toast.classList.remove("leaving");
    els.toast.hidden = true;
  }, 160);
}

function deleteWithUndo(row, text, doDelete) {
  if (pendingDelete) pendingDelete.commit(); // only one undo at a time
  row.hidden = true;
  els.toastText.textContent = text;
  els.toast.hidden = false;

  const timer = setTimeout(() => entry.commit(), 5000);
  const entry = {
    commit: async () => {
      clearTimeout(timer);
      if (pendingDelete === entry) {
        pendingDelete = null;
        hideToast();
      }
      try {
        await doDelete();
        refreshAll();
      } catch (err) {
        row.hidden = false;
        showMessage(`Couldn't delete that. ${err.message}`, true);
      }
    },
    undo: () => {
      clearTimeout(timer);
      pendingDelete = null;
      hideToast();
      row.hidden = false;
    },
  };
  pendingDelete = entry;
}

// Same toast as delete, for actions that already happened but can be reversed
function showUndo(text, onUndo) {
  if (pendingDelete) pendingDelete.commit();
  els.toastText.textContent = text;
  els.toast.hidden = false;
  const timer = setTimeout(() => entry.commit(), 5000);
  const entry = {
    commit: () => {
      clearTimeout(timer);
      if (pendingDelete === entry) {
        pendingDelete = null;
        hideToast();
      }
    },
    undo: () => {
      clearTimeout(timer);
      pendingDelete = null;
      hideToast();
      onUndo();
    },
  };
  pendingDelete = entry;
}

// ---------- Insights ----------
async function loadStats() {
  try {
    const stats = await api("/api/stats");
    $("today-minutes").textContent = stats.today.total_minutes;
    $("today-count").textContent = stats.today.count;
    $("streak").textContent = stats.streak;
    renderStreak(stats);
    $("all-minutes").textContent = stats.allTime.total_minutes;
    $("all-count").textContent = stats.allTime.count;

    $("insight").textContent =
      stats.bestHour === null
        ? "Finish a few sessions to see when you focus best."
        : `You focus most around ${formatHour(stats.bestHour)}. Schedule hard tasks then.`;
  } catch (err) {
    showMessage(`Couldn't load your insights. ${err.message}`, true);
  }
}

// ---------- Reports ----------
// Minutes per day, stacked by category. Plain HTML/CSS bars, so no chart library and no CSP change.
const REPORT_CATEGORIES = ["study", "reading", "work", "journal"];
let reportRange = "week";

function formatMinutes(m) {
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function loadReport() {
  try {
    const report = await api(`/api/reports?range=${reportRange}`);
    renderReport(report);
  } catch (err) {
    showMessage(`Couldn't load your report. ${err.message}`, true);
  }
}

function renderReport({ days, totals }) {
  const total = REPORT_CATEGORIES.reduce((sum, c) => sum + totals[c], 0);
  $("report-total").textContent = formatMinutes(total);

  const dayTotal = (d) => REPORT_CATEGORIES.reduce((sum, c) => sum + d[c], 0);
  const max = Math.max(60, ...days.map(dayTotal));
  const bars = $("report-bars");
  bars.innerHTML = "";
  bars.style.setProperty("--cols", days.length);
  const today = days.length - 1;
  days.forEach((d, i) => {
    const date = new Date(`${d.day}T00:00:00`);
    const col = document.createElement("div");
    col.className = "rbar" + (dayTotal(d) === 0 ? " empty" : "");
    const stack = document.createElement("div");
    stack.className = "rstack";
    stack.style.height = `${Math.round((dayTotal(d) / max) * 100)}%`;
    for (const c of REPORT_CATEGORIES) {
      if (!d[c]) continue;
      const seg = document.createElement("i");
      seg.className = `seg-${c}`;
      seg.style.flexGrow = d[c];
      stack.append(seg);
    }
    const label = document.createElement("span");
    // 30 bars are too narrow for every label: show today and every 10th day before it
    const showLabel = days.length <= 7 || (today - i) % 10 === 0;
    label.textContent = !showLabel
      ? ""
      : days.length === 1
        ? "Today"
        : days.length <= 7
          ? date.toLocaleDateString([], { weekday: "short" })
          : date.toLocaleDateString([], { day: "numeric", month: "short" });
    col.title = `${date.toLocaleDateString()}: ${dayTotal(d)} min`;
    col.append(stack, label);
    bars.append(col);
  });

  const legend = $("report-legend");
  legend.innerHTML = "";
  for (const c of REPORT_CATEGORIES) {
    const li = document.createElement("li");
    li.innerHTML = `<i class="seg-${c}"></i><span></span><b></b>`;
    li.querySelector("span").textContent = CATEGORY_NAMES[c];
    li.querySelector("b").textContent = formatMinutes(totals[c]);
    legend.append(li);
  }

  // Same numbers as a table, for screen readers and anyone who prefers exact figures
  const rows = $("report-rows");
  rows.innerHTML = "";
  for (const d of days) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = new Date(`${d.day}T00:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    tr.append(th);
    for (const c of REPORT_CATEGORIES) {
      const td = document.createElement("td");
      td.textContent = d[c];
      tr.append(td);
    }
    rows.append(tr);
  }
}

function formatHour(h) {
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

// ---------- Motion helpers ----------
function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Restart a CSS animation on an element (used for the play/pause icon and success pulses)
function replayAnimation(el, className) {
  if (!el || reduceMotion()) return;
  el.classList.remove(className);
  void el.offsetWidth; // forces the browser to notice the class was removed
  el.classList.add(className);
}

// Rows fade in one after another (30ms apart), but only the first time a list appears,
// so ticking a task or saving a session doesn't make the whole list dance again.
function staggerOnce(list) {
  if (!list || list.dataset.staggered) return;
  list.dataset.staggered = "1";
  list.classList.add("stagger");
  setTimeout(() => list.classList.remove("stagger"), 800);
}

// Change the page (or focus mode) with a crossfade where the browser supports it
function withTransition(update) {
  if (!document.startViewTransition || reduceMotion()) return update();
  document.startViewTransition(update);
}

// ---------- Today (Focus page) ----------
let todayCount = null;
// The sessions finished today, newest first, so the Focus page shows what you've already done.
async function loadToday() {
  const list = $("today-list");
  try {
    const { sessions } = await api("/api/sessions?limit=50");
    const today = new Date().toDateString();
    const done = sessions.filter((s) => new Date(s.started_at).toDateString() === today);
    list.removeAttribute("aria-busy");
    list.innerHTML = "";
    renderTimeline(done);
    if (done.length === 0) {
      list.innerHTML = '<li class="empty">Nothing yet today. Finished sessions show up here.</li>';
      return;
    }
    const isNew = todayCount !== null && done.length > todayCount;
    todayCount = done.length;
    for (const s of done) {
      const li = document.createElement("li");
      li.innerHTML = '<span class="today-time"></span><i></i><span class="today-label"></span><b></b>';
      // started_at is when the session was saved (its end), so show when it began, like the timeline
      const began = new Date(new Date(s.started_at).getTime() - s.minutes * 60000);
      li.querySelector(".today-time").textContent = began.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      li.querySelector("i").className = `seg-${s.category}`;
      li.querySelector("i").title = CATEGORY_NAMES[s.category];
      // Add the task name only when it says something the label doesn't already
      const sameAsTask = !s.task_title || s.task_title.startsWith(s.label) || s.label.startsWith(s.task_title);
      li.querySelector(".today-label").textContent = sameAsTask ? s.label : `${s.label} · ${s.task_title}`;
      li.querySelector("b").textContent = `${s.minutes}m`;
      list.append(li);
    }
    staggerOnce(list);
    // A session was just saved: pulse the new row so you see it landed
    if (isNew) replayAnimation(list.firstElementChild, "pulse");
  } catch (err) {
    showMessage(`Couldn't load today's sessions. ${err.message}`, true);
  }
}

// ---------- Today's timeline ----------
// A session is saved when it ends, so started_at is the end time; the block runs back `minutes`.
// The day shown is 6 am to 10 pm, stretched if you focused earlier or later than that.
function renderTimeline(sessions) {
  const box = $("day-timeline");
  box.hidden = sessions.length === 0;
  if (box.hidden) return;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const hourOf = (d) => (d - midnight) / 3600000;
  const blocks = sessions.map((s) => {
    const end = hourOf(new Date(s.started_at));
    return { s, start: Math.max(0, end - s.minutes / 60), end };
  });
  const from = Math.min(6, Math.floor(Math.min(...blocks.map((b) => b.start))));
  const to = Math.max(22, Math.ceil(Math.max(...blocks.map((b) => b.end), hourOf(new Date()))));
  const pct = (h) => `${((h - from) / (to - from)) * 100}%`;

  const track = $("tl-track");
  track.innerHTML = "";
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", `Today's sessions: ${blocks.map((b) => `${b.s.minutes} minutes ${CATEGORY_NAMES[b.s.category]}`).join(", ")}`);
  for (const b of blocks) {
    const el = document.createElement("i");
    el.className = `tl-block seg-${b.s.category}`;
    el.style.left = pct(b.start);
    el.style.width = `max(3px, calc(${pct(b.end)} - ${pct(b.start)}))`;
    el.title = `${b.s.label} · ${b.s.minutes}m · ${CATEGORY_NAMES[b.s.category]}`;
    track.append(el);
  }
  const now = document.createElement("span");
  now.className = "tl-now";
  now.style.left = pct(Math.min(to, hourOf(new Date())));
  track.append(now);

  const hours = $("tl-hours");
  hours.innerHTML = "";
  for (let h = Math.ceil(from / 3) * 3; h <= to; h += 3) {
    const t = document.createElement("span");
    t.style.left = pct(h);
    t.textContent = `${h % 12 || 12}${h < 12 || h === 24 ? "am" : "pm"}`;
    hours.append(t);
  }
}

function refreshAll() {
  loadToday();
  loadHabits();
  loadSessions();
  loadStats();
  loadReport();
  loadTasks();
}

// ---------- Habits: daily goals that tick themselves from finished sessions ----------
// The server works out today's progress, the last 7 days and the streak (habits.js, tested).
let habits = [];
let habitsDoneBefore = null; // ids done today at the last load, to say "Habit done" once when one completes

const CATEGORY_NAME = { study: "Study", reading: "Reading", work: "Work", journal: "Journal" };

async function loadHabits() {
  try {
    habits = await api("/api/habits");
  } catch (err) {
    $("habit-list").removeAttribute("aria-busy");
    $("habit-list").innerHTML = '<li class="empty">Habits aren\'t loading right now. They\'ll be back after the next session.</li>';
    return;
  }
  // A session just finished a habit for today: say so once
  const doneNow = new Set(habits.filter((h) => h.today.done).map((h) => h.id));
  if (habitsDoneBefore) {
    const finished = habits.filter((h) => doneNow.has(h.id) && !habitsDoneBefore.has(h.id));
    if (finished.length) showMessage(`Habit done for today: ${finished.map((h) => h.name).join(", ")}`);
  }
  habitsDoneBefore = doneNow;
  renderHabits();
}

function renderHabits() {
  const list = $("habit-list");
  list.removeAttribute("aria-busy");
  list.innerHTML = "";
  if (habits.length === 0) {
    list.innerHTML = '<li class="empty">No habits yet. Try "2 study sessions a day": it ticks itself when you finish sessions.</li>';
    return;
  }
  for (const h of habits) {
    const li = document.createElement("li");
    li.className = "habit" + (h.today.done ? " done" : "");
    li.innerHTML = `
      <div><div class="habit-name"></div><div class="habit-meta"></div></div>
      <div class="habit-streak"></div>
      <div class="habit-progress">
        <div class="habit-bar" role="progressbar" aria-valuemin="0"><i></i></div>
        <span class="habit-count"></span>
      </div>
      <div class="habit-foot">
        <ol class="week-dots"></ol>
        <button class="icon-btn" type="button">×</button>
      </div>`;
    li.querySelector(".habit-name").textContent = h.name;
    li.querySelector(".habit-meta").textContent =
      `${h.target_sessions} ${CATEGORY_NAME[h.category] ?? h.category} session${h.target_sessions === 1 ? "" : "s"} a day`;

    const streak = li.querySelector(".habit-streak");
    streak.textContent = `${h.streak} day${h.streak === 1 ? "" : "s"}`;
    const small = document.createElement("small");
    const untilMidnight = msToMidnight();
    const atRisk = h.streak > 0 && !h.today.done && untilMidnight <= AT_RISK_MS;
    small.textContent = h.streak === 0 ? "start today" : atRisk ? `${formatLeft(untilMidnight)} left` : "streak";
    streak.classList.toggle("at-risk", atRisk);
    streak.append(small);

    // Today: a bar that fills up, and "1 of 2" (it can go past the goal: 3 of 2 is fine)
    const bar = li.querySelector(".habit-bar");
    bar.setAttribute("aria-valuemax", String(h.today.target));
    bar.setAttribute("aria-valuenow", String(Math.min(h.today.sessions, h.today.target)));
    bar.setAttribute("aria-label", `${h.name} today`);
    bar.querySelector("i").style.width = `${Math.min(100, (h.today.sessions / h.today.target) * 100)}%`;
    const left = h.today.target - h.today.sessions;
    li.querySelector(".habit-count").textContent = h.today.done
      ? `Done today (${h.today.sessions}/${h.today.target})`
      : `${h.today.sessions}/${h.today.target} · ${left} more`;

    // Last 7 days: full dot = goal reached, light dot = some sessions, faded = before the habit existed
    const dots = li.querySelector(".week-dots");
    dots.setAttribute("aria-label", `${h.name}, last 7 days`);
    h.last7.forEach((d, i) => {
      const dot = document.createElement("li");
      const name = new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" });
      dot.textContent = name[0];
      dot.className = [d.done ? "on" : d.sessions > 0 ? "part" : "", d.before ? "before" : "", i === 6 ? "today" : ""].join(" ").trim();
      const state = d.before ? "before this habit started" : d.done ? "goal reached" : d.sessions > 0 ? `${d.sessions} of ${h.target_sessions}` : "missed";
      dot.title = `${name}: ${state}`;
      dot.setAttribute("aria-label", `${i === 6 ? "Today" : name}: ${state}`);
      dots.append(dot);
    });

    const del = li.querySelector(".icon-btn");
    del.setAttribute("aria-label", `Delete habit ${h.name}`);
    del.addEventListener("click", () =>
      deleteWithUndo(li, "Habit deleted", async () => {
        await api(`/api/habits/${h.id}`, { method: "DELETE", keepalive: true });
        await loadHabits();
      }),
    );
    list.append(li);
  }
  staggerOnce(list);
}

function showHabitForm(open) {
  $("habit-form").hidden = !open;
  $("habit-new").setAttribute("aria-expanded", String(open));
  $("habit-error").hidden = true;
  if (open) $("habit-name").focus();
  else $("habit-new").focus();
}
$("habit-new").addEventListener("click", () => showHabitForm($("habit-form").hidden));
$("habit-cancel").addEventListener("click", () => showHabitForm(false));
$("habit-form").addEventListener("keydown", (e) => { if (e.key === "Escape") showHabitForm(false); });
$("habit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("habit-name").value.trim();
  if (!name) {
    $("habit-error").textContent = "Give the habit a name.";
    $("habit-error").hidden = false;
    $("habit-name").focus();
    return;
  }
  const submit = e.submitter ?? $("habit-form").querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/habits", {
      method: "POST",
      body: JSON.stringify({ name, category: $("habit-category").value, target_sessions: Number($("habit-target").value) }),
    });
    $("habit-name").value = "";
    showHabitForm(false);
    habitsDoneBefore = null; // a new habit already met today shouldn't announce itself
    await loadHabits();
  } catch (err) {
    $("habit-error").textContent = err.message;
    $("habit-error").hidden = false;
  } finally {
    submit.disabled = false;
  }
});

// ---------- Study room (body doubling) ----------
// Socket.IO connects only once you make or join a room (or were in one before a reload),
// so the page costs nothing extra for people who never use rooms.
let roomSocket = null;
// The server's clock may differ from this computer's: endAt is the server's time
let serverOffset = 0;
const ME = document.body.dataset.username || "";

// A short note inside the Study room card itself (not under the timer), gone after 3 seconds
let roomNoteTimer = null;
function roomNote(text) {
  const el = $("room-note");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(roomNoteTimer);
  roomNoteTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function roomError(text) {
  $("room-error").textContent = text;
  $("room-error").hidden = !text;
}

function connectRoom() {
  if (roomSocket) return roomSocket;
  if (typeof io !== "function") {
    roomError("Study rooms aren't available right now. Try reloading the page.");
    return null;
  }
  roomSocket = io({ transports: ["websocket", "polling"] });
  roomSocket.on("room:state", renderRoom);
  // How far this computer's clock is from the server's, so everyone's countdown matches
  roomSocket.on("room:clock", (serverNow) => { serverOffset = serverNow - Date.now(); });
  roomSocket.on("connect_error", (err) => roomError(err.message === "Log in to use study rooms" ? "Log in again to use study rooms." : "Can't reach the study room. Trying again…"));
  roomSocket.on("connect", () => roomError(""));
  return roomSocket;
}

// ---------- The room's shared timer ----------
let roomAnswered = 0; // the last question (seq) answered, so each is asked once
let roomJoinedMs = null; // focus time left when I joined (only those minutes are saved)
let askTimer = null;
let askShownFor = 0; // the question (seq) on screen, so a re-sent state doesn't restart it

const ASK_MS = 15000;
const PHASE_NAME = { focus: "Focus", short: "Short break", long: "Long break" };

function renderRoom(state) {
  const before = roomState;
  roomState = state;
  const inRoom = Boolean(state);
  $("room-out").hidden = inRoom;
  $("room-in").hidden = !inRoom;
  try { inRoom ? localStorage.setItem("inRoom", "1") : localStorage.removeItem("inRoom"); } catch { /* fine without */ }
  if (!inRoom) {
    if (roomFollowing) leaveRoomTimer(true);
    hideAsk();
    return;
  }
  $("room-code").textContent = state.code;
  const others = state.members.length - 1;
  $("room-people").textContent = others === 0
    ? "Just you so far. Send the code to a friend."
    : `You and ${others === 1 ? "1 other person are" : `${others} others are`} in this room.`;
  const list = $("room-members");
  list.innerHTML = "";
  for (const m of state.members) {
    const li = document.createElement("li");
    const own = state.phase !== "idle" && state.phase !== "asking" && !m.following;
    li.textContent = `${m.name}${m.name === state.host ? " (host)" : ""}${own ? " · own timer" : ""}`;
    li.className = [m.name === ME ? "me" : "", own ? "own" : ""].join(" ").trim();
    list.append(li);
  }

  // Who did what: "Amber paused", shown once per change
  const a = state.lastAction;
  if (a?.by && a.by !== ME && JSON.stringify(a) !== JSON.stringify(before?.lastAction) && (roomFollowing || a.what === "stopped the timer")) {
    roomNote(`${a.by} ${a.what === "started" ? "started a focus" : a.what}.`);
  }

  // The room timer stopped (someone pressed reset, or a break ended): my timer leaves it
  if (state.phase === "idle") {
    hideAsk();
    if (roomFollowing) leaveRoomTimer(a?.what === "stopped the timer");
  } else if (state.phase === "asking") {
    // Someone pressed Start (or a break is due): nothing runs until everyone asked has answered,
    // or 15 seconds are up. Only the people still to answer see the question.
    if (state.asking.waitingFor.includes(ME)) {
      if (askShownFor !== state.seq) askToJoin(state);
    } else hideAsk();
  } else {
    hideAsk();
    const meOn = state.members.find((m) => m.name === ME)?.following;
    if (state.seq > roomAnswered) {
      // The question is over and the timer has started: on it if I said yes (or started it)
      roomAnswered = state.seq;
      if (meOn) followRoom();
      else if (roomFollowing) leaveRoomTimer(false);
      else if (state.phase === "focus" && before === null && askShownFor !== state.seq) askToJoin(state); // just walked in mid-focus
    } else if (roomFollowing) {
      syncToRoom();
    }
  }
  renderRoomTimer();
}

// My timer copies the room's: same phase, same end time (or the same time left while paused)
function syncToRoom() {
  const st = roomState;
  stop();
  mode = st.phase;
  if (st.running) {
    endAt = st.endAt - serverOffset;
    tick = setInterval(onTick, 250);
  } else {
    remainingMs = st.remainingMs;
  }
  render();
}

function followRoom() {
  // A focus of my own that I'd started is kept: the minutes I did are saved before I join
  saveUnfinishedFocus();
  roomFollowing = true;
  // Time left in the room's focus right now (the state may be a few seconds old)
  roomJoinedMs = roomState.phase !== "focus" ? null
    : roomState.running ? Math.max(0, roomState.endAt - serverOffset - Date.now()) : roomState.remainingMs;
  roomSocket.emit("room:follow", true);
  if (mode === "focus" && !els.label.value.trim()) {
    showMessage("You're on the room timer. Type what you're working on above, so it's saved with your session.");
  }
  syncToRoom();
  renderRoomTimer();
}

// Off the room timer. saveWork: keep the focus minutes I did with the room
function leaveRoomTimer(saveWork) {
  if (saveWork) saveUnfinishedFocus();
  roomFollowing = false;
  roomJoinedMs = null;
  stop();
  mode = "focus";
  remainingMs = minutesFor("focus") * UNIT;
  render();
  renderRoomTimer();
}

function setFollow(on) {
  if (!roomState || roomState.phase === "idle") return;
  roomAnswered = roomState.seq;
  hideAsk();
  if (on) followRoom();
  else {
    roomSocket.emit("room:follow", false);
    leaveRoomTimer(true);
  }
}

// The focus time already done on my timer (since I joined the room, or of my own focus), saved
// when it would otherwise be lost: joining another session, leaving the room timer, a reset.
function saveUnfinishedFocus() {
  if (mode !== "focus") return;
  const left = currentRemaining();
  if (left <= 0) return; // a finished focus was already saved
  const total = roomFollowing && roomJoinedMs !== null ? roomJoinedMs : minutesFor("focus") * UNIT;
  const doneUnit = roomFollowing ? roomState?.unitMs ?? UNIT : UNIT;
  const minutes = Math.floor((total - left) / doneUnit);
  if (minutes >= 1 && total - left < total) {
    if (!els.label.value.trim()) els.label.value = roomFollowing ? "Study room" : "Focus";
    saveSession(minutes);
  }
}

// My focus with the room ended: save the minutes I was there, then wait for the room's break question
async function finishWithRoom() {
  if (mode === "focus") {
    const unit = roomState?.unitMs ?? UNIT;
    const minutes = Math.max(1, Math.round((roomJoinedMs ?? totalFor("focus")) / unit));
    if (!els.label.value.trim()) els.label.value = "Study room";
    round += 1;
    await saveSession(minutes);
    roomJoinedMs = null;
    els.completeText.textContent = `Nice work on “${els.label.value.trim()}”, together with your room.`;
    els.ratingButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
    els.startBreak.hidden = true;
    els.completePanel.hidden = false;
  }
  remainingMs = 0;
  render();
}

function askToJoin(state) {
  askShownFor = state.seq;
  const q = state.asking; // null when I walked in during a focus that's already running
  const phase = q ? q.phase : state.phase;
  const by = q ? q.by : state.lastAction?.by;
  const mins = state.preset[phase];
  $("room-ask-text").textContent = phase === "focus"
    ? `${by ?? "Someone"} wants to start a ${mins}-minute focus. Join?`
    : `Break: ${mins} mins. Take it with the room?`;
  if (!q) $("room-ask-text").textContent = `${by ?? "Someone"} is in a ${mins}-minute focus. Join for the rest?`;
  $("room-ask-yes").textContent = phase === "focus" ? "Join" : "Take the break";
  $("room-ask-no").textContent = phase === "focus" ? "Not this one" : "Keep going on my own";
  $("room-ask").hidden = false;
  // The bar runs for exactly the time left to answer (15 seconds, less if the message was slow)
  const ms = q ? Math.max(1000, q.askUntil - serverOffset - Date.now()) : ASK_MS;
  const bar = $("room-ask-bar");
  bar.style.animation = "none";
  void bar.offsetWidth;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) bar.style.animation = `ask-time ${ms}ms linear forwards`;
  notify(phase === "focus" ? `${by ?? "Someone"} wants to start a focus in your study room.` : "Break time in your study room.");
  clearTimeout(askTimer);
  // No answer in time counts as "not this one" (the server does the same, so nobody waits longer)
  const seq = state.seq;
  askTimer = setTimeout(() => { if (roomState?.seq === seq && !$("room-ask").hidden) answer(false); }, ms);
}
function hideAsk() {
  clearTimeout(askTimer);
  $("room-ask").hidden = true;
}
function answer(yes) {
  if (!roomState) return;
  hideAsk();
  if (roomState.phase === "asking") {
    // The timer starts for everyone at once when the last person answers
    roomSocket.emit("room:answer", yes);
    return;
  }
  roomAnswered = roomState.seq;
  if (yes) followRoom();
  else if (roomFollowing) {
    roomSocket.emit("room:follow", false);
    leaveRoomTimer(false);
  }
}
$("room-ask-yes").addEventListener("click", () => answer(true));
$("room-ask-no").addEventListener("click", () => answer(false));
$("room-follow").addEventListener("change", (e) => setFollow(e.target.checked));

// The little line in the room card: what the room is doing, for people not on its timer too
function renderRoomTimer() {
  const st = roomState;
  const box = $("room-timer");
  box.hidden = !st || st.phase === "idle";
  if (box.hidden) return;
  if (st.phase === "asking") {
    // "Waiting for amber… 12s": the person who pressed Start (and anyone who said yes) sees who's left
    const q = st.asking;
    const secs = Math.max(0, Math.ceil((q.askUntil - serverOffset - Date.now()) / 1000));
    const who = q.waitingFor.filter((n) => n !== ME);
    $("room-follow").closest(".room-switch").hidden = true;
    $("room-phase").textContent = `Room: ${PHASE_NAME[q.phase]} of ${q.minutes} mins starts soon ·`;
    $("room-left").textContent = who.length
      ? `waiting for ${who.length <= 2 ? who.join(" and ") : `${who.length} people`} (${secs}s)`
      : `${secs}s`;
    return;
  }
  $("room-follow").closest(".room-switch").hidden = false;
  $("room-follow").checked = roomFollowing;
  $("room-phase").textContent = `Room: ${PHASE_NAME[st.phase]}${st.running ? "" : " (paused)"} ·`;
  const left = st.running ? st.endAt - serverOffset - Date.now() : st.remainingMs;
  $("room-left").textContent = `${format(left)} left`;
}
setInterval(() => { if (roomState && roomState.phase !== "idle") renderRoomTimer(); }, 1000);

// Start / pause: in a room, the room's timer (a new focus asks the others); otherwise your own
function startOrPause() {
  if (roomFollowing) return roomSocket.emit(roomState?.running ? "room:pause" : "room:start");
  if (roomState && roomState.phase === "idle" && !isRunning()) {
    if (mode !== "focus") return start();
    if (!els.label.value.trim()) {
      showMessage("What are you working on? Type it above, then press Start.", true);
      els.label.focus();
      return;
    }
    // My own paused focus is kept before the room's starts
    saveUnfinishedFocus();
    return roomSocket.emit("room:start", {
      preset: { focus: minutesFor("focus"), short: minutesFor("short"), long: minutesFor("long"), every: Number(settings.every), autoBreaks: Boolean(settings.auto) },
      fast: FAST,
    });
  }
  return isRunning() ? pause() : start();
}


$("room-create").addEventListener("click", () => {
  const s = connectRoom();
  if (!s) return;
  s.emit("room:create", null, (r) => {
    if (!r?.ok) roomError("Couldn't make a room. Try again.");
  });
});
$("room-join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const typed = $("room-code-input").value;
  if (!typed.trim()) return roomError("Type the code your friend sent you.");
  const s = connectRoom();
  if (!s) return;
  s.emit("room:join", typed, (r) => {
    if (r?.ok) { $("room-code-input").value = ""; roomError(""); }
    else roomError(r?.error ?? "Couldn't join. Try again.");
  });
});
$("room-leave").addEventListener("click", () => {
  if (roomFollowing) leaveRoomTimer(true);
  roomSocket?.emit("room:leave", null, () => renderRoom(null));
});
$("room-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("room-code").textContent);
    roomNote("Code copied. Send it to a friend.");
  } catch {
    roomNote(`Copy didn't work here. The code is ${$("room-code").textContent}.`);
  }
});
// Were you in a room before reloading? Reconnect: the server puts you back in it
try { if (localStorage.getItem("inRoom")) connectRoom(); } catch { /* fine without */ }

// ---------- Wire up ----------
els.rangeTabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    reportRange = tab.dataset.range;
    els.rangeTabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    loadReport();
  }),
);
els.start.addEventListener("click", startOrPause);
els.navStarts.forEach((b) => b.addEventListener("click", startOrPause));

// ---------- Pages: Focus (timer + tasks) and Reports ----------
// Switched in the page with the URL hash (#/ and #/reports), so a running timer never stops.
function showView() {
  const view = location.hash === "#/reports" ? "reports" : "focus";
  document.body.dataset.view = view;
  els.viewLinks.forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => withTransition(showView));
showView();

// ---------- Focus mode: only the timer on screen ----------
function setFocusMode(on) {
  document.body.classList.toggle("focus-mode", on);
  els.focusModeBtn.setAttribute("aria-pressed", String(on));
  els.focusModeBtn.querySelector("span").textContent = on ? "Exit focus mode" : "Focus mode";
}
els.focusModeBtn.addEventListener("click", () =>
  withTransition(() => setFocusMode(!document.body.classList.contains("focus-mode"))),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("focus-mode")) withTransition(() => setFocusMode(false));
});
els.showMore.addEventListener("click", async () => {
  els.showMore.disabled = true;
  try {
    const page = await api(`/api/sessions?limit=10&before=${nextBefore}`);
    allSessions = allSessions.concat(page.sessions);
    nextBefore = page.nextBefore;
    renderSessions();
  } catch (err) {
    showMessage(`Couldn't load more sessions. ${err.message}`, true);
  } finally {
    els.showMore.disabled = false;
  }
});
els.reset.addEventListener("click", () => {
  els.completePanel.hidden = true;
  if (roomFollowing) return roomSocket.emit("room:reset");
  setMode(mode);
});
els.skip.addEventListener("click", () => {
  // Following the room: skipping a break ends it for the room; skipping focus leaves the room timer
  if (roomFollowing && mode !== "focus") return roomSocket.emit("room:skipBreak");
  if (roomFollowing) setFollow(false);
  skip();
});
els.tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    if (isRunning() || roomFollowing) return confirmChange();
    els.completePanel.hidden = true;
    setMode(tab.dataset.mode);
  }),
);
els.ratingButtons.forEach((b) => b.addEventListener("click", () => rate(Number(b.dataset.rating))));
els.startBreak.addEventListener("click", start);
els.skipBreak.addEventListener("click", () => {
  els.completePanel.hidden = true;
  setMode("focus");
});
els.taskSelect.addEventListener("change", () => {
  const t = tasks.find((t) => String(t.id) === els.taskSelect.value);
  if (t && els.label.value.trim() === "") els.label.value = t.title.slice(0, 60);
  renderTasks();
});
els.taskForm.addEventListener("submit", addTask);
els.filterButtons.forEach((b) =>
  b.addEventListener("click", () => {
    filter = b.dataset.filter;
    els.filterButtons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTasks();
  }),
);
els.toastUndo.addEventListener("click", () => pendingDelete && pendingDelete.undo());
[els.setFocus, els.setShort, els.setLong, els.setEvery, els.setSound, els.setAuto, els.setNotify].forEach((input) =>
  input.addEventListener("change", onSettingsChange),
);
// Leaving the page during the 5-second undo window still deletes
window.addEventListener("pagehide", () => pendingDelete && pendingDelete.commit());

fillSettingsForm();
renderPresets();
render();
refreshAll();
// Anything finished offline last time goes now
renderOfflineNote();
sendQueued();

// ---------- Streak: last 7 days and a short note ----------
function renderStreak(stats) {
  const dots = $("week-dots");
  dots.innerHTML = "";
  for (const d of stats.week) {
    const li = document.createElement("li");
    const date = new Date(`${d.day}T00:00:00Z`);
    const name = date.toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" });
    li.textContent = name[0];
    li.className = d.minutes > 0 ? "on" : "";
    li.title = `${name}: ${d.minutes} min`;
    li.setAttribute("aria-label", `${name}, ${d.minutes > 0 ? `${d.minutes} minutes` : "no focus"}`);
    dots.append(li);
  }
  lastStreakStats = stats;
  const focusedToday = stats.today.count > 0;
  const left = msToMidnight();
  const atRisk = stats.streak > 0 && !focusedToday && left <= AT_RISK_MS;
  let note;
  if (stats.streak === 0 && stats.lostStreak && !focusedToday) {
    note = `Your ${stats.lostStreak.days}-day streak ended yesterday. One session today starts a new one.`;
  } else if (stats.streak === 0) note = "Finish one session today to start a streak.";
  else if (atRisk) note = `${formatLeft(left)} left to keep your ${stats.streak}-day streak. One session saves it.`;
  else if (!focusedToday) note = `One session today keeps your ${stats.streak}-day streak going.`;
  else if (stats.streak >= stats.bestStreak && stats.streak > 1) note = "Your longest streak yet.";
  else note = `Best: ${stats.bestStreak} day${stats.bestStreak === 1 ? "" : "s"}`;
  $("streak-note").textContent = note;
  $("streak-note").classList.toggle("at-risk", atRisk);
}

// The last hours of the day (Brisbane time, like the streak): a streak not saved yet is "at risk"
const AT_RISK_MS = 6 * 60 * 60 * 1000;
function msToMidnight(now = Date.now()) {
  const DAY = 86400000;
  return DAY - ((now + 10 * 3600000) % DAY); // Brisbane is UTC+10 all year
}
// "5 hrs", "1 hr", "40 mins"
function formatLeft(ms) {
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"}`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs === 1 ? "" : "s"}`;
}
// The countdown moves on by itself, and the day changes at midnight without a reload
let lastStreakStats = null;
setInterval(() => {
  if (lastStreakStats) renderStreak(lastStreakStats);
  if (habits.length) renderHabits();
}, 60000);

// ---------- Lofi music ----------
// CC0 (public domain) tracks in public/audio, listed in tracks.json. Music plays only while a
// focus session runs; it pauses (and keeps its place) on pause, reset and breaks.
const lofi = (() => {
  const audio = new Audio();
  audio.preload = "none";
  let tracks = [];
  let index = 0;
  let loaded = false;
  let wantPlaying = false;
  let fade = null;

  const els = { toggle: $("lofi-toggle"), track: $("lofi-track"), next: $("lofi-next"), volume: $("lofi-volume") };

  async function load() {
    if (loaded) return tracks.length > 0;
    loaded = true;
    try {
      const res = await fetch("/audio/tracks.json");
      tracks = res.ok ? await res.json() : [];
    } catch {
      tracks = [];
    }
    // Start somewhere different each visit, so it isn't always the same first song
    index = tracks.length ? Math.floor(Math.random() * tracks.length) : 0;
    return tracks.length > 0;
  }

  function setTrack(i) {
    index = (i + tracks.length) % tracks.length;
    const t = tracks[index];
    audio.src = `/audio/${t.file}`;
    els.track.textContent = `${t.title} · ${t.artist}`;
  }

  // Gentle volume changes instead of starting or stopping abruptly
  function fadeTo(target, ms, then) {
    clearInterval(fade);
    const start = audio.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let n = 0;
    fade = setInterval(() => {
      n += 1;
      audio.volume = Math.min(1, Math.max(0, start + ((target - start) * n) / steps));
      if (n >= steps) {
        clearInterval(fade);
        if (then) then();
      }
    }, 50);
  }

  function play() {
    if (!audio.src) setTrack(index);
    audio.volume = 0;
    audio.play().then(() => fadeTo(settings.lofiVolume, 800)).catch(() => {
      els.track.textContent = "Press Start again to play music";
    });
  }

  function pause() {
    fadeTo(0, 500, () => audio.pause());
  }

  audio.addEventListener("ended", () => {
    setTrack(index + 1);
    if (wantPlaying) play();
  });
  audio.addEventListener("error", () => {
    if (!audio.src) return;
    els.track.textContent = "This track didn't load. Trying the next one.";
    setTimeout(() => { setTrack(index + 1); if (wantPlaying) play(); }, 1500);
  });

  function renderControls() {
    els.toggle.setAttribute("aria-pressed", String(settings.lofi));
    els.next.hidden = !settings.lofi;
    els.volume.hidden = !settings.lofi;
    if (!settings.lofi) els.track.textContent = "";
    else if (!audio.src && tracks.length) els.track.textContent = "Plays while you focus";
  }

  els.volume.value = settings.lofiVolume;
  els.toggle.addEventListener("click", async () => {
    settings.lofi = !settings.lofi;
    saveSettings();
    if (settings.lofi && !(await load())) {
      settings.lofi = false;
      els.track.textContent = "No music found.";
    }
    renderControls();
    lofi.sync(Boolean(tick) && mode === "focus");
  });
  els.next.addEventListener("click", () => {
    if (!tracks.length) return;
    setTrack(index + 1);
    if (wantPlaying) play();
  });
  els.volume.addEventListener("input", () => {
    settings.lofiVolume = Number(els.volume.value);
    saveSettings();
    if (wantPlaying) { clearInterval(fade); audio.volume = settings.lofiVolume; }
  });
  if (settings.lofi) load().then(renderControls);
  renderControls();

  return {
    // Called from render() on every tick; only acts when focusing starts or stops
    sync(focusing) {
      const want = settings.lofi && focusing && tracks.length > 0;
      if (want === wantPlaying) return;
      wantPlaying = want;
      if (want) play(); else if (!audio.paused) pause();
    },
  };
})();

syncSound = () => lofi.sync(Boolean(tick) && mode === "focus");
