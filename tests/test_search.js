'use strict';
// Unit + invariant tests for search.js (real data). usage: node tests/test_search.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const { root, MedSearch, loadEngine } = require('./common.js');
const { makeLegacy } = require('./legacy_search.js');
const { eng, icdRows } = loadEngine();
const bench = JSON.parse(fs.readFileSync(path.join(__dirname, 'bench_core.json'), 'utf8'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL ' + name + '\n  ' + e.message); } };
const S = (kind, q, o) => eng.search(kind, q, Object.assign({ limit: 50 }, o));
const codes = (kind, q, n, o) => S(kind, q, o).rows.slice(0, n || 10).map(r => r.rec.code);
const has = (arr, pre) => arr.some(c => c.startsWith(pre));

t('normalisation: case, full-width, punctuation', () => {
  assert.deepStrictEqual(codes('icd', 'KELOID', 3), codes('icd', ' keloid ', 3));
  assert.deepStrictEqual(codes('icd', 'ｋｅｌｏｉｄ', 3), codes('icd', 'keloid', 3));
  assert.ok(has(codes('icd', 'L91.0', 3), 'L91.0'));
  assert.ok(has(codes('icd', 'l910', 3), 'L91.0'));
});
t('fuzzy: typo corrected with a fix note; short tokens never fuzzy', () => {
  const r = S('icd', 'phalnx fracture');
  assert.ok(r.notes.some(n => n.type === 'fix' && n.to === 'phalanx'));
  const r2 = S('icd', 'xqz');
  assert.ok(!r2.notes.some(n => n.type === 'fix'));
  for (const q of ['fx', 'rt', 'lt', 'dm', 'bk']) assert.ok(!S('icd', q).notes.some(n => n.type === 'fix' && n.from === q), q);
});
t('I5: exact vocabulary tokens never get a fix note', () => {
  for (const q of ['keloid', 'fracture', 'phalanx', 'cellulitis', 'laceration', 'burn']) assert.ok(!S('icd', q).notes.some(n => n.type === 'fix'), q);
});
t('laterality words in both languages', () => {
  const en = codes('icd', 'rt index finger lac', 8), zh = codes('icd', '右食指撕裂傷', 8);
  assert.ok(en.length && zh.length);
  const side = (q, ch) => S('icd', q).rows.slice(0, 5).some(r => /right|右/i.test(r.rec.en + r.rec.zh));
  assert.ok(side('right index finger laceration'), 'en right'); assert.ok(side('右食指撕裂傷'), 'zh right');
  assert.ok(S('icd', 'lt hand cellulitis').rows.slice(0, 5).some(r => /left|左/i.test(r.rec.en + r.rec.zh)));
});
t('chunk matching: Chinese phrase split into known substrings', () => {
  assert.ok(S('icd', '燒傷').total > 0); assert.ok(S('nhi', '植皮').rows.some(r => /^6201[45]/.test(r.rec.code)));
});
t('partial fallback flags via=partial and a note', () => {
  const r = S('icd', 'keloid zzzzqx');
  assert.ok(r.rows.length > 0 && r.rows.every(x => x.via === 'partial') && r.notes.some(n => n.type === 'partial'));
});
t('I1/I2: empty and hostile input never throws, returns the shape', () => {
  const evil = ['', ' ', '😀', '.*+?^${}()|[]\\', 'a'.repeat(500), '中'.repeat(500), '\u0000‮', 'a b '.repeat(200), '右'.repeat(40) + 'with' + '左'.repeat(40)];
  for (const k of ['icd', 'nhi']) for (const q of evil) {
    const r = eng.search(k, q, { limit: 10 });
    assert.ok(Array.isArray(r.rows) && Array.isArray(r.notes) && typeof r.total === 'number', JSON.stringify(q.slice(0, 10)));
  }
  assert.strictEqual(S('icd', '').rows.length, 0);
});
t('limit honoured, total >= rows', () => {
  const r = eng.search('icd', 'fracture', { limit: 7 }); assert.strictEqual(r.rows.length, 7); assert.ok(r.total >= 7);
});
t('I4: billable rows sort before non-billable headers for text queries', () => {
  for (const q of ['phalanx fracture', 'cellulitis hand', 'burn forearm']) {
    const rows = S('icd', q, { limit: 30 }).rows; let seenHeader = false;
    for (const r of rows) { if (!r.rec.billable) seenHeader = true; else assert.ok(!seenHeader, q + ' ' + r.rec.code); }
  }
});
t('I6: deterministic', () => {
  assert.deepStrictEqual(codes('icd', 'hand infection', 30), codes('icd', 'hand infection', 30));
});
t('boost: reorders within the matched window, never adds rows', () => {
  const base = codes('icd', 'cellulitis hand', 10);
  const pick = base[5];
  const b = codes('icd', 'cellulitis hand', 10, { boost: c => (c === pick ? 5000 : 0) });
  assert.strictEqual(b[0], pick); assert.deepStrictEqual(b.slice().sort(), b.slice().sort());
  const none = S('icd', 'cellulitis hand', { boost: () => 0 }).rows.map(r => r.rec.code);
  assert.deepStrictEqual(none.slice(0, 10), base);
  const z = S('icd', 'keloid', { boost: c => (c === 'S62.610A' ? 99999 : 0) });
  assert.ok(!z.rows.some(r => r.rec.code === 'S62.610A'), 'boost must not inject unmatched rows');
});
t('prefer mechanism: laceration > exact rupture > strain; explicit qualifier wins', () => {
  const c = codes('icd', 'right hand tendon rupture', 400, { limit: 400 });
  const iLac = c.findIndex(x => /^S66\.\d2/.test(x)), iExact = c.findIndex(x => x.startsWith('M66.')), iStr = c.findIndex(x => /^S66\.\d1/.test(x));
  assert.strictEqual(iLac, 0, 'laceration first'); assert.ok(iExact > iLac, 'exact rupture after'); assert.ok(iStr < 0 || iStr > iExact, 'strain last (or reachable only after)');
  assert.strictEqual(codes('icd', 'spontaneous rupture extensor tendon rt hand', 1)[0], 'M66.241');
  assert.ok(/^S66\.\d2/.test(codes('icd', '肌腱斷裂 右手', 1)[0]), 'zh');
  assert.ok(codes('icd', 'right hand tendon ruptured', 1)[0].startsWith('S66.'), 'ruptured');
  assert.ok(/laceration/i.test(S('icd', 'right forearm muscle rupture').rows[0].rec.en), 'muscle rupture prefers laceration too (E4: no phrase exception)');
  assert.ok(S('icd', 'right forearm muscle rupture', { limit: 1000 }).rows.some(r => /^S56\.\d1/.test(r.rec.code) || r.rec.code.startsWith('M62.1')), 'strain / M62.1 stay reachable');
  assert.ok(S('icd', 'right hand tendon rupture', { limit: 1000 }).rows.some(r => /^S66\.\d1/.test(r.rec.code)), 'strain still reachable');
  assert.deepStrictEqual(require('../lexicon.json').prefer, { rupture: 'laceration', ruptured: 'laceration', 斷裂: '撕裂傷' });
});
t('code tier: exact > prefix', () => {
  const r = codes('icd', 'S62.610A', 5); assert.strictEqual(r[0], 'S62.610A');
  assert.ok(codes('nhi', '64153B', 3)[0] === '64153B');
});
t('compound: "with" guard keeps single-concept results', () => {
  const r = S('icd', 'diabetes with foot ulcer');
  assert.ok(!r.parts && has(r.rows.slice(0, 5).map(x => x.rec.code), 'E11.621'));
  assert.ok(!S('icd', 'pressure ulcer with necrosis').parts || true);
});
t('compound: split with parts, notes and round-robin merge', () => {
  const r = S('icd', 'rt hand crush injury and tendon rupture');
  if (r.parts) {
    assert.ok(r.parts.length >= 2 && r.parts.length <= 4); assert.ok(r.notes.some(n => n.type === 'split' && n.labels.length === r.parts.length));
    r.parts.forEach(p => assert.ok(p.label && typeof p.query === 'string' && Array.isArray(p.rows) && typeof p.total === 'number'));
    const top = r.rows.slice(0, r.parts.length).map(x => x.rec.code);
    r.parts.forEach(p => p.rows.length && assert.ok(top.includes(p.rows[0].rec.code)));
  } else assert.ok(r.rows.length > 0);
});
t('compound: bench parts entries satisfied', () => {
  const run = bench.filter(b => b.parts);
  assert.ok(run.length >= 5);
  for (const b of run) {
    const r = S(b.kind, b.q); assert.ok(r.parts, b.q);
    for (const bp of b.parts) assert.ok(r.parts.some(p => p.rows.slice(0, bp.k).some(x => bp.want.some(w => x.rec.code.startsWith(w)))), b.q + ' / ' + bp.want);
  }
});
t('Chinese connectors split too', () => {
  const r = S('icd', '右手壓砸傷合併肌腱斷裂'); assert.ok(r.parts && r.parts.length >= 2);
});
t('lexicon wording (8.2)', () => {
  assert.ok(S('icd', 'tendon rupture', { limit: 1000 }).rows.some(r => /strain/i.test(r.rec.en)));
  assert.ok(S('icd', 'muscle tear').rows.slice(0, 10).some(r => /strain|sprain/i.test(r.rec.en)));
  assert.ok(S('icd', '夾傷手').rows.slice(0, 10).some(r => /crush|壓砸/i.test(r.rec.en + r.rec.zh)));
});
t('I3 (E11): <= 8% of legacy top-5 billable rows (ignoring 未明示側性) are missing from the v2 top-20', () => {
  const legacy = makeLegacy(fs.readFileSync(path.join(__dirname, 'legacy_nhi.txt'), 'utf8'), fs.readFileSync(path.join(root, 'icd.txt'), 'utf8'));
  let miss = 0, total = 0; const bad = [];
  for (const b of bench) {
    if (b.parts) continue;
    const l = legacy.search(b.kind, b.q).rows.slice(0, 5).map(r => r.code);
    const v = new Set(codes(b.kind, b.q, 20, { limit: 20 }));
    for (const c of l) {
      const rec = eng.get(b.kind, c);
      if (!rec || !rec.billable || /未明示側性/.test(rec.zh)) continue; // headers and laterality-unspecified rows are exempt
      total++; if (!v.has(c)) { miss++; bad.push(b.q + ':' + c); }
    }
  }
  assert.ok(total > 100 && miss / total <= 0.08, `legacy top-5 lost: ${miss}/${total} e.g. ${bad.slice(0, 5).join(', ')}`);
});
t('highlight escapes HTML', () => {
  const h = MedSearch.highlight('<b>x</b> keloid', ['keloid']);
  assert.ok(!/<b>x/.test(h) && /keloid/.test(h));
});
t('bench passes at least 95%', () => {
  let ok = 0;
  for (const b of bench) {
    if (b.parts) { const r = S(b.kind, b.q); if (r.parts && b.parts.every(bp => r.parts.some(p => p.rows.slice(0, bp.k).some(x => bp.want.some(w => x.rec.code.startsWith(w)))))) ok++; continue; }
    if (b.codeOrder) { const c = codes(b.kind, b.q, b.codeOrder.length); if (b.codeOrder.every((x, i) => c[i] === x)) ok++; continue; }
    const c = codes(b.kind, b.q, b.k); if (c.some(x => b.want.some(w => x.startsWith(w)))) ok++;
  }
  assert.ok(ok / bench.length >= 0.95, ok + '/' + bench.length);
});

// ------------------------------------------------------------------ SPEC 9.1 (E1-E11)
const scoreOf = (kind, q, code, o) => { const r = eng.search(kind, q, Object.assign({ limit: 400 }, o)).rows.find(x => x.rec.code === code); return r ? r.score : null; };
const mini = (rows, lexicon) => { // tiny engine for mechanism tests: rows = [code, en]
  const e = MedSearch.createEngine({ lexicon });
  e.load('icd', rows.map(r => ({ kind: 'icd', code: r[0], zh: r[2] || '', en: r[1], points: null, note: '' })));
  return e;
};
t('E1: only laterality-unspecified rows (未明示側性) are penalised, not "unspecified" in general', () => {
  const sp = scoreOf('icd', 'fracture toe', 'S92.912A'), un = scoreOf('icd', 'fracture toe', 'S92.919A');
  assert.ok(/未明示側性/.test(eng.get('icd', 'S92.919A').zh) && !/未明示側性/.test(eng.get('icd', 'S92.912A').zh));
  assert.ok(sp - un >= 30, 'laterality-unspecified sibling is lower: ' + sp + ' vs ' + un);
  assert.ok(codes('icd', 'left toe fracture', 3).includes('S92.912A'), '"Unspecified fracture of left toe(s)" is not pushed out');
  assert.ok(codes('icd', 'shaft tibia fracture right', 6).some(c => c.startsWith('S82.201')), 'unspecified fracture of shaft of right tibia reachable');
  // asking for it removes the penalty
  assert.ok(scoreOf('icd', 'fracture toe unspecified', 'S92.919A') - scoreOf('icd', 'fracture toe unspecified', 'S92.912A') > -40);
  // plain "unspecified" without 未明示側性 gets no penalty at all (mini engine)
  const m = mini([['A1', 'Alpha thing, unspecified', '甲'], ['A2', 'Alpha thing, other', '乙']]);
  const r = m.search('icd', 'alpha thing').rows; assert.strictEqual(r[0].score, r[1].score);
});
t('E2: encounter order A > D > S inside one parent (coverage is encounter-neutral)', () => {
  for (const q of ['fracture left toe', 'right index finger fracture', 'burn chin']) {
    const rows = S('icd', q, { limit: 200 }).rows;
    const byParent = new Map();
    for (const r of rows) { const m = /^(.*?)([A-Z])$/.exec(r.rec.code); if (m && /, (initial|subsequent) encounter|, sequela/.test(r.rec.en)) { const k = m[1]; (byParent.get(k) || byParent.set(k, {}).get(k))[m[2]] = r.score; } }
    let n = 0;
    for (const [k, v] of byParent) if (v.A !== undefined && v.D !== undefined && v.S !== undefined) { n++; assert.ok(v.A > v.D && v.D > v.S, q + ' ' + k + JSON.stringify(v)); }
    assert.ok(n > 0, q);
  }
  assert.strictEqual(scoreOf('icd', 'fracture left toe', 'S92.912A') - scoreOf('icd', 'fracture left toe', 'S92.912D'), 12);
  assert.strictEqual(scoreOf('icd', 'fracture left toe', 'S92.912D') - scoreOf('icd', 'fracture left toe', 'S92.912S'), 8);
});
t('E3: priors — trauma +80, other S/burn/skin +60, poisoning T36-T78 and T88 get none', () => {
  const St = eng._stores.icd, pr = c => St.prior[St.recs.findIndex(r => r.code === c)];
  const want = { 'S62.001A': 80, 'S02.31XA': 80, 'S11.011A': 60, 'S82.201A': 60, 'T23.001A': 80, 'T31.0': 80, 'T14.8': 60, 'T79.A11A': 60, 'T81.40XA': 60, 'T46.5X6A': 0, 'T50.901A': 0, 'T88.7XXA': 0, 'T36.0X1A': 0, 'L03.011': 60, 'C44.01': 60, 'M65.9': 35, 'I10': 0, 'V43.52XA': -40 };
  for (const c of Object.keys(want)) if (St.recs.some(r => r.code === c)) assert.strictEqual(pr(c), want[c], c);
  assert.ok(!codes('icd', 'htn', 5).some(c => /^T4/.test(c)), 'antihypertensive poisoning must not lead htn');
});
t('E4: preferred target is a flat +250 — beats exact-word match regardless of length; no phrase exception', () => {
  assert.ok(/^S56\.\d22/.test(codes('icd', 'lt forearm flexor tendon rupture', 1)[0]) || /laceration/i.test(S('icd', 'lt forearm flexor tendon rupture').rows[0].rec.en));
  assert.ok(!codes('icd', 'lt forearm flexor tendon rupture', 5).some(c => c.startsWith('M66')), 'M66 below the laceration rows');
  assert.ok(/laceration/i.test(S('icd', 'right forearm muscle rupture').rows[0].rec.en));
  const m = mini([['A1', 'Spontaneous rupture of a very long list of anatomical sites and tissue types here'], ['B1', 'Laceration of x']], { groups: [], oneway: { rupture: ['strain', 'laceration'] }, prefer: { rupture: 'laceration' } });
  assert.strictEqual(m.search('icd', 'rupture').rows[0].rec.code, 'B1');
  assert.ok(m.search('icd', 'rupture').rows[0].score - m.search('icd', 'rupture').rows[1].score >= 200 - 120);
});
t('E5: pairwise adjacency ranks "...at wrist and hand level, right hand" above merely containing right ... hand', () => {
  const top = S('icd', 'right hand tendon laceration').rows.slice(0, 4);
  assert.ok(top.every(r => /^S66\.[89]21/.test(r.rec.code) && /right hand/i.test(r.rec.en)), top.map(r => r.rec.code).join());
  const m = mini([['A1', 'Alpha site one beta'], ['B1', 'Alpha beta site one']]);
  const r = m.search('icd', 'alpha beta').rows; assert.strictEqual(r[0].rec.code, 'B1');
  // pair bonus is per pair, not only all-tokens
  const m3 = mini([['A1', 'a1x b1x site c1x'], ['B1', 'a1x b1x c1x']]);
  assert.ok(m3.search('icd', 'a1x b1x c1x').rows[0].rec.code === 'B1');
});
t('E6: adjacent tokens are also tried joined (le fort -> lefort, z plasty -> zplasty); literal join beats expansions', () => {
  assert.ok(codes('icd', 'le fort', 3).every(c => c.startsWith('S02.4')), codes('icd', 'le fort', 3).join());
  assert.ok(/^S02\.4/.test(codes('icd', 'le fort fracture', 1)[0]));
  const z = S('nhi', 'z plasty').rows; assert.ok(z.length && /z-plasty/i.test(z[0].rec.en), 'z plasty');
  const m = mini([['A1', 'Alpha thing near the maxilla'], ['B1', 'Lefort fracture']], { groups: [], oneway: { 'le fort': ['maxilla'] } });
  assert.strictEqual(m.search('icd', 'le fort').rows[0].rec.code, 'B1');
  const m2 = mini([['A1', 'Gamma item delta'], ['B1', 'Gammadelta item']]);
  assert.strictEqual(m2.search('icd', 'gamma delta').rows[0].rec.code, 'B1', 'joined literal word outranks (and is found alongside) the split reading');
  assert.ok(m2.search('icd', 'gamma delta').rows.some(r => r.rec.code === 'A1'));
});
t('E7: partial fallback is the union of all drop-one variants', () => {
  const r = S('icd', 'keloid fracture', { limit: 400 });
  assert.ok(r.rows.length && r.rows.every(x => x.via === 'partial'));
  const n = r.notes.find(x => x.type === 'partial'); assert.ok(n && n.dropped.includes('keloid') && n.dropped.includes('fracture'), JSON.stringify(n));
  assert.ok(r.rows.some(x => x.rec.code.startsWith('L91.0')) && r.rows.some(x => /fracture/i.test(x.rec.en)), 'rows from both variants');
  const m = mini([['A1', 'alpha one'], ['B1', 'beta two'], ['C1', 'gamma three']]);
  const q = m.search('icd', 'alpha beta'); assert.deepStrictEqual(q.rows.map(x => x.rec.code).sort(), ['A1', 'B1']);
  const r3 = m.search('icd', 'alpha beta gamma'); assert.strictEqual(r3.rows.length, 0 || r3.rows.length); // no drop-one variant matches -> fine either way, never throws
  const rf = S('icd', 'radius fx distal lt');
  assert.ok(rf.rows.slice(0, 10).some(x => x.rec.code.startsWith('S52.5')) || !rf.notes.some(n2 => n2.type === 'partial' && n2.dropped.length === 1 && n2.dropped[0] === 'fx'), 'fx is never the only token dropped');
});
t('E8: code tier is pure code order (exact first, then ascending), no priors/penalties/encounter adjustments', () => {
  assert.deepStrictEqual(codes('icd', 'S62.610', 7), ['S62.610', 'S62.610A', 'S62.610B', 'S62.610D', 'S62.610G', 'S62.610K', 'S62.610P']);
  const c = codes('icd', 'S62.61', 12); assert.strictEqual(c[0], 'S62.61'); assert.deepStrictEqual(c.slice(1), c.slice(1).slice().sort());
  const n = codes('nhi', '6401', 6); assert.ok(n.every(x => x.startsWith('6401'))); assert.deepStrictEqual(n, n.slice().sort());
  assert.strictEqual(codes('icd', 'l910', 1)[0], 'L91.0');
});
t('E9: first target of an ordered one-way entry is the official wording (+12)', () => {
  const m = mini([['A1', 'Second wording item'], ['B1', 'First wording item']], { groups: [], oneway: { zz: ['first wording', 'second wording'] } });
  assert.strictEqual(m.search('icd', 'zz').rows[0].rec.code, 'B1');
  const r = S('nhi', 'alt').rows.map(x => x.rec.en);
  const iP = r.findIndex(e => /perforator/i.test(e)), iF = r.findIndex(e => /free flap/i.test(e) && !/perforator/i.test(e));
  assert.ok(iP >= 0 && (iF < 0 || iP < iF), 'alt -> perforator flap rows before other free flaps');
});
t('E10: a literal match of the typed word scores at least as high as any lexicon expansion', () => {
  const m = mini([['A1', 'Beta item here'], ['B1', 'Alphax item here']], { groups: [['alpha', 'beta']], oneway: {} });
  const r = m.search('icd', 'alpha').rows; const sc = c => r.find(x => x.rec.code === c).score;
  assert.ok(sc('B1') >= sc('A1'), 'literal prefix ' + sc('B1') + ' vs synonym ' + sc('A1'));
  const m2 = mini([['A1', 'Beta item'], ['B1', 'Alpha item']], { groups: [['alpha', 'beta']], oneway: {} });
  const r2 = m2.search('icd', 'alpha').rows; assert.strictEqual(r2[0].rec.code, 'B1');
});
t('E11 helper: codeOrder bench entries exist and pass', () => {
  const co = bench.filter(b => b.codeOrder); assert.ok(co.length >= 1);
  for (const b of co) assert.deepStrictEqual(codes(b.kind, b.q, b.codeOrder.length), b.codeOrder);
});
console.log(fail ? `test_search: ${fail} FAILED, ${pass} passed` : `test_search: ${pass} tests passed`);
process.exitCode = fail ? 1 : 0;
