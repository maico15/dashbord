# Full System Audit Report
## Engineering Dashboard — QA / Full-Stack Review
**Date:** 2026-05-28  
**Auditor role:** Staff QA Engineer + Senior Full-Stack Auditor  
**Scope:** Frontend (React 18 + Vite) · Backend (FastAPI + SQLite) · Integration · Data integrity

---

## Executive Summary

The core GitHub data pipeline (`commit_log`, `pr_log`) is solid and the scoring formula after the recent fake-data cleanup is correct. However, the week arithmetic has systemic errors that corrupt almost every aggregation, and two critical components (AI Usage tab, Weekly Report tab) silently initialize to the wrong week on every page load. Three of five major modules have correctness bugs that make their KPIs unreliable in production.

**Overall quality score: 4 / 10**

---

## Bugs Found

---

### BUG-01 — Wrong API field names in AI Usage and Weekly Report tabs

| Field | Value |
|-------|-------|
| **Severity** | 🔴 Critical |
| **Type** | Integration Bug / Wrong API Field |
| **Where** | `AIUsageTab.jsx:160-161`, `WeeklyReportTab.jsx:218-219` |

**Description**  
Both components call `/overview` and read `d.week` / `d.year`. The overview API returns `current_week` and `current_year`, not `week` / `year`. So `d.week` and `d.year` are always `undefined`.

```js
// Current (broken)
setWeek(d.week || calcCurrentWeek())   // d.week === undefined ALWAYS
setYear(d.year || new Date().getFullYear())  // d.year === undefined ALWAYS

// Fixed
setWeek(d.current_week || calcCurrentWeek())
setYear(d.current_year || new Date().getFullYear())
```

**Why it's wrong:** `undefined || calcCurrentWeek()` always evaluates the right side. The admin-configured current week is never used. Both tabs always derive week from the non-ISO frontend formula.

**How to reproduce:** Open AI Usage or Weekly Report tab → DevTools Network → inspect `/overview` response → observe `{current_week: 22, current_year: 2026}` with no `week` or `year` keys.

**Expected:** Both tabs initialize to the admin-configured current week.  
**Actual:** Both tabs always use `calcCurrentWeek()` (non-ISO fallback), ignoring admin config.

**Fix:** Two one-line changes:
```js
// AIUsageTab.jsx:160-161
setWeek(d.current_week || calcCurrentWeek())
setYear(d.current_year || new Date().getFullYear())

// WeeklyReportTab.jsx:218-219 — same change
```

---

### BUG-02 — `calcCurrentWeek()` uses non-ISO week formula

| Field | Value |
|-------|-------|
| **Severity** | 🔴 Critical |
| **Type** | Formula Bug — Week Calculation Mismatch |
| **Where** | `Dashboard.jsx:21-23` (also copied into `AIUsageTab.jsx`, `WeeklyReportTab.jsx`) |

**Description**  
`calcCurrentWeek()` uses a simple calendar-week formula. The backend uses Python's `datetime.isocalendar()` (ISO 8601 strict). They can disagree at year boundaries and whenever Jan 1 falls mid-week.

```js
// Frontend — non-ISO (WRONG)
Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)

// Backend — ISO 8601 (correct)
datetime.now().isocalendar()
```

**Why it's wrong:** Dec 31, 2025 is ISO week 1 of 2026. The frontend formula returns week 53 of 2025. Queries return empty results.

**Expected:** Frontend and backend agree on week number at all times.  
**Actual:** Can be off by ±1 at year boundaries (~2 weeks per year with discrepancy).

**Fix:**
```js
function calcCurrentISOWeek() {
  const d = new Date()
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const dow = jan4.getDay() || 7
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - (dow - 1))
  const delta = Math.floor((d - week1Mon) / 86400000)
  return delta < 0 ? 52 : Math.floor(delta / 7) + 1
}
```

---

### BUG-03 — `_weeks_range()` never adjusts year on cross-year wrap

