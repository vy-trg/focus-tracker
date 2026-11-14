// Focus Tracker offline (v3): keeps the app's files on this device so the page opens and the timer
// runs without a connection. Sessions finished offline wait in the page (localStorage) and are sent
// when the connection comes back (timer.js); this file only answers requests.
//
// - The page itself and /api reads: from the network first; if there's no connection, the last copy.
// - Styles, scripts, fonts: the copy on this device straight away, refreshed in the background.
// Copies are looked up with ignoreVary: the server answers "Vary: Accept…", and the page stored at
// install time was asked for differently from a real page load, so a strict match would miss it.
// - Anything else (saving, logging in, the study room): the network only. Never cached.
const VERSION = "v4";
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

// The timer page is always stored under one key, "/", whatever the address bar had (?fast, #...)
const pageKey = (request) => (request.mode === "navigate" ? "/" : request);

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    // Only real pages for a logged-in person: a redirect to /login means logged out, so forget the copy
    if (res.redirected && new URL(res.url).pathname === "/login") {
      await cache.delete("/");
    } else if (res.ok && res.type === "basic") {
      await cache.put(pageKey(request), res.clone());
    }
    return res;
  } catch {
    const copy = await cache.match(pageKey(request), { ignoreVary: true });
    if (copy) return copy;
    if (request.mode === "navigate") return offlinePage();
    return new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json", "X-Offline": "1" } });
  }
}

// Offline, and this device has no copy of the page yet (it was never opened here while online)
function offlinePage() {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Focus Tracker: offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#16302b;color:#f4efe6;padding:24px;box-sizing:border-box}
main{max-width:28rem}h1{font-size:1.3rem;margin:0 0 8px}p{margin:0 0 12px;color:#c9d3cc}button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:10px 18px;background:#f4efe6;color:#16302b;cursor:pointer}</style>
<main><h1>You're offline</h1><p>Focus Tracker hasn't been saved on this device yet. Open it once while you're online, and next time it works without a connection too.</p>
<button onclick="location.reload()">Try again</button></main></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const copy = await cache.match(request, { ignoreVary: true });
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
