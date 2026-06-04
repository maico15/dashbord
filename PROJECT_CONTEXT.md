# Engineering Dashboard — Project Context

> **Purpose:** Full onboarding reference for Claude in new chat sessions. Covers everything needed to understand, modify, and debug this project without re-reading all source files.

---

## 1. PROJECT OVERVIEW

**What it is:** A full-stack team performance tracker with gamification. Engineers earn XP points across work streams based on weekly metrics (GitHub PRs/commits, Jira tickets, Slack daily reports, Anthropic AI token usage). Features a public leaderboard, individual profile pages, an admin panel, daily reports, a weekly engineering report view, and AI token usage tracking via both the Anthropic Admin API and a local Claude Code telemetry pipeline.

**Live URLs:**
| Service | URL |
|---|---|
| Frontend | https://dashbord-frontend-hb0m.onrender.com |
| Backend API | https://dashbord-5u0i.onrender.com |
| Admin panel | https://dashbord-frontend-hb0m.onrender.com/admin |
| API docs (FastAPI) | https://dashbord-5u0i.onrender.com/docs |

**GitHub repo:** https://github.com/maico15/dashbord (note: typo in repo name is intentional)

**Default admin password:** `admin123` (overridden by value in config table)

---

## 2. ARCHITECTURE

### Folder Structure

