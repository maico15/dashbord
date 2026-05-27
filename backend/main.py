import os
DB_PATH = os.environ.get("DB_PATH", "./dashboard.db")
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import random
import json as json_lib
import time as time_lib
import base64
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from database import get_db, IS_POSTGRES

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


def _ensure_github_username_map():
    """Merge required logins into github_username_map without overwriting other entries."""
    required = {
        "DroonPog":  "Andrey Pogrebnyak",
        "KlimMalgin": "Andrey Brunetkin",
        "maico15":   "Aleksandr Malyshev",
    }
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key='github_username_map'")
    row = c.fetchone()
    try:
        current = json_lib.loads(row["value"] if row else "{}")
    except Exception:
        current = {}
    merged = {**required, **current}   # required fills gaps; saved overrides win
    c.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('github_username_map', ?)",
        (json_lib.dumps(merged),),
    )
    conn.commit()
    conn.close()


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
    _ensure_github_username_map()
    scheduler.add_job(_run_jira_sync,        'cron',     hour=2,  minute=0,  id='jira_daily_sync',    replace_existing=True)
    scheduler.add_job(_run_slack_reports_sync,'cron',     hour=20, minute=0,  id='slack_reports_sync', replace_existing=True)
    scheduler.add_job(_run_ai_usage_sync,    'cron',     hour=2,  minute=30, id='ai_usage_daily_sync', replace_existing=True)
    scheduler.add_job(_run_github_sync,      'interval', minutes=15,          id='github_interval_sync', replace_existing=True)
    scheduler.start()
    _run_github_sync()   # immediate run on startup
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
            blocked_count INTEGER DEFAULT 0,
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
            error TEXT DEFAULT NULL,
            message TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS api_key_mapping (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            anthropic_key_id TEXT NOT NULL UNIQUE,
            key_name TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ai_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            week_number INTEGER NOT NULL,
            year INTEGER NOT NULL,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            cost_usd REAL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(engineer_id, date)
        );

        CREATE TABLE IF NOT EXISTS daily_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            report_date TEXT NOT NULL,
            raw_text TEXT DEFAULT '',
            completed TEXT NOT NULL DEFAULT '[]',
            invisible_work TEXT NOT NULL DEFAULT '[]',
            next_tasks TEXT NOT NULL DEFAULT '[]',
            delayed_risks TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(engineer_id, report_date)
        );
    """)
    conn.commit()
    # Add blocked_count for existing SQLite databases that pre-date this column
    if not IS_POSTGRES:
        c = conn.cursor()
        c.execute("PRAGMA table_info(dev_metrics)")
        cols = [row["name"] for row in c.fetchall()]
        if "blocked_count" not in cols:
            conn.execute("ALTER TABLE dev_metrics ADD COLUMN blocked_count INTEGER DEFAULT 0")
            conn.commit()
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

    now = datetime.now().isocalendar()
    current_week = now[1]
    current_year = now[0]

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
        ("github_token",        os.environ.get("GITHUB_TOKEN", "")),
        ("github_org",          "homealliance"),
        ("github_repos",        "apollo,callcenter-admin,crm-apollo,techapp,callcenter-server,callcenter-flex,maico15/dashbord"),
        ("github_username_map", '{"DroonPog":"Andrey Pogrebnyak","KlimMalgin":"Andrey Brunetkin","maico15":"Aleksandr Malyshev"}'),
        ("jira_token",          ""),
        ("jira_domain",         ""),
        ("jira_email",          ""),
        ("jira_api_token",      ""),
        ("jira_project_keys",   "[]"),
        ("jira_username_map",   "{}"),
        ("slack_bot_token",     os.environ.get("SLACK_BOT_TOKEN", "")),
        ("slack_reports_channel_id", "C08NK2SD5CK"),
        ("anthropic_admin_key", os.environ.get("ANTHROPIC_ADMIN_KEY", "")),
        ("ai_auto_sync",        "0"),
        ("team_name",           "Engineering Squad"),
        ("current_week",        str(current_week)),
        ("current_year",        str(current_year)),
    ]
    c.executemany("INSERT OR IGNORE INTO config (key,value) VALUES (?,?)", cfg)
    conn.commit()

    # Pre-seed api_key_mapping with known engineer key IDs
    c.execute("SELECT id, name FROM team_members")
    _members_by_name = {r["name"]: r["id"] for r in c.fetchall()}
    _key_seeds = [
        ("Andrey Brunetkin",   "apikey_01BeAnze5XbzY1z8q1KXuzpk"),
        ("Andrey Pogrebnyak",  "apikey_01VE6ZZxPrzyiv7b5Hs3vfVH"),
        ("Evgeniy Vinogradov", "apikey_01We2K4wbvnJhd2hThv2PRkN"),
    ]
    for _name, _key_id in _key_seeds:
        _mid = _members_by_name.get(_name)
        if _mid:
            c.execute(
                "INSERT OR IGNORE INTO api_key_mapping (engineer_id, anthropic_key_id) VALUES (?,?)",
                (_mid, _key_id),
            )
    conn.commit()

    # Migration: add message column to sync_log if missing
    try:
        c.execute("ALTER TABLE sync_log ADD COLUMN message TEXT DEFAULT NULL")
        conn.commit()
    except Exception:
        pass
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


def _anthropic_get(path: str, admin_key: str, usage_beta: bool = True) -> dict:
    url = ANTHROPIC_BASE + path
    headers = {
        "anthropic-version": "2023-06-01",
        "x-api-key": admin_key,
    }
    if usage_beta:
        headers["anthropic-beta"] = "usage-2025-01"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json_lib.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        print(f"[Anthropic API] {e.code} GET {url} — {body}")
        raise


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

    # Fetch all pages from the correct organizations/usage endpoint
    all_items: list = []
    last_id = None
    while True:
        url = f"/v1/organizations/usage{qs}"
        if last_id:
            url += f"&starting_after={last_id}"
        data = _anthropic_get(url, admin_key)
        items = data.get("data", [])
        all_items.extend(items)
        if not data.get("has_more") or not items:
            break
        last_id = items[-1].get("id") or items[-1].get("api_key_id")
        if not last_id:
            break

    # Load key → engineer mapping from DB
    c = conn.cursor()
    c.execute("SELECT anthropic_key_id, engineer_id FROM api_key_mapping")
    key_to_eng = {r["anthropic_key_id"]: r["engineer_id"] for r in c.fetchall()}
    c.execute("SELECT id, name, stream FROM team_members")
    eng_info = {r["id"]: dict(r) for r in c.fetchall()}

    day_map: dict = {}
    user_map: dict = {}
    total_tokens = 0

    for item in all_items:
        key_id = item.get("api_key_id", "")
        date_str = (item.get("date") or item.get("timestamp") or item.get("created_at") or "")[:10]
        input_tok  = item.get("input_tokens", 0)
        output_tok = item.get("output_tokens", 0)
        tok = input_tok + output_tok
        total_tokens += tok
        if date_str:
            day_map[date_str] = day_map.get(date_str, 0) + tok
        eng_id = key_to_eng.get(key_id)
        if eng_id:
            if eng_id not in user_map:
                user_map[eng_id] = {"input_tokens": 0, "output_tokens": 0, "tokens": 0}
            user_map[eng_id]["input_tokens"]  += input_tok
            user_map[eng_id]["output_tokens"] += output_tok
            user_map[eng_id]["tokens"]        += tok

    tokens_per_day = [{"date": k, "tokens": v} for k, v in sorted(day_map.items())]

    tokens_per_user = []
    for eng_id, d in user_map.items():
        info = eng_info.get(eng_id, {})
        name = info.get("name", f"Engineer {eng_id}")
        tokens_per_user.append({
            "name": name, "full_name": name,
            "member_id": eng_id, "stream": info.get("stream"),
            "tokens": d["tokens"],
            "input_tokens": d["input_tokens"],
            "output_tokens": d["output_tokens"],
        })
    tokens_per_user.sort(key=lambda x: x["tokens"], reverse=True)

    # Derive weekly data from daily totals + proportional per-engineer distribution
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
            cached = json_lib.loads(row["data"])
            # Always refresh last_synced from live table
            c.execute("SELECT timestamp FROM sync_log WHERE service='ai_usage' ORDER BY id DESC LIMIT 1")
            sr = c.fetchone()
            cached["last_synced"] = sr["timestamp"] if sr else None
            return cached

    c.execute("SELECT value FROM config WHERE key='anthropic_admin_key'")
    row = c.fetchone()
    admin_key = (row["value"] if row else "") or ""

    # Check if we have DB-synced data and prefer it when available
    c.execute("SELECT COUNT(*) as n FROM ai_usage")
    has_db_data = c.fetchone()["n"] > 0

    try:
        if has_db_data:
            result = _db_ai_usage(conn)
        elif admin_key:
            result = _live_ai_usage(admin_key, conn)
        else:
            result = _mock_ai_usage(conn)
    except Exception as exc:
        result = _mock_ai_usage(conn)
        result["api_error"] = str(exc)

    result["leverage_scores"] = _compute_leverage(conn, result["tokens_per_user"])

    c.execute("SELECT timestamp FROM sync_log WHERE service='ai_usage' ORDER BY id DESC LIMIT 1")
    sr = c.fetchone()
    result["last_synced"] = sr["timestamp"] if sr else None

    c.execute(
        "INSERT OR REPLACE INTO ai_usage_cache (key, data, cached_at) VALUES (?,?,?)",
        ("main", json_lib.dumps(result), time_lib.time()),
    )
    conn.commit()
    return result


def _db_ai_usage(conn) -> dict:
    """Build AI usage response from the ai_usage table (after a real sync)."""
    c = conn.cursor()
    end = datetime.utcnow()
    start = end - timedelta(days=30)
    start_str = start.strftime("%Y-%m-%d")

    c.execute("""
        SELECT m.id, m.name, m.stream,
               SUM(u.input_tokens)  AS input_tokens,
               SUM(u.output_tokens) AS output_tokens,
               SUM(u.total_tokens)  AS total_tokens
        FROM team_members m
        LEFT JOIN ai_usage u ON u.engineer_id = m.id AND u.date >= ?
        GROUP BY m.id
        ORDER BY total_tokens DESC
    """, (start_str,))
    rows = [dict(r) for r in c.fetchall()]

    tokens_per_user = [{
        "name": r["name"], "full_name": r["name"],
        "member_id": r["id"], "stream": r["stream"],
        "tokens": r["total_tokens"] or 0,
        "input_tokens": r["input_tokens"] or 0,
        "output_tokens": r["output_tokens"] or 0,
    } for r in rows]

    # Daily totals for the period
    c.execute("""
        SELECT date, SUM(total_tokens) AS tokens
        FROM ai_usage WHERE date >= ?
        GROUP BY date ORDER BY date
    """, (start_str,))
    tokens_per_day = [{"date": r["date"], "tokens": r["tokens"]} for r in c.fetchall()]

    # Weekly totals per engineer (last 8 weeks)
    week_map: dict = {}
    for d in tokens_per_day:
        try:
            dt_obj = datetime.strptime(d["date"], "%Y-%m-%d")
            wk = f"W{dt_obj.isocalendar()[1]}"
            week_map[wk] = week_map.get(wk, 0) + d["tokens"]
        except Exception:
            pass

    week, year = current_week_year(conn)
    tokens_per_week = []
    for i in range(7, -1, -1):
        w = week - i
        y = year
        if w <= 0:
            y -= 1
            w += 52
        label = f"W{w}"
        row: dict = {"week": label, "team": 0}
        c.execute("""
            SELECT m.name, SUM(u.total_tokens) AS tokens
            FROM ai_usage u JOIN team_members m ON m.id = u.engineer_id
            WHERE u.week_number=? AND u.year=?
            GROUP BY m.id
        """, (w, y))
        for r in c.fetchall():
            row[r["name"]] = r["tokens"]
            row["team"] += r["tokens"]
        tokens_per_week.append(row)

    total = sum(u["tokens"] for u in tokens_per_user)
    return {
        "total_tokens": total,
        "total_cost_usd": round(total / 1000 * 0.003, 2),
        "tokens_per_day": tokens_per_day,
        "tokens_per_user": tokens_per_user,
        "tokens_per_week": tokens_per_week,
        "source": "db",
    }


def _do_ai_usage_sync(conn) -> tuple:
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key='anthropic_admin_key'")
    row = c.fetchone()
    admin_key = (row["value"] if row else "").strip()
    if not admin_key:
        raise ValueError("Anthropic Admin API key not configured")

    c.execute("SELECT anthropic_key_id, engineer_id FROM api_key_mapping")
    key_map = {r["anthropic_key_id"]: r["engineer_id"] for r in c.fetchall()}

    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(days=30)
    qs = f"?start_date={start_dt.strftime('%Y-%m-%d')}&end_date={end_dt.strftime('%Y-%m-%d')}"

    # Fetch all pages
    all_items: list = []
    last_id = None
    while True:
        url = f"/v1/organizations/usage{qs}"
        if last_id:
            url += f"&starting_after={last_id}"
        data = _anthropic_get(url, admin_key)
        items = data.get("data", [])
        all_items.extend(items)
        if not data.get("has_more") or not items:
            break
        last_id = items[-1].get("id") or items[-1].get("api_key_id")
        if not last_id:
            break

    # Aggregate by (api_key_id, date)
    agg: dict = {}
    for item in all_items:
        key_id = item.get("api_key_id", "")
        date_str = (
            item.get("date") or item.get("timestamp") or item.get("created_at") or ""
        )[:10]
        if not key_id or not date_str:
            continue
        k = (key_id, date_str)
        if k not in agg:
            agg[k] = {"input_tokens": 0, "output_tokens": 0}
        agg[k]["input_tokens"]  += item.get("input_tokens", 0)
        agg[k]["output_tokens"] += item.get("output_tokens", 0)

    records = 0
    for (key_id, date_str), tok in agg.items():
        engineer_id = key_map.get(key_id)
        if not engineer_id:
            continue
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            iso = dt.isocalendar()
            week_num, yr = iso[1], iso[0]
        except Exception:
            continue
        input_tok  = tok["input_tokens"]
        output_tok = tok["output_tokens"]
        total_tok  = input_tok + output_tok
        cost       = round(total_tok / 1000 * 0.003, 6)

        c.execute(
            "SELECT id FROM ai_usage WHERE engineer_id=? AND date=?",
            (engineer_id, date_str),
        )
        if c.fetchone():
            c.execute(
                "UPDATE ai_usage SET input_tokens=?, output_tokens=?, total_tokens=?, "
                "cost_usd=?, week_number=?, year=? WHERE engineer_id=? AND date=?",
                (input_tok, output_tok, total_tok, cost, week_num, yr, engineer_id, date_str),
            )
        else:
            c.execute(
                "INSERT INTO ai_usage (engineer_id, date, week_number, year, "
                "input_tokens, output_tokens, total_tokens, cost_usd) VALUES (?,?,?,?,?,?,?,?)",
                (engineer_id, date_str, week_num, yr, input_tok, output_tok, total_tok, cost),
            )
        records += 1

    conn.commit()
    return records, f"Synced {records} usage record(s) from Anthropic Admin API"


def _run_ai_usage_sync() -> dict:
    conn = get_db()
    try:
        records, msg = _do_ai_usage_sync(conn)
        conn.execute(
            "INSERT INTO sync_log (service, timestamp, status, records_updated, message) VALUES (?,?,?,?,?)",
            ("ai_usage", datetime.utcnow().isoformat(), "success", records, msg),
        )
        conn.commit()
        # Invalidate cache so next GET rebuilds from DB
        conn.execute("DELETE FROM ai_usage_cache WHERE key='main'")
        conn.commit()
        return {"status": "success", "records_updated": records, "message": msg}
    except Exception as exc:
        err = str(exc)
        try:
            conn.execute(
                "INSERT INTO sync_log (service, timestamp, status, records_updated, error, message) VALUES (?,?,?,?,?,?)",
                ("ai_usage", datetime.utcnow().isoformat(), "error", 0, err, err),
            )
            conn.commit()
        except Exception:
            pass
        return {"status": "error", "error": err, "message": err}
    finally:
        conn.close()


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
        msg = f"Synced {records} record(s) from Jira"
        conn.execute(
            "INSERT INTO sync_log (service, timestamp, status, records_updated, message) VALUES (?,?,?,?,?)",
            ("jira", datetime.utcnow().isoformat(), "success", records, msg),
        )
        conn.commit()
        return {"status": "success", "records_updated": records, "message": msg}
    except Exception as exc:
        err = str(exc)
        try:
            conn.execute(
                "INSERT INTO sync_log (service, timestamp, status, records_updated, error, message) "
                "VALUES (?,?,?,?,?,?)",
                ("jira", datetime.utcnow().isoformat(), "error", 0, err, err),
            )
            conn.commit()
        except Exception:
            pass
        return {"status": "error", "error": err, "message": err}
    finally:
        conn.close()


# ── Report parser ─────────────────────────────────────────────────────────────

def _parse_dash_items(text: str) -> list:
    import re
    if not text.strip():
        return []
    parts = re.split(r'\s*[—–]\s*', text)
    return [p.strip() for p in parts if p.strip()]


def parse_daily_report(text: str) -> dict:
    import re
    result = {"name": None, "date": None, "completed": [], "invisible_work": [], "next_tasks": [], "delayed_risks": []}
    lines = [l.strip() for l in text.split('\n')]
    for line in lines[:3]:
        m = re.match(r'daily\s+report\s*[—–\-]+\s*(.+?)\s*\|\s*(.+)', line, re.IGNORECASE)
        if m:
            result["name"] = m.group(1).strip()
            result["date"] = m.group(2).strip()
            break
    SECTION_RE = [
        ("completed",      re.compile(r'^completed\s*:?(.*)', re.IGNORECASE)),
        ("invisible_work", re.compile(r'^invisible\s+work\s*:?(.*)', re.IGNORECASE)),
        ("next_tasks",     re.compile(r'^next\s*:?(.*)', re.IGNORECASE)),
        ("delayed_risks",  re.compile(r'^delayed\s*/?\s*risks?\s*:?(.*)', re.IGNORECASE)),
    ]
    current = None
    for line in lines[1:]:
        if not line:
            continue
        matched = False
        for key, pattern in SECTION_RE:
            m = pattern.match(line)
            if m:
                current = key
                rest = m.group(1).strip().lstrip(':').strip()
                if rest:
                    result[current].extend(_parse_dash_items(rest))
                matched = True
                break
        if not matched and current:
            result[current].extend(_parse_dash_items(line))
    return result


# ── Slack integration ─────────────────────────────────────────────────────────

def _slack_request(method: str, token: str, params: dict = None) -> dict:
    url = f"https://slack.com/api/{method}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json_lib.loads(resp.read())
    if not data.get("ok"):
        raise ValueError(f"Slack error: {data.get('error', 'unknown')}")
    return data


def _do_slack_reports_sync(conn) -> int:
    c = conn.cursor()
    c.execute(
        "SELECT key, value FROM config WHERE key IN ('slack_bot_token','slack_reports_channel_id')"
    )
    cfg = {r["key"]: r["value"] for r in c.fetchall()}
    token = (cfg.get("slack_bot_token") or "").strip()
    channel = (cfg.get("slack_reports_channel_id") or "C08NK2SD5CK").strip()
    if not token:
        raise ValueError("Slack bot token not configured")

    today = datetime.utcnow().date()
    oldest = str(int(datetime(today.year, today.month, today.day, 0, 0, 0).timestamp()))

    data = _slack_request("conversations.history", token, {
        "channel": channel, "oldest": oldest, "limit": 100,
    })
    messages = data.get("messages", [])

    c.execute("SELECT id, name FROM team_members")
    members = {r["name"]: r["id"] for r in c.fetchall()}

    saved = 0
    for msg in messages:
        text = msg.get("text", "")
        if "Daily Report" not in text:
            continue
        parsed = parse_daily_report(text)
        if not parsed.get("name"):
            continue
        engineer_id = None
        for mname, mid in members.items():
            if parsed["name"].lower() in mname.lower() or mname.lower() in parsed["name"].lower():
                engineer_id = mid
                break
        if not engineer_id:
            continue
        report_date = str(today)
        c.execute(
            "SELECT id FROM daily_reports WHERE engineer_id=? AND report_date=?",
            (engineer_id, report_date)
        )
        if c.fetchone():
            c.execute(
                "UPDATE daily_reports SET raw_text=?, completed=?, invisible_work=?, "
                "next_tasks=?, delayed_risks=?, source='slack' "
                "WHERE engineer_id=? AND report_date=?",
                (
                    text,
                    json_lib.dumps(parsed["completed"], ensure_ascii=False),
                    json_lib.dumps(parsed["invisible_work"], ensure_ascii=False),
                    json_lib.dumps(parsed["next_tasks"], ensure_ascii=False),
                    json_lib.dumps(parsed["delayed_risks"], ensure_ascii=False),
                    engineer_id, report_date,
                ),
            )
        else:
            c.execute(
                "INSERT INTO daily_reports (engineer_id, report_date, raw_text, completed, "
                "invisible_work, next_tasks, delayed_risks, source) VALUES (?,?,?,?,?,?,?,?)",
                (
                    engineer_id, report_date, text,
                    json_lib.dumps(parsed["completed"], ensure_ascii=False),
                    json_lib.dumps(parsed["invisible_work"], ensure_ascii=False),
                    json_lib.dumps(parsed["next_tasks"], ensure_ascii=False),
                    json_lib.dumps(parsed["delayed_risks"], ensure_ascii=False),
                    "slack",
                ),
            )
        saved += 1

    conn.commit()
    return saved


def _run_slack_reports_sync() -> dict:
    conn = get_db()
    try:
        records = _do_slack_reports_sync(conn)
        msg = f"Synced {records} report(s) from Slack channel"
        conn.execute(
            "INSERT INTO sync_log (service, timestamp, status, records_updated, message) VALUES (?,?,?,?,?)",
            ("slack_reports", datetime.utcnow().isoformat(), "success", records, msg),
        )
        conn.commit()
        return {"status": "success", "records_updated": records, "message": msg}
    except Exception as exc:
        err = str(exc)
        try:
            conn.execute(
                "INSERT INTO sync_log (service, timestamp, status, records_updated, error, message) VALUES (?,?,?,?,?,?)",
                ("slack_reports", datetime.utcnow().isoformat(), "error", 0, err, err),
            )
            conn.commit()
        except Exception:
            pass
        return {"status": "error", "error": err, "message": err}
    finally:
        conn.close()


# ── GitHub sync ───────────────────────────────────────────────────────────────

def _do_github_sync(conn) -> tuple:
    c = conn.cursor()
    c.execute(
        "SELECT key, value FROM config WHERE key IN "
        "('github_token','github_org','github_repos','github_username_map')"
    )
    cfg = {r["key"]: r["value"] for r in c.fetchall()}
    token = (cfg.get("github_token") or "").strip()
    org   = (cfg.get("github_org")   or "homealliance").strip()
    repos = [r.strip() for r in (cfg.get("github_repos") or "").split(",") if r.strip()]
    try:
        username_map = json_lib.loads(cfg.get("github_username_map") or "{}")
    except Exception:
        username_map = {}

    if not token:
        raise ValueError("GitHub token not configured")
    if not repos:
        raise ValueError("No repositories configured")

    def gh_get(url):
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"token {token}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "dashboard-sync/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json_lib.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise ValueError("401 Unauthorized — invalid token")
            if e.code == 403:
                raise ValueError(f"403 Forbidden — no access to repository")
            if e.code == 404:
                raise ValueError(f"404 Not Found — {url.rsplit('/', 2)[-1]} not found")
            raise ValueError(f"GitHub API error {e.code}: {e.reason}")
        except Exception as e:
            s = str(e).lower()
            if "timed out" in s or "timeout" in s:
                raise ValueError("Connection timeout")
            raise ValueError(f"Request failed: {e}")

    # Determine current week date range (ISO week)
    week, year = current_week_year(conn)
    jan4 = datetime(year, 1, 4).date()
    week1_monday = jan4 - timedelta(days=jan4.weekday())
    week_monday  = week1_monday + timedelta(weeks=week - 1)
    week_sunday  = week_monday  + timedelta(days=6)

    # Fetch merged PRs per repo, filtered to current week
    pr_counts = {}  # github_login -> count
    total_prs = 0

    for repo in repos:
        # Support "owner/repo" for personal/cross-org repos; bare name uses org
        owner_repo = repo if "/" in repo else f"{org}/{repo}"
        pulls = []
        page = 1
        while True:
            url = f"https://api.github.com/repos/{owner_repo}/pulls?state=closed&per_page=100&page={page}"
            try:
                page_data = gh_get(url)
            except ValueError as e:
                if "404" in str(e):
                    raise ValueError(f"404 Not Found — repository {owner_repo} not found")
                raise
            if not isinstance(page_data, list):
                break
            pulls.extend(page_data)
            if len(page_data) < 100:
                break
            page += 1
        if not pulls:
            continue

        print(f"[GitHub sync] {owner_repo}: fetched {len(pulls)} closed PR(s) ({page} page(s))")
        for pr in pulls:
            merged_at = pr.get("merged_at")
            if not merged_at:
                continue
            try:
                merged_date = datetime.fromisoformat(merged_at.rstrip("Z")).date()
            except Exception:
                continue
            login = (pr.get("user") or {}).get("login", "")
            in_week = week_monday <= merged_date <= week_sunday
            print(f"[GitHub sync]   PR #{pr.get('number')} by {login!r} merged {merged_date} — {'IN WEEK' if in_week else 'skip'}")
            if in_week and login:
                pr_counts[login] = pr_counts.get(login, 0) + 1
                total_prs += 1

    print(f"[GitHub sync] PR counts by login: {pr_counts}")
    # Map logins → engineers and write to dev_metrics
    records_updated = 0
    for login, count in pr_counts.items():
        eng_name = username_map.get(login)
        print(f"[GitHub sync] {login!r} → engineer {eng_name!r} ({count} PR(s))")
        if not eng_name:
            continue
        c.execute("SELECT id FROM team_members WHERE name=?", (eng_name,))
        row = c.fetchone()
        if not row:
            continue
        member_id = row["id"]
        c.execute(
            "SELECT prs_merged FROM dev_metrics WHERE member_id=? AND week=? AND year=?",
            (member_id, week, year),
        )
        existing = c.fetchone()
        if existing:
            c.execute(
                "UPDATE dev_metrics SET prs_merged=? WHERE member_id=? AND week=? AND year=?",
                (count, member_id, week, year),
            )
        else:
            c.execute(
                "INSERT INTO dev_metrics "
                "(member_id, week, year, prs_merged, tickets_closed, cycle_time_days, features_completed, deploys) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (member_id, week, year, count, 0, 0.0, 0, 0),
            )
        records_updated += 1

    conn.commit()

    if total_prs == 0:
        msg = f"No merged PRs found in week {week} across {len(repos)} repo(s)"
    else:
        msg = f"Synced {total_prs} merged PR(s) → {records_updated} engineer(s) updated (week {week})"
    return records_updated, msg


def _run_github_sync() -> dict:
    conn = get_db()
    try:
        records, msg = _do_github_sync(conn)
        conn.execute(
            "INSERT INTO sync_log (service, timestamp, status, records_updated, message) VALUES (?,?,?,?,?)",
            ("github", datetime.utcnow().isoformat(), "success", records, msg),
        )
        conn.commit()
        return {"status": "success", "records_updated": records, "message": msg}
    except Exception as exc:
        err = str(exc)
        try:
            conn.execute(
                "INSERT INTO sync_log (service, timestamp, status, records_updated, error, message) VALUES (?,?,?,?,?,?)",
                ("github", datetime.utcnow().isoformat(), "error", 0, err, err),
            )
            conn.commit()
        except Exception:
            pass
        return {"status": "error", "error": err, "message": err}
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


@app.get("/api/sync/jira/log")
def jira_sync_log(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM sync_log WHERE service='jira' ORDER BY id DESC LIMIT 10")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


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


class ReportCreate(BaseModel):
    engineer_id: int
    report_date: str
    completed: list = []
    invisible_work: list = []
    next_tasks: list = []
    delayed_risks: list = []
    raw_text: str = ""
    source: str = "manual"


class ReportUpdate(BaseModel):
    completed: Optional[list] = None
    invisible_work: Optional[list] = None
    next_tasks: Optional[list] = None
    delayed_risks: Optional[list] = None
    raw_text: Optional[str] = None


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
    github_org: Optional[str] = None
    github_repos: Optional[str] = None
    github_username_map: Optional[str] = None
    jira_token: Optional[str] = None
    jira_domain: Optional[str] = None
    jira_email: Optional[str] = None
    jira_api_token: Optional[str] = None
    jira_project_keys: Optional[str] = None
    jira_username_map: Optional[str] = None
    slack_bot_token: Optional[str] = None
    slack_reports_channel_id: Optional[str] = None
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


@app.delete("/api/metrics/mock")
def delete_mock_metrics(password: str = "", include_current: bool = False):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    week, year = current_week_year(conn)
    c = conn.cursor()
    deleted = 0
    for table in ("dev_metrics", "support_metrics", "docs_metrics"):
        if include_current:
            c.execute(f"DELETE FROM {table}")
        else:
            c.execute(
                f"DELETE FROM {table} WHERE year < ? OR (year = ? AND week < ?)",
                (year, year, week),
            )
        deleted += c.rowcount
    conn.commit()
    conn.close()
    kept = None if include_current else {"week": week, "year": year}
    return {"ok": True, "deleted_rows": deleted, "kept": kept}


# ── AI Usage routes ────────────────────────────────────────────────────────────

@app.get("/api/ai-usage")
def get_ai_usage(week: int = None, year: int = None):
    conn = get_db()
    c = conn.cursor()

    if week and year:
        c.execute("""
            SELECT m.id, m.name, m.stream, m.avatar_color,
                   COALESCE(SUM(u.input_tokens),  0) AS input_tokens,
                   COALESCE(SUM(u.output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(u.total_tokens),  0) AS total_tokens,
                   COALESCE(SUM(u.cost_usd),      0) AS cost_usd
            FROM team_members m
            LEFT JOIN ai_usage u ON u.engineer_id = m.id
                                 AND u.week_number=? AND u.year=?
            GROUP BY m.id ORDER BY total_tokens DESC
        """, (week, year))
        rows = [dict(r) for r in c.fetchall()]
        has_data = any(r["total_tokens"] > 0 for r in rows)

        if has_data:
            tokens_per_user = [{
                "name": r["name"], "full_name": r["name"],
                "member_id": r["id"], "stream": r["stream"],
                "tokens": r["total_tokens"],
                "input_tokens": r["input_tokens"],
                "output_tokens": r["output_tokens"],
            } for r in rows]
            total = sum(r["total_tokens"] for r in rows)
            c.execute("SELECT timestamp FROM sync_log WHERE service='ai_usage' ORDER BY id DESC LIMIT 1")
            sr = c.fetchone()
            result = {
                "total_tokens": total,
                "total_cost_usd": round(total / 1000 * 0.003, 2),
                "tokens_per_user": tokens_per_user,
                "source": "db",
                "week": week, "year": year,
                "last_synced": sr["timestamp"] if sr else None,
            }
            result["leverage_scores"] = _compute_leverage(conn, tokens_per_user)
            conn.close()
            return result

    try:
        result = _get_or_fetch_ai_usage(conn)
    finally:
        conn.close()
    return result


@app.get("/api/ai-usage/history")
def get_ai_usage_history(weeks: int = 8):
    conn = get_db()
    c = conn.cursor()
    week, year = current_week_year(conn)

    result = []
    for i in range(weeks - 1, -1, -1):
        w, y = week - i, year
        if w <= 0:
            y -= 1
            w += 52
        row: dict = {"week": f"W{w}", "team": 0}
        c.execute("""
            SELECT m.name, SUM(u.total_tokens) AS tokens
            FROM ai_usage u JOIN team_members m ON m.id = u.engineer_id
            WHERE u.week_number=? AND u.year=?
            GROUP BY m.id
        """, (w, y))
        for r in c.fetchall():
            row[r["name"]] = r["tokens"]
            row["team"] += r["tokens"]
        result.append(row)

    conn.close()
    return result


@app.post("/api/ai-usage/sync")
def sync_ai_usage(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    result = _run_ai_usage_sync()
    if result.get("status") == "error":
        raise HTTPException(500, result.get("error", "Sync failed"))
    return result


@app.get("/api/ai-usage/test")
def test_ai_connection(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key='anthropic_admin_key'")
    row = c.fetchone()
    conn.close()
    admin_key = (row["value"] if row else "").strip()
    if not admin_key:
        raise HTTPException(400, "Anthropic Admin API key not configured")
    try:
        _anthropic_get("/v1/organizations/api_keys", admin_key, usage_beta=False)
        return {"ok": True, "message": "Connection successful"}
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, f"Anthropic API error {e.code}: check your Admin API key")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/sync/ai-usage/status")
def ai_usage_sync_status(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM sync_log WHERE service='ai_usage' ORDER BY id DESC LIMIT 1")
    row = c.fetchone()
    conn.close()
    if not row:
        return {"status": "never", "timestamp": None, "records_updated": 0, "error": None}
    return dict(row)


class KeyMappingIn(BaseModel):
    engineer_id: int
    anthropic_key_id: str
    key_name: Optional[str] = ""


@app.get("/api/ai-key-mappings")
def get_key_mappings(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT m.id, m.anthropic_key_id, m.key_name, m.engineer_id,
               t.name AS engineer_name
        FROM api_key_mapping m
        LEFT JOIN team_members t ON t.id = m.engineer_id
        ORDER BY m.engineer_id, m.id
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@app.put("/api/ai-key-mappings")
def save_key_mappings(data: List[KeyMappingIn], password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM api_key_mapping")
    for item in data:
        if not (item.anthropic_key_id or "").strip():
            continue
        c.execute(
            "INSERT OR IGNORE INTO api_key_mapping (engineer_id, anthropic_key_id, key_name) VALUES (?,?,?)",
            (item.engineer_id, item.anthropic_key_id.strip(), item.key_name or ""),
        )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Daily reports endpoints ───────────────────────────────────────────────────

def _deserialize_report(row: dict) -> dict:
    for k in ("completed", "invisible_work", "next_tasks", "delayed_risks"):
        try:
            row[k] = json_lib.loads(row[k])
        except Exception:
            row[k] = []
    return row


@app.get("/api/reports")
def get_reports(date: str = None):
    conn = get_db()
    c = conn.cursor()
    if not date:
        date = datetime.utcnow().strftime("%Y-%m-%d")
    c.execute("SELECT * FROM team_members ORDER BY name")
    members = [dict(r) for r in c.fetchall()]
    result = []
    for m in members:
        c.execute(
            "SELECT * FROM daily_reports WHERE engineer_id=? AND report_date=?",
            (m["id"], date),
        )
        row = c.fetchone()
        report = _deserialize_report(dict(row)) if row else None
        result.append({
            "engineer": {
                "id": m["id"], "name": m["name"],
                "avatar_color": m["avatar_color"], "stream": m["stream"],
            },
            "report": report,
        })
    conn.close()
    return result


@app.get("/api/reports/engineer/{engineer_id}")
def get_engineer_reports(engineer_id: int, from_date: str = None, to_date: str = None):
    conn = get_db()
    c = conn.cursor()
    query = "SELECT * FROM daily_reports WHERE engineer_id=?"
    params: list = [engineer_id]
    if from_date:
        query += " AND report_date >= ?"
        params.append(from_date)
    if to_date:
        query += " AND report_date <= ?"
        params.append(to_date)
    query += " ORDER BY report_date DESC"
    c.execute(query, params)
    rows = [_deserialize_report(dict(r)) for r in c.fetchall()]
    conn.close()
    return rows


@app.post("/api/reports/manual")
def create_report(data: ReportCreate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT id FROM daily_reports WHERE engineer_id=? AND report_date=?",
        (data.engineer_id, data.report_date),
    )
    existing = c.fetchone()
    if existing:
        c.execute(
            "UPDATE daily_reports SET raw_text=?, completed=?, invisible_work=?, "
            "next_tasks=?, delayed_risks=?, source=? WHERE id=?",
            (
                data.raw_text,
                json_lib.dumps(data.completed, ensure_ascii=False),
                json_lib.dumps(data.invisible_work, ensure_ascii=False),
                json_lib.dumps(data.next_tasks, ensure_ascii=False),
                json_lib.dumps(data.delayed_risks, ensure_ascii=False),
                data.source, existing["id"],
            ),
        )
        report_id = existing["id"]
    else:
        c.execute(
            "INSERT INTO daily_reports (engineer_id, report_date, raw_text, completed, "
            "invisible_work, next_tasks, delayed_risks, source) VALUES (?,?,?,?,?,?,?,?)",
            (
                data.engineer_id, data.report_date, data.raw_text,
                json_lib.dumps(data.completed, ensure_ascii=False),
                json_lib.dumps(data.invisible_work, ensure_ascii=False),
                json_lib.dumps(data.next_tasks, ensure_ascii=False),
                json_lib.dumps(data.delayed_risks, ensure_ascii=False),
                data.source,
            ),
        )
        report_id = c.lastrowid
    conn.commit()
    conn.close()
    return {"id": report_id, "ok": True}


@app.put("/api/reports/{report_id}")
def update_report(report_id: int, data: ReportUpdate, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM daily_reports WHERE id=?", (report_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(404, "Report not found")
    sets, params = [], []
    if data.completed is not None:
        sets.append("completed=?")
        params.append(json_lib.dumps(data.completed, ensure_ascii=False))
    if data.invisible_work is not None:
        sets.append("invisible_work=?")
        params.append(json_lib.dumps(data.invisible_work, ensure_ascii=False))
    if data.next_tasks is not None:
        sets.append("next_tasks=?")
        params.append(json_lib.dumps(data.next_tasks, ensure_ascii=False))
    if data.delayed_risks is not None:
        sets.append("delayed_risks=?")
        params.append(json_lib.dumps(data.delayed_risks, ensure_ascii=False))
    if data.raw_text is not None:
        sets.append("raw_text=?")
        params.append(data.raw_text)
    if sets:
        params.append(report_id)
        c.execute(f"UPDATE daily_reports SET {', '.join(sets)} WHERE id=?", params)
        conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/reports/{report_id}")
def delete_report(report_id: int, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM daily_reports WHERE id=?", (report_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/sync/slack-reports")
def sync_slack_reports(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    result = _run_slack_reports_sync()
    if result.get("status") == "error":
        raise HTTPException(500, result.get("error", "Sync failed"))
    return result


@app.get("/api/sync/slack-reports/status")
def slack_reports_status(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT * FROM sync_log WHERE service='slack_reports' ORDER BY id DESC LIMIT 1"
    )
    row = c.fetchone()
    conn.close()
    if not row:
        return {"status": "never", "timestamp": None, "records_updated": 0, "error": None}
    return dict(row)


@app.get("/api/sync/slack-reports/log")
def slack_sync_log(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM sync_log WHERE service='slack_reports' ORDER BY id DESC LIMIT 10")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@app.post("/api/sync/github")
def sync_github(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    result = _run_github_sync()
    if result.get("status") == "error":
        err = result.get("error", "Sync failed")
        if "401" in err:
            raise HTTPException(401, err)
        if "403" in err:
            raise HTTPException(403, err)
        if "404" in err:
            raise HTTPException(404, err)
        raise HTTPException(500, err)
    return result


@app.get("/api/sync/github/status")
def github_sync_status(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM sync_log WHERE service='github' ORDER BY id DESC LIMIT 1")
    row = c.fetchone()
    conn.close()
    if not row:
        return {"status": "never", "timestamp": None, "records_updated": 0, "error": None}
    return dict(row)


@app.get("/api/sync/github/log")
def github_sync_log(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM sync_log WHERE service='github' ORDER BY id DESC LIMIT 10")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@app.get("/api/sync/github/debug")
def github_sync_debug():
    """No-auth debug endpoint: returns config, live API test, and recent sync log."""
    conn = get_db()
    c = conn.cursor()

    # Config (mask token)
    c.execute(
        "SELECT key, value FROM config WHERE key IN "
        "('github_token','github_org','github_repos','github_username_map')"
    )
    cfg = {r["key"]: r["value"] for r in c.fetchall()}
    token = (cfg.get("github_token") or "").strip()
    masked_token = (token[:6] + "..." + token[-4:]) if len(token) > 10 else ("set" if token else "NOT SET")

    # Last 5 sync log entries
    c.execute("SELECT * FROM sync_log WHERE service='github' ORDER BY id DESC LIMIT 5")
    logs = [dict(r) for r in c.fetchall()]

    conn.close()

    # Live API test: list repos for the configured org
    org = (cfg.get("github_org") or "homealliance").strip()
    repos_cfg = cfg.get("github_repos") or ""
    api_test: dict = {}
    if token:
        try:
            test_repo = None
            for r in repos_cfg.split(","):
                r = r.strip()
                if r:
                    test_repo = r if "/" in r else f"{org}/{r}"
                    break
            if test_repo:
                req = urllib.request.Request(
                    f"https://api.github.com/repos/{test_repo}",
                    headers={
                        "Authorization": f"token {token}",
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "dashboard-sync/1.0",
                    },
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json_lib.loads(resp.read())
                api_test = {
                    "ok": True,
                    "repo": test_repo,
                    "full_name": data.get("full_name"),
                    "private": data.get("private"),
                    "default_branch": data.get("default_branch"),
                }
            else:
                api_test = {"ok": False, "error": "No repos configured"}
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            api_test = {"ok": False, "status": e.code, "error": body}
        except Exception as e:
            api_test = {"ok": False, "error": str(e)}
    else:
        api_test = {"ok": False, "error": "github_token not configured"}

    return {
        "auth_mechanism": "POST /api/sync/github requires ?password=ADMIN_PASSWORD query param",
        "config": {
            "github_token": masked_token,
            "github_org": org,
            "github_repos": [r.strip() for r in repos_cfg.split(",") if r.strip()],
            "github_username_map": cfg.get("github_username_map", "{}"),
        },
        "api_test": api_test,
        "recent_sync_log": logs,
    }


@app.post("/api/sync/slack-reports/test")
def test_slack_connection(password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key='slack_bot_token'")
    row = c.fetchone()
    conn.close()
    token = ((row["value"] if row else "") or "").strip()
    if not token:
        raise HTTPException(400, "Slack bot token not configured")
    try:
        result = _slack_request("auth.test", token)
        return {"ok": True, "team": result.get("team"), "user": result.get("user")}
    except Exception as e:
        raise HTTPException(400, str(e))


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
