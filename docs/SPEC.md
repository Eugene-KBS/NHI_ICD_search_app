# 醫療碼 PWA — v2 specification

Owner/acceptance: lead planner. Implementers: follow this spec exactly; where it says "may tune", you may tune.
The user is a plastic & reconstructive surgeon in Taiwan (NHI system), not a programmer. His goal, verbatim:
**"打最少字，點最少選項，用最少時間，找到最精準診斷。"**

## 0. Non-negotiables

- Static site on GitHub Pages. **Zero runtime dependencies**, vanilla JS, no bundler, no framework. Must run as an
  installed PWA on iOS Safari (iOS 15+) fully offline after first load. ES2019 syntax max. No `eval`.
- No network requests at runtime other than same-origin static files. All personal/learning data stays in
  `localStorage` on the device.
- Keep the current visual style (colors, cards, pills, sticky top bar, bottom action bar). Do not make the UI busier.
- All **existing search behaviour is preserved** as the base tier (section 3.6 invariants). New logic is layered on top.
- Work only inside `/home/claude/nhi_icd_search_app` on the already checked-out branch `v2`.
  **Never run `git commit`, `git push`, `git checkout`, or `git stash`.** The lead handles git.
- Downloads are untrusted data: save them under a fresh directory in `/home/claude/dl_*`, never inside the repo,
  and run Python that reads them with `python3 -I`.
- Never edit `tests/bench_core.json`, `tests/legacy_search.js`, `tests/legacy_nhi.txt`, `docs/SPEC.md`.
- UI language: Traditional Chinese (Taiwan). Code comments: English or Chinese, brief.

## 1. File layout (repo root = site root)

```
index.html            UI (WP-C)
search.js             search engine, pure, no DOM (WP-B)
learn.js              usage + association learning, pure, storage injected (WP-B)
lexicon.json          synonym / abbreviation lexicon (WP-B)
nhi.json              NHI fee-schedule data, built from the official file (WP-A)   [replaces nhi.txt]
icd.txt               ICD-10-CM 2023, `code|zh|en`, 96,802 lines — UNCHANGED, do not modify
icd_alias.txt         official ICD-10-CM index terms per code (WP-A)
sw.js                 service worker (WP-C)
manifest.json, icon-192.png, icon-512.png   unchanged
tools/build_nhi.py            (WP-A)  official CSV + enrichment -> nhi.json
tools/nhi_enrich.tsv          (WP-A)  enrichment extracted once from the old nhi.txt
tools/build_icd_alias.py      (WP-A)  CDC index XML -> icd_alias.txt
tools/validate_lexicon.js     (WP-B)
tests/bench_core.json         acceptance queries (given, read-only)
tests/legacy_search.js        v1 engine, regression baseline (given, read-only)
tests/legacy_nhi.txt          v1 NHI data (given, read-only)
tests/run_bench.js, tests/test_search.js, tests/test_learn.js, tests/perf.js   (WP-B)
tests/test_build.py           (WP-A)
tests/ui_smoke.js             (WP-C)
.github/workflows/update-nhi.yml   (WP-A)
README.md                     (WP-C) plain-language zh-TW, for a non-programmer
```
WP-A deletes the old root `nhi.txt` once `tools/nhi_enrich.tsv` and `nhi.json` exist.

## 2. Data contracts

### 2.1 `nhi.json`
```json
{"v":2,"date":"2026-11-18","source":"健保署開放資料 A21030000I-D20021-001","count":6175,
 "rows":[["62032B","顯微血管游離瓣手術 － 皮瓣移植","Microvascular free flap - skin flap",46539,"<official 備註 verbatim or ''>","<kw>"], ...]}
```
- Row = `[code, zh, en, points(number), note, kw]`. Sorted by code. `points`: number (int when integral).
- `zh`, `en`, `points`, `note` come **verbatim from today's official file** (trim only; collapse runs of whitespace).
  `note` = the official `備註` column, verbatim. It is the only "適應症/支付規範" content the user wants — never
  add, paraphrase or generate indication text.
- `kw` = extra search keywords, space-separated, lowercase, NOT displayed: (a) abbreviations found in the old
  enriched English name or the official one (`(FTSG)`, `STSG`, `S.T.S.G`->`stsg`, `E.K.G.`->`ekg`, `CBC-I`->`cbc`),
  (b) any word of the old `nhi.txt` zh/en description that does not occur in the official zh/en (so nothing that
  was searchable in v1 is lost). Empty string when none.
