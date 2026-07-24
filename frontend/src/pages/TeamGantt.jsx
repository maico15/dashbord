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

/* ---------------- lane model ----------------
 * Every assignment gets its own bar — an engineer can have any number of
 * active/queued/continuous rows at once (e.g. two concurrent active tasks,
 * several queued). Bars are never dropped: unparseable ones fall back to a
 * small warning chip instead of vanishing. Overlapping bars (in day-column
 * space) are stacked into sub-rows via greedy interval partitioning. */

function latestActiveEnd(activeAssignments) {
  let end = null;
  for (const a of activeAssignments) {
    const start = parseISODate(a.start_date);
    if (!start) continue;
    const e = nthWorkingDay(start, a.est_days);
    if (!end || e > end) end = e;
  }
  return end;
}

function buildEngineerBars(assignments, rangeStart, today) {
  const bars = [];
  const continuousAssignments = assignments.filter((a) => a.status === "continuous");
  const activeAssignments = assignments.filter((a) => a.status === "active");
  const queuedAssignments = assignments.filter((a) => a.status === "queued");
  const doneAssignments = assignments.filter((a) => a.status === "done");
  const otherAssignments = assignments.filter(
    (a) => !["continuous", "active", "queued", "done"].includes(a.status)
  );
  // "done" never counts as an engineer's active load — only a real 'active' row
  // blocks a new assignment from landing as active (see assign_backlog_item).
  const fallbackQueueAnchor = latestActiveEnd(activeAssignments);

  for (const a of continuousAssignments) {
    bars.push({ kind: "continuous", assignment: a, colStart: 0, colEnd: DAY_COLS });
  }

  for (const a of doneAssignments) {
    const start = parseISODate(a.start_date);
    if (!start) {
      bars.push({ kind: "error", assignment: a, reason: "Missing or invalid start date" });
      continue;
    }
    const end = nthWorkingDay(start, a.est_days);
    const rawStart = dateToCol(start, rangeStart);
    const rawEnd = dateToCol(end, rangeStart) + 1;
    bars.push({
      kind: "done",
      assignment: a,
      colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
      colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
      rawStart, rawEnd,
      startDate: toISODate(start),
    });
  }

  for (const a of activeAssignments) {
    const start = parseISODate(a.start_date);
    if (!start) {
      bars.push({ kind: "error", assignment: a, reason: "Missing or invalid start date" });
      continue;
    }
    const end = nthWorkingDay(start, a.est_days);
    const elapsed = Math.max(1, workingDaysElapsed(start, today));
    const overdue = today > end && a.percent < 100;
    const rawStart = dateToCol(start, rangeStart);
    const rawEnd = dateToCol(end, rangeStart) + 1;
    bars.push({
      kind: "active",
      assignment: a,
      // clamped so a bar with a start/end outside the visible window still
      // shows at the nearest edge — never hidden just because it's off-screen
      colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
      colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
      rawStart, rawEnd,
      startDate: toISODate(start),
      dayX: elapsed > a.est_days ? `${a.est_days}+` : String(elapsed),
      estY: a.est_days,
      overdue,
      future: start > today,
    });
  }

  for (const a of queuedAssignments) {
    const qStart = a.queue_start
      ? parseISODate(a.queue_start)
      : fallbackQueueAnchor
        ? addDays(fallbackQueueAnchor, 1)
        : today;
    if (!qStart) {
      bars.push({ kind: "error", assignment: a, reason: "Missing or invalid queue start date" });
      continue;
    }
    const qEnd = nthWorkingDay(qStart, a.est_days);
    const rawStart = dateToCol(qStart, rangeStart);
    const rawEnd = dateToCol(qEnd, rangeStart) + 1;
    bars.push({
      kind: "queued",
      assignment: a,
      colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
      colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
      rawStart, rawEnd,
      startLabel: toISODate(qStart),
    });
  }

  for (const a of otherAssignments) {
    bars.push({ kind: "error", assignment: a, reason: `Unrecognized status "${a.status}"` });
  }

  // "Idle" is a placeholder, not an item — shown whenever nothing is currently
  // in progress, even if there are queued items waiting behind it.
  if (continuousAssignments.length === 0 && activeAssignments.length === 0) {
    bars.push({ kind: "idle" });
  }

  // Greedy interval partitioning: sort by start column, place each bar in the
  // first sub-row whose last bar already ended, else open a new sub-row.
  // Full-width bars (continuous/idle) always claim a sub-row alone.
  const stackable = bars.filter((b) => b.kind !== "error");
  const errored = bars.filter((b) => b.kind === "error");
  stackable.sort((a, b) => (a.colStart ?? 0) - (b.colStart ?? 0));
  const subRowEnds = [];
  for (const b of stackable) {
    const colStart = b.colStart ?? 0;
    const colEnd = b.colEnd ?? DAY_COLS;
    const rowIdx = subRowEnds.findIndex((end) => colStart >= end);
    if (rowIdx === -1) {
      b.subRow = subRowEnds.length;
      subRowEnds.push(colEnd);
    } else {
      b.subRow = rowIdx;
      subRowEnds[rowIdx] = colEnd;
    }
  }
  for (const b of errored) {
    b.subRow = subRowEnds.length;
    subRowEnds.push(1);
  }

  return { bars: [...stackable, ...errored], height: Math.max(1, subRowEnds.length) };
}

