'use strict';
// Shared loader for tests: builds a MedSearch engine from the repo data files.
// Env overrides (for development before the real data exists): NHI_JSON, ALIAS_TXT, LEXICON.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const MedSearch = require(path.join(root, 'search.js'));
function pick(envName, name) {
  if (process.env[envName]) return process.env[envName];
  return path.join(root, name);
}
function loadEngine(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const lexPath = pick('LEXICON', 'lexicon.json');
  const lexicon = !opts.noLexicon && fs.existsSync(lexPath) ? JSON.parse(fs.readFileSync(lexPath, 'utf8')) : null;
  const eng = MedSearch.createEngine({ lexicon });
  const nhiPath = pick('NHI_JSON', 'nhi.json');
  const nhiObj = JSON.parse(fs.readFileSync(nhiPath, 'utf8'));
  const info = { nhiPath, lexPath, aliasPath: null, nhiCount: nhiObj.rows.length, source: nhiObj.source };
  eng.load('nhi', MedSearch.parseNhiJson(nhiObj));
  const icdRows = MedSearch.parseIcdTxt(fs.readFileSync(path.join(root, 'icd.txt'), 'utf8'));
  const aliasPath = pick('ALIAS_TXT', 'icd_alias.txt');
  let aliases = null;
  if (!opts.noAlias && fs.existsSync(aliasPath)) { aliases = MedSearch.parseAliasTxt(fs.readFileSync(aliasPath, 'utf8')); info.aliasPath = aliasPath; }
  const t1 = Date.now();
  eng.load('icd', icdRows, { aliases });
  info.icdBuildMs = Date.now() - t1; info.totalMs = Date.now() - t0;
  return { MedSearch, eng, lexicon, info, icdRows, nhiObj };
}
module.exports = { root, MedSearch, loadEngine };
