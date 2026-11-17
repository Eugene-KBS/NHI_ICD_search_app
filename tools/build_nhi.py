#!/usr/bin/env python3
"""Build nhi.json from the official NHI fee-schedule CSV + tools/nhi_enrich.tsv (stdlib only).
Usage: python3 tools/build_nhi.py [--fetch | --csv PATH] [--out nhi.json] [--today YYYY-MM-DD]
Exit code 1 (and nhi.json untouched) when a safety gate fails."""
import argparse, csv, datetime, io, json, os, re, ssl, sys, unicodedata, urllib.request

URL = "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D20021-001"
SOURCE = "健保署開放資料 A21030000I-D20021-001"
HEADER = ["診療項目代碼", "健保支付點數", "生效起日", "生效迄日", "英文項目名稱", "中文項目名稱", "備註"]
STOP = {"of", "the", "and", "in", "at", "to", "for", "an", "or"}
MUST_HAVE = ["62032B", "48004C", "64153B"]
HERE = os.path.dirname(os.path.abspath(__file__))


class GateError(Exception):
    pass


def fetch(url=URL):
    ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or None)
    req = urllib.request.Request(url, headers={"User-Agent": "nhi-json-builder/2"})
    with urllib.request.urlopen(req, timeout=120, context=ctx) as r:  # honours HTTPS_PROXY
        return r.read()


def clean(s):
    return re.sub(r"\s+", " ", s).strip()


def parse_points(s):
    s = s.strip().replace(",", "")
    if not re.fullmatch(r"\d+(\.\d+)?", s):
        raise GateError("bad points value: %r" % s)
    f = float(s)
    return int(f) if f == int(f) else f


def read_official(raw, today):
    """bytes -> {code: (zh, en, points, note)}. Raises GateError on structural problems."""
    text = raw.decode("utf-8-sig", errors="strict") if isinstance(raw, bytes) else raw
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if not rows or [h.strip() for h in rows[0]] != HEADER:
        raise GateError("header mismatch: %r" % (rows[0] if rows else None))
    best = {}
    for r in rows[1:]:
        if not r:
            continue
        if len(r) != 7:
            raise GateError("garbled row (%d columns): %r" % (len(r), r[:2]))
        code, pts, start, end, en, zh, note = r
        code = code.strip()
        if not code or not re.fullmatch(r"\d{8}", start.strip()) or not re.fullmatch(r"\d{8}", end.strip()):
            raise GateError("garbled row: %r" % r[:4])
        if end.strip() < today.replace("-", ""):
            continue  # expired
        key = start.strip()
        if code not in best or key > best[code][0]:
            best[code] = (key, (clean(zh), clean(en), parse_points(pts), clean(note)))
    return {c: v[1] for c, v in best.items()}


# ---- enrichment keywords -------------------------------------------------
def norm(s):
    return unicodedata.normalize("NFKC", s).lower().replace("臺", "台")


def en_words(en):
    """ASCII words plus joined forms of hyphen/dot/ampersand compounds."""
    en = norm(en)
    w = set(re.findall(r"[a-z0-9]+", en))
    for m in re.findall(r"[a-z0-9]+(?:[-.&][a-z0-9]+)+", en):
        w.add(re.sub(r"[^a-z0-9]", "", m))
    return w


def abbreviations(en):
    out = set()
    for m in re.findall(r"\(([A-Z][A-Z0-9.\-&/]{1,})\)|(?<![A-Za-z0-9])((?:[A-Z]\.){2,}[A-Z]?\.?)|(?<![A-Za-z0-9.\-])([A-Z]{2,6}(?:-[A-Z0-9]{1,3})?)(?![A-Za-z0-9])", en):
        tok = next(x for x in m if x)
        parts = [p for p in re.split(r"[-/]", tok) if p]
        out.add(re.sub(r"[^a-z0-9]", "", tok.lower()))
        if "-" in tok or "/" in tok:
            out.update(re.sub(r"[^a-z0-9]", "", p.lower()) for p in parts)
    return {a for a in out if len(a) >= 2}


def split_desc(desc):
    """Port of splitDesc() in tests/legacy_search.js."""
    last = max((i for i, ch in enumerate(desc) if "一" <= ch <= "龥"), default=-1)
    if last == -1:
        zh, en = "", desc
    else:
        cut = last + 1
        m = re.match(r"^(\s*[)）])", desc[cut:])
        if m:
            cut += len(m.group(0))
        zh, en = desc[:cut].strip(), desc[cut:].strip()
    return re.sub(r"^[-－]\s*", "", zh), re.sub(r"^[-－]\s*", "", en)


