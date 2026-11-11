// Study rooms ("body doubling"): people focus on the same timer together.
// This file is only the rules, with no sockets or database, so all of it is unit tested.
// The server keeps rooms in memory: a restart (e.g. a Render deploy) closes every room,
// which is fine for a timer that lasts minutes, and nobody's sessions are lost (those are in Postgres).
//
// The shared timer: anyone in the room can start it. Starting a focus (or a break, when the room
// has "breaks start automatically") first asks the others whether they want to join. The timer
// waits (phase "asking") until everyone asked has answered, or 15 seconds have gone by; then it
// starts for the person who started it and everyone who said yes ("following"). Pause, resume and reset apply
// straight away to everyone following. Music, task names and categories stay each person's own.

// No 0/O or 1/I/L, so a code read out loud or copied by hand can't be mistyped
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_MEMBERS = 12;
const MINUTE = 60 * 1000;
const ASK_MS = 15 * 1000; // how long the question waits for answers
const DEFAULT_PRESET = { focus: 25, short: 5, long: 15, every: 4, autoBreaks: true };

function makeCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

// "k7m-2qx" -> "K7M2QX"; null when it can't be a code
function normaliseCode(text) {
  const code = String(text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_LETTERS.includes(ch)) return null;
  return code;
}

// The lengths someone starts the room with, checked like the solo timer's settings
function cleanPreset(p = {}) {
  const n = (v, min, max, fallback) => {
    const x = Math.round(Number(v));
    return Number.isInteger(x) && x >= min && x <= max ? x : fallback;
  };
  return {
    focus: n(p.focus, 1, 180, DEFAULT_PRESET.focus),
    short: n(p.short, 1, 60, DEFAULT_PRESET.short),
    long: n(p.long, 1, 60, DEFAULT_PRESET.long),
    every: n(p.every, 2, 8, DEFAULT_PRESET.every),
    autoBreaks: p.autoBreaks === undefined ? DEFAULT_PRESET.autoBreaks : Boolean(p.autoBreaks),
  };
}

