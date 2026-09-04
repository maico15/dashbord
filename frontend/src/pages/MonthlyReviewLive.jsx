import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTheme, toggleTheme } from "../hooks/useTheme";

/**
 * MonthlyReviewLive — live monthly review, driven entirely by dashboard API data
 * (unlike the curated /review/june-2026 page, nothing here is hand-written).
 */

const API = import.meta.env.VITE_API_URL || "";

/* ---------------- i18n (chrome only — fetched data is shown verbatim) ---------------- */

const T = {
  en: {
    eyebrow: "Monthly Review — Live",
    archive: "June 2026 — curated review",
    archiveAug: "August 2026 — curated review",
    monthInProgress: (d) => `Month in progress — data through ${d} · numbers will grow`,
    metricsSection: (p, c) => `01 · Key metrics — ${p} vs ${c}`,
    engineersSection: (c) => `02 · Key delivery by engineer — ${c}`,
    ganttSection: "03 · Current load — who is on what",
    loading: "Loading monthly data…",
    errorPrefix: "Couldn't load monthly review data",
    retryHint: "Retry or check the API.",
    noReports: (m) => `No daily reports for ${m} — nothing to show yet.`,
    showAll: (n) => `Show all ${n} completed tasks`,
    collapse: "Collapse",
    completed: "completed",
    reports: "reports",
    noTelemetry: "no AI telemetry",
    noActiveProject: "no active project reported",
    queueUndefined: "queue undefined — assign from backlog",
    legendCurrent: "active project (latest report)",
    legendNext: "next in queue",
    legendUndefined: "queue undefined / idle — needs backlog assignment",
    footer: (m, y) => `Sources: /api/metrics/dev · /api/ai-usage/weekly · /api/reports/engineer — computed live for ${m} ${y}`,
    score: "Score",
    failedWeeks: (n) => `${n} week${n === 1 ? "" : "s"} failed to load — totals are incomplete. Reload to retry.`,
  },
  ru: {
    eyebrow: "Месячный обзор — Live",
    archive: "Июнь 2026 — куратор. обзор",
    archiveAug: "Август 2026 — куратор. обзор",
    monthInProgress: (d) => `Месяц ещё идёт — данные по ${d} · цифры будут расти`,
    metricsSection: (p, c) => `01 · Ключевые метрики — ${p} vs ${c}`,
    engineersSection: (c) => `02 · Что сделано по инженерам — ${c}`,
    ganttSection: "03 · Текущая загрузка — кто чем занят",
    loading: "Загрузка данных за месяц…",
    errorPrefix: "Не удалось загрузить данные обзора",
    retryHint: "Повторите попытку или проверьте API.",
    noReports: (m) => `Нет дневных отчётов за ${m} — показывать нечего.`,
    showAll: (n) => `Показать все ${n} завершённых задач`,
    collapse: "Свернуть",
    completed: "завершено",
    reports: "отчётов",
    noTelemetry: "нет данных AI",
    noActiveProject: "активный проект не указан",
    queueUndefined: "очередь не определена — назначить из бэклога",
    legendCurrent: "активный проект (последний отчёт)",
    legendNext: "следующий в очереди",
    legendUndefined: "очередь не определена / простой — нужна задача из бэклога",
    footer: (m, y) => `Источники: /api/metrics/dev · /api/ai-usage/weekly · /api/reports/engineer — расчёт live за ${m} ${y}`,
    score: "Оценка",
    failedWeeks: (n) => n === 1
      ? "1 неделя не загрузилась — итоги неполные. Обновите страницу для повтора."
      : `${n} недель не загрузились — итоги неполные. Обновите страницу для повтора.`,
  },
};

const MONTHS = {
  en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
  ru: ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"],
};

/* ---------------- ISO week helpers ---------------- */

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return {
    week: Math.ceil(((date - yearStart) / 86400000 + 1) / 7),
    year: date.getUTCFullYear(),
  };
}

/** ISO weeks belonging to a month = weeks whose Thursday falls inside it. */
function weeksOfMonth(year, month /* 0-based */) {
  const out = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() === 4) out.push(isoWeek(d)); // Thursday
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* ---------------- data fetching ---------------- */

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Render free-tier backend chokes on high parallel load — retry a couple
 *  times with backoff before giving up, rather than silently treating a
 *  timed-out request as empty/zero data. */
