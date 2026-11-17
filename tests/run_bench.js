'use strict';
// Acceptance bench: legacy (v1) engine vs v2 on tests/bench_core.json. Exit 1 if v2 < 95 %.
// usage: node tests/run_bench.js [-q]   (-q: only the summary and the failing queries)
const fs = require('fs'), path = require('path');
const { root, loadEngine } = require('./common.js');
const { makeLegacy } = require('./legacy_search.js');
const quiet = process.argv.includes('-q');
const bench = JSON.parse(fs.readFileSync(path.join(__dirname, 'bench_core.json'), 'utf8'));
const { eng, info } = loadEngine();
const legacy = makeLegacy(fs.readFileSync(path.join(__dirname, 'legacy_nhi.txt'), 'utf8'), fs.readFileSync(path.join(root, 'icd.txt'), 'utf8'));
// billable (ICD): no other code starts with it
const icdCodes = legacy.DB.icd.map(r => r.code).sort();
const isLeaf = new Set();
for (let i = 0; i < icdCodes.length; i++) if (i === icdCodes.length - 1 || !icdCodes[i + 1].startsWith(icdCodes[i])) isLeaf.add(icdCodes[i]);
const billable = (kind, code) => kind === 'nhi' || isLeaf.has(code);
function judgeParts(b, res) {
  if (!res.parts) return { pass: false, rank: 0 };
  const used = new Set(); let ok = true, ranks = [];
  for (const bp of b.parts) {
    let hit = -1, rk = 0;
    res.parts.forEach((p, i) => { if (hit >= 0 || used.has(i)) return; const codes = p.rows.slice(0, bp.k).map(r => r.rec.code); const x = codes.findIndex(c => bp.want.some(w => c.startsWith(w))); if (x >= 0) { hit = i; rk = x + 1; } });
    if (hit < 0) { ok = false; ranks.push('-'); } else { used.add(hit); ranks.push('#' + rk); }
  }
  return { pass: ok, rank: ranks.join('/') };
}
function judge(b, codes) {
  if (b.codeOrder) { // SPEC 9.1 E8: the first rows must be exactly these codes, in this order
    const bad = b.codeOrder.findIndex((c, i) => codes[i] !== c);
    return { pass: bad < 0, rank: bad < 0 ? 1 : 0 };
  }
  let rank = 0;
  for (let i = 0; i < codes.length; i++) if (b.want.some(w => codes[i].startsWith(w))) { rank = i + 1; break; }
  let pass = rank > 0 && rank <= b.k;
  if (pass && b.billableFirst && !billable(b.kind, codes[0])) pass = false;
  return { pass, rank };
}
const stat = { legacy: { nhi: [0, 0], icd: [0, 0] }, v2: { nhi: [0, 0], icd: [0, 0] } };
const lines = [], fails = [];
for (const b of bench) {
  const lr = legacy.search(b.kind, b.q).rows.map(r => r.code);
  const nr = eng.search(b.kind, b.q, { limit: 300 });
  const jl = b.parts ? { pass: false, rank: 0 } : judge(b, lr), jn = b.parts ? judgeParts(b, nr) : judge(b, nr.rows.map(r => r.rec.code));
  stat.legacy[b.kind][1]++; stat.v2[b.kind][1]++;
  if (jl.pass) stat.legacy[b.kind][0]++;
  if (jn.pass) stat.v2[b.kind][0]++;
  const rk = j => (typeof j.rank === 'string' ? j.rank : j.rank ? '#' + j.rank : '-');
  lines.push(`${jn.pass ? 'PASS' : 'FAIL'}  ${b.kind}  ${JSON.stringify(b.q).padEnd(34)} k=${b.k}  v2 rank ${rk(jn).padEnd(5)} legacy ${jl.pass ? 'ok ' : 'no '}${rk(jl).padEnd(5)} total=${nr.total}  top=${nr.rows[0] ? nr.rows[0].rec.code : '-'}${nr.notes.length ? '  notes=' + JSON.stringify(nr.notes.map(n => n.type + ':' + (n.to || (n.dropped || []).join('+')))) : ''}`);
  if (!jn.pass) fails.push(lines[lines.length - 1]);
}
if (!quiet) console.log(lines.join('\n') + '\n');
else if (fails.length) console.log(fails.join('\n') + '\n');
const tot = o => [o.nhi[0] + o.icd[0], o.nhi[1] + o.icd[1]];
const row = (n, o) => `${n.padEnd(8)} nhi ${o.nhi[0]}/${o.nhi[1]}   icd ${o.icd[0]}/${o.icd[1]}   total ${tot(o)[0]}/${tot(o)[1]}`;
console.log(row('legacy', stat.legacy)); console.log(row('v2', stat.v2));
console.log(`data: nhi=${path.basename(info.nhiPath)} (${info.source}) alias=${info.aliasPath ? path.basename(info.aliasPath) : 'NONE'} lexicon=${path.basename(info.lexPath)}`);
const pct = tot(stat.v2)[0] / tot(stat.v2)[1];
console.log(`v2 pass rate ${(pct * 100).toFixed(1)}%  (threshold 95%)`);
process.exit(pct >= 0.95 ? 0 : 1);
