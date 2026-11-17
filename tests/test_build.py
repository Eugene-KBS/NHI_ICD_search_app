#!/usr/bin/env python3
"""Run from repo root: python3 -I tests/test_build.py  (exit 0 = pass)."""
import csv, io, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_nhi as B  # noqa: E402

OFFICIAL = "/home/claude/dl_nhi_official/nhi_official.csv"
fails = []


def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + (" -- " + str(info) if info and not ok else ""))
    if not ok:
        fails.append(name)


doc = json.load(open(os.path.join(ROOT, "nhi.json"), encoding="utf-8"))
rows = doc["rows"]
codes = [r[0] for r in rows]
check("nhi.json header", doc["v"] == 2 and doc["count"] == len(rows) and re.fullmatch(r"\d{4}-\d\d-\d\d", doc["date"]))
check("nhi.json row schema", all(len(r) == 6 and isinstance(r[3], (int, float)) and not isinstance(r[3], bool)
                                 and all(isinstance(r[i], str) for i in (0, 1, 2, 4, 5)) for r in rows))
check("nhi.json sorted + unique", codes == sorted(set(codes)))
check("kw is lowercase, space separated", all(r[5] == r[5].lower() and r[5] == " ".join(r[5].split()) for r in rows))
check("whitespace collapsed in zh/en/note", all(r[i] == " ".join(r[i].split()) for r in rows for i in (1, 2, 4)))
if len(rows) < 5000:
    check("row count", False, len(rows))
else:
    print("PASS row count %d" % len(rows))

if os.path.exists(OFFICIAL):
    off = B.read_official(open(OFFICIAL, "rb").read(), doc["date"])
    check("same code set as official CSV", set(off) == set(codes), (len(off), len(codes)))
    bad = [r[0] for r in rows if r[0] in off and (r[1], r[3], r[4]) != (off[r[0]][0], off[r[0]][2], off[r[0]][3])]
    check("points/zh/note equal official for every code", not bad, bad[:5])
    enrich = B.load_enrich(os.path.join(os.path.dirname(B.__file__), "nhi_enrich.tsv"))
    # English name: official when present; when the official one is blank, the old hand-curated name (or blank)
    bad = [r[0] for r in rows if r[0] in off and r[2] != (off[r[0]][1] or enrich.get(r[0], ("", ""))[1])]
    check("en equals official (or the old curated name where official is blank)", not bad, bad[:5])
    raw = {}
    for r in list(csv.reader(io.StringIO(open(OFFICIAL, encoding="utf-8-sig", newline="").read())))[1:]:
        raw[r[0]] = r
    check("points numerically equal raw CSV column", all(float(raw[r[0]][1]) == r[3] for r in rows))
else:
    print("NOTICE: %s not found, skipping official-CSV comparison" % OFFICIAL)

# abbreviations searchable in the old data survive
index = {r[0]: r for r in rows}
def searchable(code, tok):
    r = index[code]
    words = B.en_words(r[2]) | set(re.findall(r"[a-z0-9]+", B.norm(r[1]))) | set(r[5].split())
    return tok in words
check("62007C has ftsg", searchable("62007C", "ftsg"))
check("62014C has stsg", searchable("62014C", "stsg"))
check("18022B has cag", searchable("18022B", "cag"))
lost = []
for line in open(os.path.join(ROOT, "tests", "legacy_nhi.txt"), encoding="utf-8"):
    p = line.strip().split("|")
    if len(p) < 3 or p[0] not in index:
        continue
    zh, en = B.split_desc(" ".join(p[1:-1]).strip())
    r = index[p[0]]
    for a in B.abbreviations(en):
        if not searchable(p[0], a):
            lost.append((p[0], a))
check("every old abbreviation still searchable", not lost, lost[:5])