def keywords(code, zh, en, old):
    ozh, oen = old
    ntxt_zh, words = norm(zh), en_words(en)
    kw = set()
    plain = set(re.findall(r"[a-z0-9]+", norm(en)))
    for a in abbreviations(oen) | abbreviations(en):
        if a not in plain:  # e.g. S.T.S.G -> stsg
            kw.add(a)
    for w in en_words(oen) - words:
        if len(w) >= 2 and w not in STOP:
            kw.add(w)
    for run in re.findall(r"[㐀-鿿]+", norm(ozh)):
        if run not in ntxt_zh:
            kw.add(run)
    return " ".join(sorted(kw))


def load_enrich(path):
    d = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) == 3:
                d[p[0]] = (p[1], p[2])
    return d


# ---- gates + build ---------------------------------------------------------
def check_gates(off, prev_points):
    if len(off) < 5000:
        raise GateError("only %d rows (< 5000)" % len(off))
    for c in MUST_HAVE:
        if c not in off:
            raise GateError("required code %s missing" % c)
    if prev_points:
        gone = [c for c in prev_points if c not in off]
        if len(gone) > 0.15 * len(prev_points):
            raise GateError("%d of %d previous codes disappeared (> 15%%)" % (len(gone), len(prev_points)))
        common = [c for c in prev_points if c in off]
        changed = [c for c in common if prev_points[c] != off[c][2]]
        if common and len(changed) > 0.30 * len(common):
            raise GateError("%d of %d point values changed (> 30%%)" % (len(changed), len(common)))


def build(raw, today, enrich, prev_points=None):
    off = read_official(raw, today)
    check_gates(off, prev_points)
    rows = []
    for c, (zh, en, pts, note) in sorted(off.items()):
        old = enrich.get(c, ("", ""))
        en = en or old[1]  # official English name blank -> keep the hand-curated one from the old data
        rows.append([c, zh, en, pts, note, keywords(c, zh, en, old)])
    doc = {"v": 2, "date": today, "source": SOURCE, "count": len(rows), "rows": rows}
    return doc, off


def report(off, prev_points):
    if not prev_points:
        print("change report: no previous nhi.json (first build); %d codes" % len(off))
        return
    added = sorted(set(off) - set(prev_points))
    removed = sorted(set(prev_points) - set(off))
    chg = [(c, prev_points[c], off[c][2]) for c in sorted(set(off) & set(prev_points)) if prev_points[c] != off[c][2]]
    print("change report: %d added, %d removed, %d point changes (of %d common)" % (len(added), len(removed), len(chg), len(set(off) & set(prev_points))))
    for label, lst in (("added", added), ("removed", removed)):
        if lst:
            print("  %s: %s%s" % (label, " ".join(lst[:20]), " ..." if len(lst) > 20 else ""))
    for c, a, b in chg[:30]:
        print("  %s: %s -> %s" % (c, a, b))
    if len(chg) > 30:
        print("  ... %d more point changes" % (len(chg) - 30))


def load_prev(path):
    try:
        with open(path, encoding="utf-8") as f:
            return {r[0]: r[3] for r in json.load(f)["rows"]}
    except (OSError, ValueError, KeyError, IndexError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fetch", action="store_true", help="download the official CSV")
    ap.add_argument("--csv", help="use a local CSV instead of downloading")
    ap.add_argument("--out", default="nhi.json")
    ap.add_argument("--enrich", default=os.path.join(HERE, "nhi_enrich.tsv"))
    ap.add_argument("--today", default=datetime.date.today().isoformat(), help="YYYY-MM-DD (tests)")
    a = ap.parse_args(argv)
    try:
        datetime.date.fromisoformat(a.today)
        if a.csv:
            raw = open(a.csv, "rb").read()
        elif a.fetch:
            raw = fetch()
        else:
            ap.error("give --fetch or --csv PATH")
        prev = load_prev(a.out)
        doc, off = build(raw, a.today, load_enrich(a.enrich), prev)
    except (GateError, UnicodeDecodeError) as e:
        print("GATE FAILED: %s -- %s left untouched" % (e, a.out), file=sys.stderr)
        return 1
    except OSError as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 1
    report(off, prev)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, a.out)
    print("wrote %s: %d rows, %d bytes" % (a.out, doc["count"], os.path.getsize(a.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
