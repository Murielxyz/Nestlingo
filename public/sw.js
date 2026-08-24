// 语巢 Service Worker —— 离线缓存（阶段 4 会扩充成完整离线能力）
const CACHE = "language-nest-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，断网时回退缓存
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((m) => m || caches.match("/notes"))
        )
    );
    return;
  }

  // 静态资源：后台自动更新（stale-while-revalidate）——
  // 有缓存先返回（秒开），同时后台拉新覆盖缓存，下次访问即拿新资源，部署后无需手动清缓存。
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/icon.")
  ) {
    event.respondWith(
      caches.match(request).then((m) => {
        const revalidate = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => m);
        return m || revalidate;
      })
    );
  }
});
