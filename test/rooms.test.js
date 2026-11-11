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
  assert.deepEqual(rooms.state(code, 0).members.map((m) => m.name), ["vy", "amber"]);
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
  assert.deepEqual(rooms.state(a, 0).members.map((m) => m.name), ["vy"]);
  assert.deepEqual(rooms.state(b, 0).members.map((m) => m.name), ["amber", "chris"]);
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

// ---------- The shared timer ----------
const { cleanPreset } = require("../rooms");

test("start: the room runs a focus, the person who started it follows it, and the question number goes up", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.join(amber, code);
  rooms.start(vy, 1000, { preset: { focus: 50, short: 10, long: 20, every: 4 } });
  const s = rooms.state(code, 1000);
  assert.equal(s.phase, "focus");
  assert.equal(s.endAt, 1000 + 50 * MIN);
  assert.equal(s.seq, 1);
  assert.deepEqual(s.members, [{ name: "vy", following: true }, { name: "amber", following: false }]);
  assert.deepEqual(s.lastAction, { by: "vy", what: "started" });
});

test("saying yes later joins with the time that's left", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.join(amber, code);
  rooms.start(vy, 0);
  rooms.follow(amber.id, true);
  const s = rooms.state(code, 10 * MIN);
  assert.equal(s.remainingMs, 15 * MIN);
  assert.equal(s.members[1].following, true);
});

test("saying no (or switching off follow) leaves you in the room, on your own timer", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.join(amber, code);
  rooms.start(vy, 0);
  rooms.follow(amber.id, true);
  rooms.follow(amber.id, false);
  assert.deepEqual(rooms.state(code, 0).members.map((m) => m.following), [true, false]);
});

test("pause keeps the time left; resume carries on; it says who did it", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.join(amber, code);
  rooms.start(vy, 0);
  rooms.pause(amber, 5 * MIN);
  assert.equal(rooms.state(code, 9 * MIN).remainingMs, 20 * MIN);
  assert.deepEqual(rooms.state(code, 9 * MIN).lastAction, { by: "amber", what: "paused" });
  rooms.start(vy, 9 * MIN);
  assert.equal(rooms.state(code, 9 * MIN).endAt, 29 * MIN);
  assert.equal(rooms.state(code, 9 * MIN).seq, 1, "resuming isn't a new question");
});

test("when focus ends with automatic breaks: a short break starts and everyone is asked again", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy, 0);
  assert.equal(rooms.advance(code, 10 * MIN), null, "not before the end");
  rooms.advance(code, 25 * MIN);
  const s = rooms.state(code, 25 * MIN);
  assert.equal(s.phase, "short");
  assert.equal(s.endAt, 30 * MIN);
  assert.equal(s.seq, 2);
  assert.equal(s.round, 1);
});

test("every 4th focus is followed by a long break, then the round count starts again", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  let t = 0;
  for (let i = 0; i < 4; i += 1) {
    rooms.start(vy, t);
    t += 25 * MIN;
    rooms.advance(code, t);
    if (i < 3) { t += 5 * MIN; rooms.advance(code, t); }
  }
  assert.equal(rooms.state(code, t).phase, "long");
  rooms.advance(code, t + 15 * MIN);
  assert.equal(rooms.state(code, t + 15 * MIN).round, 0);
  assert.equal(rooms.state(code, t + 15 * MIN).phase, "idle");
});

test("without automatic breaks the room goes back to idle after focus", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy, 0, { preset: { focus: 25, short: 5, long: 15, every: 4, autoBreaks: false } });
  rooms.advance(code, 25 * MIN);
  assert.equal(rooms.state(code, 25 * MIN).phase, "idle");
});

test("ending a break early and stopping the timer", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy, 0);
  rooms.advance(code, 25 * MIN);
  rooms.skipBreak(amber); // amber isn't in the room: nothing happens
  assert.equal(rooms.state(code, 25 * MIN).phase, "short");
  rooms.skipBreak(vy);
  assert.equal(rooms.state(code, 25 * MIN).phase, "idle");
  rooms.start(vy, 30 * MIN);
  rooms.reset(vy);
  const s = rooms.state(code, 31 * MIN);
  assert.equal(s.phase, "idle");
  assert.ok(s.members.every((m) => !m.following));
});

test("lengths are checked like the solo timer's settings", () => {
  assert.deepEqual(cleanPreset({ focus: 0, short: 999, long: "x", every: 1 }), { focus: 25, short: 5, long: 15, every: 4, autoBreaks: true });
  assert.deepEqual(cleanPreset({ focus: 50, short: 10, long: 20, every: 3, autoBreaks: false }), { focus: 50, short: 10, long: 20, every: 3, autoBreaks: false });
});

test("fast mode (localhost testing) counts seconds", () => {
  const rooms = new Rooms();
  const code = rooms.create(vy);
  rooms.start(vy, 0, { fast: true });
  assert.equal(rooms.state(code, 0).endAt, 25 * 1000);
});

test("someone not in a room can't start or pause anything", () => {
  const rooms = new Rooms();
  assert.equal(rooms.start(chris, 0), null);
  assert.equal(rooms.pause(chris, 0), null);
});
