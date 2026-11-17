'use strict';
const assert = require('assert');
const MedLearn = require('../learn.js');
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } };
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; }, _m: m }; };
const DAY = 86400000;
let clock = 1e12; const now = () => clock;
const mk = (s) => MedLearn.create(s || mem(), now);

t('recordUse / boost / recent / frequent', () => {
  const L = mk(); L.recordUse('nhi', '64153B'); clock += 1000; L.recordUse('nhi', '62032B'); L.recordUse('nhi', '62032B');
  assert.deepStrictEqual(L.recent('nhi', 5), ['62032B', '64153B']);
  assert.deepStrictEqual(L.frequent('nhi', 5), ['62032B', '64153B']);
  const b1 = L.usageBoost('nhi', '64153B'), b2 = L.usageBoost('nhi', '62032B');
  assert.ok(b1 > 0 && b2 > b1 && b2 <= 400); assert.strictEqual(L.usageBoost('icd', 'X'), 0);
});
t('decay: half after 180 days, recency bonus gone after 7 days', () => {
  const L = mk(); L.recordUse('icd', 'L91.0'); const b0 = L.usageBoost('icd', 'L91.0');
  clock += 8 * DAY; const b1 = L.usageBoost('icd', 'L91.0');
  assert.ok(b0 - b1 > 90, 'recency bonus (+100) must lapse');
  clock += 180 * DAY; const b2 = L.usageBoost('icd', 'L91.0'); assert.ok(b2 < b1 && b2 > 0);
});
t('boost caps at 400', () => { const L = mk(); for (let i = 0; i < 200; i++) L.recordUse('icd', 'A'); assert.strictEqual(L.usageBoost('icd', 'A'), 400); });
t('commitCase pairs, dedupe 12h, <2 codes ignored', () => {
  const L = mk();
  assert.strictEqual(L.commitCase(['S62.610A'], []), false);
  assert.strictEqual(L.commitCase(['S62.610A'], ['64153B']), true);
  assert.strictEqual(L.commitCase(['S62.610A'], ['64153B']), false);
  clock += 13 * 3600 * 1000;
  assert.strictEqual(L.commitCase(['S62.610A'], ['64153B']), true);
  assert.strictEqual(L.stats().cases, 2); assert.strictEqual(L.stats().pairs, 1);
});
t('assocBoost and suggest', () => {
  const L = mk(); L.commitCase(['S62.610A', 'S61.211A'], ['64153B', '48004C']);
  assert.ok(L.assocBoost('64153B', ['S62.610A']) > 0 && L.assocBoost('64153B', ['S62.610A']) <= 300);
  assert.strictEqual(L.assocBoost('64153B', []), 0); assert.strictEqual(L.assocBoost('99999C', ['S62.610A']), 0);
  const s = L.suggest('nhi', ['S62.610A'], 5).map(x => x.code); assert.deepStrictEqual(s.sort(), ['48004C', '64153B']);
  assert.ok(!L.suggest('nhi', ['S62.610A', '64153B'], 5).some(x => x.code === '64153B'));
  assert.deepStrictEqual(L.suggest('icd', ['64153B'], 5).map(x => x.code).sort(), ['S61.211A', 'S62.610A']);
});
t('persistence across instances and corrupt storage', () => {
  const s = mem(); const L = mk(s); L.recordUse('nhi', '62032B');
  assert.deepStrictEqual(mk(s).recent('nhi', 3), ['62032B']);
  s._m['medcode.learn.v1'] = '{not json'; assert.deepStrictEqual(mk(s).recent('nhi', 3), []);
});
t('storage errors are swallowed', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); } };
  const L = mk(bad); L.recordUse('nhi', 'A1'); L.recordMiss('icd', 'abc'); assert.strictEqual(L.commitCase(['A'], ['B']), true);
  assert.ok(L.exportData()); const nul = mk(null); nul.recordUse('icd', 'Z'); assert.strictEqual(nul.stats().uses, 1);
});
t('limits: 3000 use entries, 6000 pairs', () => {
  const L = mk();
  for (let i = 0; i < 3100; i++) { clock += 1; L.recordUse('icd', 'C' + i); }
  assert.ok(L.stats().uses <= 3000);
  assert.ok(L.usageBoost('icd', 'C3099') > 0 && L.usageBoost('icd', 'C0') === 0, 'lowest decayed pruned first');
});
t('pairs limit', () => {
  const L = mk();
  for (let i = 0; i < 2100; i++) { clock += 13 * 3600 * 1000 / 100; L.commitCase(['D' + i, 'E' + i], ['10000C', '20000C']); }
  assert.ok(L.stats().pairs <= 6000);
});
t('export / import replace and merge', () => {
  const A = mk(); A.recordUse('nhi', '1'); A.commitCase(['X1'], ['62032B']); A.recordMiss('icd', 'foo bar');
  const B = mk(); B.recordUse('nhi', '1'); B.recordUse('nhi', '2');
  assert.strictEqual(B.importData(A.exportData(), { merge: true }), true);
  assert.strictEqual(B.stats().uses, 2); assert.strictEqual(B.stats().cases, 1); assert.strictEqual(B.misses().length, 1);
  const C = mk(); C.recordUse('icd', 'Q'); assert.strictEqual(C.importData(A.exportData()), true); assert.strictEqual(C.usageBoost('icd', 'Q'), 0);
  assert.strictEqual(C.importData('garbage'), false); assert.strictEqual(C.importData('{"v":2}'), false);
});
t('reset', () => { const L = mk(); L.recordUse('nhi', '1'); L.reset(); assert.strictEqual(L.stats().uses, 0); });
t('miss log: record, count, cap 200, clear, export/import', () => {
  const L = mk();
  L.recordMiss('icd', 'ab'); assert.strictEqual(L.misses().length, 0, 'under 3 chars ignored');
  L.recordMiss('icd', 'Phalnx  Fx'); clock += 5; L.recordMiss('icd', 'phalnx fx'); clock += 5; L.recordMiss('nhi', 'phalnx fx');
  const m = L.misses(); assert.strictEqual(m.length, 2); assert.strictEqual(m[0].kind, 'nhi'); assert.strictEqual(m.find(x => x.kind === 'icd').n, 2);
  for (let i = 0; i < 250; i++) { clock += 1; L.recordMiss('icd', 'query ' + i); }
  assert.strictEqual(L.misses().length, 200); assert.ok(!L.misses().some(x => x.q === 'query 0') && L.misses().some(x => x.q === 'query 249'));
  const E = L.exportData(); const L2 = mk(); L2.importData(E); assert.strictEqual(L2.misses().length, 200);
  L2.clearMisses(); assert.strictEqual(L2.misses().length, 0);
});
console.log(process.exitCode ? 'test_learn FAILED' : `test_learn: ${pass} tests passed`);
