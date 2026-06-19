/* 醫療碼搜尋 — Service Worker（離線快取）
   外殼檔(html/manifest/圖示)：快取優先
   資料檔(.txt)：先用快取秒開，背景再更新（stale-while-revalidate） */
const CACHE = 'medcode-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.pathname.endsWith('.txt')) {
    // 資料檔：快取先回（秒開、可離線），同時背景抓最新存回快取
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(req).then(cached => {
          const net = fetch(req).then(r => { c.put(req, r.clone()); return r; }).catch(() => cached);
          return cached || net;
        })
      )
    );
  } else {
    // 外殼檔：快取優先，沒有再上網並順手快取
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(rr => {
        const cp = rr.clone();
        caches.open(CACHE).then(c => c.put(req, cp));
        return rr;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