async function getJSONWithRetry(url, retries = 2, backoffMs = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJSON(url);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await delay(backoffMs);
    }
  }
  throw lastErr;
}

/** Runs fn over items in small concurrent batches instead of all at once —
 *  keeps concurrent request count low enough for the free-tier backend. */
async function mapInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

async function fetchWeekData(w) {
  const [devR, aiR] = await Promise.allSettled([
    getJSONWithRetry(`${API}/api/metrics/dev?week=${w.week}&year=${w.year}`),
    getJSONWithRetry(`${API}/api/ai-usage/weekly?week=${w.week}&year=${w.year}`),
  ]);
  const dev = devR.status === "fulfilled" ? devR.value : null;
  const ai = aiR.status === "fulfilled" ? aiR.value : null;
  const failed = devR.status === "rejected" || aiR.status === "rejected";
  return {
    ...w,
    prs: dev?.totals?.prs_merged ?? 0,
    commits: dev?.totals?.commits_count ?? 0,
    tokensOut: ai?.total_tokens_output ?? 0,
    sessions: ai?.total_sessions ?? 0,
    engineers: ai?.engineers ?? [],
    failed,
  };
}

async function fetchMonthBundle(weeks) {
  return mapInBatches(weeks, 3, fetchWeekData);
}

/* ---------------- report → task extraction ---------------- */

const projectOf = (s) => {
  if (!s) return "";
  const cut = String(s).split(/[:—–]|(?:\s-\s)/)[0].trim();
  return cut.length > 46 ? cut.slice(0, 44) + "…" : cut;
};
const short = (s, n = 110) => {
  s = String(s).trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

function summarizeEngineer(reports, monthStart, monthEnd) {
  const inMonth = reports
    .filter((r) => r.report_date >= monthStart && r.report_date <= monthEnd)
    .sort((a, b) => (a.report_date < b.report_date ? 1 : -1)); // newest first

  // key delivery: ALL completed items for the month, grouped by project prefix
  const groupMap = new Map();
  let totalCompleted = 0;
  for (const r of inMonth) {
    for (const c of r.completed || []) {
      const text = String(c).trim();
      if (!text) continue;
      totalCompleted++;
      const key = projectOf(text) || "Other";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(short(text, 140));
    }
  }
  const groups = [...groupMap.entries()]
    .map(([project, items]) => ({ project, count: items.length, items }))
    .sort((a, b) => b.count - a.count);

  // current load (for Gantt) from the latest report overall — daily_reports has no
  // in-progress field, so "current" is the top of next_tasks, falling back to completed.
  const latest = reports.sort((a, b) => (a.report_date < b.report_date ? 1 : -1))[0];
  let current = null, next = null, lastDate = latest?.report_date ?? null;
  if (latest) {
    const nexts = (latest.next_tasks || []).map(String).filter(Boolean);
    if (nexts.length) { current = nexts[0]; next = nexts[1] ?? null; }
    else if ((latest.completed || []).length) current = latest.completed[0];
  }
  return { groups, totalCompleted, reportCount: inMonth.length, current, next, lastDate };
}

/* ---------------- tiny UI pieces ---------------- */

function Spark({ series, splitIdx }) {
  const max = Math.max(...series.filter((s) => !s.failed).map((s) => s.value || 0), 1);
  return (
    <div className="mr-spark">
      {series.map((s, i) => (
        <i
          key={i}
          className={`${i >= splitIdx ? "cur " : ""}${s.failed ? "failed" : ""}`}
          style={{ height: s.failed ? "20%" : `${Math.max(6, ((s.value || 0) / max) * 100)}%` }}
          title={s.failed ? "failed to load" : undefined}
        />
      ))}
    </div>
  );
}

function Delta({ prev, cur, fmt }) {
  if (!prev) return <span className="mr-delta up">new</span>;
  const ratio = cur / prev;
  const cls = ratio >= 1.05 ? "up" : ratio <= 0.95 ? "down" : "flat";
  const label =
    ratio >= 2 ? `×${ratio.toFixed(1)}`
    : `${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}%`;
  return <span className={`mr-delta ${cls}`}>{label}{fmt ? ` ${fmt}` : ""}</span>;
}

const fmtM = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n));

/** Per-engineer score input, wired to the same /api/performance-scores endpoint
 *  and auth pattern (?password=) used on the curated June 2026 page. */
