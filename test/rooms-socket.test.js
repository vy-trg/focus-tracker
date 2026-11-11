// The live rooms over real sockets, with a stand-in for login (the cookie part is passport's job)
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { io: connect } = require("socket.io-client");
const { attachRooms } = require("../rooms-socket");

async function startServer() {
  const server = http.createServer();
  const users = { vy: { id: 1, username: "vy" }, amber: { id: 2, username: "amber" } };
  const { io } = attachRooms(server, { getUser: (socket) => users[socket.handshake.auth.as] });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const clients = [];
  const as = (name) => {
    const c = connect(url, { auth: { as: name }, transports: ["websocket"], reconnection: false });
    clients.push(c);
    return c;
  };
  const close = () => { clients.forEach((c) => c.close()); io.close(); server.close(); };
  return { as, close };
}
const once = (socket, event) => new Promise((r) => socket.once(event, r));
const ask = (socket, event, data) => new Promise((r) => socket.emit(event, data, r));

test("someone who isn't logged in can't connect", async () => {
  const { as, close } = await startServer();
  const err = await once(as("nobody"), "connect_error");
  assert.match(err.message, /Log in/);
  close();
});

test("create a room, a friend joins with the code, both see both names", async () => {
  const { as, close } = await startServer();
  const vy = as("vy");
  const amber = as("amber");
  await Promise.all([once(vy, "connect"), once(amber, "connect")]);
  const { code } = await ask(vy, "room:create");
  assert.match(code, /^[A-Z0-9]{6}$/);
  const seen = once(vy, "room:state");
  const joined = await ask(amber, "room:join", code.toLowerCase());
  assert.equal(joined.ok, true);
  assert.deepEqual((await seen).members, ["vy", "amber"]);
  close();
});

test("a start from one person reaches everyone, with the same end time", async () => {
  const { as, close } = await startServer();
  const vy = as("vy");
  const amber = as("amber");
  await Promise.all([once(vy, "connect"), once(amber, "connect")]);
  const { code } = await ask(vy, "room:create");
  await ask(amber, "room:join", code);
  const [a, b] = [once(vy, "room:state"), once(amber, "room:state")];
  amber.emit("room:start");
  const [sa, sb] = await Promise.all([a, b]);
  assert.equal(sa.running, true);
  assert.equal(sa.endAt, sb.endAt);
  close();
});

test("a wrong code gets a clear answer and no room", async () => {
  const { as, close } = await startServer();
  const amber = as("amber");
  await once(amber, "connect");
  const r = await ask(amber, "room:join", "ZZZZZZ");
  assert.equal(r.ok, false);
  assert.match(r.error, /No room/);
  close();
});
