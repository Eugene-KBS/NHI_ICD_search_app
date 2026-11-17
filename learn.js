/* learn.js — MedLearn: usage + association learning and miss log (SPEC 4, 8.4).
   UMD, pure: storage ({getItem,setItem}) and clock are injected. Every storage error is swallowed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MedLearn = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEY = 'medcode.learn.v1', DAY = 86400000, HALF_LIFE_DAYS = 180;
  const MAX_USE = 3000, MAX_PAIR = 6000, MAX_MISS = 200, DEDUP_MS = 12 * 3600 * 1000;

  function create(storage, nowFn) {
    const now = typeof nowFn === 'function' ? nowFn : Date.now;
    let d = load();

    function fresh() { return { v: 1, use: { nhi: {}, icd: {} }, pair: {}, cases: 0, miss: [], sig: {} }; }
    function load() {
      try {
        const raw = storage && storage.getItem(KEY);
        if (!raw) return fresh();
        const o = JSON.parse(raw);
        if (!o || o.v !== 1) return fresh();
        return norm(o);
      } catch (e) { return fresh(); }
    }
    function norm(o) {
      const f = fresh();
      f.use.nhi = o.use && o.use.nhi && typeof o.use.nhi === 'object' ? o.use.nhi : {};
      f.use.icd = o.use && o.use.icd && typeof o.use.icd === 'object' ? o.use.icd : {};
      f.pair = o.pair && typeof o.pair === 'object' ? o.pair : {};
      f.cases = Number(o.cases) || 0;
      f.miss = Array.isArray(o.miss) ? o.miss.filter(m => m && typeof m.q === 'string') : [];
      f.sig = o.sig && typeof o.sig === 'object' ? o.sig : {};
      return f;
    }
    function save() {
      try { if (storage) storage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* learning disabled */ }
    }
    const decayed = (rec, t) => rec[0] * Math.pow(0.5, Math.max(0, t - rec[1]) / DAY / HALF_LIFE_DAYS);
    const kindOf = code => (/^\d{5}[A-Za-z]$/.test(code) ? 'n' : 'i');
    const tag = (kind, code) => (kind === 'nhi' || kind === 'n' ? 'n:' : 'i:') + code;

    function prune() {
      const t = now();
      const all = [];
      for (const k of ['nhi', 'icd']) for (const c of Object.keys(d.use[k])) all.push([k, c, decayed(d.use[k][c], t)]);
      if (all.length > MAX_USE) { all.sort((a, b) => a[2] - b[2]); for (let i = 0; i < all.length - MAX_USE; i++) delete d.use[all[i][0]][all[i][1]]; }
      const pk = Object.keys(d.pair);
      if (pk.length > MAX_PAIR) {
        const arr = pk.map(k => [k, decayed(d.pair[k], t)]).sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < arr.length - MAX_PAIR; i++) delete d.pair[arr[i][0]];
      }
      if (d.miss.length > MAX_MISS) { d.miss.sort((a, b) => a.last - b.last); d.miss = d.miss.slice(d.miss.length - MAX_MISS); }
      for (const s of Object.keys(d.sig)) if (t - d.sig[s] > DEDUP_MS) delete d.sig[s];
    }

    function recordUse(kind, code) {
      if (!code || (kind !== 'nhi' && kind !== 'icd')) return;
      const u = d.use[kind], t = now(), r = u[code];
      u[code] = r ? [r[0] + 1, t] : [1, t];
      prune(); save();
    }
    function usageBoost(kind, code) {
      const r = d.use[kind] && d.use[kind][code]; if (!r) return 0;
      const t = now();
      let b = 120 * Math.log2(1 + decayed(r, t));
      if (t - r[1] <= 7 * DAY) b += 100;
      return Math.min(400, b);
    }
    function recent(kind, n) {
      const u = d.use[kind] || {};
      return Object.keys(u).sort((a, b) => u[b][1] - u[a][1] || (a < b ? -1 : 1)).slice(0, n);
    }
    function frequent(kind, n) {
      const u = d.use[kind] || {}, t = now();
      return Object.keys(u).map(c => [c, decayed(u[c], t)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(x => x[0]);
    }
    function commitCase(dxCodes, opCodes) {
      const tags = [];
      for (const c of dxCodes || []) tags.push(tag('icd', c));
      for (const c of opCodes || []) tags.push(tag('nhi', c));
      const uniq = Array.from(new Set(tags)).sort();
      if (uniq.length < 2) return false;
      const t = now(), sig = uniq.join(',');
      if (d.sig[sig] && t - d.sig[sig] < DEDUP_MS) return false;
      d.sig[sig] = t;
      for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
        const k = uniq[i] + '|' + uniq[j], r = d.pair[k];
        d.pair[k] = r ? [r[0] + 1, t] : [1, t];
      }
      d.cases++;
      prune(); save();
      return true;
    }
    function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
    function assocBoost(code, trayCodes) {
      if (!trayCodes || !trayCodes.length) return 0;
      const t = now(), me = tag(kindOf(code), code); let sum = 0;
      for (const tc of trayCodes) {
        if (tc === code) continue;
        const r = d.pair[pairKey(me, tag(kindOf(tc), tc))];
        if (r) sum += decayed(r, t);
      }
      return sum ? Math.min(300, 100 * Math.log2(1 + sum)) : 0;
    }
    function suggest(kind, trayCodes, n) {
      if (!trayCodes || !trayCodes.length) return [];
      const t = now(), want = kind === 'nhi' ? 'n:' : 'i:';
      const tray = new Set(trayCodes.map(c => tag(kindOf(c), c)));
      const acc = new Map();
      for (const k of Object.keys(d.pair)) {
        const bar = k.indexOf('|'), a = k.slice(0, bar), b = k.slice(bar + 1);
        const inA = tray.has(a), inB = tray.has(b);
        if (inA === inB) continue; // need exactly one side in the tray
        const other = inA ? b : a;
        if (other.slice(0, 2) !== want) continue;
        acc.set(other, (acc.get(other) || 0) + decayed(d.pair[k], t));
      }
      return Array.from(acc, ([c, v]) => ({ code: c.slice(2), n: Math.round(v * 100) / 100 })).sort((x, y) => y.n - x.n || (x.code < y.code ? -1 : 1)).slice(0, n);
    }
    function recordMiss(kind, query) {
      const q = String(query == null ? '' : query).trim().toLowerCase().replace(/\s+/g, ' ');
      if (q.length < 3) return;
      const t = now(), m = d.miss.find(x => x.q === q && x.kind === kind);
      if (m) { m.n++; m.last = t; } else d.miss.push({ q, kind, n: 1, last: t });
      prune(); save();
    }
    function misses() { return d.miss.slice().sort((a, b) => b.last - a.last).map(m => ({ q: m.q, kind: m.kind, n: m.n, last: m.last })); }
    function clearMisses() { d.miss = []; save(); }
    function exportData() { return JSON.stringify(d); }
    function importData(str, opts) {
      let o;
      try { o = JSON.parse(str); } catch (e) { return false; }
      if (!o || o.v !== 1 || typeof o !== 'object') return false;
      o = norm(o);
      if (!(opts && opts.merge)) { d = o; prune(); save(); return true; }
      for (const k of ['nhi', 'icd']) for (const c of Object.keys(o.use[k])) {
        const a = d.use[k][c], b = o.use[k][c];
        d.use[k][c] = a ? [a[0] + b[0], Math.max(a[1], b[1])] : b;
      }
      for (const k of Object.keys(o.pair)) { const a = d.pair[k], b = o.pair[k]; d.pair[k] = a ? [a[0] + b[0], Math.max(a[1], b[1])] : b; }
      for (const m of o.miss) { const x = d.miss.find(y => y.q === m.q && y.kind === m.kind); if (x) { x.n += m.n; x.last = Math.max(x.last, m.last); } else d.miss.push(m); }
      d.cases += o.cases;
      for (const s of Object.keys(o.sig)) d.sig[s] = Math.max(d.sig[s] || 0, o.sig[s]);
      prune(); save();
      return true;
    }
    function stats() {
      return { uses: Object.keys(d.use.nhi).length + Object.keys(d.use.icd).length, cases: d.cases, pairs: Object.keys(d.pair).length };
    }
    function reset() { d = fresh(); try { if (storage && storage.removeItem) storage.removeItem(KEY); else if (storage) storage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }
    return { recordUse, usageBoost, recent, frequent, commitCase, assocBoost, suggest, recordMiss, misses, clearMisses, exportData, importData, stats, reset };
  }
  return { create };
});