| Field | Value |
|-------|-------|
| **Severity** | 🔴 Critical |
| **Type** | Backend Bug — Cross-Year Data Loss |
| **Where** | `main.py:_weeks_range()` · used by `metrics_dev`, `leaderboard`, `get_engineer_commits`, `get_engineer_prs`, `admin_dev_metrics_auto` |

**Description**  

```python
def _weeks_range(week):
    for wo in range(8):
        w = week - 7 + wo
        if w <= 0:
            w += 52   # week number fixed, but YEAR is NOT
        weeks.append(w)
```

Every caller then queries `WHERE week=? AND year=?` using a single `year` value for all 8 weeks. Weeks that cross a year boundary use the wrong year.

**Example:** Current week = 3 (January 2026). `_weeks_range(3)` returns `[48, 49, 50, 51, 52, 1, 2, 3]`. All 8 are queried with `year=2026`. Weeks 48–52 belong to 2025 — no rows found → XP chart shows empty bars.

**Expected:** Each (week, year) pair in the range uses the correct year.  
**Actual:** 4–6 weeks return 0 data for any engineer active in late December of the previous year.

**Fix:** Return tuples from `_weeks_range` and update all callers:
```python
def _weeks_range(week, year):
    result = []
    for wo in range(8):
        w = week - 7 + wo
        y = year
        if w <= 0:
            w += 52
            y -= 1
        result.append((w, y))
    return result
```

---

### BUG-04 — `break_total` NameError in Shield badge logic

| Field | Value |
|-------|-------|
| **Severity** | 🔴 Critical |
| **Type** | Backend Bug — Latent Crash |
| **Where** | `main.py:leaderboard()` Shield badge section |

**Description**  

```python
if "support" in streams:
    breach_total = 0          # initialized as breach_total
    for wo in range(4):
        ...
        if row:
            break_total += row["sla_breached"]  # ← NameError: 'break_total' not defined
    if breach_total == 0:
        badges.append("shield")
```

Variable initialized as `breach_total` but incremented as `break_total`.

**Why it's a crash risk:** If any `support_metrics` row exists for an engineer in a "support" stream, this raises `NameError` and the entire `/api/leaderboard` endpoint returns 500 for all users. Currently masked because all `support_metrics` data was deleted by the cleanup migration, but will resurface with any future support data entry.

**Fix:** Change `break_total +=` to `breach_total +=` (one character).

---

### BUG-05 — `commit` key missing from Leaderboard breakdown labels

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Type** | UI Bug |
| **Where** | `Leaderboard.jsx:29-39` |

**Description**  
`calc_dev()` now returns `{"pr_merged": N, "commit": M}`. The `commit` key is not in the `labels` map, which also still contains dead keys (`ticket_closed`, `fast_cycle`) that `calc_dev` no longer emits.

```js
const labels = {
  pr_merged: 'PRs',
  ticket_closed: 'Tickets',  // dead — calc_dev no longer produces this
  fast_cycle: 'Fast',        // dead — calc_dev no longer produces this
  // 'commit' MISSING
}
// Fallback: labels[k] || k → shows raw key "commit"
```

**Expected:** Breakdown column shows "Commits: +520".  
**Actual:** Shows raw key: `commit: +520`.

**Fix:** Add `commit: 'Commits'` to labels; remove `ticket_closed` and `fast_cycle`.

---

### BUG-06 — Zero-activity engineers omitted from bar charts

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Type** | Data Consistency Bug |
| **Where** | `main.py:metrics_dev()` bottlenecks section, rendered by `BottleneckBars` |

**Description**

```python
for m in members:
    row = c.fetchone()
    if row:              # engineer SKIPPED if no dev_metrics row for this week
        bottlenecks.append({...})
```

Engineers with no `dev_metrics` row for the selected week are omitted entirely from `bottlenecks`. The "Commits per engineer" and "PRs per engineer" bar charts show fewer bars than there are engineers, with no indication that anyone is missing.

**How to reproduce:** Navigate to a week where one engineer has no GitHub activity → bar charts show 2 bars instead of 3.

