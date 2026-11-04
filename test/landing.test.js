const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// The app needs a session secret; CI has no .env, so set a dummy one for tests.
process.env.SESSION_SECRET ||= "test-only-secret";
const app = require("../app");

let server;
let baseUrl;

before(async () => {
  // Port 0 = let the operating system pick any free port
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
});

test("a logged-out visitor sees the landing page instead of being sent to /login", async () => {
  const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Get started/);
});

test("the landing page links to sign up and log in", async () => {
  const html = await (await fetch(`${baseUrl}/`, { redirect: "manual" })).text();
  assert.match(html, /href="\/signup"/);
  assert.match(html, /href="\/login"/);
});