- Official file: `https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D20021-001` (CSV, UTF-8 BOM,
  header `診療項目代碼,健保支付點數,生效起日,生效迄日,英文項目名稱,中文項目名稱,備註`). A copy downloaded today is at
  `/home/claude/dl_nhi_official/nhi_official.csv` (6,175 rows, unique codes). If a code appears more than once keep the
  row whose 生效起日 is latest among rows whose 生效迄日 >= today.

### 2.2 `icd.txt` (unchanged)
`code|zh|en`. 96,802 rows = 73,680 billable leaves + 23,122 non-billable headers. A code is **billable iff no other
code in the file starts with it** (compute at load).

### 2.3 `icd_alias.txt`
`code|term; term; term` one line per code that has aliases, sorted by code. Source: CDC/NCHS ICD-10-CM **2023**
Alphabetic Index (public domain) inside
`https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2023/icd10cm-Tabular-Index-2023.zip`
(the index XML: `<mainTerm><title>…</title><code>…</code><term level="1"><title>…</title><code>…</code>…`).
- A term = the flattened path "main term + subterm titles" down to level 2 (level 3+ ignored), lowercase, text in
  parentheses (nonessential modifiers) kept as plain words, punctuation stripped. Example: `L91.0|keloid; cheloid; scar hypertrophic`.
- Index codes ending in `-` (e.g. `C43.7-`) or that are headers in `icd.txt` are written under the bare code
  (`C43.7`); the engine propagates a code's aliases to all its descendants at load time (3.2).
- Drop a term when every one of its words already occurs in that code's own English description. Drop codes not in
  `icd.txt`. Resolve plain `see X` / `see also X` only when trivial; otherwise skip. Target size <= 2.5 MB.
- pipes and semicolons never appear inside a term.

### 2.4 `lexicon.json`
```json
{"v":1,
 "groups":[["keloid","hypertrophic scar","蟹足腫","肥厚性疤痕"], ["debridement","debride","清創","擴創"], ...],
 "oneway":{"alt":["perforator flap","free flap","穿通枝瓣"], "leg":["lower limb","lower leg","小腿","下肢"], ...}}
```
- `groups`: members are equivalent — any member typed expands to all others. `oneway`: key expands to targets only
  (abbreviations, lay words, hyponym->official wording). Members may be single words, multi-word phrases, or
  Chinese terms. **Words only — never codes.**
- Must contain every entry of the v1 `SYN` table (see `tests/legacy_search.js`), unchanged in effect.
- Scope (>= 350 entries total, medically correct, Taiwan usage for Chinese): plastic/reconstructive, hand, burn,
  craniofacial, trauma, wound care, skin oncology, head-and-neck oncology, breast, general ward terms.
  Categories that must be covered: clinical abbreviations (STSG FTSG ALT DIEP TRAM LD RFFF PMMC ORIF CRPP I&D
  NPWT/VAC CTS CTR BCC SCC MM DM PAOD DFU HTS FB LN STS OM NF TBSA …); lay/clinical word vs official wording
  (sore->ulcer, leg->lower limb, lipoma->benign lipomatous neoplasm / subcutaneous tumor, gynecomastia->hypertrophy
  of breast, nevus<->nevi, cancer/ca/carcinoma/malignant neoplasm, cyst wording, bedsore/decubitus->pressure ulcer,
  diabetic->diabetes mellitus, stitches<->suture, cleft lip->兔唇 (NHI wording) …); anatomy lay->official
  (forehead/cheek/chin->face/head wording used by ICD, foot/ankle/thigh/calf->lower limb, palm, fingertip, …);
  ordinals & degrees (1st/first/一度, 2nd/second/二度, 3rd/third/三度, stage 1-4/第一期…第四期, I/II/III/IV only
  inside these groups); British/American spelling (necrotising, oedema, tumour, haem-); Chinese variants
  (褥瘡/壓瘡/壓傷->壓迫性潰瘍, 蜂窩性組織炎->蜂窩組織炎, 燙傷->燒傷, 板機指->扳機指, 蟹足腫->肥厚性疤痕, 乳癌->乳房惡性腫瘤,
  口腔癌/頰癌, 植皮->皮膚移植/植補, 截肢/截斷/切斷, 骨折/斷, 兔唇/唇裂, 脂肪瘤, 男性女乳症->乳房肥大, 狗咬->咬傷,
  背->軀幹, 臉/顏面, 腳/足, 手指/指 …).