**Expected:** All engineers shown, zeros displayed explicitly.  
**Actual:** Engineers with 0 activity silently disappear.

**Fix:**
```python
for m in members:
    row = c.fetchone()
    row = dict(row) if row else {}
    bottlenecks.append({
        "name": m["name"],
        "prs_merged":    row.get("prs_merged", 0),
        "commits_count": row.get("commits_count", 0),
        "cycle_time_days": row.get("cycle_time_days", 0),
        "deploys":       row.get("deploys", 0),
    })
```

---

### BUG-07 — Leaderboard fetched once, never refreshed

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Type** | Architecture Risk |
| **Where** | `Dashboard.jsx:177-184` |

**Description**

```jsx
useEffect(() => {
  Promise.all([api.get('/overview'), api.get('/leaderboard')])
    .then(([ov, lb]) => { setLeaderboard(lb) })
}, [])  // ← only runs on mount
```

GitHub sync runs every 15 minutes and updates `dev_metrics`. If user leaves the tab open, runs a backfill, and returns — the leaderboard still shows pre-sync scores until full page reload. No refresh mechanism exists.

**Fix:** Poll every 5 minutes, or expose a refresh event from sync operations.

---

### BUG-08 — Config-based week has no staleness protection

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Type** | Architecture Risk |
| **Where** | `main.py:current_week_year()`, TopBar, all aggregation endpoints |

**Description**  
The "current week" is admin-controlled via the config table. The entire system — leaderboard 8-week window, stat card totals, backfill range — depends on this value. If the admin forgets to update it, all aggregations silently cover the wrong period with no visible warning.

**Fix:** Show a staleness warning in TopBar and Admin config when `config.current_week` differs from the actual ISO week by more than 1.

---

### BUG-09 — Silent infinite spinner on API error

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Type** | UI Bug |
| **Where** | `Dashboard.jsx:56` (DevTab), `AIUsageTab.jsx:173-174`, `WeeklyReportTab.jsx:231-232` |

**Description**

```jsx
api.get(`/metrics/dev?...`).then(setData).catch(console.error)
// On error: data stays null → <LoadingSpinner /> renders forever
```

On network error or 5xx response, `data` stays `null` and the loading spinner shows indefinitely. No error UI, no retry button.

**Fix:** Track error state and show an error card with a retry button.

---

### BUG-10 — pr_log and dev_metrics use different week number sources

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Type** | Data Consistency — Dual Week Systems |
| **Where** | `main.py:_do_github_sync()` vs `_do_github_backfill()` |

**Description**  
Two incompatible week sources for the same concept exist in the same DB:

| Table | Week source |
|-------|-------------|
| `pr_log.week` | `merged_date.isocalendar()` — ISO week |
| `commit_log.week` | `committed_at.isocalendar()` — ISO week |
| `dev_metrics.prs_merged` (regular sync) | Counted within config-week window — config week |
| `dev_metrics` after backfill | Rebuilt from pr_log/commit_log counts — ISO week |

If `config.current_week` ≠ ISO week (e.g., config stale by 1 week), the regular sync writes `prs_merged` to the wrong week in `dev_metrics`. The backfill writes to the ISO week. They conflict, causing PR double-counting or gaps.

**Fix:** Use ISO week as the single source of truth everywhere; derive config week display-only.

---

### BUG-11 — Week 53 skipped in week navigation

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Type** | UI Bug |
| **Where** | DevTab, AIUsageTab, WeeklyReportTab — `navigate()` function in all three |

**Description**

```js
if (w > 52) { w = 1; y++ }  // skips ISO week 53
```

ISO years with 53 weeks (2020, 2015, 2009…) have valid data in week 53. Navigation jumps 52 → 1 of next year, making week-53 data permanently inaccessible via the UI.

**Fix:** Check `isoWeeksInYear(year)` before wrapping:
```js
function isoWeeksInYear(y) {
  const dec28 = new Date(y, 11, 28)
  return dec28.isocalendar ? dec28.isocalendar()[1] : 52
}
```