function buildLanes(engineers, rangeStart, today) {
  let rowCursor = 3; // rows 1-2 are the header
  const lanes = engineers.map((eng) => {
    const assignments = eng.assignments || [];
    const { bars, height } = buildEngineerBars(assignments, rangeStart, today);
    const primaryRow = rowCursor;
    rowCursor += height;

    if (import.meta.env.DEV) {
      const renderedForItems = bars.filter((b) => b.kind !== "idle").length;
      if (renderedForItems !== assignments.length) {
        console.warn(
          `[TeamGantt] ${eng.name}: API returned ${assignments.length} assignment(s) but ${renderedForItems} bar(s) were rendered`
        );
      }
    }

    return { engineer: eng, primaryRow, height, bars };
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

/* ---------------- backlog ---------------- */

function priorityChipClass(priority) {
  switch (priority) {
    case "P0": return "bl-chip-p0";
    case "P1": return "bl-chip-p1";
    case "ENABLER": return "bl-chip-enabler";
    case "GATED": return "bl-chip-gated";
    default: return "bl-chip-p2";
  }
}

function truncateUrl(url, max = 46) {
  if (!url) return "";
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
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
        {["active", "queued", "continuous", "done"].map((s) => (
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

/** One bar within an engineer's lane. Handles every kind buildEngineerBars can
 *  produce — idle placeholder, warning chip for unpositionable items, the
 *  full-width continuous bar, and active/queued (which share drag, dependency
 *  and inline-edit behavior, so they're handled together). */
function GanttBar({
  bar, color, gridRow, editMode, dragVisual, linkingFor, assignmentsById,
  onBeginDrag, onUpdate, onDelete, setLinkingFor, setHoveredId, setBarRef,
}) {
  if (bar.kind === "idle") {
    return (
      <div className="tg-bar tg-idle" style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow }}>
        <span className="tg-bar-label">IDLE — no active project</span>
      </div>
    );
  }

  if (bar.kind === "error") {
    return (
      <div
        className="tg-bar tg-bar-error"
        style={{ gridColumn: "2 / 6", gridRow }}
        title={`${bar.assignment.project || "Untitled"} — ${bar.reason}`}
      >
        <span className="tg-bar-label">⚠ {bar.assignment.project || "Untitled"}</span>
      </div>
    );
  }

  if (bar.kind === "continuous") {
    return (
      <div
        className={`tg-bar tg-continuous${editMode ? " tg-editing" : ""}`}
        style={{ gridColumn: `${bar.colStart + 2} / ${bar.colEnd + 2}`, gridRow, background: `${color}2e` }}
      >
        <span className="tg-bar-label">{bar.assignment.project || "Untitled"} · continuous</span>
        {editMode && (
          <AssignmentEditor
            a={bar.assignment}
            hidePercentEst
            onChange={(patch) => onUpdate(bar.assignment.id, patch)}
            onDelete={() => onDelete(bar.assignment.id, bar.assignment.project)}
          />
        )}
      </div>
    );
  }

  if (bar.kind === "done") {
    // Same position/width a finished active task would have — never hidden,
    // just visually de-emphasized (translucent fill + a leading checkmark).
    return (
      <div
        ref={setBarRef(bar.assignment.id)}
        className={`tg-bar tg-done${editMode ? " tg-editing" : ""}`}
        style={{ gridColumn: `${bar.colStart + 2} / ${bar.colEnd + 2}`, gridRow, background: `${color}73` }}
      >
        <span className="tg-bar-label">✓ {bar.assignment.project || "Untitled"} · done</span>
        {editMode && (
          <AssignmentEditor
            a={bar.assignment}
            onChange={(patch) => onUpdate(bar.assignment.id, patch)}
            onDelete={() => onDelete(bar.assignment.id, bar.assignment.project)}
          />
        )}
      </div>
    );
  }

  // active | queued — share drag/resize, dependency-link and inline editing
  const isQueued = bar.kind === "queued";
  const drag = dragVisual?.assignmentId === bar.assignment.id ? dragVisual : null;
  const cols = drag
    ? drag.kind === "move"
      ? { colStart: bar.colStart + drag.deltaCols, colEnd: bar.colEnd + drag.deltaCols }
      : { colStart: bar.colStart, colEnd: Math.max(bar.colStart + 1, bar.colEnd + drag.deltaCols) }
    : { colStart: bar.colStart, colEnd: bar.colEnd };
  const baseStartDate = isQueued ? bar.startLabel : bar.startDate;
  const warn = dependencyWarning(bar.assignment, assignmentsById, baseStartDate);
  const predLabel = bar.assignment.depends_on
    ? assignmentsById[bar.assignment.depends_on]?.project || null
    : null;

  return (
    <div
      ref={setBarRef(bar.assignment.id)}
      className={
        isQueued
          ? `tg-bar tg-queued${editMode ? " tg-editing tg-draggable" : ""}${drag ? " tg-dragging" : ""}`
          : `tg-bar tg-active${bar.overdue ? " tg-overdue" : ""}${editMode ? " tg-editing tg-draggable" : ""}${drag ? " tg-dragging" : ""}`
      }
      style={{
        gridColumn: `${cols.colStart + 2} / ${cols.colEnd + 2}`,
        gridRow,
        ...(isQueued ? { borderColor: color, color } : {}),
      }}
      onMouseDown={editMode && linkingFor == null ? (e) => onBeginDrag(e, "move", bar.assignment, isQueued, bar.colStart, bar.colEnd, baseStartDate) : undefined}
      onClick={editMode && linkingFor != null ? (e) => {
        e.stopPropagation();
        if (linkingFor !== bar.assignment.id) onUpdate(linkingFor, { depends_on: bar.assignment.id });
        setLinkingFor(null);
      } : undefined}
      onMouseEnter={() => setHoveredId(bar.assignment.id)}
      onMouseLeave={() => setHoveredId((h) => (h === bar.assignment.id ? null : h))}
    >
      {!isQueued && (
        <div className="tg-bar-fillwrap">
          <div className="tg-bar-fill" style={{ width: `${bar.assignment.percent}%`, background: color }} />
          <div className="tg-bar-rest" style={{ width: `${100 - bar.assignment.percent}%`, background: color }} />
        </div>
      )}
      <span className="tg-bar-label">
        {isQueued
          ? `NEXT: ${bar.assignment.project || "Untitled"} · starts ${bar.startLabel}`
          : bar.future
            ? `${bar.assignment.project || "Untitled"} · starts ${bar.startDate} · ${bar.assignment.percent}%`
            : `${bar.assignment.project || "Untitled"} · day ${bar.dayX} of ~${bar.estY} · ${bar.assignment.percent}%`}
      </span>
      {!isQueued && bar.overdue && <span className="tg-overdue-tag">overdue</span>}
      {warn && (
        <span className="tg-dep-warn" title={`Starts before "${warn.predProject}" ends`}>⚠</span>
      )}
      {editMode && (
        <div
          className="tg-bar-resize"
          onMouseDown={(e) => onBeginDrag(e, "resize", bar.assignment, isQueued, bar.colStart, bar.colEnd, baseStartDate)}
        />
      )}
      {editMode && (
        <AssignmentEditor
          a={bar.assignment}
          onChange={(patch) => onUpdate(bar.assignment.id, patch)}
          onDelete={() => onDelete(bar.assignment.id, bar.assignment.project)}
          predecessorLabel={predLabel}
          onStartLink={() => setLinkingFor(bar.assignment.id)}
          linking={linkingFor === bar.assignment.id}
          snapWarning={warn}
          onSnap={() => warn && onUpdate(bar.assignment.id, isQueued
            ? { queue_start: toISODate(addDays(warn.predEnd, 1)) }
            : { start_date: toISODate(addDays(warn.predEnd, 1)) })}
        />
      )}
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

  const [backlog, setBacklog] = useState([]);
  const [backlogSheetUrl, setBacklogSheetUrl] = useState(null);
  const [backlogLastSync, setBacklogLastSync] = useState(null);
  const [backlogDragId, setBacklogDragId] = useState(null); // backlog item.id currently being dragged
  const [backlogOverRow, setBacklogOverRow] = useState(null); // { id, pos: 'above'|'below' } — reorder insertion line
  const [backlogOverEngineer, setBacklogOverEngineer] = useState(null); // engineer id under drag, for lane highlight
  const [backlogToast, setBacklogToast] = useState("");
  const [backlogError, setBacklogError] = useState("");
  const [backlogSyncing, setBacklogSyncing] = useState(false);
  const [editingSheetUrl, setEditingSheetUrl] = useState(false);
  const [sheetUrlInput, setSheetUrlInput] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemPriority, setNewItemPriority] = useState("P2");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // backlog item.id awaiting delete confirm
  const autoScrollRef = useRef(null); // { speed, rafId } while a drag is near a viewport edge

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
      const [gantt, ai, bl] = await Promise.all([
        api.get("/gantt"),
        api.get("/ai-usage/weekly").catch(() => null),
        api.get("/backlog").catch(() => null),
      ]);
      setData(gantt);
      const m = {};
      for (const e of ai?.engineers || []) m[e.id] = e.tokens_output || 0;
      setAiMap(m);
      setBacklog(bl?.items || []);
      setBacklogSheetUrl(bl?.sheet_url || null);
      setBacklogLastSync(bl?.last_sync || null);
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

  /* ---------------- backlog: sheet sync, reorder + drag-to-assign ---------------- */

  // No password — a viewer can always refresh from the already-configured URL.
  async function syncBacklog() {
    setBacklogSyncing(true);
    try {
      const res = await api.post("/backlog/sync");
      setBacklogError("");
      setBacklogToast(
        `Синк: +${res.added} новых, ${res.updated} обновлено, ${res.skipped_retired} уже в работе`
      );
      setTimeout(() => setBacklogToast(""), 6000);
      await load();
    } catch (err) {
      setBacklogError(err.message || "Sync failed");
    } finally {
      setBacklogSyncing(false);
    }
  }

  // Password-protected — changing the source is an admin action.
  async function saveSheetUrl(url) {
    const p = ensurePassword();
    if (!p) return;
    try {
      await api.put("/config", { backlog_sheet_csv_url: url }, p);
      setPwError("");
      setEditingSheetUrl(false);
      await load();
    } catch (err) {
      setPwError(err.message || "Failed to save CSV URL — check the admin password");
    }
  }

  async function createBacklogItem() {
    const title = newItemTitle.trim();
    if (!title) return;
    const p = ensurePassword();
    if (!p) return;
    try {
      await api.post("/backlog", { title, priority: newItemPriority }, p);
      setBacklogError("");
      setNewItemTitle("");
      setAddingItem(false);
      await load();
    } catch (err) {
      setBacklogError(err.message || "Add failed — check the admin password");
    }
  }

  // Edge auto-scroll while dragging a backlog row — reorder targets further
  // down the table, or a lane drop target scrolled out of view above, are
  // otherwise unreachable since the page itself never scrolls on dragover.
  const AUTOSCROLL_EDGE = 80;
  const AUTOSCROLL_MAX_SPEED = 20;

  function updateAutoScroll(clientY) {
    const vh = window.innerHeight;
    let speed = 0;
    if (clientY < AUTOSCROLL_EDGE) {
      speed = -Math.ceil(((AUTOSCROLL_EDGE - clientY) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED);
    } else if (clientY > vh - AUTOSCROLL_EDGE) {
      speed = Math.ceil(((clientY - (vh - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED);
    }
    if (speed === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollRef.current) {
      autoScrollRef.current.speed = speed;
      return;
    }
    const state = { speed, rafId: null };
    const tick = () => {
      if (autoScrollRef.current !== state) return;
      window.scrollBy(0, state.speed);
      state.rafId = requestAnimationFrame(tick);
    };
    autoScrollRef.current = state;
    state.rafId = requestAnimationFrame(tick);
  }

  function stopAutoScroll() {
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current.rafId);
      autoScrollRef.current = null;
    }
  }

  function clearBacklogDrag() {
    setBacklogDragId(null);
    setBacklogOverRow(null);
    setBacklogOverEngineer(null);
    stopAutoScroll();
  }

  async function reorderBacklog(newOrder, previous) {
    setBacklog(newOrder);
    const p = ensurePassword();
    if (!p) { setBacklog(previous); return; }
    try {
      await api.post("/backlog/reorder", { ordered_ids: newOrder.map((b) => b.id) }, p);
      setBacklogError("");
    } catch (err) {
      setBacklog(previous);
      setBacklogError(err.message || "Reorder failed — check the admin password");
    }
  }

  function handleBacklogRowDragStart(e, itemId) {
    if (!editMode) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(itemId));
    setBacklogDragId(itemId);
  }

  function handleBacklogRowDragOver(e, itemId) {
    if (!editMode || backlogDragId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    updateAutoScroll(e.clientY);
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY - rect.top < rect.height / 2 ? "above" : "below";
    setBacklogOverRow((prev) => (prev && prev.id === itemId && prev.pos === pos ? prev : { id: itemId, pos }));
  }

  function handleBacklogRowDrop(e, targetId) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const draggingId = backlogDragId;
    const pos = backlogOverRow?.pos || "above";
    clearBacklogDrag();
    if (draggingId == null || draggingId === targetId) return;
    const previous = backlog;
    const next = [...backlog];
    const fromIdx = next.findIndex((b) => b.id === draggingId);
    if (fromIdx === -1) return;
    const [moved] = next.splice(fromIdx, 1);
    let toIdx = next.findIndex((b) => b.id === targetId);
    if (pos === "below") toIdx += 1;
    next.splice(toIdx, 0, moved);
    reorderBacklog(next, previous);
  }

  async function assignBacklogItem(itemId, engineerId, startDateIso) {
    const p = ensurePassword();
    if (!p) return;
    const previous = backlog;
    setBacklog((cur) => cur.filter((b) => b.id !== itemId));
    try {
      const res = await api.post(`/backlog/${itemId}/assign`, { engineer_id: engineerId, start_date: startDateIso }, p);
      setBacklogError("");
      const name = (data.engineers || []).find((e) => e.id === engineerId)?.name || "engineer";
      setBacklogToast(res.status === "queued" ? `В очередь: ${name}` : `Назначено: ${name}`);
      setTimeout(() => setBacklogToast(""), 5000);
      await load();
    } catch (err) {
      setBacklog(previous);
      setBacklogError(err.message || "Assign failed — check the admin password");
    }
  }

  async function deleteBacklogItem(itemId) {
    const p = ensurePassword();
    if (!p) return;
    const previous = backlog;
    setBacklog((cur) => cur.filter((b) => b.id !== itemId));
    setConfirmDeleteId(null);
    try {
      await api.del(`/backlog/${itemId}`, p);
      setBacklogError("");
      setBacklogToast("Удалено (не вернётся при синке)");
      setTimeout(() => setBacklogToast(""), 5000);
    } catch (err) {
      setBacklog(previous);
      setBacklogError(err.message || "Delete failed — check the admin password");
    }
  }

  function handleLaneDrop(e, engineerId) {
    e.preventDefault();
    const draggingId = backlogDragId;
    clearBacklogDrag();
    if (draggingId == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.max(0, Math.min(DAY_COLS - 1, Math.floor(((e.clientX - rect.left) / rect.width) * DAY_COLS)));
    const dropDate = toISODate(colToDate(col, rangeStart));
    assignBacklogItem(draggingId, engineerId, dropDate || toISODate(today));
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
      stopAutoScroll();
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
        <span><i className="sw done" /> ✓ done</span>
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
          {lanes.map(({ engineer: e, primaryRow, height, bars }) => {
            const color = e.avatar_color || e.color || "var(--accent1)";
            const laneRowSpan = `${primaryRow} / ${primaryRow + height}`;

            return (
              <div key={e.id} style={{ display: "contents" }}>
                <div className="tg-name-row" style={{ gridColumn: 1, gridRow: laneRowSpan }}>
                  <span className="tg-dot" style={{ background: color }} />
                  <span className="tg-eng-name">{e.name}</span>
                  {editMode && (
                    <button className="tg-add-btn" onClick={() => addAssignment(e.id)}>+ assignment</button>
                  )}
                </div>

                {editMode && backlogDragId != null && (
                  <div
                    className={`tg-lane-drop${backlogOverEngineer === e.id ? " tg-lane-drop-over" : ""}`}
                    style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow: laneRowSpan }}
                    onDragEnter={(ev) => { ev.preventDefault(); setBacklogOverEngineer(e.id) }}
                    onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; updateAutoScroll(ev.clientY) }}
                    onDragLeave={() => setBacklogOverEngineer((cur) => (cur === e.id ? null : cur))}
                    onDrop={(ev) => handleLaneDrop(ev, e.id)}
                  />
                )}

                {bars.map((bar) => (
                  <GanttBar
                    key={bar.assignment ? bar.assignment.id : "idle"}
                    bar={bar}
                    color={color}
                    gridRow={primaryRow + bar.subRow}
                    editMode={editMode}
                    dragVisual={dragVisual}
                    linkingFor={linkingFor}
                    assignmentsById={assignmentsById}
                    onBeginDrag={beginDrag}
                    onUpdate={updateAssignment}
                    onDelete={deleteAssignment}
                    setLinkingFor={setLinkingFor}
                    setHoveredId={setHoveredId}
                    setBarRef={setBarRef}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bl-section">
        <div className="bl-head-row">
          <h2 className="bl-title">Backlog</h2>
          <span className="bl-count">{backlog.length} item{backlog.length === 1 ? "" : "s"}</span>
          {editMode && (
            <button className="tg-btn" onClick={() => setAddingItem((v) => !v)}>+ item</button>
          )}
          <button className="tg-btn" onClick={syncBacklog} disabled={backlogSyncing}>
            {backlogSyncing ? "⟳ Syncing…" : "⟳ Sync from Sheet"}
          </button>
        </div>

        <div className="bl-source-row">
          <span>источник: Google Sheet</span>
          {editMode && (
            editingSheetUrl ? (
              <>
                <input
                  className="bl-url-input"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/…/pub?output=csv"
                  autoFocus
                />
                <button className="bl-url-btn" onClick={() => saveSheetUrl(sheetUrlInput.trim())}>Save</button>
                <button className="bl-url-btn" onClick={() => setEditingSheetUrl(false)}>Cancel</button>
              </>
            ) : (
              <>
                <span className="bl-url-display" title={backlogSheetUrl || ""}>
                  {backlogSheetUrl ? truncateUrl(backlogSheetUrl) : "не настроен"}
                </span>
                <button
                  className="bl-url-edit-btn"
                  title="Edit CSV URL"
                  onClick={() => { setSheetUrlInput(backlogSheetUrl || ""); setEditingSheetUrl(true) }}
                >✎</button>
              </>
            )
          )}
          {backlogLastSync && (
            <span className="bl-last-sync">· последний синк {backlogLastSync.slice(0, 16).replace("T", " ")} UTC</span>
          )}
        </div>

        {backlogToast && <div className="tg-toast">{backlogToast}</div>}
        {backlogError && <div className="card tg-error">{backlogError}</div>}

        <div className="bl-table-scroll">
          <table className="bl-table">
            <thead>
              <tr>
                <th className="bl-th-grip" />
                <th className="bl-th-num">#</th>
                <th>Project</th>
                <th>Результат</th>
                <th>Owner</th>
                <th>Приор.</th>
                <th>Статус / старт</th>
                <th>База / источник</th>
                <th>Ист.</th>
                {editMode && <th className="bl-th-assign">Assign</th>}
                {editMode && <th className="bl-th-del" />}
              </tr>
            </thead>
            <tbody>
              {editMode && addingItem && (
                <tr className="bl-row bl-row-add">
                  <td className="bl-td-grip" />
                  <td className="bl-td-num" />
                  <td colSpan={2}>
                    <input
                      className="bl-add-input"
                      placeholder="Project title"
                      value={newItemTitle}
                      onChange={(e) => setNewItemTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createBacklogItem()}
                      autoFocus
                    />
                  </td>
                  <td />
                  <td>
                    <select
                      className="bl-add-select"
                      value={newItemPriority}
                      onChange={(e) => setNewItemPriority(e.target.value)}
                    >
                      {["P0", "P1", "P2", "ENABLER", "GATED"].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td colSpan={5}>
                    <button className="bl-add-btn" onClick={createBacklogItem}>Add</button>
                    <button className="bl-add-btn" onClick={() => { setAddingItem(false); setNewItemTitle("") }}>Cancel</button>
                  </td>
                </tr>
              )}
              {backlog.length === 0 && !addingItem && (
                <tr><td className="bl-empty" colSpan={editMode ? 11 : 9}>Backlog is empty</td></tr>
              )}
              {backlog.map((item, idx) => (
                <tr
                  key={item.id}
                  draggable={editMode}
                  className={`bl-row${backlogDragId === item.id ? " bl-row-dragging" : ""}${
                    backlogOverRow?.id === item.id ? ` bl-row-drop-${backlogOverRow.pos}` : ""
                  }`}
                  onDragStart={(e) => handleBacklogRowDragStart(e, item.id)}
                  onDragOver={(e) => handleBacklogRowDragOver(e, item.id)}
                  onDrop={(e) => handleBacklogRowDrop(e, item.id)}
                  onDragEnd={clearBacklogDrag}
                >
                  <td className="bl-td-grip">{editMode && <span className="bl-grip">⠿</span>}</td>
                  <td className="bl-td-num">{idx + 1}</td>
                  <td className="bl-td-title">{item.title}</td>
                  <td className="bl-td-result">
                    <span className="bl-clamp" title={item.description}>{item.description}</span>
                  </td>
                  <td className="bl-td-owner">{item.owner}</td>
                  <td><span className={`bl-chip ${priorityChipClass(item.priority)}`}>{item.priority}</span></td>
                  <td className="bl-td-status">{item.status}</td>
                  <td className="bl-td-source">{item.source}</td>
                  <td className="bl-ist">{item.origin}</td>
                  {editMode && (
                    <td className="bl-td-assign">
                      <select
                        className="bl-assign-select"
                        value=""
                        onChange={(e) => {
                          const engId = e.target.value;
                          if (engId) assignBacklogItem(item.id, Number(engId), toISODate(today));
                        }}
                      >
                        <option value="">—</option>
                        {(data.engineers || []).map((eng) => (
                          <option key={eng.id} value={eng.id}>{eng.name}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {editMode && (
                    <td className="bl-td-del">
                      {confirmDeleteId === item.id ? (
                        <span className="bl-confirm-del">
                          <span className="bl-confirm-text">точно удалить?</span>
                          <button className="bl-del-btn warn" onClick={() => deleteBacklogItem(item.id)}>Да</button>
                          <button className="bl-del-btn" onClick={() => setConfirmDeleteId(null)}>Нет</button>
                        </span>
                      ) : (
                        <button
                          className="bl-del-btn"
                          title="Delete from backlog"
                          onClick={() => setConfirmDeleteId(item.id)}
                        >×</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
      .tg-legend .sw.done{background:var(--success);opacity:.45}

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
      .tg-done{border:1px solid var(--border)}
      .tg-done .tg-bar-label{color:var(--text)}
      .tg-idle{background:rgba(239,68,68,.08);border:1.5px dashed var(--danger);color:var(--danger)}
      .tg-idle .tg-bar-label{color:var(--danger)}
      .tg-queued{background:transparent;border:1.5px dashed var(--muted)}
      .tg-queued .tg-bar-label{color:inherit}
      .tg-bar-error{background:rgba(245,158,11,.12);border:1.5px solid var(--warning);color:var(--warning);cursor:help;max-width:220px}
      .tg-bar-error .tg-bar-label{color:var(--warning)}

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

      .tg-lane-drop{position:relative;z-index:8;border-radius:6px}
      .tg-lane-drop-over{background:rgba(0,207,255,.14);outline:2px dashed var(--accent1);outline-offset:-2px}

      .bl-section{margin-top:36px}
      .bl-head-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
      .bl-title{font-size:16px;font-weight:800;margin:0;letter-spacing:-.01em}
      .bl-count{font-size:11.5px;color:var(--muted)}
      .bl-source-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:12px}
      .bl-url-display{color:var(--text);font-family:monospace;font-size:10.5px}
      .bl-url-edit-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--accent1);font-size:11px;padding:1px 6px;cursor:pointer;font-family:inherit}
      .bl-url-input{font-family:inherit;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 8px;width:min(360px,60vw)}
      .bl-url-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:2px 8px;cursor:pointer;font-family:inherit}
      .bl-last-sync{white-space:nowrap}

      .bl-table-scroll{overflow-x:auto;max-height:520px;border:1px solid var(--border);border-radius:10px}
      .bl-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:820px}
      .bl-table thead th{position:sticky;top:0;background:var(--card);z-index:2;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
      .bl-table td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
      .bl-table tbody tr:last-child td{border-bottom:none}
      .bl-th-grip,.bl-td-grip{width:20px;padding-right:0}
      .bl-th-num,.bl-td-num{width:28px;color:var(--muted);font-weight:600}
      .bl-td-title{font-weight:600;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}
      .bl-td-result{max-width:280px}
      .bl-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--muted)}
      .bl-td-owner{max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
      .bl-td-status{max-width:160px;color:var(--muted);font-size:11.5px}
      .bl-td-source{max-width:180px;color:var(--muted);font-size:11.5px}
      .bl-ist{font-size:10.5px;color:var(--accent1)}
      .bl-empty{text-align:center;color:var(--muted);padding:24px 0}
      .bl-grip{color:var(--muted);font-size:13px;line-height:1}
      .bl-row[draggable="true"]{cursor:grab}
      .bl-row[draggable="true"]:active{cursor:grabbing}
      .bl-row-dragging{opacity:.4}
      .bl-row-drop-above{box-shadow:inset 0 2px 0 var(--accent1)}
      .bl-row-drop-below{box-shadow:inset 0 -2px 0 var(--accent1)}
      .bl-row-add td{background:rgba(0,207,255,.05)}
      .bl-add-input{font-family:inherit;font-size:12px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:4px 8px;width:100%}
      .bl-add-select{font-family:inherit;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px}
      .bl-add-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:3px 9px;cursor:pointer;font-family:inherit;margin-right:6px}

      .bl-chip{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;letter-spacing:.02em}
      .bl-chip-p0{background:rgba(239,68,68,.14);color:var(--danger)}
      .bl-chip-p1{background:rgba(245,158,11,.14);color:var(--warning)}
      .bl-chip-p2{background:rgba(120,120,140,.16);color:var(--muted)}
      .bl-chip-enabler{background:rgba(0,207,255,.14);color:var(--accent1)}
      .bl-chip-gated{background:rgba(120,120,140,.3);color:var(--text)}

      .bl-th-assign,.bl-td-assign{width:130px}
      .bl-assign-select{font-family:inherit;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px;width:100%}
      .bl-th-del,.bl-td-del{width:24px}
      .bl-del-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--danger);font-size:12px;padding:2px 8px;cursor:pointer;font-family:inherit;line-height:1}
      .bl-del-btn.warn{background:var(--danger);color:#fff;border-color:var(--danger)}
      .bl-confirm-del{display:flex;align-items:center;gap:6px;white-space:nowrap}
      .bl-confirm-text{font-size:10.5px;color:var(--warning)}

      @media(max-width:900px){
        .tg-wrap{padding:8px 12px 64px}
      }
    `}</style>
  );
}