- `tools/validate_lexicon.js` must prove every expansion target hits >= 1 record (NHI, ICD or alias) and print
  dead entries; dead entries are removed before delivery.

## 3. Search engine — `search.js`

UMD: `window.MedSearch` in the browser, `module.exports` in Node. No DOM, no storage, no fetch.

### 3.1 API
```js
const engine = MedSearch.createEngine({ lexicon });            // lexicon = parsed lexicon.json (may be null)
MedSearch.parseNhiJson(obj)  -> rows      MedSearch.parseIcdTxt(text) -> rows
MedSearch.parseAliasTxt(text) -> Map(code -> [term, ...])
await engine.loadAsync(kind, rows, { aliases, sliceMs: 12 });  // kind 'nhi' | 'icd'; builds indexes in slices,
engine.load(kind, rows, { aliases });                          //   yielding to the event loop; sync variant for Node
engine.ready(kind) -> boolean          engine.get(kind, code) -> rec | undefined      engine.size(kind) -> n
engine.search(kind, query, { limit = 300, boost }) ->
  { rows: [{ rec, score, via, terms }], total, notes }
MedSearch.sectionOf(code) -> { id, label }                      // NHI section label (3.7)
MedSearch.highlight(text, terms) -> safe HTML string with <mark>
```
- `rec` = `{ kind, code, zh, en, points (number|null), note, billable (bool), sect }` (+ private fields).
- `via`: `'code' | 'abbr' | 'text' | 'alias' | 'partial'`. `terms`: strings to highlight in zh/en.
- `notes`: `{type:'fix',from,to}` (typo corrected), `{type:'syn',from,to}` (synonym used; only when the literal token
  itself matched nothing), `{type:'partial',dropped:[…]}`.
- `boost(code) -> number >= 0`, supplied by the UI (usage + association). Added to the score of records that already
  match; never makes a non-matching record appear.
- Empty/whitespace query -> `{rows:[], total:0, notes:[]}` (the UI renders its own empty screen).

### 3.2 Indexing
- Normalise text with NFKC (full-width -> half-width, `㎡`->`m2`), lowercase, `臺`->`台`.
- English words: split on anything not `[a-z0-9]`; also index the joined form of hyphen/dot/ampersand compounds
  (`z-plasty` -> `z`, `plasty`, `zplasty`; `s.t.s.g` -> `stsg`; `i&d` -> `id`).
- Inverted index word -> postings (typed arrays); sorted vocabulary for prefix ranges (binary search). Alias words
  (ICD) and `kw` words (NHI) are indexed in a separate lower-weight field. A code's aliases also apply to every
  descendant code (prefix relation).
- Chinese: keep the normalised `zh` string per record; substring search by linear scan is fine.
- Budget (Node 22, this machine): ICD index build <= 1.5 s total; `search()` p95 <= 30 ms for ICD over the bench
  typed character-by-character; NHI <= 5 ms.

### 3.3 Query pipeline
1. Normalise; split on whitespace; split at Latin/CJK boundaries (`右index` -> `右`,`index`); for compounds try both
   split and joined forms. Drop stop-words `of the and in at to for a an 的 之`.
2. **Code tier** (legacy): whole query (dots ignored) vs codes — exact, prefix, contains.
3. **Abbreviation tier** (legacy): whole query vs NHI abbreviations (`kw`).
4. **Text tier** — every remaining token must match (AND). A token matches a record if any of:
   a. exact word, b. word prefix (legacy behaviour), c. lexicon expansion — a member/target matches (a multi-word
   phrase matches when all its words are present; a Chinese member matches as substring), d. alias/kw field word
   (exact or prefix), e. Chinese token: substring of `zh`; else **chunk match**: the token can be cut into <= 4
   pieces, each a substring of `zh`, each >= 2 chars (single chars allowed only from
   `右左雙上下前後內外手足指趾腕肘肩膝踝髖臉頸胸腹背頭眼耳鼻唇舌骨皮`), f. **fuzzy**: only for Latin tokens >= 4 chars that
   match nothing via a–d anywhere in this dataset: Damerau–Levenshtein distance <= 1 (len 4–8) or <= 2 (len >= 9)
   against vocabulary + lexicon keys; take up to 3 nearest (ties: higher document frequency); emit a `fix` note.
