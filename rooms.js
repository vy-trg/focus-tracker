// Study rooms ("body doubling"): people focus on the same timer together.
// This file is only the rules, with no sockets or database, so all of it is unit tested.
// The server keeps rooms in memory: a restart (e.g. a Render deploy) closes every room,
// which is fine for a timer that lasts minutes, and nobody's sessions are lost (those are in Postgres).

// No 0/O or 1/I/L, so a code read out loud or copied by hand can't be mistyped
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_MEMBERS = 12;
const MAX_ROOMS_PER_USER = 1; // one room at a time each; joining another leaves the first

function makeCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

// "ab c-d2 3f" -> "ABCD23F" style clean-up of what someone typed; null when it can't be a code
function normaliseCode(text) {
  const code = String(text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_LETTERS.includes(ch)) return null;
  return code;
}

class Rooms {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.rooms = new Map(); // code -> room
    this.userRoom = new Map(); // user id -> code
  }

  // A new room with a code nobody is using; the creator is in it
  create(user) {
    this.leave(user.id);
    let code;
    do code = makeCode(this.random);
    while (this.rooms.has(code));
    this.rooms.set(code, {
      code,
      hostId: user.id,
      members: new Map([[user.id, user.username]]),
      minutes: 25,
      endAt: null, // when the shared timer ends (ms since 1970), while it runs
      remainingMs: 25 * 60 * 1000, // what's left while paused or not started
    });
    this.userRoom.set(user.id, code);
    return code;
  }

  // { ok: true, code } or { ok: false, error } — the error is shown to the person as is
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

  // Leaving the last seat closes the room; if the host leaves, the next person becomes host
  leave(userId) {
    const code = this.userRoom.get(userId);
    if (!code) return null;
    this.userRoom.delete(userId);
    const room = this.rooms.get(code);
    if (!room) return null;
    room.members.delete(userId);
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

  // Start (or resume) the shared timer. The server stores only endAt, so everyone, including
  // people who join later, works out the same time left from it.
  start(userId, now) {
    const room = this.roomOf(userId);
    if (!room || room.endAt !== null) return room;
    room.endAt = now + room.remainingMs;
    return room;
  }

  pause(userId, now) {
    const room = this.roomOf(userId);
    if (!room || room.endAt === null) return room;
    room.remainingMs = Math.max(0, room.endAt - now);
    room.endAt = null;
    return room;
  }

  // Set the length (only while stopped): 1-180 minutes, like the solo timer
  setMinutes(userId, minutes) {
    const room = this.roomOf(userId);
    const m = Math.round(Number(minutes));
    if (!room || room.endAt !== null || !(m >= 1 && m <= 180)) return room;
    room.minutes = m;
    room.remainingMs = m * 60 * 1000;
    return room;
  }

  reset(userId) {
    const room = this.roomOf(userId);
    if (!room) return room;
    room.endAt = null;
    room.remainingMs = room.minutes * 60 * 1000;
    return room;
  }

  // What everyone in the room is sent. A finished timer reads as 0 left, not negative.
  state(code, now) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const running = room.endAt !== null && room.endAt > now;
    return {
      code,
      minutes: room.minutes,
      running,
      endAt: room.endAt,
      remainingMs: room.endAt !== null ? Math.max(0, room.endAt - now) : room.remainingMs,
      finished: room.endAt !== null && room.endAt <= now,
      host: room.members.get(room.hostId),
      members: [...room.members.values()],
    };
  }
}

module.exports = { Rooms, makeCode, normaliseCode, CODE_LETTERS, CODE_LENGTH, MAX_MEMBERS };
