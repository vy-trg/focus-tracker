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

  // When a room's focus or break is due to end, the server moves it on (to a break, or to idle)
  // and tells everyone. One timer per room, replaced on every change.
  const timers = new Map();
  const schedule = (code) => {
    clearTimeout(timers.get(code));
    timers.delete(code);
    const room = rooms.rooms.get(code);
    if (!room) return;
    // While asking: when the 15 seconds are up, start for whoever said yes
    const due = room.pending ? room.pending.askUntil : room.endAt;
    if (due === null) return;
    const t = setTimeout(() => {
      timers.delete(code);
      const moved = room.pending ? rooms.askTimeout(code, now()) : rooms.advance(code, now());
      if (moved) broadcast(code);
    }, Math.max(0, due - now()) + 50);
    t.unref?.();
    timers.set(code, t);
  };

  // Everyone in the room gets the same state; the timer is worked out from endAt on each screen
  const broadcast = (code) => {
    if (!code) return;
    io.to(code).emit("room:state", rooms.state(code, now()));
    schedule(code);
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
    // The server's time, so every screen's countdown matches even if a computer's clock is off
    socket.emit("room:clock", now());
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

    // Timer controls: anyone in the room can use them.
    // room:start carries the lengths ({ focus, short, long, every, autoBreaks }) when it starts a new focus.
    socket.on("room:start", (options) => {
      if (limited(socket)) return;
      const o = options && typeof options === "object" ? options : {};
      broadcast(rooms.start(user, now(), { preset: o.preset, fast: Boolean(o.fast) && process.env.NODE_ENV !== "production" })?.code);
    });
    for (const [event, act] of [
      ["room:pause", () => rooms.pause(user, now())],
      ["room:reset", () => rooms.reset(user)],
      ["room:skipBreak", () => rooms.skipBreak(user)],
    ]) {
      socket.on(event, () => {
        if (limited(socket)) return;
        broadcast(act()?.code);
      });
    }
    // Yes / no to the question asked before a focus or break starts
    socket.on("room:answer", (yes) => {
      if (limited(socket)) return;
      broadcast(rooms.answer(user.id, Boolean(yes), now())?.code);
    });
    // Yes / no to the room's timer (the switch, while it's running)
    socket.on("room:follow", (on) => {
      if (limited(socket)) return;
      broadcast(rooms.follow(user.id, Boolean(on))?.code);
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
