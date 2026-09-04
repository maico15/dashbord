#!/usr/bin/env python
"""Seed a monthly review into the database from the static JS data module.

The August 2026 review lived in `frontend/src/data/august2026.js` and shipped
with the frontend bundle, so a typo needed a deploy. This script moves one such
file into the monthly_review_* tables, after which the file can be deleted and
the content edited through /api/monthly-review.

It is kept in the repo as the record of how the August data got into the
database, and so a future static review can be imported the same way.

Usage:
    export DATABASE_URL=postgresql://...
    python scripts/migrate_review_to_db.py --dry-run
    python scripts/migrate_review_to_db.py

The parse is deliberately narrow: the data module is a literal — objects of
string keys and single-quoted strings, no expressions — so it is converted to
JSON and loaded rather than executed. Anything the converter does not
understand raises instead of guessing.

Re-running replaces that month's rows (delete + insert in one transaction), so
the script is idempotent. It refuses to overwrite a month whose row count has
grown since the last import unless --force is given, since that means someone
has edited the review through the API and re-importing would discard their work.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

DEFAULT_SOURCE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "src", "data", "august2026.js"
)

# Engineer key in the JS file -> team_members.id. The file carried this map as
# ENGINEER_IDS; it is duplicated here so the script still works once the file is
# deleted and someone wants to re-read this to see what happened.
ENGINEER_IDS = {
    "brunetkin": 1, "malyshev": 10, "roman": 12, "pogrebnyak": 13, "kudlaev": 14,
    "bachinskiy": 15, "azizbek": 16, "minin": 18, "shawn": 19, "yevhenii": 21,
}


def _js_object_to_json(src: str) -> str:
    """Convert a JS object literal to JSON.

    Handles what these data modules actually contain and nothing else:
    single-quoted strings (with \\' escapes), unquoted keys, and trailing
    commas. Double-quoted strings pass through. Comments must already be gone.
    """
    out = []
    i = 0
    n = len(src)
    while i < n:
        ch = src[i]
        if ch == "'":
            # Single-quoted string -> JSON double-quoted string.
            j = i + 1
            buf = []
            while j < n:
                if src[j] == "\\":
                    nxt = src[j + 1]
                    # \' is just ' in JSON; keep other escapes as-is.
                    buf.append(nxt if nxt == "'" else "\\" + nxt)
                    j += 2
                    continue
                if src[j] == "'":
                    break
                buf.append(src[j])
                j += 1
            else:
                raise ValueError("unterminated string in source")
            out.append(json.dumps("".join(buf)))
            i = j + 1
            continue
        if ch == '"':
            j = src.index('"', i + 1)
            out.append(src[i:j + 1])
            i = j + 1
            continue
        out.append(ch)
        i += 1

    text = "".join(out)
    # Unquoted object keys -> quoted.
    text = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)", r'\1"\2"\3', text)
    # Trailing commas before a close.
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return text


def _extract(src: str, name: str):
    """Pull `export const <name> = <literal>;` out of the module."""
    m = re.search(r"export\s+const\s+" + name + r"\s*=\s*", src)
    if not m:
        raise ValueError("export not found: " + name)
    start = m.end()
    opener = src[start]
    closer = {"{": "}", "[": "]"}.get(opener)
    if not closer:
        raise ValueError(name + " is not an object or array literal")

    depth = 0
    i = start
    in_str = None
    while i < len(src):
        ch = src[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
        elif ch in "'\"":
            in_str = ch
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return json.loads(_js_object_to_json(src[start:i + 1]))
        i += 1
    raise ValueError("unbalanced literal for " + name)


def _strip_comments(src: str) -> str:
    """Remove // line comments that start a line. Inline // inside strings (URLs)
    is left alone by only matching comments at the start of a line."""
    return "\n".join(
        "" if line.lstrip().startswith("//") else line
        for line in src.splitlines()
    )


def load_module(path: str):
    src = _strip_comments(open(path, encoding="utf-8").read())
    return {
        "period": _extract(src, "PERIOD"),
        "assumptions": _extract(src, "ASSUMPTIONS"),
        "summary": _extract(src, "SUMMARY"),
        "tones": _extract(src, "SUMMARY_TONES"),
        "engineers": _extract(src, "ENGINEERS"),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="path to the review .js module")
    ap.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    ap.add_argument("--force", action="store_true",
                    help="overwrite even if the month looks edited since import")
    args = ap.parse_args()

    data = load_module(os.path.abspath(args.source))
    month = data["period"]["month"]
    year = data["period"]["year"]
    summary = data["summary"]["en"]
    summary_ru = data["summary"]["ru"]
    tones = data["tones"]
    engineers = data["engineers"]

    if len(summary) != len(summary_ru):
        raise SystemExit("SUMMARY en/ru lengths differ: %d vs %d" % (len(summary), len(summary_ru)))
    if len(tones) != len(summary):
        raise SystemExit("SUMMARY_TONES has %d entries for %d cards" % (len(tones), len(summary)))

    task_total = sum(len(e["tasks"]) for e in engineers)
    print("Source:    %s" % args.source)
    print("Period:    %02d/%d  (%s)" % (month, year, data["period"]["label"]["en"]))
    print("Summary:   %d cards  tones=%s" % (len(summary), ",".join(tones)))
    print("Engineers: %d" % len(engineers))
    print("Tasks:     %d" % task_total)

    unknown = [e["id"] for e in engineers if e["id"] not in ENGINEER_IDS]
    if unknown:
        raise SystemExit("no team_members id mapped for: %s" % ", ".join(unknown))

    for e in engineers:
        print("  %-12s id=%-3s %d tasks" % (e["id"], ENGINEER_IDS[e["id"]], len(e["tasks"])))

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    from database import get_db  # imported late so --dry-run needs no DATABASE_URL

    conn = get_db()
    now = datetime.utcnow().isoformat()

    have = conn.execute(
        "SELECT COUNT(*) FROM monthly_review_tasks WHERE month=? AND year=?", (month, year)
    ).fetchone()[0]
    if have and have != task_total and not args.force:
        conn.close()
        raise SystemExit(
            "refusing to overwrite: %02d/%d already has %d tasks in the database but the "
            "source file has %d. Someone has probably edited the review through the API. "
            "Re-run with --force to replace it anyway." % (month, year, have, task_total)
        )

    for table in ("monthly_review_tasks", "monthly_review_engineers",
                  "monthly_review_summary", "monthly_review_meta"):
        conn.execute("DELETE FROM %s WHERE month=? AND year=?" % table, (month, year))

    conn.execute(
        "INSERT INTO monthly_review_meta "
        "(month, year, label_en, label_ru, assumptions_en, assumptions_ru, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (month, year, data["period"]["label"]["en"], data["period"]["label"]["ru"],
         data["assumptions"]["en"], data["assumptions"]["ru"], now),
    )

    for i, (en, ru, tone) in enumerate(zip(summary, summary_ru, tones)):
        conn.execute(
            "INSERT INTO monthly_review_summary "
            "(month, year, sort_order, label_en, label_ru, value, sub_en, sub_ru, tone, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (month, year, i, en["label"], ru["label"], en["value"],
             en["sub"], ru["sub"], tone, now),
        )

    order = 0
    for i, e in enumerate(engineers):
        eid = ENGINEER_IDS[e["id"]]
        conn.execute(
            "INSERT INTO monthly_review_engineers "
            "(month, year, engineer_id, name_ru, role_en, role_ru, sort_order, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (month, year, eid, e["name"]["ru"], e["role"]["en"], e["role"]["ru"], i, now),
        )
        for t in e["tasks"]:
            conn.execute(
                "INSERT INTO monthly_review_tasks "
                "(month, year, engineer_id, sort_order, title_en, title_ru, task_en, task_ru, "
                " goal_en, goal_ru, benefit_en, benefit_ru, value_amount, value_note_en, "
                " value_note_ru, confidence, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (month, year, eid, order,
                 t["title"]["en"], t["title"]["ru"], t["task"]["en"], t["task"]["ru"],
                 t["goal"]["en"], t["goal"]["ru"], t["benefit"]["en"], t["benefit"]["ru"],
                 t["value"]["amount"], t["value"]["note"]["en"], t["value"]["note"]["ru"],
                 t["value"]["confidence"], now),
            )
            order += 1

    conn.commit()

    # Read back rather than trusting the inserts.
    counts = {}
    for table in ("monthly_review_meta", "monthly_review_summary",
                  "monthly_review_engineers", "monthly_review_tasks"):
        counts[table] = conn.execute(
            "SELECT COUNT(*) FROM %s WHERE month=? AND year=?" % table, (month, year)
        ).fetchone()[0]
    conn.close()

    print("\nWritten:")
    for table, count in counts.items():
        print("  %-28s %d" % (table, count))

    expected = {
        "monthly_review_meta": 1,
        "monthly_review_summary": len(summary),
        "monthly_review_engineers": len(engineers),
        "monthly_review_tasks": task_total,
    }
    if counts != expected:
        raise SystemExit("row counts do not match the source: expected %s" % expected)
    print("\nOK — counts match the source file.")


if __name__ == "__main__":
    main()