5. **Fallbacks** when the text tier returns 0 rows: (i) retry allowing fuzzy for every Latin token >= 4 chars;
   (ii) partial match — best results matching all tokens but one (`via:'partial'`, `partial` note). Never
   return "nothing" while a near match exists.

### 3.4 Scoring (may tune weights; invariants in 3.6 may not be broken)
`score = tier + tokenQuality + coverage + adjacency + billable + prior + boost(code) - unspecifiedPenalty`
- tier (legacy values): code exact 2000, code prefix 1000, code contains 120; abbr exact 3000, abbr contains 150;
  all-tokens text match 700 (+250 when the whole query is one exact word of the record; +500 when the whole query
  is a substring of `zh`).
- tokenQuality per token: exact 60 > prefix 40 > lexicon 35 > alias/kw 30 > chunk 25 > fuzzy 15.
- coverage: up to +120, proportional to matched words / record words (short, general descriptions first).
- adjacency: +100 when the query tokens occur adjacent and in order.
- billable (ICD): non-billable headers get -300 unless they matched in the code tier.
- prior (specialty relevance, 3.7): -40 … +60.
- unspecifiedPenalty: -30 when `en` contains "unspecified" and the query does not ask for it (`unsp`, `unspecified`,
  `未明示`).
- Ties: code ascending (so initial encounter `A` precedes `D`, `S`; right precedes left).

### 3.5 Result shape rules
- `total` = number of matching records; `rows` capped at `limit`.
- Deterministic. Never throws (empty, emoji, regex metacharacters, 500-char input).

### 3.6 Invariants (each has a test in `tests/test_search.js`)
- I1 exact code is rank 1; when the query looks like a code, code-prefix hits precede text hits.
- I2 exact NHI abbreviation precedes plain text hits.
- I3 regression: for every bench query where the legacy engine returns rows, each legacy top-5 row is in the new
  top-20 — except non-billable ICD headers and rows whose legacy match was only through the missing-data difference.
- I4 billable ICD rows precede non-billable headers within the text tier; headers are still returned.
- I5 no `fix` note for a token that matches via a–d; tokens < 4 chars never fuzzy.
- I6 deterministic, I7 never throws.

### 3.7 Section labels and specialty priors
NHI `sectionOf(code)` by 5-digit+letter code prefix (2 digits):
00–05 基本診療 · 06–31 檢查 · 32–38 放射 · 39 注射 · 41–44 復健 · 45 精神 · 47 處置·一般 · 48 處置·創傷 · 49 處置·腸胃 ·
50 處置·泌尿 · 51 處置·皮膚 · 52 處置·骨科 · 53 處置·眼 · 54 處置·耳鼻喉 · 55 處置·婦產 · 56 處置·神經血管 · 57 處置·呼吸 ·
58 處置·透析 · 59 高壓氧 · 60 處置·眼雷射 · 61 處置·骨折 · 62 手術·皮膚 · 63 手術·乳房 · 64 手術·骨骼肌肉 · 65 手術·鼻 ·
66 手術·喉 · 67 手術·胸腔 · 68 手術·心臟 · 69 手術·血管 · 70 手術·脾淋巴 · 71 手術·口腔食道 · 72 手術·胃 · 73 手術·腸 ·
74 手術·肛門 · 75 手術·肝膽胰 · 76–79 手術·泌尿 · 80–81 手術·婦產 · 82 手術·內分泌 · 83 手術·神經 · 84 手術·耳 ·
85–87 手術·眼 · 88 手術·小兒 · 89–92 牙科 · 93–94 輸血 · 95 石膏 · 96 麻醉 · 97 論病例 · letter-prefixed codes 專案/其他 ·
codes that are not 5 digits + letter 預防保健/其他.
NHI prior: +60 for 48, 62, 64; +35 for 51, 52, 59, 61, 63, 65, 69, 71, 83, 84, 87, 95, 96; -40 for letter-prefixed
codes, 89–92, 97+, and non-standard codes; 0 otherwise.
ICD prior: +60 for S, T, L, C43, C44, D03, D04, D17, D18, D22, D23, C00–C14; +35 for Q16–Q18, Q35–Q38, Q65–Q79, M,
G56, G57, N60–N65, C50, D05, D24, H02, I70, I73, I83, I87, I89, E08–E13, R22; -40 for V, W, X, Y; 0 otherwise.

## 4. Learning — `learn.js`