```
dashboard/
├── backend/
│   ├── main.py          # Single-file FastAPI app (~4382 lines) — all endpoints, logic, sync jobs
│   └── database.py      # SQLAlchemy wrapper with SQLite↔PostgreSQL shim
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js              # All API calls; respects VITE_API_URL env var
│   │   ├── App.jsx                    # React Router routes
│   │   ├── main.jsx                   # Entry point, BrowserRouter
│   │   ├── index.css                  # Global styles (dark theme, CSS vars)
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx          # 4 tabs: Development, Support, Docs, AI Usage
│   │   │   ├── Admin.jsx              # 8 admin sections
│   │   │   ├── EngineerProfile.jsx    # Per-engineer profile + 8-week XP chart
│   │   │   ├── Reports.jsx            # Daily reports view by date
│   │   │   ├── AIUsageTab.jsx         # Token consumption chart + per-engineer bars
│   │   │   └── WeeklyReportTab.jsx    # Weekly engineering report (PRs, commits, tasks)
│   │   ├── components/
│   │   │   ├── Leaderboard.jsx        # Clickable rows → /engineer/:id
│   │   │   ├── XPChart.jsx            # Recharts 8-week XP bar chart
│   │   │   ├── MetricCard.jsx         # Stat display card
│   │   │   ├── BottleneckBars.jsx     # Horizontal per-engineer metric bars
│   │   │   ├── EngineerWeeklyBlock.jsx # Per-engineer weekly block in WeeklyReportTab
│   │   │   ├── RichTextEditor.jsx     # TipTap rich-text editor for tasks
│   │   │   ├── TopBar.jsx             # Navigation header
│   │   │   └── LoadingSpinner.jsx
│   │   └── hooks/
│   │       └── useTheme.js
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── public/
│       └── _redirects                 # `/* /index.html 200` — SPA routing on Render
├── CLAUDE.md                          # Claude Code project instructions
└── PROJECT_CONTEXT.md                 # This file
```

### Frontend Stack

| Library | Version | Purpose |
|---|---|---|
| React | 18.3.1 | UI framework |
| React DOM | 18.3.1 | DOM renderer |
| React Router DOM | 6.24.1 | Client-side routing |
| Vite | 5.3.4 | Build tool / dev server |
| @vitejs/plugin-react | 4.3.1 | Vite React plugin |
| Recharts | 2.12.7 | Declarative charts (XP bar charts, area charts) |
| Chart.js | 4.5.1 | Imperative charts (used in some views) |
| react-chartjs-2 | 5.3.1 | React wrapper for Chart.js |
| @tiptap/react + extensions | 3.23.6 | Rich-text editor for weekly tasks |
| DOMPurify | 3.4.7 | Sanitize TipTap HTML output before rendering |
| serve | 14.2.3 | Static file server (unused at runtime on Render) |

**Dev server:** port 3000 (`npm run dev`)
**Build command:** `node node_modules/vite/bin/vite.js build` (not `npx vite` — Render symlink issue)
**API in dev:** Vite proxy `/api → localhost:8000`
**API in prod:** `VITE_API_URL` env var → `${VITE_API_URL}/api`

### Backend Stack

| Library | Purpose |
|---|---|
| FastAPI | Web framework |
| Uvicorn | ASGI server |
| SQLAlchemy | ORM / DB connection pool |
| APScheduler | Background cron scheduler |
| Pydantic | Request/response validation |
| python-dotenv | `.env` loading (dev only) |

**Dev server:** `cd backend && python -m uvicorn main:app --port 8000 --reload`

### DB Layer (`backend/database.py`)

SQLAlchemy engine wrapping `DBWrapper`/`Cursor` shim that transparently translates:
- `INSERT OR REPLACE` → `ON CONFLICT (...) DO UPDATE SET` (PostgreSQL)
- `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING` (PostgreSQL)  
- `PRAGMA` statements → skipped on PostgreSQL
- `?` placeholders → `:p0 :p1 ...` named params (SQLAlchemy)
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`

`IS_POSTGRES` flag controls dialect. Both databases use identical app code.

---

## 3. TEAM

| Name | Stream | Avatar Color | GitHub Login | Anthropic Key ID |
|---|---|---|---|---|
| Andrey Brunetkin | dev | #00cfff | KlimMalgin | apikey_01BeAnze5XbzY1z8q1KXuzpk |
| Andrey Pogrebnyak | dev | #7b61ff | DroonPog | apikey_01VE6ZZxPrzyiv7b5Hs3vfVH |
| Evgeniy Vinogradov | docs | #00ff9d | **UNKNOWN** | apikey_01We2K4wbvnJhd2hThv2PRkN |
| Aleksandr Malyshev | dev | #ff6b35 | maico15 | not mapped (admin/owner) |

**Rules:**
- Do NOT change these names — they are seeded from `seed_data()` and hardcoded in `_ensure_github_username_map()`
- `seed_data()` only runs when `team_members` is empty (safe across restarts)
- Stream values are stored as JSON arrays, e.g. `'["dev"]'`

---

## 4. DATABASE SCHEMA

All tables created in `init_db()` via `CREATE TABLE IF NOT EXISTS`.

### `team_members`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT NOT NULL | |
| stream | TEXT NOT NULL | JSON array: `'["dev"]'` or `'["docs"]'` |
| avatar_color | TEXT DEFAULT '#00cfff' | Hex color |
| position | TEXT DEFAULT '' | Job title (added via migration) |

### `dev_metrics`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| member_id | INTEGER FK team_members | CASCADE DELETE |
| week | INTEGER | ISO week number |
| year | INTEGER DEFAULT 2025 | |
| prs_merged | INTEGER DEFAULT 0 | From GitHub sync |
| tickets_closed | INTEGER DEFAULT 0 | From Jira sync |
| cycle_time_days | REAL DEFAULT 0.0 | From Jira sync |
| features_completed | INTEGER DEFAULT 0 | Manual |
| deploys | INTEGER DEFAULT 0 | Manual |
| blocked_count | INTEGER DEFAULT 0 | From Jira (labeled "blocked") |
| commits_count | INTEGER DEFAULT 0 | From GitHub sync |
| avg_pr_size | INTEGER DEFAULT NULL | Avg lines changed per PR |
| ai_tokens | INTEGER DEFAULT NULL | AI tokens for week |
| UNIQUE | (member_id, week, year) | |

### `support_metrics`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| member_id | INTEGER FK | |
| week | INTEGER | |
| year | INTEGER DEFAULT 2025 | |
| incidents_opened | INTEGER DEFAULT 0 | |
| incidents_resolved | INTEGER DEFAULT 0 | |
| avg_resolution_hours | REAL DEFAULT 0.0 | |
| sla_breached | INTEGER DEFAULT 0 | |
| total_incidents | INTEGER DEFAULT 0 | |
| UNIQUE | (member_id, week, year) | |

### `docs_metrics`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| member_id | INTEGER FK | |
| week | INTEGER | |
| year | INTEGER DEFAULT 2025 | |
| docs_created | INTEGER DEFAULT 0 | |
| docs_updated | INTEGER DEFAULT 0 | |
| projects_covered | INTEGER DEFAULT 0 | |
| projects_total | INTEGER DEFAULT 10 | |
| UNIQUE | (member_id, week, year) | |

### `score_rules`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| stream | TEXT | dev / support / docs |
| rule_key | TEXT | e.g. pr_merged, doc_created |
| label | TEXT | Display name |
| points | INTEGER | Can be negative |
| condition | TEXT DEFAULT NULL | JSON condition object |

### `config`
| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | |
| value | TEXT DEFAULT '' | |

### `ai_usage_cache`
| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | Always `'main'` |
| data | TEXT | JSON blob of AI usage response |
| cached_at | REAL | Unix timestamp; TTL = 3600s |

### `weekly_tasks`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| engineer_id | INTEGER FK | |
| week_number | INTEGER | |
| year | INTEGER | |
| what_was_done | TEXT DEFAULT '[]' | JSON array |
| next_week | TEXT DEFAULT '[]' | JSON array |
| stream | TEXT DEFAULT 'dev' | |
| tasks | TEXT DEFAULT '' | Rich-text HTML (TipTap) |
| created_at | TEXT | |
| updated_at | TEXT | |
| UNIQUE | (engineer_id, week_number, year) | |

### `sync_log`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| service | TEXT | github / jira / slack_reports / ai_usage |
| timestamp | TEXT | ISO datetime |
| status | TEXT | success / error |
| records_updated | INTEGER DEFAULT 0 | |
| error | TEXT DEFAULT NULL | |
| message | TEXT DEFAULT NULL | |

### `api_key_mapping`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| engineer_id | INTEGER FK | |
| anthropic_key_id | TEXT UNIQUE NOT NULL | |
| key_name | TEXT DEFAULT '' | |
| created_at | TEXT | |

### `ai_usage`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| engineer_id | INTEGER FK | |
| date | TEXT | YYYY-MM-DD |
| week_number | INTEGER | |
| year | INTEGER | |
| input_tokens | INTEGER DEFAULT 0 | |
| output_tokens | INTEGER DEFAULT 0 | |
| total_tokens | INTEGER DEFAULT 0 | |
| cost_usd | REAL DEFAULT 0 | |
| created_at | TEXT | |
| UNIQUE | (engineer_id, date) | |

### `daily_reports`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| engineer_id | INTEGER FK | |
| report_date | TEXT | YYYY-MM-DD |
| raw_text | TEXT DEFAULT '' | Original Slack message text |
| completed | TEXT DEFAULT '[]' | JSON array of strings |
| invisible_work | TEXT DEFAULT '[]' | JSON array |
| next_tasks | TEXT DEFAULT '[]' | JSON array |
| delayed_risks | TEXT DEFAULT '[]' | JSON array |
| source | TEXT DEFAULT 'manual' | manual / slack |
| created_at | TEXT | |
| UNIQUE | (engineer_id, report_date) | |

### `commit_log`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| member_id | INTEGER FK | |
| week | INTEGER | |
| year | INTEGER | |
| repo | TEXT | owner/repo format |
| sha | TEXT | Full SHA |
| message | TEXT DEFAULT '' | |
| committed_at | TEXT | ISO datetime |
| UNIQUE | (repo, sha) | |

### `pr_log`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| member_id | INTEGER FK | |
| week | INTEGER | |
| year | INTEGER | |
| repo | TEXT | |
| pr_number | INTEGER | |
| title | TEXT DEFAULT '' | |
| body | TEXT DEFAULT '' | |
| additions | INTEGER DEFAULT 0 | |
| deletions | INTEGER DEFAULT 0 | |
| changed_files | INTEGER DEFAULT 0 | |
| merged_at | TEXT | ISO datetime |
| commits | TEXT DEFAULT '[]' | JSON array: [{sha, message}] |
| UNIQUE | (repo, pr_number) | |

### `ai_events`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| event_id | TEXT UNIQUE NOT NULL | Dedup key from Claude Code hook |
| engineer_id | INTEGER NOT NULL | |
| session_id | TEXT NOT NULL | |
| timestamp | TEXT NOT NULL | ISO datetime from event |
| model | TEXT DEFAULT 'unknown' | |
| tokens_input | INTEGER DEFAULT 0 | |
| tokens_output | INTEGER DEFAULT 0 | |
| tokens_cache_read | INTEGER DEFAULT 0 | |
| tokens_cache_write | INTEGER DEFAULT 0 | |
| repo | TEXT | Repository the session was in |
| created_at | TEXT | Server receive time |

### `ai_usage_daily`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| engineer_id | INTEGER NOT NULL | |
| date | TEXT NOT NULL | YYYY-MM-DD |
| tokens_input | INTEGER DEFAULT 0 | Aggregated from ai_events |
| tokens_output | INTEGER DEFAULT 0 | |
| sessions_count | INTEGER DEFAULT 0 | COUNT(DISTINCT session_id) |
| UNIQUE | (engineer_id, date) | |

---

## 5. ALL FEATURES IMPLEMENTED

### Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | 4 tabs: Development, Support, Documentation, AI Usage |
| Admin | `/admin` | 8 sections (requires password) |
| Engineer Profile | `/engineer/:id` | Profile, 8-week XP chart, task log |
| Reports | `/reports` | Daily reports view by date |

### Dashboard Tabs

- **Development** — team XP chart (8 weeks), totals (PRs, commits, cycle time, avg PR size), per-engineer bottleneck bars
- **Support** — incidents resolved/breached chart, SLA % metric, per-engineer breakdown
- **Documentation** — docs created/updated chart, coverage %, per-engineer breakdown
- **AI Usage** — daily token bar chart, per-engineer token bars, weekly team chart, leverage scores; week navigator; Sync Now button (admin only)

Also contains a **Weekly Report tab** (WeeklyReportTab.jsx) showing per-engineer PRs, commits, tasks, and line diffs.

### Admin Sections

1. **Configuration** — team name, week/year override, GitHub token/org/repos, Jira token, Anthropic Admin key, AI auto-sync toggle
2. **Team** — add/edit/delete engineers, stream assignment, avatar color; inline weekly task editor (TipTap rich-text)
3. **Metrics** — manual metric entry per engineer per stream per week; auto-fill from GitHub/AI data
4. **Rules** — edit XP point values per rule
5. **Integrations** — Jira (domain, email, token, project keys, username map + sync button + collapsible log), Slack (bot token, channel ID + sync button + log), GitHub (sync button + log + commits-debug link), Repo Display Names config
6. **AI Keys** — map engineer → Anthropic API key ID; test connection button
7. **Reports** — view/edit/delete daily reports by date; manual add with structured fields
8. **Security** — change admin password

### Components

- **Leaderboard** — clickable rows navigate to `/engineer/:id`; shows badges (MVP, fire, shield, scribe)
- **XPChart** — Recharts stacked bar chart, 8-week window
- **MetricCard** — reusable stat display with label, value, sub-label
- **BottleneckBars** — horizontal bars comparing engineers on a single metric
- **EngineerWeeklyBlock** — per-engineer section in WeeklyReportTab (PRs, commits grouped by repo/day, task text)
- **RichTextEditor** — TipTap editor with bold/italic/underline/link/placeholder

---

## 6. ALL API ENDPOINTS

### Public (no auth)

| Method | Path | Description |
|---|---|---|
| GET | `/api/overview` | Team name, current week/year |
| GET | `/api/leaderboard` | 8-week XP totals + badges for all engineers |
| GET | `/api/metrics/dev` | Dev tab data: totals, weekly chart, bottlenecks |
| GET | `/api/metrics/support` | Support tab data |
| GET | `/api/metrics/docs` | Docs tab data |
| GET | `/api/score-rules` | All scoring rules |
| GET | `/api/team` | All team members |
| GET | `/api/engineers/{id}/profile` | Engineer profile + 8-week XP |
| GET | `/api/engineers/{id}/tasks` | Engineer weekly tasks (week/year params) |
| GET | `/api/engineers/{id}/commits` | Last 8 weeks of commits |
| GET | `/api/engineers/{id}/prs` | Last 8 weeks of merged PRs |
| GET | `/api/config` | Full config key-value store |
| GET | `/api/config/repos/display_names` | Repo display name overrides |
| GET | `/api/ai-usage` | AI usage data (DB → live API → mock fallback) |
| GET | `/api/ai-usage/history` | Weekly AI usage history (n weeks) |
| GET | `/api/ai-usage/weekly` | Per-engineer weekly AI token breakdown (from ai_events) |
| GET | `/api/ai-usage/engineer/{id}` | Per-engineer weekly detail: daily, sessions, top repos |
| GET | `/api/reports` | Daily reports by date (all engineers) |
| GET | `/api/reports/weekly` | Weekly engineering report (PRs, commits, tasks per engineer) |
| GET | `/api/reports/engineer/{id}` | Daily reports for one engineer (date range) |
| GET | `/api/weekly-tasks` | All engineers' task text for a week |
| GET | `/api/sync/github/debug` | Config + live API test + last 5 sync log entries (no auth) |
| GET | `/api/sync/github/commits-debug` | Debug commit attribution for a repo (no auth) |

### Admin (password required via `?password=` query param)

| Method | Path | Description |
|---|---|---|
| PUT | `/api/config` | Update config keys |
| PUT | `/api/config/repos/display_names` | Update repo display name map |
| POST | `/api/team` | Create team member |
| PUT | `/api/team/{id}` | Update team member |
| PATCH | `/api/engineers/{id}` | Alias for PUT /api/team/{id} |
| DELETE | `/api/team/{id}` | Delete team member (cascades metrics) |
| POST | `/api/engineers/{id}/tasks` | Upsert weekly tasks |
| DELETE | `/api/engineers/{id}/tasks/{task_id}` | Delete task entry |
| PUT | `/api/score-rules/{id}` | Update score rule label/points |
| GET | `/api/admin/metrics/{stream}/{week}` | Get metrics for manual entry form |
| GET | `/api/admin/metrics/dev/{week}/auto` | Auto-calculated dev metrics from real data |
| PUT | `/api/admin/metrics/{stream}/{week}/{member_id}` | Save manual metric entry |
| DELETE | `/api/metrics/mock` | Wipe historical metrics (keeps current week by default) |
| POST | `/api/ai-usage/sync` | Trigger immediate AI usage sync from Anthropic Admin API |
| GET | `/api/ai-usage/test` | Test Anthropic Admin API key |
| GET | `/api/sync/ai-usage/status` | Last AI usage sync status |
| GET | `/api/ai-key-mappings` | Get engineer → API key ID mappings |
| PUT | `/api/ai-key-mappings` | Save full set of key mappings (replaces all) |
| POST | `/api/sync/jira` | Trigger Jira sync |
| GET | `/api/sync/jira/status` | Last Jira sync status |
| GET | `/api/sync/jira/log` | Last 10 Jira sync log entries |
| POST | `/api/sync/github` | Trigger GitHub PR/commit sync (current week) |
| POST | `/api/sync/github/backfill` | Back-fill N weeks of GitHub history (idempotent) |
| GET | `/api/sync/github/status` | Last GitHub sync status |
| GET | `/api/sync/github/log` | Last 10 GitHub sync log entries |
| POST | `/api/sync/slack-reports` | Trigger Slack daily report sync |
| GET | `/api/sync/slack-reports/status` | Last Slack sync status |
| GET | `/api/sync/slack-reports/log` | Last 10 Slack sync log entries |
| POST | `/api/sync/slack-reports/test` | Test Slack bot token |
| POST | `/api/admin/verify` | Validate admin password |
| POST | `/api/admin/change-password` | Change admin password |
| POST | `/api/admin/reset-seed` | Wipe team + rules, re-run seed_data() |
| POST | `/api/reports/manual` | Create/update daily report manually |
| POST | `/api/reports/bulk` | Bulk create daily reports (fuzzy name match) |
| PUT | `/api/reports/{id}` | Update report fields |
| DELETE | `/api/reports/{id}` | Delete report |
| POST | `/api/weekly-tasks` | Save engineer weekly task text (rich-text HTML) |
| GET | `/api/telemetry/debug` | Debug AI event/daily attribution (admin auth) |
| POST | `/api/telemetry/fix-attribution` | Re-attribute ai_events from one engineer_id to another |
| POST | `/api/telemetry/reprocess` | Rebuild ai_usage_daily for one engineer from ai_events |

### Telemetry (separate auth: TELEMETRY_SECRET)

| Method | Path | Description |
|---|---|---|
| POST | `/api/telemetry/events` | Ingest Claude Code token events; auth via `secret` in body |

---

## 7. INTEGRATIONS

### GitHub
- **Status:** Active — syncs every 15 min + on every backend startup
- **Config keys:** `github_token`, `github_org` (default: homealliance), `github_repos`, `github_username_map`
- **Repos synced:**
  ```
  apollo, callcenter-admin, crm-apollo, techapp, callcenter-server, callcenter-flex
  → resolved as homealliance/<name>
  
  maico15/dashbord
  → used as-is (cross-org format)
  ```
- **Username map (hardcoded defaults, merged on every boot):**
  ```json
  {
    "DroonPog":   "Andrey Pogrebnyak",
    "KlimMalgin": "Andrey Brunetkin",
    "maico15":    "Aleksandr Malyshev"
  }
  ```
- **Attribution logic:** author.login → committer.login → git author name → git committer name → Co-authored-by trailers (bot-authored commits resolved via committer)
- **What it writes:** `prs_merged` and `commits_count` to `dev_metrics`; raw records to `pr_log` and `commit_log`
- **Backfill:** `POST /api/sync/github/backfill?weeks=8` — idempotent, populates historical data

### Slack
- **Status:** Active — syncs daily at 20:00 UTC
- **Channel ID:** `C08NK2SD5CK`
- **Config keys:** `slack_bot_token`, `slack_reports_channel_id`
- **Parser:** Looks for messages containing "Daily Report" matching format `Daily Report — Name | Date`; parses sections: Completed, Invisible work, Next, Delayed/Risks
- **What it writes:** `daily_reports` table

### Jira
- **Status:** NOT CONFIGURED — no credentials
- **Config keys:** `jira_domain`, `jira_email`, `jira_api_token`, `jira_project_keys`, `jira_username_map`
- **Schedule:** Daily at 02:00 UTC (will error silently if not configured)
- **What it would write:** `tickets_closed`, `cycle_time_days`, `blocked_count` to `dev_metrics`; in-progress tickets to `weekly_tasks`

### Anthropic Admin API
- **Status:** Configured (key stored in config table); endpoint corrected to `/v1/organizations/usage_report/messages`
- **Config keys:** `anthropic_admin_key`, `ai_auto_sync`
- **Schedule:** Daily at 02:30 UTC
- **Endpoint used:** `GET /v1/organizations/usage_report/messages?starting_at=...&ending_at=...&bucket_width=1d&group_by[]=api_key_id`
- **What it writes:** `ai_usage` table (engineer-date totals)
- **Fallback chain:** DB data (`ai_usage`) → live API → mock data

### Claude Code Telemetry (local)
- **Status:** Active — receives events via hooks
- **Auth:** `TELEMETRY_SECRET` env var (set in body as `secret` field)
- **Endpoint:** `POST /api/telemetry/events`
- **Flow:** Claude Code hook → collector script batches events → POST to backend → `ai_events` table → `ai_usage_daily` aggregate
- **Per-engineer key:** `engineer_id` integer passed in payload (must match `team_members.id`)
- **Dedup:** `event_id` is unique key (idempotent ingestion)
- **Debug/repair:**
  - `GET /api/telemetry/debug?password=...` — shows events and daily rows per engineer
  - `POST /api/telemetry/fix-attribution?from_id=X&to_id=Y` — re-attribute misrouted events
  - `POST /api/telemetry/reprocess?engineer_id=X` — rebuild `ai_usage_daily` from raw `ai_events`

---

## 8. ENVIRONMENT VARIABLES

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Full SQLAlchemy URL; takes priority over `DB_PATH` |
| `DB_PATH` | `./dashboard.db` | SQLite file path; on Render set to `/var/data/dashboard.db` |
| `ADMIN_PASSWORD` | `admin123` | Initial admin password (overridden by config table value) |
| `ANTHROPIC_ADMIN_KEY` | — | Anthropic Admin API key for AI usage sync |
| `GITHUB_TOKEN` | — | GitHub personal access token (org access required) |
| `SLACK_BOT_TOKEN` | — | Slack bot OAuth token |
| `TELEMETRY_SECRET` | `""` | Secret for Claude Code telemetry endpoint auth |
| `VITE_API_URL` | `""` | Frontend: backend URL in production (e.g. https://dashbord-5u0i.onrender.com) |

**Note:** If `VITE_API_URL` is not set or doesn't start with `http`, the frontend falls back to same-origin `/api` (works with Vite proxy in dev).

---

## 9. KNOWN ISSUES & TODO

### Active Issues

1. **Evgeniy Vinogradov GitHub username unknown** — not in `github_username_map`, so his commits/PRs are never attributed. Need to find his GitHub login and add it to the map via Admin → Integrations → GitHub.

2. **Jira not configured** — `jira_domain`, `jira_email`, `jira_api_token`, `jira_project_keys` all empty. Daily Jira sync always errors but errors are silent (caught, logged to `sync_log`).

3. **Aleksandr Malyshev not mapped to an Anthropic key** — his AI usage is only tracked via the local telemetry pipeline (`ai_events`), not the Anthropic Admin API sync. `api_key_mapping` has no entry for him.

4. **Google SSO not implemented** — admin auth is simple password via query param. No OAuth/SSO.

5. **`ai_usage_daily` stale date bug** — early telemetry events may have been stored with today's date (collector used `datetime.now()` fallback instead of event timestamp). Fixed by running `POST /api/telemetry/reprocess?engineer_id=X&password=...` for affected engineers.

6. **Anthropic API cost calculation** — currently uses flat `$0.003 per 1K tokens` regardless of model. Not accurate for different models (Claude 3.5 Sonnet vs Opus vs Haiku have different pricing). Good enough for relative comparison.

### Recently Fixed

- **GitHub sync pagination** — was stopping at first page (100 PRs). Fixed: now paginates until `len(page_data) < 100`. Deployed, needs verification on next week's data.
- **Fake metric data (weeks 14-21 2026)** — removed via one-time migration flag `_fake_dev_weeks_removed_v1`. Real data starts from week 22+.
- **Stream assignments** — all engineers were incorrectly seeded with `["dev","support","docs"]`. Fixed via one-time migration `_streams_fixed_v1`: Brunetkin=dev, Pogrebnyak=dev, Vinogradov=docs, Malyshev=dev.
- **AI usage weekly showing 0 tokens** — `api/ai-usage/weekly` was querying `ai_usage_daily` which had wrong dates. Fixed: now queries `ai_events` directly using ISO week timestamp bounds.
- **Anthropic API 404** — old endpoint `/v1/organizations/usage` doesn't exist. Fixed to use `/v1/organizations/usage_report/messages`.
- **Telemetry reprocess endpoint** — added `POST /api/telemetry/reprocess` to rebuild `ai_usage_daily` from `ai_events` timestamps (source of truth).

### TODO / Future

- Add Evgeniy Vinogradov's GitHub login to username map
- Configure Jira credentials if/when needed
- Add per-model cost breakdown in AI usage tab
- Implement position field display on profile pages (column exists in DB, not shown in UI)
- Consider rate-limit handling for GitHub API (403 responses during heavy sync)

---

## 10. DEPLOYMENT

### Render.com Services

**Backend service:**
- Name: `dashbord` (backend)
- URL: https://dashbord-5u0i.onrender.com
- Runtime: Python 3
- Start command: `cd backend && python -m uvicorn main:app --host 0.0.0.0 --port $PORT`
- Deploy: auto-deploy on push to `main` branch of https://github.com/maico15/dashbord
- Persistent disk mounted at `/var/data`; `DB_PATH=/var/data/dashboard.db`

**Frontend service:**
- Name: `dashbord-frontend`
- URL: https://dashbord-frontend-hb0m.onrender.com
- Runtime: Static site (Render serves the built `dist/`)
- Build command: `cd frontend && npm install && node node_modules/vite/bin/vite.js build`
- Publish dir: `frontend/dist`
- Deploy: auto-deploy on push to `main`
- Required env var: `VITE_API_URL=https://dashbord-5u0i.onrender.com`
- SPA routing: `frontend/public/_redirects` → `/* /index.html 200`

### PR Workflow

All changes must go through pull requests on the `main` branch (per CLAUDE.md).

### Data Persistence

- SQLite file at `/var/data/dashboard.db` on the Render persistent disk
- On Render free plan, the filesystem resets on each deploy — **only the mounted disk survives**
- `seed_data()` is idempotent (only runs if `team_members` is empty)
- All `init_db()` migrations use `IF NOT EXISTS` or config flags (`_metrics_cleaned_v1`, `_streams_fixed_v1`, `_fake_dev_weeks_removed_v1`)

---

## 11. SCORING SYSTEM

### Score Rules (defaults from `seed_data()`)

| Stream | Rule Key | Label | Points | Condition |
|---|---|---|---|---|
| dev | pr_merged | PR merged | 100 | — |
| dev | commit | Commit | 10 | — |
| dev | ticket_closed | Ticket closed | 0 | — |
| dev | fast_cycle | Cycle time bonus | 0 | cycle_time_days < 2 |
| support | incident_resolved | Incident resolved | 80 | — |
| support | fast_resolve | Resolved < 2h (bonus) | 50 | avg_resolution_hours < 2 |
| support | sla_breached | SLA breached | -40 | — |
| docs | doc_created | Doc created | 30 | — |
| docs | doc_updated | Doc updated | 15 | — |
| docs | no_docs_penalty | Project without docs > 2w | -20 | per uncovered project |

**Note:** `ticket_closed` and `fast_cycle` are 0 pts because Jira is not configured. Only `pr_merged` and `commit` actually generate XP from real sync data.

### Score Calculation

- **Dev XP** = `prs_merged × 100` + `commits_count × 10`
- **Support XP** = `incidents_resolved × 80` + (fast_resolve bonus if avg < 2h) + `sla_breached × -40`
- **Docs XP** = `docs_created × 30` + `docs_updated × 15` + `(projects_total - projects_covered) × -20`

The leaderboard and profile pages show **8-week rolling totals** (current week + 7 previous weeks).

### Badges

| Badge | Key | Criteria |
|---|---|---|
| MVP | `mvp` | Highest 8-week total XP on the team |
| Streak | `fire` | Last 3 weekly scores all > 0 and each ≥ previous |
| Shield | `shield` | Support stream; zero SLA breaches in last 4 weeks |
| Scribe | `scribe` | Docs stream; 3+ docs created in current week |

Multiple badges can stack. MVP is assigned after sorting the leaderboard (first place gets it automatically even if score is 0).

---

## 12. STARTUP SEQUENCE

On backend startup (`lifespan()` function):

1. `init_db()` — creates all tables (idempotent), runs schema migrations, runs one-time data cleanup migrations
2. If `team_members` is empty → `seed_data()` — inserts engineers, score rules, default config, Anthropic key mappings
3. `_load_password()` — overrides `ADMIN_PASSWORD` global from config table
4. `_ensure_github_username_map()` — merges required logins into saved config (saved values win over defaults)
5. Scheduler starts:
   - Jira sync: daily 02:00 UTC
   - Slack reports sync: daily 20:00 UTC
   - AI usage sync: daily 02:30 UTC
   - GitHub sync: every 15 minutes
6. `_run_github_sync()` — immediate GitHub sync on startup

---

## 13. KEY HELPERS & PATTERNS

### `parse_streams(val)`
Parses `team_members.stream` — handles both legacy plain string `"dev"` and JSON array `'["dev","support"]'`.

### `current_week_year(conn)`
Reads `current_week` and `current_year` from config table. Admin can override these manually to "replay" a week.

### `calc_dev(m, rules)` / `calc_support()` / `calc_docs()`
Pure functions: take a metrics row dict + rules list, return `(total_score, breakdown_dict)`.

### `_anthropic_get(path, admin_key, usage_beta=False)`
HTTP GET to `https://api.anthropic.com` with proper headers. `usage_beta=True` adds `anthropic-beta: usage-2025-01` header (used for old endpoint — not needed on current endpoint).

### AI usage data priority
`_get_or_fetch_ai_usage()` priority: DB (`ai_usage` table, populated by Admin API sync) → live Anthropic Admin API → mock. Cache TTL: 1 hour.

`/api/ai-usage/weekly` bypasses this cache and reads directly from `ai_events` (telemetry pipeline).

### `_do_github_backfill(conn, weeks=8)`
Idempotent back-fill: fetches PRs and commits for the last N ISO weeks across all repos, inserts into `pr_log`/`commit_log` (OR IGNORE), rebuilds `dev_metrics` from actual table counts.