---

### BUG-12 — XP chart week labels have no year context

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Type** | UI Bug |
| **Where** | `metrics_dev()` → `weekly_chart` → `XPChart` |

**Description**  
Weekly chart X-axis labels are `"W22"`, `"W15"` etc. with no year. For engineers active near year boundaries, the chart shows `W50, W51, W52, W1, W2` — visually looks like a gap or anomaly. Tooltip provides no context on which year each bar belongs to.

**Fix:** Use `"W22·26"` or ISO date strings `"2026-05-26"` as labels.

---

### BUG-13 — `ai_usage_daily.sessions_count` counts events, not sessions

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Type** | Formula Bug |
| **Where** | `main.py:ingest_telemetry()` — daily upsert |

**Description**

```sql
sessions_count = sessions_count + 1  -- per event, not per session
```

One Claude Code session generates many events (one per turn). A single 20-turn conversation increments `sessions_count` by 20. The AI Usage tab shows "47 sessions" which actually means 47 API turns from possibly 2–3 actual sessions.

**Fix:** Track and deduplicate `session_id` per day:
```sql
-- Count distinct session_ids from ai_events for the day
sessions_count = (SELECT COUNT(DISTINCT session_id) FROM ai_events
                  WHERE engineer_id=? AND timestamp LIKE ?||'%')
```

---

### BUG-14 — `/install.sh` endpoint does not exist

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Type** | Backend Bug |
| **Where** | `AIUsageTab.jsx:EmptyState` component |

**Description**  
The collector install instructions display:
```
curl -sSL https://dashbord-5u0i.onrender.com/install.sh | bash
```
No `/install.sh` route exists in FastAPI. This returns an HTML 404 page which `bash` tries to execute as a shell script, producing a confusing syntax error.

**Fix:** Add `@app.get("/install.sh")` serving the `collector/install.sh` content with `media_type="text/plain"`, or point to the raw GitHub file URL.

---

### BUG-15 — All engineers seeded with all 3 streams

| Field | Value |
|-------|-------|
| **Severity** | 🟢 Low |
| **Type** | Architecture Risk |
| **Where** | `main.py:seed_data()` |

**Description**

```python
all_streams = json_lib.dumps(["dev", "support", "docs"])
# Applied to ALL engineers
```

Every engineer is in dev+support+docs. The leaderboard iterates all 3 streams per engineer. With the fake-data cleanup this is now harmless, but any future support/docs data entry will inflate scores for all engineers regardless of actual role.

**Fix:** Assign streams per engineer based on actual role.

---

## Table of All Formulas

