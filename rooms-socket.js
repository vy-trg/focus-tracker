// Study rooms over Socket.IO: the live part of rooms.js.
// Only logged-in people can connect: the socket reads the same login cookie as the pages
// (express-session + passport), and a connection without a user is refused.
const { Server } = require("socket.io");
const { Rooms } = require("./rooms");

// server: the http server; middlewares: the session and passport middlewares used by the pages.
// getUser: how to find who is connecting (tests pass their own instead of logging in).
function attachRooms(server, { middlewares = [], getUser = (socket) => socket.request.user, now = () => Date.now() } = {}) {
  const io = new Server(server, {
    // Same site only: the page and the socket are served by this app
    cors: { origin: false },
    // Small messages only (a code, a number of minutes)
    maxHttpBufferSize: 1e4,
  });
  for (const mw of middlewares) io.engine.use(mw);

  const rooms = new Rooms();

  io.use((socket, next) => {
    const user = getUser(socket);
    if (!user) return next(new Error("Log in to use study rooms"));
    socket.data.user = { id: user.id, username: user.username };
    next();
  });

  // Everyone in the room gets the same state; the timer is worked out from endAt on each screen
  const broadcast = (code) => {
    if (code) io.to(code).emit("room:state", rooms.state(code, now()));
  };

  // A few messages a second at most per person, so one tab can't flood the room
  const limited = (socket) => {
    const t = now();
    socket.data.sent = (socket.data.sent ?? []).filter((x) => t - x < 1000);
    socket.data.sent.push(t);
    return socket.data.sent.length > 5;
  };

  io.on("connection", (socket) => {
    const user = socket.data.user;
    // Back after a dropped connection (or a second tab): rejoin the room you were in
    const current = rooms.roomOf(user.id);
    if (current) {
      socket.join(current.code);
      socket.emit("room:state", rooms.state(current.code, now()));
    }

    const leaveSocketRooms = () => {
      for (const r of socket.rooms) if (r !== socket.id) socket.leave(r);
    };

    socket.on("room:create", (_, reply) => {
      if (limited(socket)) return;
      const left = rooms.roomOf(user.id)?.code;
      const code = rooms.create(user);
      leaveSocketRooms();
      socket.join(code);
      broadcast(left);
      broadcast(code);
      if (typeof reply === "function") reply({ ok: true, code });
    });

    socket.on("room:join", (typed, reply) => {
      if (limited(socket)) return;
      const left = rooms.roomOf(user.id)?.code;
      const result = rooms.join(user, typed);
      if (result.ok) {
        leaveSocketRooms();
        socket.join(result.code);
        if (left !== result.code) broadcast(left);
        broadcast(result.code);
      }
      if (typeof reply === "function") reply(result);
    });

    socket.on("room:leave", (_, reply) => {
      const code = rooms.leave(user.id);
      leaveSocketRooms();
      broadcast(code);
      if (typeof reply === "function") reply({ ok: true });
    });

    // Timer controls: anyone in the room can use them
    for (const [event, act] of [
      ["room:start", () => rooms.start(user.id, now())],
      ["room:pause", () => rooms.pause(user.id, now())],
      ["room:reset", () => rooms.reset(user.id)],
    ]) {
      socket.on(event, () => {
        if (limited(socket)) return;
        broadcast(act()?.code);
      });
    }
    socket.on("room:minutes", (minutes) => {
      if (limited(socket)) return;
      broadcast(rooms.setMinutes(user.id, minutes)?.code);
    });

    // Closing the tab doesn't leave the room straight away: a dropped connection often comes back.
    // Only when none of this person's tabs are connected after 30 seconds do they leave.
    socket.on("disconnect", () => {
      setTimeout(() => {
        const stillHere = [...io.sockets.sockets.values()].some((s) => s.data.user?.id === user.id);
        if (!stillHere) broadcast(rooms.leave(user.id));
      }, 30000).unref();
    });
  });

  return { io, rooms };
}

module.exports = { attachRooms };
