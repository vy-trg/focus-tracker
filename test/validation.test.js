const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSession, parseId, validateTask, validateTaskTitle, validateTaskUpdate, validateRating, parseRange, parseLimit } = require("../validation");

test("accepts a normal session", () => {
  assert.deepEqual(validateSession({ label: "Study SQL", minutes: 25 }), []);
});

test("rejects minutes that are not whole numbers from 1 to 180", () => {
  for (const minutes of ["abc", 25.5, 0, -5, 181, null]) {
    const errors = validateSession({ label: "x", minutes });
    assert.equal(errors.length, 1, `minutes=${minutes}`);
    assert.equal(errors[0].field, "minutes");
  }
});

test("rejects an empty, missing or too long label", () => {
  for (const label of ["", "   ", undefined, "a".repeat(61)]) {
    const errors = validateSession({ label, minutes: 25 });
    assert.equal(errors[0].field, "label");
  }
});

test("accepts a label of exactly 60 characters", () => {
  assert.deepEqual(validateSession({ label: "a".repeat(60), minutes: 25 }), []);
});

test("returns errors instead of crashing when there is no body", () => {
  const fields = validateSession(undefined).map((e) => e.field);
  assert.deepEqual(fields, ["label", "minutes"]);
});

test("parseId only accepts positive whole numbers", () => {
  assert.equal(parseId("5"), 5);
  for (const raw of ["abc", "0", "-1", "2.5", ""]) {
    assert.equal(parseId(raw), null, `raw=${raw}`);
  }
});
test("accepts every known category, and no category at all", () => {
  for (const category of ["study", "reading", "work", "journal", undefined]) {
    assert.deepEqual(validateSession({ label: "x", minutes: 25, category }), [], `category=${category}`);
  }
});

test("rejects an unknown category", () => {
  for (const category of ["gaming", "Study", "", null, 1]) {
    const errors = validateSession({ label: "x", minutes: 25, category });
    assert.deepEqual(errors.map((e) => e.field), ["category"], `category=${category}`);
  }
});

test("task_id is optional but must be a positive whole number when sent", () => {
  assert.deepEqual(validateSession({ label: "x", minutes: 25, task_id: null }), []);
  assert.deepEqual(validateSession({ label: "x", minutes: 25, task_id: 7 }), []);
  for (const task_id of [0, -1, "abc", 2.5]) {
    const errors = validateSession({ label: "x", minutes: 25, task_id });
    assert.deepEqual(errors.map((e) => e.field), ["task_id"], `task_id=${task_id}`);
  }
});

test("task titles must be 1-100 characters", () => {
  assert.deepEqual(validateTaskTitle("Read chapter 3"), []);
  assert.deepEqual(validateTaskTitle("a".repeat(100)), []);
  for (const title of ["", "   ", "a".repeat(101), undefined, 5]) {
    assert.equal(validateTaskTitle(title).length, 1, `title=${title}`);
  }
});

test("a task update needs done or title, with the right types", () => {
  assert.deepEqual(validateTaskUpdate({ done: true }), []);
  assert.deepEqual(validateTaskUpdate({ title: "New name" }), []);
  assert.equal(validateTaskUpdate({}).length, 1);
  assert.equal(validateTaskUpdate(undefined).length, 1);
  assert.deepEqual(validateTaskUpdate({ done: "yes" }).map((e) => e.field), ["done"]);
});

test("a task estimate is optional but must be 1-12 pomodoros", () => {
  assert.deepEqual(validateTask({ title: "Read" }), []);
  assert.deepEqual(validateTask({ title: "Read", estimate: 4 }), []);
  for (const estimate of [0, 13, 2.5, "x"]) {
    assert.deepEqual(validateTask({ title: "Read", estimate }).map((e) => e.field), ["estimate"], `estimate=${estimate}`);
  }
});

test("a focus rating must be a whole number from 1 to 5", () => {
  for (const r of [1, 3, 5]) assert.deepEqual(validateRating(r), []);
  for (const r of [0, 6, 2.5, "3", null, undefined]) assert.equal(validateRating(r).length, 1, `rating=${r}`);
});

const { countStreak } = require("../streak");

test("streak counts days in a row ending today", () => {
  assert.equal(countStreak(["2026-11-05", "2026-11-04", "2026-11-03", "2026-11-01"], "2026-11-05"), 3);
});

