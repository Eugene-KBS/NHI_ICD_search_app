#!/usr/bin/env python3
"""Build icd_alias.txt from the CDC ICD-10-CM 2023 Alphabetic Index XML (stdlib only).
Usage: python3 -I tools/build_icd_alias.py INDEX_XML [--icd icd.txt] [--out icd_alias.txt]
Source zip: https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2023/icd10cm-Tabular-Index-2023.zip
(use icd10cm-index-2023.xml inside it). Output: `code|term; term; ...`, sorted by code."""
import argparse, os, re, sys
import xml.etree.ElementTree as ET

DROP = {"nec", "nos"}


def text(el):
    return "".join(el.itertext()) if el is not None else ""


def flat(s):
    """lowercase, parentheses kept as words, punctuation stripped, no '|' or ';'."""
    s = re.sub(r"['’]s\b", "", s.lower()).replace("'", "").replace("’", "")
    return " ".join(w for w in re.findall(r"[a-z0-9]+", s) if w not in DROP)


def own_title(el):
    t = el.find("title")
    return "".join([t.text or ""] + [x.tail or "" for x in t]) if t is not None else ""


def clean_code(c):
    return c.strip().rstrip("-").rstrip(".")


def alternatives(title_text):
    """Index titles list synonyms with commas ("Keloid, cheloid"); split at depth-0 commas."""
    parts, depth, cur = [], 0, ""
    for ch in title_text.replace("(s)", ""):
        depth += (ch == "(") - (ch == ")")
        if ch == "," and depth <= 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [f for f in (flat(x) for x in parts) if f]


def walk(main, add):
    """Call add(code, term) for the main term and level 1-2 subterms: each synonym of the node
    is appended to the first synonym of its ancestors."""
    def rec(el, prefix, level):
        alts = alternatives(text(el.find("title")))
        if not alts:
            return
        c = el.findtext("code")
        if c:
            for alt in alts:
                add(clean_code(c), (prefix + " " + alt).strip())
        if level < 2:
            for sub in el.findall("term"):
                rec(sub, (prefix + " " + alts[0]).strip(), level + 1)
    rec(main, "", 0)


def build(xml_path, icd_path):
    en = {}
    with open(icd_path, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("|")
            if len(p) >= 3:
                en[p[0].strip()] = set(re.findall(r"[a-z0-9]+", p[2].lower()))
    terms, by_key, sees = {}, {}, []

    def add(code, term):
        terms.setdefault(code, []).append(term)

    for _, el in ET.iterparse(xml_path):
        if el.tag != "mainTerm":
            continue
        walk(el, add)
        # trivial `see X`: main term with no code of its own and a see target
        see = el.findtext("see")
        key = flat(own_title(el))
        if key and el.find("code") is None and see and not el.findall("term"):
            sees.append((flat(text(el.find("title"))), see))
        by_key.setdefault(key, el)  # elements are kept (not cleared) for see-resolution
    # resolve `see` targets: "Main, sub" -> main term (+ level-1 subterm) with codes
    for alias, target in sees:
        parts = [flat(x) for x in target.split(",")]
        node, ok = by_key.get(parts[0]), True
        if node is None:
            continue
        for sub in parts[1:]:
            nxt = [s for s in node.findall("term") if flat(own_title(s)) == sub]
            if len(nxt) != 1:
                ok = False
                break
            node = nxt[0]
        c = node.findtext("code") if ok else None
        if c:
            add(clean_code(c), alias)
    out = {}
    for code, lst in terms.items():
        if code not in en:
            continue
        seen, keep = set(), []
        for t in lst:
            if t and t not in seen and not set(t.split()) <= en[code]:
                seen.add(t)
                keep.append(t)
        if keep:
            out[code] = keep
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("xml")
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--icd", default=os.path.join(here, "icd.txt"))
    ap.add_argument("--out", default=os.path.join(here, "icd_alias.txt"))
    a = ap.parse_args(argv)
    out = build(a.xml, a.icd)
    with open(a.out, "w", encoding="utf-8") as f:
        for code in sorted(out):
            f.write("%s|%s\n" % (code, "; ".join(out[code])))
    print("wrote %s: %d codes, %d bytes" % (a.out, len(out), os.path.getsize(a.out)))


if __name__ == "__main__":
    sys.exit(main())
