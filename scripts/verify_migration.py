#!/usr/bin/env python3
"""HTTP-level smoke / write-path / concurrency checks for the SQLite -> PostgreSQL
migration. Runs against a live server instance — this repo has no pytest suite, and
these checks need two separately-configured running instances (one per backend) to
be meaningful, so a plain script fits better than in-process tests.

Typical flow:
    # 1) against the current SQLite-backed instance:
    python scripts/verify_migration.py --base-url http://localhost:8000 \\
        --password admin123 --save-fixtures fixtures_sqlite.json

    # 2) point DATABASE_URL at Postgres, run scripts/migrate_sqlite_to_pg.py,
    #    restart the server, then:
    python scripts/verify_migration.py --base-url http://localhost:8000 \\
        --password admin123 --compare-fixtures fixtures_sqlite.json \\
        --write-path --concurrency

Exits non-zero if any check fails.
"""
import argparse
import json
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

SMOKE_ENDPOINTS = [
    "/api/overview",
    "/api/gantt",
    "/api/backlog",
    "/api/reports",
    "/api/weekly-tasks",
]


def request(base_url, method, path, password=None, body=None):
    url = base_url.rstrip("/") + path
    if password is not None:
        sep = "&" if "?" in url else "?"
        url += f"{sep}password={urllib.parse.quote(password)}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def fetch_smoke_fixtures(base_url):
    return {ep: request(base_url, "GET", ep)[1] for ep in SMOKE_ENDPOINTS}


def cmd_fixtures(args):
    fixtures = fetch_smoke_fixtures(args.base_url)
    if args.save_fixtures:
        with open(args.save_fixtures, "w") as f:
            json.dump(fixtures, f, indent=2, sort_keys=True)
        print(f"Saved fixtures for {len(fixtures)} endpoints to {args.save_fixtures}")
        return True
    with open(args.compare_fixtures) as f:
        baseline = json.load(f)
    ok = True
    for ep in SMOKE_ENDPOINTS:
        if fixtures.get(ep) != baseline.get(ep):
            ok = False
            print(f"MISMATCH {ep}")
            print(f"  baseline: {json.dumps(baseline.get(ep))[:300]}")
            print(f"  current:  {json.dumps(fixtures.get(ep))[:300]}")
        else:
            print(f"OK       {ep}")
    return ok


def cmd_write_path(args):
    ok = True
    base, pw = args.base_url, args.password

    # 1. create -> assign -> retire a backlog item
    status, created = request(base, "POST", "/api/backlog", pw, {"title": "verify-migration probe"})
    item_id = created.get("id")
    if status != 200 or not item_id:
        print(f"FAIL backlog create: status={status} body={created}")
        ok = False
    else:
        print(f"OK   backlog create -> id={item_id}")
        status, _ = request(base, "POST", f"/api/backlog/{item_id}/assign", pw,
                             {"engineer_id": 1, "start_date": "2026-01-05"})
        if status != 200:
            print(f"FAIL backlog assign: status={status}")
            ok = False
        else:
            print("OK   backlog assign")
        status, _ = request(base, "DELETE", f"/api/backlog/{item_id}", pw)
        if status != 200:
            print(f"FAIL backlog retire (delete): status={status}")
            ok = False
        else:
            print("OK   backlog retire")

    # 2. weekly-tasks upsert twice -> exactly one row for that engineer/week/year
    payload = {"engineer_id": 1, "week": 9001, "year": 2099, "tasks": "probe A"}
    request(base, "POST", "/api/weekly-tasks", pw, payload)
    payload["tasks"] = "probe B"
    request(base, "POST", "/api/weekly-tasks", pw, payload)
    status, rows = request(
        base, "GET", f"/api/weekly-tasks?week={payload['week']}&year={payload['year']}"
    )
    matches = [r for r in rows.get("tasks", []) if r["engineer_id"] == 1 and r["tasks"] == "probe B"]
    if status == 200 and len(matches) == 1:
        print("OK   weekly-tasks upsert twice -> 1 row")
    else:
        print(f"FAIL weekly-tasks upsert: status={status} matches={len(matches)}")
        ok = False

    # 3. apply-changes with a bad entry at index 1 must roll back index 0 too
    probe_title = "verify-migration rollback probe"
    changes = [
        {"type": "backlog_create", "fields": {"title": probe_title}, "tempId": "t1"},
        {"type": "not_a_real_type"},
    ]
    status, body = request(base, "POST", "/api/gantt/apply-changes", pw, {"changes": changes})
    status2, backlog = request(base, "GET", "/api/backlog")
    leaked = [b for b in backlog.get("items", []) if b.get("title") == probe_title]
    if status == 400 and not leaked:
        print("OK   apply-changes rolls back atomically on induced failure")
    else:
        print(f"FAIL apply-changes rollback: status={status} leaked={len(leaked)}")
        ok = False

    return ok


def cmd_concurrency(args):
    base, pw = args.base_url, args.password
    results = [None, None]

    def worker(i, title):
        results[i] = request(base, "POST", "/api/gantt/apply-changes", pw, {
            "changes": [{"type": "backlog_create", "fields": {"title": title}}]
        })

    threads = [
        threading.Thread(target=worker, args=(0, "verify-migration concurrent A")),
        threading.Thread(target=worker, args=(1, "verify-migration concurrent B")),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    server_errors = [r for r in results if r is None or r[0] >= 500]
    status, backlog = request(base, "GET", "/api/backlog")
    created = [b for b in backlog.get("items", [])
               if b.get("title", "").startswith("verify-migration concurrent")]

    ok = not server_errors and len(created) == 2
    print(f"{'OK  ' if ok else 'FAIL'} concurrent apply-changes: "
          f"server_errors={len(server_errors)} rows_created={len(created)}")

    # cleanup
    for b in created:
        request(base, "DELETE", f"/api/backlog/{b['id']}", pw)
    return ok


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", required=True)
    p.add_argument("--password", default="admin123")
    p.add_argument("--save-fixtures")
    p.add_argument("--compare-fixtures")
    p.add_argument("--write-path", action="store_true")
    p.add_argument("--concurrency", action="store_true")
    args = p.parse_args()

    ran_any = False
    ok = True

    if args.save_fixtures or args.compare_fixtures:
        ran_any = True
        ok = cmd_fixtures(args) and ok
    if args.write_path:
        ran_any = True
        ok = cmd_write_path(args) and ok
    if args.concurrency:
        ran_any = True
        ok = cmd_concurrency(args) and ok

    if not ran_any:
        p.error("pass at least one of --save-fixtures/--compare-fixtures/--write-path/--concurrency")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
