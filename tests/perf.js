'use strict';
// Perf: ICD build time and per-keystroke latency (every bench query typed char by char). Exit 1 over budget.
const fs = require('fs'), path = require('path');
const { loadEngine } = require('./common.js');
const { eng, info } = loadEngine();
const bench = JSON.parse(fs.readFileSync(path.join(__dirname, 'bench_core.json'), 'utf8'));
const B = { build: 1500, icdP95: 30, nhiP95: 5 };
const pct = (a, p) => { a = a.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
const lat = { icd: [], nhi: [] };
for (const b of bench) for (let i = 1; i <= b.q.length; i++) {
  const q = b.q.slice(0, i), t0 = process.hrtime.bigint();
  eng.search(b.kind, q, { limit: 50 });
  lat[b.kind].push(Number(process.hrtime.bigint() - t0) / 1e6);
}
let bad = false;
const line = (n, v, lim) => { const ok = v <= lim; if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'OVER'} ${n.padEnd(16)} ${v.toFixed(1)} ms (budget ${lim})`); };
line('icd build', info.icdBuildMs, B.build);
for (const k of ['icd', 'nhi']) { console.log(`${k}: n=${lat[k].length} p50=${pct(lat[k], .5).toFixed(2)} p99=${pct(lat[k], .99).toFixed(1)} max=${Math.max(...lat[k]).toFixed(1)}`); line(k + ' p95', pct(lat[k], .95), B[k + 'P95']); }
process.exitCode = bad ? 1 : 0;