# safety gates refuse bad input
def run_build(text, out=None, today="2026-11-18"):
    d = tempfile.mkdtemp()
    src = os.path.join(d, "in.csv")
    open(src, "wb").write(text if isinstance(text, bytes) else text.encode("utf-8"))
    dst = out or os.path.join(d, "out.json")
    p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "tools", "build_nhi.py"), "--csv", src, "--out", dst, "--today", today],
                       capture_output=True, text=True)
    return p.returncode, dst, p.stderr

HEAD = ",".join(B.HEADER) + "\n"
def fake(n, extra=()):
    lines = ["%05dB,%d,20210301,29101231,en,zh,note" % (i, 100 + i) for i in range(n)]
    lines += list(extra)
    return HEAD + "\n".join(lines) + "\n"
must = ["62032B,10,20210301,29101231,a,b,", "48004C,10,20210301,29101231,a,b,", "64153B,10,20210301,29101231,a,b,"]

rc, dst, err = run_build(fake(5200, must)); check("gate sanity: valid fake input builds", rc == 0, err)
rc, dst, err = run_build(fake(4000, must)); check("gate: < 5000 rows refused", rc != 0 and not os.path.exists(dst))
rc, dst, err = run_build(HEAD.replace("健保支付點數", "點數") + fake(5200, must)[len(HEAD):]); check("gate: header mismatch refused", rc != 0 and not os.path.exists(dst))
rc, dst, err = run_build(fake(5200, must[:2])); check("gate: required code missing refused", rc != 0 and not os.path.exists(dst))
rc, dst, err = run_build(fake(5200, must) + "00001B,12\n"); check("gate: garbled row refused", rc != 0 and not os.path.exists(dst))
rc, dst, err = run_build(fake(5200, must).replace("100,20210301", "abc,20210301", 1)); check("gate: non-numeric points refused", rc != 0)
rc, dst, err = run_build(b"\xff\xfe\x00garbage"); check("gate: non-UTF8 garbage refused", rc != 0)
rc, dst, err = run_build(fake(5200, must)[:3000]); check("gate: truncated file refused", rc != 0)
# vs previous data: disappearing codes / changed points leave the old file untouched
prev = os.path.join(tempfile.mkdtemp(), "nhi.json")
rc, _, _ = run_build(fake(5200, must), out=prev); before = open(prev, "rb").read()
rc, _, err = run_build(fake(5200 - 900, must), out=prev, today="2026-12-01")
check("gate: > 15% codes disappearing refused, file untouched", rc != 0 and open(prev, "rb").read() == before, err)
changed = HEAD + "\n".join("%05dB,%d,20210301,29101231,en,zh,note" % (i, 100 + i + (7 if i % 2 else 0)) for i in range(5200)) + "\n" + "\n".join(must) + "\n"
rc, _, err = run_build(changed, out=prev, today="2026-12-01")
check("gate: > 30% points changing refused, file untouched", rc != 0 and open(prev, "rb").read() == before, err)

# icd_alias.txt format
icd = {}
for line in open(os.path.join(ROOT, "icd.txt"), encoding="utf-8"):
    p = line.rstrip("\n").split("|")
    if len(p) >= 3:
        icd[p[0]] = p[2]
path = os.path.join(ROOT, "icd_alias.txt")
size = os.path.getsize(path)
ok_fmt, last, n = True, "", 0
for line in open(path, encoding="utf-8"):
    n += 1
    code, sep, rest = line.rstrip("\n").partition("|")
    terms = rest.split("; ")
    ok_fmt &= bool(sep) and code in icd and code > last and "|" not in rest and all(t and ";" not in t for t in terms)
    last = code
check("icd_alias.txt format (codes exist, sorted, no | or ; in terms)", ok_fmt)
check("icd_alias.txt size <= 2.5 MB (%d bytes, %d codes)" % (size, n), size <= 2_500_000 and n > 5000)

print("\n%s: %d check(s) failed" % ("FAILED" if fails else "OK", len(fails)) if fails else "\nALL CHECKS PASSED")
sys.exit(1 if fails else 0)