| Formula | Location | F/B | Expected logic | Actual logic | Match |
|---------|----------|-----|----------------|--------------|-------|
| XP Score (dev) | `calc_dev()` | Backend | `prs_merged×100 + commits×10` | Same | ✅ |
| XP Score (support) | `calc_support()` | Backend | `incidents×80 + bonus - breaches×40` | Correct but latent NameError crash | ⚠️ |
| XP Score (docs) | `calc_docs()` | Backend | `created×30 + updated×15 - penalty` | Correct, data deleted | n/a |
| Leaderboard 8-week sum | `leaderboard()` | Backend | Sum of weekly scores | Correct math | ✅ |
| Leaderboard 8-week window | `_weeks_range()` | Backend | Weeks [cur-7…cur] with correct year per week | Year never adjusts cross-year | ❌ |
| Avg PR Size | `metrics_dev()` | Backend | `SUM(adds+dels) / COUNT(*)` from `pr_log` | Correct | ✅ |
| Dev tab current week | `DevTab` | Frontend | `d.current_week` from overview | Correct — reads right field | ✅ |
| AI Usage current week | `AIUsageTab` | Frontend | `d.current_week` from overview | Reads `d.week` (undefined) | ❌ |
| Weekly Report current week | `WeeklyReportTab` | Frontend | `d.current_week` from overview | Reads `d.week` (undefined) | ❌ |
| `calcCurrentWeek()` fallback | All tabs | Frontend | ISO week number | Non-ISO formula (can be off ±1) | ❌ |
| `weekDateRange()` display | Dev, AI, Report | Frontend | ISO week Mon–Fri date range | Correct ISO date calc | ✅ |
| Week nav wrap at 52 | All tabs | Frontend | Wrap at 52 or 53 | Always wraps at 52, skips week 53 | ❌ |
| Commits per engineer bar | `BottleneckBars` + backend | Both | Show 0 for inactive engineers | Inactive engineers omitted entirely | ❌ |
| Streak badge | `leaderboard()` | Backend | 3 strictly rising consecutive weeks | Correct logic | ✅ |
| Shield badge | `leaderboard()` | Backend | 0 SLA breaches in 4 weeks | Crashes on `break_total` NameError | ❌ |
| `sessions_count` | `ingest_telemetry()` | Backend | Count of unique sessions per day | Counts events, not sessions | ❌ |
| TopBar totalScore | `Dashboard.jsx:193` | Frontend | Sum of all member `total_score` | `leaderboard.reduce(…)` — correct | ✅ |
| Backfill week window | `_do_github_backfill()` | Backend | N weeks back with correct year tuples | Uses ISO weeks per PR/commit — correct | ✅ |

---

## Consistency Report

### Frontend vs Backend Mismatches

| Area | Frontend | Backend | Status |
|------|----------|---------|--------|
| Current week field name | `d.week` (undefined) | `/overview` → `current_week` | ❌ Mismatch in 2 tabs |
| Week formula | `calcCurrentWeek()` non-ISO | `datetime.isocalendar()` ISO | ❌ Can disagree ±1 |
| 8-week cross-year queries | Labels correct via `weekDateRange()` | Queries wrong year | ❌ Visual OK, data wrong |

### Chart / Table Mismatches

| Chart/Table | Issue |
|-------------|-------|
| "Commits per engineer" bar | Shows 2 bars for 3 engineers when one has no data |
| XP chart X-axis | `W22` labels without year — ambiguous at year boundary |
| Leaderboard 8-week window vs DevTab week selector | Use different week sources simultaneously |
| TopBar "Week X" | Config-based, may be stale by multiple weeks |

### API Contract Inconsistencies

| Endpoint | Issue |
|----------|-------|
| `GET /overview` | Returns `current_week`/`current_year` but two components expect `week`/`year` |
| `GET /leaderboard` | Uses server-side config week — disconnected from DevTab's user-selected week |
| `GET /metrics/dev` | Accepts client week param — consistent with DevTab but not with leaderboard |
| `commit_log.week` / `pr_log.week` | ISO week — potentially differs from `dev_metrics.week` (config week) |

---

## High Risk Areas

### 1. AI Usage and Weekly Report tabs — cannot trust which week is displayed
Due to BUG-01, both tabs always show data for a week derived from the non-ISO client formula, not the configured admin week. Users believe they are viewing "Week 22" data but may be fetching a different week.

### 2. Leaderboard cross-year periods — all data shows 0
Due to BUG-03, any engineer active in October–December of the previous year shows zero XP for those weeks in the current January–February period. The 8-week chart looks like productivity dropped to zero, which is false.

### 3. Leaderboard endpoint — latent crash risk
Due to BUG-04, the `NameError` on `break_total` will crash `/api/leaderboard` returning HTTP 500 for all users the moment any `support_metrics` row is inserted. This risk is invisible in current state because the migration deleted all support data.

### 4. "Commits per engineer" chart — incompleteness is invisible
Due to BUG-06, engineers with no activity for a week simply vanish from the bar chart. A viewer cannot distinguish between "no one else has data" and "someone has zero commits." This creates false confidence in data completeness.

### 5. `sessions_count` in AI Usage — metric is fabricated
Due to BUG-13, the sessions count displayed in the AI Usage tab counts API response events (turns), not user sessions. The displayed number is meaningless as a "sessions" metric and will overstate usage activity by a factor of 5–20×.

