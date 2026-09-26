// Offline support: the app shell and bundled fonts are cached on first
// visit. Navigations go to the network first so updates arrive promptly;
// hashed build assets and fonts are served from the cache first.
const CACHE = "storeshots-v1";
// Template fonts, so new projects can be started offline.
const PRECACHE = [
  "/",
  "/icon.svg",
  "/manifest.webmanifest",
  "/fonts/BricolageGrotesque-Bold.ttf",
  "/fonts/BricolageGrotesque-ExtraBold.ttf",
  "/fonts/DMSerifDisplay-Regular.ttf",
  "/fonts/InstrumentSans-Regular.ttf",
  "/fonts/InstrumentSans-SemiBold.ttf",
  "/fonts/Poppins-Bold.ttf",
  "/fonts/Poppins-Regular.ttf",
  "/fonts/Poppins-SemiBold.ttf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
