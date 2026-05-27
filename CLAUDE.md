# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engineering Dashboard — a full-stack team performance tracker with gamification. Engineers earn XP points across three work streams based on weekly metrics. Features a public leaderboard, individual profile pages, admin panel, daily reports, and AI token usage tracking.

## Stack

- **Frontend**: React 18 + Vite, React Router v6, Recharts, Chart.js — served on port 3000
- **Backend**: Python FastAPI + SQLite/PostgreSQL via SQLAlchemy — served on port 8000
- **DB layer**: `backend/database.py` — SQLAlchemy wrapper with a `DBWrapper`/`Cursor` shim that translates SQLite syntax (`INSERT OR IGNORE`, `?` placeholders, `PRAGMA`) to PostgreSQL transparently
- **Auth**: `?password=` query param on protected endpoints; `ADMIN_PASSWORD` global loaded from `config` table at startup

## Running Locally

```bash
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
| `DATABASE_URL` | — | Full SQLAlchemy URL; takes priority over `DB_PATH` |
| `DB_PATH` | `./dashboard.db` | SQLite file path when `DATABASE_URL` not set |
| `ADMIN_PASSWORD` | `admin123` | Initial admin password (overridden by value in config table) |
| `ANTHROPIC_ADMIN_KEY` | — | Anthropic Admin API key for AI usage sync |
| `GITHUB_TOKEN` | — | GitHub token for PR sync |
| `SLACK_BOT_TOKEN` | — | Slack bot token for daily report sync |

For persistent SQLite on Render: mount a disk at e.g. `/data` and set `DB_PATH=/data/dashboard.db`.

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
`team_members`, `dev_metrics`, `support_metrics`, `docs_metrics`, `score_rules`, `config`, `ai_usage_cache`, `weekly_tasks`, `sync_log`, `api_key_mapping`, `ai_usage`, `daily_reports`

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
| POST | `/api/sync/jira` | pw | Trigger Jira sync |
| POST | `/api/sync/github` | pw | Trigger GitHub PR sync |
| GET | `/api/sync/github/debug` | — | Config + live API test + last 5 log entries |
| POST | `/api/sync/slack-reports` | pw | Trigger Slack report sync |
| POST | `/api/admin/verify` | — | Validate admin password |
| POST | `/api/admin/change-password` | — | Change admin password |

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
- On Render (ephemeral filesystem), set `DB_PATH` to a persistent disk mount to survive deploys
- `DELETE /api/metrics/mock?password=...` clears all metric rows from weeks before the current week

## PR Workflow
All changes must go through pull requests.
