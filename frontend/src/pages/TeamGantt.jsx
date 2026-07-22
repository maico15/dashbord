import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
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

/** Single source of truth for date <-> day-column conversion. Accepts a Date
 *  object or an ISO "yyyy-mm-dd" string, always parsed as a LOCAL date (never
 *  `new Date("yyyy-mm-dd")`, which is UTC and shifts the column by a timezone
 *  offset) — used for bar placement, the today line, and drag math alike. */
function dateToCol(dateOrIso, rangeStart) {
  const d = typeof dateOrIso === "string" ? parseISODate(dateOrIso) : dateOrIso;
  return Math.round((d - rangeStart) / 86400000);
}
function colToDate(col, rangeStart) {
  return addDays(rangeStart, col);
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
      const rawStart = dateToCol(start, rangeStart);
      const rawEnd = dateToCol(end, rangeStart) + 1;
      primary = {
        kind: "active",
        assignment: active,
        colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
        colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
        rawStart, rawEnd,
        startDate: toISODate(start),
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
      const rawStart = dateToCol(qStart, rangeStart);
      const rawEnd = dateToCol(qEnd, rangeStart) + 1;
      secondary = {
        kind: "queued",
        assignment: queued,
        colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
        colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
        rawStart, rawEnd,
        startLabel: toISODate(qStart),
      };
    }

    return { engineer: eng, primaryRow, queuedRow, primary, secondary };
  });
  return { lanes, totalRows: rowCursor - 1 };
}

/* ---------------- dependency arrows ---------------- */

/** Rounded finish-to-start elbow: short stub out of the predecessor, vertical
 *  segment, short stub into the dependent. Coordinates are relative to the
 *  grid container (measured via getBoundingClientRect, not grid math, since
 *  grid columns are responsive `minmax(28px,1fr)` widths). */
