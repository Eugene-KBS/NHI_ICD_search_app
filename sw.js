/* 醫療碼搜尋 — Service Worker（離線快取）
   外殼檔(html/js/lexicon/manifest/圖示)：網路優先（3 秒逾時改用快取），新版會自動到手機
   資料檔(nhi.json / icd.txt / icd_alias.txt)：先用快取秒開，背景再更新（stale-while-revalidate） */
const CACHE = 'medcode-v2';
const REQUIRED = ['./', './index.html'];
const SHELL = ['./search.js', './learn.js', './lexicon.json', './manifest.json', './icon-192.png', './icon-512.png'];
const DATA = ['./nhi.json', './icd.txt', './icd_alias.txt'];
const DATA_NAMES = ['nhi.json', 'icd.txt', 'icd_alias.txt'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(REQUIRED.map(u => c.add(new Request(u, { cache: 'reload' }))));
    // 其餘檔案缺一個也不能讓安裝失敗
    await Promise.all(SHELL.concat(DATA).map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(e, req) {
  const nav = req.mode === 'navigate';
  const key = nav ? new Request('./index.html') : req;
  const lookup = () => caches.match(key, { ignoreSearch: true });
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => { lookup().then(finish); }, 3000);   // 3 秒沒回應 → 先用快取
    fetch(nav ? req.url : req, { cache: 'no-cache' }).then(r => {
      clearTimeout(timer);
      if (r && r.ok) { const cp = r.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(key, cp)).catch(() => {})); }
      finish(r);
    }).catch(() => {
      clearTimeout(timer);
      lookup().then(c => finish(c || Response.error()));
    });
  });
}

function staleWhileRevalidate(e, req) {
  return caches.open(CACHE).then(c => c.match(req).then(cached => {
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => cached);
    if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
    return net;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const name = url.pathname.split('/').pop();
  if (DATA_NAMES.indexOf(name) >= 0) e.respondWith(staleWhileRevalidate(e, req));
  else e.respondWith(networkFirst(e, req));
});