test("streak still counts from yesterday when nothing is done yet today", () => {
  assert.equal(countStreak(["2026-11-04", "2026-11-03"], "2026-11-05"), 2);
});

test("streak is 0 after a missed day, and works across months", () => {
  assert.equal(countStreak(["2026-11-03"], "2026-11-05"), 0);
  assert.equal(countStreak([], "2026-11-05"), 0);
  assert.equal(countStreak(["2026-11-01", "2026-10-31", "2026-10-30"], "2026-11-01"), 3);
});

test("parseRange turns day, week and month into 1, 7 and 30 days", () => {
  assert.equal(parseRange("day"), 1);
  assert.equal(parseRange("week"), 7);
  assert.equal(parseRange("month"), 30);
});

test("parseRange rejects anything else", () => {
  for (const raw of ["abc", "", undefined, "7", "toString", "WEEK"]) {
    assert.equal(parseRange(raw), null, `raw=${raw}`);
  }
});

test("parseLimit defaults to 20 and accepts 1 to 100", () => {
  assert.equal(parseLimit(undefined), 20);
  assert.equal(parseLimit("1"), 1);
  assert.equal(parseLimit("100"), 100);
});

test("parseLimit rejects anything outside 1 to 100", () => {
  for (const raw of ["0", "101", "-5", "2.5", "abc", ""]) {
    assert.equal(parseLimit(raw), null, `raw=${raw}`);
  }
});

const { longestStreak } = require("../streak");

test("longestStreak finds the longest run of days in a row, wherever it is", () => {
  assert.equal(longestStreak(["2026-11-05", "2026-11-04", "2026-10-20", "2026-10-19", "2026-10-18"]), 3);
  assert.equal(longestStreak(["2026-03-01", "2026-02-28"]), 2); // across a month end
  assert.equal(longestStreak([]), 0);
});

const { validateHabit } = require("../validation");

test("validateHabit accepts a complete habit", () => {
  assert.deepEqual(validateHabit({ name: "Study", category: "study", target_sessions: 2 }), []);
});

test("validateHabit explains each wrong field", () => {
  const errors = validateHabit({ name: "  ", category: "gaming", target_sessions: 0 });
  assert.deepEqual(errors.map((e) => e.field), ["name", "category", "target_sessions"]);
  assert.equal(validateHabit({ name: "x".repeat(61), category: "study", target_sessions: 1 })[0].field, "name");
  assert.equal(validateHabit({ name: "Read", category: "reading", target_sessions: 1.5 })[0].field, "target_sessions");
  assert.equal(validateHabit({ name: "Read", category: "reading", target_sessions: "2" })[0].field, "target_sessions");
});

test("validateHabit for PATCH: any one field is enough, an empty body is not", () => {
  assert.deepEqual(validateHabit({ target_sessions: 3 }, true), []);
  assert.deepEqual(validateHabit({}, true).map((e) => e.field), ["body"]);
  assert.equal(validateHabit({ category: "nap" }, true)[0].field, "category");
});

// ---------- Sessions finished offline ----------
const { parseFinishedAt } = require("../validation");

test("a session sent later can carry its own id and when it finished", () => {
  const now = Date.parse("2026-11-14T05:00:00Z");
  const ok = { label: "Essay", minutes: 25, client_id: "3f2b8c1e-9a4d-4b7e-8c21-0d5e6f7a8b9c", finished_at: "2026-11-14T03:00:00Z" };
  assert.deepEqual(validateSession(ok, now), []);
  assert.match(validateSession({ ...ok, client_id: "not-a-uuid" }, now)[0].message, /UUID/);
});

test("finished_at: up to 30 days ago, never in the future (5 minutes leeway for a fast clock)", () => {
  const now = Date.parse("2026-11-14T05:00:00Z");
  assert.ok(parseFinishedAt("2026-10-16T06:00:00Z", now));
  assert.equal(parseFinishedAt("2026-10-14T05:00:00Z", now), null, "older than 30 days");
  assert.ok(parseFinishedAt("2026-11-14T05:04:00Z", now), "a clock 4 minutes ahead is fine");
  assert.equal(parseFinishedAt("2026-11-14T06:00:00Z", now), null, "an hour in the future");
  assert.equal(parseFinishedAt("yesterday", now), null);
});
