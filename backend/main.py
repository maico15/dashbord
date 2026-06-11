import os
DB_PATH = os.environ.get("DB_PATH", "./dashboard.db")
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import re
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
TELEMETRY_SECRET = os.environ.get("TELEMETRY_SECRET", "")


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


def _auto_advance_week():
    """Every Monday sync config.current_week/year to the real ISO 8601 week.

    Also called on every startup so that a Render cold start after a week
    boundary doesn't leave config stale before the first GitHub sync runs.
    """
    conn = get_db()
    try:
        now = datetime.utcnow().isocalendar()
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('current_week', ?)",
            (str(now[1]),),
        )
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('current_year', ?)",
            (str(now[0]),),
        )
        conn.commit()
        print(f"[auto_advance_week] updated to week {now[1]} / {now[0]}")
    finally:
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
    scheduler.add_job(
        _auto_advance_week,
        'cron',
        day_of_week='mon', hour=0, minute=5,
        id='auto_advance_week',
        replace_existing=True,
    )
    scheduler.start()
    _auto_advance_week()  # sync config on every startup (handles cold starts after week boundary)
    _run_github_sync()    # immediate run on startup
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

        CREATE TABLE IF NOT EXISTS departments (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            name   TEXT    NOT NULL UNIQUE,
            slug   TEXT    NOT NULL UNIQUE,
            active INTEGER NOT NULL DEFAULT 1
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
            commits_count INTEGER DEFAULT 0,
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
            tasks TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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

        CREATE TABLE IF NOT EXISTS commit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL,
            repo TEXT NOT NULL,
            sha TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            committed_at TEXT NOT NULL,
            UNIQUE(repo, sha)
        );

        CREATE TABLE IF NOT EXISTS pr_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL,
            repo TEXT NOT NULL,
            pr_number INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            additions INTEGER DEFAULT 0,
            deletions INTEGER DEFAULT 0,
            changed_files INTEGER DEFAULT 0,
            merged_at TEXT NOT NULL,
            commits TEXT NOT NULL DEFAULT '[]',
            UNIQUE(repo, pr_number)
        );

        CREATE TABLE IF NOT EXISTS ai_events (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id            TEXT UNIQUE NOT NULL,
            engineer_id         INTEGER NOT NULL,
            session_id          TEXT NOT NULL,
            timestamp           TEXT NOT NULL,
            model               TEXT NOT NULL DEFAULT 'unknown',
            tokens_input        INTEGER NOT NULL DEFAULT 0,
            tokens_output       INTEGER NOT NULL DEFAULT 0,
            tokens_cache_read   INTEGER NOT NULL DEFAULT 0,
            tokens_cache_write  INTEGER NOT NULL DEFAULT 0,
            repo                TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ai_events_engineer
            ON ai_events(engineer_id, timestamp);

        CREATE TABLE IF NOT EXISTS ai_usage_daily (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer_id     INTEGER NOT NULL,
            date            TEXT NOT NULL,
            tokens_input    INTEGER NOT NULL DEFAULT 0,
            tokens_output   INTEGER NOT NULL DEFAULT 0,
            sessions_count  INTEGER NOT NULL DEFAULT 0,
            UNIQUE(engineer_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_date
            ON ai_usage_daily(date, engineer_id);
    """)
    conn.commit()
    # Seed default departments
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM departments")
    if c.fetchone()[0] == 0:
        c.executemany(
            "INSERT INTO departments (name, slug) VALUES (?, ?)",
            [("IT", "it"), ("Test", "test")]
        )
        conn.commit()
    # Add blocked_count for existing SQLite databases that pre-date this column
    if not IS_POSTGRES:
        c = conn.cursor()
        c.execute("PRAGMA table_info(dev_metrics)")
        cols = [row["name"] for row in c.fetchall()]
        if "blocked_count" not in cols:
            conn.execute("ALTER TABLE dev_metrics ADD COLUMN blocked_count INTEGER DEFAULT 0")
            conn.commit()
    # Add commits_count for existing databases (works for SQLite and Postgres)
    try:
        conn.execute("ALTER TABLE dev_metrics ADD COLUMN commits_count INTEGER DEFAULT 0")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN position TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE dev_metrics ADD COLUMN avg_pr_size INTEGER DEFAULT NULL")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE dev_metrics ADD COLUMN ai_tokens INTEGER DEFAULT NULL")
        conn.commit()
    except Exception:
        pass
    # ai_events and ai_usage_daily are created via executescript above (IF NOT EXISTS);
    # these no-op try/except blocks handle the case where CREATE INDEX runs on a DB
    # that was initialized before those statements were added to the script.
    try:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_events_engineer "
            "ON ai_events(engineer_id, timestamp)"
        )
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_date "
            "ON ai_usage_daily(date, engineer_id)"
        )
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN department_id INTEGER DEFAULT 1")
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN email TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass

    # ── weekly_tasks schema migration ────────────────────────────────────────
    # Use PRAGMA table_info (not try/except) so failures are never swallowed.
    # DEFAULT '' is the only value that is a constant literal in every SQLite
    # version.  Both datetime('now') and CURRENT_TIMESTAMP were rejected as
    # non-constant for ALTER TABLE ADD COLUMN in different SQLite versions:
    #   • datetime('now')    – always a function call, rejected in all versions
    #   • CURRENT_TIMESTAMP  – rejected since SQLite 3.38.0 (2022-02-22);
    #                          Render's Python 3.11 ships with SQLite 3.39.2
    # Therefore DEFAULT '' is the only cross-version-safe choice here.
    print("[db] Running database migrations...")
    _wt_cols = {row[1] for row in conn.execute("PRAGMA table_info(weekly_tasks)").fetchall()}

    if "tasks" not in _wt_cols:
        conn.execute("ALTER TABLE weekly_tasks ADD COLUMN tasks TEXT NOT NULL DEFAULT ''")
        conn.commit()
        print("[db] Added weekly_tasks.tasks column")
    else:
        print("[db] weekly_tasks.tasks already exists — skipping")

    if "updated_at" not in _wt_cols:
        conn.execute("ALTER TABLE weekly_tasks ADD COLUMN updated_at TEXT DEFAULT ''")
        conn.commit()
        print("[db] Added weekly_tasks.updated_at column")
    else:
        print("[db] weekly_tasks.updated_at already exists — skipping")

    # ── One-time: fix score_rules to real-data formula ────────────────────────
    # Runs on every deploy but is idempotent after the first time.
    try:
        conn.execute("UPDATE score_rules SET points=100 WHERE rule_key='pr_merged'")
        conn.execute("UPDATE score_rules SET points=0   WHERE rule_key='ticket_closed'")
        conn.execute("UPDATE score_rules SET points=0   WHERE rule_key='fast_cycle'")
        conn.execute(
            "INSERT OR IGNORE INTO score_rules (stream,rule_key,label,points) "
            "VALUES ('dev','commit','Commit',10)"
        )
        conn.commit()
    except Exception:
        pass

    # ── One-time: purge fake manually-entered metric data ─────────────────────
    # Uses a config flag so this only runs once per database.
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key='_metrics_cleaned_v1'")
    if not c.fetchone():
        try:
            conn.execute("DELETE FROM support_metrics")
            conn.execute("DELETE FROM docs_metrics")
            # Reset manual-only columns in dev_metrics; preserve real sync data
            conn.execute(
                "UPDATE dev_metrics SET "
                "tickets_closed=0, cycle_time_days=0.0, "
                "features_completed=0, deploys=0, blocked_count=0"
            )
            conn.execute(
                "INSERT OR REPLACE INTO config (key,value) "
                "VALUES ('_metrics_cleaned_v1','1')"
            )
            conn.commit()
            print("[init] Fake metric data cleaned; score rules updated.")
        except Exception as ex:
            print(f"[init] Fake data cleanup error: {ex}")

    # ── One-time: fix stream assignments per real engineer roles ──────────────
    # seed_data() originally seeded all three with ["dev","support","docs"].
    # That caused Vinogradov (docs only, no GitHub) to accumulate dev XP.
    # Malyshev was added later via admin with an unknown stream; ensure "dev".
    c.execute("SELECT value FROM config WHERE key='_streams_fixed_v1'")
    if not c.fetchone():
        try:
            conn.execute("UPDATE team_members SET stream='[\"dev\"]'  WHERE name='Andrey Brunetkin'")
            conn.execute("UPDATE team_members SET stream='[\"dev\"]'  WHERE name='Andrey Pogrebnyak'")
            conn.execute("UPDATE team_members SET stream='[\"docs\"]' WHERE name='Evgeniy Vinogradov'")
            conn.execute("UPDATE team_members SET stream='[\"dev\"]'  WHERE name='Aleksandr Malyshev'")
            conn.execute(
                "INSERT OR REPLACE INTO config (key,value) "
                "VALUES ('_streams_fixed_v1','1')"
            )
            conn.commit()
            print("[init] Stream assignments corrected for all engineers.")
        except Exception as ex:
            print(f"[init] Stream fix error: {ex}")

    # ── One-time: remove fake bulk-inserted dev_metrics for weeks 14-21 ───────
    # GitHub sync only writes to current_week. Weeks 14-21 were never the
    # current week when a real sync ran, so their prs_merged / commits_count
    # values come from the original mock seed — not real GitHub data.
    # Week 22+ is real (GitHub sync or manual admin entry). Safe to delete old.
    c.execute("SELECT value FROM config WHERE key='_fake_dev_weeks_removed_v1'")
    if not c.fetchone():
        try:
            deleted = conn.execute(
                "DELETE FROM dev_metrics WHERE year=2026 AND week BETWEEN 14 AND 21"
            ).rowcount
            conn.execute(
                "INSERT OR REPLACE INTO config (key,value) "
                "VALUES ('_fake_dev_weeks_removed_v1','1')"
            )
            conn.commit()
            print(f"[init] Removed {deleted} fake dev_metrics rows (weeks 14-21 / 2026).")
        except Exception as ex:
            print(f"[init] Fake dev weeks removal error: {ex}")

    conn.close()


def seed_data():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM team_members")
    if c.fetchone()[0] > 0:
        conn.close()
        return

    # DO NOT CHANGE THESE NAMES
    members = [
        ("Andrey Brunetkin",   '["dev"]',  "#00cfff"),
        ("Andrey Pogrebnyak",  '["dev"]',  "#7b61ff"),
        ("Evgeniy Vinogradov", '["docs"]', "#00ff9d"),
        ("Aleksandr Malyshev", '["dev"]',  "#ff6b35"),
    ]
    c.executemany("INSERT INTO team_members (name, stream, avatar_color) VALUES (?,?,?)", members)
    conn.commit()

    now = datetime.utcnow().isocalendar()
    current_week = now[1]
    current_year = now[0]

    rules = [
        ("dev", "pr_merged",        "PR merged",   100, None),
        ("dev", "commit",           "Commit",        10, None),
        ("dev", "ticket_closed",    "Ticket closed",  0, None),
        ("dev", "fast_cycle",       "Cycle time bonus", 0, '{"metric":"cycle_time_days","lt":2}'),
        ("support", "incident_resolved", "Incident resolved", 80, None),
        ("support", "fast_resolve", "Resolved < 2h (bonus)", 50, '{"metric":"avg_resolution_hours","lt":2}'),
        ("support", "sla_breached", "SLA breached", -40, None),
        ("docs", "doc_created",     "Doc created",   30, None),
        ("docs", "doc_updated",     "Doc updated",   15, None),
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
    # Score only from real GitHub sync data — PRs and commits
    bd["pr_merged"] = m["prs_merged"] * rule_pts(rules, "pr_merged")
    bd["commit"]    = m.get("commits_count", 0) * rule_pts(rules, "commit")
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
    now = datetime.utcnow().isocalendar()
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
    end = datetime.utcnow()
    start = end - timedelta(days=30)
    qs = (
        f"?starting_at={start.strftime('%Y-%m-%dT00:00:00Z')}"
        f"&ending_at={end.strftime('%Y-%m-%dT23:59:59Z')}"
        f"&bucket_width=1d&group_by[]=api_key_id"
    )

    # Load key → engineer mapping from DB
    c = conn.cursor()
    c.execute("SELECT anthropic_key_id, engineer_id FROM api_key_mapping")
    key_to_eng = {r["anthropic_key_id"]: r["engineer_id"] for r in c.fetchall()}
    c.execute("SELECT id, name, stream FROM team_members")
    eng_info = {r["id"]: dict(r) for r in c.fetchall()}

    # Fetch all pages — next_page decodes to next starting_at, not a query param
    end_str   = end.strftime('%Y-%m-%dT23:59:59Z')
    start_str = start.strftime('%Y-%m-%dT00:00:00Z')
    all_buckets: list = []
    while True:
        url = (
            f"/v1/organizations/usage_report/messages"
            f"?starting_at={start_str}&ending_at={end_str}"
            f"&bucket_width=1d&group_by[]=api_key_id"
        )
        data = _anthropic_get(url, admin_key, usage_beta=False)
        all_buckets.extend(data.get("data", []))
        if not data.get("has_more"):
            break
        token = data.get("next_page", "")
        if not token:
            break
        try:
            b64 = token.replace("page_", "", 1) + "=="
            start_str = base64.b64decode(b64).decode()
        except Exception:
            break

    day_map: dict = {}
    user_map: dict = {}
    total_tokens = 0

    for bucket in all_buckets:
        date_str = (bucket.get("starting_at") or "")[:10]
        for result in bucket.get("results", []):
            key_id    = result.get("api_key_id", "")
            input_tok = result.get("uncached_input_tokens", 0) + result.get("cache_read_input_tokens", 0)
            output_tok = result.get("output_tokens", 0)
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

    # Fetch all pages — next_page decodes to next starting_at, not a query param
    end_str   = end_dt.strftime('%Y-%m-%dT23:59:59Z')
    start_str = start_dt.strftime('%Y-%m-%dT00:00:00Z')
    all_buckets: list = []
    while True:
        url = (
            f"/v1/organizations/usage_report/messages"
            f"?starting_at={start_str}&ending_at={end_str}"
            f"&bucket_width=1d&group_by[]=api_key_id"
        )
        data = _anthropic_get(url, admin_key, usage_beta=False)
        all_buckets.extend(data.get("data", []))
        if not data.get("has_more"):
            break
        token = data.get("next_page", "")
        if not token:
            break
        try:
            b64 = token.replace("page_", "", 1) + "=="
            start_str = base64.b64decode(b64).decode()
        except Exception:
            break

    # Aggregate by (engineer_id, date) — response is bucketed: data[].results[]
    agg: dict = {}
    for bucket in all_buckets:
        date_str = (bucket.get("starting_at") or "")[:10]
        if not date_str:
            continue
        for result in bucket.get("results", []):
            key_id = result.get("api_key_id", "")
            engineer_id = key_map.get(key_id)
            if not engineer_id:
                continue
            input_tok  = result.get("uncached_input_tokens", 0) + result.get("cache_read_input_tokens", 0)
            output_tok = result.get("output_tokens", 0)
            k = (engineer_id, date_str)
            if k not in agg:
                agg[k] = {"input_tokens": 0, "output_tokens": 0}
            agg[k]["input_tokens"]  += input_tok
            agg[k]["output_tokens"] += output_tok

    records = 0
    for (engineer_id, date_str), tok in agg.items():
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

    # Always use the real ISO week — config.current_week is for display/scoring only
    _now = datetime.utcnow().isocalendar()
    week, year = _now[1], _now[0]
    jan4 = datetime(year, 1, 4).date()
    week1_monday = jan4 - timedelta(days=jan4.weekday())
    week_monday  = week1_monday + timedelta(weeks=week - 1)
    week_sunday  = week_monday  + timedelta(days=6)

    # Fetch merged PRs per repo, filtered to current week
    pr_counts = {}   # github_login -> count
    total_prs = 0
    in_week_prs = []  # (owner_repo, pr_number, title, body, merged_at, login)

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
                in_week_prs.append((owner_repo, pr.get("number"), pr.get("title") or "", pr.get("body") or "", merged_at, login))

    print(f"[GitHub sync] PR counts by login: {pr_counts}")

    # Fetch commits to each repo's default branch per engineer, filtered to current week
    commit_counts = {}  # github_login -> count
    since_iso = f"{week_monday.isoformat()}T00:00:00Z"
    until_iso = f"{week_sunday.isoformat()}T23:59:59Z"

    # Resolve login → member_id once for commit_log inserts
    login_to_member = {}
    for login, eng_name in username_map.items():
        c.execute("SELECT id FROM team_members WHERE name=?", (eng_name,))
        row = c.fetchone()
        if row:
            login_to_member[login] = row["id"]

    # Fetch full details + commits for each in-week PR and upsert into pr_log
    for owner_repo, pr_number, title, body, merged_at_str, login in in_week_prs:
        member_id = login_to_member.get(login)
        if not member_id:
            continue
        try:
            detail = gh_get(f"https://api.github.com/repos/{owner_repo}/pulls/{pr_number}")
            additions     = detail.get("additions", 0)
            deletions     = detail.get("deletions", 0)
            changed_files = detail.get("changed_files", 0)
        except Exception as e:
            print(f"[GitHub sync] Failed to fetch PR #{pr_number} details: {e}")
            additions = deletions = changed_files = 0
        try:
            commits_data = gh_get(
                f"https://api.github.com/repos/{owner_repo}/pulls/{pr_number}/commits?per_page=100"
            )
            commits_list = [
                {
                    "sha": (entry.get("sha") or "")[:7],
                    "message": ((entry.get("commit") or {}).get("message") or "").split("\n")[0].strip(),
                }
                for entry in (commits_data if isinstance(commits_data, list) else [])
            ]
        except Exception as e:
            print(f"[GitHub sync] Failed to fetch PR #{pr_number} commits: {e}")
            commits_list = []
        try:
            c.execute(
                "INSERT OR REPLACE INTO pr_log "
                "(member_id, week, year, repo, pr_number, title, body, "
                "additions, deletions, changed_files, merged_at, commits) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (member_id, week, year, owner_repo, pr_number, title, body,
                 additions, deletions, changed_files, merged_at_str,
                 json_lib.dumps(commits_list)),
            )
            print(f"[GitHub sync] pr_log saved PR #{pr_number} ({owner_repo}): "
                  f"+{additions}/-{deletions}, {len(commits_list)} commit(s)")
        except Exception as ex:
            print(f"[GitHub sync] pr_log insert failed for PR #{pr_number}: {ex}")

    # Build case-insensitive lookup tables
    login_to_member_ci = {k.lower(): v for k, v in login_to_member.items()}
    login_canonical    = {k.lower(): k for k in login_to_member}
    # Reverse: engineer name (lower) → canonical login  (for git-name fallback)
    name_to_login = {
        eng_name.lower(): login
        for login, eng_name in username_map.items()
        if login in login_to_member
    }
    print(f"[GitHub sync] username_map in use: {username_map}")

    def _resolve_login(entry: dict) -> str:
        """Return the canonical username_map login for a commit entry, or ''.

        Attribution order for Lovable/bot co-authored commits:
          1. author.login   — if it is NOT a bot account
          2. committer.login — always checked when author is a bot or unknown
          3. git commit author name == known GitHub login or engineer name
          4. git commit committer name (same two checks)
          5. Co-authored-by trailers in commit message
        If author.login ends with '[bot]', steps 1 is skipped and we go
        straight to committer (rule 4 in the user spec).
        """
        gh_author = ((entry.get("author") or {}).get("login") or "").strip()
        is_bot = gh_author.endswith("[bot]")

        # 1. author.login — skip if it's a bot account (e.g. lovable-dev[bot])
        if not is_bot and gh_author and login_canonical.get(gh_author.lower()):
            return login_canonical[gh_author.lower()]

        # 2. committer.login — preferred fallback when author is a bot
        gh_committer = ((entry.get("committer") or {}).get("login") or "").strip()
        if gh_committer and not gh_committer.endswith("[bot]") \
                and login_canonical.get(gh_committer.lower()):
            return login_canonical[gh_committer.lower()]

        cmt = entry.get("commit") or {}
        # 3. Git author name == GitHub login
        git_author_name = ((cmt.get("author") or {}).get("name") or "").strip()
        if git_author_name and login_canonical.get(git_author_name.lower()):
            return login_canonical[git_author_name.lower()]
        # 4. Git author name == engineer display name
        if git_author_name and name_to_login.get(git_author_name.lower()):
            return name_to_login[git_author_name.lower()]
        # 5. Git committer name (same two checks)
        git_committer_name = ((cmt.get("committer") or {}).get("name") or "").strip()
        if git_committer_name and login_canonical.get(git_committer_name.lower()):
            return login_canonical[git_committer_name.lower()]
        if git_committer_name and name_to_login.get(git_committer_name.lower()):
            return name_to_login[git_committer_name.lower()]
        # 6. Co-authored-by trailers in commit message (Lovable pattern)
        message = (cmt.get("message") or "")
        for m in re.finditer(r"(?im)^co-authored-by:\s*(.+?)\s*<([^>]+)>", message):
            co_name  = m.group(1).strip()
            co_email = m.group(2).strip()
            if co_name and login_canonical.get(co_name.lower()):
                return login_canonical[co_name.lower()]
            if co_name and name_to_login.get(co_name.lower()):
                return name_to_login[co_name.lower()]
            local = co_email.split("@")[0].lower() if "@" in co_email else ""
            if local and login_canonical.get(local):
                return login_canonical[local]
        return ""

    for repo in repos:
        owner_repo = repo if "/" in repo else f"{org}/{repo}"
        page = 1
        while True:
            qs = urllib.parse.urlencode({
                "since": since_iso,
                "until": until_iso,
                "per_page": 100,
                "page": page,
            })
            url = f"https://api.github.com/repos/{owner_repo}/commits?{qs}"
            try:
                page_data = gh_get(url)
            except ValueError as e:
                if "404" in str(e) or "409" in str(e):
                    print(f"[GitHub sync] {owner_repo}: empty or inaccessible — skipping commits")
                break
            if not isinstance(page_data, list) or not page_data:
                break
            for entry in page_data:
                sha_short = (entry.get("sha") or "")[:7]
                cmt       = entry.get("commit") or {}
                gh_author_login     = ((entry.get("author")    or {}).get("login") or "")
                gh_committer_login  = ((entry.get("committer") or {}).get("login") or "")
                git_author_name     = ((cmt.get("author")      or {}).get("name")  or "")
                print(f"[GitHub sync] {owner_repo} {sha_short}: "
                      f"author.login={gh_author_login!r} "
                      f"committer.login={gh_committer_login!r} "
                      f"git_name={git_author_name!r}")
                canonical = _resolve_login(entry)
                if not canonical:
                    continue
                member_id = login_to_member_ci[canonical.lower()]
                commit_counts[canonical] = commit_counts.get(canonical, 0) + 1
                sha          = entry.get("sha") or ""
                msg          = (cmt.get("message") or "").strip()
                committed_at = (cmt.get("committer") or {}).get("date") or ""
                if sha and committed_at:
                    try:
                        c.execute(
                            "INSERT OR IGNORE INTO commit_log "
                            "(member_id, week, year, repo, sha, message, committed_at) "
                            "VALUES (?,?,?,?,?,?,?)",
                            (member_id, week, year, owner_repo, sha, msg, committed_at),
                        )
                    except Exception as ex:
                        print(f"[GitHub sync] commit_log insert failed for {sha[:7]}: {ex}")
            if len(page_data) < 100:
                break
            page += 1

    total_commits = sum(commit_counts.values())
    print(f"[GitHub sync] Commit counts by login: {commit_counts}")

    # Map logins → engineers and write PRs + commits to dev_metrics
    records_updated = 0
    all_logins = set(pr_counts.keys()) | set(commit_counts.keys())
    for login in all_logins:
        eng_name = username_map.get(login)
        pr_n = pr_counts.get(login, 0)
        cm_n = commit_counts.get(login, 0)
        print(f"[GitHub sync] {login!r} → engineer {eng_name!r} ({pr_n} PR(s), {cm_n} commit(s))")
        if not eng_name:
            continue
        c.execute("SELECT id FROM team_members WHERE name=?", (eng_name,))
        row = c.fetchone()
        if not row:
            continue
        member_id = row["id"]
        c.execute(
            "SELECT id FROM dev_metrics WHERE member_id=? AND week=? AND year=?",
            (member_id, week, year),
        )
        existing = c.fetchone()
        if existing:
            c.execute(
                "UPDATE dev_metrics SET prs_merged=?, commits_count=? "
                "WHERE member_id=? AND week=? AND year=?",
                (pr_n, cm_n, member_id, week, year),
            )
        else:
            c.execute(
                "INSERT INTO dev_metrics "
                "(member_id, week, year, prs_merged, tickets_closed, cycle_time_days, features_completed, deploys, commits_count) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (member_id, week, year, pr_n, 0, 0.0, 0, 0, cm_n),
            )
        records_updated += 1

    conn.commit()

    if total_prs == 0 and total_commits == 0:
        msg = f"No PRs or commits found in week {week} across {len(repos)} repo(s)"
    else:
        msg = (
            f"Synced {total_prs} merged PR(s), {total_commits} commit(s) "
            f"→ {records_updated} engineer(s) updated (week {week})"
        )
    return records_updated, msg


def _do_github_backfill(conn, weeks: int = 8) -> tuple:
    """Fetch the last `weeks` ISO weeks of PRs and commits from GitHub and
    back-fill commit_log, pr_log, and dev_metrics.  Idempotent — skips
    records that already exist (UNIQUE constraints)."""
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
        req = urllib.request.Request(url, headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "dashboard-sync/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json_lib.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise ValueError(f"GitHub API error {e.code}: {e.reason}")
        except Exception as e:
            raise ValueError(f"Request failed: {e}")

    # --- Date range ---
    cur_week, cur_year = current_week_year(conn)
    jan4 = datetime(cur_year, 1, 4).date()
    week1_monday = jan4 - timedelta(days=jan4.weekday())
    cur_monday   = week1_monday + timedelta(weeks=cur_week - 1)
    cur_sunday   = cur_monday + timedelta(days=6)

    # Start N weeks back (handle year wrap)
    start_week = cur_week - weeks + 1
    start_year = cur_year
    if start_week < 1:
        start_week += 52
        start_year -= 1
    sjan4 = datetime(start_year, 1, 4).date()
    sweek1_monday = sjan4 - timedelta(days=sjan4.weekday())
    range_start  = sweek1_monday + timedelta(weeks=start_week - 1)
    range_end    = cur_sunday

    since_iso = f"{range_start.isoformat()}T00:00:00Z"
    until_iso = f"{range_end.isoformat()}T23:59:59Z"
    print(f"[backfill] range {range_start} → {range_end} ({weeks} weeks)")

    # --- Login → member_id maps ---
    login_to_member: dict = {}
    for login, eng_name in username_map.items():
        c.execute("SELECT id FROM team_members WHERE name=?", (eng_name,))
        row = c.fetchone()
        if row:
            login_to_member[login] = row["id"]
    login_to_member_ci = {k.lower(): v for k, v in login_to_member.items()}
    login_canonical    = {k.lower(): k for k in login_to_member}
    name_to_login      = {
        eng.lower(): login
        for login, eng in username_map.items()
        if login in login_to_member
    }

    def resolve_login(entry: dict) -> str:
        """Return canonical username_map login for a commit entry, or ''.
        Mirrors _resolve_login in _do_github_sync — see that function for docs.
        """
        gh_author = ((entry.get("author") or {}).get("login") or "").strip()
        is_bot = gh_author.endswith("[bot]")

        if not is_bot and gh_author and login_canonical.get(gh_author.lower()):
            return login_canonical[gh_author.lower()]

        gh_committer = ((entry.get("committer") or {}).get("login") or "").strip()
        if gh_committer and not gh_committer.endswith("[bot]") \
                and login_canonical.get(gh_committer.lower()):
            return login_canonical[gh_committer.lower()]

        cmt = entry.get("commit") or {}
        name = ((cmt.get("author") or {}).get("name") or "").strip()
        if name and login_canonical.get(name.lower()):
            return login_canonical[name.lower()]
        if name and name_to_login.get(name.lower()):
            return name_to_login[name.lower()]
        git_committer_name = ((cmt.get("committer") or {}).get("name") or "").strip()
        if git_committer_name and login_canonical.get(git_committer_name.lower()):
            return login_canonical[git_committer_name.lower()]
        if git_committer_name and name_to_login.get(git_committer_name.lower()):
            return name_to_login[git_committer_name.lower()]
        message = cmt.get("message") or ""
        for m in re.finditer(r"(?im)^co-authored-by:\s*(.+?)\s*<([^>]+)>", message):
            co_name = m.group(1).strip()
            co_email = m.group(2).strip()
            if co_name and login_canonical.get(co_name.lower()):
                return login_canonical[co_name.lower()]
            if co_name and name_to_login.get(co_name.lower()):
                return name_to_login[co_name.lower()]
            local = co_email.split("@")[0].lower() if "@" in co_email else ""
            if local and login_canonical.get(local):
                return login_canonical[local]
        return ""

    pr_inserted     = 0
    commit_inserted = 0
    affected: set   = set()  # (member_id, week, year)

    for repo in repos:
        owner_repo = repo if "/" in repo else f"{org}/{repo}"
        print(f"[backfill] processing {owner_repo}")

        # ── PRs ──────────────────────────────────────────────────────────────
        in_range_prs = []  # (owner_repo, pr_num, title, body, merged_at_str, login)
        page = 1
        while True:
            url = (f"https://api.github.com/repos/{owner_repo}/pulls"
                   f"?state=closed&per_page=100&page={page}")
            try:
                page_data = gh_get(url)
            except ValueError as e:
                print(f"[backfill] {owner_repo} pulls error: {e}")
                break
            if not isinstance(page_data, list) or not page_data:
                break
            stop = False
            for pr in page_data:
                merged_at = pr.get("merged_at")
                if not merged_at:
                    continue
                try:
                    merged_date = datetime.fromisoformat(merged_at.rstrip("Z")).date()
                except Exception:
                    continue
                if merged_date < range_start:
                    stop = True
                    break
                if merged_date > range_end:
                    continue
                login = (pr.get("user") or {}).get("login", "")
                if login:
                    in_range_prs.append((
                        owner_repo, pr.get("number"),
                        pr.get("title") or "", pr.get("body") or "",
                        merged_at, login,
                    ))
            if stop or len(page_data) < 100:
                break
            page += 1

        print(f"[backfill] {owner_repo}: {len(in_range_prs)} PR(s) in range")
        for owner_repo_pr, pr_num, title, body, merged_at_str, login in in_range_prs:
            member_id = login_to_member.get(login)
            if not member_id:
                continue
            merged_date = datetime.fromisoformat(merged_at_str.rstrip("Z")).date()
            iso = merged_date.isocalendar()
            pr_week, pr_year = iso[1], iso[0]
            try:
                detail = gh_get(
                    f"https://api.github.com/repos/{owner_repo_pr}/pulls/{pr_num}"
                )
                additions     = detail.get("additions",     0)
                deletions     = detail.get("deletions",     0)
                changed_files = detail.get("changed_files", 0)
            except Exception as e:
                print(f"[backfill] PR #{pr_num} detail error: {e}")
                additions = deletions = changed_files = 0
            try:
                cdata = gh_get(
                    f"https://api.github.com/repos/{owner_repo_pr}"
                    f"/pulls/{pr_num}/commits?per_page=100"
                )
                commits_list = [
                    {
                        "sha": (e.get("sha") or "")[:7],
                        "message": ((e.get("commit") or {}).get("message") or "").split("\n")[0].strip(),
                    }
                    for e in (cdata if isinstance(cdata, list) else [])
                ]
            except Exception:
                commits_list = []
            try:
                c.execute(
                    "INSERT OR IGNORE INTO pr_log "
                    "(member_id, week, year, repo, pr_number, title, body, "
                    "additions, deletions, changed_files, merged_at, commits) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (member_id, pr_week, pr_year, owner_repo_pr, pr_num,
                     title, body, additions, deletions, changed_files,
                     merged_at_str, json_lib.dumps(commits_list)),
                )
                if c.rowcount != 0:
                    pr_inserted += 1
            except Exception as ex:
                print(f"[backfill] pr_log insert PR #{pr_num}: {ex}")
            affected.add((member_id, pr_week, pr_year))

        # ── Commits ───────────────────────────────────────────────────────────
        page = 1
        while True:
            qs = urllib.parse.urlencode({
                "since": since_iso, "until": until_iso,
                "per_page": 100, "page": page,
            })
            url = f"https://api.github.com/repos/{owner_repo}/commits?{qs}"
            try:
                page_data = gh_get(url)
            except ValueError as e:
                print(f"[backfill] {owner_repo} commits error: {e}")
                break
            if not isinstance(page_data, list) or not page_data:
                break
            for entry in page_data:
                canonical = resolve_login(entry)
                if not canonical:
                    continue
                member_id = login_to_member_ci.get(canonical.lower())
                if not member_id:
                    continue
                cmt          = entry.get("commit") or {}
                committed_at = (cmt.get("committer") or {}).get("date") or ""
                sha          = entry.get("sha") or ""
                msg          = (cmt.get("message") or "").strip()
                if not sha or not committed_at:
                    continue
                try:
                    iso = datetime.fromisoformat(
                        committed_at.rstrip("Z")
                    ).date().isocalendar()
                    c_week, c_year = iso[1], iso[0]
                except Exception:
                    continue
                try:
                    c.execute(
                        "INSERT OR IGNORE INTO commit_log "
                        "(member_id, week, year, repo, sha, message, committed_at) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (member_id, c_week, c_year, owner_repo, sha, msg, committed_at),
                    )
                    if c.rowcount != 0:
                        commit_inserted += 1
                except Exception as ex:
                    print(f"[backfill] commit_log {sha[:7]}: {ex}")
                affected.add((member_id, c_week, c_year))
            if len(page_data) < 100:
                break
            page += 1

    # ── Rebuild dev_metrics from actual table counts ───────────────────────────
    records_updated = 0
    for member_id, w, y in sorted(affected):
        c.execute("SELECT COUNT(*) FROM commit_log WHERE member_id=? AND week=? AND year=?",
                  (member_id, w, y))
        commit_count = (c.fetchone() or [0])[0]
        c.execute("SELECT COUNT(*) FROM pr_log WHERE member_id=? AND week=? AND year=?",
                  (member_id, w, y))
        pr_count = (c.fetchone() or [0])[0]
        c.execute("SELECT id FROM dev_metrics WHERE member_id=? AND week=? AND year=?",
                  (member_id, w, y))
        if c.fetchone():
            c.execute(
                "UPDATE dev_metrics SET prs_merged=?, commits_count=? "
                "WHERE member_id=? AND week=? AND year=?",
                (pr_count, commit_count, member_id, w, y),
            )
        else:
            c.execute(
                "INSERT INTO dev_metrics "
                "(member_id, week, year, prs_merged, tickets_closed, "
                "cycle_time_days, features_completed, deploys, commits_count) "
                "VALUES (?,?,?,?,0,0.0,0,0,?)",
                (member_id, w, y, pr_count, commit_count),
            )
        records_updated += 1

    conn.commit()
    msg = (
        f"Backfill complete: {pr_inserted} PR(s) + {commit_inserted} commit(s) inserted "
        f"→ {records_updated} engineer-week(s) updated across {weeks} week(s)"
    )
    print(f"[backfill] {msg}")
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
    week, year = current_week_year(conn)
    conn.close()
    return {
        "team_name": cfg.get("team_name", "Engineering Team"),
        "current_week": week,
        "current_year": year,
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
def metrics_dev(week: Optional[int] = None, year: Optional[int] = None):
    conn = get_db()
    c = conn.cursor()
    rules = get_rules(conn)
    cw, cy = current_week_year(conn)
    if week is None: week = cw
    if year is None: year = cy

    c.execute("SELECT * FROM team_members")
    members = [m for m in [dict(r) for r in c.fetchall()] if "dev" in parse_streams(m["stream"])]
    weeks = _weeks_range(week)

    weekly_chart = []
    totals = {"prs_merged": 0, "tickets_closed": 0, "cycle_time_days": [], "features_completed": 0, "deploys": 0, "commits_count": 0}
    bottlenecks = []

    for i, w in enumerate(weeks):
        wd = {"week": f"W{w}", "score": 0, "prs": 0, "tickets": 0, "deploys": 0, "commits": 0}
        for m in members:
            c.execute("SELECT * FROM dev_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], w, year))
            row = c.fetchone()
            if row:
                row = dict(row)
                sc, _ = calc_dev(row, rules)
                wd["score"] += sc
                wd["prs"]     += row["prs_merged"]
                wd["tickets"] += row["tickets_closed"]
                wd["deploys"] += row["deploys"]
                wd["commits"] += row.get("commits_count", 0)
                if i == 7:
                    totals["prs_merged"] += row["prs_merged"]
                    totals["tickets_closed"] += row["tickets_closed"]
                    totals["cycle_time_days"].append(row["cycle_time_days"])
                    totals["features_completed"] += row["features_completed"]
                    totals["deploys"] += row["deploys"]
                    totals["commits_count"] += row.get("commits_count", 0)
        weekly_chart.append(wd)

    for m in members:
        c.execute("SELECT * FROM dev_metrics WHERE member_id=? AND week=? AND year=?", (m["id"], week, year))
        row = c.fetchone()
        row = dict(row) if row else {}
        bottlenecks.append({
            "name":           m["name"],
            "color":          m.get("avatar_color", "#ccc"),
            "prs_merged":     row.get("prs_merged", 0),
            "commits_count":  row.get("commits_count", 0),
            "cycle_time_days":row.get("cycle_time_days", 0),
            "deploys":        row.get("deploys", 0),
        })

    ct_list = totals["cycle_time_days"]
    avg_ct = round(sum(ct_list) / len(ct_list), 1) if ct_list else 0

    # Avg PR size: (additions + deletions) per merged PR this week from pr_log
    c.execute(
        "SELECT COALESCE(SUM(additions + deletions), 0) AS total_lines, "
        "COUNT(*) AS pr_count FROM pr_log WHERE week=? AND year=?",
        (week, year),
    )
    pr_size_row = c.fetchone()
    total_lines = pr_size_row["total_lines"] if pr_size_row else 0
    pr_count    = pr_size_row["pr_count"]    if pr_size_row else 0
    avg_pr_size = round(total_lines / pr_count) if pr_count else 0

    conn.close()
    return {
        "totals": {
            "prs_merged": totals["prs_merged"],
            "tickets_closed": totals["tickets_closed"],
            "avg_cycle_time": avg_ct,
            "avg_pr_size": avg_pr_size,
            "features_completed": totals["features_completed"],
            "deploys": totals["deploys"],
            "deploy_frequency": round(totals["deploys"] / max(len(members), 1), 1),
            "commits_count": totals["commits_count"],
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


class ReportBulkItem(BaseModel):
    engineer_name: str
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
    position: Optional[str] = None


class DepartmentCreate(BaseModel):
    name: str


class RegisterEngineerRequest(BaseModel):
    first_name:    str
    last_name:     str
    email:         str
    department_id: int


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
    if data.position is not None:
        c.execute("UPDATE team_members SET position=? WHERE id=?", (data.position, member_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.patch("/api/engineers/{member_id}")
def patch_engineer(member_id: int, data: MemberUpdate, password: str = ""):
    return update_member(member_id, data, password)


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


# ── Departments & self-registration ────────────────────────────────────────────

@app.get("/api/departments")
def get_departments():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, name, slug FROM departments WHERE active=1 ORDER BY id")
    rows = c.fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"], "slug": r["slug"]} for r in rows]


ENGINEER_COLORS = [
    "#00cfff", "#7b61ff", "#00ff9d", "#ffa200", "#ff6b6b",
    "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#06b6d4",
]


@app.post("/api/register-engineer")
def register_engineer(data: RegisterEngineerRequest):
    import secrets as secrets_mod

    if not data.email.lower().endswith("@homealliance.com"):
        raise HTTPException(422, "Only @homealliance.com email addresses are allowed")

    if len(data.first_name.strip()) < 2 or len(data.last_name.strip()) < 2:
        raise HTTPException(422, "First name and last name must be at least 2 characters")

    conn = get_db()
    c = conn.cursor()

    c.execute("SELECT id FROM team_members WHERE LOWER(email)=LOWER(?)", (data.email,))
    if c.fetchone():
        conn.close()
        raise HTTPException(409, "Email already registered")

    c.execute("SELECT id, name FROM departments WHERE id=? AND active=1", (data.department_id,))
    dept = c.fetchone()
    if not dept:
        conn.close()
        raise HTTPException(404, "Department not found")

    c.execute("SELECT avatar_color FROM team_members WHERE department_id=?", (data.department_id,))
    used_colors = {r["avatar_color"] for r in c.fetchall()}
    available = [col for col in ENGINEER_COLORS if col not in used_colors]
    color = available[0] if available else ENGINEER_COLORS[len(used_colors) % len(ENGINEER_COLORS)]

    secret = secrets_mod.token_hex(24)

    full_name = f"{data.first_name.strip()} {data.last_name.strip()}"
    c.execute(
        "INSERT INTO team_members (name, email, stream, avatar_color, department_id) VALUES (?,?,?,?,?)",
        (full_name, data.email.lower(), json_lib.dumps(["dev"]), color, data.department_id)
    )
    engineer_id = c.lastrowid

    c.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
        (f"secret_{engineer_id}", secret)
    )
    conn.commit()
    conn.close()

    return {
        "engineer_id": engineer_id,
        "secret":      secret,
        "name":        full_name,
        "email":       data.email.lower(),
        "department":  dept["name"],
        "color":       color,
    }


@app.get("/api/departments/{dept_id}/members")
def get_department_members(dept_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT id, name, avatar_color, email FROM team_members WHERE department_id=? ORDER BY id",
        (dept_id,)
    )
    rows = c.fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"], "color": r["avatar_color"], "email": r["email"]} for r in rows]


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


@app.get("/api/engineers/{member_id}/commits")
def get_engineer_commits(member_id: int):
    """Return commits for an engineer across the last 8 ISO weeks, newest first."""
    conn = get_db()
    c = conn.cursor()
    week, year = current_week_year(conn)
    weeks = _weeks_range(week)
    placeholders = ",".join(["?"] * len(weeks))
    c.execute(
        f"SELECT repo, sha, message, committed_at "
        f"FROM commit_log "
        f"WHERE member_id=? AND year=? AND week IN ({placeholders}) "
        f"ORDER BY committed_at DESC",
        (member_id, year, *weeks),
    )
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@app.get("/api/engineers/{member_id}/prs")
def get_engineer_prs(member_id: int):
    """Return merged PRs for an engineer across the last 8 weeks, newest first."""
    conn = get_db()
    c = conn.cursor()
    week, year = current_week_year(conn)
    weeks = _weeks_range(week)
    placeholders = ",".join(["?"] * len(weeks))
    c.execute(
        f"SELECT id, member_id, week, year, repo, pr_number, title, body, "
        f"additions, deletions, changed_files, merged_at, commits "
        f"FROM pr_log "
        f"WHERE member_id=? AND year=? AND week IN ({placeholders}) "
        f"ORDER BY merged_at DESC",
        (member_id, year, *weeks),
    )
    rows = []
    for row in c.fetchall():
        d = dict(row)
        try:
            d["commits"] = json_lib.loads(d.get("commits") or "[]")
        except Exception:
            d["commits"] = []
        rows.append(d)
    conn.close()
    return rows


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


@app.get("/api/config/repos/display_names")
def get_repo_display_names():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key='repo_display_names'")
    row = c.fetchone()
    conn.close()
    try:
        return json_lib.loads(row["value"] if row and row["value"] else "{}")
    except Exception:
        return {}


@app.put("/api/config/repos/display_names")
def set_repo_display_names(body: Dict[str, str], password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
        ("repo_display_names", json_lib.dumps(body)),
    )
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


@app.get("/api/admin/metrics/dev/{week}/auto")
def admin_dev_metrics_auto(week: int, year: int = None, password: str = ""):
    """Return auto-calculated dev metrics per engineer for a given week."""
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    if year is None:
        _, year = current_week_year(conn)

    # ISO week date range for ai_usage_daily (which keys on calendar date)
    jan4 = datetime(year, 1, 4).date()
    week1_monday = jan4 - timedelta(days=jan4.weekday())
    week_monday  = week1_monday + timedelta(weeks=week - 1)
    week_sunday  = week_monday  + timedelta(days=6)
    date_from    = week_monday.isoformat()
    date_to      = week_sunday.isoformat()

    c.execute("SELECT * FROM team_members")
    members = [m for m in [dict(r) for r in c.fetchall()] if "dev" in parse_streams(m["stream"])]

    result = []
    for m in members:
        mid = m["id"]

        c.execute("SELECT COUNT(*) FROM commit_log WHERE member_id=? AND week=? AND year=?",
                  (mid, week, year))
        commits = (c.fetchone() or [0])[0]

        c.execute(
            "SELECT COALESCE(SUM(additions+deletions),0) AS lines, COUNT(*) AS cnt "
            "FROM pr_log WHERE member_id=? AND week=? AND year=?",
            (mid, week, year),
        )
        pr_row = c.fetchone()
        avg_pr_size = (
            round(pr_row["lines"] / pr_row["cnt"])
            if pr_row and pr_row["cnt"] > 0 else 0
        )

        c.execute(
            "SELECT COALESCE(SUM(tokens_input+tokens_output),0) AS total "
            "FROM ai_usage_daily WHERE engineer_id=? AND date>=? AND date<=?",
            (mid, date_from, date_to),
        )
        ai_row = c.fetchone()
        ai_tokens = int((ai_row["total"] if ai_row else 0) or 0)

        result.append({
            "member_id":    mid,
            "commits_count": commits,
            "avg_pr_size":  avg_pr_size,
            "ai_tokens":    ai_tokens,
        })

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
        # Use UPDATE/INSERT to preserve columns not managed here (cycle_time, tickets, etc.)
        c.execute("SELECT id FROM dev_metrics WHERE member_id=? AND week=? AND year=?",
                  (member_id, week, year))
        if c.fetchone():
            c.execute(
                "UPDATE dev_metrics SET prs_merged=?, commits_count=?, "
                "avg_pr_size=?, ai_tokens=? "
                "WHERE member_id=? AND week=? AND year=?",
                (m.get("prs_merged", 0), m.get("commits_count", 0),
                 m.get("avg_pr_size"),    m.get("ai_tokens"),
                 member_id, week, year),
            )
        else:
            c.execute(
                "INSERT INTO dev_metrics "
                "(member_id,week,year,prs_merged,tickets_closed,cycle_time_days,"
                "features_completed,deploys,commits_count,avg_pr_size,ai_tokens) "
                "VALUES (?,?,?,?,0,0.0,0,0,?,?,?)",
                (member_id, week, year,
                 m.get("prs_merged", 0), m.get("commits_count", 0),
                 m.get("avg_pr_size"),    m.get("ai_tokens")),
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
def get_ai_usage_history(n: int = 8):
    conn = get_db()
    c = conn.cursor()
    week, year = current_week_year(conn)

    result = []
    for i in range(n - 1, -1, -1):
        w, y = week - i, year
        if w <= 0:
            y -= 1
            w += 52
        row: dict = {"week": f"W{w}", "team": 0}
        date_from, date_to = _iso_week_bounds(w, y)
        ts_from = date_from.isoformat() + "T00:00:00"
        ts_to   = date_to.isoformat()   + "T23:59:59"
        c.execute("""
            SELECT m.name,
                   COALESCE(SUM(e.tokens_output), 0) AS tokens
            FROM ai_events e
            JOIN team_members m ON m.id = e.engineer_id
            WHERE e.timestamp >= ? AND e.timestamp <= ?
            GROUP BY m.id
        """, (ts_from, ts_to))
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


# ── Claude Code telemetry ─────────────────────────────────────────────────────

class TelemetryEvent(BaseModel):
    event_id: str
    session_id: str
    timestamp: str
    model: Optional[str] = "unknown"
    tokens_input: int = 0
    tokens_output: int = 0
    tokens_cache_read: int = 0
    tokens_cache_write: int = 0
    repo: Optional[str] = None


class TelemetryPayload(BaseModel):
    engineer_id: int
    secret: str
    events: List[TelemetryEvent]


@app.post("/api/telemetry/events")
def ingest_telemetry(payload: TelemetryPayload):
    if not TELEMETRY_SECRET or payload.secret != TELEMETRY_SECRET:
        raise HTTPException(401, "Invalid telemetry secret")
    conn = get_db()
    c = conn.cursor()
    accepted = 0
    duplicate = 0
    for ev in payload.events:
        # Parse date from timestamp (YYYY-MM-DD)
        try:
            date = ev.timestamp[:10]
        except Exception:
            continue
        # INSERT OR IGNORE — event_id is the dedup key
        c.execute(
            "INSERT OR IGNORE INTO ai_events "
            "(event_id, engineer_id, session_id, timestamp, model, "
            "tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, repo) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (ev.event_id, payload.engineer_id, ev.session_id, ev.timestamp,
             ev.model or "unknown", ev.tokens_input, ev.tokens_output,
             ev.tokens_cache_read, ev.tokens_cache_write, ev.repo),
        )
        inserted = getattr(c, "rowcount", -1)
        # rowcount == 0 means IGNORE fired (duplicate)
        if inserted == 0:
            duplicate += 1
            continue
        accepted += 1
        # Upsert daily aggregate — increment on conflict
        try:
            c.execute(
                "INSERT INTO ai_usage_daily "
                "(engineer_id, date, tokens_input, tokens_output, sessions_count) "
                "VALUES (?, ?, ?, ?, 1) "
                "ON CONFLICT(engineer_id, date) DO UPDATE SET "
                "tokens_input = tokens_input + excluded.tokens_input, "
                "tokens_output = tokens_output + excluded.tokens_output, "
                "sessions_count = sessions_count + 1",
                (payload.engineer_id, date, ev.tokens_input, ev.tokens_output),
            )
        except Exception as ex:
            print(f"[telemetry] ai_usage_daily upsert failed: {ex}")
    conn.commit()
    conn.close()
    return {"accepted": accepted, "duplicate": duplicate}


@app.get("/api/telemetry/debug")
def telemetry_debug(password: str = ""):
    """Show actual engineer_ids in ai_events and ai_usage_daily.
    Use this to diagnose mismatches between stored events and team_members.
    """
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()

    c.execute("SELECT id, name FROM team_members ORDER BY id")
    members = [dict(r) for r in c.fetchall()]

    try:
        c.execute("""
            SELECT engineer_id,
                   COUNT(*) AS events,
                   SUM(tokens_input)  AS total_input,
                   SUM(tokens_output) AS total_output,
                   MIN(timestamp) AS first_event,
                   MAX(timestamp) AS last_event
            FROM ai_events
            GROUP BY engineer_id
            ORDER BY engineer_id
        """)
        events_by_eng = [dict(r) for r in c.fetchall()]
    except Exception:
        events_by_eng = []

    try:
        c.execute("""
            SELECT engineer_id,
                   COUNT(*) AS days,
                   SUM(tokens_input)  AS total_input,
                   SUM(tokens_output) AS total_output
            FROM ai_usage_daily
            GROUP BY engineer_id
            ORDER BY engineer_id
        """)
        daily_by_eng = [dict(r) for r in c.fetchall()]
    except Exception:
        daily_by_eng = []

    conn.close()
    return {
        "team_members":              members,
        "ai_events_by_engineer":     events_by_eng,
        "ai_usage_daily_by_engineer": daily_by_eng,
    }


@app.post("/api/telemetry/fix-attribution")
def fix_telemetry_attribution(from_id: int, to_id: int, password: str = ""):
    """Re-attribute all ai_events + ai_usage_daily from from_id → to_id.
    Rebuilds ai_usage_daily for both IDs from ai_events to ensure accuracy.
    """
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()

    # Move events to correct engineer
    c.execute("UPDATE ai_events SET engineer_id=? WHERE engineer_id=?", (to_id, from_id))
    events_updated = c.rowcount

    # Rebuild ai_usage_daily for affected engineers from source-of-truth ai_events
    c.execute("DELETE FROM ai_usage_daily WHERE engineer_id IN (?, ?)", (from_id, to_id))
    c.execute("""
        INSERT INTO ai_usage_daily (engineer_id, date, tokens_input, tokens_output, sessions_count)
        SELECT
            engineer_id,
            DATE(timestamp) AS date,
            SUM(tokens_input)           AS tokens_input,
            SUM(tokens_output)          AS tokens_output,
            COUNT(DISTINCT session_id)  AS sessions_count
        FROM ai_events
        WHERE engineer_id IN (?, ?)
        GROUP BY engineer_id, DATE(timestamp)
    """, (from_id, to_id))
    days_rebuilt = c.rowcount

    conn.commit()
    conn.close()
    print(f"[telemetry] fix-attribution: {events_updated} events moved {from_id}→{to_id}, {days_rebuilt} daily rows rebuilt")
    return {"events_updated": events_updated, "days_rebuilt": days_rebuilt, "from_id": from_id, "to_id": to_id}


@app.post("/api/telemetry/reprocess")
def reprocess_telemetry(engineer_id: int, password: str = ""):
    """Rebuild ai_usage_daily for one engineer from ai_events, using the
    event's own timestamp for the date (not the server receive date).

    Use this when ai_usage_daily.date is wrong — e.g. all rows show today
    because the collector used datetime.now() as a fallback for events that
    had no timestamp field in the session file.  ai_events.timestamp is the
    source of truth; this query rebuilds the daily aggregate from it.
    """
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()

    c.execute("DELETE FROM ai_usage_daily WHERE engineer_id=?", (engineer_id,))
    deleted = c.rowcount

    # Use substr(timestamp,1,10) — works in both SQLite and Postgres and
    # avoids DATE() which can vary by locale/timezone settings.
    c.execute("""
        INSERT INTO ai_usage_daily
            (engineer_id, date, tokens_input, tokens_output, sessions_count)
        SELECT
            engineer_id,
            substr(timestamp, 1, 10)   AS date,
            SUM(tokens_input)          AS tokens_input,
            SUM(tokens_output)         AS tokens_output,
            COUNT(DISTINCT session_id) AS sessions_count
        FROM ai_events
        WHERE engineer_id = ?
        GROUP BY engineer_id, substr(timestamp, 1, 10)
    """, (engineer_id,))
    rebuilt = c.rowcount

    conn.commit()
    conn.close()
    print(f"[telemetry] reprocess engineer_id={engineer_id}: deleted {deleted} stale daily rows, rebuilt {rebuilt} from ai_events")
    return {
        "engineer_id":      engineer_id,
        "daily_rows_deleted": deleted,
        "daily_rows_rebuilt": rebuilt,
    }


def _iso_week_bounds(week: int, year: int):
    """Return (monday_date, sunday_date) for the given ISO week."""
    jan4 = datetime(year, 1, 4).date()
    week1_monday = jan4 - timedelta(days=jan4.weekday())
    monday = week1_monday + timedelta(weeks=week - 1)
    sunday = monday + timedelta(days=6)
    return monday, sunday


@app.get("/api/ai-usage/weekly")
def get_ai_usage_weekly(week: Optional[int] = None, year: Optional[int] = None):
    conn = get_db()
    c = conn.cursor()
    if week is None or year is None:
        cw, cy = current_week_year(conn)
        if week is None:
            week = cw
        if year is None:
            year = cy
    date_from, date_to = _iso_week_bounds(week, year)
    date_from_s = date_from.isoformat()
    date_to_s   = date_to.isoformat()

    # Per-engineer totals — query ai_events directly (source of truth).
    # Using ai_events instead of ai_usage_daily makes this resilient to the
    # common bug where events arrive first under the wrong engineer_id:
    # ai_events.engineer_id can be corrected via POST /api/telemetry/fix-attribution,
    # but ai_usage_daily may still be stale.  The timestamp bounds cover the
    # full Monday–Sunday ISO week in UTC.
    ts_from = date_from_s + "T00:00:00"
    ts_to   = date_to_s   + "T23:59:59"
    c.execute("""
        SELECT
            t.id, t.name, t.avatar_color, COALESCE(t.position,'') AS position,
            COALESCE(SUM(e.tokens_input),  0) AS tokens_input,
            COALESCE(SUM(e.tokens_output), 0) AS tokens_output,
            COUNT(DISTINCT e.session_id)      AS sessions,
            COUNT(DISTINCT DATE(e.timestamp)) AS active_days
        FROM team_members t
        LEFT JOIN ai_events e
               ON e.engineer_id = t.id
              AND e.timestamp >= ? AND e.timestamp <= ?
        GROUP BY t.id
        ORDER BY tokens_input DESC
    """, (ts_from, ts_to))
    engineers_rows = [dict(r) for r in c.fetchall()]

    # Daily totals for the week
    c.execute("""
        SELECT date,
               COALESCE(SUM(tokens_input),  0) AS tokens_input,
               COALESCE(SUM(tokens_output), 0) AS tokens_output
        FROM ai_usage_daily
        WHERE date >= ? AND date <= ?
        GROUP BY date
        ORDER BY date
    """, (date_from_s, date_to_s))
    daily_rows = [dict(r) for r in c.fetchall()]
    conn.close()

    total_input   = sum(e["tokens_input"]  for e in engineers_rows)
    total_output  = sum(e["tokens_output"] for e in engineers_rows)
    total_sessions = sum(e["sessions"]     for e in engineers_rows)
    active_count  = sum(1 for e in engineers_rows if e["sessions"] > 0)

    return {
        "week":                 week,
        "year":                 year,
        "total_tokens_input":   total_input,
        "total_tokens_output":  total_output,
        "total_sessions":       total_sessions,
        "engineers": [
            {
                "id":           e["id"],
                "name":         e["name"],
                "color":        e["avatar_color"] or "#00cfff",
                "position":     e["position"],
                "tokens_input":  e["tokens_input"],
                "tokens_output": e["tokens_output"],
                "sessions":      e["sessions"],
                "active_days":   e["active_days"] or 0,
            }
            for e in engineers_rows
        ],
        "daily": daily_rows,
        "active_engineers": active_count,
    }


@app.get("/api/ai-usage/engineer/{engineer_id}")
def get_ai_usage_engineer(
    engineer_id: int,
    week: Optional[int] = None,
    year: Optional[int] = None,
):
    conn = get_db()
    c = conn.cursor()
    if week is None or year is None:
        cw, cy = current_week_year(conn)
        if week is None:
            week = cw
        if year is None:
            year = cy
    date_from, date_to = _iso_week_bounds(week, year)
    date_from_s = date_from.isoformat()
    date_to_s   = date_to.isoformat()

    c.execute("SELECT id, name FROM team_members WHERE id=?", (engineer_id,))
    eng = c.fetchone()
    if not eng:
        conn.close()
        raise HTTPException(404, "Engineer not found")
    eng = dict(eng)

    # Daily breakdown
    c.execute("""
        SELECT date,
               COALESCE(tokens_input,  0) AS tokens_input,
               COALESCE(tokens_output, 0) AS tokens_output
        FROM ai_usage_daily
        WHERE engineer_id=? AND date >= ? AND date <= ?
        ORDER BY date
    """, (engineer_id, date_from_s, date_to_s))
    daily_rows = [dict(r) for r in c.fetchall()]

    # Top repos from raw events
    c.execute("""
        SELECT COALESCE(repo, 'unknown') AS repo,
               SUM(tokens_input + tokens_output) AS tokens
        FROM ai_events
        WHERE engineer_id=?
          AND timestamp >= ? AND timestamp <= ?
        GROUP BY repo
        ORDER BY tokens DESC
        LIMIT 5
    """, (engineer_id, date_from_s + "T00:00:00Z", date_to_s + "T23:59:59Z"))
    top_repos = [dict(r) for r in c.fetchall()]

    tokens_input  = sum(d["tokens_input"]  for d in daily_rows)
    tokens_output = sum(d["tokens_output"] for d in daily_rows)
    sessions      = sum(
        d.get("sessions_count", 0) for d in
        [dict(r) for r in []] # placeholder; query below
    )
    # Actual sessions from daily table
    c.execute("""
        SELECT COALESCE(SUM(sessions_count), 0) AS s
        FROM ai_usage_daily
        WHERE engineer_id=? AND date >= ? AND date <= ?
    """, (engineer_id, date_from_s, date_to_s))
    row = c.fetchone()
    sessions = row["s"] if row else 0
    conn.close()

    return {
        "engineer_id":   engineer_id,
        "name":          eng["name"],
        "week":          week,
        "year":          year,
        "tokens_input":  tokens_input,
        "tokens_output": tokens_output,
        "sessions":      sessions,
        "top_repos":     top_repos,
        "daily":         daily_rows,
    }


# ── AI weekly summary proxy ───────────────────────────────────────────────────

class WeeklySummaryRequest(BaseModel):
    engineer_name: str
    completed: list
    invisible_work: list = []
    next_tasks: list = []
    delayed_risks: list = []
    week_label: str = ""


@app.post("/api/ai/weekly-summary")
def generate_weekly_summary(data: WeeklySummaryRequest, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")

    # Prefer ANTHROPIC_API_KEY env var (standard completions key);
    # fall back to anthropic_admin_key stored in config table.
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        conn2 = get_db()
        c2 = conn2.cursor()
        c2.execute("SELECT value FROM config WHERE key='anthropic_admin_key'")
        row2 = c2.fetchone()
        conn2.close()
        api_key = (row2["value"] if row2 else "").strip()
    if not api_key:
        raise HTTPException(400, "Anthropic API key not configured. Set ANTHROPIC_API_KEY env var on Render.")

    if not data.completed and not data.invisible_work:
        return {"summary": ""}

    lines = []
    if data.completed:
        lines.append("COMPLETED:\n" + "\n".join(f"- {i}" for i in data.completed))
    if data.invisible_work:
        lines.append("INVISIBLE WORK:\n" + "\n".join(f"- {i}" for i in data.invisible_work))
    if data.next_tasks:
        lines.append("NEXT:\n" + "\n".join(f"- {i}" for i in data.next_tasks))
    if data.delayed_risks:
        lines.append("RISKS:\n" + "\n".join(f"- {i}" for i in data.delayed_risks))

    week_clause = f" for the week of {data.week_label}" if data.week_label else ""
    prompt = (
        f"You are writing a weekly engineering summary for {data.engineer_name}{week_clause}.\n\n"
        "Based on their daily reports, write a concise weekly summary (3–6 bullet points). "
        "Focus on the most impactful completed work. Group related items. Skip trivial or "
        "repetitive items. Use past tense. Each bullet should be one clear sentence.\n\n"
        + "\n\n".join(lines)
        + "\n\nReturn ONLY the bullet points, one per line, starting with \"- \". "
        "No intro, no outro, no headers."
    )

    payload = json_lib.dumps({
        "model": "claude-sonnet-4-5",
        "max_tokens": 1000,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json_lib.loads(resp.read())
        summary = (result.get("content") or [{}])[0].get("text", "").strip()
        return {"summary": summary}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise HTTPException(500, f"Anthropic API error {e.code}: {body[:200]}")
    except Exception as e:
        raise HTTPException(500, f"Anthropic API error: {str(e)}")


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


@app.get("/api/weekly-tasks")
def get_weekly_tasks_all(week: Optional[int] = None, year: Optional[int] = None):
    conn = get_db()
    c = conn.cursor()
    if week is None or year is None:
        cw, cy = current_week_year(conn)
        if week is None:
            week = cw
        if year is None:
            year = cy
    c.execute("SELECT id, name, avatar_color, position FROM team_members ORDER BY id")
    members = [dict(r) for r in c.fetchall()]
    result = []
    for m in members:
        c.execute(
            "SELECT tasks FROM weekly_tasks WHERE engineer_id=? AND week_number=? AND year=?",
            (m["id"], week, year),
        )
        row = c.fetchone()
        result.append({
            "engineer_id": m["id"],
            "name": m["name"],
            "color": m.get("avatar_color") or "#00cfff",
            "position": m.get("position") or "",
            "tasks": (row["tasks"] if row and row["tasks"] else "") or "",
        })
    conn.close()
    return {"week": week, "year": year, "tasks": result}


class WeeklyTasksBody(BaseModel):
    engineer_id: int
    week: int
    year: int
    tasks: str = ""


@app.post("/api/weekly-tasks")
def post_weekly_tasks(data: WeeklyTasksBody, password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    print(f"[weekly-tasks] save engineer_id={data.engineer_id} week={data.week} year={data.year} tasks_len={len(data.tasks)}")
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO weekly_tasks "
            "(engineer_id, week_number, year, what_was_done, next_week, stream, tasks, updated_at) "
            "VALUES (?, ?, ?, '[]', '[]', 'dev', ?, datetime('now')) "
            "ON CONFLICT(engineer_id, week_number, year) DO UPDATE SET "
            "tasks=excluded.tasks, updated_at=datetime('now')",
            (data.engineer_id, data.week, data.year, data.tasks),
        )
        conn.commit()
    except Exception as ex:
        conn.close()
        print(f"[weekly-tasks] DB error: {ex}")
        raise HTTPException(500, f"DB error: {ex}")
    conn.close()
    return {"ok": True}


@app.get("/api/reports/weekly")
def get_weekly_report(week: Optional[int] = None, year: Optional[int] = None):
    conn = get_db()
    c = conn.cursor()
    if week is None or year is None:
        cw, cy = current_week_year(conn)
        if week is None:
            week = cw
        if year is None:
            year = cy

    c.execute("SELECT value FROM config WHERE key='repo_display_names'")
    dn_row = c.fetchone()
    display_names: dict = {}
    try:
        display_names = json_lib.loads(dn_row["value"] if dn_row and dn_row["value"] else "{}")
    except Exception:
        pass

    c.execute("SELECT * FROM team_members ORDER BY name")
    members = [dict(r) for r in c.fetchall()]

    engineers_out = []
    for member in members:
        mid = member["id"]

        c.execute(
            "SELECT tasks FROM weekly_tasks WHERE engineer_id=? AND week_number=? AND year=?",
            (mid, week, year),
        )
        tasks_row = c.fetchone()
        tasks_text = (tasks_row["tasks"] if tasks_row and tasks_row["tasks"] else "") or ""

        prs = []
        pr_commit_shas: set = set()
        try:
            c.execute(
                "SELECT pr_number, title, additions, deletions, changed_files, merged_at, repo, commits "
                "FROM pr_log WHERE member_id=? AND week=? AND year=?",
                (mid, week, year),
            )
            for row in c.fetchall():
                d = dict(row)
                try:
                    d["commits"] = json_lib.loads(d.get("commits") or "[]")
                except Exception:
                    d["commits"] = []
                for pc in d["commits"]:
                    pr_commit_shas.add(pc.get("sha", ""))
                prs.append(d)
        except Exception:
            pass

        all_commits = []
        try:
            c.execute(
                "SELECT repo, sha, message, committed_at FROM commit_log "
                "WHERE member_id=? AND week=? AND year=? ORDER BY committed_at DESC",
                (mid, week, year),
            )
            all_commits = [dict(r) for r in c.fetchall()]
        except Exception:
            pass

        loose_commits = [
            cm for cm in all_commits
            if (cm.get("sha") or "")[:7] not in pr_commit_shas
        ]

        repos_data: dict = {}
        for pr in prs:
            short = pr["repo"].split("/")[-1] if "/" in pr["repo"] else pr["repo"]
            if short not in repos_data:
                repos_data[short] = {"full_repo": pr["repo"], "prs": [], "loose": []}
            repos_data[short]["prs"].append(pr)
        for cm in loose_commits:
            short = cm["repo"].split("/")[-1] if "/" in cm["repo"] else cm["repo"]
            if short not in repos_data:
                repos_data[short] = {"full_repo": cm["repo"], "prs": [], "loose": []}
            repos_data[short]["loose"].append(cm)

        projects = []
        total_commits = 0
        total_prs = 0
        total_added = 0
        total_deleted = 0

        for short_repo, rdata in repos_data.items():
            rprs = rdata["prs"]
            rloose = rdata["loose"]
            full_repo = rdata["full_repo"]
            repo_added   = sum(p.get("additions", 0) for p in rprs)
            repo_deleted = sum(p.get("deletions", 0) for p in rprs)
            repo_commits = sum(len(p["commits"]) for p in rprs) + len(rloose)

            activity = []
            for pr in sorted(rprs, key=lambda x: x.get("merged_at") or "", reverse=True):
                merged_date = (pr.get("merged_at") or "")[:10]
                activity.append({
                    "type": "pr",
                    "pr_number": pr["pr_number"],
                    "title": pr.get("title", ""),
                    "merged_at": merged_date,
                    "lines_added": pr.get("additions", 0),
                    "lines_deleted": pr.get("deletions", 0),
                    "changed_files": pr.get("changed_files", 0),
                    "commits": [
                        {"sha": pc.get("sha", ""), "message": pc.get("message", ""), "date": merged_date}
                        for pc in pr["commits"]
                    ],
                })

            day_groups: dict = {}
            for cm in rloose:
                committed_at = cm.get("committed_at", "")
                date_key = committed_at[:10] if committed_at else "unknown"
                time_str = committed_at[11:16] if len(committed_at) > 15 else ""
                if date_key not in day_groups:
                    day_groups[date_key] = []
                day_groups[date_key].append({
                    "type": "commit",
                    "sha": (cm.get("sha") or "")[:7],
                    "message": cm.get("message", ""),
                    "date": date_key,
                    "time": time_str,
                })
            for dk in sorted(day_groups, reverse=True):
                activity.extend(day_groups[dk])

            dn = display_names.get(full_repo) or display_names.get(short_repo) or ""
            projects.append({
                "repo": short_repo,
                "display_name": dn,
                "commits": repo_commits,
                "prs": len(rprs),
                "lines_added": repo_added,
                "lines_deleted": repo_deleted,
                "activity": activity,
            })
            total_commits += repo_commits
            total_prs    += len(rprs)
            total_added  += repo_added
            total_deleted += repo_deleted

        engineers_out.append({
            "id": member["id"],
            "name": member["name"],
            "position": member.get("position") or "",
            "color": member.get("avatar_color") or "#00cfff",
            "tasks": tasks_text,
            "total_commits": total_commits,
            "total_prs": total_prs,
            "lines_added": total_added,
            "lines_deleted": total_deleted,
            "projects": projects,
        })

    conn.close()
    return {"week": week, "year": year, "engineers": engineers_out}


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


@app.post("/api/reports/bulk")
def create_reports_bulk(data: List[ReportBulkItem], password: str = ""):
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, name FROM team_members")
    members = {r["name"]: r["id"] for r in c.fetchall()}

    inserted = 0
    skipped = 0
    unmatched = []
    for report in data:
        # Fuzzy name match — same logic as Slack sync
        engineer_id = None
        for mname, mid in members.items():
            if report.engineer_name.lower() in mname.lower() or mname.lower() in report.engineer_name.lower():
                engineer_id = mid
                break
        if not engineer_id:
            unmatched.append(report.engineer_name)
            continue
        c.execute(
            "SELECT id FROM daily_reports WHERE engineer_id=? AND report_date=?",
            (engineer_id, report.report_date),
        )
        if c.fetchone():
            skipped += 1
            continue
        c.execute(
            "INSERT INTO daily_reports (engineer_id, report_date, raw_text, completed, "
            "invisible_work, next_tasks, delayed_risks, source) VALUES (?,?,?,?,?,?,?,?)",
            (
                engineer_id, report.report_date, report.raw_text,
                json_lib.dumps(report.completed, ensure_ascii=False),
                json_lib.dumps(report.invisible_work, ensure_ascii=False),
                json_lib.dumps(report.next_tasks, ensure_ascii=False),
                json_lib.dumps(report.delayed_risks, ensure_ascii=False),
                report.source,
            ),
        )
        inserted += 1
    conn.commit()
    conn.close()
    return {"ok": True, "inserted": inserted, "skipped": skipped, "unmatched": unmatched}


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


@app.post("/api/sync/github/backfill")
def github_backfill(weeks: int = 8, password: str = ""):
    """Back-fill the last N ISO weeks of GitHub commits and PRs.
    Idempotent — safe to run multiple times."""
    if password != ADMIN_PASSWORD:
        raise HTTPException(403, "Unauthorized")
    conn = get_db()
    try:
        records, msg = _do_github_backfill(conn, weeks=weeks)
        conn.execute(
            "INSERT INTO sync_log (service, timestamp, status, records_updated, message) "
            "VALUES (?,?,?,?,?)",
            ("github_backfill", datetime.utcnow().isoformat(), "success", records, msg),
        )
        conn.commit()
        return {"status": "success", "records_updated": records, "message": msg}
    except Exception as exc:
        err = str(exc)
        try:
            conn.execute(
                "INSERT INTO sync_log (service, timestamp, status, records_updated, error, message) "
                "VALUES (?,?,?,?,?,?)",
                ("github_backfill", datetime.utcnow().isoformat(), "error", 0, err, err),
            )
            conn.commit()
        except Exception:
            pass
        return {"status": "error", "error": err, "message": err}
    finally:
        conn.close()


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


@app.get("/api/sync/github/commits-debug")
def github_commits_debug(repo: str = "", since: str = "", until: str = ""):
    """
    No-auth debug endpoint. Fetches up to 30 commits from the given repo
    and shows author.login, committer.login, and git author name for each.
    Useful for diagnosing attribution mismatches.

    Query params:
      repo  — short name (e.g. apollo) or owner/repo; defaults to first configured repo
      since — ISO date, e.g. 2026-05-19; defaults to start of current ISO week
      until — ISO date, e.g. 2026-05-25; defaults to end of current ISO week
    """
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT key, value FROM config WHERE key IN "
        "('github_token','github_org','github_repos','github_username_map')"
    )
    cfg = {r["key"]: r["value"] for r in c.fetchall()}
    week, year = current_week_year(conn)
    conn.close()

    token = (cfg.get("github_token") or "").strip()
    org   = (cfg.get("github_org")   or "homealliance").strip()
    repos_cfg = [r.strip() for r in (cfg.get("github_repos") or "").split(",") if r.strip()]
    try:
        username_map = json_lib.loads(cfg.get("github_username_map") or "{}")
    except Exception:
        username_map = {}

    if not token:
        return {"error": "github_token not configured"}

    # Default repo = first configured repo
    if not repo:
        repo = repos_cfg[0] if repos_cfg else ""
    if not repo:
        return {"error": "No repo specified and none configured"}
    owner_repo = repo if "/" in repo else f"{org}/{repo}"

    # Default date range = current ISO week
    if not since or not until:
        jan4 = datetime(year, 1, 4).date()
        week1_monday = jan4 - timedelta(days=jan4.weekday())
        week_monday  = week1_monday + timedelta(weeks=week - 1)
        week_sunday  = week_monday  + timedelta(days=6)
        since = since or f"{week_monday.isoformat()}T00:00:00Z"
        until = until or f"{week_sunday.isoformat()}T23:59:59Z"

    def gh_get_debug(url):
        req = urllib.request.Request(url, headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "dashboard-sync/1.0",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json_lib.loads(resp.read())

    qs = urllib.parse.urlencode({"since": since, "until": until, "per_page": 30})
    try:
        commits = gh_get_debug(f"https://api.github.com/repos/{owner_repo}/commits?{qs}")
    except Exception as e:
        return {"error": str(e), "repo": owner_repo}

    rows = []
    for entry in (commits if isinstance(commits, list) else []):
        cmt = entry.get("commit") or {}
        rows.append({
            "sha":               (entry.get("sha") or "")[:7],
            "author_login":      ((entry.get("author")    or {}).get("login") or None),
            "committer_login":   ((entry.get("committer") or {}).get("login") or None),
            "git_author_name":   ((cmt.get("author")      or {}).get("name")  or None),
            "git_author_email":  ((cmt.get("author")      or {}).get("email") or None),
            "message":           (cmt.get("message") or "").split("\n")[0][:80],
        })

    return {
        "repo": owner_repo,
        "since": since,
        "until": until,
        "username_map": username_map,
        "commit_count": len(rows),
        "commits": rows,
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
