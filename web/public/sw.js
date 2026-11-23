// 简单的离线缓存：
//   data/*.json —— 网络优先（拿最新数据），断网时用缓存
//   其它同源资源 —— 缓存优先，后台更新（构建产物带 hash，不会拿到旧代码）
const CACHE = 'cad-learn-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/') || req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(stripQuery(req), resp.clone());
    return resp;
  } catch (e) {
    const cached = (await cache.match(stripQuery(req))) ?? (req.mode === 'navigate' ? await cache.match('./') : undefined);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const update = fetch(req).then((resp) => {
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update;
}

// 分享链接会带 ?title=&text=&url=，缓存时去掉查询参数
function stripQuery(req) {
  const u = new URL(req.url);
  if (req.mode === 'navigate') return new Request(u.origin + u.pathname);
  return req;
}
