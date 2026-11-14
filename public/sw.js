// Focus Tracker offline (v3): keeps the app's files on this device so the page opens and the timer
// runs without a connection. Sessions finished offline wait in the page (localStorage) and are sent
// when the connection comes back (timer.js); this file only answers requests.
//
// - The page itself and /api reads: from the network first; if there's no connection, the last copy.
// - Styles, scripts, fonts: the copy on this device straight away, refreshed in the background.
// - Anything else (saving, logging in, the study room): the network only. Never cached.
const VERSION = "v2";
const CACHE = `focus-tracker-${VERSION}`;
const SHELL = ["/", "/style.css", "/timer.js", "/socket.io/socket.io.min.js"];

self.addEventListener("install", (event) => {
  // addAll fails if one file fails; one at a time, so a missing file doesn't stop the rest
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Old versions' caches go
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Logging out: the page asks for everything stored to go, so the next person on this device sees nothing
self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(caches.delete(CACHE));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    // Only real pages for a logged-in person: a redirect to /login means logged out, so forget the copy
    if (res.redirected && new URL(res.url).pathname === "/login") {
      await cache.delete("/");
    } else if (res.ok && res.type === "basic") {
      await cache.put(request, res.clone());
    }
    return res;
  } catch {
    const copy = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (copy) return copy;
    if (request.mode === "navigate") {
      const home = await cache.match("/");
      if (home) return home;
    }
    return new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json", "X-Offline": "1" } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const copy = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return copy || (await fresh) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io/") && url.pathname !== "/socket.io/socket.io.min.js") return;
  if (url.pathname.startsWith("/audio/")) return; // music is large: streamed, not stored
  if (req.mode === "navigate") {
    // Only the timer page works offline; login and sign-up need the server anyway
    if (url.pathname === "/") event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (/\.(css|js|woff2?)$/.test(url.pathname)) event.respondWith(cacheFirst(req));
});