UMD `MedLearn`. Pure; storage and clock injected so Node can test it.
```js
const L = MedLearn.create(storage /* getItem,setItem */, now /* () => ms, default Date.now */);
L.recordUse(kind, code)                    // a code was picked
L.usageBoost(kind, code) -> 0..400         // min(400, 120*log2(1+n_decayed)) (+100 if used within 7 days, capped)
L.recent(kind, n) -> [code]                L.frequent(kind, n) -> [code]
L.commitCase(dxCodes, opCodes) -> boolean  // learn one finished patient list
L.assocBoost(code, trayCodes) -> 0..300    // min(300, 100*log2(1+sum of decayed pair counts with tray codes))
L.suggest(kind, trayCodes, n) -> [{code, n}]   // codes of `kind` most associated with the tray, not already in it
L.exportData() -> string (JSON)            L.importData(str, { merge: true }) -> boolean
L.stats() -> { uses, cases, pairs }        L.reset()
```
- One key `medcode.learn.v1`: `{v:1, use:{nhi:{code:[n,lastMs]}, icd:{…}}, pair:{"A|B":[n,lastMs]}, cases:n}`.
  Pair key = the two codes sorted, each prefixed with kind (`i:S62.610A|n:64153B`). `commitCase` increments every
  unordered pair among all codes of the case (dx–op, dx–dx, op–op); a case with < 2 codes is ignored; an identical
  code set committed again within 12 h is ignored (returns false).
- Decay: `n_decayed = n * 0.5^(ageDays/180)`.
- Limits: 3,000 use entries, 6,000 pairs — prune lowest decayed score. All storage errors (quota, private mode,
  corrupt JSON) are swallowed; the app must keep working with learning disabled.

## 5. UI — `index.html` + `sw.js`

Same look as v1. Changes only:

1. Tabs: `健保碼` | `ICD-10-CM`. Placeholders: `搜尋代碼、中英文或縮寫（如 STSG、清創、62032）…` /
   `搜尋代碼、中英文或縮寫（如 keloid、rt index fx、L91.0）…`.
2. Loading: fetch `lexicon.json` + `nhi.json` first (NHI usable at once), then `icd.txt` + `icd_alias.txt`, building
   the ICD index with `loadAsync`; status line shows `ICD 索引建立中…` until ready. Falls back to the built-in sample
   rows if files are missing (as v1).
3. Status line (under the input) shows engine notes, one line, small grey text:
   `已修正：phalnx → phalanx` · `同義：keloid → hypertrophic scar` · `找不到完全符合，以下為部分符合（未含：xxx）`.
4. Cards. NHI: code, points pill, a small grey section tag (`手術·皮膚`), zh, en; when `note` is non-empty a small
   text button `規範 ▾` at the bottom of the card that expands/collapses the official note (verbatim, pre-wrap,
   prefixed `健保署支付規範（官方原文）`); tapping the button must not select the card.
   ICD: code, zh, en; non-billable rows are dimmed (opacity ~.55) with a tag `上層碼・不可申報`.
   Highlight all matched terms. Render the first 60 rows; a `顯示更多` button appends 60 more (max 300).
5. **One gesture in both tabs**: tapping a card toggles it in the patient list (blue selected state + check mark as
   v1 NHI). In the ICD tab the tap that selects also copies the code (toast `已複製 S62.610A・已加入病人清單`).
   Every selection calls `L.recordUse`.
6. Bottom bar (only when the list is non-empty, both tabs): `本次病人　診斷 2・手術 3　›`.
7. Patient view (replaces v1 "比較清單"):
   - `診斷` — pick order; first row labelled `主診斷`; each row: code, zh, en, `↑` (move up; hidden on first), `×`.
   - `手術／處置` — sorted by points high->low with the v1 rank circles; then `合計 N 點（單純加總，未套用多項手術折扣）`.
   - `常一起用` — up to 6 chips from `L.suggest` (both kinds, code + short zh); tap adds. Hidden when empty.
   - Buttons `複製全部` (copies the text below, calls `L.commitCase`, toast `已複製・已學習這組搭配`) and
     `完成並清空` (commitCase, then clear). Small links: `直接清空（不記錄）`, `匯出使用紀錄`, `匯入使用紀錄`
     (export = download/share a `.json`; import = file input, merge).
   - Tapping a code in the patient view copies that single code.
   - Copy-all text:
     ```
     【診斷】
     1. S62.610A 右側食指近端指骨移位閉鎖性骨折之初期照護
     【手術／處置】
     1. 64153B 斷指再接手術 － 一隻手指（26,157 點）
     ```
   - The list persists in `localStorage` key `medcode.tray.v1` until cleared.