function ScoreInput({ engId, color, scores, saveScore, savedId }) {
  const [localScore, setLocalScore] = useState(scores[engId] || "");
  useEffect(() => { setLocalScore(scores[engId] || "") }, [scores[engId]]);
  return (
    <div className="mr-score">
      <input
        type="number" min="1" max="10"
        value={localScore}
        placeholder="—"
        onChange={(e) => setLocalScore(e.target.value)}
        onBlur={(e) => saveScore(engId, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && saveScore(engId, e.target.value)}
        style={{
          borderColor: localScore ? color : "var(--border)",
          background: localScore ? `${color}18` : "var(--card)",
          color: localScore ? color : "var(--muted)",
        }}
      />
      {savedId === engId && <span className="mr-score-saved">✓</span>}
    </div>
  );
}

/** Engineer card: grouped completed tasks, collapsed to top groups, expandable to full month. */
function EngineerCard({ eng, summary, ai, month, t, scoreProps }) {
  const [open, setOpen] = useState(false);
  const groups = summary.groups || [];
  const COLLAPSED_GROUPS = 5;
  const COLLAPSED_ITEMS = 2;
  const visible = open ? groups : groups.slice(0, COLLAPSED_GROUPS);
  const hiddenCount =
    summary.totalCompleted -
    visible.reduce((a, g) => a + (open ? g.count : Math.min(g.count, COLLAPSED_ITEMS)), 0);

  return (
    <div className="card mr-eng">
      <div className="mr-eng-head">
        <span className="mr-dot" style={{ background: eng.color || "var(--accent1)" }} />
        <span className="mr-eng-name">{eng.name}</span>
        <span className="mr-eng-stats">
          {ai?.out ? `${fmtM(ai.out)} tok · ${ai.sessions} sess` : t.noTelemetry}
          <br />
          <b className="mr-done-count">{summary.totalCompleted || 0} {t.completed}</b> · {summary.reportCount || 0} {t.reports}
        </span>
        {scoreProps && (
          <div className="mr-score-wrap">
            <span className="mr-score-label">{t.score}</span>
            <ScoreInput {...scoreProps} />
          </div>
        )}
      </div>
      {groups.length ? (
        <>
          {visible.map((g) => (
            <div key={g.project} className="mr-group">
              <div className="mr-group-head">
                <span className="mr-group-name">{g.project}</span>
              </div>
              <ul>
                {(open ? g.items : g.items.slice(0, COLLAPSED_ITEMS)).map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
          {(hiddenCount > 0 || open) && (
            <button className="mr-more" onClick={() => setOpen(!open)}>
              {open ? t.collapse : t.showAll(summary.totalCompleted)}
            </button>
          )}
        </>
      ) : (
        <div className="mr-empty">{t.noReports(month)}</div>
      )}
    </div>
  );
}

/* ---------------- weekly-tasks manual override for section 03 ---------------- */

/** Parses the free-text weekly_tasks.tasks field into a "Current load" override.
 *  "hidden" -> row is skipped entirely. "Current: X | Next: Y" -> X/Y override the
 *  report-derived current/next (Y empty renders the red queue-undefined bar).
 *  Anything else -> null, caller falls back to report-derived values. */
function parseWeeklyOverride(tasksStr) {
  const t = (tasksStr || "").trim();
  if (!t) return null;
  if (t.toLowerCase() === "hidden") return { hidden: true, current: null, next: null };
  const m = t.match(/^current:\s*(.+?)\s*\|\s*next:\s*(.*)$/is);
  if (!m || !m[1].trim()) return null;
  return { hidden: false, current: m[1].trim(), next: m[2].trim() || null };
}

/* ---------------- main component ---------------- */

export default function MonthlyReviewLive() {
  const now = new Date();
  const [sel, setSel] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [lang, setLang] = useState("en");
  const theme = useTheme();
  const t = T[lang];
  const [state, setState] = useState({ loading: true, error: null });
  const [team, setTeam] = useState([]);
  const [curWeeks, setCurWeeks] = useState([]);
  const [prevWeeks, setPrevWeeks] = useState([]);
  const [summaries, setSummaries] = useState({}); // id -> summary
  const [scores, setScores] = useState({});
  const [savedId, setSavedId] = useState(null);
  const [weeklyOverrides, setWeeklyOverrides] = useState({}); // engineer_id -> {hidden,current,next}

  const monthInProgress = sel.y === now.getFullYear() && sel.m === now.getMonth();
  const prev = sel.m === 0 ? { y: sel.y - 1, m: 11 } : { y: sel.y, m: sel.m - 1 };

  useEffect(() => {
    let dead = false;
    const cw = isoWeek(new Date());
    getJSON(`${API}/api/weekly-tasks?week=${cw.week}&year=${cw.year}`)
      .then((d) => {
        if (dead) return;
        const map = {};
        for (const row of d.tasks || []) {
          const parsed = parseWeeklyOverride(row.tasks);
          if (parsed) map[row.engineer_id] = parsed;
        }
        setWeeklyOverrides(map);
      })
      .catch(() => { if (!dead) setWeeklyOverrides({}) });
    return () => { dead = true };
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      setState({ loading: true, error: null });
      try {
        const roster = await getJSONWithRetry(`${API}/api/team`);
        const members = Array.isArray(roster) ? roster : roster.members || [];
        // cur/prev month bundles each internally batch their own weeks (3 at a time),
        // so running the two bundles themselves in parallel keeps peak concurrency low.
        const [cw, pw] = await Promise.all([
          fetchMonthBundle(weeksOfMonth(sel.y, sel.m)),
          fetchMonthBundle(weeksOfMonth(prev.y, prev.m)),
        ]);

        const monthStart = `${sel.y}-${String(sel.m + 1).padStart(2, "0")}-01`;
        const monthEnd = `${sel.y}-${String(sel.m + 1).padStart(2, "0")}-31`;
        const sums = {};
        await mapInBatches(members, 3, async (e) => {
          try {
            const d = await getJSONWithRetry(`${API}/api/reports/engineer/${e.id}`);
            const reps = Array.isArray(d) ? d : d.reports || [];
            sums[e.id] = summarizeEngineer(reps, monthStart, monthEnd);
          } catch {
            sums[e.id] = { groups: [], totalCompleted: 0, reportCount: 0, current: null, next: null, lastDate: null };
          }
        });
        if (dead) return;
        setTeam(members);
        setCurWeeks(cw);
        setPrevWeeks(pw);
        setSummaries(sums);
        setState({ loading: false, error: null });
      } catch (err) {
        if (!dead) setState({ loading: false, error: err.message });
      }
    })();
    return () => { dead = true };
  }, [sel.y, sel.m]);

  // Scores are tracked per ISO week; use the most recent week of the selected month.
  const scoreWeek = curWeeks.length ? curWeeks[curWeeks.length - 1] : null;

  useEffect(() => {
    if (!scoreWeek) return;
    let dead = false;
    getJSON(`${API}/api/performance-scores?week=${scoreWeek.week}&year=${scoreWeek.year}`)
      .then((d) => { if (!dead) setScores(d || {}) })
      .catch(() => { if (!dead) setScores({}) });
    return () => { dead = true };
  }, [scoreWeek?.week, scoreWeek?.year]);

  const saveScore = async (engineerId, val) => {
    if (!scoreWeek) return;
    const num = parseInt(val);
    if (!val || isNaN(num) || num < 1 || num > 10) return;
    try {
      await fetch(`${API}/api/performance-scores?password=admin123`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineer_id: engineerId, week: scoreWeek.week, year: scoreWeek.year, score: num }),
      });
      setScores((prev) => ({ ...prev, [engineerId]: num }));
      setSavedId(engineerId);
      setTimeout(() => setSavedId(null), 1500);
    } catch (e) {
      console.error("Score save error:", e);
    }
  };

  const totals = useMemo(() => {
    const sum = (ws, k) => ws.filter((w) => !w.failed).reduce((a, w) => a + (w[k] || 0), 0);
    return {
      prs: [sum(prevWeeks, "prs"), sum(curWeeks, "prs")],
      commits: [sum(prevWeeks, "commits"), sum(curWeeks, "commits")],
      tokens: [sum(prevWeeks, "tokensOut"), sum(curWeeks, "tokensOut")],
      sessions: [sum(prevWeeks, "sessions"), sum(curWeeks, "sessions")],
    };
  }, [curWeeks, prevWeeks]);

  const perEngineerAI = useMemo(() => {
    const acc = {};
    for (const w of curWeeks)
      for (const e of w.engineers) {
        acc[e.id] = acc[e.id] || { out: 0, sessions: 0, days: 0 };
        acc[e.id].out += e.tokens_output || 0;
        acc[e.id].sessions += e.sessions || 0;
        acc[e.id].days += e.active_days || 0;
      }
    return acc;
  }, [curWeeks]);

  const sortedTeam = useMemo(
    () =>
      [...team].sort(
        (a, b) => (perEngineerAI[b.id]?.out || 0) - (perEngineerAI[a.id]?.out || 0)
      ),
    [team, perEngineerAI]
  );

  const allWeeks = [...prevWeeks, ...curWeeks];
  const splitIdx = prevWeeks.length;
  const weekLabels = allWeeks.length
    ? [`W${allWeeks[0].week}`, `W${allWeeks[allWeeks.length - 1].week}`]
    : ["", ""];

  /* ---------- render ---------- */

  if (state.loading)
    return (
      <div className="mr-wrap"><Style />
        <div className="mr-loading">{t.loading}</div>
      </div>
    );
  if (state.error)
    return (
      <div className="mr-wrap"><Style />
        <div className="card mr-error">
          {t.errorPrefix}: {state.error}. {t.retryHint}
        </div>
      </div>
    );

  const toSeries = (key) => allWeeks.map((w) => ({ value: w[key], failed: w.failed }));
  const metricDefs = [
    { label: "PRs merged", key: "prs", series: toSeries("prs"), fmt: (v) => v },
    { label: "Commits", key: "commits", series: toSeries("commits"), fmt: (v) => v },
    { label: "Claude Code output tokens", key: "tokens", series: toSeries("tokensOut"), fmt: fmtM },
    { label: "AI sessions", key: "sessions", series: toSeries("sessions"), fmt: (v) => v },
  ];
  const failedWeekCount = allWeeks.filter((w) => w.failed).length;

  return (
    <div className="mr-wrap">
      <Style />

      {/* header */}
      <div className="mr-head">
        <div>
          <div className="mr-eyebrow">{t.eyebrow}</div>
          <h1 className="mr-title">
            <span className="mr-prev">{MONTHS[lang][prev.m]}</span>
            <span className="mr-arrow">→</span>
            <span className="mr-cur">{MONTHS[lang][sel.m]} {sel.y}</span>
          </h1>
          <Link to="/review/august-2026" className="mr-archive">
            🗂 {t.archiveAug}
          </Link>
          <Link to="/review/june-2026" className="mr-archive">
            🗂 {t.archive}
          </Link>
        </div>
        <div className="mr-controls">
          <select
            value={`${sel.y}-${sel.m}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setSel({ y, m });
            }}
          >
            {Array.from({ length: 8 }, (_, i) => {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              return (
                <option key={i} value={`${d.getFullYear()}-${d.getMonth()}`}>
                  {MONTHS[lang][d.getMonth()]} {d.getFullYear()}
                </option>
              );
            })}
          </select>
          <button
            className="mr-icon-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="mr-lang">
            {["en", "ru"].map((l) => (
              <button
                key={l}
                className={l === lang ? "active" : ""}
                onClick={() => setLang(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      {monthInProgress && (
        <div className="mr-coverage">
          {t.monthInProgress(now.toISOString().slice(0, 10))}
        </div>
      )}

      {/* 01 · metrics */}
      <div className="mr-section-title">{t.metricsSection(MONTHS[lang][prev.m], MONTHS[lang][sel.m])}</div>
      <div className="mr-metrics">
        {metricDefs.map((m) => (
          <div key={m.key} className="card mr-metric">
            <div className="mr-label">{m.label}</div>
            <div className="mr-pair">
              <span className="mr-old">{m.fmt(totals[m.key][0])}</span>
              <span className="mr-arrow">→</span>
              <span className="mr-new">{m.fmt(totals[m.key][1])}</span>
            </div>
            <Delta prev={totals[m.key][0]} cur={totals[m.key][1]} />
            <Spark series={m.series} splitIdx={splitIdx} />
            <div className="mr-spark-cap"><span>{weekLabels[0]}</span><span>{weekLabels[1]}</span></div>
          </div>
        ))}
      </div>
      {failedWeekCount > 0 && <div className="mr-fail-warning">{t.failedWeeks(failedWeekCount)}</div>}

      {/* 02 · engineers */}
      <div className="mr-section-title">{t.engineersSection(MONTHS[lang][sel.m])}</div>
      <div className="mr-cards">
        {sortedTeam
          .filter((e) => !weeklyOverrides[e.id]?.hidden)
          .map((e) => (
          <EngineerCard
            key={e.id}
            eng={e}
            summary={summaries[e.id] || {}}
            ai={perEngineerAI[e.id]}
            month={MONTHS[lang][sel.m]}
            t={t}
            scoreProps={
              scoreWeek
                ? { engId: e.id, color: e.color, scores, saveScore, savedId }
                : null
            }
          />
        ))}
      </div>

      {/* 03 · gantt */}
      <div className="mr-section-title">{t.ganttSection}</div>
      <div className="card mr-gantt">
        {sortedTeam
          .filter((e) => !weeklyOverrides[e.id]?.hidden)
          .map((e) => {
            const s = summaries[e.id] || {};
            const ov = weeklyOverrides[e.id];
            const currentLabel = ov
              ? ov.current
              : (s.current ? short(projectOf(s.current) || s.current, 60) : null);
            const nextLabel = ov
              ? ov.next
              : (s.next ? short(projectOf(s.next) || s.next, 50) : null);
            return (
              <div key={e.id} className="mr-g-row">
                <div className="mr-g-name">
                  <span className="mr-dot" style={{ background: e.color || "var(--accent1)" }} />
                  {e.name}
                </div>
                <div className="mr-g-lane">
                  {currentLabel ? (
                    <div className="mr-bar cur" style={{ background: e.color || "var(--accent1)" }}>
                      {currentLabel}
                    </div>
                  ) : (
                    <div className="mr-bar idle">{t.noActiveProject}</div>
                  )}
                  {nextLabel ? (
                    <div className="mr-bar next">→ {nextLabel}</div>
                  ) : (
                    <div className="mr-bar queue">{t.queueUndefined}</div>
                  )}
                </div>
              </div>
            );
          })}
        <div className="mr-legend">
          <span><i className="sw solid" /> {t.legendCurrent}</span>
          <span><i className="sw dash" /> {t.legendNext}</span>
          <span><i className="sw red" /> {t.legendUndefined}</span>
        </div>
      </div>

      <div className="mr-foot">
        {t.footer(MONTHS[lang][sel.m], sel.y)}
      </div>
    </div>
  );
}

/* ---------------- scoped styles (dashboard tokens) ---------------- */

function Style() {
  return (
    <style>{`
      .mr-wrap{max-width:1180px;margin:0 auto;padding:8px 24px 64px}
      .mr-loading{padding:60px 0;text-align:center;color:var(--muted)}
      .mr-error{color:var(--danger)}

      .mr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:16px}
      .mr-eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
      .mr-title{font-size:32px;font-weight:800;margin:6px 0 0;letter-spacing:-.01em}
      .mr-title .mr-prev{color:var(--muted);font-weight:600}
      .mr-title .mr-arrow{color:var(--muted);margin:0 10px;font-weight:400}
      .mr-title .mr-cur{color:var(--success)}
      .mr-archive{display:inline-block;margin-top:12px;font-size:12px;color:var(--muted);text-decoration:none;border:1px solid var(--border);border-radius:16px;padding:5px 12px}
      .mr-archive+.mr-archive{margin-left:8px}
      .mr-archive:hover{color:var(--accent1);border-color:var(--accent1)}
      .mr-controls{display:flex;align-items:center;gap:8px}
      .mr-controls select{background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-family:inherit;font-size:13px}
      .mr-icon-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px}
      .mr-lang{display:flex;gap:6px}
      .mr-lang button{padding:5px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;cursor:pointer}
      .mr-lang button.active{background:var(--accent);color:#fff;border-color:var(--accent)}
      .mr-coverage{display:inline-block;margin-top:12px;padding:5px 12px;border:1px solid var(--border);border-radius:16px;font-size:11.5px;color:var(--warning)}

      .mr-section-title{font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);padding-bottom:10px;margin:44px 0 18px}

      .mr-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
      .mr-metric .mr-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
      .mr-pair{display:flex;align-items:baseline;gap:10px;margin:12px 0 4px}
      .mr-old{font-size:17px;font-weight:600;color:var(--muted)}
      .mr-pair .mr-arrow{color:var(--muted);font-size:13px}
      .mr-new{font-size:28px;font-weight:800;color:var(--text)}
      .mr-delta{font-size:12.5px;font-weight:700}
      .mr-delta.up{color:var(--success)} .mr-delta.flat{color:var(--warning)} .mr-delta.down{color:var(--danger)}
      .mr-spark{display:flex;align-items:flex-end;gap:3px;height:40px;margin-top:14px}
      .mr-spark i{flex:1;border-radius:2px 2px 0 0;background:var(--border)}
      .mr-spark i.cur{background:var(--success);opacity:.85}
      .mr-spark i.failed{background:var(--danger);opacity:.9}
      .mr-spark-cap{display:flex;justify-content:space-between;font-size:9.5px;color:var(--muted);margin-top:5px}
      .mr-fail-warning{margin-top:10px;font-size:12px;color:var(--danger);padding:8px 12px;border:1px solid var(--danger);border-radius:8px;background:rgba(239,68,68,.08)}

      .mr-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .mr-eng-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
      .mr-dot{width:10px;height:10px;border-radius:50%;flex:none}
      .mr-eng-name{font-size:15.5px;font-weight:700}
      .mr-eng-stats{margin-left:auto;font-size:10.5px;color:var(--muted);text-align:right;white-space:nowrap;line-height:1.5}
      .mr-score-wrap{display:flex;align-items:center;gap:6px;width:100%;justify-content:flex-end;margin-top:2px}
      .mr-score-label{font-size:11px;color:var(--muted)}
      .mr-score{display:flex;align-items:center;gap:6px}
      .mr-score input{width:48px;text-align:center;font-size:14px;font-weight:600;padding:3px 5px;border-radius:7px;outline:none;border:1.5px solid var(--border);font-family:inherit}
      .mr-score-saved{font-size:11px;color:var(--success)}
      .mr-eng ul{list-style:none;margin:0;padding:0}
      .mr-eng li{padding:4px 0 4px 16px;position:relative;color:var(--muted);font-size:13px;line-height:1.5}
      .mr-eng li::before{content:'';position:absolute;left:0;top:11px;width:6px;height:2px;background:var(--muted)}
      .mr-empty{color:var(--muted);font-size:13px;opacity:.7}
      .mr-done-count{color:var(--success);font-weight:700}
      .mr-group{margin-top:10px}
      .mr-group-head{display:flex;align-items:center;gap:8px;margin-bottom:2px}
      .mr-group-name{font-size:12.5px;font-weight:700;color:var(--text)}
      .mr-more{margin-top:12px;background:none;border:1px solid var(--border);border-radius:8px;color:var(--accent1);font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;font-family:inherit}
      .mr-more:hover{border-color:var(--accent1)}

      .mr-gantt{padding:18px 20px}
      .mr-g-row{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)}
      .mr-g-row:last-of-type{border-bottom:none}
      .mr-g-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .mr-g-name .mr-dot{width:8px;height:8px}
      .mr-g-lane{display:flex;gap:8px;flex-wrap:wrap}
      .mr-bar{min-height:24px;border-radius:6px;display:inline-flex;align-items:center;padding:4px 10px;font-size:11px;font-weight:600;white-space:normal;line-height:1.35;max-width:260px;word-break:break-word}
      .mr-bar.cur{color:#06091a}
      .mr-bar.next{border:1.5px dashed var(--muted);color:var(--muted)}
      .mr-bar.queue,.mr-bar.idle{border:1.5px dashed var(--danger);color:var(--danger)}
      .mr-legend{display:flex;gap:20px;flex-wrap:wrap;margin-top:16px;font-size:11px;color:var(--muted)}
      .mr-legend span{display:flex;align-items:center;gap:6px}
      .mr-legend .sw{width:20px;height:10px;border-radius:3px;display:inline-block}
      .mr-legend .sw.solid{background:var(--accent1)}
      .mr-legend .sw.dash{border:1.5px dashed var(--muted)}
      .mr-legend .sw.red{border:1.5px dashed var(--danger)}

      .mr-foot{margin-top:36px;font-size:11px;color:var(--muted);border-top:1px solid var(--border);padding-top:14px}

      @media(max-width:900px){
        .mr-metrics{grid-template-columns:1fr 1fr}
        .mr-cards{grid-template-columns:1fr}
        .mr-g-row{grid-template-columns:1fr}
      }
    `}</style>
  );
}
