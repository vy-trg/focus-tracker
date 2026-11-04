const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSession, parseId } = require("../validation");

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