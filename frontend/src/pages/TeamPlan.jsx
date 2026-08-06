import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useTheme, toggleTheme } from "../hooks/useTheme";

const DAY_COLS = 42;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_COLORS = {
  active: "#00a6d6",
  queued: "#7b8a9f",
  done: "#24a86f",
  continuous: "#7b61ff",
};

/* ---------------- date helpers (local calendar days, no timezone math) ---------------- */

function startOfWeekMonday(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function dateToCol(dateOrIso, rangeStart) {
  const d = typeof dateOrIso === "string" ? parseISODate(dateOrIso) : dateOrIso;
  if (!d) return 0;
  return Math.round((d - rangeStart) / 86400000);
}

function colToDate(col, rangeStart) {
  return addDays(rangeStart, col);
}

function nthWorkingDay(start, n) {
  const target = Math.max(1, Number(n) || 1);
  let d = new Date(start);
  let count = 0;
  let guard = 0;
  while (guard++ < 1000) {
    if (!isWeekend(d)) {
      count += 1;
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

function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const a = `${MONTHS[monday.getMonth()]} ${monday.getDate()}`;
  const b = monday.getMonth() === sunday.getMonth()
    ? `${sunday.getDate()}`
    : `${MONTHS[sunday.getMonth()]} ${sunday.getDate()}`;
  return `${a} - ${b}`;
}

/* ---------------- lane model ----------------
 * Ported from TeamGantt.jsx: every assignment gets its own bar, and bars that
 * overlap in day-column space for the same engineer are stacked into sub-rows
 * via greedy interval partitioning instead of being drawn on top of each
 * other. "Parallel load" (below) is a narrower, additive signal on top of
 * that — only active/queued bars (the engineer's *current* load) are checked
 * for date overlap and offered a "snap after previous" fix; done/continuous
 * bars still get sub-row placement but never raise that warning. */

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
  const continuousAssignments = (assignments || []).filter((a) => a.status === "continuous");
  const activeAssignments = (assignments || []).filter((a) => a.status === "active");
  const queuedAssignments = (assignments || []).filter((a) => a.status === "queued");
  const doneAssignments = (assignments || []).filter((a) => a.status === "done");
  const otherAssignments = (assignments || []).filter(
    (a) => !["continuous", "active", "queued", "done"].includes(a.status)
  );
  const fallbackQueueAnchor = latestActiveEnd(activeAssignments);

  for (const a of continuousAssignments) {
    bars.push({ kind: "continuous", assignment: a, colStart: 0, colEnd: DAY_COLS, color: STATUS_COLORS.continuous });
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
      startDate: toISODate(start),
      endDate: toISODate(end),
      color: STATUS_COLORS.done,
    });
  }

  for (const a of activeAssignments) {
    const start = parseISODate(a.start_date);
    if (!start) {
      bars.push({ kind: "error", assignment: a, reason: "Missing or invalid start date" });
      continue;
    }
    const end = nthWorkingDay(start, a.est_days);
    const overdue = today > end && Number(a.percent || 0) < 100;
    const rawStart = dateToCol(start, rangeStart);
    const rawEnd = dateToCol(end, rangeStart) + 1;
    bars.push({
      kind: "active",
      assignment: a,
      colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
      colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
      startDate: toISODate(start),
      endDate: toISODate(end),
      overdue,
      future: start > today,
      color: STATUS_COLORS.active,
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
      startLabel: toISODate(qStart),
      endDate: toISODate(qEnd),
      color: STATUS_COLORS.queued,
    });
  }

  for (const a of otherAssignments) {
    bars.push({ kind: "error", assignment: a, reason: `Unrecognized status "${a.status}"` });
  }

  if (continuousAssignments.length === 0 && activeAssignments.length === 0) {
    bars.push({ kind: "idle" });
  }

  // "Parallel load": among the engineer's current load (active + queued —
  // done is history, continuous never ends) flag any bar that overlaps
  // another one, and point it at the latest-ending overlapping predecessor
  // so "snap after previous" clears every conflict in one move.
  const loadBars = bars.filter((b) => b.kind === "active" || b.kind === "queued");
  for (const b of loadBars) {
    const overlapping = loadBars.filter((o) => o !== b && o.colStart < b.colEnd && o.colEnd > b.colStart);
    if (!overlapping.length) continue;
    b.parallel = true;
    const predecessors = overlapping.filter((o) => o.colStart <= b.colStart);
    if (predecessors.length) {
      const latest = predecessors.reduce((m, o) => (o.colEnd > m.colEnd ? o : m));
      b.snapAfter = { assignmentId: latest.assignment.id, project: latest.assignment.project, endDate: latest.endDate };
    }
  }

  // Greedy interval partitioning: sort by start column, place each bar in the
  // first sub-row whose last bar already ended, else open a new sub-row.
  // Full-width bars (continuous/idle) always claim a sub-row alone. This is
  // what guarantees two bars for the same engineer never render on top of
  // each other — the engineer's lane grows taller instead.
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
  const lanes = (engineers || []).map((eng) => {
    const assignments = eng.assignments || [];
    const { bars, height } = buildEngineerBars(assignments, rangeStart, today);
    const primaryRow = rowCursor;
    rowCursor += height;
    return { engineer: eng, primaryRow, height, bars };
  });
  return { lanes, totalRows: rowCursor - 1 };
}

function priorityClass(priority) {
  if (priority === "P0") return "tp-priority tp-p0";
  if (priority === "P1") return "tp-priority tp-p1";
  if (priority === "ENABLER") return "tp-priority tp-enabler";
  if (priority === "GATED") return "tp-priority tp-gated";
  return "tp-priority tp-p2";
}

function capacityFor(engineer) {
  const active = (engineer.assignments || []).filter((a) => a.status === "active");
  const queued = (engineer.assignments || []).filter((a) => a.status === "queued");
  const activeDays = active.reduce((sum, a) => sum + (Number(a.est_days) || 0), 0);
  const queuedDays = queued.reduce((sum, a) => sum + (Number(a.est_days) || 0), 0);
  const load = Math.round(((activeDays + queuedDays * 0.45) / 15) * 100);
  return { active: active.length, queued: queued.length, load: Math.min(180, load) };
}

