from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import sqlite3
import random
import json as json_lib
import time as time_lib
import base64
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler

DB_PATH = "dashboard.db"
ADMIN_PASSWORD = "admin123"


def _load_password():
    """Override ADMIN_PASSWORD from config if a custom one was saved."""
    global ADMIN_PASSWORD
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("SELECT value FROM config WHERE key='admin_password'")
        row = c.fetchone()
        if row and row["value"]:
            ADMIN_PASSWORD = row["value"]
    except Exception:
        pass
    finally:
        conn.close()


scheduler = BackgroundScheduler(timezone="UTC")


@asynccontextmanager
async def lifespan(app):
    init_db()
    # Only seed if no engineers exist yet
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM team_members").fetchone()[0]
    conn.close()
    if count == 0:
        seed_data()
    _load_password()
    scheduler.add_job(_run_jira_sync, 'cron', hour=2, minute=0, id='jira_daily_sync', replace_existing=True)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Engineering Dashboard API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            stream TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#00cfff'
        );

        CREATE TABLE IF NOT EXISTS dev_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL DEFAULT 2025,
            prs_merged INTEGER DEFAULT 0,
            tickets_closed INTEGER DEFAULT 0,
            cycle_time_days REAL DEFAULT 0.0,
            features_completed INTEGER DEFAULT 0,
            deploys INTEGER DEFAULT 0,
            UNIQUE(member_id, week, year)
        );

        CREATE TABLE IF NOT EXISTS support_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL DEFAULT 2025,
            incidents_opened INTEGER DEFAULT 0,
            incidents_resolved INTEGER DEFAULT 0,
            avg_resolution_hours REAL DEFAULT 0.0,
            sla_breached INTEGER DEFAULT 0,
            total_incidents INTEGER DEFAULT 0,
            UNIQUE(member_id, week, year)
        );

        CREATE TABLE IF NOT EXISTS docs_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL DEFAULT 2025,
            docs_created INTEGER DEFAULT 0,
            docs_updated INTEGER DEFAULT 0,
            projects_covered INTEGER DEFAULT 0,
            projects_total INTEGER DEFAULT 10,
            UNIQUE(member_id, week, year)
        );

        CREATE TABLE IF NOT EXISTS score_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stream TEXT NOT NULL,
            rule_key TEXT NOT NULL,
            label TEXT NOT NULL,
            points INTEGER NOT NULL,
            condition TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS ai_usage_cache (
            key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            cached_at REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS weekly_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            week_number INTEGER NOT NULL,
            year INTEGER NOT NULL,
            what_was_done TEXT NOT NULL DEFAULT '[]',
            next_week TEXT NOT NULL DEFAULT '[]',
            stream TEXT NOT NULL DEFAULT 'dev',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(engineer_id, week_number, year)
        );

        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT NOT NULL DEFAULT 'jira',
            timestamp TEXT NOT NULL,
            status TEXT NOT NULL,
            records_updated INTEGER DEFAULT 0,
            error TEXT DEFAULT NULL
        );
    """)
    conn.commit()
    try:
        conn.execute("ALTER TABLE dev_metrics ADD COLUMN blocked_count INTEGER DEFAULT 0")
        conn.commit()
    except Exception:
        pass
    conn.close()


def seed_data():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM team_members")
    if c.fetchone()[0] > 0:
        conn.close()
        return

    # DO NOT CHANGE THESE NAMES
    all_streams = json_lib.dumps(["dev", "support", "docs"])
    members = [
        ("Andrey Brunetkin",   all_streams, "#00cfff"),
        ("Andrey Pogrebnyak",  all_streams, "#7b61ff"),
        ("Evgeniy Vinogradov", all_streams, "#00ff9d"),
    ]
    c.executemany("INSERT INTO team_members (name, stream, avatar_color) VALUES (?,?,?)", members)
    conn.commit()

    c.execute("SELECT id, stream FROM team_members ORDER BY id")
    rows = [dict(r) for r in c.fetchall()]

    rng = random.Random(42)
    now = datetime.now().isocalendar()
    current_week = now[1]
    current_year = now[0]

    for wo in range(8):
        w = current_week - 7 + wo
        if w <= 0:
            w += 52
        for row in rows:
            mid = row["id"]
            for stream in parse_streams(row["stream"]):
                if stream == "dev":
                    ct = round(rng.uniform(0.5, 4.5), 1)
                    c.execute(
                        "INSERT OR IGNORE INTO dev_metrics "
                        "(member_id,week,year,prs_merged,tickets_closed,cycle_time_days,features_completed,deploys) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (mid, w, current_year,
                         rng.randint(2, 9), rng.randint(3, 12), ct,
                         rng.randint(1, 4), rng.randint(1, 6)),
                    )
                elif stream == "support":
                    opened = rng.randint(2, 8)
                    resolved = rng.randint(max(1, opened - 2), opened)
                    c.execute(
                        "INSERT OR IGNORE INTO support_metrics "
                        "(member_id,week,year,incidents_opened,incidents_resolved,avg_resolution_hours,sla_breached,total_incidents) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (mid, w, current_year,
                         opened, resolved,
                         round(rng.uniform(0.5, 6.0), 1),
                         rng.randint(0, 2), opened),
                    )
                elif stream == "docs":
                    c.execute(
                        "INSERT OR IGNORE INTO docs_metrics "
                        "(member_id,week,year,docs_created,docs_updated,projects_covered,projects_total) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (mid, w, current_year,
                         rng.randint(1, 5), rng.randint(2, 9),
                         rng.randint(5, 9), 10),
                    )

    rules = [
        ("dev", "pr_merged", "PR merged", 50, None),
        ("dev", "ticket_closed", "Ticket closed", 40, None),
        ("dev", "fast_cycle", "Cycle time < 2 days (bonus)", 30, '{"metric":"cycle_time_days","lt":2}'),
        ("support", "incident_resolved", "Incident resolved", 80, None),
        ("support", "fast_resolve", "Resolved < 2h (bonus)", 50, '{"metric":"avg_resolution_hours","lt":2}'),
        ("support", "sla_breached", "SLA breached", -40, None),
        ("docs", "doc_created", "Doc created", 30, None),
        ("docs", "doc_updated", "Doc updated", 15, None),
        ("docs", "no_docs_penalty", "Project without docs > 2w", -20, None),
    ]
    c.executemany(
        "INSERT INTO score_rules (stream,rule_key,label,points,condition) VALUES (?,?,?,?,?)",
        rules,
    )

    cfg = [
        ("github_token", ""),
        ("jira_token", ""),
        ("jira_domain", ""),
        ("jira_email", ""),
        ("jira_api_token", ""),
        ("jira_project_keys", "[]"),
        ("jira_username_map", "{}"),
        ("anthropic_admin_key", ""),
        ("ai_auto_sync", "0"),
        ("team_name", "Engineering Squad"),
        ("current_week", str(current_week)),
        ("current_year", str(current_year)),
    ]
    c.executemany("INSERT OR IGNORE INTO config (key,value) VALUES (?,?)", cfg)
    conn.commit()
    conn.close()


# ── Score helpers ──────────────────────────────────────────────────────────────

def get_rules(conn) -> list:
    c = conn.cursor()
    c.execute("SELECT * FROM score_rules")
    return [dict(r) for r in c.fetchall()]


def rule_pts(rules, key):
    for r in rules:
        if r["rule_key"] == key:
            return r["points"]
    return 0


def parse_streams(stream_val) -> list:
    """Parse stream field (plain string or JSON array) into a list of stream names."""
    if isinstance(stream_val, list):
        return stream_val
    if stream_val and stream_val.startswith('['):
        try:
            return json_lib.loads(stream_val)
        except Exception:
            pass
    return [stream_val] if stream_val else ['dev']


def calc_dev(m, rules):
    pts = 0
    bd = {}
    bd["pr_merged"] = m["prs_merged"] * rule_pts(rules, "pr_merged")
    bd["ticket_closed"] = m["tickets_closed"] * rule_pts(rules, "ticket_closed")
    bd["fast_cycle"] = rule_pts(rules, "fast_cycle") if m["cycle_time_days"] < 2 else 0
    for v in bd.values():
        pts += v
    return pts, bd


def calc_support(m, rules):
    pts = 0
    bd = {}
    bd["incident_resolved"] = m["incidents_resolved"] * rule_pts(rules, "incident_resolved")
    bd["fast_resolve"] = (
        rule_pts(rules, "fast_resolve")
        if m["avg_resolution_hours"] < 2 and m["incidents_resolved"] > 0
        else 0
    )
    bd["sla_breached"] = m["sla_breached"] * rule_pts(rules, "sla_breached")
    for v in bd.values():
        pts += v
    return pts, bd


def calc_docs(m, rules):
    pts = 0
    bd = {}
    bd["doc_created"] = m["docs_created"] * rule_pts(rules, "doc_created")
    bd["doc_updated"] = m["docs_updated"] * rule_pts(rules, "doc_updated")
    uncovered = m["projects_total"] - m["projects_covered"]
    bd["no_docs_penalty"] = uncovered * rule_pts(rules, "no_docs_penalty") if uncovered > 0 else 0
    for v in bd.values():
        pts += v
    return pts, bd


def current_week_year(conn):
    c = conn.cursor()
    c.execute("SELECT key,value FROM config WHERE key IN ('current_week','current_year')")
    cfg = {r["key"]: int(r["value"]) for r in c.fetchall()}
    now = datetime.now().isocalendar()
    return cfg.get("current_week", now[1]), cfg.get("current_year", now[0])


# ── AI Usage helpers ──────────────────────────────────────────────────────────

ANTHROPIC_BASE = "https://api.anthropic.com"
AI_CACHE_TTL = 3600  # seconds


def _anthropic_get(path: str, admin_key: str) -> dict:
    req = urllib.request.Request(
        ANTHROPIC_BASE + path,
        headers={
            "anthropic-version": "2023-06-01",
            "x-api-key": admin_key,
            "anthropic-beta": "usage-2025-01",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json_lib.loads(resp.read())


def _mock_ai_usage(conn) -> dict:
    c = conn.cursor()
    c.execute("SELECT * FROM team_members ORDER BY id")
    members = [dict(r) for r in c.fetchall()]

    rng = random.Random(77)
    end = datetime.now()

    tokens_per_day = []
    for i in range(30):
        dt = end - timedelta(days=29 - i)
        base = rng.randint(15_000, 80_000)
        tokens = int(base * (0.2 if dt.weekday() >= 5 else 1.0))
        tokens_per_day.append({"date": dt.strftime("%Y-%m-%d"), "tokens": tokens})

    tokens_per_user = []
    for m in members:
        tok = rng.randint(25_000, 280_000)
        tokens_per_user.append({
            "name": m["name"],
            "full_name": m["name"],
            "member_id": m["id"],
            "stream": m["stream"],
            "tokens": tok,
            "input_tokens": int(tok * 0.72),
            "output_tokens": int(tok * 0.28),
        })
    tokens_per_user.sort(key=lambda x: x["tokens"], reverse=True)

    # 8 weeks of per-engineer weekly token data
    weeks_data = []
    for w in range(7, -1, -1):
        week_dt = end - timedelta(weeks=w)
        week_label = f"W{week_dt.isocalendar()[1]}"
        row: dict = {"week": week_label, "team": 0}
        for m in members:
            tok = rng.randint(8_000, 55_000)
            row[m["name"]] = tok
            row["team"] += tok
        weeks_data.append(row)

    total = sum(d["tokens"] for d in tokens_per_day)
    return {
        "total_tokens": total,
        "total_cost_usd": round(total * 0.000003, 2),
        "tokens_per_day": tokens_per_day,
        "tokens_per_user": tokens_per_user,
        "tokens_per_week": weeks_data,
        "source": "mock",
    }


def _live_ai_usage(admin_key: str, conn) -> dict:
    end = datetime.now()
    start = end - timedelta(days=30)
    qs = f"?start_date={start.strftime('%Y-%m-%d')}&end_date={end.strftime('%Y-%m-%d')}"

    ws_data = _anthropic_get(f"/v1/usage/workspaces{qs}", admin_key)
    user_data = _anthropic_get(f"/v1/usage/workspaces/users{qs}", admin_key)

    day_map: dict = {}
    total_tokens = 0
    for item in ws_data.get("data", []):
        date = (item.get("created_at") or item.get("date") or "")[:10]
        tok = item.get("input_tokens", 0) + item.get("output_tokens", 0)
        day_map[date] = day_map.get(date, 0) + tok
        total_tokens += tok

    tokens_per_day = [{"date": k, "tokens": v} for k, v in sorted(day_map.items())]

    tokens_per_user = []
    for item in user_data.get("data", []):
        name = item.get("user_email") or item.get("user_id") or "Unknown"
        tok = item.get("input_tokens", 0) + item.get("output_tokens", 0)
        tokens_per_user.append({
            "name": name.split("@")[0],
            "full_name": name,
            "member_id": None,
            "stream": None,
            "tokens": tok,
            "input_tokens": item.get("input_tokens", 0),
            "output_tokens": item.get("output_tokens", 0),
        })
    tokens_per_user.sort(key=lambda x: x["tokens"], reverse=True)

    # Derive weekly data from daily totals + proportional user distribution
    week_map: dict = {}
    for d in tokens_per_day:
        try:
            dt_obj = datetime.strptime(d["date"], "%Y-%m-%d")
            wk = f"W{dt_obj.isocalendar()[1]}"
            week_map[wk] = week_map.get(wk, 0) + d["tokens"]
        except Exception:
            pass
    total_user_tok = sum(u["tokens"] for u in tokens_per_user)
    tokens_per_week = []
    for wk in sorted(week_map.keys()):
        team = week_map[wk]
        row: dict = {"week": wk, "team": team}
        for u in tokens_per_user:
            share = u["tokens"] / max(total_user_tok, 1)
            row[u["name"]] = round(team * share)
        tokens_per_week.append(row)

    return {
        "total_tokens": total_tokens,
        "total_cost_usd": round(total_tokens * 0.000003, 2),
        "tokens_per_day": tokens_per_day,
        "tokens_per_user": tokens_per_user,
        "tokens_per_week": tokens_per_week,
        "source": "api",
    }


def _compute_leverage(conn, tokens_per_user: list) -> list:
    c = conn.cursor()
    week, year = current_week_year(conn)
    c.execute("SELECT * FROM team_members ORDER BY id")
    members = [dict(r) for r in c.fetchall()]

    token_by_name = {u["name"].lower(): u for u in tokens_per_user}
    token_by_idx = {i: u for i, u in enumerate(tokens_per_user)}

    scores = []
    for i, m in enumerate(members):
        first = m["name"].split()[0].lower()
        ud = token_by_name.get(first) or token_by_idx.get(i) or {}
        tok = ud.get("tokens", 0)

        tasks = 0
        for ms in parse_streams(m["stream"]):
            if ms == "dev":
                c.execute(
                    "SELECT prs_merged, tickets_closed, deploys FROM dev_metrics "
                    "WHERE member_id=? AND week=? AND year=?", (m["id"], week, year)
                )
                row = c.fetchone()
                if row:
                    tasks += row["prs_merged"] + row["tickets_closed"] + row["deploys"]
            elif ms == "support":
                c.execute(
                    "SELECT incidents_resolved FROM support_metrics "
                    "WHERE member_id=? AND week=? AND year=?", (m["id"], week, year)
                )
                row = c.fetchone()
                if row:
                    tasks += row["incidents_resolved"]
            elif ms == "docs":
                c.execute(
                    "SELECT docs_created, docs_updated FROM docs_metrics "
                    "WHERE member_id=? AND week=? AND year=?", (m["id"], week, year)
                )
                row = c.fetchone()
                if row:
                    tasks += row["docs_created"] + row["docs_updated"]

        tok_k = tok / 1000
        leverage = round(tasks / max(tok_k, 0.1), 3)

        rng = random.Random(m["id"] * 13 + week)
        trend = random.choice(["up", "up", "stable", "down"])  # slightly optimistic mock
        scores.append({
            "id": m["id"],
            "name": m["name"],
            "stream": m["stream"],
            "avatar_color": m["avatar_color"],
            "tokens_used": tok,
            "tasks_completed": tasks,
            "leverage_score": leverage,
            "trend": trend,
        })

    scores.sort(key=lambda x: x["leverage_score"], reverse=True)
    return scores


def _get_or_fetch_ai_usage(conn, force: bool = False) -> dict:
    c = conn.cursor()
    if not force:
        c.execute("SELECT data, cached_at FROM ai_usage_cache WHERE key='main'")
        row = c.fetchone()
        if row and (time_lib.time() - row["cached_at"]) < AI_CACHE_TTL:
            return json_lib.loads(row["data"])

    c.execute("SELECT value FROM config WHERE key='anthropic_admin_key'")
    row = c.fetchone()
    admin_key = (row["value"] if row else "") or ""

    try:
        result = _live_ai_usage(admin_key, conn) if admin_key else _mock_ai_usage(conn)
    except Exception as exc:
        result = _mock_ai_usage(conn)
        result["api_error"] = str(exc)

    result["leverage_scores"] = _compute_leverage(conn, result["tokens_per_user"])

    c.execute(
        "INSERT OR REPLACE INTO ai_usage_cache (key, data, cached_at) VALUES (?,?,?)",
        ("main", json_lib.dumps(result), time_lib.time()),
    )
    conn.commit()
    return result


# ── Jira integration ─────────────────────────────────────────────────────────

def _jira_request(path: str, domain: str, email: str, token: str, params: dict = None) -> dict:
    creds = base64.b64encode(f"{email}:{token}".encode()).decode()
    url = f"https://{domain}/rest/api/3{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {creds}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json_lib.loads(resp.read())


def _jira_search(jql: str, fields: str, domain: str, email: str, token: str, max_results: int = 100) -> list:
    result = _jira_request("/search", domain, email, token, {
        "jql": jql,
        "fields": fields,
        "maxResults": max_results,
    })
    return result.get("issues", [])


def _do_jira_sync(conn) -> int:
    c = conn.cursor()
    c.execute(
        "SELECT key, value FROM config WHERE key IN "
        "('jira_domain','jira_email','jira_api_token','jira_project_keys','jira_username_map')"
    )
    cfg = {r["key"]: r["value"] for r in c.fetchall()}

    domain = (cfg.get("jira_domain") or "").strip()
    auth_email = (cfg.get("jira_email") or "").strip()
    token = (cfg.get("jira_api_token") or "").strip()

    if not domain or not auth_email or not token:
        raise ValueError("Jira credentials not configured")

    try:
        project_keys = json_lib.loads(cfg.get("jira_project_keys") or "[]")
    except Exception:
        project_keys = []
    try:
        username_map = json_lib.loads(cfg.get("jira_username_map") or "{}")
    except Exception:
        username_map = {}

    if not project_keys:
        raise ValueError("No Jira project keys configured")
    if not username_map:
        raise ValueError("No Jira username mapping configured")

    week, year = current_week_year(conn)
    projects_jql = ", ".join(project_keys)
    records_updated = 0

    for jira_email, engineer_name in username_map.items():
        c.execute("SELECT id FROM team_members WHERE name=?", (engineer_name,))
        row = c.fetchone()
        if not row:
            continue
        member_id = row["id"]

        # A + B: tickets closed this week and avg cycle time
        try:
            jql_closed = (
                f'project in ({projects_jql}) AND status changed to Done '
                f'DURING (startOfWeek(), endOfWeek()) AND assignee = "{jira_email}"'
            )
            issues = _jira_search(jql_closed, "created,resolutiondate,summary", domain, auth_email, token)
            tickets_closed = len(issues)

            cycle_times = []
            for issue in issues:
                flds = issue.get("fields", {})
                c_str = (flds.get("created") or "")[:19]
                r_str = (flds.get("resolutiondate") or "")[:19]
                if c_str and r_str:
                    try:
                        diff = (
                            datetime.fromisoformat(r_str) - datetime.fromisoformat(c_str)
                        ).total_seconds() / 86400
                        if diff >= 0:
                            cycle_times.append(diff)
                    except Exception:
                        pass
            avg_cycle = round(sum(cycle_times) / len(cycle_times), 2) if cycle_times else 0.0
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise ValueError("Invalid Jira credentials (401)")
            if e.code == 404:
                raise ValueError("Jira project not found (404)")
            tickets_closed, avg_cycle = 0, 0.0
        except Exception:
            tickets_closed, avg_cycle = 0, 0.0

        # D: blocked tickets count
        try:
            jql_blocked = (
                f'project in ({projects_jql}) AND assignee = "{jira_email}" '
                f'AND labels = "blocked" AND status != Done'
            )
            blocked_count = len(_jira_search(jql_blocked, "summary", domain, auth_email, token, 50))
        except Exception:
            blocked_count = 0

        # Upsert dev_metrics (preserve other fields like prs_merged)
        c.execute(
            "SELECT id FROM dev_metrics WHERE member_id=? AND week=? AND year=?",
            (member_id, week, year),
        )
        if c.fetchone():
            c.execute(
                "UPDATE dev_metrics SET tickets_closed=?, cycle_time_days=?, blocked_count=? "
                "WHERE member_id=? AND week=? AND year=?",
                (tickets_closed, avg_cycle, blocked_count, member_id, week, year),
            )
        else:
            c.execute(
                "INSERT INTO dev_metrics (member_id, week, year, tickets_closed, cycle_time_days, blocked_count) "
                "VALUES (?,?,?,?,?,?)",
                (member_id, week, year, tickets_closed, avg_cycle, blocked_count),
            )
        records_updated += 1

        # C: in-progress tickets → weekly_tasks
        try:
            jql_progress = (
                f'assignee = "{jira_email}" AND status in ("In Progress", "In Review") '
                f'ORDER BY updated DESC'
            )
            in_progress = [
                i.get("fields", {}).get("summary") or i.get("key", "")
                for i in _jira_search(jql_progress, "summary", domain, auth_email, token, 20)
            ]
        except Exception:
            in_progress = []

        if in_progress:
            c.execute(
                "SELECT id FROM weekly_tasks WHERE engineer_id=? AND week_number=? AND year=?",
                (member_id, week, year),
            )
            if c.fetchone():
                c.execute(
                    "UPDATE weekly_tasks SET what_was_done=? "
                    "WHERE engineer_id=? AND week_number=? AND year=?",
                    (json_lib.dumps(in_progress, ensure_ascii=False), member_id, week, year),
                )
            else:
                c.execute(
                    "INSERT INTO weekly_tasks (engineer_id, week_number, year, what_was_done, next_week, stream) "
                    "VALUES (?,?,?,?,?,?)",
                    (
                        member_id, week, year,
                        json_lib.dumps(in_progress, ensure_ascii=False),
                        json_lib.dumps([], ensure_ascii=False),
                        "dev",
                    ),
                )

    conn.commit()
    return records_updated


def _run_jira_sync() -> dict:
    conn = get_db()
    try:
        records = _do_jira_sync(conn)
        conn.execute(
            "INSERT INTO sync_log (service, timestamp, status, records_updated) VALUES (?,?,?,?)",
            ("jira", datetime.utcnow().isoformat(), "success", records),
        )
        conn.commit()
        return {"status": "success", "records_updated": records}
    except Exception as exc:
        try:
            conn.execute(
                "INSERT INTO sync_log (service, timestamp, status, records_updated, error) "
                "VALUES (?,?,?,?,?)",
                ("jira", datetime.utcnow().isoformat(), "error", 0, str(exc)),
            )
            conn.commit()
        except Exception:
            pass
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


# ── Jira sync endpoints ───────────────────────────────────────────────────────

@app.post("/api/sync/jira")
def sync_jira(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    result = _run_jira_sync()
    if result.get("status") == "error":
        err = result.get("error", "Sync failed")
        if "401" in err or "credentials" in err.lower():
            raise HTTPException(401, err)
        if "404" in err or "not found" in err.lower():
            raise HTTPException(404, err)
        raise HTTPException(500, err)
    return result


@app.get("/api/sync/jira/status")
def jira_sync_status(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM sync_log WHERE service='jira' ORDER BY id DESC LIMIT 1")
    row = c.fetchone()
    conn.close()
    if not row:
        return {"status": "never", "timestamp": None, "records_updated": 0, "error": None}
    return dict(row)


# ── Public routes ──────────────────────────────────────────────────────────────

@app.get("/api/overview")
def overview():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT key,value FROM config")
    cfg = {r["key"]: r["value"] for r in c.fetchall()}
    conn.close()
    return {
        "team_name": cfg.get("team_name", "Engineering Team"),
        "current_week": int(cfg.get("current_week", 1)),
        "current_year": int(cfg.get("current_year", 2025)),
    }


@app.get("/api/leaderboard")
def leaderboard():
    conn = get_db()
    c = conn.cursor()
    rules = get_rules(conn)
    week, year = current_week_year(conn)

    c.execute("SELECT * FROM team_members ORDER BY id")
    members = [dict(r) for r in c.fetchall()]

    board = []
    for m in members:
        mid = m["id"]
        streams = parse_streams(m["stream"])
        weekly_scores = []
        bd_total: Dict[str, int] = {}

        for wo in range(8):
            w = week - 7 + wo
            if w <= 0:
                w += 52

            sw = 0
            for stream in streams:
                if stream == "dev":
                    c.execute("SELECT * FROM dev_metrics WHERE member_id=? AND week=? AND year=?", (mid, w, year))
                    row = c.fetchone()
                    if row:
                        s2, bd = calc_dev(dict(row), rules)
                        sw += s2
                        for k, v in bd.items():
                            bd_total[k] = bd_total.get(k, 0) + v
                elif stream == "support":
                    c.execute("SELECT * FROM support_metrics WHERE member_id=? AND week=? AND year=?", (mid, w, year))
                    row = c.fetchone()
                    if row:
                        s2, bd = calc_support(dict(row), rules)
                        sw += s2
                        for k, v in bd.items():
                            bd_total[k] = bd_total.get(k, 0) + v
                elif stream == "docs":
                    c.execute("SELECT * FROM docs_metrics WHERE member_id=? AND week=? AND year=?", (mid, w, year))
                    row = c.fetchone()
                    if row:
                        s2, bd = calc_docs(dict(row), rules)
                        sw += s2
                        for k, v in bd.items():
                            bd_total[k] = bd_total.get(k, 0) + v

            weekly_scores.append(sw)

        total = sum(weekly_scores)

        # Badges
        badges = []
        if len(weekly_scores) >= 3:
            last3 = weekly_scores[-3:]
            if all(v > 0 for v in last3) and last3[-1] >= last3[-2] >= last3[-3]:
                badges.append("fire")
        if "support" in streams:
            breach_total = 0
            for wo in range(4):
                w2 = week - 3 + wo
                if w2 <= 0:
                    w2 += 52
                c.execute("SELECT sla_breached FROM support_metrics WHERE member_id=? AND week=? AND year=?", (mid, w2, year))
                row = c.fetchone()
                if row:
                    breach_total += row["sla_breached"]
            if breach_total == 0:
                badges.append("shield")
        if "docs" in streams:
            c.execute("SELECT docs_created FROM docs_metrics WHERE member_id=? AND week=? AND year=?", (mid, week, year))
            row = c.fetchone()
            if row and row["docs_created"] >= 3:
                badges.append("scribe")

        board.append({
            "id": mid,
            "name": m["name"],
            "stream": streams[0] if streams else "dev",
            "streams": streams,
            "avatar_color": m["avatar_color"],
            "total_score": total,
            "weekly_scores": weekly_scores,
            "breakdown": bd_total,
            "badges": badges,
        })

    board.sort(key=lambda x: x["total_score"], reverse=True)
    # MVP = top scorer
    if board:
        board[0]["badges"] = list(set(board[0]["badges"] + ["mvp"]))

    conn.close()
    return board


def _weeks_range(week):
    weeks = []
    for wo in range(8):
        w = week - 7 + wo
        if w <= 0:
            w += 52
        weeks.append(w)
    return weeks


@app.get("/api/metrics/dev")
def metrics_dev():
    conn = get_db()
    c = conn.cursor()
    rules = get_rules(conn)
    week, year = current_week_year(conn)

    c.execute("SELECT * FROM team_members")
    members = [m for m in [dict(r) for r in c.fetchall()] if "dev" in parse_streams(m["stream"])]
    weeks = _weeks_range(week)

    weekly_chart = []
    totals = {"prs_merged": 0, "tickets_closed": 0, "cycle_time_days": [], "features_completed": 0, "deploys": 0}
    bottlenecks = []

    for i, w in enumerate(weeks):
        wd = {"week": f"W{w}", "score": 0, "prs": 0, "tickets": 0, "deploys": 0}
        for m in members:
            c.execute("SELECT * FROM dev_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], w, year))
            row = c.fetchone()
            if row:
                row = dict(row)
                sc, _ = calc_dev(row, rules)
                wd["score"] += sc
                wd["prs"] += row["prs_merged"]
                wd["tickets"] += row["tickets_closed"]
                wd["deploys"] += row["deploys"]
                if i == 7:
                    totals["prs_merged"] += row["prs_merged"]
                    totals["tickets_closed"] += row["tickets_closed"]
                    totals["cycle_time_days"].append(row["cycle_time_days"])
                    totals["features_completed"] += row["features_completed"]
                    totals["deploys"] += row["deploys"]
        weekly_chart.append(wd)

    for m in members:
        c.execute("SELECT * FROM dev_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], week, year))
        row = c.fetchone()
        if row:
            row = dict(row)
            bottlenecks.append({
                "name": m["name"],
                "prs_merged": row["prs_merged"],
                "tickets_closed": row["tickets_closed"],
                "cycle_time_days": row["cycle_time_days"],
                "deploys": row["deploys"],
            })

    ct_list = totals["cycle_time_days"]
    avg_ct = round(sum(ct_list) / len(ct_list), 1) if ct_list else 0
    conn.close()
    return {
        "totals": {
            "prs_merged": totals["prs_merged"],
            "tickets_closed": totals["tickets_closed"],
            "avg_cycle_time": avg_ct,
            "features_completed": totals["features_completed"],
            "deploys": totals["deploys"],
            "deploy_frequency": round(totals["deploys"] / max(len(members), 1), 1),
        },
        "weekly_chart": weekly_chart,
        "bottlenecks": bottlenecks,
    }


@app.get("/api/metrics/support")
def metrics_support():
    conn = get_db()
    c = conn.cursor()
    rules = get_rules(conn)
    week, year = current_week_year(conn)

    c.execute("SELECT * FROM team_members")
    members = [m for m in [dict(r) for r in c.fetchall()] if "support" in parse_streams(m["stream"])]
    weeks = _weeks_range(week)

    weekly_chart = []
    totals = {"incidents_opened": 0, "incidents_resolved": 0, "avg_resolution_hours": [], "sla_breached": 0, "total_incidents": 0}
    bottlenecks = []

    for i, w in enumerate(weeks):
        wd = {"week": f"W{w}", "score": 0, "resolved": 0, "breached": 0}
        for m in members:
            c.execute("SELECT * FROM support_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], w, year))
            row = c.fetchone()
            if row:
                row = dict(row)
                sc, _ = calc_support(row, rules)
                wd["score"] += sc
                wd["resolved"] += row["incidents_resolved"]
                wd["breached"] += row["sla_breached"]
                if i == 7:
                    totals["incidents_opened"] += row["incidents_opened"]
                    totals["incidents_resolved"] += row["incidents_resolved"]
                    totals["avg_resolution_hours"].append(row["avg_resolution_hours"])
                    totals["sla_breached"] += row["sla_breached"]
                    totals["total_incidents"] += row["total_incidents"]
        weekly_chart.append(wd)

    for m in members:
        c.execute("SELECT * FROM support_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], week, year))
        row = c.fetchone()
        if row:
            row = dict(row)
            bottlenecks.append({
                "name": m["name"],
                "incidents_resolved": row["incidents_resolved"],
                "avg_resolution_hours": row["avg_resolution_hours"],
                "sla_breached": row["sla_breached"],
            })

    rh = totals["avg_resolution_hours"]
    avg_res = round(sum(rh) / len(rh), 1) if rh else 0
    ti = totals["total_incidents"]
    sla_pct = round(((ti - totals["sla_breached"]) / max(ti, 1)) * 100, 1)

    conn.close()
    return {
        "totals": {
            "incidents_opened": totals["incidents_opened"],
            "incidents_resolved": totals["incidents_resolved"],
            "avg_resolution_hours": avg_res,
            "sla_breached": totals["sla_breached"],
            "sla_percentage": sla_pct,
        },
        "weekly_chart": weekly_chart,
        "bottlenecks": bottlenecks,
    }


@app.get("/api/metrics/docs")
def metrics_docs():
    conn = get_db()
    c = conn.cursor()
    rules = get_rules(conn)
    week, year = current_week_year(conn)

    c.execute("SELECT * FROM team_members")
    members = [m for m in [dict(r) for r in c.fetchall()] if "docs" in parse_streams(m["stream"])]
    weeks = _weeks_range(week)

    weekly_chart = []
    totals = {"docs_created": 0, "docs_updated": 0, "projects_covered": 0, "projects_total": 0}
    bottlenecks = []

    for i, w in enumerate(weeks):
        wd = {"week": f"W{w}", "score": 0, "created": 0, "updated": 0}
        for m in members:
            c.execute("SELECT * FROM docs_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], w, year))
            row = c.fetchone()
            if row:
                row = dict(row)
                sc, _ = calc_docs(row, rules)
                wd["score"] += sc
                wd["created"] += row["docs_created"]
                wd["updated"] += row["docs_updated"]
                if i == 7:
                    totals["docs_created"] += row["docs_created"]
                    totals["docs_updated"] += row["docs_updated"]
                    totals["projects_covered"] = max(totals["projects_covered"], row["projects_covered"])
                    totals["projects_total"] = max(totals["projects_total"], row["projects_total"])
        weekly_chart.append(wd)

    for m in members:
        c.execute("SELECT * FROM docs_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], week, year))
        row = c.fetchone()
        if row:
            row = dict(row)
            bottlenecks.append({
                "name": m["name"],
                "docs_created": row["docs_created"],
                "docs_updated": row["docs_updated"],
                "projects_covered": row["projects_covered"],
                "projects_total": row["projects_total"],
            })

    cov = round((totals["projects_covered"] / max(totals["projects_total"], 1)) * 100, 1)
    conn.close()
    return {
        "totals": {
            "docs_created": totals["docs_created"],
            "docs_updated": totals["docs_updated"],
            "projects_covered": totals["projects_covered"],
            "projects_total": totals["projects_total"],
            "coverage_percentage": cov,
        },
        "weekly_chart": weekly_chart,
        "bottlenecks": bottlenecks,
    }


# ── Score rules ────────────────────────────────────────────────────────────────

@app.get("/api/score-rules")
def get_score_rules():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM score_rules ORDER BY stream, id")
    rules = [dict(r) for r in c.fetchall()]
    conn.close()
    return rules


class ScoreRuleUpdate(BaseModel):
    label: Optional[str] = None
    points: Optional[int] = None


@app.put("/api/score-rules/{rule_id}")
def update_score_rule(rule_id: int, data: ScoreRuleUpdate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    if data.label is not None:
        c.execute("UPDATE score_rules SET label=? WHERE id=?", (data.label, rule_id))
    if data.points is not None:
        c.execute("UPDATE score_rules SET points=? WHERE id=?", (data.points, rule_id))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Team members ───────────────────────────────────────────────────────────────

@app.get("/api/team")
def get_team():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM team_members ORDER BY name")
    members = []
    for r in c.fetchall():
        m = dict(r)
        m["streams"] = parse_streams(m["stream"])
        m["stream"] = m["streams"][0] if m["streams"] else "dev"
        members.append(m)
    conn.close()
    return members


class MemberCreate(BaseModel):
    name: str
    streams: Optional[list] = None
    stream: Optional[str] = None  # backward compat
    avatar_color: Optional[str] = "#00cfff"


class MemberUpdate(BaseModel):
    name: Optional[str] = None
    streams: Optional[list] = None
    stream: Optional[str] = None  # backward compat
    avatar_color: Optional[str] = None


@app.post("/api/team")
def create_member(data: MemberCreate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    streams = data.streams or ([data.stream] if data.stream else ["dev"])
    c.execute("INSERT INTO team_members (name, stream, avatar_color) VALUES (?,?,?)",
              (data.name, json_lib.dumps(streams), data.avatar_color))
    mid = c.lastrowid
    conn.commit()
    conn.close()
    return {"id": mid, "name": data.name, "streams": streams, "stream": streams[0], "avatar_color": data.avatar_color}


@app.put("/api/team/{member_id}")
def update_member(member_id: int, data: MemberUpdate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    if data.name is not None:
        c.execute("UPDATE team_members SET name=? WHERE id=?", (data.name, member_id))
    if data.streams is not None:
        c.execute("UPDATE team_members SET stream=? WHERE id=?",
                  (json_lib.dumps(data.streams), member_id))
    elif data.stream is not None:
        c.execute("UPDATE team_members SET stream=? WHERE id=?",
                  (json_lib.dumps([data.stream]), member_id))
    if data.avatar_color is not None:
        c.execute("UPDATE team_members SET avatar_color=? WHERE id=?", (data.avatar_color, member_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/team/{member_id}")
def delete_member(member_id: int, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM team_members WHERE id=?", (member_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Engineer profile & weekly tasks ────────────────────────────────────────────

def _member_scores_8w(conn, member_id: int, stream_val, week: int, year: int, rules: list):
    """Returns (weekly_scores list, breakdown_total dict) for the 8 weeks ending at `week`."""
    streams = parse_streams(stream_val)
    c = conn.cursor()
    weekly_scores = []
    bd_total: dict = {}
    for wo in range(8):
        w = week - 7 + wo
        if w <= 0:
            w += 52
        sw = 0
        for stream in streams:
            if stream == "dev":
                c.execute("SELECT * FROM dev_metrics WHERE member_id=? AND week=? AND year=?", (member_id, w, year))
                row = c.fetchone()
                if row:
                    s2, bd = calc_dev(dict(row), rules)
                    sw += s2
                    for k, v in bd.items():
                        bd_total[k] = bd_total.get(k, 0) + v
            elif stream == "support":
                c.execute("SELECT * FROM support_metrics WHERE member_id=? AND week=? AND year=?", (member_id, w, year))
                row = c.fetchone()
                if row:
                    s2, bd = calc_support(dict(row), rules)
                    sw += s2
                    for k, v in bd.items():
                        bd_total[k] = bd_total.get(k, 0) + v
            elif stream == "docs":
                c.execute("SELECT * FROM docs_metrics WHERE member_id=? AND week=? AND year=?", (member_id, w, year))
                row = c.fetchone()
                if row:
                    s2, bd = calc_docs(dict(row), rules)
                    sw += s2
                    for k, v in bd.items():
                        bd_total[k] = bd_total.get(k, 0) + v
        weekly_scores.append(sw)
    return weekly_scores, bd_total


@app.get("/api/engineers/{member_id}/profile")
def engineer_profile(member_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM team_members WHERE id=?", (member_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Engineer not found")
    member = dict(row)

    rules = get_rules(conn)
    week, year = current_week_year(conn)
    weekly_scores, bd_total = _member_scores_8w(conn, member_id, member["stream"], week, year, rules)
    total = sum(weekly_scores)

    # Weeks labels for chart
    weeks_labels = []
    for wo in range(8):
        w = week - 7 + wo
        if w <= 0:
            w += 52
        weeks_labels.append(w)
    weekly_chart = [{"week": f"W{w}", "score": s} for w, s in zip(weeks_labels, weekly_scores)]

    # Badges (same logic as leaderboard)
    member_streams = parse_streams(member["stream"])
    badges = []
    if len(weekly_scores) >= 3:
        last3 = weekly_scores[-3:]
        if all(v > 0 for v in last3) and last3[-1] >= last3[-2] >= last3[-3]:
            badges.append("fire")
    if "support" in member_streams:
        breach_total = 0
        for wo in range(4):
            w2 = week - 3 + wo
            if w2 <= 0:
                w2 += 52
            c.execute("SELECT sla_breached FROM support_metrics WHERE member_id=? AND week=? AND year=?",
                      (member_id, w2, year))
            r2 = c.fetchone()
            if r2:
                breach_total += r2["sla_breached"]
        if breach_total == 0:
            badges.append("shield")
    if "docs" in member_streams:
        c.execute("SELECT docs_created FROM docs_metrics WHERE member_id=? AND week=? AND year=?",
                  (member_id, week, year))
        r2 = c.fetchone()
        if r2 and r2["docs_created"] >= 3:
            badges.append("scribe")

    # MVP: check if this member has highest total among all
    c.execute("SELECT id, stream FROM team_members")
    all_members = [dict(r) for r in c.fetchall()]
    all_totals = {}
    for m2 in all_members:
        sc, _ = _member_scores_8w(conn, m2["id"], m2["stream"], week, year, rules)
        all_totals[m2["id"]] = sum(sc)
    if all_totals and all_totals.get(member_id, 0) == max(all_totals.values()):
        badges.append("mvp")

    conn.close()
    return {
        "id": member_id,
        "name": member["name"],
        "stream": member_streams[0] if member_streams else member["stream"],
        "streams": member_streams,
        "avatar_color": member["avatar_color"],
        "total_score": total,
        "current_week_score": weekly_scores[-1] if weekly_scores else 0,
        "weekly_scores": weekly_scores,
        "weekly_chart": weekly_chart,
        "badges": badges,
        "breakdown": bd_total,
        "current_week": week,
        "current_year": year,
    }


@app.get("/api/engineers/{member_id}/tasks")
def get_engineer_tasks(member_id: int, week: int = None, year: int = None):
    conn = get_db()
    c = conn.cursor()
    if week is None or year is None:
        cw, cy = current_week_year(conn)
        week = week if week is not None else cw
        year = year if year is not None else cy
    c.execute(
        "SELECT * FROM weekly_tasks WHERE engineer_id=? AND week_number=? AND year=?",
        (member_id, week, year),
    )
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    row = dict(row)
    row["what_was_done"] = json_lib.loads(row["what_was_done"])
    row["next_week"] = json_lib.loads(row["next_week"])
    return row


class WeeklyTasksCreate(BaseModel):
    week_number: int
    year: int
    what_was_done: list
    next_week: list
    stream: str = "dev"


@app.post("/api/engineers/{member_id}/tasks")
def upsert_engineer_tasks(member_id: int, data: WeeklyTasksCreate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT OR REPLACE INTO weekly_tasks "
        "(engineer_id, week_number, year, what_was_done, next_week, stream) "
        "VALUES (?,?,?,?,?,?)",
        (member_id, data.week_number, data.year,
         json_lib.dumps(data.what_was_done, ensure_ascii=False),
         json_lib.dumps(data.next_week, ensure_ascii=False),
         data.stream),
    )
    task_id = c.lastrowid
    conn.commit()
    conn.close()
    return {"id": task_id, "ok": True}


@app.delete("/api/engineers/{member_id}/tasks/{task_id}")
def delete_engineer_tasks(member_id: int, task_id: int, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM weekly_tasks WHERE id=? AND engineer_id=?", (task_id, member_id))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Config ─────────────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT key,value FROM config")
    cfg = {r["key"]: r["value"] for r in c.fetchall()}
    conn.close()
    return cfg


class ConfigUpdate(BaseModel):
    github_token: Optional[str] = None
    jira_token: Optional[str] = None
    jira_domain: Optional[str] = None
    jira_email: Optional[str] = None
    jira_api_token: Optional[str] = None
    jira_project_keys: Optional[str] = None
    jira_username_map: Optional[str] = None
    anthropic_admin_key: Optional[str] = None
    ai_auto_sync: Optional[str] = None
    team_name: Optional[str] = None
    current_week: Optional[int] = None
    current_year: Optional[int] = None


@app.put("/api/config")
def update_config(data: ConfigUpdate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    for k, v in data.dict(exclude_none=True).items():
        c.execute("INSERT OR REPLACE INTO config (key,value) VALUES (?,?)", (k, str(v)))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Admin metrics CRUD ─────────────────────────────────────────────────────────

@app.get("/api/admin/metrics/{stream}/{week}")
def admin_get_metrics(stream: str, week: int, year: int = None, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    if year is None:
        _, year = current_week_year(conn)

    c.execute("SELECT * FROM team_members")
    members = [m for m in [dict(r) for r in c.fetchall()] if stream in parse_streams(m["stream"])]

    result = []
    for m in members:
        c.execute(f"SELECT * FROM {stream}_metrics WHERE member_id=? AND week=? AND year=?",
                  (m["id"], week, year))
        row = c.fetchone()
        result.append({"member": m, "metrics": dict(row) if row else None})
    conn.close()
    return result


class MetricUpdate(BaseModel):
    metrics: Dict[str, Any]


@app.put("/api/admin/metrics/{stream}/{week}/{member_id}")
def admin_update_metrics(stream: str, week: int, member_id: int, data: MetricUpdate,
                         year: int = None, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    if year is None:
        _, year = current_week_year(conn)

    m = data.metrics
    if stream == "dev":
        c.execute(
            "INSERT OR REPLACE INTO dev_metrics "
            "(member_id,week,year,prs_merged,tickets_closed,cycle_time_days,features_completed,deploys) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (member_id, week, year,
             m.get("prs_merged", 0), m.get("tickets_closed", 0),
             m.get("cycle_time_days", 0.0), m.get("features_completed", 0),
             m.get("deploys", 0)),
        )
    elif stream == "support":
        c.execute(
            "INSERT OR REPLACE INTO support_metrics "
            "(member_id,week,year,incidents_opened,incidents_resolved,avg_resolution_hours,sla_breached,total_incidents) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (member_id, week, year,
             m.get("incidents_opened", 0), m.get("incidents_resolved", 0),
             m.get("avg_resolution_hours", 0.0), m.get("sla_breached", 0),
             m.get("total_incidents", 0)),
        )
    elif stream == "docs":
        c.execute(
            "INSERT OR REPLACE INTO docs_metrics "
            "(member_id,week,year,docs_created,docs_updated,projects_covered,projects_total) "
            "VALUES (?,?,?,?,?,?,?)",
            (member_id, week, year,
             m.get("docs_created", 0), m.get("docs_updated", 0),
             m.get("projects_covered", 0), m.get("projects_total", 10)),
        )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── AI Usage routes ────────────────────────────────────────────────────────────

@app.get("/api/ai-usage")
def get_ai_usage():
    conn = get_db()
    try:
        result = _get_or_fetch_ai_usage(conn)
    finally:
        conn.close()
    return result


@app.post("/api/ai-usage/sync")
def sync_ai_usage(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    try:
        result = _get_or_fetch_ai_usage(conn, force=True)
    finally:
        conn.close()
    return result


@app.post("/api/admin/verify")
def verify_admin(password: str = ""):
    if password == ADMIN_PASSWORD:
        return {"ok": True}
    raise HTTPException(403, "Invalid password")


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/admin/change-password")
def change_password(data: ChangePasswordRequest):
    global ADMIN_PASSWORD
    if data.current_password != ADMIN_PASSWORD:
        raise HTTPException(403, "Incorrect current password")
    if len(data.new_password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    ADMIN_PASSWORD = data.new_password
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('admin_password', ?)",
              (data.new_password,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/admin/reset-seed")
def reset_seed(x_admin_password: str = Header(default="")):
    if x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM team_members")   # cascades to all metrics and weekly_tasks
    c.execute("DELETE FROM score_rules")    # prevent duplicate rules on reseed
    conn.commit()
    conn.close()
    seed_data()
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
