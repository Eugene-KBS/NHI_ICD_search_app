'use strict';
// UI smoke test: real Chrome via Playwright against a local static server. Exit 0 = all checks passed.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const SHOTS = '/home/claude/work/shots/';
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };

let fails = 0;
function check(name, ok, extra) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + extra)); if (!ok) fails++; }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { window.__clip = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__clip = t; return Promise.resolve(); } }, configurable: true }); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  const shot = async n => { await page.waitForTimeout(450); await page.screenshot({ path: SHOTS + n }); };
  const type = async (q) => { await page.fill('#q', q); await page.waitForTimeout(250); };
  const cards = () => page.$$eval('#results .card', els => els.map(e => e.dataset.code));
  const text = sel => page.$eval(sel, e => e.innerText);

  await page.goto(base + '?embed=1');
  await page.waitForFunction(() => document.body.dataset.icd === 'ready', null, { timeout: 60000 });
  check('ICD index becomes ready', true);
  check('NHI placeholder', (await page.getAttribute('#q', 'placeholder')).includes('STSG'));
  const fs16 = await page.$eval('#q', e => parseFloat(getComputedStyle(e).fontSize));
  check('input font >= 16px', fs16 >= 16, fs16);
  check('footer data date present', /健保碼資料日期 \d{4}-\d{2}-\d{2}/.test(await text('#results')));

  // 1. NHI search
  await type('stsg');
  let c = await cards();
  check('stsg returns rows', c.length > 0, c.length);
  const stsgCode = c[0];
  await page.click('#results .card >> nth=0');
  check('first row selected', await page.$eval('#results .card', e => e.classList.contains('sel')));
  check('bottom bar shows 診斷 0・手術 1', (await text('#goPatient')).replace(/\s/g, '').includes('本次病人診斷0・手術1›'), await text('#goPatient'));
  await shot('01_nhi_search.png');

  // 2. note expand
  await type('水刀');
  c = await cards();
  check('水刀 -> 62072B among first rows', c.slice(0, 5).includes('62072B'), c.slice(0, 5));
  const noteCard = '#results .card[data-code="62072B"]';
  const before = await page.$eval(noteCard, e => e.classList.contains('sel'));
  await page.click(noteCard + ' .notebtn');
  check('note expands', await page.$eval(noteCard, e => e.classList.contains('open')));
  check('note text verbatim + label', (await text(noteCard + ' .note')).includes('健保署支付規範（官方原文）') && (await text(noteCard + ' .note')).includes('同一醫院同一病患同一傷害'));
  check('note click does not select', (await page.$eval(noteCard, e => e.classList.contains('sel'))) === before);
  check('section tag shown', (await text(noteCard)).includes('手術·皮膚'));
  await shot('02_nhi_note_expanded.png');
  await page.click(noteCard + ' .notebtn');
  check('note collapses', !(await page.$eval(noteCard, e => e.classList.contains('open'))));

  // 3. ICD compound
  await page.click('#tabIcd');
  check('ICD placeholder', (await page.getAttribute('#q', 'placeholder')).includes('keloid'));
  check('ICD empty hint or sections', (await text('#results')).length > 0);
  await type('right hand crushing injury with tendon rupture');
  const nParts = await page.$$eval('#results .part-h', e => e.length);
  check('compound: two numbered sections', nParts === 2, nParts);
  check('compound status line', (await text('#status')).includes('已拆成 2 個診斷分別搜尋'), await text('#status'));
  const headings = await page.$$eval('#results .part-h', e => e.map(x => x.innerText));
  check('headings numbered ① ②', headings[0].startsWith('①') && headings[1].startsWith('②'), headings);
  const per = await page.$$eval('#results .part-h', hs => hs.map(h => { let n = 0, s = h.nextElementSibling; while (s && !s.classList.contains('part-h')) { if (s.classList.contains('card')) n++; s = s.nextElementSibling; } return n; }));
  check('each section <= 8 rows', per.every(n => n >= 1 && n <= 8), per);
  check('顯示更多 present for long section', (await page.$$('#results .morebtn')).length >= 1);
  const picks = await page.$$eval('#results .part-h', hs => hs.map(h => { let s = h.nextElementSibling; while (s && !s.classList.contains('card')) s = s.nextElementSibling; return s.dataset.code; }));
  await page.click('#results .card >> nth=0'); // first card is first row of part 1
  check('ICD tap copies code + toast', (await page.evaluate(() => window.__clip)) === picks[0] && (await text('#toast')).includes('已複製 ' + picks[0] + '・已加入病人清單'), await text('#toast'));
  await page.click('#results .part-h:nth-of-type(2) ~ .card >> nth=0').catch(async () => {
    await page.evaluate(code => document.querySelectorAll('#results .card').forEach(e => { if (e.dataset.code === code) e.click(); }), picks[1]);
  });
  const dxSel = await page.$$eval('#results .card.sel', e => e.map(x => x.dataset.code));
  check('two ICD rows selected', dxSel.length === 2, dxSel);
  const bar = (await text('#goPatient')).replace(/\s/g, '');
  check('bottom bar 診斷 2・手術 1', bar.includes('診斷2・手術1'), bar);
  await shot('03_icd_compound.png');

  // 4. patient view
  await page.click('#goPatient');
  const pv = await text('#patientList');
  check('patient view lists 診斷 and 手術／處置', pv.includes('診斷') && pv.includes('手術／處置') && pv.includes('主診斷'));
  check('patient view has both ICD codes and NHI code', pv.includes(picks[0]) && pv.includes(picks[1]) && pv.includes(stsgCode));
  check('total line', /合計 [\d,]+ 點/.test(pv) && pv.includes('未套用多項手術折扣'));
  check('small links present', pv.includes('直接清空（不記錄）') && pv.includes('匯出使用紀錄') && pv.includes('匯入使用紀錄'));
  const ptsTotal = await page.$eval('#patientList .total', e => e.innerText);
  const nhiPts = Number((await page.$eval('#patientList .crow[data-kind=nhi] .pts', e => e.innerText)).replace(/[^\d]/g, ''));
  check('total equals the single op points', ptsTotal.replace(/,/g, '').includes('合計 ' + nhiPts + ' 點'), ptsTotal + ' vs ' + nhiPts);
  await shot('04_patient_view.png');
  // move-up
  await page.click('#patientList .crow[data-kind=icd] >> nth=1 >> .up');
  const dxOrder = await page.$$eval('#patientList .crow[data-kind=icd]', e => e.map(x => x.dataset.code));
  check('↑ moves second dx to first', dxOrder[0] === picks[1], dxOrder);
  await page.click('#patientList .crow[data-kind=icd] >> nth=1 >> .up');   // restore order
  await page.click('#copyAll');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => window.__clip);
  const lines = clip.split('\n');
  check('copy format: headers + numbering', lines[0] === '【診斷】' && /^1\. \S+ \S/.test(lines[1]) && /^2\. /.test(lines[2]) && lines[3] === '【手術／處置】' && /^1\. \S+ .*（[\d,]+ 點）$/.test(lines[4]), JSON.stringify(lines));
  check('copy toast', (await text('#toast')).includes('已複製・已學習這組搭配'));
  await page.click('#finish');
  check('after 完成並清空 bar hidden', await page.$eval('#goPatient', e => e.classList.contains('hide')));
  check('search view back', await page.$eval('#searchView', e => !e.classList.contains('hidden')));

  // 5. learned suggestion
  await page.click('#tabNhi');
  await type('stsg');
  await page.evaluate(code => document.querySelectorAll('#results .card').forEach(e => { if (e.dataset.code === code) e.click(); }), stsgCode);
  await page.click('#goPatient');
  const sug = await page.$$eval('#patientList .chip', e => e.map(x => x.dataset.code));
  check('常一起用 shows the earlier ICD codes', sug.includes(picks[0]) && sug.includes(picks[1]) && (await text('#patientList')).includes('常一起用'), sug);
  await shot('05_learned_suggestion.png');
  await page.click('#patientList .chip >> nth=0');
  check('chip tap adds to list', (await page.$$('#patientList .crow')).length === 2);
  await page.click('#toSearch');
  await page.click('#tabIcd');
  await type('');
  const icdEmpty = await text('#results');
  check('ICD empty screen: 常與已選項目一起用 + 最近使用', icdEmpty.includes('常與已選項目一起用') && icdEmpty.includes('最近使用'), icdEmpty.slice(0, 80));
  // clear tray without learning
  await page.click('#goPatient');
  await page.click('[data-act=clearraw]');
  check('直接清空 empties list', await page.$eval('#goPatient', e => e.classList.contains('hide')));

  // 6. empty screen recent (NHI)
  await page.click('#tabNhi');
  await type('');
  const nhiEmpty = await text('#results');
  check('NHI empty screen shows 最近使用', nhiEmpty.includes('最近使用'), nhiEmpty.slice(0, 60));
  await shot('06_empty_recent.png');

  // 7. typo
  await page.click('#tabIcd');
  await type('phalnx fracture');
  const st = await text('#status');
  check('typo shows 已修正 note', st.includes('已修正'), st);
  check('typo returns rows', (await cards()).length > 0);
  // html escaping: query with markup does not inject
  await type('<img src=x onerror=window.__x=1>');
  check('markup query is inert', (await page.evaluate(() => window.__x)) === undefined && (await page.$$('#results img')).length === 0);
  // no horizontal scroll
  await type('fracture');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check('no horizontal scroll at 390px', sw);
  // tap targets
  await page.click('#tabNhi'); await type('水刀');
  const sizes = await page.$$eval('#results .notebtn, .tab, #clr', els => els.filter(e => e.offsetParent).map(e => e.getBoundingClientRect().height));
  check('tap targets >= 40px', sizes.every(h => h >= 39.5), sizes);
  // paging
  await type('fracture'); await page.click('#tabIcd'); await type('fracture');
  const n1 = (await cards()).length;
  check('first page = 60 rows', n1 === 60, n1);
  await page.click('#results .morebtn');
  check('顯示更多 appends 60', (await cards()).length === 120);

  // iPad
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.click('#tabNhi'); await type('stsg');
  await shot('07_ipad.png');
  check('no horizontal scroll on iPad', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.setViewportSize({ width: 390, height: 844 });

  check('no console errors (embed page)', errors.length === 0, errors.join(' | '));

  // service worker: install, precache, offline reload
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const p2 = await ctx2.newPage();
  const err2 = []; p2.on('pageerror', e => err2.push(e.message));
  await p2.goto(base);
  await p2.waitForFunction(() => document.body.dataset.icd === 'ready', null, { timeout: 60000 });
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.waitForFunction(() => navigator.serviceWorker.controller || true);
  const cached = await p2.evaluate(async () => { const c = await caches.open('medcode-v2'); return (await c.keys()).map(r => new URL(r.url).pathname); });
  const need = ['/search.js', '/learn.js', '/lexicon.json', '/nhi.json', '/icd.txt', '/icd_alias.txt', '/index.html'];
  check('sw precache complete', need.every(n => cached.includes(n)), cached);
  await p2.reload(); await p2.waitForTimeout(500);            // now controlled by the sw
  await ctx2.setOffline(true);
  await p2.reload();
  await p2.waitForFunction(() => document.body.dataset.icd === 'ready', null, { timeout: 60000 });
  await p2.fill('#q', '水刀');
  await p2.waitForFunction(() => [...document.querySelectorAll('#results .card')].some(e => e.dataset.code === '62072B'), null, { timeout: 8000 }).catch(() => {});
  const offc = await p2.$$eval('#results .card', e => e.map(x => x.dataset.code));
  check('offline reload works from cache', offc.includes('62072B'), offc.slice(0, 5) + ' status=' + await p2.$eval('#status', e => e.innerText));
  check('no page errors in sw run', err2.length === 0, err2.join('|'));
  await ctx2.close();

  await browser.close(); server.close();
  console.log(fails ? '\nUI SMOKE FAILED: ' + fails + ' check(s)' : '\nUI SMOKE OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
