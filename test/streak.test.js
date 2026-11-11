const test = require("node:test");
const assert = require("node:assert/strict");
const { lostStreak, msToBrisbaneMidnight } = require("../streak");

test("a streak lost yesterday is reported the next day", () => {
  // Focused 7, 8, 9 Nov; missed 10 Nov; today is 11 Nov
  assert.deepEqual(lostStreak(["2026-11-09", "2026-11-08", "2026-11-07"], "2026-11-11"), { days: 3, lastDay: "2026-11-09" });
});

test("nothing is lost while yesterday was done (today isn't over yet)", () => {
  assert.equal(lostStreak(["2026-11-10", "2026-11-09"], "2026-11-11"), null);
});

test("an older lost streak isn't news any more, and one day isn't a streak", () => {
  assert.equal(lostStreak(["2026-11-08", "2026-11-07"], "2026-11-11"), null);
  assert.equal(lostStreak(["2026-11-09"], "2026-11-11"), null);
});

test("works across the start of a month", () => {
  assert.deepEqual(lostStreak(["2026-10-30", "2026-10-29"], "2026-11-01"), { days: 2, lastDay: "2026-10-30" });
});

test("time left until midnight in Brisbane", () => {
  // 7 pm in Brisbane is 9 am UTC: 5 hours left
  assert.equal(msToBrisbaneMidnight(Date.parse("2026-11-11T09:00:00Z")), 5 * 3600000);
  // 11:30 pm in Brisbane: 30 minutes left
  assert.equal(msToBrisbaneMidnight(Date.parse("2026-11-11T13:30:00Z")), 30 * 60000);
});
