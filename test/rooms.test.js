const test = require("node:test");
const assert = require("node:assert/strict");
const { Rooms, makeCode, normaliseCode, CODE_LETTERS, MAX_MEMBERS } = require("../rooms");

const vy = { id: 1, username: "vy" };
const amber = { id: 2, username: "amber" };
const chris = { id: 3, username: "chris" };
const MIN = 60 * 1000;

// ---------- Codes ----------

test("a code is 6 characters, with no 0, O, 1, I or L", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = makeCode();
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.doesNotMatch(code, /[01OIL]/);
  }
  assert.doesNotMatch(CODE_LETTERS, /[01OIL]/);
});

test("what people type is cleaned up: lower case, spaces and dashes are fine", () => {
  assert.equal(normaliseCode("k7m2qx"), "K7M2QX");
  assert.equal(normaliseCode(" k7m-2qx "), "K7M2QX");
  assert.equal(normaliseCode("K7M 2QX"), "K7M2QX");
  assert.equal(normaliseCode("K7M2Q"), null); // too short
  assert.equal(normaliseCode("K7M2QXA"), null); // too long
  assert.equal(normaliseCode("K7M20X"), null); // 0 is never in a code
});

test("two rooms never get the same code", () => {
  // A random source that repeats itself: the second room must try again
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  const rooms = new Rooms({ random: () => seq[i++ % seq.length] });
  const a = rooms.create(vy);
  const b = rooms.create(amber);
  assert.notEqual(a, b);
});

// ---------- Joining and leaving ----------

test("join by code; everyone in the room is listed", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  assert.deepEqual(rooms.join(amber, code.toLowerCase()), { ok: true, code });
  assert.deepEqual(rooms.state(code, 0).members, ["vy", "amber"]);
  assert.equal(rooms.state(code, 0).host, "vy");
});

test("a wrong code says why", () => {
  const rooms = new Rooms();
  assert.match(rooms.join(amber, "abc").error, /6 letters/);
  assert.match(rooms.join(amber, "K7M2QA").error, /No room/);
});

test("a full room says so", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  for (let id = 10; id < 10 + MAX_MEMBERS - 1; id += 1) rooms.join({ id, username: `u${id}` }, code);
  assert.match(rooms.join(chris, code).error, /full/);
});

test("joining another room leaves the first one", () => {
  const rooms = new Rooms();
  const a = rooms.create(vy);
  const b = rooms.create(amber);
  rooms.join(chris, a);
  rooms.join(chris, b);
  assert.deepEqual(rooms.state(a, 0).members, ["vy"]);
  assert.deepEqual(rooms.state(b, 0).members, ["amber", "chris"]);
});

test("the last person leaving closes the room; the host leaving hands it on", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.join(amber, code);
  rooms.leave(vy.id);
  assert.equal(rooms.state(code, 0).host, "amber");
  rooms.leave(amber.id);
  assert.equal(rooms.state(code, 0), null);
});

// ---------- The shared timer: the server only stores endAt ----------

test("start stores endAt; someone joining later sees the same time left", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy.id, 1000);
  assert.equal(rooms.state(code, 1000).endAt, 1000 + 25 * MIN);
  rooms.join(amber, code);
  const later = rooms.state(code, 1000 + 10 * MIN);
  assert.equal(later.running, true);
  assert.equal(later.remainingMs, 15 * MIN);
});

test("pause keeps what was left; start again carries on from there", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy.id, 0);
  rooms.pause(vy.id, 5 * MIN);
  assert.equal(rooms.state(code, 9 * MIN).remainingMs, 20 * MIN); // time doesn't move while paused
  rooms.start(vy.id, 9 * MIN);
  assert.equal(rooms.state(code, 9 * MIN).endAt, 29 * MIN);
});

test("anyone in the room can start or pause it", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.join(amber, code);
  rooms.start(amber.id, 0);
  assert.equal(rooms.state(code, 0).running, true);
});

test("a finished timer shows 0 left and finished, never a negative number", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy.id, 0);
  const s = rooms.state(code, 30 * MIN);
  assert.equal(s.remainingMs, 0);
  assert.equal(s.finished, true);
  assert.equal(s.running, false);
});

test("the length can only change while stopped, and only to 1-180 minutes", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.setMinutes(vy.id, 50);
  assert.equal(rooms.state(code, 0).remainingMs, 50 * MIN);
  rooms.setMinutes(vy.id, 0);
  rooms.setMinutes(vy.id, 999);
  assert.equal(rooms.state(code, 0).minutes, 50);
  rooms.start(vy.id, 0);
  rooms.setMinutes(vy.id, 10);
  assert.equal(rooms.state(code, 0).minutes, 50);
});

test("reset goes back to the full length", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy.id, 0);
  rooms.reset(vy.id);
  assert.deepEqual([rooms.state(code, 5 * MIN).running, rooms.state(code, 5 * MIN).remainingMs], [false, 25 * MIN]);
});

test("someone not in a room can't start or pause anything", () => {
  const rooms = new Rooms();
  assert.equal(rooms.start(chris.id, 0), null);
  assert.equal(rooms.pause(chris.id, 0), null);
});