---

## Final Summary

### Overall Quality Score: 4 / 10

### Trust by Module

| Module | Trust | Notes |
|--------|-------|-------|
| Development tab — PRs merged card | ✅ Yes | Correct week param, correct query |
| Development tab — Commits card | ✅ Yes | Same |
| Development tab — Avg PR Size | ✅ Yes | `pr_log` aggregate is correct |
| Development tab — XP chart (same-year) | ✅ Yes | Correct |
| Development tab — XP chart (cross-year) | ❌ No | BUG-03 — wrong year in queries |
| Commits per engineer bars | ⚠️ Partial | BUG-06 — missing zero-row engineers |
| Leaderboard scores (same-year periods) | ✅ Yes | Math is correct |
| Leaderboard scores (cross-year periods) | ❌ No | BUG-03 — phantom zeros |
| Leaderboard breakdown column | ⚠️ Partial | BUG-05 — `commit` shows raw key |
| AI Usage tab — which week shown | ❌ No | BUG-01 — wrong field name |
| AI Usage token counts | ✅ Yes | If week happens to be correct |
| AI Usage sessions count | ❌ No | BUG-13 — counts events not sessions |
| Weekly Report | ❌ No | BUG-01 — wrong week init |
| Engineer Profile XP chart | ⚠️ Untested | Uses same `_weeks_range` — BUG-03 applies |
| Admin Metrics — auto-populate | ✅ Yes | Correct sources |
| GitHub sync data (commit_log/pr_log) | ✅ Yes | Pipeline is solid |
| dev_metrics week alignment | ⚠️ Partial | BUG-10 — dual week systems |

### Confidence Score by Module

| Module | Score | Reason |
|--------|-------|--------|
| Development tab | **6/10** | Cards correct; bar chart drops engineers; XP chart breaks cross-year |
| Leaderboard | **5/10** | Math correct; week window wrong cross-year; latent crash; missing label |
| AI Usage tab | **3/10** | Wrong week init; sessions misleading; install.sh broken |
| Weekly Report | **3/10** | Wrong week init; otherwise correct |
| Admin Metrics | **7/10** | Auto-populate works; no error states on failure |
| GitHub sync data | **6/10** | pr_log/commit_log correct; dev_metrics week mismatch between sync paths |

---

### Fix Immediately (Today)

| Bug | File | Change | Effort |
|-----|------|--------|--------|
| BUG-01 | `AIUsageTab.jsx:160-161`, `WeeklyReportTab.jsx:218-219` | `d.week` → `d.current_week`, `d.year` → `d.current_year` | 2 lines |
| BUG-04 | `main.py` leaderboard badge section | `break_total` → `breach_total` | 1 line |
| BUG-05 | `Leaderboard.jsx:29-39` | Add `commit: 'Commits'` to labels | 1 line |
| BUG-06 | `main.py:metrics_dev()` bottlenecks | Show all engineers including 0-row | ~5 lines |

### Fix Next Week

| Bug | Priority | Effort |
|-----|----------|--------|
| BUG-03 — `_weeks_range` year wrapping | P1 | Medium — all callers need update |
| BUG-02 — `calcCurrentWeek()` non-ISO | P2 | Small — replace formula in 3 files |
| BUG-08 — Config week staleness warning | P2 | Medium |
| BUG-11 — Week 53 navigation | P3 | Small |
| BUG-13 — sessions_count by session not event | P3 | Medium |
| BUG-14 — `/install.sh` missing route | P3 | Small |
| BUG-09 — Infinite spinner on error | P3 | Small |

### Production Readiness: NOT READY

Three of five major modules have correctness bugs affecting the accuracy of displayed KPIs. The leaderboard has a latent crash that will fire the next time support metrics are entered. Two tabs silently show the wrong time period on every load.

---

*Generated by: Claude Opus 4.7 | Audit date: 2026-05-28*