8. Empty-query screen (per tab), sections with small grey headings, each hidden when empty:
   `常與已選項目一起用` (L.suggest for this tab's kind, when the list is non-empty) · `最近使用` (<= 10) ·
   `最常用` (<= 10, not repeating the above). With no history at all: NHI shows `整外常用` =
   48004C 48005C 48006C 48001C 62014C 62015B 62007C 62045B 62046C 62047C 62018C 62025B 62032B 62073B 62010C
   62001C 64153B 64090C 83094B 64025C (skip any that do not exist); ICD shows the hint
   `輸入關鍵字、縮寫或代碼開始搜尋`.
9. Search calls pass `boost: code => L.usageBoost(kind, code) + L.assocBoost(code, trayCodes)`.
10. Footer line at the end of the list: `健保碼資料日期 YYYY-MM-DD（健保署開放資料，每月自動更新）・ICD-10-CM 2023 年版`.
11. `?embed=1` in the URL: do not register the service worker.
12. `sw.js`: cache name `medcode-v2`; precache shell + data on install; **shell (html/js/json lexicon/manifest/
    icons): network-first with a 3 s timeout, cache fallback** (so new versions reach installed phones);
    data (`nhi.json`, `icd.txt`, `icd_alias.txt`): stale-while-revalidate; delete old caches on activate;
    `skipWaiting` + `clients.claim`.
13. `README.md` (zh-TW, non-programmer): what the app does, how to use the patient list and learning, where data
    comes from, how the monthly update works and how to run it by hand, how to back up learning data.
14. `tests/ui_smoke.js`: Playwright (`require` from `/opt/npm-tools/node_modules/playwright`, Chrome at
    `/usr/bin/google-chrome`, iPhone-size viewport 390x844) against a local static server: search in both tabs,
    expand a 規範, select codes in both tabs, open the patient view, copy all, check learning suggestions appear on
    the next case; save screenshots to `/home/claude/work/shots/`.

## 6. Monthly auto-update — `.github/workflows/update-nhi.yml` + `tools/build_nhi.py`

- `python3 tools/build_nhi.py --fetch` downloads the official CSV; `--csv PATH` uses a local copy; `--out nhi.json`.
  Python standard library only.
- Safety gates (exit non-zero and leave `nhi.json` untouched): fewer than 5,000 rows; header mismatch; any of
  62032B, 48004C, 64153B missing; > 15 % of previously present codes disappearing; > 30 % of points changing.
- Prints a short change report (added / removed / point changes).
- Workflow: `schedule` monthly (`17 19 1 * *`) + `workflow_dispatch`; `permissions: contents: write`; checkout,
  setup-python, run the build, commit `nhi.json` as `github-actions[bot]` only when the build succeeded (the `date`
  field changes every run, so there is a commit every month, which also keeps the schedule alive).

## 7. Acceptance (run by the lead)

- `node tests/run_bench.js` prints legacy vs v2 pass counts per kind on `bench_core.json`; v2 must reach >= 95 %.
  A query passes when any of the first `k` rows has a code starting with one of `want`; with `billableFirst` the
  first row must also be billable. Baseline: legacy 51/99.
- A hidden hold-out set is run by the lead afterwards — build general mechanisms, do not hard-code bench queries.
- `node tests/test_search.js`, `node tests/test_learn.js`, `node tests/perf.js`, `python3 -I tests/test_build.py`,
  `node tools/validate_lexicon.js`, `node tests/ui_smoke.js` all exit 0.
- Points in `nhi.json` equal today's official file for all 6,175 codes.

## 8. Addendum (2026-11-18) — compound diagnoses, rupture wording, miss log

The user's own examples of what he types (verbatim), which v1 could not answer:
`right hand crushing injury with tendon rupture` · `right forearm muscle rupture with nerve injury`.
One sentence = two diagnoses that share side and site. No single code contains all the words.

### 8.1 Compound queries (engine, SPEC 3 extension)
- Connectors: `with`, `w/`, `and`, `&`, `+`, `,`, `;`, and Chinese `合併`, `併有`, `併`, `伴有`, `伴`, `及`, `和`, `與`.
- Step 1 — single concept first: run the normal pipeline on the whole query with connectors treated as stop-words.
  If it yields >= 1 row that is not `partial`, return exactly as before (so `type 2 diabetes with foot ulcer`,
  `laceration with foreign body rt hand` keep resolving to one code).
- Step 2 — otherwise split at the connectors into 2–4 parts. **Context carry-over**: a part with no laterality token
  inherits the laterality of the nearest other part (earlier part first); a part with no anatomy token inherits the
  anatomy tokens likewise. Laterality = right/left/bilateral and their lexicon equivalents (rt, lt, 右, 左, 雙…).
  Anatomy tokens come from a new `lexicon.json` key `"anatomy": [ … ]` (English + Chinese body-site words: hand, wrist,
  forearm, elbow, arm, shoulder, finger, thumb, index, middle, ring, little, palm, hip, thigh, knee, leg, ankle, foot,
  toe, heel, face, scalp, head, neck, chest, abdomen, back, buttock, eyelid, lip, nose, ear … and 手 腕 前臂 肘 上臂 肩
  手指 拇指 食指 中指 無名指 小指 髖 大腿 膝 小腿 踝 足 趾 臉 頭皮 頭 頸 胸 腹 背 臀 眼瞼 唇 鼻 耳 …). In a Chinese run with no
  spaces (`右手壓砸傷合併肌腱斷裂`) find laterality/anatomy as substrings.
  For each part try, in order, until rows are found: part + laterality + anatomy → part + laterality → part alone.
  Each attempt is the full single-concept pipeline (lexicon, alias, fuzzy, partial).
- Result: `{ rows, total, notes: [..., {type:'split', labels:[…]}], parts: [{ label, query, rows, total }] }`.
  `label` = the part as the user typed it plus inherited words (e.g. `right hand tendon rupture`). `rows` (flat) =
  round-robin merge of the parts' rows so API users that ignore `parts` still get every part near the top.
- UI (WP-C): render each part as a section with a small heading `① right hand crushing injury` … showing its first
  8 rows and a `顯示更多`; status line `已拆成 2 個診斷分別搜尋`.

### 8.2 Rupture / tear wording (lexicon)
The official ICD-10-CM index sends traumatic "Rupture, tendon" and "Rupture, muscle" to **Strain** (S-codes), and
nontraumatic to M66 / M62.1. Add one-way expansions: `rupture`, `ruptured` → `strain`; `tear`, `torn` → `strain`,
`sprain`; `斷裂` → `拉傷`; `擠壓傷`, `壓傷`, `夾傷` → `壓砸傷`. Exact-word matches (M66 "Spontaneous rupture…") still appear;
both families must be reachable.
**User decision (2026-11-18): for traumatic tendon rupture he codes _laceration_ (撕裂傷, S66.x2), not strain.**
So `rupture`/`ruptured`/`斷裂` get a *preferred* target: lexicon key `"prefer": {"rupture":"laceration","ruptured":"laceration","斷裂":"撕裂傷"}`.
A record matched through a token's preferred target scores above an exact-word match of that token (tokenQuality 75),
so the order for `right hand tendon rupture` is: laceration (S66.x2) → exact "rupture" (M66 spontaneous) → strain (S66.x1).
An explicit word still wins: `spontaneous rupture extensor tendon rt hand` must put M66.241 first.
The bench now has 109 entries (three added for this).

### 8.3 Bench format
`tests/bench_core.json` now has 106 entries. An entry with `"parts":[{want,k},…]` passes when the result has `parts`
and every bench part is satisfied by a distinct result part whose first `k` rows contain a wanted code.

### 8.4 Miss log (learn.js)
`L.recordMiss(kind, query)`, `L.misses() -> [{q, kind, n, last}]`, `L.clearMisses()`; stored in the same key, capped
at 200 (drop oldest), included in `exportData`/`importData`. The UI calls `recordMiss` when a query of >= 3 characters
has rested 2.5 s and returned zero rows or only `partial` rows. Purpose: the user cannot recall which searches failed;
the app remembers them so the lexicon can be improved from the export.

## 9. Fix round after the lead's acceptance run (2026-11-18)

Core bench was 109/109 but the hidden hold-out was 30/36 and spot checks showed ranking defects. Mechanisms to fix
(general fixes — do not special-case the examples). `tests/bench_core.json` now has 116 entries.

### 9.1 Engine (`search.js`, owner: engine-fix agent)
- E1 **Unspecified penalty is laterality-only.** Remove the generic "unspecified" penalty. Apply -40 only when `zh`
  contains `未明示側性` and the query does not ask for it. ("Unspecified fracture of shaft of right tibia" and
  "Unspecified fracture of left toe(s)" are exactly what a generic query wants and were being pushed out.)
- E2 **Encounter-neutral coverage and fixed encounter order.** Compute coverage on the English text with the
  encounter suffix removed (`, initial encounter…`, `, subsequent encounter…`, `, sequela`), so the 7th-character
  variants of one concept tie on coverage; then order them initial (0) > subsequent (-12) > sequela (-20).
  A sequela row must never outrank the subsequent row of the same parent.
- E3 **Priors (replaces the ICD list in 3.7).** +80: S00–S09, S60–S69, T20–T25, T30–T32. +60: other S, T07–T19,
  T33–T34, T79, T81, T84–T87, L, C43, C44, D03, D04, D17, D18, D22, D23, C00–C14. +35: the 3.7 "+35" list.
  0: everything else **including T36–T78 and T88** (poisoning/adverse-effect codes must not get the trauma prior —
  `htn` currently ranks "antihypertensive drugs" poisoning above I10). -40: V, W, X, Y.
- E4 **Prefer bonus is a flat +250** on the record (not a per-token quality), so a preferred-target match beats an
  exact-word match regardless of description length (`lt forearm flexor tendon rupture` currently ranks M66.332
  first). Remove the "prefer does not apply inside a lexicon phrase" exception — that was added only to satisfy a
  stale bench line, which is now corrected (muscle rupture also prefers laceration).
- E5 **Pairwise adjacency.** +40 for every pair of consecutive query tokens that are adjacent, in order, in the
  record's `en` or `zh` (after expansion), in addition to the all-tokens adjacency bonus. So `right hand tendon
  laceration` ranks the "…at wrist and hand level, right hand" rows (S66.821A, S66.921A) above the thumb/finger rows
  that merely contain "right … hand".
- E6 **Adjacent-token joining.** For consecutive Latin tokens also try their concatenation when it is a vocabulary
  word or lexicon key (`le fort` → `lefort`, `z plasty` → `zplasty`); a literal joined match outranks lexicon
  expansions of the separate tokens.
- E7 **Partial fallback merges all drop-one variants** (union, ranked by score; `partial` note lists every dropped
  token actually used) instead of choosing one token to drop. `radius fx distal lt` must not drop `fx` and return
  physeal-arrest rows only.
- E8 **Code tier is pure code order.** When the query is a code prefix, the code-tier rows are ordered exact first,
  then by code ascending; priors, penalties, coverage and encounter adjustments do not apply inside the code tier
  (bench entry with `codeOrder` checks the first rows; `run_bench.js` must support `codeOrder`).
- E9 **Ordered one-way targets.** In `oneway` (and for `prefer`) the first target is the preferred official wording:
  first target +12 tokenQuality over the others (`alt` → perforator-flap rows before the other free flaps).
- E10 A literal match of the typed word always scores at least as high as any lexicon expansion of it, except via
  `prefer`.
- E11 Tighten the I3 test: at most 8 % of legacy top-5 billable rows missing from the new top 20, ignoring rows whose
  `zh` contains `未明示側性`. (Measured before this round: 18/180.)

### 9.2 Lexicon (`lexicon.json`, owner: lexicon-audit agent)
- Move the generator source into the repo as `tools/lexicon_src.js` (+ a one-line note in the header on how to
  regenerate) so `lexicon.json` is reproducible; `tools/validate_lexicon.js` stays the gate.
- Audit every entry for medical correctness. An expansion stays only if it is clinically equivalent or the correct
  official/broader wording for that term; delete doubtful ones rather than keep them. Known bad examples:
  `le fort`/`lefort` → maxilla (the data has "LeFort fracture" — delete), `breast enlargement` → breast implant,
  `洗腎` → chronic kidney disease (should be dialysis wording), `縮短` → contracture, `spine` → trunk,
  `muscle tear` → muscle strain/拉傷 (delete phrase-level entry; token-level `tear` → strain is enough).
  Never map a term to something that the data already names literally in another way.
- Add: `distal` → `lower end`, `proximal` → `upper end` (ICD fracture wording "Fracture of lower end of radius");
  `paronychia`, `whitlow` → `cellulitis of finger`, `cellulitis of toe` (official index: see Cellulitis, digit);
  keep `felon`. Review that common ward abbreviations expand to the official wording first (E9 order matters).
