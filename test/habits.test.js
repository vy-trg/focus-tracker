const test = require("node:test");
const assert = require("node:assert/strict");
const { brisbaneDay, habitStreak, habitProgress, groupCounts } = require("../habits");

const habit = {
  id: 1,
  name: "Study twice",
  category: "study",
  target_sessions: 2,
  created_at: "2026-11-01T00:00:00Z", // 10 am, 1 Nov in Brisbane
};

// ---------- Days in Brisbane time ----------

test("across midnight: 11:50 pm and 12:05 am Brisbane time are different days", () => {
  // Brisbane is UTC+10 all year (no daylight saving)
  assert.equal(brisbaneDay("2026-11-10T13:50:00Z"), "2026-11-10");
  assert.equal(brisbaneDay("2026-11-10T14:05:00Z"), "2026-11-11");
});

test("a session at 8 am Brisbane time is still today, even though it is yesterday in UTC", () => {
  assert.equal(brisbaneDay("2026-11-09T22:00:00Z"), "2026-11-10");
});

// ---------- Streak ----------

test("first day: target hit today gives a streak of 1", () => {
  assert.equal(habitStreak({ "2026-11-10": 2 }, 2, "2026-11-10", "2026-11-10"), 1);
});

test("first day: nothing yet today gives 0", () => {
  assert.equal(habitStreak({}, 2, "2026-11-10", "2026-11-10"), 0);
});

test("counts every day in a row that hit the target", () => {
  const counts = { "2026-11-08": 2, "2026-11-09": 3, "2026-11-10": 2 };
  assert.equal(habitStreak(counts, 2, "2026-11-10", "2026-11-01"), 3);
});

test("today not done yet does not break the streak", () => {
  const counts = { "2026-11-08": 2, "2026-11-09": 2, "2026-11-10": 1 };
  assert.equal(habitStreak(counts, 2, "2026-11-10", "2026-11-01"), 2);
});

test("a missed day breaks the streak", () => {
  const counts = { "2026-11-07": 2, "2026-11-08": 0, "2026-11-09": 2, "2026-11-10": 2 };
  assert.equal(habitStreak(counts, 2, "2026-11-10", "2026-11-01"), 2);
});

test("a day with sessions but under the target also breaks it", () => {
  const counts = { "2026-11-08": 2, "2026-11-09": 1, "2026-11-10": 2 };
  assert.equal(habitStreak(counts, 2, "2026-11-10", "2026-11-01"), 1);
});

test("days before the habit was created don't count", () => {
  const counts = { "2026-11-08": 2, "2026-11-09": 2, "2026-11-10": 2 };
  assert.equal(habitStreak(counts, 2, "2026-11-10", "2026-11-09"), 2);
});

test("works across the end of a month", () => {
  const counts = { "2026-10-31": 1, "2026-11-01": 1 };
  assert.equal(habitStreak(counts, 1, "2026-11-01", "2026-10-01"), 2);
});

// ---------- Progress for the page ----------

test("habitProgress: today, last 7 days and streak", () => {
  const counts = groupCounts([
    { category: "study", day: "2026-11-09", count: "2" },
    { category: "study", day: "2026-11-10", count: "1" },
    { category: "reading", day: "2026-11-10", count: "5" },
  ]);
  const p = habitProgress(habit, counts, "2026-11-10");

  assert.deepEqual(p.today, { sessions: 1, target: 2, done: false });
  assert.equal(p.streak, 1);
  assert.equal(p.last7.length, 7);
  assert.equal(p.last7[0].day, "2026-11-04");
  assert.deepEqual(p.last7[6], { day: "2026-11-10", sessions: 1, done: false, before: false });
  assert.equal(p.last7[5].done, true);
  assert.equal(p.name, "Study twice");
});

test("habitProgress: reading sessions don't count for a study habit", () => {
  const counts = groupCounts([{ category: "reading", day: "2026-11-10", count: "4" }]);
  assert.equal(habitProgress(habit, counts, "2026-11-10").today.sessions, 0);
});

test("habitProgress: days before the habit existed are marked", () => {
  const p = habitProgress({ ...habit, created_at: "2026-11-08T00:00:00Z" }, {}, "2026-11-10");
  assert.deepEqual(
    p.last7.map((d) => d.before),
    [true, true, true, true, false, false, false]
  );
});
