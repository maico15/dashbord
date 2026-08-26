#!/usr/bin/env python3
"""Read-only row counts for the tables carried over by the SQLite -> Postgres
migration. Used as the before/after evidence that a deploy's init path did not
delete or modify migrated data.

    python scripts/pg_counts.py                    # print counts
    python scripts/pg_counts.py --save base.json   # print and save
    python scripts/pg_counts.py --compare base.json  # exit non-zero on any drift

DATABASE_URL is read from the environment or backend/.env.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

TABLES = [
    "gantt_assignments",
    "backlog_items",
    "weekly_tasks",
    "daily_reports",
    "ai_events",
    "score_rules",
    "team_members",
]


def counts():
    from database import engine  # noqa: E402  (needs sys.path tweak above)
    from sqlalchemy import text

    out = {}
    with engine.connect() as conn:
        for t in TABLES:
            out[t] = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--save")
    p.add_argument("--compare")
    args = p.parse_args()

    current = counts()
    width = max(len(t) for t in TABLES)
    for t in TABLES:
        print(f"  {t:<{width}}  {current[t]}")

    if args.save:
        with open(args.save, "w") as f:
            json.dump(current, f, indent=2, sort_keys=True)
        print(f"saved -> {args.save}")

    if args.compare:
        with open(args.compare) as f:
            baseline = json.load(f)
        drift = {t: (baseline.get(t), current[t])
                 for t in TABLES if baseline.get(t) != current[t]}
        if drift:
            for t, (was, now) in drift.items():
                print(f"DRIFT {t}: {was} -> {now}")
            sys.exit(1)
        print("UNCHANGED: all counts identical to baseline")


if __name__ == "__main__":
    main()
