#!/usr/bin/env node
'use strict';
// Proves every lexicon expansion target hits >= 1 record (NHI, ICD or alias) and prints the dead ones.
//   node tools/validate_lexicon.js            report only (exit 1 if dead entries exist)
//   node tools/validate_lexicon.js --fix      rewrite lexicon.json without dead targets / empty entries
// Also sanity-checks the file shape (words only, no codes) and that the legacy v1 SYN table is preserved.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const { loadEngine } = require(path.join(root, 'tests', 'common.js'));
const fix = process.argv.includes('--fix');
const lexPath = process.env.LEXICON || path.join(root, 'lexicon.json');
const lex = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
process.env.LEXICON = lexPath;
const { eng, info } = loadEngine({ noLexicon: true });
const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/臺/g, '台').replace(/\s+/g, ' ').trim();
const cache = new Map();
function live(t) {
  const k = norm(t);
  if (!cache.has(k)) cache.set(k, eng.probe('nhi', k) + eng.probe('icd', k) > 0);
  return cache.get(k);
}
const problems = [], dead = [];
const looksLikeCode = t => /^[A-Za-z]\d{2}(\.\w+)?$/.test(t) || /^\d{5}[A-Za-z]$/.test(t);
const outGroups = [], outOne = {};
for (const g of lex.groups || []) {
  const keep = [];
  for (const m of g) {
    if (looksLikeCode(m)) problems.push('code-like member: ' + m);
    if (live(m)) keep.push(m); else dead.push(`group member "${m}"  (group: ${g.slice(0, 4).join(' | ')} ...)`);
  }
  if (keep.length >= 2) outGroups.push(keep); else if (g.length) dead.push(`group dropped: ${g.join(' | ')}`);
}
for (const k of Object.keys(lex.oneway || {})) {
  if (looksLikeCode(k)) problems.push('code-like key: ' + k);
  const keep = [];
  for (const t of lex.oneway[k]) {
    if (looksLikeCode(t)) problems.push('code-like target: ' + t);
    if (live(t)) keep.push(t); else dead.push(`oneway "${k}" -> "${t}"`);
  }
  if (keep.length) outOne[k] = keep; else dead.push(`oneway "${k}" has no live target (entry removed)`);
}
// legacy SYN preserved?
const legacySrc = fs.readFileSync(path.join(root, 'tests', 'legacy_search.js'), 'utf8');
const SYN = eval('(' + legacySrc.match(/const SYN=(\{.*?\});/s)[1] + ')');
const missing = [];
for (const k of Object.keys(SYN)) for (const t of SYN[k]) {
  if (t === k) continue;
  if (!live(t)) continue; // legacy target absent from the current data (e.g. 'tumour'): cannot be expressed
  const inOne = (outOne[k] || []).map(norm).includes(norm(t));
  const inGrp = outGroups.some(g => g.map(norm).includes(norm(k)) && g.map(norm).includes(norm(t)));
  if (!inOne && !inGrp) missing.push(`${k} -> ${t}`);
}
const outPrefer = {};
for (const k of Object.keys(lex.prefer || {})) { const t = lex.prefer[k]; if (live(t)) outPrefer[k] = t; else dead.push(`prefer "${k}" -> "${t}"`); if (!(lex.oneway[k] || []).includes(t)) problems.push(`prefer target not in oneway: ${k} -> ${t}`); }
const nEntries = outGroups.length + Object.keys(outOne).length;
console.log(`lexicon ${path.basename(lexPath)}: groups ${outGroups.length}, oneway ${Object.keys(outOne).length}, total ${nEntries}; data nhi=${info.nhiCount} alias=${info.aliasPath ? 'yes' : 'NO'}`);
console.log(`dead items: ${dead.length}`);
dead.slice(0, 400).forEach(d => console.log('  DEAD ' + d));
if (missing.length) { console.log('legacy SYN entries missing (they may be dead in current data): ' + missing.join('; ')); }
problems.forEach(p => console.log('  PROBLEM ' + p));
if (fix) {
  fs.writeFileSync(lexPath, '{"v":1,\n"groups":[\n' + outGroups.map(g => JSON.stringify(g)).join(',\n') + '\n],\n"oneway":{\n' + Object.keys(outOne).sort().map(k => JSON.stringify(k) + ':' + JSON.stringify(outOne[k])).join(',\n') + '\n},\n"anatomy":' + JSON.stringify(lex.anatomy || []) + ',\n"prefer":' + JSON.stringify(outPrefer) + '}\n');
  console.log('rewrote ' + lexPath + ' (removed ' + dead.length + ' dead items)');
  process.exit(problems.length ? 1 : 0);
}
process.exit(dead.length || problems.length || missing.length ? 1 : 0);
