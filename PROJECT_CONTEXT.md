# Engineering Dashboard — Project Context

> Onboarding reference: what this system is, where each part lives, and the
> handful of conventions you cannot guess from the code. Verified against `main`
> on 2026-09-09.
>
> For depth, do not duplicate — read these instead:
> - [HANDOFF.md](HANDOFF.md) — ownership, history, roadmap, open threads
> - [docs/OPERATOR_PLAYBOOK.md](docs/OPERATOR_PLAYBOOK.md) — day-to-day operation, syncs, incident recovery
> - [CLAUDE.md](CLAUDE.md) — working agreements for Claude Code in this repo

---

## 1. What it is

Internal engineering-team tracker for Home Alliance. Engineers earn points from
weekly metrics pulled out of GitHub, Jira, Slack daily reports and Anthropic AI
token usage. Around that core sit a public leaderboard, per-engineer profiles, a
weekly/daily report view, a Team Gantt with a backlog, a roadmap, curated
monthly leadership reviews and an AI-usage pipeline fed by a local telemetry
collector.

| | |
|---|---|
| Frontend | https://dashbord-frontend-hb0m.onrender.com |
| Backend API | https://dashbord-5u0i.onrender.com (`/docs` for live OpenAPI) |
| Admin panel | `/admin` — default password `admin123` |
| Repo | https://github.com/maico15/dashbord (the misspelling is intentional) |

Deployment target is moving from Render to ECS (owned by Bachinskiy). Only the
application side is in scope here: `DATABASE_URL` is now mandatory.

---

## 2. Layout

```
backend/main.py            FastAPI app, 7,265 lines, 126 route decorators
backend/database.py        361-line SQLAlchemy Core shim (see §3)
frontend/src/App.jsx       routes
frontend/src/pages/        Dashboard, Admin, TeamGantt, TeamPlan, Roadmap, reviews, …
frontend/src/api/client.js every API call; VITE_API_URL in prod, Vite proxy in dev
cc_tray_app.py             Windows tray telemetry agent (see §8)
cc_telemetry.py            CLI collector — root copy
collector/                 CLI collector + install.sh — the distributed copy
scripts/                   migrations, migration verification, memdebug harnesses
docker-compose.yml         local postgres:16
```

Run locally:

```bash
docker compose up -d
export DATABASE_URL=postgresql://dashboard:dashboard@localhost:5432/dashboard
cd backend && python -m uvicorn main:app --port 8000 --reload
cd frontend && npm run dev            # port 3000
```

---

## 3. Database

**PostgreSQL is primary** — on Render today, ECS next. `DATABASE_URL` is
**required**: `backend/database.py` raises `RuntimeError` at import and the app
refuses to boot without it, deliberately, so a forgotten env var during the
cutover cannot silently redirect writes to a local file and split the data.
`postgres://` is rewritten to `postgresql://` for SQLAlchemy. SQLite is accepted
only for explicit local testing (`DATABASE_URL=sqlite:///./dashboard.db`), where
it runs on `StaticPool` with `check_same_thread=False`.

**The shim.** The app is written in sqlite3 idioms; `DBWrapper` / `Cursor`
translate them per statement:

