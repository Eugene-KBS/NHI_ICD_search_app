/* search.js — MedSearch: NHI fee-schedule + ICD-10-CM search engine (SPEC section 3).
   UMD, no DOM, no storage, no fetch, ES2019. Single file, no dependencies.

   Overview
   - Index: sorted vocabulary + typed-array postings (main words, and a separate alias/kw field whose
     owners cover their ICD descendants through a contiguous code range).
   - Query -> tokens -> "units" (a token or a lexicon phrase). A unit matches a record through several
     alternatives (literal word/substring, lexicon expansion, alias, chunk, fuzzy). Each unit fills a dense
     Uint8Array of per-record match quality; records matching every unit are scored.
   Scoring weights are commented at SCORE below. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MedSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- SCORE constants (weights)
  const W = {
    codeExact: 2000, codePrefix: 1000, codeContains: 120,   // legacy tiers
    codeLikeBonus: 3000,                                    // code-looking query: prefix hits beat any text hit (I1)
    abbrExact: 3000, abbrContains: 150,                     // legacy NHI abbreviation tiers
    text: 700, partial: 300,                                // all-tokens text tier / partial fallback base
    exactWord: 250, zhSubstr: 500,                          // whole query is one exact word / substring of zh
    qExact: 60, qPrefix: 40, qLex: 35, qLexG: 58, qAlias: 30, qChunk: 25, qFuzzy: 15, // per-token quality
    qFirst: 12,                                             // E9: first target of an ordered one-way entry (official wording)
    qJoin: 10,                                              // E6: literal joined form (le fort -> lefort) above plain exact
    prefer: 250,                                            // E4: flat record bonus for a match through a preferred target
    cover: 150, adj: 100, pair: 40,                         // coverage (tuned 120->150 for I3), all-tokens adjacency, E5 per adjacent pair
    header: -300, unsp: -40                                 // non-billable header; E1 laterality-unspecified penalty
  };
  const ENC_PEN = { A: 0, D: -12, S: -20 };                 // E2: 7th-character order within one parent
  const STOP = new Set('of the and in at to for a an 的 之'.split(' '));
  const SINGLES = '右左雙上下前後內外手足指趾腕肘肩膝踝髖臉頸胸腹背頭眼耳鼻唇舌骨皮';
  const MAX_UNITS = 10, TOP_WINDOW = 1500, PREF_TMP = 24;

  // ---------------------------------------------------------------- text helpers
  function norm(s) {
    s = s == null ? '' : String(s);
    try { s = s.normalize('NFKC'); } catch (e) { /* ignore */ }
    return s.toLowerCase().replace(/臺/g, '台');
  }
  const CJK_RE = /[㐀-䶿一-鿿]/;
  const SEP_RE = /[-.&'’]+/g;
  // English words (primary, in order) + joined compound forms (extras): z-plasty -> z plasty | zplasty
  function enWords(s, extras) {
    // "non-pressure" must not match a search for "pressure": index negated compounds as one word (nonpressure)
    s = s.replace(/\bnon-(?=[a-z])/g, 'non');
    const prim = s.match(/[a-z0-9]+/g) || [];
    if (extras) {
      const comp = s.match(/[a-z0-9]+(?:[-.&'’][a-z0-9]+)+/g);
      if (comp) for (let i = 0; i < comp.length; i++) extras.push(comp[i].replace(SEP_RE, ''));
    }
    return prim;
  }
  // Encounter-neutral Chinese text (ICD): the 7th-character variants of one concept are worded differently in zh
  //   …閉鎖性骨折之初期照護 / …開放性骨折之初期照護 / …骨折癒合之後續照護 / …骨折之後遺症   ->   …骨折
  // The neutral form is appended to the searchable zh (after \u0001) so a query such as 鼻骨骨折 matches the
  // initial-encounter rows as a whole substring too, and all variants tie; the fixed A > D > S order then decides.
  function zhNeutral(z) {
    let t = z.replace(/之(?:初期照護|後續照護|後遺症)$/, '');
    if (t === z) return z;
    return t.replace(/(?:延遲癒合|癒合不良|未癒合|癒合)$/, '')
            .replace(/(?:第?\s*[ivabc、,，或及和\s]+型)?(?:閉鎖性|開放性)(?=骨折$)/, '');
  }
  function lowerBound(arr, s) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < s) lo = m + 1; else hi = m; }
    return lo;
  }
  function dl(a, b, max) { // optimal-string-alignment (Damerau-Levenshtein, adjacent transposition)
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = new Array(lb + 1), p1 = new Array(lb + 1), cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) p1[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i; let mn = i;
      for (let j = 1; j <= lb; j++) {
        const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + c);
        if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, p2[j - 2] + 1);
        cur[j] = v; if (v < mn) mn = v;
      }
      if (mn > max) return max + 1;
      const t = p2; p2 = p1; p1 = cur; cur = t;
    }
    return p1[lb];
  }

  // ---------------------------------------------------------------- parsers
  function parseNhiJson(obj) {
    const src = obj && obj.rows ? obj.rows : [];
    const out = new Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const r = src[i];
      out[i] = { kind: 'nhi', code: String(r[0]), zh: r[1] || '', en: r[2] || '', points: (typeof r[3] === 'number' ? r[3] : (r[3] === '' || r[3] == null ? null : Number(r[3]))), note: r[4] || '', kw: r[5] || '' };
    }
    return out;
  }
  function parseIcdTxt(text) {
    const lines = String(text).split('\n'), out = [];
    for (let i = 0; i < lines.length; i++) {
      let ln = lines[i]; if (!ln) continue;
      if (ln.charCodeAt(ln.length - 1) === 13) ln = ln.slice(0, -1);
      const a = ln.indexOf('|'); if (a < 0) continue;
      const b = ln.indexOf('|', a + 1);
      out.push({ kind: 'icd', code: ln.slice(0, a).trim(), zh: (b < 0 ? ln.slice(a + 1) : ln.slice(a + 1, b)).trim(), en: b < 0 ? '' : ln.slice(b + 1).trim(), points: null, note: '' });
    }
    return out;
  }
  function parseAliasTxt(text) {
    const m = new Map(), lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]; const a = ln.indexOf('|'); if (a < 0) continue;
      const terms = ln.slice(a + 1).split(';').map(s => s.trim()).filter(Boolean);
      if (terms.length) m.set(ln.slice(0, a).trim(), terms);
    }
    return m;
  }

  // ---------------------------------------------------------------- sections and priors (SPEC 3.7)
  const SECT = [];
  function sectDef(from, to, label) { for (let i = from; i <= to; i++) SECT[i] = [String(from < 10 ? '0' + from : from), label]; }
  [[0, 5, '基本診療'], [6, 31, '檢查'], [32, 38, '放射'], [39, 39, '注射'], [41, 44, '復健'], [45, 45, '精神'], [47, 47, '處置·一般'], [48, 48, '處置·創傷'], [49, 49, '處置·腸胃'], [50, 50, '處置·泌尿'], [51, 51, '處置·皮膚'], [52, 52, '處置·骨科'], [53, 53, '處置·眼'], [54, 54, '處置·耳鼻喉'], [55, 55, '處置·婦產'], [56, 56, '處置·神經血管'], [57, 57, '處置·呼吸'], [58, 58, '處置·透析'], [59, 59, '高壓氧'], [60, 60, '處置·眼雷射'], [61, 61, '處置·骨折'], [62, 62, '手術·皮膚'], [63, 63, '手術·乳房'], [64, 64, '手術·骨骼肌肉'], [65, 65, '手術·鼻'], [66, 66, '手術·喉'], [67, 67, '手術·胸腔'], [68, 68, '手術·心臟'], [69, 69, '手術·血管'], [70, 70, '手術·脾淋巴'], [71, 71, '手術·口腔食道'], [72, 72, '手術·胃'], [73, 73, '手術·腸'], [74, 74, '手術·肛門'], [75, 75, '手術·肝膽胰'], [76, 79, '手術·泌尿'], [80, 81, '手術·婦產'], [82, 82, '手術·內分泌'], [83, 83, '手術·神經'], [84, 84, '手術·耳'], [85, 87, '手術·眼'], [88, 88, '手術·小兒'], [89, 92, '牙科'], [93, 94, '輸血'], [95, 95, '石膏'], [96, 96, '麻醉'], [97, 99, '論病例']].forEach(d => sectDef(d[0], d[1], d[2]));
  const sectCache = new Map();
  function mkSect(id, label) {
    const k = id + '|' + label; let o = sectCache.get(k);
    if (!o) { o = { id, label, toString() { return label; } }; sectCache.set(k, o); }
    return o;
  }
  function sectionOf(code) {
    code = String(code || '');
    const m = /^(\d{2})\d{3}[A-Za-z]$/.exec(code);
    if (m) { const d = SECT[+m[1]]; if (d) return mkSect(d[0], d[1]); return mkSect(m[1], '其他'); }
    if (/^[A-Za-z]/.test(code)) return mkSect('X', '專案/其他');
    return mkSect('Y', '預防保健/其他');
  }
  const NHI_P60 = new Set([48, 62, 64]), NHI_P35 = new Set([51, 52, 59, 61, 63, 65, 69, 71, 83, 84, 87, 95, 96]);
  function nhiPrior(code) {
    const m = /^(\d{2})\d{3}[A-Za-z]$/.exec(code);
    if (!m) return -40;
    const d = +m[1];
    if (NHI_P60.has(d)) return 60;
    if (NHI_P35.has(d)) return 35;
    if ((d >= 89 && d <= 92) || d >= 97) return -40;
    return 0;
  }
  // SPEC 9.1 E3. Poisoning / adverse-effect T36-T78 and T88 deliberately get no trauma prior.
  function icdPrior(code) {
    const L = code.charAt(0), n = parseInt(code.slice(1, 3), 10);
    if (L === 'S') return (n <= 9 || (n >= 60 && n <= 69)) ? 80 : 60;
    if (L === 'T') {
      if ((n >= 20 && n <= 25) || (n >= 30 && n <= 32)) return 80;
      if ((n >= 7 && n <= 19) || n === 33 || n === 34 || n === 79 || n === 81 || (n >= 84 && n <= 87)) return 60;
      return 0;
    }
    if (L === 'L') return 60;
    if (L === 'V' || L === 'W' || L === 'X' || L === 'Y') return -40;
    if (L === 'C') { if (n >= 0 && n <= 14) return 60; if (n === 43 || n === 44) return 60; if (n === 50) return 35; return 0; }
    if (L === 'D') { if (n === 3 || n === 4 || n === 17 || n === 18 || n === 22 || n === 23) return 60; if (n === 5 || n === 24) return 35; return 0; }
    if (L === 'Q') return ((n >= 16 && n <= 18) || (n >= 35 && n <= 38) || (n >= 65 && n <= 79)) ? 35 : 0;
    if (L === 'M') return 35;
    if (L === 'G') return (n === 56 || n === 57) ? 35 : 0;
    if (L === 'N') return (n >= 60 && n <= 65) ? 35 : 0;
    if (L === 'H') return n === 2 ? 35 : 0;
    if (L === 'I') return (n === 70 || n === 73 || n === 83 || n === 87 || n === 89) ? 35 : 0;
    if (L === 'E') return (n >= 8 && n <= 13) ? 35 : 0;
    if (L === 'R') return n === 22 ? 35 : 0;
    return 0;
  }

  // ---------------------------------------------------------------- lexicon
  function buildLexicon(lex) {
    const map = new Map(), keyWords = new Set();
    function variants(k) {
      const v = [k], sp = k.replace(SEP_RE, ' ').replace(/\s+/g, ' ').trim(), rm = k.replace(SEP_RE, '');
      if (sp !== k) v.push(sp);
      if (rm !== k && rm !== sp) v.push(rm);
      return v;
    }
    function add(key, target, isG, isFirst) {
      if (!key || !target || key === target) return;
      const vs = variants(key);
      for (const v of vs) {
        if (v === target) continue;
        let s = map.get(v); if (!s) { s = []; map.set(v, s); }
        if (s.indexOf(target) < 0) s.push(target);
        if (isG) (s.g || (s.g = new Set())).add(target);
        if (isFirst) (s.first || (s.first = new Set())).add(target); // E9: the official wording listed first
      }
    }
    const nm = x => norm(x).replace(/\s+/g, ' ').trim();
    if (lex) {
      for (const g of lex.groups || []) {
        const ms = g.map(nm).filter(Boolean);
        for (const a of ms) for (const b of ms) if (a !== b) add(a, b, true);
      }
      const ow = lex.oneway || {};
      for (const k of Object.keys(ow)) ow[k].forEach((t, ix) => add(nm(k), nm(t), false, ix === 0 && ow[k].length > 1));
    }
    for (const k of map.keys()) if (/^[a-z]{4,}$/.test(k)) keyWords.add(k);
    const anat = ((lex && lex.anatomy) || []).map(nm).filter(Boolean);
    const prefer = new Map(); for (const k of Object.keys((lex && lex.prefer) || {})) prefer.set(nm(k), nm(lex.prefer[k]));
    return { prefer, map, keyWords: Array.from(keyWords).sort(), get: k => map.get(k) || null, anatLatin: new Set(anat.filter(a => !CJK_RE.test(a))), anatCjk: anat.filter(a => CJK_RE.test(a)).sort((a, b) => b.length - a.length) };
  }

  // Compile an expansion phrase into alternatives; an alternative = conjunction of atoms.
  // atom: {t:'w', s, qe, qp, pm}  (pm: 0 exact only, 1 any prefix, 2 plural only)  |  {t:'z', s, q}
  function compileExp(str, qe, qp, userMode) {
    const alts = [];
    if (CJK_RE.test(str)) {
      const parts = str.replace(/[^㐀-䶿a-z0-9一-鿿]+/g, ' ').trim().split(' ');
      const cjk = parts.filter(p => CJK_RE.test(p));
      if (cjk.length === 1 && parts.length === 1) { alts.push({ atoms: [{ t: 'z', s: cjk[0], q: qe }] }); return alts; }
      const atoms = [];
      for (const p of parts) atoms.push(CJK_RE.test(p) ? { t: 'z', s: p, q: qe } : mkWord(p, qe, qp, userMode));
      alts.push({ atoms }); return alts;
    }
    const words = str.match(/[a-z0-9]+/g) || [];
    if (!words.length) return alts;
    alts.push({ atoms: words.map(w => mkWord(w, qe, qp, userMode)) });
    if (words.length > 1 && /[a-z0-9][-.&'’][a-z0-9]/.test(str)) alts.push({ atoms: [mkWord(str.replace(SEP_RE, ''), qe, qp, userMode)] });
    return alts;
  }
  function mkWord(w, qe, qp, userMode) {
    // userMode 'u': exact + any prefix; 'x': lexicon (prefix only when >= 5 chars, else plural); 'f': exact only
    const pm = userMode === 'u' ? 1 : userMode === 'f' ? 0 : (w.length >= 5 ? 1 : 2);
    return { t: 'w', s: w, qe, qp, pm };
  }

  // ---------------------------------------------------------------- index store
  class IntBuf {
    constructor(c) { this.a = new Int32Array(c); this.n = 0; }
    push(v) { if (this.n === this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  }

  function* buildGen(kind, rowsIn, aliasMap) {
    const rows = rowsIn.slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    // drop duplicate codes (keep first)
    let n = 0;
    for (let i = 0; i < rows.length; i++) if (i === 0 || rows[i].code !== rows[i - 1].code) rows[n++] = rows[i];
    rows.length = n;
    const S = {
      kind, n, recs: rows, z: new Array(n), c: new Array(n),
      nw: new Uint8Array(n), zl: new Int16Array(n), ct: new Uint8Array(n), unsp: new Uint8Array(n), enc: new Int8Array(n), bill: new Uint8Array(n), prior: new Int8Array(n),
      descEnd: new Int32Array(n), pool: [], scratch: [], zcache: new Map(), zall: null, byLen: null, abbr: null
    };
    // descendants (ICD billable flag + alias propagation range)
    for (let i = 0; i < n; i++) {
      let j = i + 1; const c = rows[i].code;
      if (kind === 'icd') while (j < n && rows[j].code.startsWith(c)) j++;
      S.descEnd[i] = j;
      S.bill[i] = j === i + 1 ? 1 : 0;
      if (i % 4000 === 0) yield;
    }
    const wmap = new Map();
    const PW = new IntBuf(Math.max(1024, n * 6)), PR = new IntBuf(Math.max(1024, n * 6));
    const AW = new IntBuf(1024), AO = new IntBuf(1024);
    const abbrMap = kind === 'nhi' ? new Map() : null;
    function wid(w) { let id = wmap.get(w); if (id === undefined) { id = wmap.size; wmap.set(w, id); } return id; }
    for (let i = 0; i < n; i++) {
      const r = rows[i]; r.kind = kind;
      const en = norm(r.en), ex = [];
      let z = norm(r.zh);
      const words = enWords(en, ex);
      // E2: coverage is computed on the description without its encounter suffix, so the 7th-character
      // variants of one concept tie (the fixed A > D > S order is applied separately in collect()).
      const encAt = kind === 'icd' ? en.search(/, (?:initial encounter|subsequent encounter|sequela)/) : -1;
      S.nw[i] = Math.min(255, encAt > 0 ? enWords(en.slice(0, encAt)).length : words.length);
      const start = PW.n;
      const push = w => { const id = wid(w); for (let k = start; k < PW.n; k++) if (PW.a[k] === id) return; PW.push(id); PR.push(i); };
      for (let k = 0; k < words.length; k++) push(words[k]);
      for (let k = 0; k < ex.length; k++) push(ex[k]);
      if (kind === 'icd') {
        if (z.indexOf('未明示側性') >= 0) S.unsp[i] = 1;     // E1: only the laterality-unspecified variants are penalised
        if (encAt > 0) { const e = en.charAt(encAt + 2); S.enc[i] = e === 'i' ? ENC_PEN.A : e === 's' && en.charAt(encAt + 3) === 'u' ? ENC_PEN.D : ENC_PEN.S; }
      }
      if (kind === 'nhi') {
        const kw = r.kw ? norm(r.kw) : '';
        if (kw) {
          const astart = AW.n, ex2 = [];
          const ws = enWords(kw, ex2).concat(ex2);
          for (const w of ws) {
            const id = wid(w); let dup = false;
            for (let k = astart; k < AW.n; k++) if (AW.a[k] === id) { dup = true; break; }
            if (!dup) { AW.push(id); AO.push(i); }
            let l = abbrMap.get(w); if (!l) { l = []; abbrMap.set(w, l); } if (l[l.length - 1] !== i) l.push(i);
          }
          const cj = kw.match(/[㐀-䶿一-鿿]+/g);
          if (cj) z += ' ' + cj.join(' ');
        }
        S.prior[i] = nhiPrior(r.code); r.sect = sectionOf(r.code);
      } else {
        S.prior[i] = icdPrior(r.code); r.sect = ICD_SECT;
      }
      r.billable = S.bill[i] === 1;
      const zn = kind === 'icd' ? zhNeutral(z) : z;
      S.z[i] = zn !== z ? z + '\u0001' + zn : z; S.zl[i] = Math.min(32000, zn.length); S.c[i] = r.code.toLowerCase().replace(/\./g, '');
      if (i % 2000 === 0) yield;
    }
    if (aliasMap && kind === 'icd') {
      let cnt = 0; const codes = rows.map(r => r.code);
      for (const [code, terms] of aliasMap) {
        const o = lowerBound(codes, code);
        if (o >= n || codes[o] !== code) { if (++cnt % 500 === 0) yield; continue; }
        const astart = AW.n;
        for (const t of terms) {
          const ex = [], ws = enWords(norm(t), ex).concat(ex);
          for (const w of ws) {
            const id = wid(w); let dup = false;
            for (let k = astart; k < AW.n; k++) if (AW.a[k] === id) { dup = true; break; }
            if (!dup) { AW.push(id); AO.push(o); }
          }
        }
        if (++cnt % 500 === 0) yield;
      }
    }
    yield;
    // sorted vocabulary + CSR postings
    const words = Array.from(wmap.keys()); wmap.clear();
    const W2 = words.length, order = new Int32Array(W2);
    for (let i = 0; i < W2; i++) order[i] = i;
    const ordA = Array.from(order).sort((a, b) => (words[a] < words[b] ? -1 : words[a] > words[b] ? 1 : 0));
    const rank = new Int32Array(W2), V = new Array(W2);
    for (let i = 0; i < W2; i++) { rank[ordA[i]] = i; V[i] = words[ordA[i]]; }
    yield;
    function csr(wb, ob) {
      const start = new Int32Array(W2 + 1), len = wb.n;
      for (let k = 0; k < len; k++) start[rank[wb.a[k]] + 1]++;
      for (let i = 0; i < W2; i++) start[i + 1] += start[i];
      const fill = start.slice(0, W2), arr = new Int32Array(len);
      for (let k = 0; k < len; k++) arr[fill[rank[wb.a[k]]]++] = ob.a[k];
      return { start, arr };
    }
    const m = csr(PW, PR), a = csr(AW, AO);
    S.V = V; S.ps = m.start; S.pr = m.arr; S.aps = a.start; S.ao = a.arr;
    if (abbrMap) S.abbr = abbrMap;
    S.pool = []; S.scratch = [];
    return S;
  }
  const ICD_SECT = { id: '', label: '', toString() { return ''; } };

  // ---------------------------------------------------------------- engine
  function createEngine(cfg) {
    const lex = buildLexicon(cfg && cfg.lexicon);
    const stores = { nhi: null, icd: null };
    const expCache = new Map();
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

    function finishLoad(kind, S) { stores[kind] = S; }
    function load(kind, rows, opts) {
      const g = buildGen(kind, rows, opts && opts.aliases); let r;
      while (!(r = g.next()).done) { /* run to completion */ }
      finishLoad(kind, r.value);
    }
    async function loadAsync(kind, rows, opts) {
      const slice = (opts && opts.sliceMs) || 12;
      const g = buildGen(kind, rows, opts && opts.aliases); let t = now(), r;
      while (!(r = g.next()).done) {
        if (now() - t >= slice) { await new Promise(res => setTimeout(res, 0)); t = now(); }
      }
      finishLoad(kind, r.value);
    }
    function getRec(kind, code) {
      const S = stores[kind]; if (!S) return undefined;
      code = String(code).toUpperCase();
      let lo = 0, hi = S.n - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1, c = S.recs[m].code; if (c === code) return S.recs[m]; if (c < code) lo = m + 1; else hi = m - 1; }
      return undefined;
    }
    function poolArr(S, i) { while (S.pool.length <= i) S.pool.push(new Uint8Array(S.n)); return S.pool[i]; }
    function prefArr(S, i) { const P = S.ppool || (S.ppool = []); while (P.length <= i) P.push(new Uint8Array(S.n)); return P[i]; }
    function scratchArr(S, i) { while (S.scratch.length <= i) S.scratch.push(new Uint8Array(S.n)); return S.scratch[i]; }

    // ---- atom filling. Returns number of records that went from 0 to matched.
    function fillWord(S, a, arr) {
      const V = S.V, w = a.s; let hits = 0;
      const lo = lowerBound(V, w), hi = a.pm === 0 ? (V[lo] === w ? lo + 1 : lo) : lowerBound(V, w + '￿');
      const qa = (q) => (q < W.qAlias ? q : W.qAlias);
      for (let id = lo; id < hi; id++) {
        let q;
        if (id === lo && V[lo] === w) q = a.qe;
        else {
          const x = V[id], plural = x === w + 's' || x === w + 'es';
          if (a.pm === 2 && !plural) continue;
          q = plural ? a.qe : a.qp;
        }
        for (let k = S.ps[id], e = S.ps[id + 1]; k < e; k++) { const r = S.pr[k]; if (arr[r] < q) { if (!arr[r]) hits++; arr[r] = q; } }
        const aq = qa(q);
        for (let k = S.aps[id], e = S.aps[id + 1]; k < e; k++) {
          const o = S.ao[k], end = S.descEnd[o];
          for (let r = o; r < end; r++) if (arr[r] < aq) { if (!arr[r]) hits++; arr[r] = aq; }
        }
      }
      return hits;
    }
    // records whose zh contains s, cached per substring (the linear indexOf scan is the hot spot of Chinese queries)
    function zhHits(S, s) {
      let c = S.zcache.get(s);
      if (c) { S.zcache.delete(s); S.zcache.set(s, c); return c; }
      const z = S.z, tmp = []; 
      for (let i = 0, n = S.n; i < n; i++) if (z[i].indexOf(s) >= 0) tmp.push(i);
      c = Int32Array.from(tmp); S.zcache.set(s, c);
      if (S.zcache.size > 600) S.zcache.delete(S.zcache.keys().next().value);
      return c;
    }
    function fillZh(S, s, q, arr) {
      const h = zhHits(S, s); let hits = 0;
      for (let k = 0; k < h.length; k++) { const i = h[k]; if (arr[i] < q) { if (!arr[i]) hits++; arr[i] = q; } }
      return hits;
    }
    function fillAtom(S, a, arr) { return a.t === 'z' ? fillZh(S, a.s, a.q, arr) : fillWord(S, a, arr); }
    // fill one alternative (conjunction of atoms) into arr
    function fillAlt(S, alt, arr) {
      const at = alt.atoms;
      if (at.length === 1) return fillAtom(S, at[0], arr);
      const acc = scratchArr(S, 0), tmp = scratchArr(S, 1);
      acc.fill(0); fillAtom(S, at[0], acc);
      for (let k = 1; k < at.length; k++) {
        tmp.fill(0); fillAtom(S, at[k], tmp);
        for (let i = 0, n = S.n; i < n; i++) if (acc[i] > tmp[i]) acc[i] = tmp[i];
      }
      let hits = 0;
      for (let i = 0, n = S.n; i < n; i++) { const v = acc[i]; if (v && arr[i] < v) { if (!arr[i]) hits++; arr[i] = v; } }
      return hits;
    }
    function expAlts(str, qe, qp, mode) {
      const k = str + '\u0001' + qe + mode; let r = expCache.get(k);
      if (!r) { r = compileExp(str, qe, qp, mode); expCache.set(k, r); }
      return r;
    }

    // ---- query -> units
    // E6: two consecutive plain Latin tokens whose concatenation is a vocabulary word or a lexicon key
    // (le fort -> lefort, z plasty -> zplasty) also match that joined form, which outranks expansions.
    function joinedOf(S, a, b) {
      if (a.cjk || b.cjk || a.parts || b.parts) return null;
      const j = a.raw + b.raw;
      if (j.length < 4 || !/^[a-z0-9]+$/.test(j)) return null;
      const k = lowerBound(S.V, j);
      return (S.V[k] === j || lex.map.has(j)) ? j : null;
    }
    function makeUnits(S, tokens) {
      const units = [];
      for (let i = 0; i < tokens.length && units.length < MAX_UNITS;) {
        let done = false;
        // lexicon phrases (2..4 plain Latin tokens)
        for (let len = Math.min(4, tokens.length - i); len >= 2 && !done; len--) {
          const seg = tokens.slice(i, i + len);
          if (seg.some(t => t.cjk)) continue;
          const key = seg.map(t => t.raw).join(' ');
          const ex = lex.get(key);
          if (ex) {
            const u = newUnit(key, false, seg.map(t => t.raw), ex, seg);
            // a phrase also keeps the plain token-by-token reading (each token with its own expansions)
            u.parts = seg.map(t => newUnit(t.raw, false, [t.raw], lex.get(t.raw) || (t.joined && lex.get(t.joined)) || null, [t]));
            if (len === 2) { const j = joinedOf(S, seg[0], seg[1]); if (j) addJoined(u, j); }
            units.push(u);
            i += len; done = true;
          }
        }
        if (done) continue;
        const t = tokens[i++];
        const nx = tokens[i], j = nx ? joinedOf(S, t, nx) : null;
        if (j) { // joined reading + the plain two-token reading
          const seg = [t, nx];
          const u = newUnit(t.raw + ' ' + nx.raw, false, [t.raw, nx.raw], lex.get(j) || null, seg);
          u.parts = seg.map(x => newUnit(x.raw, false, [x.raw], lex.get(x.raw) || null, [x]));
          addJoined(u, j); units.push(u); i++;
          continue;
        }
        const ex = lex.get(t.raw) || (t.joined && lex.get(t.joined)) || null;
        units.push(newUnit(t.raw, t.cjk, [t.raw], ex, [t]));
      }
      return units;
    }
    function addJoined(u, j) {
      u.lit.push({ atoms: [mkWord(j, W.qExact + W.qJoin, W.qPrefix, 'u')] });
      u.joined = j;
    }
    function newUnit(label, cjk, words, ex, seg) {
      const u = { label, cjk, words, lit: [], lex: [], exs: ex || [], simple: null, fuzzOk: false, fuzzy: [], q: null, pq: null, pidx: 0, df: 0, joined: null, zs: null };
      if (cjk) u.lit.push({ atoms: [{ t: 'z', s: words[0], q: W.qExact }] });
      else {
        const mk = w => mkWord(w, W.qExact, W.qPrefix, w.length <= 1 ? 'f' : 'u');
        if (seg.length === 1) {
          const t = seg[0];
          if (t.parts) { u.lit.push({ atoms: t.parts.map(mk) }, { atoms: [mkWord(t.joined, W.qExact, W.qPrefix, t.joined.length >= 4 ? 'u' : 'f')] }); u.simple = [t.joined]; }
          else { u.lit.push({ atoms: [mk(t.raw)] }); u.simple = [t.raw]; u.fuzzOk = /^[a-z]{4,}$/.test(t.raw); }
        } else {
          // phrase: conjunction of every token (compound tokens use their split parts)
          u.lit.push({ atoms: [].concat(...seg.map(t => (t.parts ? t.parts : [t.raw]).map(mk))) });
        }
      }
      // a lone CJK anatomy character (手) is weaker than its official multi-char form (手部)
      const oneCjk = cjk && words[0].length === 1 && u.exs.some(e => CJK_RE.test(e) && e.length >= 2);
      if (oneCjk) u.lit[0].atoms[0].q = W.qLex;
      // E4: the preferred target (lexicon "prefer") is flagged, not weighted: collect() adds a flat W.prefer to such records.
      // E9: the first target of an ordered one-way entry gets +W.qFirst.
      for (const e of u.exs) {
        let q = (ex.g && ex.g.has(e)) || oneCjk ? W.qLexG : W.qLex;
        if (ex.first && ex.first.has(e)) q += W.qFirst;
        const pref = lex.prefer.get(label) === e;
        for (const a of expAlts(e, q, q, 'x')) u.lex.push({ alt: a, src: e, pref, q });
      }
      // morphology: "<site>癌" is written "<site>…惡性腫瘤" in the official Chinese ICD text
      if (cjk && words[0].length >= 2 && words[0].length <= 8 && words[0].endsWith('癌')) {
        const site = words[0].slice(0, -1);
        u.lex.push({ alt: { atoms: [{ t: 'z', s: site, q: W.qLex }, { t: 'z', s: '惡性腫瘤', q: W.qLex }] }, src: site + '惡性腫瘤', pref: false, q: W.qLex });
      }
      // morphology: "<X>斷裂" -> X + the preferred target of 斷裂 (e.g. 肌腱斷裂 -> 肌腱 + 撕裂傷)
      if (cjk) for (const [pk, pt] of lex.prefer) {
        if (CJK_RE.test(pk) && words[0].length > pk.length && words[0].endsWith(pk)) {
          u.lex.push({ alt: { atoms: [{ t: 'z', s: words[0].slice(0, -pk.length), q: W.qLexG }, { t: 'z', s: pt, q: W.qLex }] }, src: words[0].slice(0, -pk.length) + pt, pref: true, q: W.qLex });
        }
      }
      // morphology: "<右|左|雙><site>" -> official "<右側|左側|雙側>" + site (zh) / right|left|bilateral + site (en)
      const lm = cjk && /^([右左雙])(.{1,4})$/.exec(words[0]);
      if (lm) {
        const latZh = lm[1] + '側', latEn = { 右: 'right', 左: 'left', 雙: 'bilateral' }[lm[1]], rest = lm[2];
        const rv = [rest].concat(lex.get(rest) || []);
        for (const r of rv) {
          if (CJK_RE.test(r)) { if (r.length >= 2 || r === rest) u.lex.push({ alt: { atoms: [{ t: 'z', s: latZh, q: W.qLexG }, { t: 'z', s: r, q: r.length < 2 && rv.some(x => x.length >= 2 && CJK_RE.test(x)) ? W.qLex : W.qLexG }] }, src: latZh + r, pref: false, q: W.qLexG }); }
          else for (const a of expAlts(r, W.qLexG, W.qLexG, 'x')) u.lex.push({ alt: { atoms: [mkWord(latEn, W.qLexG, W.qLexG, 'f')].concat(a.atoms) }, src: latEn + ' ' + r, pref: false, q: W.qLexG });
        }
      }
      if (u.simple) for (const e of u.exs) if (/^[a-z0-9]+$/.test(e)) u.simple.push(e);
      // zh strings of the unit (for E5 pair adjacency in the Chinese description)
      const zs = []; if (cjk) zs.push(words[0]);
      for (const e of u.exs) if (/^[㐀-䶿一-鿿]+$/.test(e)) zs.push(e);
      u.zs = zs;
      return u;
    }

    // ---- chunk matching for Chinese tokens (<= 4 pieces, pieces >= 2 chars or an allowed single char)
    function chunkFill(S, u, arr) {
      const T = u.words[0], L = T.length; if (L < 2 || L > 24) return 0;
      if (!S.zall) S.zall = S.z.join('\n');
      const starts = []; for (let i = 0; i < L; i++) starts.push([]);
      const present = new Map();
      const has = s => { let v = present.get(s); if (v === undefined) { v = S.zall.indexOf(s) >= 0; present.set(s, v); } return v; };
      for (let i = 0; i < L; i++) for (let j = i + 1; j <= L; j++) {
        const s = T.slice(i, j);
        if (j - i === 1 && SINGLES.indexOf(s) < 0) continue;
        const strs = [];
        if (has(s)) strs.push(s);
        if (j - i >= 2) for (const e of lex.get(s) || []) if (CJK_RE.test(e) && !/[a-z]/.test(e) && has(e)) strs.push(e);
        if (strs.length) starts[i].push({ j, strs });
      }
      // feasibility (global)
      const best = new Array(L + 1).fill(99); best[0] = 0;
      for (let i = 0; i < L; i++) if (best[i] < 99) for (const p of starts[i]) if (best[i] + 1 < best[p.j]) best[p.j] = best[i] + 1;
      if (best[L] > 4) return 0;
      // rarest-position prefilter
      const cover = []; for (let p = 0; p < L; p++) cover.push([]);
      for (let i = 0; i < L; i++) for (const pc of starts[i]) for (const s of pc.strs) for (let p = i; p < pc.j; p++) cover[p].push(s);
      let pmin = 0; for (let p = 1; p < L; p++) if (cover[p].length < cover[pmin].length) pmin = p;
      const first = Array.from(new Set(cover[pmin])), z = S.z; let hits = 0;
      const dp = new Array(L + 1);
      for (let r = 0, n = S.n; r < n; r++) {
        const zz = z[r]; let ok = false;
        for (let k = 0; k < first.length; k++) if (zz.indexOf(first[k]) >= 0) { ok = true; break; }
        if (!ok) continue;
        dp.fill(99); dp[0] = 0;
        for (let i = 0; i < L; i++) {
          if (dp[i] >= 4) continue;
          for (const pc of starts[i]) {
            if (dp[i] + 1 >= dp[pc.j]) continue;
            for (let k = 0; k < pc.strs.length; k++) if (zz.indexOf(pc.strs[k]) >= 0) { dp[pc.j] = dp[i] + 1; break; }
          }
        }
        if (dp[L] <= 4 && arr[r] < W.qChunk) { if (!arr[r]) hits++; arr[r] = W.qChunk; }
      }
      return hits;
    }

    // ---- fuzzy: Damerau-Levenshtein vs vocabulary + lexicon keys
    function fuzzyCands(S, w) {
      const L = w.length, d = L >= 9 ? 2 : 1;
      if (!S.byLen) {
        S.byLen = new Map();
        for (let i = 0; i < S.V.length; i++) { const l = S.V[i].length; let a = S.byLen.get(l); if (!a) { a = []; S.byLen.set(l, a); } a.push(i); }
      }
      const out = [];
      for (let l = L - d; l <= L + d; l++) {
        const ids = S.byLen.get(l); if (!ids) continue;
        for (let k = 0; k < ids.length; k++) {
          const id = ids[k], x = S.V[id];
          if (x === w) continue;
          const dist = dl(w, x, d);
          if (dist <= d) out.push({ w: x, dist, df: (S.ps[id + 1] - S.ps[id]) + (S.aps[id + 1] - S.aps[id]), key: false });
        }
      }
      for (const k of lex.keyWords) {
        if (Math.abs(k.length - L) > d || k === w) continue;
        const dist = dl(w, k, d);
        if (dist <= d && !out.some(o => o.w === k)) out.push({ w: k, dist, df: 1, key: true });
      }
      out.sort((a, b) => a.dist - b.dist || b.df - a.df || (a.w < b.w ? -1 : 1));
      return out.slice(0, 3);
    }

    // ---- fill one unit into q (a dense Uint8Array). Returns true when anything matched.
    function fillUnit(S, u, q, notes, forceFuzzy) {
      u.fuzzy = []; u.pq = null;
      let litHits = 0;
      for (const alt of u.lit) litHits += fillAlt(S, alt, q);
      if (u.parts) { // phrase: token-by-token reading = AND (min) of the sub-units
        const subs = [];
        for (let j = 0; j < u.parts.length; j++) { u.parts[j].pidx = MAX_UNITS + j; const sq = poolArr(S, MAX_UNITS + j); sq.fill(0); fillUnit(S, u.parts[j], sq, notes, forceFuzzy); subs.push(sq); }
        for (let i = 0, n = S.n; i < n; i++) {
          let m = 255; for (let j = 0; j < subs.length; j++) { const v = subs[j][i]; if (v < m) m = v; }
          if (m && q[i] < m) { if (!q[i]) litHits++; q[i] = m; }
        }
        for (const pu of u.parts) if (pu.pq) { // a preferred target hit inside the phrase reading counts for the phrase
          if (!u.pq) { u.pq = prefArr(S, u.pidx); u.pq.fill(0); }
          for (let i = 0, n = S.n; i < n; i++) if (pu.pq[i]) u.pq[i] = 1;
        }
      }
      // E10: a literal match of the typed word is never worse than any (non-preferred) lexicon expansion of it
      if (litHits) {
        let top = 0; for (const le of u.lex) if (!le.pref && le.q > top) top = le.q;
        // (lifts word-prefix matches only: exact stays above every expansion, alias/chunk/fuzzy are not "the typed word")
        if (top) for (let i = 0, n = S.n; i < n; i++) { const v = q[i]; if (v >= W.qPrefix && v < top) q[i] = top; }
      }
      let lexHits = 0, firstLex = null;
      for (const le of u.lex) {
        let h;
        if (le.pref) { // E4: remember which records matched through the preferred target
          const tmp = poolArr(S, PREF_TMP); tmp.fill(0); fillAlt(S, le.alt, tmp);
          if (!u.pq) { u.pq = prefArr(S, u.pidx); u.pq.fill(0); }
          h = 0;
          for (let i = 0, n = S.n; i < n; i++) { const v = tmp[i]; if (!v) continue; u.pq[i] = 1; if (q[i] < v) { if (!q[i]) h++; q[i] = v; } }
        } else h = fillAlt(S, le.alt, q);
        if (h && !firstLex) firstLex = le.src; lexHits += h;
      }
      let any = litHits + lexHits > 0;
      if (u.cjk && !any) any = chunkFill(S, u, q) > 0;
      if (lexHits && !litHits && firstLex) notes.push({ type: 'syn', from: u.label, to: firstLex });
      if (u.fuzzOk && (!any || forceFuzzy)) {
        const cands = fuzzyCands(S, u.words[0]);
        if (cands.length) {
          let got = 0, first = null;
          for (const c of cands) {
            let h = 0;
            if (c.key) { for (const e of lex.get(c.w) || []) for (const a of expAlts(e, W.qFuzzy, W.qFuzzy, 'f')) h += fillAlt(S, a, q); }
            h += fillAlt(S, { atoms: [mkWord(c.w, W.qFuzzy, W.qFuzzy, 'f')] }, q);
            if (h && !first) first = c.w;
            got += h; u.fuzzy.push(c.w);
          }
          if (got && !any) { notes.push({ type: 'fix', from: u.label, to: first, alts: cands.map(c => c.w) }); any = true; }
        }
      }
      return any;
    }
    // ---- fill all units. forceFuzzy: retry mode (fuzzy for every Latin token >= 4 letters)
    function fillUnits(S, units, notes, forceFuzzy) {
      for (let ui = 0; ui < units.length; ui++) {
        const u = units[ui], q = poolArr(S, ui); q.fill(0); u.q = q; u.pidx = ui;
        fillUnit(S, u, q, notes, forceFuzzy);
        let df = 0; for (let i = 0, n = S.n; i < n; i++) if (q[i]) df++;
        u.df = df;
      }
    }

    // ---- terms for highlighting
    function termsOf(units) {
      const set = new Set();
      for (const u of units) {
        for (const w of u.words) set.add(w);
        for (const t of u.simple || []) set.add(t);
        for (const e of u.exs) set.add(e);
        if (u.joined) set.add(u.joined);
        for (const f of u.fuzzy || []) set.add(f);
      }
      return Array.from(set).filter(t => t && (CJK_RE.test(t) ? t.length >= 1 : t.length >= 2)).slice(0, 40);
    }

    // ---- adjacency: (a) all-tokens bonus graded by the longest in-order adjacent run (needs plain units),
    //      (b) E5: +W.pair for every pair of consecutive query units found adjacent, in order, in en or zh (after expansion)
    function adjacency(S, rec, idx, us, qz) {
      // consecutive query TOKENS (a phrase / joined unit contributes its own tokens)
      const units = us._flat || (us._flat = [].concat(...us.map(u => (u.parts ? u.parts : [u]))));
      const U = units.length;
      if (U < 2) return 0;
      if (units.every(u => u.cjk)) { // pure Chinese query: whole-run substring + each adjacent pair (words/expansions)
        const z = S.z[idx]; let b = z.indexOf(qz) >= 0 ? W.adj : 0;
        for (let k = 0; k + 1 < U; k++) if (pairZh(z, units[k], units[k + 1])) b += W.pair;
        return b;
      }
      if (!rec._ew) rec._ew = enWords(norm(rec.en).replace(/['’]s\b/g, '')).filter(w => !STOP.has(w)); // stop-words and possessive 's (Bell's palsy) never break adjacency
      const ew = rec._ew, z = S.z[idx];
      const at = (u, p) => { if (p >= ew.length) return false; const w = ew[p]; for (const s of u.simple) if (w.startsWith(s)) return true; return false; };
      let bonus = 0;
      if (units.every(u => u.simple)) {
        let bestOk = 0;
        for (let p = 0; p < ew.length; p++) {
          if (!at(units[0], p)) continue;
          let run = 0;
          for (let k = 1; k < U; k++) { if (at(units[k], p + k)) run++; else break; }
          if (run > bestOk) bestOk = run;
        }
        bonus += Math.round(W.adj * bestOk / (U - 1));
      }
      for (let k = 0; k + 1 < U; k++) {
        const a = units[k], b = units[k + 1]; let hit = false;
        if (a.simple && b.simple) for (let p = 0; p + 1 < ew.length && !hit; p++) if (at(a, p) && at(b, p + 1)) hit = true;
        if (!hit && pairZh(z, a, b)) hit = true;
        if (hit) bonus += W.pair;
      }
      return bonus;
    }
    function pairZh(z, a, b) {
      if (!a.zs.length || !b.zs.length) return false;
      // 閉鎖性/開放性 (closed/open) sits between site and fracture only in the A/B encounter variants: ignore it (E2 neutrality)
      if (z.indexOf('閉鎖性') >= 0 || z.indexOf('開放性') >= 0) z = z.replace(/閉鎖性|開放性/g, '');
      for (const x of a.zs) for (const y of b.zs) if (z.indexOf(x + y) >= 0) return true;
      return false;
    }

    // ---- search
    const EMPTY = () => ({ rows: [], total: 0, notes: [] });
    function search(kind, query, opts) {
      try { return compound(kind, query, opts || {}); } catch (e) { return EMPTY(); }
    }
    // ---- compound queries (SPEC 8.1): single concept first, then split at connectors with context carry-over
    const CONN_LATIN = /(?:^|\s)(?:with|w\/|and|&|\+)(?=\s|$)|[,;]/g;
    const CONN_CJK = /合併|併有|伴有|併|伴|及|和|與/g;
    const LAT_WORDS = { right: 'right', rt: 'right', left: 'left', lt: 'left', bilateral: 'bilateral', bil: 'bilateral', bilat: 'bilateral' };
    function laterality(part) {
      const m = /(?:^|[^a-z])(right|rt|left|lt|bilateral|bilat|bil)(?![a-z])/.exec(part);
      if (m) return m[1];
      if (/右/.test(part)) return '右';
      if (/左/.test(part)) return '左';
      if (/雙/.test(part)) return '雙';
      return '';
    }
    function anatomyOf(part) {
      const out = [];
      for (const w of part.match(/[a-z]+/g) || []) if (lex.anatLatin.has(w)) out.push(w);
      for (const a of lex.anatCjk) if (part.indexOf(a) >= 0 && !out.some(o => o.indexOf(a) >= 0)) out.push(a);
      return out;
    }
    // "右手壓砸傷" -> "右 手 壓砸傷" (laterality, anatomy, rest) so each concept is matched on its own
    function spaceCjk(t) {
      t = t.replace(/^([右左雙])/, '$1 ');
      const m = /^([右左雙] )?(.*)$/.exec(t); let rest = m[2];
      for (const a of lex.anatCjk) if (rest.startsWith(a) && rest.length > a.length) { rest = a + ' ' + rest.slice(a.length); break; }
      return (m[1] || '') + rest;
    }
    function compound(kind, query, opts) {
      const qn = norm(query).trim();
      const hasLat = CONN_LATIN.test(qn); CONN_LATIN.lastIndex = 0;
      const hasCjk = CONN_CJK.test(qn); CONN_CJK.lastIndex = 0;
      if (!qn || (!hasLat && !hasCjk)) return searchImpl(kind, query, opts);
      const wholeQ = qn.replace(CONN_LATIN, ' ').replace(CONN_CJK, ' ');
      // first pass without the partial fallback (cheap); only needed again if the split yields nothing
      let whole = searchImpl(kind, wholeQ, Object.assign({}, opts, { noPartial: true }));
      if (whole.rows.length) return whole;
      const wholeFull = () => (whole = searchImpl(kind, wholeQ, opts));
      const parts = qn.replace(CONN_LATIN, '|').replace(CONN_CJK, '|').split('|').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
      if (parts.length < 2) return wholeFull();
      const lats = parts.map(laterality), ans = parts.map(anatomyOf);
      const limit = opts.limit > 0 ? opts.limit : 300, res = [];
      for (let i = 0; i < parts.length; i++) {
        let lat = lats[i], anat = ans[i];
        const order = []; for (let d = 1; d < parts.length; d++) { if (i - d >= 0) order.push(i - d); if (i + d < parts.length) order.push(i + d); }
        // earlier parts first, then later ones, nearest first
        order.sort((a, b) => (a < i ? 0 : 1) - (b < i ? 0 : 1) || Math.abs(a - i) - Math.abs(b - i));
        if (!lat) for (const j of order) if (lats[j]) { lat = lats[j]; break; }
        let inh = [];
        if (!anat.length) for (const j of order) if (ans[j].length) { inh = ans[j]; break; }
        const cjkRun = CJK_RE.test(parts[i]) && !/ /.test(parts[i]);
        const sep = cjkRun ? '' : ' ';
        const own = lats[i] ? '' : lat;
        const tries = [];
        if (own || inh.length) tries.push([own, inh.join(sep)].filter(Boolean));
        if (own && inh.length) tries.push([own]);
        tries.push([]);
        let pick = null, fallback = null;
        for (let ti = 0; ti < tries.length; ti++) {
          const t = tries[ti];
          const label = (t.length ? t.join(sep) + sep : '') + parts[i];
          const r = searchImpl(kind, cjkRun ? spaceCjk(label) : label, Object.assign({}, opts, { limit, noPartial: ti < tries.length - 1 }));
          if (r.rows.length) {
            if (!fallback) fallback = { label, r };
            if (r.rows.some(x => x.via !== 'partial')) { pick = { label, r }; break; }
          }
        }
        pick = pick || fallback;
        if (pick) res.push({ label: pick.label, query: pick.label, rows: pick.r.rows, total: pick.r.total, notes: pick.r.notes });
      }
      if (!res.length) return wholeFull();
      if (res.length === 1) return Object.assign({}, whole.rows.length ? whole : { rows: res[0].rows, total: res[0].total, notes: res[0].notes });
      const seen = new Set(), rows = [];
      for (let k = 0; rows.length < limit; k++) {
        let any = false;
        for (const p of res) if (k < p.rows.length) { any = true; const c = p.rows[k].rec.code; if (!seen.has(c)) { seen.add(c); rows.push(p.rows[k]); if (rows.length >= limit) break; } }
        if (!any) break;
      }
      const notes = [].concat(...res.map(p => p.notes), [{ type: 'split', labels: res.map(p => p.label) }]);
      return { rows, total: res.reduce((a, p) => a + p.total, 0), notes, parts: res.map(p => ({ label: p.label, query: p.query, rows: p.rows, total: p.total })) };
    }
    function tokenize(qn) {
      let s = qn.replace(/([㐀-䶿一-鿿])(?=[a-z0-9])/g, '$1 ').replace(/([a-z0-9])(?=[㐀-䶿一-鿿])/g, '$1 ');
      s = s.replace(/[^a-z0-9㐀-䶿一-鿿\-.&'’]+/g, ' ');
      const out = [];
      for (let t of s.split(' ')) {
        t = t.replace(/^[-.&'’]+|[-.&'’]+$/g, ''); if (!t) continue;
        if (CJK_RE.test(t)) {
          // a CJK run (may contain stray separators): keep contiguous CJK pieces
          for (const p of t.split(/[-.&'’]+/)) if (p) out.push({ raw: p, cjk: true });
        } else if (/[-.&'’]/.test(t)) {
          const parts = t.split(/[-.&'’]+/).filter(Boolean);
          out.push({ raw: t, cjk: false, parts, joined: parts.join('') });
        } else out.push({ raw: t, cjk: false });
      }
      return out;
    }
    function searchImpl(kind, query, opts) {
      const S = stores[kind]; if (!S) return EMPTY();
      const qn0 = norm(query).trim(); if (!qn0) return EMPTY();
      const qn = qn0.length > 200 ? qn0.slice(0, 200) : qn0;
      const limit = opts.limit > 0 ? opts.limit : 300, boost = typeof opts.boost === 'function' ? opts.boost : null;
      let toks = tokenize(qn);
      const kept = toks.filter(t => t.cjk || !STOP.has(t.raw));
      if (kept.length) toks = kept;
      const n = S.n, notes = [];
      // code / abbreviation tiers (whole query)
      const qc = qn.replace(/[.\s]/g, ''), hasSpace = /\s/.test(qn);
      let cs = null, cv = null;
      const codeLike = /^[a-z]\d[a-z0-9]*$/.test(qc) || /^\d{2,5}[a-z]?$/.test(qc);
      if (!hasSpace && /^[a-z0-9]+$/.test(qc) && /\d/.test(qc)) {
        cs = S.cs || (S.cs = new Int32Array(n)); cv = S.cv || (S.cv = new Uint8Array(n)); cs.fill(0); cv.fill(0); S.ct.fill(0);
        for (let i = 0; i < n; i++) {
          const c = S.c[i]; let v = 0;
          if (c === qc) { v = W.codeExact + (codeLike ? W.codeLikeBonus : 0); S.ct[i] = 1; }
          else if (c.startsWith(qc)) { v = W.codePrefix + (codeLike ? W.codeLikeBonus : 0); S.ct[i] = 1; }
          else if (qc.length >= 2 && c.indexOf(qc) > 0) v = W.codeContains;
          if (v) { cs[i] = v; cv[i] = 1; }
        }
      }
      if (S.abbr && !hasSpace) {
        const qa = qn.replace(/[-.&'’]/g, '');
        if (qa && /^[a-z0-9]+$/.test(qa)) {
          if (!cs) { cs = S.cs || (S.cs = new Int32Array(n)); cv = S.cv || (S.cv = new Uint8Array(n)); cs.fill(0); cv.fill(0); S.ct.fill(0); }
          const ex = S.abbr.get(qa);
          if (ex) for (const i of ex) { cs[i] += W.abbrExact; if (!cv[i]) cv[i] = 2; }
          if (qa.length >= 3) for (const [w, l] of S.abbr) if (w !== qa && w.indexOf(qa) >= 0) for (const i of l) { if (cs[i] < W.abbrContains) { cs[i] += W.abbrContains; if (!cv[i]) cv[i] = 2; } }
        }
      }
      // text tier
      let units = toks.length ? makeUnits(S, toks) : [];
      const qz = qn.replace(/[^㐀-䶿一-鿿]/g, '');
      const asksUnsp = /unsp|未明示/.test(qn), asksEnc = /sequela|subsequent|late effect|後遺|後續|subseq/.test(qn);
      let mode = 'text', dropped = null;
      let active = units;
      if (units.length) fillUnits(S, units, notes, false);
      let res = units.length ? collect(S, units, cs, cv, W.text, 'text', limit, boost, asksUnsp, qn, qz, toks, asksEnc) : null;
      if ((!res || res.total === 0) && units.length) {
        // fallback (i): fuzzy for every Latin token >= 4 letters
        const hadFuzzy = units.some(u => u.fuzzOk);
        notes.length = 0;
        if (hadFuzzy) {
          fillUnits(S, units, notes, true);
          res = collect(S, units, cs, cv, W.text, 'text', limit, boost, asksUnsp, qn, qz, toks, asksEnc);
        }
        if ((!res || res.total === 0) && units.length >= 2 && !opts.noPartial) {
          // fallback (ii): partial (E7) — union of every drop-one variant (all tokens but one), ranked by score.
          // Units that matched nothing anywhere are dropped together (a single variant) when that leaves something.
          const zero = units.filter(u => u.df === 0);
          const variants = [], used = new Set();
          if (zero.length && zero.length < units.length) {
            const v = []; units.forEach((u, k) => { if (u.df > 0) v.push(k); else used.add(k); });
            variants.push(v);
          } else if (!zero.length) {
            for (let k = 0; k < units.length; k++) {
              const v = []; for (let j = 0; j < units.length; j++) if (j !== k) v.push(j);
              if (countAnd(S, v.map(j => units[j])) > 0) { variants.push(v); used.add(k); }
            }
          }
          if (variants.length) {
            // specificity: a variant that KEEPS the rarer (more specific) tokens outranks one that keeps only common
            // ones — "paronychia rt thumb" should drop "thumb", not "paronychia".
            variants.bonus = variants.map(v => { let b = 0; for (const j of v) b += Math.log10(S.n / (units[j].df + 1)); return Math.round(60 * b); });
            dropped = units.filter((_, k) => used.has(k)).map(u => u.label);
            res = collect(S, units, cs, cv, W.partial, 'partial', limit, boost, asksUnsp, qn, qz, toks, asksEnc, variants);
            notes.push({ type: 'partial', dropped });
          }
        }
        if (!res) res = { rows: [], total: 0 };
      }
      if (!res) {
        // no text units: only the code tier can produce rows
        res = collect(S, [], cs, cv, W.text, 'text', limit, boost, asksUnsp, qn, qz, toks, asksEnc);
      }
      const terms = termsOf(units);
      for (const r of res.rows) r.terms = terms;
      return { rows: res.rows, total: res.total, notes };
    }
    function countAnd(S, us) {
      let c = 0;
      for (let i = 0, n = S.n; i < n; i++) { let ok = true; for (let k = 0; k < us.length; k++) if (!us[k].q[i]) { ok = false; break; } if (ok) c++; }
      return c;
    }

    // ---- collect: AND the active units, score, select top window, adjacency + boost, final sort
    function collect(S, us, cs, cv, base, viaText, limit, boost, asksUnsp, qn, qz, toks, asksEnc, variants) {
      const n = S.n, U = us.length;
      const OFF = 3000, RANGE = 16000;
      const hist = new Int32Array(RANGE);
      const sc = S.sc || (S.sc = new Int32Array(n)), flag = S.flag || (S.flag = new Uint8Array(n));
      flag.fill(0);
      let total = 0;
      const latinTok = toks.filter(t => !t.cjk).length, cjkLen = qz.length, onlyOne = U === 1 && us[0].lit.length > 0;
      const zhWhole = cjkLen > 0 && U > 0 && toks.every(t => t.cjk);
      for (let i = 0; i < n; i++) {
        const c = cs ? cs[i] : 0;
        if (c && S.ct[i]) { // E8: the code tier is pure code order (exact first, then ascending) — no adjustments
          total++; sc[i] = c; flag[i] = 2;
          let h = c + OFF; if (h >= RANGE) h = RANGE - 1; hist[h]++;
          continue;
        }
        let ok = U > 0, sumQ = 0;
        if (variants) { // E7: record satisfies at least one drop-one variant; its best variant gives the quality sum
          ok = false;
          for (let vi = 0; vi < variants.length; vi++) {
            const vv = variants[vi]; let sq = 0, g = true;
            for (let k = 0; k < vv.length; k++) { const x = us[vv[k]].q[i]; if (!x) { g = false; break; } sq += x; }
            if (g) sq += (variants.bonus && variants.bonus[vi]) || 0;
            if (g && sq > sumQ) { ok = true; sumQ = sq; }
          }
        } else for (let k = 0; k < U; k++) { const v = us[k].q[i]; if (!v) { ok = false; break; } sumQ += v; }
        if (!ok && !c) continue;
        total++;
        let s = c;
        if (ok) {
          s += base + sumQ;
          const nw = S.nw[i];
          let cov = 0;
          if (latinTok) cov = nw ? Math.min(1, latinTok / nw) : 0;
          if (cjkLen) { const zl = S.zl[i]; if (zl) cov = Math.max(cov, Math.min(1, cjkLen / zl)); }
          s += Math.round(W.cover * cov);
          if (onlyOne && !us[0].cjk && us[0].q[i] === W.qExact && us[0].lit[0].atoms.length === 1 && latinTok === 1 && !us[0].lex.some(le => le.pref)) s += W.exactWord; // (a word with a preferred target is not an exact-word query)
          if (zhWhole && (S.z[i].indexOf(qz) >= 0 || (U === 1 && us[0].q[i] >= W.qLexG))) s += W.zhSubstr;
          for (let k = 0; k < U; k++) if (us[k].pq && us[k].pq[i]) { s += W.prefer; break; } // E4: flat preferred-target bonus
        }
        s += S.prior[i];
        if (!S.bill[i] && !(c && cv[i] === 1)) { s += W.header; flag[i] = 1; }
        if (S.unsp[i] && !asksUnsp) s += W.unsp;
        if (S.enc[i] && !asksEnc) s += S.enc[i];
        sc[i] = s;
        let h = s + OFF; if (h < 0) h = 0; else if (h >= RANGE) h = RANGE - 1;
        hist[h]++;
        flag[i] |= 2; // candidate
      }
      if (!total) return { rows: [], total: 0 };
      // top window via histogram threshold
      const M = Math.max(TOP_WINDOW, limit * 3);
      let thr = RANGE - 1, acc = 0;
      while (thr > 0 && acc + hist[thr] < M) { acc += hist[thr]; thr--; }
      thr -= OFF;
      const cand = [];
      let ties = 0;
      for (let i = 0; i < n; i++) {
        if (!(flag[i] & 2)) continue;
        const s = sc[i];
        if (s > thr || (s === thr && ties < M)) { cand.push(i); if (s === thr) ties++; }
      }
      // boost, then adjacency on the best of them
      const items = cand.map(i => ({ i, s: sc[i] + (boost ? Math.max(0, Number(boost(S.recs[i].code)) || 0) : 0), h: flag[i] & 1 }));
      const cmp = (a, b) => (a.h - b.h) || (b.s - a.s) || (a.i - b.i);
      items.sort(cmp);
      if (U >= 2 || us.some(u => u.parts)) {
        const win = Math.min(items.length, Math.max(limit + 100, 400));
        for (let k = 0; k < win; k++) { const it = items[k]; it.s += adjacency(S, S.recs[it.i], it.i, us, qz); }
        const head = items.slice(0, win).sort(cmp);
        for (let k = 0; k < win; k++) items[k] = head[k];
      }
      const rows = [];
      for (let k = 0; k < items.length && rows.length < limit; k++) {
        const it = items[k], i = it.i;
        let via;
        if (cs && cs[i]) via = cv[i] === 2 ? 'abbr' : 'code';
        else if (viaText === 'partial') via = 'partial';
        else { via = 'text'; for (let u = 0; u < U; u++) if (us[u].q[i] === W.qAlias) { via = 'alias'; break; } }
        rows.push({ rec: S.recs[i], score: it.s, via, terms: null });
      }
      return { rows, total };
    }

    // number of records a lexicon phrase hits (as an expansion target; no lexicon applied) — used by tools/validate_lexicon.js
    function probe(kind, phrase) {
      const S = stores[kind]; if (!S) return 0;
      const q = poolArr(S, 0); q.fill(0); let h = 0;
      for (const a of expAlts(norm(phrase).replace(/\s+/g, ' ').trim(), W.qLex, W.qLex, 'x')) h += fillAlt(S, a, q);
      return h;
    }

    return {
      load, loadAsync, probe,
      ready: kind => !!stores[kind],
      size: kind => (stores[kind] ? stores[kind].n : 0),
      get: getRec,
      search,
      _stores: stores
    };
  }

  // ---------------------------------------------------------------- highlight
  function highlight(text, terms) {
    text = text == null ? '' : String(text);
    const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (!terms || !terms.length || !text) return esc(text);
    const low = text.toLowerCase();
    if (low.length !== text.length) return esc(text);
    const iv = [];
    const ts = Array.from(new Set(terms.map(t => String(t).toLowerCase()).filter(t => t))).slice(0, 60);
    for (const t of ts) {
      const latin = /^[a-z0-9]/.test(t);
      let p = 0;
      while ((p = low.indexOf(t, p)) >= 0) {
        if (!latin || p === 0 || !/[a-z0-9]/.test(low.charAt(p - 1))) iv.push([p, p + t.length]);
        p += 1;
      }
    }
    if (!iv.length) return esc(text);
    iv.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = '', pos = 0;
    for (const [a, b] of iv) {
      if (b <= pos) continue;
      const s = Math.max(a, pos);
      out += esc(text.slice(pos, s)) + '<mark>' + esc(text.slice(s, b)) + '</mark>';
      pos = b;
    }
    return out + esc(text.slice(pos));
  }

  return { createEngine, parseNhiJson, parseIcdTxt, parseAliasTxt, sectionOf, highlight, _norm: norm, _weights: W };
});