class Rooms {
  // unitMs: how long a "minute" is (tests and the ?fast mode on localhost use 1 second)
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.rooms = new Map(); // code -> room
    this.userRoom = new Map(); // user id -> code
  }

  create(user) {
    this.leave(user.id);
    let code;
    do code = makeCode(this.random);
    while (this.rooms.has(code));
    this.rooms.set(code, {
      code,
      hostId: user.id,
      members: new Map([[user.id, user.username]]),
      following: new Set(), // who is on the room's timer right now
      preset: { ...DEFAULT_PRESET },
      unitMs: MINUTE,
      phase: "idle", // "idle" | "asking" | "focus" | "short" | "long"
      pending: null, // while asking: { phase, byId, askUntil, answers: Map(user id -> yes/no) }
      round: 0, // focus blocks finished in this cycle
      endAt: null, // while running: when this phase ends
      remainingMs: 0, // while paused
      seq: 0, // goes up every time a new focus or break begins: one question per seq
      lastAction: null, // { by, what } shown as "Amber paused"
    });
    this.userRoom.set(user.id, code);
    return code;
  }

  join(user, typed) {
    const code = normaliseCode(typed);
    if (!code) return { ok: false, error: "A room code is 6 letters and numbers, like K7M2QX." };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "No room with that code. Check it with the person who made it." };
    if (!room.members.has(user.id) && room.members.size >= MAX_MEMBERS) {
      return { ok: false, error: `That room is full (${MAX_MEMBERS} people).` };
    }
    if (this.userRoom.get(user.id) !== code) this.leave(user.id);
    room.members.set(user.id, user.username);
    this.userRoom.set(user.id, code);
    return { ok: true, code };
  }

  leave(userId) {
    const code = this.userRoom.get(userId);
    if (!code) return null;
    this.userRoom.delete(userId);
    const room = this.rooms.get(code);
    if (!room) return null;
    room.members.delete(userId);
    room.following.delete(userId);
    if (room.members.size > 0 && room.pending) this.#beginIfReady(room, Date.now());
    if (room.members.size === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostId === userId) room.hostId = room.members.keys().next().value;
    return code;
  }

  roomOf(userId) {
    const code = this.userRoom.get(userId);
    return code ? this.rooms.get(code) : null;
  }

  #len(room, phase) {
    return room.preset[phase] * room.unitMs;
  }

  // Start a new focus (when idle) or resume (when paused). A new focus can carry new lengths.
  // The person who starts it follows it; everyone else gets asked (seq goes up).
  start(user, now, { preset, fast = false } = {}) {
    const room = this.roomOf(user.id);
    if (!room) return null;
    if (room.phase === "idle") {
      if (preset) room.preset = cleanPreset(preset);
      room.unitMs = fast ? 1000 : MINUTE;
      room.lastAction = { by: user.username, what: "started" };
      this.#ask(room, "focus", user.id, [...room.members.keys()], now);
    } else if (room.phase !== "asking" && room.endAt === null) {
      room.endAt = now + room.remainingMs;
      room.following.add(user.id);
      room.lastAction = { by: user.username, what: "resumed" };
    }
    return room;
  }

  // Ask the others before a focus or a break begins. Nobody else to ask: it begins at once.
  #ask(room, phase, byId, askIds, now) {
    const answers = new Map();
    if (byId !== null) answers.set(byId, true);
    room.seq += 1;
    room.pending = { phase, byId, askUntil: now + ASK_MS, answers, askIds: new Set(askIds) };
    room.phase = "asking";
    room.endAt = null;
    room.following = new Set();
    this.#beginIfReady(room, now);
  }

  // Everyone asked has answered (or time is up): the timer starts for the yes's
  #beginIfReady(room, now) {
    const p = room.pending;
    if (!p) return false;
    const waiting = [...p.askIds].filter((id) => room.members.has(id) && !p.answers.has(id));
    if (waiting.length > 0 && now < p.askUntil) return false;
    const yes = [...p.answers].filter(([id, ok]) => ok && room.members.has(id)).map(([id]) => id);
    room.pending = null;
    if (yes.length === 0) {
      // Nobody wanted the break: the room goes back to idle
      room.phase = "idle";
      if (p.phase === "long") room.round = 0;
      return true;
    }
    room.phase = p.phase;
    room.endAt = now + this.#len(room, p.phase);
    room.following = new Set(yes);
    return true;
  }

  // Yes / no to the question
  answer(userId, yes, now) {
    const room = this.roomOf(userId);
    if (!room || !room.pending || !room.pending.askIds.has(userId)) return room;
    room.pending.answers.set(userId, Boolean(yes));
    this.#beginIfReady(room, now);
    return room;
  }

  // The question ran out of time (called by the server's timer)
  askTimeout(code, now) {
    const room = this.rooms.get(code);
    if (!room || !room.pending || now < room.pending.askUntil) return null;
    this.#beginIfReady(room, now);
    return room;
  }

  pause(user, now) {
    const room = this.roomOf(user.id);
    if (!room || room.endAt === null || room.phase === "asking") return room;
    room.remainingMs = Math.max(0, room.endAt - now);
    room.endAt = null;
    room.lastAction = { by: user.username, what: "paused" };
    return room;
  }

  // Stop the shared timer altogether (the people following keep what they've done so far: the page saves it)
  reset(user) {
    const room = this.roomOf(user.id);
    if (!room) return room;
    room.phase = "idle";
    room.pending = null;
    room.endAt = null;
    room.remainingMs = 0;
    room.following.clear();
    room.lastAction = { by: user.username, what: "stopped the timer" };
    return room;
  }

  // Skip the rest of a break
  skipBreak(user) {
    const room = this.roomOf(user.id);
    if (!room || (room.phase !== "short" && room.phase !== "long")) return room;
    if (room.phase === "long") room.round = 0;
    room.phase = "idle";
    room.endAt = null;
    room.lastAction = { by: user.username, what: "ended the break" };
    return room;
  }

  // Yes / no to the room's timer (the question, or the "Follow the room timer" switch)
  follow(userId, on) {
    const room = this.roomOf(userId);
    if (!room) return room;
    if (on && room.phase !== "idle" && room.phase !== "asking") room.following.add(userId);
    else room.following.delete(userId);
    return room;
  }

  // Called when a phase's time is up. A focus ends in a break (if the room starts breaks
  // automatically) or back at idle; a break always ends at idle (focus needs someone to press Start).
  advance(code, now) {
    const room = this.rooms.get(code);
    if (!room || room.phase === "asking" || room.endAt === null || room.endAt > now) return null;
    if (room.phase === "focus") {
      room.round += 1;
      if (room.preset.autoBreaks && room.following.size > 0) {
        room.lastAction = { by: null, what: "break" };
        this.#ask(room, room.round >= room.preset.every ? "long" : "short", null, [...room.following], now);
        return room;
      }
    } else if (room.phase === "long") {
      room.round = 0;
    }
    room.phase = "idle";
    room.endAt = null;
    room.following.clear();
    room.lastAction = { by: null, what: "done" };
    return room;
  }

  // What everyone in the room is sent; each page works out the time left from endAt
  state(code, now) {
    const room = this.rooms.get(code);
    if (!room) return null;
    return {
      code,
      phase: room.phase,
      preset: room.preset,
      unitMs: room.unitMs,
      round: room.round,
      running: room.endAt !== null && room.endAt > now,
      endAt: room.endAt,
      remainingMs: room.endAt !== null ? Math.max(0, room.endAt - now) : room.remainingMs,
      totalMs: room.phase === "idle" || room.phase === "asking" ? 0 : this.#len(room, room.phase),
      // While asking: what's about to start, who started it, until when, and who hasn't answered yet
      asking: room.pending && {
        phase: room.pending.phase,
        minutes: room.preset[room.pending.phase],
        by: room.pending.byId === null ? null : room.members.get(room.pending.byId),
        askUntil: room.pending.askUntil,
        asked: [...room.pending.askIds].filter((id) => room.members.has(id)).map((id) => room.members.get(id)),
        waitingFor: [...room.pending.askIds].filter((id) => room.members.has(id) && !room.pending.answers.has(id)).map((id) => room.members.get(id)),
      },
      seq: room.seq,
      lastAction: room.lastAction,
      host: room.members.get(room.hostId),
      members: [...room.members].map(([id, name]) => ({ name, following: room.following.has(id) })),
    };
  }
}

module.exports = { Rooms, makeCode, normaliseCode, cleanPreset, ASK_MS, CODE_LETTERS, CODE_LENGTH, MAX_MEMBERS };
