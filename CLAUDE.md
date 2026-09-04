# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engineering Dashboard — a full-stack team performance tracker with gamification. Engineers earn XP points across three work streams based on weekly metrics. Features a public leaderboard, individual profile pages, admin panel, daily reports, and AI token usage tracking.

## Stack

- **Frontend**: React 18 + Vite, React Router v6, Recharts, Chart.js — served on port 3000
- **Backend**: Python FastAPI + PostgreSQL via SQLAlchemy Core (no ORM) — served on port 8000
- **DB layer**: `backend/database.py` — a `DBWrapper`/`Cursor` shim over SQLAlchemy Core that translates SQLite syntax (`INSERT OR IGNORE`, `?` placeholders, `PRAGMA`, `AUTOINCREMENT`) to PostgreSQL. `DATABASE_URL` is **required**; the app refuses to start without it (no silent SQLite fallback — avoids split-brain writes if it's ever unset in an env). SQLite still works for local testing if you explicitly set `DATABASE_URL=sqlite:///./dashboard.db`, but Postgres (via `docker-compose.yml`) is the supported local/prod backend.
- **Auth**: `?password=` query param on protected endpoints; `ADMIN_PASSWORD` global loaded from `config` table at startup

## Running Locally

```bash
# Postgres (once, or after `docker compose down -v`)
docker compose up -d
export DATABASE_URL=postgresql://dashboard:dashboard@localhost:5432/dashboard

# Backend
cd backend && python -m uvicorn main:app --port 8000 --reload

# Frontend
cd frontend && npm run dev
```

## Deployment

- **GitHub**: https://github.com/maico15/dashbord
- **Frontend (Render.com)**: https://dashbord-frontend-hb0m.onrender.com
- **Backend (Render.com)**: https://dashbord-5u0i.onrender.com
- Build scripts use `node node_modules/vite/bin/vite.js` (not `npx vite`) to avoid Render symlink permission errors
- `frontend/public/_redirects` contains `/*  /index.html  200` for SPA routing on Render
- `VITE_API_URL` env var must be set on Render frontend service to point at the backend URL

## Environment Variables (backend)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (**required**) | SQLAlchemy connection string. App raises at import time and refuses to boot if unset — see `backend/database.py`. Use `postgresql://...` in every deployed environment; `sqlite:///...` is accepted for local-only testing but must be set explicitly. |
| `ADMIN_PASSWORD` | `admin123` | Initial admin password (overridden by value in config table) |
| `ANTHROPIC_ADMIN_KEY` | — | Anthropic Admin API key for AI usage sync |
| `GITHUB_TOKEN` | — | GitHub token for PR sync |
| `SLACK_BOT_TOKEN` | — | Slack bot token for daily report sync |

Local Postgres: `docker-compose.yml` runs `postgres:16` with a named volume — `docker compose up -d`, then set `DATABASE_URL=postgresql://dashboard:dashboard@localhost:5432/dashboard`.

### Migrating existing SQLite data

`scripts/migrate_sqlite_to_pg.py` copies every table from a SQLite `dashboard.db` into
the Postgres database at `DATABASE_URL`, preserving row ids (via
`OVERRIDING SYSTEM VALUE` + `setval()` on each identity column's sequence) and
printing a per-table row-count/checksum report. Run with `--dry-run` first; always
point `--sqlite-path` at a **copy** of the database, never the live file. See
`scripts/verify_migration.py` for post-migration smoke, write-path, and concurrency
checks against a running server.

The production deployment target is moving from Render to ECS (owned by
Bachinskiy) as part of this cutover — this doc only covers what changed on the
application side (`DATABASE_URL` now mandatory); ECS task/service config is out of
scope here.

## Architecture

### Backend (`backend/main.py`)

Single-file FastAPI app (~2700 lines). Key startup sequence in `lifespan()`:

1. `init_db()` — creates all tables (idempotent)
2. `seed_data()` — only runs when `team_members` is empty; inserts engineers, score rules, default config
3. `_load_password()` — overrides `ADMIN_PASSWORD` from config table
4. `_ensure_github_username_map()` — merges required logins into saved map on every boot
5. Scheduler starts: Jira (02:00), Slack reports (20:00), AI usage (02:30) daily; GitHub every 15 min
6. `_run_github_sync()` — immediate GitHub sync on startup

Key helpers:
- `parse_streams(val)` — parses `stream` field: plain string `"dev"` (legacy) or JSON array `'["dev","support"]'`
- `current_week_year(conn)` — reads week/year from config table
- `calc_dev()`, `calc_support()`, `calc_docs()` — XP scoring from `score_rules` table
- `_anthropic_get(path, admin_key, usage_beta=True)` — HTTP call to Anthropic API with error logging

**SQLite/PostgreSQL tables**:
`team_members`, `dev_metrics`, `support_metrics`, `docs_metrics`, `score_rules`, `config`, `ai_usage_cache`, `weekly_tasks`, `sync_log`, `api_key_mapping`, `ai_usage`, `daily_reports`,
`monthly_review_meta`, `monthly_review_summary`, `monthly_review_engineers`, `monthly_review_tasks`

**Key endpoints**:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/overview` | — | Team name, current week/year |
| GET | `/api/leaderboard` | — | 8-week XP totals, badges |
| GET | `/api/metrics/{dev\|support\|docs}` | — | Stream tab data |
| GET/PUT | `/api/config` | PUT needs pw | App config key-value store |
| GET/POST/PUT/DELETE | `/api/team` | write needs pw | Team member CRUD |
| GET/POST | `/api/engineers/{id}/profile` and `/tasks` | write needs pw | Per-engineer data |
| GET/PUT | `/api/admin/metrics/{stream}/{week}/{member_id}` | pw | Manual metric entry |
| DELETE | `/api/metrics/mock` | pw | Wipe all historical metrics (keeps current week) |
| GET | `/api/ai-usage` | — | AI usage (DB → live API → mock fallback) |
| POST | `/api/ai-usage/sync` | pw | Trigger immediate AI usage sync |
| GET | `/api/ai-usage/test` | pw | Test Anthropic Admin API key |
| GET/PUT | `/api/ai-key-mappings` | PUT needs pw | Engineer ↔ Anthropic key ID mapping |
| GET | `/api/reports` | — | Daily reports by date |
| GET | `/api/monthly-review/{year}/{month}` | — | Whole review in one call — meta, summary cards, engineers with nested tasks |
| PUT | `/api/monthly-review/{year}/{month}/meta` | pw | Upsert the month's title + assumptions note |
| POST/PATCH/DELETE | `/api/monthly-review/.../summary`, `/engineers`, `/tasks` | pw | Review content CRUD |
| PATCH | `/api/monthly-review/{summary\|engineers\|tasks}/reorder` | pw | Reorder by id list |
| POST | `/api/sync/jira` | pw | Trigger Jira sync |
| POST | `/api/sync/github` | pw | Trigger GitHub PR sync |
| GET | `/api/sync/github/debug` | — | Config + live API test + last 5 log entries |
| POST | `/api/sync/slack-reports` | pw | Trigger Slack report sync |
| POST | `/api/admin/verify` | — | Validate admin password |
| POST | `/api/admin/change-password` | — | Change admin password |
| POST | `/api/telemetry/heartbeat` | per-engineer secret | Tray-agent liveness + `rss_mb` |
| GET | `/api/telemetry/agents` | pw | Fleet-wide agent memory/health |

### Frontend (`frontend/src/`)

- `api/client.js` — all API calls; uses `VITE_API_URL` env var in production, Vite proxy (`/api → localhost:8000`) in dev
- `pages/Dashboard.jsx` — 4 tabs: Development, Support, Documentation, AI Usage
- `pages/Admin.jsx` — 8 sections: Configuration, Team, Metrics, Rules, Integrations, AI Keys, Reports, Security
- `pages/AIUsageTab.jsx` — token consumption chart + per-engineer bars; Sync Now button when admin session active
- `pages/EngineerProfile.jsx` — profile + 8-week XP chart + weekly task log
- `pages/Reports.jsx` — daily reports view
- `components/Leaderboard.jsx` — clickable rows → `/engineer/:id`

## Integrations

### GitHub (every 15 min + on startup)
- Config keys: `github_token`, `github_org` (default: `homealliance`), `github_repos`, `github_username_map`
- Repo format: bare name uses org prefix (`apollo` → `homealliance/apollo`); `owner/repo` format used as-is (`maico15/dashbord`)
- Maps GitHub login → engineer name via `github_username_map`; writes `prs_merged` to `dev_metrics`

### Jira Cloud (daily 02:00 UTC)
- Config keys: `jira_domain`, `jira_email`, `jira_api_token`, `jira_project_keys`, `jira_username_map`
- Maps Jira email → engineer name; writes `tickets_closed` to `dev_metrics`

### Slack (daily 20:00 UTC)
- Config keys: `slack_bot_token`, `slack_reports_channel_id` (default: `C08NK2SD5CK`)
- Parses daily report messages from a Slack channel into `daily_reports` table

### Anthropic AI Usage (daily 02:30 UTC)
- Config keys: `anthropic_admin_key`, `ai_auto_sync`
- Endpoint: `GET https://api.anthropic.com/v1/organizations/usage` with `anthropic-beta: usage-2025-01`
- Maps `api_key_id` → engineer via `api_key_mapping` table; stores in `ai_usage` table
- Test connection: `GET https://api.anthropic.com/v1/organizations/api_keys`
- Falls back to mock data when no key configured

## Telemetry Tray Agent (`cc_tray_app.py`, v3.2)

Windows tray app on engineers' machines. Polls `~/.claude/projects/**/*.jsonl` for
Claude Code token usage and posts to `/api/telemetry/events`; a second loop tracks
browser AI-tool time and posts to `/api/telemetry/tool-sessions`.
`cc_telemetry.py` is a standalone CLI variant of the collector (same leak fixes
applied; the two files are **separate copies** and drift is a known maintenance risk).

**State files** (all under `~/.claude/`):

| File | Purpose |
|---|---|
| `telemetry_config.json` | endpoint, engineer_id, secret, optional `max_rss_mb` |
| `.telemetry_seen` | recently-sent event ids, capped at `MAX_SEEN` (50k), oldest evicted first |
| `.telemetry_offsets.json` | per-session-file byte offset — reads are incremental, never full-file |
| `telemetry_buffer.jsonl` | retry buffer, capped at `MAX_BUFFER_EVENTS` (5k), drop-oldest |
| `.telemetry_drops.json` | running count of events dropped from a full buffer |
| `telemetry_tray.log` | rotating, 2 MB × 3 backups |

**Re-sending after acknowledged-but-unstored events** (`cc_telemetry.py --reset`):

```bash
python cc_telemetry.py --reset   # rm .telemetry_seen + telemetry_buffer.jsonl, then run once
```

`.telemetry_seen` is the collector's only record of what it has already shipped,
so an event the server acknowledged with a 200 but never stored is unrecoverable
without clearing that file. `--reset` does exactly that and then replays every
session file. It is safe to repeat: `ai_events.event_id` is unique, so replays
come back counted as `duplicate`. Events are POSTed in `MAX_BATCH` (500) chunks
so a full replay cannot exceed `REQUEST_TIMEOUT`.

`POST /api/telemetry/events` answers with
`{"accepted", "duplicate", "daily_failed", "skipped"}`. The collector requires
`accepted + duplicate + skipped == len(events)` and re-buffers the batch when it
does not add up — a 200 alone is not treated as proof of storage.
`daily_failed > 0` means the `ai_events` rows landed but the `ai_usage_daily`
rollup is behind; rebuild it with `POST /api/telemetry/reprocess`.

> **Upserts must table-qualify the right-hand side.** Inside
> `ON CONFLICT ... DO UPDATE SET`, PostgreSQL has both the target table and
> `excluded` in scope, so `tokens_input = tokens_input + excluded.tokens_input`
> fails with `column reference "tokens_input" is ambiguous`. Write
> `tokens_input = ai_usage_daily.tokens_input + excluded.tokens_input`. SQLite
> accepts the qualified form too. This bug silently dropped **all** telemetry
> between the Postgres cutover and 2026-09-03 (`ai_events` and
> `ai_tool_sessions`), because the handler answered 200 after rolling the rows
> back. Grep for `DO UPDATE SET` before adding a new counter upsert.

**Heartbeat payload** (every 10 min, `POST /api/telemetry/heartbeat`):

```json
{"engineer_id": "10", "secret": "...", "version": "3.2",
 "rss_mb": 48.2, "buffered": 0, "dropped": 0}
```

Stored in the `agent_heartbeats` table (one row per engineer, upserted).
Deliberately **not** in `ai_tool_sessions` — that table feeds engineer XP via
`_compute_multisource_scores`, so a heartbeat pseudo-row there would inflate
"browser AI minutes". On a 404 the agent falls back to the legacy
`GET /api/overview` ping so older backends still get kept awake.

**Watchdog**: if RSS exceeds `max_rss_mb` (default 300) the agent logs a warning
plus the top allocation sites and flushes state. `--memdebug` runs the collector
headless with tracemalloc sampling — see `cc_memdebug.py` and
`scripts/memdebug_stub_server.py`.

## Monthly Review

The curated leadership review at `/review/august-2026` reads from the database,
not a bundled file, so a figure can be corrected without a frontend deploy.

Four tables keyed by `(month, year)`:

| Table | Holds |
|---|---|
| `monthly_review_meta` | one row per month — bilingual title, assumptions note |
| `monthly_review_summary` | the headline cards (`tone` uses the confidence scale) |
| `monthly_review_engineers` | who appears, in what order, and the role held **that month** |
| `monthly_review_tasks` | the work — task / goal / benefit / value + `confidence` |

Bilingual content is stored as parallel `_en` / `_ru` columns; the page's
`pick(row, field, lang)` reads the active half. Engineer name and colour come
from `team_members` via a join and initials are derived from the name, so those
never drift; `name_ru` lives on the review row because `team_members` holds a
single name. Roles are per-review because they change month to month
("AI / Automation · until Aug 31").

`confidence` and summary `tone` share one scale, enforced by a CHECK
constraint: `confirmed` | `estimate` | `needs_data` | `none`.

Reads are public (the page is public); every write takes `?password=`.
`GET` on a month with no rows returns empty lists rather than a 404, and the
page shows a "not published" notice. A task whose engineer is not listed in
`monthly_review_engineers` renders nowhere, so the GET reports `orphan_tasks`
and the page warns rather than dropping it silently.

**Importing a static review**: `scripts/migrate_review_to_db.py` parses a
`frontend/src/data/<month><year>.js` module and writes it into these tables.
Run `--dry-run` first. It refuses to overwrite a month whose task count has
drifted from the source file (someone edited via the API) unless `--force`.
August 2026 was imported this way and its source file deleted.

Editing is API-only for now — an Admin panel section is not built yet.

## Work Streams & Scoring

Three streams: **Development** (`dev`), **Support** (`support`), **Documentation** (`docs`). Engineers can belong to multiple streams (JSON array in `team_members.stream`). Points per action are configurable in Admin → Rules.

**Badges**: MVP (top scorer), Streak (3 rising weeks), Shield (support, zero SLA breaches in 4w), Scribe (docs, 3+ docs created this week)

## Admin Panel

Route `/admin`, default password `admin123`. Persisted in `config` table; change via Admin → Security.

Sections:
- **Configuration** — team name, week/year, GitHub token, Jira token, Anthropic Admin key, auto-sync
- **Team** — add/edit/delete engineers, inline weekly task editor
- **Metrics** — manual metric entry per engineer per week
- **Rules** — XP point values per action
- **Integrations** — Jira, Slack, GitHub settings with sync buttons and collapsible sync logs
- **AI Keys** — map engineer → Anthropic API key ID (get key IDs via `curl https://api.anthropic.com/v1/organizations/api_keys`)
- **Reports** — view/edit/delete daily reports; manual add
- **Security** — change admin password

## Team Members (DO NOT CHANGE THESE NAMES)

- Andrey Brunetkin (stream: dev, initials: AB, color: #00cfff)
- Andrey Pogrebnyak (stream: support, initials: AP, color: #7b61ff)
- Evgeniy Vinogradov (stream: docs, initials: EV, color: #00ff9d)

These are the real team members. Never replace them with fake/mock names. `seed_data()` inserts only these three. No mock metrics are seeded — all metric data comes from real syncs or manual admin input.

## GitHub Username Mapping (hardcoded in `_ensure_github_username_map`)

- `DroonPog` → Andrey Pogrebnyak
- `KlimMalgin` → Andrey Brunetkin
- `maico15` → Aleksandr Malyshev

These are merged into the saved config on every startup as defaults (saved values take precedence).

## Data Persistence Notes

- `seed_data()` only runs when `team_members` is empty — safe across restarts
- Data now persists in Postgres (`DATABASE_URL`), not an on-disk SQLite file, so
  filesystem persistence at the deploy target (Render disk, ECS ephemeral storage,
  etc.) is no longer a concern for the database itself
- `DELETE /api/metrics/mock?password=...` clears all metric rows from weeks before the current week

## PR Workflow
All changes must go through pull requests.
