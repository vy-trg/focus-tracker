const test = require("node:test");
const assert = require("node:assert/strict");
const { startReminders, dueReminders } = require("../public/reminders");

const MIN = 60 * 1000;

test("eye break every 20 minutes of focus; water at the time you chose", () => {
  let s = startReminders({ eye: true, water: true, waterEvery: 45 });
  assert.deepEqual(dueReminders(s, 19 * MIN).due, []);
  let r = dueReminders(s, 20 * MIN);
  assert.deepEqual(r.due, ["eye"]);
  s = r.state;
  assert.deepEqual(dueReminders(s, 39 * MIN).due, []);
  r = dueReminders(s, 45 * MIN);
  assert.deepEqual(r.due, ["eye", "water"]);
});

test("switched off: never due", () => {
  const s = startReminders({ eye: false, water: false });
  assert.deepEqual(dueReminders(s, 500 * MIN).due, []);
});

test("a tab asleep for an hour gives one reminder, not three", () => {
  const s = startReminders({ eye: true, water: false });
  const r = dueReminders(s, 70 * MIN);
  assert.deepEqual(r.due, ["eye"]);
  assert.equal(r.state.eyeAt, 90 * MIN, "the next one is 20 minutes after this one");
});

test("time counted is focus time only: the page passes in focus time, so breaks don't move it", () => {
  // 25 min focus (eye at 20), 5 min break (not counted), then focus again: next eye at 40 min of focus
  let s = startReminders({ eye: true, water: false });
  s = dueReminders(s, 20 * MIN).state;
  assert.deepEqual(dueReminders(s, 25 * MIN).due, []);
  assert.deepEqual(dueReminders(s, 40 * MIN).due, ["eye"]);
});

test("turning one on part way starts its clock from now", () => {
  const s = startReminders({ eye: true, water: true, waterEvery: 30 }, 50 * MIN);
  assert.equal(s.eyeAt, 70 * MIN);
  assert.equal(s.waterAt, 80 * MIN);
});
