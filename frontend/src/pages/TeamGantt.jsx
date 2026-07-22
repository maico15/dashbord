import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTheme, toggleTheme } from "../hooks/useTheme";
import { api } from "../api/client";

/**
 * TeamGantt — standing per-engineer load view: current project (day X of ~Y),
 * next queued project, and idle time shown as its own visible row.
 */

const DAY_COLS = 42; // 6 weeks
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ---------------- date helpers (local calendar days, no timezone math) ---------------- */

function startOfWeekMonday(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay() || 7; // Mon=1..Sun=7
  date.setDate(date.getDate() - day + 1);
  return date;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toISODate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function isWeekend(d) {
  const g = d.getDay();
  return g === 0 || g === 6;
}
/** Date of the nth working day on/after start (n >= 1). Guarded against runaway loops. */
function nthWorkingDay(start, n) {
  const target = Math.max(1, Math.min(400, n || 1));
  let d = new Date(start);
  let count = 0;
  let guard = 0;
  while (guard++ < 1000) {
    if (!isWeekend(d)) {
      count++;
      if (count === target) return d;
    }
    d = addDays(d, 1);
  }
  return d;
}
function workingDaysElapsed(start, today) {
  if (today < start) return 0;
  let d = new Date(start);
  let count = 0;
  let guard = 0;
  while (d <= today && guard++ < 1000) {
    if (!isWeekend(d)) count++;
    d = addDays(d, 1);
  }
  return count;
}
function isoWeekNum(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}
function weekRangeLabel(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const a = `${MONTH_SHORT[monday.getMonth()]} ${monday.getDate()}`;
  const b = sameMonth ? `${sunday.getDate()}` : `${MONTH_SHORT[sunday.getMonth()]} ${sunday.getDate()}`;
  return `${a}–${b}`;
}

/* ---------------- lane model ---------------- */

function buildLanes(engineers, rangeStart, today) {
  let rowCursor = 3; // rows 1-2 are the header
  const lanes = engineers.map((eng) => {
    const assignments = eng.assignments || [];
    const continuous = assignments.find((a) => a.status === "continuous");
    const active = !continuous ? assignments.find((a) => a.status === "active") : null;
    const queued = assignments
      .filter((a) => a.status === "queued")
      .sort((a, b) => (a.queue_start || "").localeCompare(b.queue_start || ""))[0];

    const primaryRow = rowCursor++;
    let queuedRow = null;
    if (queued) queuedRow = rowCursor++;

    let primary;
    if (continuous) {
      primary = { kind: "continuous", assignment: continuous, colStart: 0, colEnd: DAY_COLS };
    } else if (active) {
      const start = parseISODate(active.start_date);
      const end = nthWorkingDay(start, active.est_days);
      const elapsed = Math.max(1, workingDaysElapsed(start, today));
      const overdue = today > end && active.percent < 100;
      const rawStart = Math.round((start - rangeStart) / 86400000);
      const rawEnd = Math.round((end - rangeStart) / 86400000) + 1;
      primary = {
        kind: "active",
        assignment: active,
        colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
        colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
        dayX: elapsed > active.est_days ? `${active.est_days}+` : String(elapsed),
        estY: active.est_days,
        overdue,
      };
    } else {
      primary = { kind: "idle" };
    }

    let secondary = null;
    if (queued) {
      let qStart;
      if (queued.queue_start) qStart = parseISODate(queued.queue_start);
      else if (active) qStart = addDays(nthWorkingDay(parseISODate(active.start_date), active.est_days), 1);
      else qStart = today;
      const qEnd = nthWorkingDay(qStart, queued.est_days);
      const rawStart = Math.round((qStart - rangeStart) / 86400000);
      const rawEnd = Math.round((qEnd - rangeStart) / 86400000) + 1;
      secondary = {
        kind: "queued",
        assignment: queued,
        colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
        colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
        startLabel: toISODate(qStart),
      };
    }

    return { engineer: eng, primaryRow, queuedRow, primary, secondary };
  });
  return { lanes, totalRows: rowCursor - 1 };
}

/* ---------------- inline edit controls ---------------- */

function AssignmentEditor({ a, hidePercentEst, onChange, onDelete }) {
  return (
    <div className="tg-editor" onClick={(e) => e.stopPropagation()}>
      <input
        className="tg-e-project"
        defaultValue={a.project}
        onBlur={(e) => e.target.value !== a.project && onChange({ project: e.target.value })}
      />
      {!hidePercentEst && (
        <div className="tg-e-percent">
          <button onClick={() => onChange({ percent: Math.max(0, a.percent - 5) })}>−</button>
          <span>{a.percent}%</span>
          <button onClick={() => onChange({ percent: Math.min(100, a.percent + 5) })}>+</button>
        </div>
      )}
      {!hidePercentEst && (
        <input
          type="number" min="1" className="tg-e-est"
          defaultValue={a.est_days}
          onBlur={(e) => {
            const v = parseInt(e.target.value);
            if (v && v !== a.est_days) onChange({ est_days: v });
          }}
        />
      )}
      <input
        type="date" className="tg-e-date"
        defaultValue={a.start_date}
        onChange={(e) => e.target.value && onChange({ start_date: e.target.value })}
      />
      {a.status === "queued" && (
        <input
          type="date" className="tg-e-date"
          defaultValue={a.queue_start || ""}
          onChange={(e) => onChange({ queue_start: e.target.value })}
        />
      )}
      <div className="tg-e-status">
        {["active", "queued", "continuous"].map((s) => (
          <button key={s} className={s === a.status ? "on" : ""} onClick={() => onChange({ status: s })} title={s}>
            {s[0].toUpperCase()}
          </button>
        ))}
      </div>
      <button className="tg-e-del" onClick={onDelete} title="Delete assignment">✕</button>
    </div>
  );
}

/* ---------------- main component ---------------- */

export default function TeamGantt() {
  const theme = useTheme();
  const [data, setData] = useState({ engineers: [] });
  const [aiMap, setAiMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [syncMsg, setSyncMsg] = useState("");

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const rangeStart = useMemo(() => addDays(startOfWeekMonday(today), -7), [today]);
  const days = useMemo(() => Array.from({ length: DAY_COLS }, (_, i) => addDays(rangeStart, i)), [rangeStart]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => days[i * 7]), [days]);
  const todayIdx = Math.round((today - rangeStart) / 86400000);

  async function load() {
    try {
      const [gantt, ai] = await Promise.all([
        api.get("/gantt"),
        api.get("/ai-usage/weekly").catch(() => null),
      ]);
      setData(gantt);
      const m = {};
      for (const e of ai?.engineers || []) m[e.id] = e.tokens_output || 0;
      setAiMap(m);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load() }, []);

  const ensurePassword = () => {
    if (pw) return pw;
    const entered = window.prompt("Admin password:");
    if (entered) { setPw(entered); setPwError("") }
    return entered || "";
  };

  const enableEdit = () => {
    const p = ensurePassword();
    if (p) setEditMode(true);
  };

  async function updateAssignment(id, patch) {
    const p = ensurePassword();
    if (!p) return;
    try {
      await api.put(`/gantt/${id}`, patch, p);
      setPwError("");
      await load();
    } catch (err) {
      setPwError(err.message || "Update failed — check the admin password");
    }
  }
  async function deleteAssignment(id, project) {
    const p = ensurePassword();
    if (!p) return;
    if (!confirm(`Delete "${project}"?`)) return;
    try {
      await api.del(`/gantt/${id}`, p);
      setPwError("");
      await load();
    } catch (err) {
      setPwError(err.message || "Delete failed — check the admin password");
    }
  }
  async function addAssignment(engineerId) {
    const p = ensurePassword();
    if (!p) return;
    try {
      await api.post("/gantt", {
        engineer_id: engineerId, project: "New project",
        start_date: toISODate(today), est_days: 10, percent: 0, status: "active",
      }, p);
      setPwError("");
      await load();
    } catch (err) {
      setPwError(err.message || "Create failed — check the admin password");
    }
  }
  async function syncFromReports() {
    const p = ensurePassword();
    if (!p) return;
    try {
      const res = await api.post("/gantt/sync-from-reports", {}, p);
      setPwError("");
      setSyncMsg(`Synced ${res.created} new assignment${res.created === 1 ? "" : "s"} from reports`);
      await load();
    } catch (err) {
      setPwError(err.message || "Sync failed — check the admin password");
    }
    setTimeout(() => setSyncMsg(""), 5000);
  }

  const sortedEngineers = useMemo(() => {
    return [...(data.engineers || [])].sort((a, b) => {
      const diff = (aiMap[b.id] || 0) - (aiMap[a.id] || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [data.engineers, aiMap]);

  const { lanes, totalRows } = useMemo(
    () => buildLanes(sortedEngineers, rangeStart, today),
    [sortedEngineers, rangeStart, today]
  );

  const lastUpdated = useMemo(() => {
    let max = null;
    for (const e of data.engineers || [])
      for (const a of e.assignments || [])
        if (a.updated_at && (!max || a.updated_at > max)) max = a.updated_at;
    return max;
  }, [data.engineers]);

  const gridTemplateRows = `28px 24px ${Array(Math.max(0, totalRows - 2)).fill("minmax(40px,auto)").join(" ")}`;

  if (loading)
    return (
      <div className="tg-wrap"><Style />
        <div className="tg-loading">Loading team load…</div>
      </div>
    );

  return (
    <div className="tg-wrap">
      <Style />

      <div className="tg-head">
        <div>
          <div className="tg-eyebrow">Standing team load</div>
          <h1 className="tg-title">Team Gantt — engineering load</h1>
          <div className="tg-subtitle">
            {lastUpdated ? `Last updated ${lastUpdated.slice(0, 16).replace("T", " ")} UTC` : "No assignments yet"}
          </div>
          <Link to="/" className="tg-back">← Dashboard</Link>
        </div>
        <div className="tg-controls">
          <button className="tg-btn" onClick={syncFromReports}>⟳ Sync from reports</button>
          <button className={`tg-btn${editMode ? " on" : ""}`} onClick={() => (editMode ? setEditMode(false) : enableEdit())}>
            {editMode ? "✓ Editing" : "✎ Edit mode"}
          </button>
          <button className="tg-icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {syncMsg && <div className="tg-toast">{syncMsg}</div>}
      {(error || pwError) && <div className="card tg-error">{error || pwError}</div>}

      <div className="tg-legend">
        <span><i className="sw solid" /> active (fill = % done)</span>
        <span><i className="sw dash" /> queued (next in line)</span>
        <span><i className="sw red" /> IDLE — no active project</span>
        <span><i className="sw amber" /> overdue</span>
      </div>

      <div className="tg-scroll">
        <div
          className="tg-grid"
          style={{ gridTemplateColumns: `200px repeat(${DAY_COLS}, minmax(28px,1fr))`, gridTemplateRows }}
        >
          {/* weekend background columns (lane area only) */}
          {days.map((d, i) => isWeekend(d) && (
            <div key={`we-${i}`} className="tg-weekend-col" style={{ gridColumn: i + 2, gridRow: `3 / ${totalRows + 1}` }} />
          ))}

          {/* today marker */}
          {todayIdx >= 0 && todayIdx < DAY_COLS && (
            <div className="tg-today-col" style={{ gridColumn: todayIdx + 2, gridRow: `1 / ${totalRows + 1}` }}>
              <div className="tg-today-line" />
            </div>
          )}

          {/* header: name spacer */}
          <div className="tg-name-header" style={{ gridColumn: 1, gridRow: "1 / 3" }}>Engineer</div>

          {/* header: week labels */}
          {weeks.map((monday, i) => (
            <div key={`w-${i}`} className="tg-week-cell" style={{ gridColumn: `${2 + i * 7} / ${9 + i * 7}`, gridRow: 1 }}>
              W{isoWeekNum(monday)} · {weekRangeLabel(monday)}
            </div>
          ))}

          {/* header: day numbers */}
          {days.map((d, i) => (
            <div key={`d-${i}`} className={`tg-day-cell${isWeekend(d) ? " weekend" : ""}`} style={{ gridColumn: i + 2, gridRow: 2 }}>
              {d.getDate()}
            </div>
          ))}

          {/* lanes */}
          {lanes.map(({ engineer: e, primaryRow, queuedRow, primary, secondary }) => {
            const color = e.avatar_color || e.color || "var(--accent1)";
            return (
              <div key={e.id} style={{ display: "contents" }}>
                <div
                  className="tg-name-row"
                  style={{ gridColumn: 1, gridRow: `${primaryRow} / ${(queuedRow || primaryRow) + 1}` }}
                >
                  <span className="tg-dot" style={{ background: color }} />
                  <span className="tg-eng-name">{e.name}</span>
                  {editMode && (
                    <button className="tg-add-btn" onClick={() => addAssignment(e.id)}>+ assignment</button>
                  )}
                </div>

                {primary.kind === "idle" && (
                  <div className="tg-bar tg-idle" style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow: primaryRow }}>
                    <span className="tg-bar-label">IDLE — no active project</span>
                  </div>
                )}

                {primary.kind === "continuous" && (
                  <div
                    className={`tg-bar tg-continuous${editMode ? " tg-editing" : ""}`}
                    style={{ gridColumn: `${primary.colStart + 2} / ${primary.colEnd + 2}`, gridRow: primaryRow, background: `${color}2e` }}
                  >
                    <span className="tg-bar-label">{primary.assignment.project} · continuous</span>
                    {editMode && (
                      <AssignmentEditor
                        a={primary.assignment}
                        hidePercentEst
                        onChange={(patch) => updateAssignment(primary.assignment.id, patch)}
                        onDelete={() => deleteAssignment(primary.assignment.id, primary.assignment.project)}
                      />
                    )}
                  </div>
                )}

                {primary.kind === "active" && (
                  <div
                    className={`tg-bar tg-active${primary.overdue ? " tg-overdue" : ""}${editMode ? " tg-editing" : ""}`}
                    style={{ gridColumn: `${primary.colStart + 2} / ${primary.colEnd + 2}`, gridRow: primaryRow }}
                  >
                    <div className="tg-bar-fillwrap">
                      <div className="tg-bar-fill" style={{ width: `${primary.assignment.percent}%`, background: color }} />
                      <div className="tg-bar-rest" style={{ width: `${100 - primary.assignment.percent}%`, background: color }} />
                    </div>
                    <span className="tg-bar-label">
                      {primary.assignment.project} · day {primary.dayX} of ~{primary.estY} · {primary.assignment.percent}%
                    </span>
                    {primary.overdue && <span className="tg-overdue-tag">overdue</span>}
                    {editMode && (
                      <AssignmentEditor
                        a={primary.assignment}
                        onChange={(patch) => updateAssignment(primary.assignment.id, patch)}
                        onDelete={() => deleteAssignment(primary.assignment.id, primary.assignment.project)}
                      />
                    )}
                  </div>
                )}

                {secondary && (
                  <div
                    className={`tg-bar tg-queued${editMode ? " tg-editing" : ""}`}
                    style={{ gridColumn: `${secondary.colStart + 2} / ${secondary.colEnd + 2}`, gridRow: queuedRow, borderColor: color, color }}
                  >
                    <span className="tg-bar-label">NEXT: {secondary.assignment.project} · starts {secondary.startLabel}</span>
                    {editMode && (
                      <AssignmentEditor
                        a={secondary.assignment}
                        onChange={(patch) => updateAssignment(secondary.assignment.id, patch)}
                        onDelete={() => deleteAssignment(secondary.assignment.id, secondary.assignment.project)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- scoped styles ---------------- */

function Style() {
  return (
    <style>{`
      .tg-wrap{max-width:1500px;margin:0 auto;padding:8px 24px 64px}
      .tg-loading{padding:60px 0;text-align:center;color:var(--muted)}
      .tg-error{color:var(--danger);margin-bottom:14px;padding:10px 14px}

      .tg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:16px}
      .tg-eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
      .tg-title{font-size:28px;font-weight:800;margin:6px 0 0;letter-spacing:-.01em}
      .tg-subtitle{font-size:12px;color:var(--muted);margin-top:6px}
      .tg-back{display:inline-block;margin-top:10px;font-size:12px;color:var(--muted);text-decoration:none}
      .tg-back:hover{color:var(--accent1)}
      .tg-controls{display:flex;align-items:center;gap:8px}
      .tg-btn{padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
      .tg-btn.on{background:var(--accent1);color:#06091a;border-color:var(--accent1)}
      .tg-icon-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px}
      .tg-toast{margin-top:12px;padding:8px 14px;border-radius:8px;background:rgba(34,197,94,.12);color:var(--success);font-size:12.5px;font-weight:600}

      .tg-legend{display:flex;gap:20px;flex-wrap:wrap;margin:18px 0;font-size:11px;color:var(--muted)}
      .tg-legend span{display:flex;align-items:center;gap:6px}
      .tg-legend .sw{width:20px;height:10px;border-radius:3px;display:inline-block}
      .tg-legend .sw.solid{background:var(--accent1)}
      .tg-legend .sw.dash{border:1.5px dashed var(--muted)}
      .tg-legend .sw.red{border:1.5px dashed var(--danger)}
      .tg-legend .sw.amber{border:1.5px solid var(--warning)}

      .tg-scroll{overflow-x:auto;padding-bottom:8px}
      .tg-grid{display:grid;position:relative;min-width:1100px}

      .tg-name-header{position:sticky;left:0;background:var(--bg);z-index:3;display:flex;align-items:flex-end;padding:4px 8px 4px 0;font-size:10px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
      .tg-week-cell{font-size:11px;font-weight:600;color:var(--muted);padding:4px 6px;border-bottom:1px solid var(--border);display:flex;align-items:center}
      .tg-day-cell{position:relative;z-index:0;font-size:10px;color:var(--muted);text-align:center;padding:3px 0;border-bottom:1px solid var(--border);pointer-events:none}
      .tg-day-cell.weekend{color:var(--text);opacity:.5}
      .tg-weekend-col{position:relative;background:rgba(120,120,140,.08);pointer-events:none;z-index:0}
      .tg-today-col{position:relative;pointer-events:none;z-index:1}
      .tg-today-line{position:absolute;left:50%;top:0;bottom:0;width:2px;background:var(--success);transform:translateX(-50%);pointer-events:none;z-index:1}

      .tg-name-row{position:sticky;left:0;background:var(--bg);z-index:3;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px 6px 0;border-bottom:1px solid var(--border)}
      .tg-dot{width:9px;height:9px;border-radius:50%;flex:none}
      .tg-eng-name{font-size:13px;font-weight:600;white-space:nowrap}
      .tg-add-btn{margin-left:auto;font-size:10.5px;font-weight:600;color:var(--accent1);background:none;border:1px solid var(--border);border-radius:7px;padding:2px 8px;cursor:pointer;font-family:inherit;position:relative;z-index:2}

      .tg-bar{position:relative;z-index:2;align-self:center;min-height:26px;border-radius:6px;display:flex;align-items:center;padding:0 8px;font-size:11px;font-weight:600;overflow:hidden;border:1px solid transparent}
      .tg-bar.tg-editing{position:relative;z-index:5;flex-direction:column;align-items:flex-start;padding:6px 8px;overflow:visible;min-height:auto}
      .tg-bar-fillwrap{position:absolute;inset:0;display:flex}
      .tg-bar-fill{height:100%}
      .tg-bar-rest{height:100%;opacity:.25}
      .tg-bar-label{position:relative;z-index:1;color:#06091a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tg-active .tg-bar-label{color:#06091a}
      .tg-active.tg-overdue{outline:2px solid var(--warning);outline-offset:1px}
      .tg-overdue-tag{position:relative;z-index:1;margin-left:8px;font-size:9.5px;background:var(--warning);color:#06091a;border-radius:8px;padding:1px 7px}
      .tg-continuous{border:1px solid var(--border)}
      .tg-continuous .tg-bar-label{color:var(--text)}
      .tg-idle{background:rgba(239,68,68,.08);border:1.5px dashed var(--danger);color:var(--danger)}
      .tg-idle .tg-bar-label{color:var(--danger)}
      .tg-queued{background:transparent;border:1.5px dashed var(--muted)}
      .tg-queued .tg-bar-label{color:inherit}

      .tg-editor{position:relative;z-index:10;display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
      .tg-editor input,.tg-editor button{position:relative;z-index:10}
      .tg-editor input{font-family:inherit;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px}
      .tg-e-project{width:120px}
      .tg-e-est{width:44px}
      .tg-e-date{width:120px}
      .tg-e-percent{display:flex;align-items:center;gap:4px;font-size:11px}
      .tg-e-percent button{width:18px;height:18px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:11px;line-height:1}
      .tg-e-status{display:flex;gap:2px}
      .tg-e-status button{width:20px;height:20px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;font-size:10px;font-weight:700}
      .tg-e-status button.on{background:var(--accent1);color:#06091a;border-color:var(--accent1)}
      .tg-e-del{width:20px;height:20px;border-radius:5px;border:1px solid var(--danger);background:none;color:var(--danger);cursor:pointer;font-size:10px}

      @media(max-width:900px){
        .tg-wrap{padding:8px 12px 64px}
      }
    `}</style>
  );
}