function elbowPath(x1, y1, x2, y2) {
  if (Math.abs(y2 - y1) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const gap = x2 - x1;
  const bendX = x1 + Math.max(4, Math.min(12, gap / 2));
  const r = 4;
  const dirX = gap >= 0 ? 1 : -1;
  const dirY = y2 >= y1 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `L ${bendX - dirX * r} ${y1}`,
    `Q ${bendX} ${y1} ${bendX} ${y1 + dirY * r}`,
    `L ${bendX} ${y2 - dirY * r}`,
    `Q ${bendX} ${y2} ${bendX + dirX * r} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(" ");
}

/** Soft scheduling check: does this assignment start before its predecessor
 *  ends? effectiveStartDate is start_date for active bars, or the effective
 *  (explicit or computed-fallback) start for queued bars. */
function dependencyWarning(assignment, assignmentsById, effectiveStartDate) {
  if (!assignment.depends_on) return null;
  const pred = assignmentsById[assignment.depends_on];
  if (!pred || !pred.start_date) return null;
  const predStart = parseISODate(pred.start_date);
  const predEnd = nthWorkingDay(predStart, pred.est_days);
  const thisStart = parseISODate(effectiveStartDate);
  if (thisStart && thisStart < predEnd) {
    return { predEnd, predProject: pred.project || "Untitled" };
  }
  return null;
}

/* ---------------- inline edit controls ---------------- */

function AssignmentEditor({ a, hidePercentEst, onChange, onDelete, predecessorLabel, onStartLink, linking, snapWarning, onSnap }) {
  return (
    <div className="tg-editor" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
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
          key={a.est_days /* force refresh after a resize-drag PUTs a new est_days */}
          type="number" min="1" className="tg-e-est"
          defaultValue={a.est_days}
          onBlur={(e) => {
            const v = parseInt(e.target.value);
            if (v && v !== a.est_days) onChange({ est_days: v });
          }}
        />
      )}
      <input
        key={a.start_date /* force refresh after a move-drag PUTs a new start_date */}
        type="date" className="tg-e-date"
        defaultValue={a.start_date}
        onChange={(e) => e.target.value && onChange({ start_date: e.target.value })}
      />
      {a.status === "queued" && (
        <input
          key={a.queue_start /* force refresh after a move-drag PUTs a new queue_start */}
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
      <div className="tg-e-depends">
        <span className="tg-e-depends-label">Depends on:</span>
        {a.depends_on ? (
          <>
            <span className="tg-e-depends-name">{predecessorLabel || `#${a.depends_on}`}</span>
            <button onClick={() => onChange({ depends_on: null })} title="Clear dependency">×</button>
          </>
        ) : linking ? (
          <span className="tg-e-depends-hint">Click the predecessor bar… (Esc to cancel)</span>
        ) : (
          <button onClick={onStartLink} title="Link to a predecessor">🔗 Link</button>
        )}
      </div>
      {snapWarning && (
        <div className="tg-e-snap-warn">
          <span>⚠ starts before "{snapWarning.predProject}" ends</span>
          <button onClick={onSnap}>Snap to predecessor end</button>
        </div>
      )}
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
  const pwRef = useRef(""); // read from stable-closure window listeners (drag) — never stale
  const [pwError, setPwError] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const dragRef = useRef(null);
  const [dragVisual, setDragVisual] = useState(null); // mirrors dragRef to trigger re-render for the live preview
  const [manageOpen, setManageOpen] = useState(false);
  const [pendingHideId, setPendingHideId] = useState(null); // engineer awaiting second-click confirm to hide
  const gridRef = useRef(null);
  const barRefs = useRef({}); // assignmentId -> bar DOM node, for arrow measurement
  const [arrows, setArrows] = useState([]);
  const [hoveredId, setHoveredId] = useState(null);
  const [linkingFor, setLinkingFor] = useState(null); // assignmentId currently picking a predecessor

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const rangeStart = useMemo(() => addDays(startOfWeekMonday(today), -7), [today]);
  const days = useMemo(() => Array.from({ length: DAY_COLS }, (_, i) => addDays(rangeStart, i)), [rangeStart]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => days[i * 7]), [days]);
  const todayIdx = dateToCol(today, rangeStart);

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
    if (pwRef.current) return pwRef.current;
    const entered = window.prompt("Admin password:");
    if (entered) { pwRef.current = entered; setPwError("") }
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

  async function setVisibility(engineerId, hidden) {
    const p = ensurePassword();
    if (!p) return;
    try {
      await api.post("/gantt/visibility", { engineer_id: engineerId, hidden }, p);
      setPwError("");
      await load();
    } catch (err) {
      setPwError(err.message || "Visibility update failed — check the admin password");
    }
  }

  /* ---------------- drag / resize (edit mode only) ---------------- */

  function beginDrag(e, kind, assignment, isQueued, colStart, colEnd, baseStartDate) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const barEl = e.currentTarget.closest(".tg-bar");
    const rect = barEl.getBoundingClientRect();
    const cols = Math.max(1, colEnd - colStart);
    const info = {
      kind, // "move" | "resize"
      assignmentId: assignment.id,
      isQueued,
      baseStartDate, // ISO string — the assignment's true start (or effective queue start)
      colStart,
      colEnd,
      startClientX: e.clientX,
      pxPerDay: rect.width / cols,
      deltaCols: 0,
    };
    dragRef.current = info;
    setDragVisual({ ...info });
    document.body.style.userSelect = "none";
  }

  async function finalizeDrag(info) {
    if (info.deltaCols === 0) return;
    const patch = {};
    if (info.kind === "move") {
      const newStart = toISODate(addDays(parseISODate(info.baseStartDate), info.deltaCols));
      if (info.isQueued) patch.queue_start = newStart;
      else patch.start_date = newStart;
    } else {
      const newEndCol = info.colEnd + info.deltaCols;
      const newEndDate = colToDate(Math.max(info.colStart, newEndCol) - 1, rangeStart);
      const startDate = parseISODate(info.baseStartDate);
      patch.est_days = Math.max(1, workingDaysElapsed(startDate, newEndDate));
    }
    await updateAssignment(info.assignmentId, patch);
  }

  useEffect(() => {
    function onMouseMove(e) {
      const d = dragRef.current;
      if (!d) return;
      const deltaCols = Math.round((e.clientX - d.startClientX) / d.pxPerDay);
      if (deltaCols !== d.deltaCols) {
        d.deltaCols = deltaCols;
        setDragVisual({ ...d });
      }
    }
    async function onMouseUp() {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      await finalizeDrag(d);
      setDragVisual(null);
    }
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      if (dragRef.current) {
        dragRef.current = null;
        setDragVisual(null);
        document.body.style.userSelect = "";
      }
      setLinkingFor(null);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const sortedEngineers = useMemo(() => {
    return [...(data.engineers || [])].sort((a, b) => {
      const diff = (aiMap[b.id] || 0) - (aiMap[a.id] || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [data.engineers, aiMap]);

  // Viewers never see hidden lanes; edit mode shows everything so the admin
  // keeps full context while managing visibility.
  const boardEngineers = useMemo(
    () => (editMode ? sortedEngineers : sortedEngineers.filter((e) => !e.hidden)),
    [sortedEngineers, editMode]
  );

  const { lanes, totalRows } = useMemo(
    () => buildLanes(boardEngineers, rangeStart, today),
    [boardEngineers, rangeStart, today]
  );

  const lastUpdated = useMemo(() => {
    let max = null;
    for (const e of data.engineers || [])
      for (const a of e.assignments || [])
        if (a.updated_at && (!max || a.updated_at > max)) max = a.updated_at;
    return max;
  }, [data.engineers]);

  const assignmentsById = useMemo(() => {
    const m = {};
    for (const e of data.engineers || [])
      for (const a of e.assignments || []) m[a.id] = a;
    return m;
  }, [data.engineers]);

  // Undirected adjacency over depends_on links, used to find the full connected
  // chain to highlight when hovering any bar in it.
  const depGraph = useMemo(() => {
    const adj = {};
    const addEdge = (x, y) => {
      (adj[x] ||= new Set()).add(y);
      (adj[y] ||= new Set()).add(x);
    };
    for (const a of Object.values(assignmentsById)) if (a.depends_on) addEdge(a.depends_on, a.id);
    return adj;
  }, [assignmentsById]);

  const hoveredChain = useMemo(() => {
    if (hoveredId == null) return new Set();
    const seen = new Set([hoveredId]);
    const queue = [hoveredId];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of depGraph[cur] || []) if (!seen.has(n)) { seen.add(n); queue.push(n) }
    }
    return seen;
  }, [hoveredId, depGraph]);

  function recomputeArrows() {
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const gridRect = gridEl.getBoundingClientRect();
    const next = [];
    for (const a of Object.values(assignmentsById)) {
      if (!a.depends_on) continue;
      const fromEl = barRefs.current[a.depends_on];
      const toEl = barRefs.current[a.id];
      if (!fromEl || !toEl) continue; // predecessor/dependent lane hidden or not rendered
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const x1 = fromRect.right - gridRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - gridRect.top;
      const x2 = toRect.left - gridRect.left;
      const y2 = toRect.top + toRect.height / 2 - gridRect.top;
      next.push({ key: `${a.depends_on}-${a.id}`, from: a.depends_on, to: a.id, path: elbowPath(x1, y1, x2, y2) });
    }
    setArrows(next);
  }

  useLayoutEffect(() => { recomputeArrows() }, [data, dragVisual, editMode]);
  useEffect(() => {
    function onResize() { recomputeArrows() }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [data]);

  const gridTemplateRows = `28px 24px ${Array(Math.max(0, totalRows - 2)).fill("minmax(40px,auto)").join(" ")}`;

  const setBarRef = (id) => (el) => {
    if (el) barRefs.current[id] = el;
    else delete barRefs.current[id];
  };

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
          {editMode && (
            <button className="tg-btn" onClick={() => setManageOpen(true)}>👥 Manage engineers</button>
          )}
          <button
            className={`tg-btn${editMode ? " on" : ""}`}
            onClick={() => {
              if (editMode) { setEditMode(false); setManageOpen(false); setPendingHideId(null); setLinkingFor(null) }
              else enableEdit();
            }}
          >
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

      {linkingFor != null && (
        <div className="tg-toast tg-toast-link">
          🔗 Click the predecessor bar… (Escape to cancel)
        </div>
      )}

      {manageOpen && (
        <div
          className="tg-modal-backdrop"
          onClick={() => { setManageOpen(false); setPendingHideId(null) }}
        >
          <div className="card tg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tg-modal-head">
              <h2>Manage engineers</h2>
              <button
                className="tg-icon-btn"
                onClick={() => { setManageOpen(false); setPendingHideId(null) }}
              >✕</button>
            </div>
            <div className="tg-modal-list">
              {(data.engineers || []).map((eng) => {
                const activeOrQueuedCount = (eng.assignments || [])
                  .filter((a) => a.status === "active" || a.status === "queued").length;
                const pending = pendingHideId === eng.id;
                return (
                  <div key={eng.id} className={`tg-modal-row${eng.hidden ? " tg-modal-row-hidden" : ""}`}>
                    <span className="tg-dot" style={{ background: eng.avatar_color || eng.color || "var(--accent1)" }} />
                    <span className="tg-modal-name">{eng.name}</span>
                    {eng.hidden ? (
                      <button className="tg-btn tg-modal-action" onClick={() => setVisibility(eng.id, false)}>
                        + Add to board
                      </button>
                    ) : pending ? (
                      <div className="tg-modal-confirm">
                        <span className="tg-modal-warning">
                          Has {activeOrQueuedCount} assignment{activeOrQueuedCount === 1 ? "" : "s"} — they will be
                          hidden with the lane, not deleted
                        </span>
                        <button
                          className="tg-btn tg-modal-action warn"
                          onClick={() => { setVisibility(eng.id, true); setPendingHideId(null) }}
                        >Confirm remove</button>
                        <button className="tg-btn tg-modal-action" onClick={() => setPendingHideId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        className="tg-btn tg-modal-action"
                        onClick={() => {
                          if (activeOrQueuedCount > 0) setPendingHideId(eng.id);
                          else setVisibility(eng.id, true);
                        }}
                      >− Remove from board</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="tg-modal-hint">
              New team members are added in the main dashboard's Admin → Team panel and appear here automatically.
            </div>
          </div>
        </div>
      )}

      <div className="tg-scroll">
        <div
          ref={gridRef}
          className="tg-grid"
          style={{ gridTemplateColumns: `200px repeat(${DAY_COLS}, minmax(28px,1fr))`, gridTemplateRows }}
        >
          <svg className="tg-arrows" overflow="visible">
            <defs>
              <marker id="tg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
              </marker>
              <marker id="tg-arrowhead-hi" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent1)" />
              </marker>
            </defs>
            {arrows.map((arr) => {
              const hi = hoveredChain.has(arr.from) && hoveredChain.has(arr.to);
              return (
                <path
                  key={arr.key}
                  d={arr.path}
                  fill="none"
                  stroke={hi ? "var(--accent1)" : "var(--muted)"}
                  strokeWidth={hi ? 2 : 1.5}
                  markerEnd={hi ? "url(#tg-arrowhead-hi)" : "url(#tg-arrowhead)"}
                />
              );
            })}
          </svg>

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

            const activeDrag = primary.kind === "active" && dragVisual?.assignmentId === primary.assignment.id ? dragVisual : null;
            const activeCols = activeDrag
              ? activeDrag.kind === "move"
                ? { colStart: primary.colStart + activeDrag.deltaCols, colEnd: primary.colEnd + activeDrag.deltaCols }
                : { colStart: primary.colStart, colEnd: Math.max(primary.colStart + 1, primary.colEnd + activeDrag.deltaCols) }
              : primary.kind === "active" ? { colStart: primary.colStart, colEnd: primary.colEnd } : null;

            const queuedDrag = secondary && dragVisual?.assignmentId === secondary.assignment.id ? dragVisual : null;
            const queuedCols = queuedDrag
              ? queuedDrag.kind === "move"
                ? { colStart: secondary.colStart + queuedDrag.deltaCols, colEnd: secondary.colEnd + queuedDrag.deltaCols }
                : { colStart: secondary.colStart, colEnd: Math.max(secondary.colStart + 1, secondary.colEnd + queuedDrag.deltaCols) }
              : secondary ? { colStart: secondary.colStart, colEnd: secondary.colEnd } : null;

            const activeWarn = primary.kind === "active"
              ? dependencyWarning(primary.assignment, assignmentsById, primary.assignment.start_date) : null;
            const queuedWarn = secondary
              ? dependencyWarning(secondary.assignment, assignmentsById, secondary.startLabel) : null;
            const activePredLabel = primary.kind === "active" && primary.assignment.depends_on
              ? (assignmentsById[primary.assignment.depends_on]?.project || null) : null;
            const queuedPredLabel = secondary && secondary.assignment.depends_on
              ? (assignmentsById[secondary.assignment.depends_on]?.project || null) : null;

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
                    <span className="tg-bar-label">{primary.assignment.project || "Untitled"} · continuous</span>
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
                    ref={setBarRef(primary.assignment.id)}
                    className={`tg-bar tg-active${primary.overdue ? " tg-overdue" : ""}${editMode ? " tg-editing tg-draggable" : ""}${activeDrag ? " tg-dragging" : ""}`}
                    style={{ gridColumn: `${activeCols.colStart + 2} / ${activeCols.colEnd + 2}`, gridRow: primaryRow }}
                    onMouseDown={editMode && linkingFor == null ? (e) => beginDrag(e, "move", primary.assignment, false, primary.colStart, primary.colEnd, primary.startDate) : undefined}
                    onClick={editMode && linkingFor != null ? (e) => {
                      e.stopPropagation();
                      if (linkingFor !== primary.assignment.id) updateAssignment(linkingFor, { depends_on: primary.assignment.id });
                      setLinkingFor(null);
                    } : undefined}
                    onMouseEnter={() => setHoveredId(primary.assignment.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === primary.assignment.id ? null : h))}
                  >
                    <div className="tg-bar-fillwrap">
                      <div className="tg-bar-fill" style={{ width: `${primary.assignment.percent}%`, background: color }} />
                      <div className="tg-bar-rest" style={{ width: `${100 - primary.assignment.percent}%`, background: color }} />
                    </div>
                    <span className="tg-bar-label">
                      {primary.assignment.project || "Untitled"} · day {primary.dayX} of ~{primary.estY} · {primary.assignment.percent}%
                    </span>
                    {primary.overdue && <span className="tg-overdue-tag">overdue</span>}
                    {activeWarn && (
                      <span className="tg-dep-warn" title={`Starts before "${activeWarn.predProject}" ends`}>⚠</span>
                    )}
                    {editMode && (
                      <div
                        className="tg-bar-resize"
                        onMouseDown={(e) => beginDrag(e, "resize", primary.assignment, false, primary.colStart, primary.colEnd, primary.startDate)}
                      />
                    )}
                    {editMode && (
                      <AssignmentEditor
                        a={primary.assignment}
                        onChange={(patch) => updateAssignment(primary.assignment.id, patch)}
                        onDelete={() => deleteAssignment(primary.assignment.id, primary.assignment.project)}
                        predecessorLabel={activePredLabel}
                        onStartLink={() => setLinkingFor(primary.assignment.id)}
                        linking={linkingFor === primary.assignment.id}
                        snapWarning={activeWarn}
                        onSnap={() => activeWarn && updateAssignment(primary.assignment.id, {
                          start_date: toISODate(addDays(activeWarn.predEnd, 1)),
                        })}
                      />
                    )}
                  </div>
                )}

                {secondary && (
                  <div
                    ref={setBarRef(secondary.assignment.id)}
                    className={`tg-bar tg-queued${editMode ? " tg-editing tg-draggable" : ""}${queuedDrag ? " tg-dragging" : ""}`}
                    style={{ gridColumn: `${queuedCols.colStart + 2} / ${queuedCols.colEnd + 2}`, gridRow: queuedRow, borderColor: color, color }}
                    onMouseDown={editMode && linkingFor == null ? (e) => beginDrag(e, "move", secondary.assignment, true, secondary.colStart, secondary.colEnd, secondary.startLabel) : undefined}
                    onClick={editMode && linkingFor != null ? (e) => {
                      e.stopPropagation();
                      if (linkingFor !== secondary.assignment.id) updateAssignment(linkingFor, { depends_on: secondary.assignment.id });
                      setLinkingFor(null);
                    } : undefined}
                    onMouseEnter={() => setHoveredId(secondary.assignment.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === secondary.assignment.id ? null : h))}
                  >
                    <span className="tg-bar-label">NEXT: {secondary.assignment.project || "Untitled"} · starts {secondary.startLabel}</span>
                    {queuedWarn && (
                      <span className="tg-dep-warn" title={`Starts before "${queuedWarn.predProject}" ends`}>⚠</span>
                    )}
                    {editMode && (
                      <div
                        className="tg-bar-resize"
                        onMouseDown={(e) => beginDrag(e, "resize", secondary.assignment, true, secondary.colStart, secondary.colEnd, secondary.startLabel)}
                      />
                    )}
                    {editMode && (
                      <AssignmentEditor
                        a={secondary.assignment}
                        onChange={(patch) => updateAssignment(secondary.assignment.id, patch)}
                        onDelete={() => deleteAssignment(secondary.assignment.id, secondary.assignment.project)}
                        predecessorLabel={queuedPredLabel}
                        onStartLink={() => setLinkingFor(secondary.assignment.id)}
                        linking={linkingFor === secondary.assignment.id}
                        snapWarning={queuedWarn}
                        onSnap={() => queuedWarn && updateAssignment(secondary.assignment.id, {
                          queue_start: toISODate(addDays(queuedWarn.predEnd, 1)),
                        })}
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
      .tg-toast-link{background:rgba(0,207,255,.12);color:var(--accent1)}

      .tg-legend{display:flex;gap:20px;flex-wrap:wrap;margin:18px 0;font-size:11px;color:var(--muted)}
      .tg-legend span{display:flex;align-items:center;gap:6px}
      .tg-legend .sw{width:20px;height:10px;border-radius:3px;display:inline-block}
      .tg-legend .sw.solid{background:var(--accent1)}
      .tg-legend .sw.dash{border:1.5px dashed var(--muted)}
      .tg-legend .sw.red{border:1.5px dashed var(--danger)}
      .tg-legend .sw.amber{border:1.5px solid var(--warning)}

      .tg-modal-backdrop{position:fixed;inset:0;background:rgba(6,9,26,.55);display:flex;align-items:flex-start;justify-content:center;padding:60px 20px;z-index:50}
      .tg-modal{width:100%;max-width:480px;max-height:70vh;display:flex;flex-direction:column;padding:0;overflow:hidden}
      .tg-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
      .tg-modal-head h2{font-size:15px;font-weight:700;margin:0}
      .tg-modal-list{overflow-y:auto;padding:8px 20px}
      .tg-modal-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}
      .tg-modal-row:last-child{border-bottom:none}
      .tg-modal-row-hidden{opacity:.45}
      .tg-modal-name{font-size:13px;font-weight:600;flex:1}
      .tg-modal-action{font-size:11.5px;padding:5px 12px;white-space:nowrap}
      .tg-modal-action.warn{background:var(--danger);color:#fff;border-color:var(--danger)}
      .tg-modal-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;padding-top:6px}
      .tg-modal-warning{font-size:11px;color:var(--warning);flex:1 1 100%}
      .tg-modal-hint{font-size:11px;color:var(--muted);padding:14px 20px;border-top:1px solid var(--border)}

      .tg-scroll{overflow-x:auto;padding-bottom:8px}
      .tg-grid{display:grid;position:relative;min-width:1100px}
      .tg-arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;overflow:visible}

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
      .tg-bar.tg-draggable{cursor:grab}
      .tg-bar.tg-draggable.tg-dragging{cursor:grabbing}
      .tg-bar-resize{position:absolute;top:0;bottom:0;right:0;width:8px;cursor:col-resize;z-index:11}
      .tg-bar-fillwrap{position:absolute;inset:0;display:flex}
      .tg-bar-fill{height:100%}
      .tg-bar-rest{height:100%;opacity:.25}
      .tg-bar-label{position:relative;z-index:1;color:#06091a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tg-active .tg-bar-label{color:#06091a}
      .tg-active.tg-overdue{outline:2px solid var(--warning);outline-offset:1px}
      .tg-overdue-tag{position:relative;z-index:1;margin-left:8px;font-size:9.5px;background:var(--warning);color:#06091a;border-radius:8px;padding:1px 7px}
      .tg-dep-warn{position:relative;z-index:1;margin-left:6px;font-size:11px;color:var(--warning)}
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

      .tg-e-depends{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);width:100%}
      .tg-e-depends-label{white-space:nowrap}
      .tg-e-depends-name{font-weight:600;color:var(--text)}
      .tg-e-depends button{background:none;border:1px solid var(--border);border-radius:6px;color:var(--accent1);font-size:11px;padding:2px 8px;cursor:pointer;font-family:inherit}
      .tg-e-depends-hint{color:var(--accent1);font-style:italic}
      .tg-e-snap-warn{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;font-size:11px;color:var(--warning);background:rgba(245,158,11,.1);border-radius:6px;padding:4px 8px}
      .tg-e-snap-warn button{background:var(--warning);border:none;border-radius:6px;color:#06091a;font-size:10.5px;font-weight:600;padding:3px 9px;cursor:pointer;font-family:inherit}

      @media(max-width:900px){
        .tg-wrap{padding:8px 12px 64px}
      }
    `}</style>
  );
}
