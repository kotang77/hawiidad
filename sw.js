/* 하와이백억아빠 투자가이드 — Service Worker
 * Strategy:
 *  - Precache: app shell (index.html, manifest, icons) → instant cold-start + offline
 *  - Same-origin static: cache-first
 *  - CDN scripts (React, Babel, Recharts): stale-while-revalidate
 *  - Stock/news/Claude APIs: network-only (never cache — prices change every second)
 *  - Navigation fallback: if offline → serve cached index.html
 */

const CACHE_VERSION = "v27.2026-05-02-company-eval";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const CDN_CACHE = `cdn-${CACHE_VERSION}`;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png?v=8",
  "./icon-512.png?v=8",
  "./icon-512-maskable.png?v=8",
  "./intro-logo.png?v=8"
];

const LIVE_API_HOSTS = [
  "api.anthropic.com",
  "finnhub.io",
  "financialmodelingprep.com",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "stooq.com"
];

const CDN_HOSTS = [
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      return Promise.all(
        SHELL_FILES.map(url =>
          cache.add(url).catch(err => console.warn("[SW] precache skip", url, err.message))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== CDN_CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (LIVE_API_HOSTS.some(h => url.hostname.endsWith(h))) return;

  // Navigation: network-first (no-store), cached fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(SHELL_CACHE).then(c => c.put("./index.html", clone)).catch(()=>{});
          }
          return resp;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // index.html / "/" 직접 요청도 network-first
  if (url.origin === self.location.origin &&
      (url.pathname.endsWith("/index.html") || url.pathname.endsWith("/"))) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, clone)).catch(()=>{});
          }
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  // CDN: stale-while-revalidate
  if (CDN_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const fetchPromise = fetch(req).then(resp => {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Same-origin static: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            const clone = resp.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, clone));
          }
          return resp;
        });
      })
    );
    return;
  }
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
