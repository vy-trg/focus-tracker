// Focus Tracker in the browser: timer with breaks, presets, tasks, insights and history.
// Talks to the API with fetch; every request is answered only with the logged-in user's data.

// ---------- Settings (saved in this browser) ----------
const PRESETS = {
  classic: { focus: 25, short: 5, long: 15, name: "Classic", hint: "Study" },
  coding: { focus: 50, short: 10, long: 20, name: "Coding", hint: "Writing" },
  deep: { focus: 90, short: 20, long: 30, name: "Deep work", hint: "Big tasks" },
  sprint: { focus: 15, short: 3, long: 10, name: "Sprint", hint: "Get started" },
};
const DEFAULTS = { preset: "classic", ...PRESETS.classic, every: 4, sound: true, notify: false, auto: true };

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

function render() {
  const total = minutesFor(mode) * UNIT;
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
  if (isRunning() && !confirmChange()) return;
  settings = { ...settings, preset: key, ...pick(PRESETS[key], ["focus", "short", "long"]) };
  saveSettings();
  fillSettingsForm();
  renderPresets();
  setMode(mode);
}

function confirmChange() {
  showMessage("The timer is running. Pause it first, then change the length.", true);
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
// If saving fails (e.g. Wi-Fi drops), the session is kept here and sent again
// when the connection comes back, so a finished focus block is never lost.
let unsaved = null;

async function saveSession(minutes) {
  unsaved = {
    label: els.label.value.trim(),
    minutes,
    category: els.category.value,
    task_id: els.taskSelect.value ? Number(els.taskSelect.value) : null,
  };
  await sendUnsaved();
}

async function sendUnsaved() {
  if (!unsaved) return;
  try {
    const saved = await api("/api/sessions", { method: "POST", body: JSON.stringify(unsaved) });
    showMessage(`Saved ${unsaved.minutes} minutes. Nice!`);
    unsaved = null;
    lastSessionId = saved.id;
    refreshAll();
  } catch (err) {
    lastSessionId = null;
    showMessage(`Couldn't save this session yet. ${err.message} We'll keep it and try again.`, true);
    setTimeout(sendUnsaved, 15000);
  }
}
window.addEventListener("online", sendUnsaved);

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
    if (done.length === 0) {
      list.innerHTML = '<li class="empty">Nothing yet today. Finished sessions show up here.</li>';
      return;
    }
    const isNew = todayCount !== null && done.length > todayCount;
    todayCount = done.length;
    for (const s of done) {
      const li = document.createElement("li");
      li.innerHTML = '<span class="today-time"></span><i></i><span class="today-label"></span><b></b>';
      li.querySelector(".today-time").textContent = new Date(s.started_at).toLocaleTimeString([], {
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

function refreshAll() {
  loadToday();
  loadSessions();
  loadStats();
  loadReport();
  loadTasks();
}

// ---------- Wire up ----------
els.rangeTabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    reportRange = tab.dataset.range;
    els.rangeTabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    loadReport();
  }),
);
els.start.addEventListener("click", () => (isRunning() ? pause() : start()));
els.navStarts.forEach((b) => b.addEventListener("click", () => (isRunning() ? pause() : start())));

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
  setMode(mode);
});
els.skip.addEventListener("click", skip);
els.tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    if (isRunning()) return confirmChange();
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