/* ---------------- draft layer ----------------
 * Same model as TeamGantt.jsx: edit mode never writes to the backend
 * directly. Every action pushes a change onto changeQueue instead;
 * computeDraftState replays that queue on top of the last-fetched base
 * snapshot to produce what's actually rendered. Undo pops the last change
 * and re-derives. Only the two change types TeamPlan's edit mode can
 * currently produce are handled here (gantt_update, backlog_assign) — both
 * are part of the same VALID_CHANGE_TYPES set the backend's
 * /api/gantt/apply-changes accepts. */
function computeDraftState(baseEngineers, baseBacklogItems, changeQueue) {
  const engineersById = new Map();
  for (const e of baseEngineers || []) {
    engineersById.set(e.id, { ...e, assignments: (e.assignments || []).map((a) => ({ ...a })) });
  }
  let backlogItems = (baseBacklogItems || []).map((b) => ({ ...b }));

  function findAssignment(id) {
    for (const eng of engineersById.values()) {
      const a = eng.assignments.find((x) => x.id === id);
      if (a) return { eng, a };
    }
    return null;
  }

  for (const ch of changeQueue) {
    switch (ch.type) {
      case "gantt_update": {
        const found = findAssignment(ch.id);
        if (found) Object.assign(found.a, ch.fields, { __pending: true });
        break;
      }
      case "backlog_assign": {
        const item = backlogItems.find((b) => b.id === ch.backlogId);
        if (item) backlogItems = backlogItems.filter((b) => b.id !== ch.backlogId);
        const eng = engineersById.get(ch.engineerId);
        if (eng && item) {
          const hasActive = eng.assignments.some((a) => a.status === "active");
          const status = hasActive ? "queued" : "active";
          eng.assignments.push({
            id: ch.tempId,
            project: item.title,
            est_days: item.est_days || 10,
            percent: 0,
            status,
            queue_start: status === "queued" ? ch.startDate : null,
            start_date: ch.startDate,
            note: "",
            __pending: true,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return { engineers: Array.from(engineersById.values()), backlogItems };
}

function parseApplyChangesError(rawMessage) {
  try {
    const parsed = JSON.parse(rawMessage);
    const detail = parsed.detail;
    if (detail && typeof detail === "object" && "failed_index" in detail) {
      return `Change #${detail.failed_index + 1} was not applied: ${detail.error}`;
    }
    if (typeof detail === "string") return detail;
  } catch {
    // rawMessage wasn't JSON — fall through to the raw text below
  }
  return rawMessage || "Save failed";
}

/* ---------------- one Gantt bar ---------------- */

function PlanBar({ bar, gridRow, editMode, dragVisual, onBeginDrag, onSelect, beginClickTracking, wasRealClick }) {
  if (bar.kind === "idle") {
    return (
      <button className="tp-idle-bar" style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow }} onClick={onSelect}>
        Idle window
      </button>
    );
  }

  if (bar.kind === "error") {
    return (
      <div
        className="tp-bar tp-bar-error"
        style={{ gridColumn: "2 / 6", gridRow }}
        title={`${bar.assignment.project || "Untitled"} — ${bar.reason}`}
        onClick={onSelect}
      >
        <span>⚠ {bar.assignment.project || "Untitled"}</span>
      </div>
    );
  }

  const a = bar.assignment;

  if (bar.kind === "continuous" || bar.kind === "done") {
    return (
      <button
        className={`tp-bar ${bar.kind}`}
        style={{ gridColumn: `${bar.colStart + 2} / ${bar.colEnd + 2}`, gridRow, "--bar-color": bar.color }}
        onMouseDown={beginClickTracking}
        onClick={(e) => wasRealClick(e) && onSelect()}
      >
        <span>{bar.kind === "done" ? "✓ " : ""}{a.project || "Untitled"}</span>
        <small>{bar.kind}</small>
        {a.__pending && <span className="tp-pending-dot" title="Unsaved change" />}
      </button>
    );
  }

  // active | queued — draggable/resizable in edit mode, and the only kinds
  // ever flagged for parallel load.
  const isQueued = bar.kind === "queued";
  const drag = dragVisual?.assignmentId === a.id ? dragVisual : null;
  const cols = drag
    ? drag.kind === "move"
      ? { colStart: bar.colStart + drag.deltaCols, colEnd: bar.colEnd + drag.deltaCols }
      : { colStart: bar.colStart, colEnd: Math.max(bar.colStart + 1, bar.colEnd + drag.deltaCols) }
    : { colStart: bar.colStart, colEnd: bar.colEnd };
  const baseStartDate = isQueued ? bar.startLabel : bar.startDate;

  return (
    <button
      className={
        `tp-bar ${a.status || "active"}` +
        (bar.overdue ? " risk" : "") +
        (bar.parallel ? " parallel" : "") +
        (editMode ? " editing" : "") +
        (drag ? " dragging" : "")
      }
      style={{ gridColumn: `${cols.colStart + 2} / ${cols.colEnd + 2}`, gridRow, "--bar-color": bar.color }}
      onMouseDown={(e) => {
        beginClickTracking(e);
        if (editMode) onBeginDrag(e, "move", a, isQueued, bar.colStart, bar.colEnd, baseStartDate);
      }}
      onClick={(e) => wasRealClick(e) && onSelect()}
    >
      <span>{isQueued ? `NEXT: ${a.project || "Untitled"}` : (a.project || "Untitled")}</span>
      <small>{a.status}{!isQueued ? ` · ${a.percent || 0}%` : ""}</small>
      {bar.parallel && <span className="tp-bar-warn" title="Parallel load — overlaps another assignment for this engineer">⚠</span>}
      {a.__pending && <span className="tp-pending-dot" title="Unsaved change" />}
      {editMode && (
        <span
          className="tp-resize-handle"
          onMouseDown={(e) => onBeginDrag(e, "resize", a, isQueued, bar.colStart, bar.colEnd, baseStartDate)}
          title="Drag to resize estimate"
        />
      )}
    </button>
  );
}

export default function TeamPlan() {
  const theme = useTheme();
  const [data, setData] = useState({ engineers: [] });
  const [backlog, setBacklog] = useState([]);
  const [selection, setSelection] = useState(null); // {type:"assignment"|"backlog"|"engineer", id}
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editMode, setEditMode] = useState(false);
  const [changeQueue, setChangeQueue] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState("");
  const pwRef = useRef(""); // read from stable-closure window listeners (drag) — never stale
  const [pwError, setPwError] = useState("");
  const tempCounterRef = useRef(0);
  const nextTempId = () => `tmp-${++tempCounterRef.current}`;

  const dragRef = useRef(null);
  const [dragVisual, setDragVisual] = useState(null);
  const clickPointerDownRef = useRef(null);
  const ganttRef = useRef(null);
  const backlogRef = useRef(null);
  const capacityRef = useRef(null);
  const risksRef = useRef(null);
  const ganttScrollRef = useRef(null);
  const [activeView, setActiveView] = useState("gantt");

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
      const [gantt, bl] = await Promise.all([
        api.get("/gantt"),
        api.get("/backlog").catch(() => ({ items: [] })),
      ]);
      setData(gantt || { engineers: [] });
      setBacklog(bl?.items || []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load team plan");
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

  function toggleEditMode() {
    if (editMode) {
      if (changeQueue.length > 0 && !window.confirm("You have unsaved changes. Exit without saving?")) return;
      setChangeQueue([]);
      setSaveError(null);
      setEditMode(false);
      setSelection(null);
    } else {
      const p = ensurePassword();
      if (p) setEditMode(true);
    }
  }

  function pushChange(change) {
    setChangeQueue((q) => [...q, change]);
  }

  function updateAssignment(id, patch) {
    pushChange({ type: "gantt_update", id, fields: patch });
  }

  function assignBacklogItem(itemId, engineerId, startDateIso) {
    const tempId = nextTempId();
    const eng = draft.engineers.find((e) => e.id === engineerId);
    const hasActive = eng ? eng.assignments.some((a) => a.status === "active") : false;
    pushChange({ type: "backlog_assign", tempId, backlogId: itemId, engineerId, startDate: startDateIso });
    setToast(eng ? (hasActive ? `Queued for ${eng.name}` : `Assigned to ${eng.name}`) : "Assigned");
    setTimeout(() => setToast(""), 4000);
    setSelection(null);
  }

  function undoChange() {
    setChangeQueue((q) => {
      if (q.length === 0) return q;
      const last = q[q.length - 1];
      if (last.groupId == null) return q.slice(0, -1);
      let i = q.length;
      while (i > 0 && q[i - 1].groupId === last.groupId) i--;
      return q.slice(0, i);
    });
  }

  function discardChanges() {
    if (changeQueue.length === 0) return;
    if (!window.confirm("Discard all unsaved changes?")) return;
    setChangeQueue([]);
    setSaveError(null);
  }

  async function saveChanges() {
    if (changeQueue.length === 0) return;
    const p = ensurePassword();
    if (!p) return;
    setSaving(true);
    try {
      const res = await api.post("/gantt/apply-changes", { changes: changeQueue }, p);
      setSaveError(null);
      setPwError("");
      const count = changeQueue.length;
      setChangeQueue([]);
      setToast(`Saved ${res.applied ?? count} change${(res.applied ?? count) === 1 ? "" : "s"}`);
      setTimeout(() => setToast(""), 5000);
      await load();
    } catch (err) {
      // Queue stays intact on failure — nothing here was committed.
      setSaveError(parseApplyChangesError(err.message));
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- drag / resize (edit mode only) ---------------- */

  function beginDrag(e, kind, assignment, isQueued, colStart, colEnd, baseStartDate) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const barEl = e.currentTarget.closest(".tp-bar");
    const rect = barEl.getBoundingClientRect();
    const cols = Math.max(1, colEnd - colStart);
    const info = {
      kind, // "move" | "resize"
      assignmentId: assignment.id,
      isQueued,
      baseStartDate,
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

  function finalizeDrag(info) {
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
    updateAssignment(info.assignmentId, patch);
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
    function onMouseUp() {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      finalizeDrag(d);
      setDragVisual(null);
    }
    function onKeyDown(e) {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        setDragVisual(null);
        document.body.style.userSelect = "";
        return;
      }
      if (editMode && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        undoChange();
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editMode]);

  // Warn before leaving the page with unsaved draft changes.
  useEffect(() => {
    function handler(e) {
      if (changeQueue.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [changeQueue.length]);

  function beginClickTracking(e) {
    clickPointerDownRef.current = { x: e.clientX, y: e.clientY };
  }

  function wasRealClick(e) {
    const start = clickPointerDownRef.current;
    clickPointerDownRef.current = null;
    if (!start) return true;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    return Math.sqrt(dx * dx + dy * dy) <= 5;
  }

  function scrollToSection(view) {
    setActiveView(view);
    const refMap = {
      gantt: ganttRef,
      backlog: backlogRef,
      capacity: capacityRef,
      risks: risksRef,
    };
    refMap[view]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusToday() {
    scrollToSection("gantt");
    const scroller = ganttScrollRef.current;
    if (!scroller || todayIdx < 0) return;
    const approxColWidth = Math.max(24, (scroller.scrollWidth - 240) / DAY_COLS);
    scroller.scrollTo({
      left: Math.max(0, 240 + todayIdx * approxColWidth - scroller.clientWidth / 2),
      behavior: "smooth",
    });
  }

  function focusPlanning() {
    scrollToSection("backlog");
    if (!editMode) {
      setToast("Enable Edit mode to assign backlog items.");
      setTimeout(() => setToast(""), 4000);
    }
  }

  function applySavedView(view) {
    if (view === "team") {
      setQuery("");
      setTeamFilter("all");
      scrollToSection("gantt");
      return;
    }
    if (view === "risk") {
      setQuery("");
      setTeamFilter("all");
      scrollToSection("risks");
      return;
    }
    if (view === "next") {
      setQuery("");
      setTeamFilter("all");
      focusToday();
      return;
    }
    if (view === "idle") {
      setTeamFilter("all");
      setQuery("");
      scrollToSection("gantt");
      setToast("Idle engineers are shown as dashed red idle windows.");
      setTimeout(() => setToast(""), 4000);
    }
  }

  // The rendered view = last-fetched base data with changeQueue replayed on
  // top. In view mode changeQueue is always empty, so draft === base exactly.
  const draft = useMemo(
    () => computeDraftState(data.engineers, backlog, changeQueue),
    [data.engineers, backlog, changeQueue]
  );

  const boardEngineers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (draft.engineers || [])
      .filter((e) => teamFilter === "all" || e.name === teamFilter)
      .filter((e) => {
        if (!q) return true;
        return `${e.name} ${(e.assignments || []).map((a) => a.project).join(" ")}`.toLowerCase().includes(q);
      });
  }, [draft.engineers, query, teamFilter]);

  const visibleBacklog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (draft.backlogItems || [])
      .filter((b) => !q || `${b.title} ${b.description} ${b.owner}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [draft.backlogItems, query]);

  // Unfiltered lanes drive parallel-load/risk detection and inspector lookups
  // so search/engineer-filter never hides a conflict — only the rendered grid
  // (boardLanes, below) is affected by those filters.
  const { lanes: allLanes } = useMemo(
    () => buildLanes(draft.engineers, rangeStart, today),
    [draft.engineers, rangeStart, today]
  );
  const { lanes: boardLanes, totalRows } = useMemo(
    () => buildLanes(boardEngineers, rangeStart, today),
    [boardEngineers, rangeStart, today]
  );

  const barInfoByAssignmentId = useMemo(() => {
    const m = {};
    for (const { engineer: eng, bars } of allLanes) {
      for (const b of bars) if (b.assignment) m[b.assignment.id] = { bar: b, assignment: b.assignment, engineer: eng };
    }
    return m;
  }, [allLanes]);

  const risks = useMemo(() => {
    const rows = [];
    for (const { engineer: e, bars } of allLanes) {
      const cap = capacityFor(e);
      if (cap.load > 100) rows.push({ type: "capacity", title: e.name, detail: `${cap.load}% planned load` });
      for (const bar of bars) {
        if (bar.kind === "active" && bar.overdue) {
          rows.push({ type: "blocked", title: bar.assignment.project || "Untitled", detail: `${e.name}: overdue since ${bar.endDate}` });
        }
        if (bar.parallel) {
          rows.push({ type: "parallel", title: bar.assignment.project || "Untitled", detail: `${e.name}: parallel load — overlaps another assignment` });
        }
      }
    }
    return rows.slice(0, 6);
  }, [allLanes]);

  const selectedAssignmentInfo = selection?.type === "assignment" ? barInfoByAssignmentId[selection.id] || null : null;
  const selectedBacklogItem = selection?.type === "backlog"
    ? (draft.backlogItems || []).find((b) => b.id === selection.id) || null
    : null;
  const selectedEngineer = selection?.type === "engineer"
    ? (draft.engineers || []).find((e) => e.id === selection.id) || null
    : null;

  return (
    <div className="tp-shell">
      <Style />
      <header className="tp-topbar">
        <div className="tp-brand">
          <div className="tp-logo">TP</div>
          <div>
            <div className="tp-title">Team Plan</div>
            <div className="tp-subtitle">Planning cockpit for Gantt, capacity, and backlog</div>
          </div>
        </div>
        <nav className="tp-tabs" aria-label="Team plan views">
          <button className={`tp-tab${activeView === "gantt" ? " active" : ""}`} onClick={() => scrollToSection("gantt")}>Gantt</button>
          <button className={`tp-tab${activeView === "backlog" ? " active" : ""}`} onClick={() => scrollToSection("backlog")}>Backlog</button>
          <button className={`tp-tab${activeView === "capacity" ? " active" : ""}`} onClick={() => scrollToSection("capacity")}>Capacity</button>
          <button className={`tp-tab${activeView === "risks" ? " active" : ""}`} onClick={() => scrollToSection("risks")}>Risks</button>
        </nav>
        <div className="tp-actions">
          <Link to="/team-gantt" className="tp-link-btn">Old Gantt</Link>
          <Link to="/" className="tp-link-btn">Dashboard</Link>
          {editMode && (
            <>
              <button
                className="tp-link-btn"
                onClick={undoChange}
                disabled={changeQueue.length === 0}
                title="Undo last change (Ctrl+Z)"
              >↶ Undo</button>
              <button
                className="tp-link-btn tp-btn-discard"
                onClick={discardChanges}
                disabled={changeQueue.length === 0}
              >Discard</button>
              <button
                className={`tp-link-btn tp-btn-save${changeQueue.length > 0 ? " on" : ""}`}
                onClick={saveChanges}
                disabled={changeQueue.length === 0 || saving}
              >
                {saving ? "Saving…" : `Save (${changeQueue.length})`}
              </button>
            </>
          )}
          <button className={`tp-link-btn tp-edit-toggle${editMode ? " on" : ""}`} onClick={toggleEditMode}>
            {editMode ? "✓ Editing" : "✎ Edit mode"}
          </button>
          <button className="tp-icon-btn" onClick={toggleTheme} title="Toggle theme">{theme === "dark" ? "L" : "D"}</button>
        </div>
      </header>

      {toast && <div className="tp-toast">{toast}</div>}

      <main className="tp-layout">
        <aside className="tp-sidebar">
          <section className="tp-side-section">
            <div className="tp-section-label">Saved views</div>
            <button className="tp-view active" onClick={() => applySavedView("team")}>Team Plan <span>Current</span></button>
            <button className="tp-view" onClick={() => applySavedView("risk")}>Delivery Risk</button>
            <button className="tp-view" onClick={() => applySavedView("next")}>Next 2 Weeks</button>
            <button className="tp-view" onClick={() => applySavedView("idle")}>Idle Engineers</button>
          </section>

          <section className="tp-side-section">
            <div className="tp-section-label">Filters</div>
            <label className="tp-field">
              <span>Search</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tasks, people..." />
            </label>
            <label className="tp-field">
              <span>Engineer</span>
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="all">All engineers</option>
                {(draft.engineers || []).map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </label>
          </section>

          <section className="tp-side-section">
            <div className="tp-section-label">Signals</div>
            <div className="tp-signal"><b>{draft.engineers?.length || 0}</b><span>engineers</span></div>
            <div className="tp-signal"><b>{draft.backlogItems?.length || 0}</b><span>backlog items</span></div>
            <div className="tp-signal danger"><b>{risks.length}</b><span>open risks</span></div>
          </section>
        </aside>

        <section className="tp-board">
          <div className="tp-board-toolbar" ref={ganttRef}>
            <div>
              <h1>Gantt</h1>
              <p>6-week delivery plan with load and risk visibility</p>
            </div>
            <div className="tp-toolbar-actions">
              <button className="tp-small-btn" disabled title="Current fixed planning window — always shows 6 weeks">6 weeks</button>
              <button className="tp-small-btn" onClick={focusToday}>Today</button>
              <button className="tp-primary-btn" onClick={focusPlanning}>Plan task</button>
            </div>
          </div>

          {loading && <div className="tp-state">Loading team plan...</div>}
          {(error || pwError) && <div className="tp-inline-error">{error || pwError}</div>}
          {saveError && <div className="tp-inline-error">{saveError}</div>}

          {!loading && !error && (
            <div className="tp-gantt" ref={ganttScrollRef}>
              <div
                className="tp-gantt-grid"
                style={{
                  gridTemplateColumns: `240px repeat(${DAY_COLS}, minmax(24px, 1fr))`,
                  gridTemplateRows: `28px 24px ${Array(Math.max(0, totalRows - 2)).fill("minmax(40px,auto)").join(" ")}`,
                }}
              >
                <div className="tp-name-head" style={{ gridColumn: 1, gridRow: "1 / 3" }}>Team / work</div>
                {weeks.map((w) => (
                  <div key={toISODate(w)} className="tp-week-head" style={{ gridColumn: "span 7", gridRow: 1 }}>
                    {weekLabel(w)}
                  </div>
                ))}
                {days.map((d) => (
                  <div key={toISODate(d)} className={`tp-day ${isWeekend(d) ? "weekend" : ""}`} style={{ gridRow: 2 }}>
                    {d.getDate()}
                  </div>
                ))}

                {days.map((d, i) => isWeekend(d) && (
                  <div key={`we-${i}`} className="tp-weekend-col" style={{ gridColumn: i + 2, gridRow: `3 / ${totalRows + 1}` }} />
                ))}

                {todayIdx >= 0 && todayIdx < DAY_COLS && (
                  <div className="tp-today" style={{ gridColumn: todayIdx + 2, gridRow: `1 / ${totalRows + 1}` }}>
                    <span>Today</span>
                  </div>
                )}

                {boardLanes.map(({ engineer: e, primaryRow, height, bars }) => {
                  const cap = capacityFor(e);
                  const laneRowSpan = `${primaryRow} / ${primaryRow + height}`;
                  return (
                    <div className="tp-row-fragment" key={e.id} style={{ display: "contents" }}>
                      <button className="tp-engineer-cell" style={{ gridColumn: 1, gridRow: laneRowSpan }} onClick={() => setSelection({ type: "engineer", id: e.id })}>
                        <span className="tp-avatar" style={{ background: e.color || "var(--accent1)" }}>{e.name?.[0] || "E"}</span>
                        <span className="tp-eng-text">
                          <strong>{e.name}</strong>
                          <small>{cap.active} active, {cap.queued} queued</small>
                        </span>
                        <span className={`tp-load ${cap.load > 100 ? "over" : ""}`}>{cap.load}%</span>
                      </button>
                      <div className="tp-row-bg" style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow: laneRowSpan }} />

                      {bars.map((bar) => (
                        <PlanBar
                          key={bar.assignment ? bar.assignment.id : `idle-${e.id}`}
                          bar={bar}
                          gridRow={primaryRow + (bar.subRow || 0)}
                          editMode={editMode}
                          dragVisual={dragVisual}
                          onBeginDrag={beginDrag}
                          onSelect={() => setSelection(
                            bar.kind === "idle" ? { type: "engineer", id: e.id } : { type: "assignment", id: bar.assignment.id }
                          )}
                          beginClickTracking={beginClickTracking}
                          wasRealClick={wasRealClick}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="tp-backlog" ref={backlogRef}>
            <div className="tp-backlog-head">
              <div>
                <h2>Backlog</h2>
                <p>{draft.backlogItems?.length || 0} items ready for planning</p>
              </div>
              <Link to="/team-gantt" className="tp-link-inline">Edit in old Gantt</Link>
            </div>
            <div className="tp-backlog-table">
              {visibleBacklog.map((item) => (
                <div
                  key={item.id}
                  className="tp-backlog-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelection({ type: "backlog", id: item.id })}
                  onKeyDown={(e) => { if (e.key === "Enter") setSelection({ type: "backlog", id: item.id }) }}
                >
                  <span className={priorityClass(item.priority)}>{item.priority || "P2"}</span>
                  <span className="tp-backlog-title">{item.title}</span>
                  <span>{item.owner || "Unowned"}</span>
                  <span>{item.est_hours ? `${item.est_hours}h` : `${item.est_days || 10}d`}</span>
                  {editMode ? (
                    <span className="tp-assign-cell" onClick={(e) => e.stopPropagation()}>
                      <select
                        className="tp-assign-select"
                        defaultValue=""
                        onChange={(e2) => {
                          const engId = e2.target.value;
                          if (engId) assignBacklogItem(item.id, Number(engId), toISODate(today));
                          e2.target.value = "";
                        }}
                      >
                        <option value="">Assign…</option>
                        {(draft.engineers || []).map((eng) => <option key={eng.id} value={eng.id}>{eng.name}</option>)}
                      </select>
                    </span>
                  ) : (
                    <span className="tp-assign muted" title="Enable Edit mode to assign this item">View only</span>
                  )}
                </div>
              ))}
              {visibleBacklog.length === 0 && <div className="tp-empty">No backlog items match the current filters.</div>}
            </div>
          </div>
        </section>

        <aside className="tp-inspector">
          <section className="tp-panel">
            <div className="tp-panel-head">
              <span>Inspector</span>
              {selection && <button onClick={() => setSelection(null)}>Clear</button>}
            </div>
            {!selection && (
              <div className="tp-muted-box">
                Select a task, backlog item, or engineer to inspect planning details.
              </div>
            )}

            {selectedAssignmentInfo && (() => {
              const { assignment: a, bar, engineer: eng } = selectedAssignmentInfo;
              const hidePercentEst = a.status === "continuous";
              return (
                <div className="tp-detail">
                  {editMode ? (
                    <input
                      key={`title-${a.id}-${a.project}`}
                      className="tp-title-input"
                      defaultValue={a.project}
                      onBlur={(e) => e.target.value !== a.project && updateAssignment(a.id, { project: e.target.value })}
                    />
                  ) : (
                    <h2>{a.project || "Untitled"}</h2>
                  )}
                  <span className={`tp-status ${a.status}`}>{a.status}</span>

                  {editMode && (
                    <div className="tp-status-row">
                      {["active", "queued", "continuous", "done"].map((s) => (
                        <button key={s} className={s === a.status ? "on" : ""} onClick={() => updateAssignment(a.id, { status: s })}>{s}</button>
                      ))}
                    </div>
                  )}

                  {editMode && !hidePercentEst && (
                    <div className="tp-percent-row">
                      <span>Progress</span>
                      <button onClick={() => updateAssignment(a.id, { percent: Math.max(0, (a.percent || 0) - 5) })}>−</button>
                      <b>{a.percent || 0}%</b>
                      <button onClick={() => updateAssignment(a.id, { percent: Math.min(100, (a.percent || 0) + 5) })}>+</button>
                    </div>
                  )}

                  {editMode && !hidePercentEst && (
                    <div className="tp-edit-row">
                      <label>Estimate (days)</label>
                      <input
                        key={`est-${a.id}-${a.est_days}`}
                        type="number" min="1"
                        defaultValue={a.est_days}
                        onBlur={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (v && v !== a.est_days) updateAssignment(a.id, { est_days: v });
                        }}
                      />
                    </div>
                  )}

                  {editMode && (
                    <div className="tp-edit-row">
                      <label>Note</label>
                      <textarea
                        key={`note-${a.id}-${a.note || ""}`}
                        rows={3}
                        defaultValue={a.note || ""}
                        onBlur={(e) => e.target.value !== (a.note || "") && updateAssignment(a.id, { note: e.target.value })}
                      />
                    </div>
                  )}
                  {!editMode && a.note && <p>{a.note}</p>}

                  <dl>
                    <div><dt>Owner</dt><dd>{eng?.name || "-"}</dd></div>
                    <div><dt>Start</dt><dd>{bar.startDate || bar.startLabel || "-"}</dd></div>
                    <div><dt>Estimate</dt><dd>{a.est_days || 10}d</dd></div>
                    <div><dt>Progress</dt><dd>{a.percent || 0}%</dd></div>
                  </dl>

                  {bar.parallel && (
                    <div className="tp-warn-box">
                      <span className="tp-warn-chip">⚠ Parallel load</span>
                      <p className="tp-warn-text">
                        This task overlaps another assignment for {eng?.name || "this engineer"}.
                        {bar.snapAfter ? " Recommendation: snap after previous task." : ""}
                      </p>
                      {editMode && bar.snapAfter && (
                        <button
                          className="tp-snap-btn"
                          onClick={() => {
                            const newDate = toISODate(addDays(parseISODate(bar.snapAfter.endDate), 1));
                            const patch = bar.kind === "queued" ? { queue_start: newDate } : { start_date: newDate };
                            updateAssignment(a.id, patch);
                          }}
                        >
                          Snap after previous ({bar.snapAfter.project || "Untitled"})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {selectedBacklogItem && (
              <div className="tp-detail">
                <h2>{selectedBacklogItem.title}</h2>
                <span className={priorityClass(selectedBacklogItem.priority)}>{selectedBacklogItem.priority || "P2"}</span>
                <p>{selectedBacklogItem.description || "No description"}</p>
                <dl>
                  <div><dt>Owner</dt><dd>{selectedBacklogItem.owner || "-"}</dd></div>
                  <div><dt>Estimate</dt><dd>{selectedBacklogItem.est_hours ? `${selectedBacklogItem.est_hours}h` : `${selectedBacklogItem.est_days || 10}d`}</dd></div>
                  <div><dt>Status</dt><dd>{selectedBacklogItem.status || "-"}</dd></div>
                </dl>
                {editMode && (
                  <div className="tp-edit-row">
                    <label>Assign to engineer</label>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id) assignBacklogItem(selectedBacklogItem.id, Number(id), toISODate(today));
                      }}
                    >
                      <option value="">Choose…</option>
                      {(draft.engineers || []).map((eng) => <option key={eng.id} value={eng.id}>{eng.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {selectedEngineer && (
              <div className="tp-detail">
                <h2>{selectedEngineer.name}</h2>
                <dl>
                  <div><dt>Assignments</dt><dd>{selectedEngineer.assignments?.length || 0}</dd></div>
                  <div><dt>Load</dt><dd>{capacityFor(selectedEngineer).load}%</dd></div>
                  <div><dt>Latest report</dt><dd>{selectedEngineer.latest_report_date || "-"}</dd></div>
                </dl>
              </div>
            )}
          </section>

          <section className="tp-panel" ref={capacityRef}>
            <div className="tp-panel-head"><span>Capacity</span></div>
            {(draft.engineers || []).slice(0, 5).map((e) => {
              const cap = capacityFor(e);
              return (
                <div className="tp-cap-row" key={e.id}>
                  <div><strong>{e.name}</strong><span>{cap.active} active</span></div>
                  <div className="tp-cap-track"><i style={{ width: `${Math.min(100, cap.load)}%` }} className={cap.load > 100 ? "over" : ""} /></div>
                  <b className={cap.load > 100 ? "over" : ""}>{cap.load}%</b>
                </div>
              );
            })}
          </section>

          <section className="tp-panel" ref={risksRef}>
            <div className="tp-panel-head"><span>Risks</span></div>
            {risks.length === 0 && <div className="tp-muted-box">No delivery risks detected.</div>}
            {risks.map((risk, idx) => (
              <div className={`tp-risk ${risk.type}`} key={`${risk.type}-${idx}`}>
                <strong>{risk.title}</strong>
                <span>{risk.detail}</span>
              </div>
            ))}
          </section>
        </aside>
      </main>
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .tp-shell{min-height:100vh;background:var(--base);color:var(--text)}
      .tp-topbar{height:60px;display:grid;grid-template-columns:280px 1fr auto;align-items:center;gap:18px;padding:0 20px;background:var(--card);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:20}
      .tp-brand{display:flex;align-items:center;gap:10px;min-width:0}
      .tp-logo{width:32px;height:32px;border-radius:8px;background:var(--accent1);color:#07111f;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
      .tp-title{font-size:15px;font-weight:800}
      .tp-subtitle{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tp-tabs{display:flex;align-items:center;justify-content:center;gap:2px;height:100%}
      .tp-tab{height:100%;padding:0 18px;border:0;border-bottom:2px solid transparent;background:none;color:var(--muted);font-family:inherit;font-size:13px;cursor:pointer}
      .tp-tab.active{color:var(--accent1);border-bottom-color:var(--accent1);font-weight:700}
      .tp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .tp-link-btn,.tp-icon-btn,.tp-small-btn,.tp-primary-btn{border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-family:inherit;font-size:12px;text-decoration:none;cursor:pointer}
      .tp-link-btn{padding:7px 10px}
      .tp-link-btn:disabled{opacity:.4;cursor:not-allowed}
      .tp-link-btn.on,.tp-edit-toggle.on{background:var(--accent1);border-color:var(--accent1);color:#07111f;font-weight:700}
      .tp-btn-discard{color:var(--danger);border-color:var(--danger)}
      .tp-icon-btn{width:32px;height:32px}
      .tp-toast{position:fixed;bottom:18px;right:18px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:50}
      .tp-inline-error{background:rgba(208,32,64,.08);border:1px solid var(--danger);color:var(--danger);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px}
      .tp-layout{display:grid;grid-template-columns:236px minmax(0,1fr) 300px;min-height:calc(100vh - 60px)}
      .tp-sidebar,.tp-inspector{background:var(--card);border-right:1px solid var(--border);padding:16px;overflow:auto}
      .tp-inspector{border-right:0;border-left:1px solid var(--border)}
      .tp-side-section{margin-bottom:24px}
      .tp-section-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin-bottom:9px}
      .tp-view{width:100%;display:flex;justify-content:space-between;align-items:center;border:1px solid transparent;background:none;color:var(--text);padding:9px 10px;border-radius:8px;font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
      .tp-view:hover,.tp-view.active{background:var(--accent1-bg);border-color:var(--accent1-border)}
      .tp-view span{font-size:10px;color:var(--accent1)}
      .tp-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
      .tp-field span{font-size:11px;color:var(--muted)}
      .tp-field input,.tp-field select{height:34px;border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-family:inherit;font-size:12px;padding:0 10px}
      .tp-signal{display:flex;align-items:baseline;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
      .tp-signal b{font-size:18px}.tp-signal span{font-size:11px;color:var(--muted)}.tp-signal.danger b{color:var(--danger)}
      .tp-board{min-width:0;padding:16px;overflow:auto}
      .tp-board-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
      .tp-board-toolbar h1{font-size:22px;margin:0}.tp-board-toolbar p{font-size:12px;color:var(--muted);margin-top:3px}
      .tp-toolbar-actions{display:flex;align-items:center;gap:8px}.tp-small-btn{padding:7px 10px}.tp-small-btn:disabled{opacity:.45;cursor:default}.tp-primary-btn{padding:8px 12px;background:var(--accent1);border-color:var(--accent1);color:#07111f;font-weight:700}
      .tp-state{padding:46px;text-align:center;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px}.tp-state.error{color:var(--danger)}
      .tp-gantt{background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:auto}
      .tp-gantt-grid{display:grid;min-width:1120px;position:relative}
      .tp-name-head,.tp-week-head,.tp-day{display:flex;align-items:center;border-bottom:1px solid var(--border);background:var(--card);font-size:11px;color:var(--muted)}
      .tp-name-head{position:sticky;left:0;z-index:5;padding:0 12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid var(--border)}
      .tp-week-head{justify-content:center;border-right:1px solid var(--border);font-weight:700}.tp-day{justify-content:center;font-size:10px}.tp-day.weekend{background:rgba(120,120,140,.08)}
      .tp-weekend-col{position:relative;background:rgba(120,120,140,.08);pointer-events:none;z-index:0}
      .tp-today{position:relative;z-index:4;border-left:2px solid var(--success);pointer-events:none}.tp-today span{position:absolute;top:32px;left:-20px;background:var(--success);color:#07111f;border-radius:8px;padding:2px 7px;font-size:10px;font-weight:800}
      .tp-engineer-cell{position:sticky;left:0;z-index:3;display:flex;align-items:center;gap:9px;border:0;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--card);color:var(--text);padding:0 10px;font-family:inherit;text-align:left;cursor:pointer}
      .tp-avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#07111f;font-size:11px;font-weight:800;flex:none}.tp-eng-text{display:flex;flex-direction:column;min-width:0;flex:1}.tp-eng-text strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-eng-text small{font-size:10px;color:var(--muted)}
      .tp-load{font-size:11px;color:var(--muted);font-weight:700}.tp-load.over{color:var(--danger)}
      .tp-row-bg{border-bottom:1px solid var(--border);background:linear-gradient(180deg,transparent,rgba(120,120,140,.025))}
      .tp-bar,.tp-idle-bar{position:relative;align-self:center;height:25px;margin:0 2px;border-radius:6px;border:1px solid var(--bar-color);background:color-mix(in srgb,var(--bar-color) 18%,transparent);color:var(--text);font-family:inherit;font-size:11px;font-weight:700;display:flex;align-items:center;gap:8px;padding:0 8px;overflow:hidden;cursor:pointer;z-index:2}
      .tp-bar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-bar small{margin-left:auto;text-transform:uppercase;font-size:9px;color:var(--muted)}.tp-bar.queued{border-style:dashed;background:transparent}.tp-bar.done{opacity:.65}.tp-bar.risk{outline:2px solid rgba(208,32,64,.35)}.tp-bar.parallel{box-shadow:inset 0 0 0 1px var(--warning)}
      .tp-bar.editing{cursor:grab}.tp-bar.editing:active{cursor:grabbing}.tp-bar.dragging{opacity:.85;outline:2px dashed var(--accent1)}
      .tp-resize-handle{position:absolute;top:0;right:0;bottom:0;width:8px;cursor:ew-resize;z-index:3}
      .tp-bar-warn{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:var(--warning);color:#1a1200;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:800;line-height:1}
      .tp-pending-dot{position:absolute;top:-4px;left:-4px;width:8px;height:8px;border-radius:50%;background:var(--accent1);border:1px solid var(--card)}
      .tp-bar-error{border:1px dashed var(--danger);background:rgba(208,32,64,.08);color:var(--danger);align-self:center;height:25px;border-radius:6px;padding:0 8px;font-size:11px;cursor:pointer;display:flex;align-items:center}
      .tp-idle-bar{border:1px dashed var(--danger);background:rgba(208,32,64,.06);color:var(--danger);justify-content:center}
      .tp-backlog{margin-top:14px;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
      .tp-backlog-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border)}.tp-backlog-head h2{font-size:15px}.tp-backlog-head p{font-size:11px;color:var(--muted);margin-top:2px}.tp-link-inline{font-size:12px;color:var(--accent1);text-decoration:none}
      .tp-backlog-table{display:flex;flex-direction:column}.tp-backlog-row{display:grid;grid-template-columns:70px minmax(180px,1fr) 130px 70px 90px;gap:12px;align-items:center;min-height:42px;padding:0 12px;border:0;border-bottom:1px solid var(--border);background:none;color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}.tp-backlog-row:hover{background:var(--row-hover)}.tp-backlog-row[role="button"]:focus-visible{outline:2px solid var(--accent1);outline-offset:-2px}
      .tp-backlog-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-assign{color:var(--accent1);font-weight:700}.tp-assign.muted{color:var(--muted);font-weight:400}.tp-empty{padding:18px;text-align:center;color:var(--muted);font-size:12px}
      .tp-assign-select{height:28px;border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-family:inherit;font-size:11px}
      .tp-priority{display:inline-flex;align-items:center;justify-content:center;width:max-content;min-width:34px;border-radius:8px;padding:2px 7px;font-size:10px;font-weight:800}.tp-p0{background:rgba(208,32,64,.12);color:var(--danger)}.tp-p1{background:rgba(192,128,0,.13);color:var(--warning)}.tp-p2{background:rgba(120,120,140,.14);color:var(--muted)}.tp-enabler{background:var(--accent1-bg);color:var(--accent1)}.tp-gated{background:rgba(120,120,140,.25);color:var(--text)}
      .tp-panel{background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px}.tp-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.tp-panel-head button{border:0;background:none;color:var(--accent1);font-family:inherit;font-size:11px;cursor:pointer}
      .tp-muted-box{border:1px dashed var(--border);border-radius:8px;padding:12px;color:var(--muted);font-size:12px;line-height:1.45}.tp-detail h2{font-size:16px;line-height:1.25;margin-bottom:8px}.tp-detail p{font-size:12px;line-height:1.45;color:var(--muted);margin:10px 0}.tp-detail dl{display:grid;gap:8px;margin-top:12px}.tp-detail dl div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:6px}.tp-detail dt{font-size:11px;color:var(--muted)}.tp-detail dd{font-size:12px;text-align:right}
      .tp-title-input{width:100%;border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-family:inherit;font-size:14px;font-weight:700;padding:6px 8px;margin-bottom:8px}
      .tp-status{display:inline-flex;border-radius:8px;padding:2px 8px;font-size:10px;text-transform:uppercase;font-weight:800;background:var(--accent1-bg);color:var(--accent1)}
      .tp-status-row{display:flex;gap:6px;margin-top:10px}.tp-status-row button{flex:1;border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-size:10px;text-transform:uppercase;font-weight:700;padding:6px 0;cursor:pointer}.tp-status-row button.on{background:var(--accent1-bg);border-color:var(--accent1-border);color:var(--accent1)}
      .tp-percent-row{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--muted)}.tp-percent-row button{width:26px;height:26px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--text);cursor:pointer}.tp-percent-row b{color:var(--text);font-size:12px}
      .tp-edit-row{display:flex;flex-direction:column;gap:5px;margin-top:10px}.tp-edit-row label{font-size:11px;color:var(--muted)}.tp-edit-row input,.tp-edit-row select,.tp-edit-row textarea{border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-family:inherit;font-size:12px;padding:6px 8px;resize:vertical}
      .tp-warn-box{border:1px dashed var(--warning);border-radius:8px;padding:10px;margin-top:12px;background:rgba(192,128,0,.06)}.tp-warn-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;color:var(--warning)}.tp-warn-text{font-size:11px;color:var(--muted);margin:6px 0;line-height:1.4}
      .tp-snap-btn{border:1px solid var(--warning);border-radius:8px;background:none;color:var(--warning);font-size:11px;font-weight:700;padding:6px 10px;cursor:pointer}
      .tp-cap-row{display:grid;grid-template-columns:1fr 88px 42px;align-items:center;gap:8px;margin-bottom:10px}.tp-cap-row strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-cap-row span{font-size:10px;color:var(--muted)}.tp-cap-track{height:7px;background:var(--card);border-radius:5px;overflow:hidden}.tp-cap-track i{display:block;height:100%;background:var(--accent1);border-radius:5px}.tp-cap-track i.over{background:var(--danger)}.tp-cap-row b{font-size:11px;color:var(--muted);text-align:right}.tp-cap-row b.over{color:var(--danger)}
      .tp-risk{display:flex;flex-direction:column;gap:3px;border-left:3px solid var(--warning);padding:8px 0 8px 10px;margin-bottom:8px}.tp-risk.blocked,.tp-risk.parallel{border-left-color:var(--danger)}.tp-risk strong{font-size:12px}.tp-risk span{font-size:11px;color:var(--muted);line-height:1.35}
      @media(max-width:1180px){.tp-layout{grid-template-columns:210px minmax(0,1fr)}.tp-inspector{grid-column:1 / -1;border-left:0;border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.tp-panel{margin-bottom:0}.tp-topbar{grid-template-columns:220px 1fr auto}}
      @media(max-width:820px){.tp-topbar{grid-template-columns:1fr;min-height:132px;height:auto;padding:12px}.tp-tabs{justify-content:flex-start;height:38px}.tp-layout{grid-template-columns:1fr}.tp-sidebar{border-right:0;border-bottom:1px solid var(--border)}.tp-inspector{display:block}.tp-board-toolbar{align-items:flex-start;flex-direction:column}.tp-backlog-row{grid-template-columns:48px minmax(160px,1fr) 70px}.tp-backlog-row span:nth-child(3),.tp-backlog-row span:nth-child(4){display:none}}
    `}</style>
  );
}