- `?` placeholders → named `:p0 :p1 …` binds
- `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
- `INSERT OR REPLACE` → `ON CONFLICT (<key>) DO UPDATE`, with the key columns per
  table in `_CONFLICT_TARGETS`
- `lastrowid` → `RETURNING id`, appended only when the target table actually has
  an `id` column (`config`, `score_rules` and friends do not)
- `PRAGMA` dropped, `INTEGER PRIMARY KEY AUTOINCREMENT` rewritten, in
  `executescript`

**Savepoints.** `conn.savepoint()` opens a nested transaction for one statement
that is allowed to fail — a failure rolls back only the savepoint, leaving the
caller's transaction usable. Startup DDL and best-effort migrations use it.

**Pool and server-side deadlines** (Postgres only): `pool_size=10`,
`max_overflow=20`, `pool_timeout=30`, `pool_recycle=300`, `pool_pre_ping=True`.
Most endpoints take a connection from `get_db()` without `try/finally`, so an
error mid-request can leak it while its transaction is aborted — holding locks
and a pool slot forever. Three server-side timeouts make the database clean up
instead: `idle_in_transaction_session_timeout=60000`, `lock_timeout=15000`,
`statement_timeout=120000` (generous enough for the sync jobs and startup DDL).

**Tables created by `init_db()`** (34, all idempotent):

`agent_heartbeats`, `ai_events`, `ai_tool_sessions`, `ai_usage`,
`ai_usage_cache`, `ai_usage_daily`, `api_key_mapping`, `backlog_items`,
`backlog_retired`, `commit_log`, `config`, `daily_reports`, `departments`,
`dev_metrics`, `docs_metrics`, `gantt_assignments`, `gantt_visibility`,
`monthly_review_engineers`, `monthly_review_meta`, `monthly_review_summary`,
`monthly_review_tasks`, `performance_scores`, `pr_log`, `roadmap_epics`,
`roadmap_meta`, `roadmap_objectives`, `roadmap_tasks`, `score_rules`,
`support_metrics`, `sync_log`, `tasks`, `team_members`, `weekly_changes`,
`weekly_tasks`

Migrating an old on-disk `dashboard.db`: `scripts/migrate_sqlite_to_pg.py` (run
`--dry-run` first, always against a **copy**), then `scripts/verify_migration.py`
for smoke, write-path and concurrency checks.

---

## 4. Backend

`backend/main.py` is a single 7,265-line FastAPI module with **126** route
decorators: 52 GET, 40 POST, 13 PUT, 12 DELETE, 9 PATCH. `GET /docs` on the
running service is the authoritative endpoint list; the largest groups are
`/api/sync/*` (14), `/api/monthly-review/*` (13), `/api/roadmap/*` (12),
`/api/telemetry/*` (8), and `/api/reports`, `/api/gantt`, `/api/backlog`,
`/api/engineers`, `/api/ai-usage`, `/api/admin` at 7 each.

**Auth** is a shared password on a query param — `?password=` — checked against
the module global `ADMIN_PASSWORD` (literal `"admin123"`, overridden at startup
from the `config` table; it is *not* an env var). Reads are public; writes take
the password. Telemetry ingest authenticates separately (§8).

**Startup (`lifespan`)**, in order:

1. `init_db()` — create tables and run migrations
2. `seed_data()` — only when `team_members` is empty; inserts four engineers and
   the default score rules and config. No mock metrics are ever seeded.
3. `_load_password()` — override `ADMIN_PASSWORD` from `config`
4. `_ensure_github_username_map()` — merge required logins into the saved map
5. Scheduler: Jira 02:00, Slack reports 20:00, AI usage 02:30, GitHub every
   15 min, `_auto_advance_week` Mon 00:05 — then `_auto_advance_week` runs once
   immediately, so a cold start after a week boundary still catches up
6. GitHub sync on a background thread, off the startup path (it makes dozens of
   API calls and would hold a pool slot exactly as the first requests land)

---

## 5. Frontend

Routes, exactly as `frontend/src/App.jsx` has them:

| Path | Page |
|---|---|
| `/` | Dashboard |
| `/admin` | Admin |
| `/engineer/:id` | EngineerProfile |
| `/reports` | Reports |
| `/releases` | Releases |
| `/review/august-2026` | MonthlyReviewCurated — legacy path, falls back to August 2026 |
| `/review/june-2026` | MonthlyReview — the older static June page |
| `/review/:year/:month` | MonthlyReviewCurated |
| `/monthly-review` | MonthlyReviewLive — computed live from dashboard data |
| `/team-gantt` | TeamGantt |
| `/team-plan` | TeamPlan |
| `/tasks` | TaskBoard |
| `/roadmap` | Roadmap |
| `/north-star` | NorthStar |

**Dashboard tabs** (IT department; other departments see AI Usage only):

`⬡ AI Usage · Development · 📅 Daily Report · 📋 Weekly Report · 🗓️ Monthly Review · 📈 Trends · 📅 Gantt · Team Plan (in development)`

Monthly Review, Gantt and Team Plan are links to their own routes, not panels.
Monthly Review resolves the newest published month from
`GET /api/monthly-review/latest` and falls back to `/review/2026/8`; it
highlights while the route starts with `/review/`. Team Plan carries an
`in development` subtitle, rendered through the `Tab` component's `subtitle`
prop.

**Achievements is hidden** from the tab bar — it is still a placeholder panel.
The initial tab comes from `?tab=`, whitelisted by `PANEL_KEYS`, so hidden
panels stay addressable: `/?tab=achievements`, and likewise `?tab=support` and
`?tab=docs`, which have no nav entry either.

**Admin sections** (9): Configuration, Team, Departments, Metrics, Rules,
Integrations, AI Keys, Reports, Security.

---

## 6. Team Gantt

Editing is **queued, not live**. Every action in edit mode pushes a change
object onto `changeQueue`; `computeDraftState` replays that queue on top of the
last-fetched base data, so the rendered view is always base + pending edits (in
view mode the queue is empty and draft === base). Save posts the whole queue to
`POST /api/gantt/apply-changes`.

That endpoint validates every change's `type` **before touching the database**,
then applies the batch inside one transaction; any `ChangeError` rolls the whole
batch back and answers `{failed_index, error}` so the UI can point at the change
that failed. Creates may carry a `tempId`, and later changes referring to it are
resolved through an `id_map` returned as `idMap`. Change types:
`gantt_create` / `gantt_update` / `gantt_delete`, `backlog_create` /
`backlog_update` / `backlog_delete` / `backlog_reorder` / `backlog_assign`,
`engineer_visibility`.

`GANTT_FIELDS` is the write whitelist for an assignment — `project`,
`start_date`, `est_days`, `percent`, `status`, `queue_start`, `note`,
`depends_on`, `engineer_id`. Anything else in a payload is reported as unknown
rather than silently ignored. `GANTT_STATUSES` = `active` | `queued` |
`continuous` | `done`.

**Note convention.** An assignment `note` is one bilingual text field: English
first, then a line containing `____ ru`, then the Russian text, optionally
followed by `Source: <slack permalink>`. Nothing in the code splits on it — the
detail modal renders the note verbatim with newlines preserved (it only bolds
`ЦЕЛЬ:` / `ЧТО СДЕЛАТЬ:` / `ПРОФИТ:` prefixes). It is a content convention, so
keep writing it by hand in that shape.

---

## 7. Monthly Review

The curated leadership review is **database-backed**, not a bundled file, so a
figure can be corrected without a frontend deploy. Four tables keyed by
`(month, year)`: `monthly_review_meta` (bilingual title, assumptions note),
`monthly_review_summary` (headline cards), `monthly_review_engineers` (who
appears, in what order, and the role held *that* month) and
`monthly_review_tasks` (task / goal / benefit / value + `confidence`).

- Bilingual content lives in parallel `_en` / `_ru` columns; the page's
  `pick(row, field, lang)` reads the active half.
- `confidence` and summary `tone` share one CHECK-enforced scale:
  `confirmed` | `estimate` | `needs_data` | `none`.
- Reads are public, every write takes `?password=`. A month with no rows returns
  empty lists, not a 404, and the page shows a "not published" notice.
- A task whose engineer is not listed renders nowhere, so the GET reports
  `orphan_tasks` and the page warns instead of dropping it silently.
- `GET /api/monthly-review/latest` returns `{year, month}` for the newest month
  with at least one task; 404 when nothing is published.
- `MonthlyReviewCurated.jsx` derives every date in its chrome — period,
  presentation date, next review, score week — from the month in the route, so
  publishing a month needs only DB writes. The one non-derivable string is the
  "Previous review" pointer, in `PREVIOUS_REVIEW` on that page.
- Importing a static review: `scripts/migrate_review_to_db.py` (`--dry-run`
  first; it refuses to overwrite a month whose task count has drifted from the
  source file unless `--force`).

Editing is API-only — there is no Admin section for it yet.

---

## 8. Telemetry collector

Engineers' machines ship Claude Code token usage to the dashboard. Three copies
of the collector exist and **they have drifted** — check which one you are
looking at:

| File | What it is |
|---|---|
| `cc_tray_app.py` | Windows tray agent, v3.2 — token usage plus browser AI-tool time |
| `collector/cc_telemetry.py` | The distributed CLI collector (`collector/install.sh` installs it via crontab). Has `--reset` and the Windows console-encoding fix. |
| `cc_telemetry.py` (root) | Older CLI copy. Has the pooled HTTP session, incremental read offsets and the bounded retry buffer — but **no `--reset`**. |

State lives under `~/.claude/`: `telemetry_config.json` (endpoint, engineer_id,
secret), `.telemetry_seen` (dedup ids), `.telemetry_offsets.json` (per-file read
offsets), `telemetry_buffer.jsonl` (retry buffer), `.telemetry_drops.json`,
`telemetry_tray.log`. Ingest is `POST /api/telemetry/events`, authenticated by a
per-engineer secret or the legacy global `TELEMETRY_SECRET`; heartbeats go to
`POST /api/telemetry/heartbeat` and land in `agent_heartbeats` (deliberately not
in `ai_tool_sessions`, which feeds engineer scores).

**`--reset`** (`python collector/cc_telemetry.py --reset`) deletes
`.telemetry_seen` and `telemetry_buffer.jsonl`, then runs one normal cycle,
replaying every session file. `.telemetry_seen` is the collector's only record
of what it already shipped, so an event the server acknowledged but never stored
is otherwise unrecoverable. It is safe to repeat: `ai_events.event_id` is
unique, so replays come back counted as `duplicate`, and events post in batches
of 500 so a full replay cannot exceed the request timeout.

**The August 2026 data loss.** Inside `ON CONFLICT … DO UPDATE SET`, PostgreSQL
has both the target table and `excluded` in scope, so
`tokens_input = tokens_input + excluded.tokens_input` fails with
`column reference "tokens_input" is ambiguous`. The handler rolled the rows back
and still answered `200`, so from the Postgres cutover on 2026-08-07 until the
fix on 2026-09-03 (#89) **every** telemetry event — `ai_events` and
`ai_tool_sessions` alike — was silently dropped while collectors reported
success. The fix was to table-qualify the right-hand side
(`ai_usage_daily.tokens_input + excluded.tokens_input`, which the local
sqlite path also accepts) and to make the response report `{accepted, duplicate, daily_failed,
skipped}`, which the collector now checks: it re-buffers a batch unless
`accepted + duplicate + skipped == len(events)`, so a bare 200 is no longer
treated as proof of storage. Grep for `DO UPDATE SET` before adding any new
counter upsert.

---

## 9. Integrations

| Source | Schedule | Writes | Config keys |
|---|---|---|---|
| GitHub | every 15 min + startup | `prs_merged` → `dev_metrics`, `pr_log` | `github_token`, `github_org` (default `homealliance`), `github_repos`, `github_username_map` |
| Jira Cloud | daily 02:00 UTC | `tickets_closed` → `dev_metrics` | `jira_domain`, `jira_email`, `jira_api_token`, `jira_project_keys`, `jira_username_map` |
| Slack | daily 20:00 UTC | `daily_reports` | `slack_bot_token`, `slack_reports_channel_id` |
| Anthropic usage | daily 02:30 UTC | `ai_usage` via `api_key_mapping` | `anthropic_admin_key`, `ai_auto_sync` |

GitHub repo names: a bare name gets the org prefix (`apollo` →
`homealliance/apollo`), `owner/repo` is used as-is. Logins map to engineer names
through `github_username_map`, whose required defaults are merged on every boot.
Each sync also has a manual trigger under `POST /api/sync/*` and writes to
`sync_log`; `GET /api/sync/github/debug` returns config, a live API test and the
last five log entries.

---

## 10. Scoring

Three streams — `dev`, `support`, `docs`. `team_members.stream` holds a JSON
array, so an engineer can be in several; `parse_streams()` also accepts the
legacy plain string.

`GET /api/leaderboard` has two modes:

- `scoring=github` (default) — `calc_dev` / `calc_support` / `calc_docs` over
  the weekly metric tables, with point values from `score_rules` (editable in
  Admin → Rules)
- `scoring=multisource` — `_compute_multisource_scores(weeks_back=2)`, which
  blends the other sources including AI tool sessions

Badges, as the API emits them: `mvp` (top scorer), `fire` (labelled 🔥 Streak —
three consecutive non-zero, non-decreasing weeks), `shield` (support stream,
zero SLA breaches over four weeks), `scribe` (docs stream, 3+ docs this week).

---

## 11. Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Required.** App refuses to boot without it — see §3. |
| `ANTHROPIC_ADMIN_KEY` | Anthropic Admin API key for usage sync |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GITHUB_TOKEN` | GitHub PR sync |
| `SLACK_BOT_TOKEN` | Slack daily-report sync |
| `TELEMETRY_SECRET` | Legacy global telemetry secret (per-engineer secrets preferred) |
| `VITE_API_URL` | Frontend only — must point at the backend on Render |

The admin password is not an env var: it is the `ADMIN_PASSWORD` module constant
overridden from the `config` table at startup, changed via Admin → Security.

---

## 12. Deployment

Two Render services, both from `main`: the frontend
(`dashbord-frontend-hb0m`) and the backend (`dashbord-5u0i`). Build scripts call
`node node_modules/vite/bin/vite.js` rather than `npx vite`, which trips over
Render's symlink permissions. `frontend/public/_redirects` carries
`/*  /index.html  200` for SPA routing. Auto-deploy has been reliable on the
frontend; the backend has needed a manual deploy at least once, so check that
`/docs` lists a route you just added before assuming it shipped.

Data lives in Postgres, so filesystem persistence at the deploy target is not a
database concern. `seed_data()` only fires on an empty `team_members`, making
restarts safe. `DELETE /api/metrics/mock?password=…` clears metric rows from
weeks before the current one.

**All changes go through pull requests.**
