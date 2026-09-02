import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useTheme, toggleTheme } from "../hooks/useTheme";
import { api } from "../api/client";

/**
 * TeamGantt — standing per-engineer load view: current project (day X of ~Y),
 * next queued project, and idle time shown as its own visible row.
 */

const DAY_COLS = 42; // 6 weeks

// Vertical order of a lane's rows. Every bar gets its own row (see
// buildEngineerBars), so this is the only thing deciding what sits where.
const KIND_RANK = { continuous: 0, active: 1, queued: 2, done: 3, error: 4, idle: 5 };
const BACKLOG_COLLAPSED_KEY = "gantt-backlog-collapsed";
const PANEL_WIDTH_KEY = "gantt-panel-width";
const PANEL_MIN_W = 200;
const PANEL_MAX_W = 520;
const clampPanelWidth = (w) => Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Math.round(w)));
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
/* When a task was closed. The API has no dedicated close timestamp, so
 * updated_at stands in — for a done row the last write IS the close. Returns
 * "" for rows without one so sorts and labels degrade quietly. */
function closedAt(assignment) {
  return assignment?.updated_at || "";
}

/** "2026-08-28T09:12:03" -> "28 Aug". Empty string when unknown. */
function formatClosed(assignment) {
  const raw = closedAt(assignment);
  if (!raw) return "";
  const d = parseISODate(String(raw).slice(0, 10));
  if (!d) return "";
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
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
 * small warning chip instead of vanishing. Each bar occupies its own sub-row,
 * kept 1:1 with the task rows rendered in the left pane. */

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

function buildEngineerBars(assignments, rangeStart, today, view = "active") {
  const bars = [];
  const done = view === "done";
  // The Done tab is a closed-work archive: only done rows, and none of the
  // live-load scaffolding (queue anchoring, the idle placeholder) applies.
  const continuousAssignments = done ? [] : assignments.filter((a) => a.status === "continuous");
  const activeAssignments = done ? [] : assignments.filter((a) => a.status === "active");
  const queuedAssignments = done ? [] : assignments.filter((a) => a.status === "queued");
  const doneAssignments = done ? assignments.filter((a) => a.status === "done") : [];
  const otherAssignments = done ? [] : assignments.filter(
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
  if (!done && continuousAssignments.length === 0 && activeAssignments.length === 0) {
    bars.push({ kind: "idle" });
  }

  // Every bar owns exactly one row. The left pane renders one task row per bar,
  // so packing non-overlapping bars onto a shared sub-row (as this used to do)
  // would break that 1:1 correspondence.
  //
  // The tiebreak is the assignment id, NOT colStart: sorting by start column
  // would reorder rows the instant a move-drag commits, so the bar you just
  // dropped would jump to a different row under the cursor. Rows behave as a
  // stable list instead, which is also the sheet mental model.
  bars.sort((a, b) => {
    // Done tab is an archive, so it reads most-recently-closed first rather
    // than in the stable list order the live board needs.
    if (done) {
      const byClosed = closedAt(b.assignment).localeCompare(closedAt(a.assignment));
      if (byClosed !== 0) return byClosed;
    }
    const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (byKind !== 0) return byKind;
    // ids may be `tmp-N` strings for locally-staged creates, so compare as
    // strings — numeric subtraction would yield NaN and corrupt the sort.
    return String(a.assignment?.id ?? "").localeCompare(String(b.assignment?.id ?? ""));
  });
  bars.forEach((b, i) => { b.subRow = i });

  return { bars, height: Math.max(1, bars.length) };
}

/* Lays every engineer out as a block of grid rows: a group-header row carrying
 * the engineer's name, one row per task, and — in edit mode — a trailing
 * "add task" row. Row tracks are returned alongside as `rowSizes` because the
 * block is no longer a uniform run of rows and can't be synthesised with a
 * repeat()/fill(). */
function buildLanes(engineers, rangeStart, today, { addRow = false, view = "active" } = {}) {
  let rowCursor = 3; // rows 1-2 are the two-row timeline header
  const rowSizes = []; // parallel to rows 3..N — the exact gridTemplateRows tracks
  const lanes = [];
  for (const eng of engineers) {
    const assignments = eng.assignments || [];
    const { bars, height } = buildEngineerBars(assignments, rangeStart, today, view);

    // An engineer with nothing closed has no place in the archive — without
    // this they'd contribute a header plus a phantom empty row (height is
    // floored at 1 so the live board can still show an idle lane).
    if (view === "done" && bars.length === 0) continue;

    const headerRow = rowCursor;
    rowSizes.push("28px");
    const firstBarRow = headerRow + 1;
    for (let i = 0; i < height; i++) rowSizes.push("minmax(28px,auto)");
    const addBtnRow = addRow ? firstBarRow + height : null;
    if (addRow) rowSizes.push("26px");
    rowCursor = firstBarRow + height + (addRow ? 1 : 0);

    if (import.meta.env.DEV) {
      // Each tab renders a subset, so the invariant is against what the tab
      // is meant to show, not the engineer's whole assignment list.
      const expected = view === "done"
        ? assignments.filter((a) => a.status === "done").length
        : assignments.filter((a) => a.status !== "done").length;
      const renderedForItems = bars.filter((b) => b.kind !== "idle").length;
      if (renderedForItems !== expected) {
        console.warn(
          `[TeamGantt] ${eng.name}: ${view} tab expected ${expected} assignment(s) but ${renderedForItems} bar(s) were rendered`
        );
      }
    }

    // blockEnd is exclusive — use it as the end of a `gridRow` span.
    lanes.push({ engineer: eng, headerRow, firstBarRow, addBtnRow, blockEnd: rowCursor, height, bars });
  }
  return { lanes, totalRows: rowCursor - 1, rowSizes };
}

/* ---------------- draft layer ----------------
 * Edit mode never writes to the backend directly. Every action pushes a change
 * object onto changeQueue instead; computeDraftState replays that queue on top
 * of the last-fetched base snapshot to produce what's actually rendered. Undo
 * is just popping the last change and re-deriving — there's no per-action
 * inverse to maintain, since this is a pure, deterministic replay.
 *
 * Change shapes:
 *   gantt_update   {id, fields}
 *   gantt_create   {tempId, fields}
 *   gantt_delete   {id}
 *   backlog_update {id, fields}
 *   backlog_create {tempId, fields}
 *   backlog_delete {id}
 *   backlog_reorder{orderedIds}
 *   backlog_assign {tempId, backlogId, engineerId, startDate}
 *   engineer_visibility {engineerId, hidden}
 * `id`/`backlogId`/`engineerId`/entries in orderedIds may be a real numeric id
 * or a tempId string minted by an earlier create/assign in the same queue.
 * A change may also carry a `groupId` — undoChange pops every trailing entry
 * that shares the last change's groupId together, so a compound action (e.g.
 * assigning to a hidden engineer, which also un-hides them) undoes atomically. */
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
        if (found) {
          Object.assign(found.a, ch.fields, { __pending: true });
          // Reassignment has to relocate the row, not just stamp the field:
          // lanes are built by walking each engineer's own assignments array,
          // so a task left in the old array would keep rendering there.
          const target = ch.fields.engineer_id;
          if (target != null && target !== found.eng.id) {
            const dest = engineersById.get(target);
            if (dest) {
              found.eng.assignments = found.eng.assignments.filter((x) => x.id !== ch.id);
              dest.assignments = [...dest.assignments, found.a];
            }
          }
        }
        break;
      }
      case "gantt_create": {
        const eng = engineersById.get(ch.fields.engineer_id);
        if (eng) {
          eng.assignments.push({
            percent: 0, status: "active", note: "", queue_start: null,
            ...ch.fields,
            id: ch.tempId, __pending: true,
          });
        }
        break;
      }
      case "gantt_delete": {
        const found = findAssignment(ch.id);
        if (found) found.eng.assignments = found.eng.assignments.filter((x) => x.id !== ch.id);
        break;
      }
      case "backlog_update": {
        const idx = backlogItems.findIndex((b) => b.id === ch.id);
        if (idx !== -1) {
          const patch = { ...ch.fields };
          // Mirror the backend's derivation so an assign staged right after
          // an hours edit (both still unsaved) previews the correct bar length.
          if (patch.est_hours != null) patch.est_days = Math.max(1, Math.ceil(patch.est_hours / 8));
          backlogItems[idx] = { ...backlogItems[idx], ...patch, __pending: true };
        }
        break;
      }
      case "backlog_create": {
        backlogItems.push({
          description: "", owner: "", priority: "P2", est_days: 10,
          status: "", source: "", origin: "",
          ...ch.fields,
          id: ch.tempId, sort_order: backlogItems.length, __pending: true,
        });
        break;
      }
      case "backlog_delete": {
        backlogItems = backlogItems.filter((b) => b.id !== ch.id);
        break;
      }
      case "backlog_reorder": {
        const byId = new Map(backlogItems.map((b) => [b.id, b]));
        const reordered = ch.orderedIds.map((id) => byId.get(id)).filter(Boolean);
        // defensive: keep any item the reorder snapshot didn't know about, so a
        // stray future change type never silently drops data from the draft
        for (const b of backlogItems) if (!ch.orderedIds.includes(b.id)) reordered.push(b);
        backlogItems = reordered;
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
      case "engineer_visibility": {
        const eng = engineersById.get(ch.engineerId);
        if (eng) eng.hidden = ch.hidden;
        break;
      }
      default:
        break;
    }
  }

  return { engineers: Array.from(engineersById.values()), backlogItems };
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

/** Meta grid for the shared task-detail modal, built from the same bar
 *  object the visible Gantt bar already computed (dayX/estY/startDate/
 *  startLabel) — see barInfoByAssignmentId. */
function ganttDetailMeta(bar, assignment, engineerName) {
  const meta = [{ label: "Engineer", value: engineerName }];
  if (bar.kind === "queued") {
    meta.push({ label: "Queue start", value: bar.startLabel || "—" });
    meta.push({ label: "Est days", value: assignment.est_days });
  } else if (bar.kind === "active") {
    meta.push({ label: "Start date", value: bar.startDate || "—" });
    meta.push({ label: "Est days", value: assignment.est_days });
    meta.push({ label: "Progress", value: `day ${bar.dayX} of ~${bar.estY}` });
  } else if (bar.kind === "done") {
    meta.push({ label: "Start date", value: bar.startDate || "—" });
    meta.push({ label: "Est days", value: assignment.est_days });
  } else {
    meta.push({ label: "Est days", value: assignment.est_days });
  }
  return meta;
}

/** Status + percent badge shown next to the title in the shared task-detail
 *  modal when it's showing a Gantt assignment (percent is only meaningful
 *  for active/done work, not queued/continuous). */
function GanttDetailBadge({ assignment }) {
  const showPercent = assignment.status === "active" || assignment.status === "done";
  return (
    <span className="tg-modal-badge-wrap">
      <span className={`tg-status-chip tg-status-${assignment.status}`}>{assignment.status}</span>
      {showPercent && <span className="tg-modal-percent">{assignment.percent}%</span>}
    </span>
  );
}

/* ---------------- backlog ---------------- */

const BACKLOG_PRIORITIES = ["P0", "P1", "P2", "ENABLER", "GATED"];

const PRIORITY_BLOCK_LABELS = {
  P0: "P0 — берём немедленно",
  P1: "P1 — ближайшая очередь",
  P2: "P2 — при простое",
  ENABLER: "ENABLER — инфраструктура",
  GATED: "GATED — ждёт триггера",
};

/** Index into BACKLOG_PRIORITIES; unknown/blank priority values sort as P2 —
 *  mirrors the backend's ORDER BY CASE expression exactly. */
function priorityRank(priority) {
  const i = BACKLOG_PRIORITIES.indexOf(priority);
  return i === -1 ? BACKLOG_PRIORITIES.indexOf("P2") : i;
}

function priorityChipClass(priority) {
  switch (priority) {
    case "P0": return "bl-chip-p0";
    case "P1": return "bl-chip-p1";
    case "ENABLER": return "bl-chip-enabler";
    case "GATED": return "bl-chip-gated";
    default: return "bl-chip-p2";
  }
}

/** Priority chip that becomes a <select> on click in edit mode. Esc or a
 *  blur (clicking elsewhere) closes it without saving; changing the value
 *  saves immediately and closes. Viewer mode never shows the affordance. */
function PriorityCell({ priority, editable, onChange }) {
  const [editing, setEditing] = useState(false);

  if (!editable) {
    return <span className={`bl-chip ${priorityChipClass(priority)}`}>{priority}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`bl-chip bl-chip-btn ${priorityChipClass(priority)}`}
        onClick={() => setEditing(true)}
        title="Click to change priority"
      >
        {priority}
      </button>
    );
  }

  return (
    <select
      className={`bl-priority-select ${priorityChipClass(priority)}`}
      defaultValue={priority}
      autoFocus
      onChange={(e) => { onChange(e.target.value); setEditing(false) }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(false) } }}
    >
      {BACKLOG_PRIORITIES.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </select>
  );
}

function truncateUrl(url, max = 46) {
  if (!url) return "";
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

function formatEstHours(h) {
  if (h == null) return "—";
  const n = Number(h);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
}

/** Click-to-edit "Est, h" cell. Read-only render in viewer mode / when not
 *  clicked; a number input with blur/Enter-to-save, Esc-to-cancel otherwise. */
function EstHoursCell({ item, editable, onChange }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");

  if (!editable) {
    return <span className="bl-esth-static">{formatEstHours(item.est_hours)}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="bl-esth-display"
        onClick={() => { setVal(item.est_hours != null ? String(item.est_hours) : ""); setErr(""); setEditing(true) }}
      >
        {formatEstHours(item.est_hours)}
      </button>
    );
  }

  function commit() {
    const raw = val.trim();
    if (raw === "") { setEditing(false); return } // left blank — no change
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 999) {
      setErr("0 < часы ≤ 999");
      return;
    }
    if (n !== item.est_hours) onChange(n);
    setEditing(false);
  }

  return (
    <span className="bl-esth-edit" onClick={(e) => e.stopPropagation()}>
      <input
        type="number" min="0.5" max="999" step="0.5" autoFocus
        className="bl-esth-input"
        value={val}
        onChange={(e) => { setVal(e.target.value); setErr("") }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit() }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false) }
        }}
      />
      {err && <span className="bl-esth-err">{err}</span>}
    </span>
  );
}

/* ---------------- backlog: task detail modal ---------------- */

const TASK_DESC_PREFIX_RE = /^(ЦЕЛЬ:|ЧТО СДЕЛАТЬ:|ПРОФИТ:)/;

function formatEstMeta(item) {
  if (item.est_hours != null) return formatEstHours(item.est_hours);
  return `${item.est_days} дн.`;
}

/** Shared task-detail modal — opened by clicking a backlog row OR a Gantt
 *  bar (see handleBacklogRowClick / GanttBar's onOpenDetail). Fully generic:
 *  callers supply the title, an optional header badge, the free-text body
 *  (backlog "description" or assignment "note"), and a meta grid of
 *  {label,value} pairs, so this component has no knowledge of which kind of
 *  task it's showing. Edit mode swaps the body for a textarea (and the title
 *  too, if titleEditable) with a Save button; onSave receives a generic
 *  {title?, body?} patch and the caller maps that to its own field names.
 *  Viewer mode renders the body read-only with \n preserved and the
 *  ЦЕЛЬ:/ЧТО СДЕЛАТЬ:/ПРОФИТ: prefixes bolded. Esc, a backdrop click, or ×
 *  all close it without saving. */
function TaskDetailModal({ taskKey, title, titleEditable, badge, body, meta, editable, onClose, onSave }) {
  const [titleVal, setTitleVal] = useState(title);
  const [bodyVal, setBodyVal] = useState(body || "");
  const containerRef = useRef(null);

  useEffect(() => {
    setTitleVal(title);
    setBodyVal(body || "");
  }, [taskKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    containerRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function trapTab(e) {
    if (e.key !== "Tab" || !containerRef.current) return;
    const focusables = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const dirty = editable && ((titleEditable && titleVal !== title) || bodyVal !== (body || ""));

  function handleSave() {
    const patch = {};
    if (titleEditable && titleVal.trim() && titleVal !== title) patch.title = titleVal.trim();
    if (bodyVal !== (body || "")) patch.body = bodyVal;
    if (Object.keys(patch).length) onSave(patch);
    onClose();
  }

  return (
    <div className="bl-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="card bl-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || "Task"}
        tabIndex={-1}
        ref={containerRef}
        onKeyDown={trapTab}
      >
        <button className="bl-modal-close" onClick={onClose} title="Закрыть (Esc)">×</button>

        <div className="bl-modal-head">
          {editable && titleEditable ? (
            <input className="bl-modal-title-input" value={titleVal} onChange={(e) => setTitleVal(e.target.value)} />
          ) : (
            <h3 className="bl-modal-title">{title}</h3>
          )}
          {badge}
        </div>

        <div className="bl-modal-body">
          {editable ? (
            <textarea
              className="bl-modal-desc-input"
              value={bodyVal}
              onChange={(e) => setBodyVal(e.target.value)}
              rows={8}
            />
          ) : (
            <div className="bl-modal-desc">
              {(body || "").split("\n").map((line, i) => {
                const m = line.match(TASK_DESC_PREFIX_RE);
                return (
                  <div key={i} className="bl-modal-desc-line">
                    {m ? <><strong>{m[1]}</strong>{line.slice(m[1].length)}</> : (line || " ")}
                  </div>
                );
              })}
            </div>
          )}

          <div className="bl-modal-meta">
            {meta.map(({ label, value }) => (
              <div key={label}><span className="bl-modal-meta-label">{label}</span><span>{value}</span></div>
            ))}
          </div>
        </div>

        {editable && (
          <div className="bl-modal-footer">
            <button className="tg-btn" disabled={!dirty} onClick={handleSave}>Сохранить</button>
            <button className="tg-btn" onClick={onClose}>Отмена</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- inline edit controls ---------------- */

function AssignmentEditor({ a, hidePercentEst, onChange, onDelete, predecessorLabel, onStartLink, linking, snapWarning, onSnap, onOpenDetail }) {
  return (
    <div className="tg-editor" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button className="tg-e-detail" onClick={onOpenDetail} title="Открыть карточку">ⓘ</button>
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

/** Sheet-style checkmark. Inlined rather than pulled from an icon pack —
 *  the project ships no icon library and this is the only glyph needed. */
function CheckGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
      <path
        d="M1.5 6.2 L4.4 9 L10.5 2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const STATUS_LABEL = {
  active: "active", queued: "queued", done: "done",
  continuous: "ongoing", error: "?", idle: "idle",
};

/** Left-pane row for a single bar — checkbox / name / status pill / percent.
 *  Sits in the SAME grid row as its GanttBar, which is what keeps the task list
 *  and the timeline aligned without any measurement code.
 *
 *  Click semantics deliberately mirror the bar's: open the detail modal in
 *  viewer mode, select for the side panel in edit mode. */
function TaskRow({
  bar, gridRow, editMode, selectedId, onSelect, onUpdate,
  onOpenDetail, beginClickTracking, wasRealClick, setHoveredId, doneView,
}) {
  const a = bar.assignment;

  // The idle placeholder isn't a task — no id, nothing to check off or open.
  if (!a) {
    return (
      <div className="tg-task-row tg-task-idle" style={{ gridColumn: 1, gridRow }}>
        <span />
        <span className="tg-task-name">No active project</span>
        <span />
        <span />
      </div>
    );
  }

  const status = bar.kind === "error" ? "error" : a.status;
  const done = a.status === "done";
  const selected = selectedId === a.id;
  const showPercent = a.status === "active" || a.status === "done";
  // `overdue` is derived per-bar (past due and not finished), not a stored
  // status, so the pill has to check it before falling back to the status.
  const pill = bar.overdue ? "overdue" : status;

  function toggleDone(ev) {
    ev.stopPropagation();
    if (!editMode) return;
    onUpdate(a.id, done ? { status: "active" } : { status: "done", percent: 100 });
  }

  return (
    <div
      className={
        `tg-task-row${selected ? " tg-task-selected" : ""}${done ? " tg-task-done" : ""}`
      }
      style={{ gridColumn: 1, gridRow }}
      onMouseEnter={() => setHoveredId(a.id)}
      onMouseLeave={() => setHoveredId(null)}
      onMouseDown={beginClickTracking}
      onClick={(ev) => {
        if (!wasRealClick(ev)) return;
        if (editMode) onSelect(a.id);
        else onOpenDetail(a.id);
      }}
    >
      <span
        className={`tg-check${done ? " on" : ""}${editMode ? " tg-check-live" : ""}`}
        role={editMode ? "button" : undefined}
        title={editMode ? (done ? "Mark as active" : "Mark as done") : undefined}
        onClick={toggleDone}
      >
        {done && <CheckGlyph />}
      </span>
      <span className="tg-task-name" title={a.project}>
        {bar.kind === "error" && "⚠ "}{a.project}
        {a.__pending && <span className="tg-pending-dot" title="Unsaved" />}
      </span>
      <span className={`tg-pill tg-pill-${pill}`}>{STATUS_LABEL[pill] || pill}</span>
      <span className="tg-task-pct">
        {doneView ? formatClosed(a) : (showPercent ? `${a.percent}%` : "")}
      </span>
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
  onOpenDetail, beginClickTracking, wasRealClick, selectedId, onSelect,
}) {
  // Viewer mode: a plain click opens the shared task-detail modal (bars
  // aren't draggable in viewer mode, so no other click behavior to protect).
  // Edit mode: the inline AssignmentEditor is always visible already, so
  // there's no click-vs-edit-card ambiguity — its own ⓘ button opens the
  // modal instead (see AssignmentEditor's onOpenDetail).
  const viewerClickHandlers = !editMode
    ? {
        onMouseDown: beginClickTracking,
        onClick: (e) => { if (wasRealClick(e)) onOpenDetail(bar.assignment.id) },
      }
    : {};
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
        className={`tg-bar tg-continuous${editMode ? " tg-editing" : ""}${bar.assignment.__pending ? " tg-bar-pending" : ""}`}
        style={{ gridColumn: `${bar.colStart + 2} / ${bar.colEnd + 2}`, gridRow, background: `${color}2e` }}
        {...viewerClickHandlers}
      >
        <span className="tg-bar-label">{bar.assignment.project || "Untitled"} · continuous</span>
        {bar.assignment.__pending && <span className="tg-pending-badge" title="Unsaved change">unsaved</span>}
        {editMode && (
          <AssignmentEditor
            a={bar.assignment}
            hidePercentEst
            onChange={(patch) => onUpdate(bar.assignment.id, patch)}
            onDelete={() => onDelete(bar.assignment.id)}
            onOpenDetail={() => onOpenDetail(bar.assignment.id)}
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
        className={`tg-bar tg-done${editMode ? " tg-editing" : ""}${bar.assignment.__pending ? " tg-bar-pending" : ""}`}
        style={{ gridColumn: `${bar.colStart + 2} / ${bar.colEnd + 2}`, gridRow, background: `${color}73` }}
        {...viewerClickHandlers}
      >
        <span className="tg-bar-label">✓ {bar.assignment.project || "Untitled"} · done</span>
        {bar.assignment.__pending && <span className="tg-pending-badge" title="Unsaved change">unsaved</span>}
        {editMode && (
          <AssignmentEditor
            a={bar.assignment}
            onChange={(patch) => onUpdate(bar.assignment.id, patch)}
            onDelete={() => onDelete(bar.assignment.id)}
            onOpenDetail={() => onOpenDetail(bar.assignment.id)}
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
      : drag.kind === "resize-left"
        // Left edge moves, right edge pinned — clamped so the bar keeps >= 1 column.
        ? { colStart: Math.min(bar.colEnd - 1, bar.colStart + drag.deltaCols), colEnd: bar.colEnd }
        : { colStart: bar.colStart, colEnd: Math.max(bar.colStart + 1, bar.colEnd + drag.deltaCols) }
    : { colStart: bar.colStart, colEnd: bar.colEnd };
  const baseStartDate = isQueued ? bar.startLabel : bar.startDate;
  // The inline editor expands the bar well beyond a sheet row, so it's scoped
  // to the selected bar ("click a bar to edit") rather than shown on all of
  // them at once. Nothing becomes unreachable — selecting a bar still exposes
  // every control, dependency-linking included.
  const expanded = editMode && selectedId === bar.assignment.id;
  const warn = dependencyWarning(bar.assignment, assignmentsById, baseStartDate);
  const predLabel = bar.assignment.depends_on
    ? assignmentsById[bar.assignment.depends_on]?.project || null
    : null;

  return (
    <div
      ref={setBarRef(bar.assignment.id)}
      className={
        (isQueued
          ? `tg-bar tg-queued${editMode ? " tg-draggable" : ""}${expanded ? " tg-editing" : ""}${drag ? " tg-dragging" : ""}`
          : `tg-bar tg-active${bar.overdue ? " tg-overdue" : ""}${editMode ? " tg-draggable" : ""}${expanded ? " tg-editing" : ""}${drag ? " tg-dragging" : ""}`
        ) + (bar.assignment.__pending ? " tg-bar-pending" : "")
          + (editMode && selectedId === bar.assignment.id ? " tg-bar-selected" : "")
      }
      style={{
        gridColumn: `${cols.colStart + 2} / ${cols.colEnd + 2}`,
        gridRow,
        ...(isQueued ? { borderColor: color, color } : {}),
      }}
      onMouseDown={
        !editMode
          ? beginClickTracking
          : (linkingFor == null
              // Track the press as well as starting the drag: a press that never
              // moved is a click, and selects the bar for the side panel.
              ? (e) => { beginClickTracking(e); onBeginDrag(e, "move", bar.assignment, isQueued, bar.colStart, bar.colEnd, baseStartDate) }
              : undefined)
      }
      onClick={
        !editMode
          ? (e) => { if (wasRealClick(e)) onOpenDetail(bar.assignment.id) }
          : (linkingFor != null ? (e) => {
              e.stopPropagation();
              if (linkingFor !== bar.assignment.id) onUpdate(linkingFor, { depends_on: bar.assignment.id });
              setLinkingFor(null);
            } : (e) => { if (wasRealClick(e)) onSelect(bar.assignment.id) })
      }
      onMouseEnter={() => setHoveredId(bar.assignment.id)}
      onMouseLeave={() => setHoveredId((h) => (h === bar.assignment.id ? null : h))}
    >
      {!isQueued && (
        <>
          <div className="tg-bar-fillwrap">
            <div className="tg-bar-fill" style={{ width: `${bar.assignment.percent}%`, background: color }} />
            <div className="tg-bar-rest" style={{ width: `${100 - bar.assignment.percent}%`, background: color }} />
          </div>
          <div className="tg-bar-progress" style={{ width: `${bar.assignment.percent}%` }} />
        </>
      )}
      <span className="tg-bar-label">
        {isQueued
          ? `NEXT: ${bar.assignment.project || "Untitled"} · starts ${bar.startLabel}`
          : bar.future
            ? `${bar.assignment.project || "Untitled"} · starts ${bar.startDate} · ${bar.assignment.percent}%`
            : `${bar.assignment.project || "Untitled"} · day ${bar.dayX} of ~${bar.estY} · ${bar.assignment.percent}%`}
      </span>
      {!isQueued && bar.overdue && <span className="tg-overdue-tag">overdue</span>}
      {bar.assignment.__pending && <span className="tg-pending-badge" title="Unsaved change">unsaved</span>}
      {warn && (
        <span className="tg-dep-warn" title={`Starts before "${warn.predProject}" ends`}>⚠</span>
      )}
      {editMode && (
        <div
          className="tg-bar-resize tg-bar-resize-left"
          title="Drag to change the start date (end stays put)"
          onMouseDown={(e) => onBeginDrag(e, "resize-left", bar.assignment, isQueued, bar.colStart, bar.colEnd, baseStartDate)}
        />
      )}
      {editMode && (
        <div
          className="tg-bar-resize tg-bar-resize-right"
          title="Drag to change the duration"
          onMouseDown={(e) => onBeginDrag(e, "resize", bar.assignment, isQueued, bar.colStart, bar.colEnd, baseStartDate)}
        />
      )}
      {expanded && (
        <AssignmentEditor
          a={bar.assignment}
          onChange={(patch) => onUpdate(bar.assignment.id, patch)}
          onDelete={() => onDelete(bar.assignment.id)}
          predecessorLabel={predLabel}
          onStartLink={() => setLinkingFor(bar.assignment.id)}
          linking={linkingFor === bar.assignment.id}
          snapWarning={warn}
          onSnap={() => warn && onUpdate(bar.assignment.id, isQueued
            ? { queue_start: toISODate(addDays(warn.predEnd, 1)) }
            : { start_date: toISODate(addDays(warn.predEnd, 1)) })}
          onOpenDetail={() => onOpenDetail(bar.assignment.id)}
        />
      )}
    </div>
  );
}

/* ---------------- right-side editor panel ---------------- */

const PANEL_STATUSES = ["active", "queued", "continuous", "done"];

/** Slide-in editor for a single assignment (edit mode only).
 *
 *  Apply stages ONE gantt_update carrying only the fields that actually
 *  changed, and Delete stages a gantt_delete — both go through the same draft
 *  queue as every other edit-mode action rather than writing to the backend,
 *  so Undo / Discard / the unsaved badges keep working. computeDraftState
 *  already drops a deleted assignment from the rendered state, so there is no
 *  separate local removal to do here.
 *
 *  `form` is deliberately NOT cleared when the selection goes away: the panel
 *  keeps its last contents while it slides out, otherwise the fields would
 *  blank out mid-transition.
 */
function TaskSidePanel({ assignment, engineers, editMode, width, onWidthChange, onApply, onDelete, onClose }) {
  const [form, setForm] = useState(null);
  const panelRef = useRef(null);

  const seedKey = assignment
    ? [assignment.id, assignment.project, assignment.start_date,
       assignment.est_days, assignment.percent, assignment.status,
       assignment.engineer_id, assignment.note].join("|")
    : null;

  // Re-seed on a new selection, and also when the underlying record changes
  // underneath an open panel (a drag can move the very bar being edited).
  useEffect(() => {
    if (!assignment) return;
    setForm({
      project: assignment.project || "",
      start_date: assignment.start_date || "",
      est_days: assignment.est_days ?? 1,
      percent: assignment.percent ?? 0,
      status: assignment.status || "active",
      engineer_id: assignment.engineer_id ?? null,
      note: assignment.note || "",
    });
  }, [seedKey]);

  useEffect(() => {
    if (!assignment) return;
    // No stopPropagation: the board's own Escape handler also cancels an
    // in-flight drag and clears link mode, and both should still run.
    function onKey(e) { if (e.key === "Escape") onClose() }
    function onDown(e) {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      const near = e.target.closest ? e.target.closest(".tg-bar, .tg-controls") : null;
      // Clicking another bar switches selection rather than closing. Toolbar
      // clicks must not clear it either: this runs on mousedown, so closing
      // here would disable "Delete selected" before its click ever fired.
      if (near) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [assignment, onClose]);

  // Edge resize. Width is committed to state on every move so the board's
  // reserved padding tracks the panel exactly; only the final value is
  // persisted, so a drag writes localStorage once rather than per frame.
  const resizeRef = useRef(null);
  useEffect(() => {
    function onMove(e) {
      const r = resizeRef.current;
      if (!r) return;
      e.preventDefault();
      onWidthChange(clampPanelWidth(r.startWidth + (r.startX - e.clientX)));
    }
    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try { localStorage.setItem(PANEL_WIDTH_KEY, String(widthRef.current)) } catch { /* storage unavailable */ }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onWidthChange]);

  // Read by the mouseup listener, which is registered once and would otherwise
  // close over a stale width.
  const widthRef = useRef(width);
  widthRef.current = width;

  function beginResize(e) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  const open = !!assignment;
  const assignee = (engineers || []).find((e) => e.id === form?.engineer_id) || null;
  const assigneeColor = assignee?.avatar_color || assignee?.color || "var(--accent1)";

  function set(field, value) {
    setForm((f) => (f ? { ...f, [field]: value } : f));
  }

  function apply() {
    if (!assignment || !form) return;
    const patch = {};
    if (form.project !== (assignment.project || "")) patch.project = form.project;
    if (form.start_date && form.start_date !== assignment.start_date) patch.start_date = form.start_date;
    const est = Math.max(1, parseInt(form.est_days, 10) || 1);
    if (est !== assignment.est_days) patch.est_days = est;
    const pct = Math.min(100, Math.max(0, Number(form.percent)));
    if (pct !== assignment.percent) patch.percent = pct;
    if (form.status !== assignment.status) patch.status = form.status;
    // Compare against the same "" fallback the form seeds with, so a null note
    // left untouched doesn't look like an edit.
    if (form.note !== (assignment.note || "")) patch.note = form.note;
    if (form.engineer_id != null && form.engineer_id !== assignment.engineer_id) {
      patch.engineer_id = form.engineer_id;
    }
    if (Object.keys(patch).length > 0) onApply(assignment.id, patch);
    onClose();
  }

  return (
    <aside
      ref={panelRef}
      className={`tg-side-panel${open ? " open" : ""}`}
      aria-hidden={!open}
    >
      <div
        className="tg-sp-resize"
        onMouseDown={beginResize}
        title="Drag to resize the panel"
        role="separator"
        aria-orientation="vertical"
      >
        <span className="tg-sp-grip" aria-hidden="true" />
      </div>
      {form && (
        <>
          <div className="tg-sp-head">
            <span className="tg-sp-title">Task</span>
            <button className="tg-sp-close" onClick={onClose} title="Close (Esc)">×</button>
          </div>

          <label className="tg-sp-label">Name</label>
          <input
            className="tg-sp-input"
            type="text"
            value={form.project}
            onChange={(e) => set("project", e.target.value)}
          />

          <label className="tg-sp-label">Assignee</label>
          {editMode ? (
            <div className="tg-sp-assignee">
              <span className="tg-dot" style={{ background: assigneeColor }} />
              <select
                className="tg-sp-input tg-sp-select"
                value={form.engineer_id ?? ""}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  set("engineer_id", next);
                  // Staged immediately rather than held until Apply: the point
                  // of reassigning is to see the task land in the new lane, and
                  // the change queue is what makes that optimistic move happen
                  // (and stay undoable / saveable) without a refetch.
                  if (next !== assignment.engineer_id) onApply(assignment.id, { engineer_id: next });
                }}
              >
                {(engineers || []).map((eng) => (
                  <option key={eng.id} value={eng.id}>{eng.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="tg-sp-assignee tg-sp-assignee-ro">
              <span className="tg-dot" style={{ background: assigneeColor }} />
              <span>{assignee?.name || "—"}</span>
            </div>
          )}

          <label className="tg-sp-label">Start date</label>
          <input
            className="tg-sp-input"
            type="date"
            value={form.start_date}
            onChange={(e) => set("start_date", e.target.value)}
          />

          <label className="tg-sp-label">Est. days</label>
          <input
            className="tg-sp-input"
            type="number"
            min="1"
            value={form.est_days}
            onChange={(e) => set("est_days", e.target.value)}
          />

          <label className="tg-sp-label">Progress — {form.percent}%</label>
          <input
            className="tg-sp-range"
            type="range"
            min="0"
            max="100"
            value={form.percent}
            onChange={(e) => set("percent", Number(e.target.value))}
          />

          <label className="tg-sp-label">Status</label>
          <div className="tg-sp-status">
            {PANEL_STATUSES.map((s) => (
              <button
                key={s}
                className={s === form.status ? "on" : ""}
                onClick={() => set("status", s)}
              >{s}</button>
            ))}
          </div>

          <label className="tg-sp-label">Description</label>
          <textarea
            className="tg-sp-textarea"
            rows={4}
            placeholder="Add description… / Добавить описание…"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
          />

          <div className="tg-sp-actions">
            <button className="tg-btn tg-sp-apply" onClick={apply}>Apply</button>
            <button
              className="tg-btn tg-sp-delete"
              onClick={() => { if (assignment) { onDelete(assignment.id); onClose() } }}
            >Delete</button>
          </div>
        </>
      )}
    </aside>
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
  // "active" = the live board; "done" = a read-only archive of closed work.
  // Purely a filter over the data already in state — switching never refetches.
  const [view, setView] = useState("active");
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
  const [newItemHours, setNewItemHours] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // backlog item.id awaiting delete confirm
  const scrollRef = useRef(null); // the board scrollport — the only scrolling region
  const autoScrollRef = useRef(null); // { speed, rafId } while a drag is near a scrollport edge
  const clickPointerDownRef = useRef(null); // {x,y} on mousedown, to tell a click from a completed drag (backlog rows + gantt bars)

  const [detailTarget, setDetailTarget] = useState(null); // {type:"backlog"|"gantt", id} shown in the shared task-detail modal, or null
  const [selectedId, setSelectedId] = useState(null); // assignment shown in the right-side edit panel (edit mode only)
  // Collapsed by default so the board gets the height; the choice is
  // remembered per browser. Reads are wrapped because localStorage throws
  // outright in some privacy modes rather than just returning null.
  // Panel width lives here rather than in TaskSidePanel: the board's
  // padding-right has to reserve exactly the same number of pixels, or a
  // widened panel sits on top of the timeline again.
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(PANEL_WIDTH_KEY), 10);
      return Number.isFinite(saved) ? clampPanelWidth(saved) : PANEL_MIN_W;
    } catch {
      return PANEL_MIN_W;
    }
  });

  const [blCollapsed, setBlCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(BACKLOG_COLLAPSED_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [blSearch, setBlSearch] = useState("");
  const [blSearchDebounced, setBlSearchDebounced] = useState("");
  const [blPriorityFilter, setBlPriorityFilter] = useState([]); // selected priority chip values; [] = all
  const [blOwnerFilter, setBlOwnerFilter] = useState(""); // "" = все

  // Draft layer: nothing in edit mode writes to the backend until Save. Every
  // action pushes onto changeQueue; computeDraftState (below) replays it on
  // top of the last-fetched data/backlog to produce what's rendered.
  const [changeQueue, setChangeQueue] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const tempCounterRef = useRef(0);
  const nextTempId = () => `tmp-${++tempCounterRef.current}`;

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

  useEffect(() => {
    const t = setTimeout(() => setBlSearchDebounced(blSearch), 200);
    return () => clearTimeout(t);
  }, [blSearch]);

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

  // Every editing action below stages a change instead of writing to the
  // backend — nothing is sent until Save (see saveChanges). editMode itself
  // is already password-gated at entry (enableEdit), so these no longer need
  // to re-check the password per action.
  function pushChange(change) {
    setChangeQueue((q) => [...q, change]);
  }

  function updateAssignment(id, patch) {
    // Strip undefined before staging. JSON.stringify drops those keys, so a
    // patch built from an absent value (e.g. `{ note: patch.body }` when the
    // body wasn't edited) would reach the API as `fields: {}` and fail the
    // whole atomic batch with "No valid fields" — taking every unrelated
    // change in the queue down with it.
    const fields = Object.fromEntries(
      Object.entries(patch || {}).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(fields).length === 0) return;
    pushChange({ type: "gantt_update", id, fields });
  }
  function deleteAssignment(id) {
    // No confirm() here — the deletion is only staged; Undo/Discard cover it
    // until Save actually commits anything.
    pushChange({ type: "gantt_delete", id });
  }
  function addAssignment(engineerId) {
    pushChange({
      type: "gantt_create",
      tempId: nextTempId(),
      fields: {
        engineer_id: engineerId, project: "New project",
        start_date: toISODate(today), est_days: 10, percent: 0, status: "active",
      },
    });
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

  // Same draft-queue path as every other edit-mode action below — never a
  // direct write. editMode is already password-gated at entry (enableEdit).
  function setVisibility(engineerId, hidden) {
    pushChange({ type: "engineer_visibility", engineerId, hidden });
  }

  /* ---------------- backlog: sheet sync, reorder + drag-to-assign ---------------- */

  // No password — a viewer can always refresh from the already-configured URL.
  // Blocked while there are unsaved changes: a sync can add/update backlog
  // rows the draft doesn't know about, which would conflict with it.
  async function syncBacklog() {
    if (changeQueue.length > 0) {
      setBacklogError("сохраните или отмените изменения");
      return;
    }
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

  function createBacklogItem() {
    const title = newItemTitle.trim();
    if (!title) return;
    const fields = { title, priority: newItemPriority };
    const hours = Number(newItemHours);
    if (newItemHours.trim() !== "" && Number.isFinite(hours) && hours > 0 && hours <= 999) {
      fields.est_hours = hours;
    }
    pushChange({ type: "backlog_create", tempId: nextTempId(), fields });
    setNewItemTitle("");
    setNewItemHours("");
    setAddingItem(false);
  }

  function updateBacklogItem(id, patch) {
    pushChange({ type: "backlog_update", id, fields: patch });
  }

  /* ---------------- draft queue: undo / discard / save ---------------- */

  function undoChange() {
    setChangeQueue((q) => {
      if (q.length === 0) return q;
      const last = q[q.length - 1];
      if (last.groupId == null) return q.slice(0, -1);
      // Compound action (e.g. assign-to-hidden-engineer) — pop the whole
      // trailing run sharing this groupId so Undo reverts it atomically.
      let i = q.length;
      while (i > 0 && q[i - 1].groupId === last.groupId) i--;
      return q.slice(0, i);
    });
  }

  function discardChanges() {
    if (changeQueue.length === 0) return;
    if (!confirm("Отменить все несохранённые изменения?")) return;
    setChangeQueue([]);
    setSaveError(null);
  }

  function parseApplyChangesError(rawMessage) {
    try {
      const parsed = JSON.parse(rawMessage);
      const detail = parsed.detail;
      if (detail && typeof detail === "object" && "failed_index" in detail) {
        return `Изменение #${detail.failed_index + 1} не применено: ${detail.error}`;
      }
      if (typeof detail === "string") return detail;
    } catch {
      // rawMessage wasn't JSON — fall through to the raw text below
    }
    return rawMessage || "Save failed";
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
      setBacklogToast(`Сохранено: ${res.applied ?? count} изменений`);
      setTimeout(() => setBacklogToast(""), 5000);
      await load();
    } catch (err) {
      // Queue stays intact on failure — nothing here was committed.
      setSaveError(parseApplyChangesError(err.message));
    } finally {
      setSaving(false);
    }
  }

  // Edge auto-scroll while dragging a backlog row — reorder targets further
  // down the table, or a lane drop target scrolled out of view above, are
  // otherwise unreachable since the page itself never scrolls on dragover.
  const AUTOSCROLL_EDGE = 80;
  const AUTOSCROLL_MAX_SPEED = 20;

  function updateAutoScroll(clientY) {
    // Edges come from the board scrollport, not the window: the shell is
    // height-locked with overflow:hidden, so the window never scrolls and
    // window.innerHeight / window.scrollBy would both be inert here.
    const el = scrollRef.current;
    if (!el) return;
    const { top, bottom } = el.getBoundingClientRect();
    let speed = 0;
    if (clientY < top + AUTOSCROLL_EDGE) {
      speed = -Math.ceil(((top + AUTOSCROLL_EDGE - clientY) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED);
    } else if (clientY > bottom - AUTOSCROLL_EDGE) {
      speed = Math.ceil(((clientY - (bottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED);
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
      scrollRef.current?.scrollBy(0, state.speed);
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

  // Core of every backlog move (drag within/across blocks, priority dropdown):
  // draggingId is repositioned within groupedBacklog at buildIndex(filtered)
  // (filtered = groupedBacklog without the dragged item). Crossing into a
  // different rank changes priority too — staged as one groupId so Undo
  // reverts the move and the priority together (same mechanism as
  // assignBacklogItem's hidden-engineer compound change below).
  function moveBacklogItem(draggingId, targetRank, buildIndex, { toast = true } = {}) {
    const dragItem = groupedBacklog.find((b) => b.id === draggingId);
    if (!dragItem) return;
    const filtered = groupedBacklog.filter((b) => b.id !== draggingId);
    const toIdx = buildIndex(filtered);
    const dragRank = priorityRank(dragItem.priority);
    const crossedBlock = targetRank !== dragRank;
    const newPriority = BACKLOG_PRIORITIES[targetRank];
    const movedItem = crossedBlock ? { ...dragItem, priority: newPriority } : dragItem;
    filtered.splice(toIdx, 0, movedItem);
    const orderedIds = filtered.map((b) => b.id);
    if (crossedBlock) {
      const groupId = nextTempId();
      pushChange({ type: "backlog_update", id: draggingId, fields: { priority: newPriority }, groupId });
      pushChange({ type: "backlog_reorder", orderedIds, groupId });
      if (toast) {
        setBacklogToast(`Приоритет: ${dragItem.priority} → ${newPriority}`);
        setTimeout(() => setBacklogToast(""), 4000);
      }
    } else {
      pushChange({ type: "backlog_reorder", orderedIds });
    }
  }

  function changeBacklogPriority(item, newPriority) {
    if (newPriority === item.priority) return;
    const targetRank = priorityRank(newPriority);
    moveBacklogItem(
      item.id,
      targetRank,
      (filtered) => {
        const idx = filtered.findIndex((b) => priorityRank(b.priority) > targetRank);
        return idx === -1 ? filtered.length : idx;
      },
      { toast: false }
    );
  }

  // Reorder/assign drag is disabled while any backlog filter is active —
  // dropping between rows hidden by the filter would produce a surprising
  // order (see the `bl-filter-hint` shown next to the filter bar).
  function handleBacklogRowDragStart(e, itemId) {
    if (!editMode || hasActiveBacklogFilter) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(itemId));
    setBacklogDragId(itemId);
  }

  function handleBacklogRowDragOver(e, itemId) {
    if (!editMode || hasActiveBacklogFilter || backlogDragId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    updateAutoScroll(e.clientY);
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY - rect.top < rect.height / 2 ? "above" : "below";
    setBacklogOverRow((prev) => (prev && prev.id === itemId && prev.pos === pos ? prev : { id: itemId, pos }));
  }

  function handleBacklogRowDrop(e, targetId) {
    if (!editMode || hasActiveBacklogFilter) return;
    e.preventDefault();
    e.stopPropagation();
    const draggingId = backlogDragId;
    const pos = backlogOverRow?.pos || "above";
    clearBacklogDrag();
    if (draggingId == null || draggingId === targetId) return;
    const targetItem = groupedBacklog.find((b) => b.id === targetId);
    if (!targetItem) return;
    moveBacklogItem(draggingId, priorityRank(targetItem.priority), (filtered) => {
      let idx = filtered.findIndex((b) => b.id === targetId);
      if (idx === -1) idx = filtered.length;
      return pos === "below" ? idx + 1 : idx;
    });
  }

  // Dropping onto a group header counts as dropping at the top of that block.
  function handleBacklogHeaderDragOver(e) {
    if (!editMode || hasActiveBacklogFilter || backlogDragId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    updateAutoScroll(e.clientY);
  }

  function handleBacklogHeaderDrop(e, rank) {
    if (!editMode || hasActiveBacklogFilter) return;
    e.preventDefault();
    e.stopPropagation();
    const draggingId = backlogDragId;
    clearBacklogDrag();
    if (draggingId == null) return;
    moveBacklogItem(draggingId, rank, (filtered) => {
      const idx = filtered.findIndex((b) => priorityRank(b.priority) >= rank);
      return idx === -1 ? filtered.length : idx;
    });
  }

  function assignBacklogItem(itemId, engineerId, startDateIso) {
    const tempId = nextTempId();
    // Preview the same active-vs-queued heuristic the backend will apply at
    // Save time, so the toast matches what the pending bar shows right away.
    const eng = draft.engineers.find((e) => e.id === engineerId);
    const hasActive = eng ? eng.assignments.some((a) => a.status === "active") : false;
    const name = eng?.name || "engineer";
    const wasHidden = !!eng?.hidden;
    // Assigning to a hidden engineer un-hides them — staged as a second
    // change sharing a groupId, so Undo reverts both together (see undoChange).
    const groupId = wasHidden ? nextTempId() : undefined;
    pushChange({ type: "backlog_assign", tempId, backlogId: itemId, engineerId, startDate: startDateIso, groupId });
    if (wasHidden) pushChange({ type: "engineer_visibility", engineerId, hidden: false, groupId });
    setBacklogToast(wasHidden ? `${name}: показан на доске` : (hasActive ? `В очередь: ${name}` : `Назначено: ${name}`));
    setTimeout(() => setBacklogToast(""), 5000);
  }
  function deleteBacklogItem(itemId) {
    pushChange({ type: "backlog_delete", id: itemId });
    setConfirmDeleteId(null);
    setBacklogToast("Удалено (не вернётся при синке)");
    setTimeout(() => setBacklogToast(""), 5000);
  }

  /* ---------------- shared: row/bar click → task detail modal ---------------- */
  // A click opens the modal, UNLESS the pointer moved more than 5px between
  // mousedown and click (i.e. it was a completed drag, not a click). Shared
  // by backlog rows and Gantt bars — see wasRealClick's call sites.
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

  // A backlog row click opens the modal, UNLESS the click landed on an
  // interactive control (priority chip/select, assign select, delete button,
  // drag grip) or it was a completed drag (see wasRealClick).
  function handleBacklogRowClick(e, item) {
    if (e.target.closest("button, select, .bl-grip")) return;
    if (!wasRealClick(e)) return;
    setDetailTarget({ type: "backlog", id: item.id });
  }

  function openGanttDetail(assignmentId) {
    setDetailTarget({ type: "gantt", id: assignmentId });
  }

  function closeTaskDetail() {
    setDetailTarget(null);
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
    } else if (info.kind === "resize-left") {
      // The right edge is pinned, so moving the start absorbs the delta into
      // est_days. colEnd is exclusive; colEnd - 1 is the last covered column.
      const endCol = info.colEnd - 1;
      const newStartDate = colToDate(Math.min(endCol, info.colStart + info.deltaCols), rangeStart);
      const endDate = colToDate(endCol, rangeStart);
      const newStart = toISODate(newStartDate);
      if (info.isQueued) patch.queue_start = newStart;
      else patch.start_date = newStart;
      patch.est_days = Math.max(1, workingDaysElapsed(newStartDate, endDate));
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
      if (e.key === "Escape") {
        if (dragRef.current) {
          dragRef.current = null;
          setDragVisual(null);
          document.body.style.userSelect = "";
        }
        setLinkingFor(null);
        return;
      }
      if (editMode && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        // Don't hijack native undo while the user is editing text somewhere.
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
      stopAutoScroll();
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

  // The rendered view = last-fetched base data with changeQueue replayed on
  // top. In view mode changeQueue is always empty, so draft === base exactly.
  const draft = useMemo(
    () => computeDraftState(data.engineers, backlog, changeQueue),
    [data.engineers, backlog, changeQueue]
  );

  // Display order for the backlog table: always grouped into priority blocks
  // (P0→P1→P2→ENABLER→GATED), manual order preserved within a block. A stable
  // sort (JS Array.sort) makes this the single source of truth for both
  // rendering and drag math, independent of whatever order draft.backlogItems
  // happens to be in (e.g. right after a backlog_create appends to the end).
  const groupedBacklog = useMemo(() => {
    return [...(draft.backlogItems || [])].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  }, [draft.backlogItems]);

  // Flattened render list: a non-draggable group-header entry before the
  // first item of each priority rank actually present, then items with a
  // continuous `num` (headers aren't counted in the # column). Computed over
  // the FULL unfiltered set so `num` is always the row's true position —
  // filtering (below) only hides rows, it never renumbers them.
  const backlogRowsAll = useMemo(() => {
    const rows = [];
    let lastRank = null;
    let num = 0;
    for (const item of groupedBacklog) {
      const rank = priorityRank(item.priority);
      if (rank !== lastRank) {
        rows.push({ kind: "header", rank, label: PRIORITY_BLOCK_LABELS[BACKLOG_PRIORITIES[rank]] });
        lastRank = rank;
      }
      num += 1;
      rows.push({ kind: "item", item, num });
    }
    return rows;
  }, [groupedBacklog]);

  const distinctBacklogOwners = useMemo(() => {
    const set = new Set();
    for (const b of groupedBacklog) if (b.owner) set.add(b.owner);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [groupedBacklog]);

  const hasActiveBacklogFilter =
    blPriorityFilter.length > 0 || blOwnerFilter !== "" || blSearchDebounced.trim() !== "";

  function matchesBacklogFilters(item) {
    if (blPriorityFilter.length && !blPriorityFilter.some((p) => priorityRank(item.priority) === priorityRank(p))) {
      return false;
    }
    if (blOwnerFilter && !(item.owner || "").toLowerCase().includes(blOwnerFilter.toLowerCase())) return false;
    if (blSearchDebounced.trim()) {
      const q = blSearchDebounced.trim().toLowerCase();
      const haystack = `${item.title || ""} ${item.description || ""} ${item.source || ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }

  const visibleBacklogIds = useMemo(() => {
    return new Set(groupedBacklog.filter(matchesBacklogFilters).map((b) => b.id));
  }, [groupedBacklog, blPriorityFilter, blOwnerFilter, blSearchDebounced]);

  // Filtering only hides rows — a group header survives only if at least one
  // of the item rows following it (before the next header) is still visible,
  // and every surviving item keeps the `num` it had in backlogRowsAll.
  const backlogRows = useMemo(() => {
    if (!hasActiveBacklogFilter) return backlogRowsAll;
    const kept = [];
    for (let i = 0; i < backlogRowsAll.length; i++) {
      const row = backlogRowsAll[i];
      if (row.kind === "item") {
        if (visibleBacklogIds.has(row.item.id)) kept.push(row);
        continue;
      }
      let hasVisible = false;
      for (let j = i + 1; j < backlogRowsAll.length && backlogRowsAll[j].kind === "item"; j++) {
        if (visibleBacklogIds.has(backlogRowsAll[j].item.id)) { hasVisible = true; break; }
      }
      if (hasVisible) kept.push(row);
    }
    return kept;
  }, [backlogRowsAll, hasActiveBacklogFilter, visibleBacklogIds]);

  function toggleBacklogPriorityFilter(p) {
    setBlPriorityFilter((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  function resetBacklogFilters() {
    setBlSearch("");
    setBlSearchDebounced("");
    setBlPriorityFilter([]);
    setBlOwnerFilter("");
  }

  // Looked up from the full (unfiltered) draft list — the modal must still
  // find the item even if a filter is currently hiding its row, and it stays
  // "live" across Save/Undo since it's derived from draft, not a snapshot.
  const detailBacklogItem = useMemo(() => {
    if (detailTarget?.type !== "backlog") return null;
    return (draft.backlogItems || []).find((b) => b.id === detailTarget.id) || null;
  }, [draft.backlogItems, detailTarget]);

  const sortedEngineers = useMemo(() => {
    return [...(draft.engineers || [])].sort((a, b) => {
      const diff = (aiMap[b.id] || 0) - (aiMap[a.id] || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [draft.engineers, aiMap]);

  // Viewers never see hidden lanes; edit mode shows everything so the admin
  // keeps full context while managing visibility.
  const boardEngineers = useMemo(
    () => (editMode ? sortedEngineers : sortedEngineers.filter((e) => !e.hidden)),
    [sortedEngineers, editMode]
  );

  const { lanes, totalRows, rowSizes } = useMemo(
    () => buildLanes(boardEngineers, rangeStart, today, { addRow: editMode, view }),
    [boardEngineers, rangeStart, today, editMode, view]
  );

  // Reflects the last SAVED state, not the draft — a purely-local pending
  // change has no updated_at from the server yet.
  const lastUpdated = useMemo(() => {
    let max = null;
    for (const e of data.engineers || [])
      for (const a of e.assignments || [])
        if (a.updated_at && (!max || a.updated_at > max)) max = a.updated_at;
    return max;
  }, [data.engineers]);

  const assignmentsById = useMemo(() => {
    const m = {};
    for (const e of draft.engineers || [])
      for (const a of e.assignments || []) m[a.id] = a;
    return m;
  }, [draft.engineers]);

  // The shell is viewport-height, so the document itself must not scroll —
  // otherwise the sticky timeline header pins to the browser viewport and
  // slides over the toolbar. Reverted on unmount so other routes are untouched.
  useEffect(() => {
    document.body.classList.add("tg-viewport-lock");
    return () => document.body.classList.remove("tg-viewport-lock");
  }, []);

  // Persist the dock state. Writes are guarded for the same reason reads are.
  useEffect(() => {
    try { localStorage.setItem(BACKLOG_COLLAPSED_KEY, String(blCollapsed)) } catch { /* storage unavailable */ }
  }, [blCollapsed]);

  const toggleBacklog = () => setBlCollapsed((v) => !v);

  // The header doubles as the expand target, but it also hosts the filters,
  // "+ item" and Sync — so a click that landed on any control is left alone.
  function handleBacklogHeaderClick(e) {
    if (e.target.closest("input, select, button, a")) return;
    toggleBacklog();
  }

  const doneView = view === "done";

  // The Done tab is read-only, so entering it leaves edit mode. Unsaved work
  // is guarded exactly the way the Edit-mode toggle guards it — never dropped
  // silently just because the user clicked a tab.
  function switchView(next) {
    if (next === view) return;
    if (next === "done" && editMode) {
      if (changeQueue.length > 0 && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
      setChangeQueue([]);
      setSaveError(null);
      setEditMode(false);
      setManageOpen(false);
      setPendingHideId(null);
      setLinkingFor(null);
    }
    setSelectedId(null);
    setView(next);
  }

  // Counts what the current tab shows, so the status bar agrees with the board.
  const taskCount = useMemo(
    () => (draft.engineers || []).reduce(
      (n, e) => n + (e.assignments || []).filter(
        (a) => (a.status === "done") === doneView
      ).length,
      0
    ),
    [draft.engineers, doneView]
  );

  // The toolbar's "Add task" has no lane of its own to add to, so it follows
  // the selection: whichever engineer owns the currently selected task.
  const selectedEngineerId = useMemo(() => {
    if (selectedId == null) return null;
    for (const e of draft.engineers || [])
      if ((e.assignments || []).some((a) => a.id === selectedId)) return e.id;
    return null;
  }, [draft.engineers, selectedId]);

  // Index of every rendered bar by assignment id, for the Gantt task-detail
  // modal's meta grid — reuses the exact dayX/estY/startDate the visible bar
  // already computed rather than recomputing the date math a second time.
  const barInfoByAssignmentId = useMemo(() => {
    const m = {};
    for (const { engineer: eng, bars } of lanes) {
      for (const b of bars) {
        if (b.assignment) m[b.assignment.id] = { bar: b, engineerName: eng.name };
      }
    }
    return m;
  }, [lanes]);

  const detailAssignmentInfo = useMemo(() => {
    if (detailTarget?.type !== "gantt") return null;
    const assignment = assignmentsById[detailTarget.id];
    const info = barInfoByAssignmentId[detailTarget.id];
    if (!assignment || !info) return null;
    return { assignment, bar: info.bar, engineerName: info.engineerName };
  }, [detailTarget, assignmentsById, barInfoByAssignmentId]);

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

  // Keyed on `lanes`, not `data`: `data` is the last server fetch, so a staged
  // draft change (create, delete, status flip, backlog assign) moved bars
  // without ever redrawing the arrows. `lanes` changes identity on every draft
  // edit, and now also whenever row indices shift.
  useLayoutEffect(() => { recomputeArrows() }, [lanes, dragVisual, editMode]);
  useEffect(() => {
    function onResize() { recomputeArrows() }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [lanes]);

  // Rows 1-2 are the sticky week/day header; the rest come straight from
  // buildLanes, which mixes fixed group-header/add-row tracks with auto task rows.
  const gridTemplateRows = `22px 22px ${rowSizes.join(" ")}`;

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
    <div
      className={`tg-wrap${editMode && selectedId != null ? " tg-wrap-panel" : ""}`}
      style={{ "--tg-panel-w": `${panelWidth}px` }}
    >
      <Style />

      <div className="tg-head">
        <Link to="/" className="tg-back" title="Back to dashboard">←</Link>
        <h1 className="tg-title">Team Gantt</h1>

        <span className="tg-sep" />
        <div className="tg-tabs" role="tablist">
          {["active", "done"].map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`tg-tab${view === v ? " on" : ""}`}
              onClick={() => switchView(v)}
            >{v === "active" ? "Active" : "Done"}</button>
          ))}
        </div>

        <div className="tg-controls">
          <button className="tg-btn" onClick={syncFromReports}>⟳ Sync from reports</button>
          {editMode && (
            <button className="tg-btn" onClick={() => setManageOpen(true)}>👥 Manage engineers</button>
          )}

          {/* Edit-only actions stay mounted in viewer mode but inert, so the
           * toolbar doesn't reflow when the mode flips. The Done tab is a
           * read-only archive, so they're dropped entirely there. */}
          {!doneView && <span className="tg-sep" />}
          {!doneView && <div className={`tg-actions${editMode ? "" : " tg-actions-off"}`}>
            <button
              className="tg-btn"
              onClick={() => { if (selectedEngineerId != null) addAssignment(selectedEngineerId) }}
              disabled={selectedEngineerId == null}
              title={selectedEngineerId == null
                ? "Select a task first — the new task is added to its engineer"
                : "Add a task for the selected task's engineer"}
            >+ Add task</button>
            <button
              className="tg-btn"
              onClick={() => { if (selectedId != null) { deleteAssignment(selectedId); setSelectedId(null) } }}
              disabled={selectedId == null}
              title={selectedId == null ? "Select a bar first" : "Delete the selected task"}
            >🗑 Delete selected</button>
            <span className="tg-sep" />
            <button
              className="tg-btn"
              onClick={undoChange}
              disabled={changeQueue.length === 0}
              title="Undo last change (Ctrl+Z)"
            >↶ Undo</button>
            <button
              className="tg-btn tg-btn-discard"
              onClick={discardChanges}
              disabled={changeQueue.length === 0}
            >Отменить всё</button>
            <button
              className={`tg-btn tg-btn-save${changeQueue.length > 0 ? " on" : ""}`}
              onClick={saveChanges}
              disabled={changeQueue.length === 0 || saving}
            >
              {saving ? "Saving…" : `Save${changeQueue.length > 0 ? ` (${changeQueue.length})` : ""}`}
            </button>
          </div>}
          {!doneView && <span className="tg-sep" />}

          {!doneView && <button
            className={`tg-btn${editMode ? " on" : ""}`}
            onClick={() => {
              if (editMode) {
                if (changeQueue.length > 0 && !confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
                setChangeQueue([]);
                setSaveError(null);
                setEditMode(false); setManageOpen(false); setPendingHideId(null); setLinkingFor(null);
                setSelectedId(null);
              } else enableEdit();
            }}
          >
            {editMode ? "✓ Editing" : "✎ Edit mode"}
          </button>}
          <button className="tg-icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {/* Alerts sit in their own non-scrolling strip so they never push the
       * board out of the viewport-height shell. */}
      {(syncMsg || error || pwError || saveError || linkingFor != null) && (
        <div className="tg-alerts">
          {syncMsg && <div className="tg-toast">{syncMsg}</div>}
          {(error || pwError) && <div className="card tg-error">{error || pwError}</div>}
          {saveError && <div className="card tg-error">{saveError}</div>}
          {linkingFor != null && (
            <div className="tg-toast tg-toast-link">
              🔗 Click the predecessor bar… (Escape to cancel)
            </div>
          )}
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
              {(draft.engineers || []).map((eng) => {
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

      <div className="tg-scroll" ref={scrollRef}>
        <div
          ref={gridRef}
          className={`tg-grid${doneView ? " tg-view-done" : ""}`}
          style={{ gridTemplateColumns: `300px repeat(${DAY_COLS}, minmax(22px,1fr))`, gridTemplateRows }}
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
          <div className="tg-name-header" style={{ gridColumn: 1, gridRow: "1 / 3" }}>
            <span />
            <span>Task</span>
            <span>Status</span>
            <span className="tg-hdr-pct">{doneView ? "Closed" : "%"}</span>
          </div>

          {/* header: week labels */}
          {weeks.map((monday, i) => (
            <div key={`w-${i}`} className="tg-week-cell" style={{ gridColumn: `${2 + i * 7} / ${9 + i * 7}`, gridRow: 1 }}>
              W{isoWeekNum(monday)} · {weekRangeLabel(monday)}
            </div>
          ))}

          {/* header: day numbers */}
          {days.map((d, i) => (
            <div
              key={`d-${i}`}
              className={`tg-day-cell${isWeekend(d) ? " weekend" : ""}${i === todayIdx ? " today" : ""}`}
              style={{ gridColumn: i + 2, gridRow: 2 }}
            >
              {d.getDate()}
            </div>
          ))}

          {/* lanes */}
          {lanes.map(({ engineer: e, headerRow, firstBarRow, addBtnRow, blockEnd, bars }) => {
            const color = e.avatar_color || e.color || "var(--accent1)";
            const blockSpan = `${headerRow} / ${blockEnd}`;

            return (
              <div key={e.id} style={{ display: "contents" }}>
                {/* Full-width row separator: the sticky left pane draws its own
                 * border-bottom (opaque background, so it must paint its own
                 * line rather than reveal one underneath); this covers the
                 * rest — the entire scrollable timeline — with the identical
                 * border style so the two segments read as one continuous line.
                 * A plain grid item stretches across its whole column/row span
                 * regardless of scroll position, so it isn't clipped to the
                 * viewport. One per engineer, drawn below their whole block. */}
                <div
                  className="tg-row-divider"
                  style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow: blockSpan }}
                />

                {/* group header — engineer name (left pane) + a band across the
                 * timeline so the row reads as one unit at any scroll offset */}
                <div className="tg-group-name" style={{ gridColumn: 1, gridRow: headerRow }}>
                  <span className="tg-dot" style={{ background: color }} />
                  <span className="tg-eng-name">{e.name}</span>
                  <span className="tg-eng-count">{bars.filter((b) => b.assignment).length}</span>
                </div>
                <div
                  className="tg-group-band"
                  style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow: headerRow }}
                />

                {editMode && backlogDragId != null && (
                  <div
                    className={`tg-lane-drop${backlogOverEngineer === e.id ? " tg-lane-drop-over" : ""}`}
                    style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow: blockSpan }}
                    onDragEnter={(ev) => { ev.preventDefault(); setBacklogOverEngineer(e.id) }}
                    onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; updateAutoScroll(ev.clientY) }}
                    onDragLeave={() => setBacklogOverEngineer((cur) => (cur === e.id ? null : cur))}
                    onDrop={(ev) => handleLaneDrop(ev, e.id)}
                  />
                )}

                {bars.map((bar) => {
                  const row = firstBarRow + bar.subRow;
                  const key = bar.assignment ? bar.assignment.id : "idle";
                  return (
                    <Fragment key={key}>
                      <TaskRow
                        bar={bar}
                        gridRow={row}
                        editMode={editMode}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onUpdate={updateAssignment}
                        onOpenDetail={openGanttDetail}
                        beginClickTracking={beginClickTracking}
                        wasRealClick={wasRealClick}
                        setHoveredId={setHoveredId}
                        doneView={doneView}
                      />
                      <GanttBar
                        bar={bar}
                        color={color}
                        gridRow={row}
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
                        onOpenDetail={openGanttDetail}
                        beginClickTracking={beginClickTracking}
                        wasRealClick={wasRealClick}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    </Fragment>
                  );
                })}

                {addBtnRow != null && (
                  <button
                    className="tg-add-row"
                    style={{ gridColumn: 1, gridRow: addBtnRow }}
                    onClick={() => addAssignment(e.id)}
                  >+ Add task for {e.name}</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`bl-section${blCollapsed ? " bl-collapsed" : ""}`}>
        <div
          className="bl-head-row"
          onClick={handleBacklogHeaderClick}
          title={blCollapsed ? "Show backlog" : "Hide backlog"}
        >
          <button
            className="bl-collapse-btn"
            aria-expanded={!blCollapsed}
            aria-label={blCollapsed ? "Show backlog" : "Hide backlog"}
            onClick={toggleBacklog}
          >
            <span className={`bl-chevron${blCollapsed ? "" : " on"}`}>▸</span>
          </button>
          <h2 className="bl-title">Backlog</h2>
          <span className="bl-count">
            {hasActiveBacklogFilter
              ? `${visibleBacklogIds.size} of ${groupedBacklog.length}`
              : `${draft.backlogItems.length} item${draft.backlogItems.length === 1 ? "" : "s"}`}
          </span>

          {blCollapsed ? (
            <button
              className="bl-collapse-btn bl-collapse-end"
              aria-label="Show backlog"
              onClick={toggleBacklog}
            >▴</button>
          ) : (
          <>
          <div className="bl-filters">
            <input
              className="bl-filter-search"
              type="search"
              placeholder="поиск…"
              value={blSearch}
              onChange={(e) => setBlSearch(e.target.value)}
            />
            <div className="bl-filter-priorities">
              {BACKLOG_PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`bl-chip bl-filter-chip ${priorityChipClass(p)}${
                    blPriorityFilter.includes(p) ? " bl-filter-chip-active" : ""
                  }`}
                  onClick={() => toggleBacklogPriorityFilter(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <select
              className="bl-filter-owner"
              value={blOwnerFilter}
              onChange={(e) => setBlOwnerFilter(e.target.value)}
            >
              <option value="">все</option>
              {distinctBacklogOwners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {hasActiveBacklogFilter && (
              <button type="button" className="bl-filter-reset" onClick={resetBacklogFilters}>сбросить</button>
            )}
          </div>

          {editMode && (
            <button className="tg-btn" onClick={() => setAddingItem((v) => !v)}>+ item</button>
          )}
          <button
            className="tg-btn"
            onClick={syncBacklog}
            disabled={backlogSyncing || changeQueue.length > 0}
            title={changeQueue.length > 0 ? "сохраните или отмените изменения" : undefined}
          >
            {backlogSyncing ? "⟳ Syncing…" : "⟳ Sync from Sheet"}
          </button>
          <button
            className="bl-collapse-btn bl-collapse-end"
            aria-label="Hide backlog"
            onClick={toggleBacklog}
          >▾</button>
          </>
          )}
        </div>

        {!blCollapsed && editMode && hasActiveBacklogFilter && (
          <div className="bl-filter-hint">сбросьте фильтр, чтобы менять порядок</div>
        )}

        {!blCollapsed && <div className="bl-source-row">
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
        </div>}

        {!blCollapsed && backlogToast && <div className="tg-toast">{backlogToast}</div>}
        {!blCollapsed && backlogError && <div className="card tg-error">{backlogError}</div>}

        {!blCollapsed && <div className="bl-table-scroll">
          <table className="bl-table">
            <thead>
              <tr>
                <th className="bl-th-grip" />
                <th className="bl-th-num">#</th>
                <th>Project</th>
                <th>Результат</th>
                <th>Owner</th>
                <th className="bl-th-esth">Est, h</th>
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
                    <input
                      type="number" min="0.5" max="999" step="0.5"
                      className="bl-add-hours"
                      placeholder="hours"
                      value={newItemHours}
                      onChange={(e) => setNewItemHours(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createBacklogItem()}
                    />
                  </td>
                  <td>
                    <select
                      className="bl-add-select"
                      value={newItemPriority}
                      onChange={(e) => setNewItemPriority(e.target.value)}
                    >
                      {BACKLOG_PRIORITIES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td colSpan={5}>
                    <button className="bl-add-btn" onClick={createBacklogItem}>Add</button>
                    <button className="bl-add-btn" onClick={() => { setAddingItem(false); setNewItemTitle(""); setNewItemHours("") }}>Cancel</button>
                  </td>
                </tr>
              )}
              {draft.backlogItems.length === 0 && !addingItem && (
                <tr><td className="bl-empty" colSpan={editMode ? 12 : 10}>Backlog is empty</td></tr>
              )}
              {draft.backlogItems.length > 0 && backlogRows.length === 0 && (
                <tr><td className="bl-empty" colSpan={editMode ? 12 : 10}>Нет совпадений</td></tr>
              )}
              {backlogRows.map((row) => row.kind === "header" ? (
                <tr
                  key={`bl-hdr-${row.rank}`}
                  className="bl-group-header"
                  onDragOver={handleBacklogHeaderDragOver}
                  onDrop={(e) => handleBacklogHeaderDrop(e, row.rank)}
                >
                  <td className="bl-group-header-cell" colSpan={editMode ? 12 : 10}>{row.label}</td>
                </tr>
              ) : (
                <tr
                  key={row.item.id}
                  draggable={editMode && !hasActiveBacklogFilter}
                  className={`bl-row${backlogDragId === row.item.id ? " bl-row-dragging" : ""}${
                    backlogOverRow?.id === row.item.id ? ` bl-row-drop-${backlogOverRow.pos}` : ""
                  }${row.item.__pending ? " bl-row-pending" : ""}`}
                  onDragStart={(e) => handleBacklogRowDragStart(e, row.item.id)}
                  onDragOver={(e) => handleBacklogRowDragOver(e, row.item.id)}
                  onDrop={(e) => handleBacklogRowDrop(e, row.item.id)}
                  onDragEnd={clearBacklogDrag}
                  onMouseDown={beginClickTracking}
                  onClick={(e) => handleBacklogRowClick(e, row.item)}
                >
                  <td className="bl-td-grip">{editMode && <span className="bl-grip">⠿</span>}</td>
                  <td className="bl-td-num">{row.num}</td>
                  <td className="bl-td-title">
                    {row.item.title}
                    {row.item.__pending && <span className="tg-pending-badge bl-pending-badge" title="Unsaved change">unsaved</span>}
                  </td>
                  <td className="bl-td-result">
                    <span className="bl-clamp" title={row.item.description}>{row.item.description}</span>
                  </td>
                  <td className="bl-td-owner">{row.item.owner}</td>
                  <td className="bl-td-esth">
                    <EstHoursCell
                      item={row.item}
                      editable={editMode}
                      onChange={(h) => updateBacklogItem(row.item.id, { est_hours: h })}
                    />
                  </td>
                  <td>
                    <PriorityCell
                      priority={row.item.priority}
                      editable={editMode}
                      onChange={(p) => changeBacklogPriority(row.item, p)}
                    />
                  </td>
                  <td className="bl-td-status">{row.item.status}</td>
                  <td className="bl-td-source">{row.item.source}</td>
                  <td className="bl-ist">{row.item.origin}</td>
                  {editMode && (
                    <td className="bl-td-assign">
                      <select
                        className="bl-assign-select"
                        value=""
                        onChange={(e) => {
                          const engId = e.target.value;
                          if (engId) assignBacklogItem(row.item.id, Number(engId), toISODate(today));
                        }}
                      >
                        <option value="">—</option>
                        {sortedEngineers.map((eng) => (
                          <option key={eng.id} value={eng.id}>{eng.name}{eng.hidden ? " (hidden)" : ""}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {editMode && (
                    <td className="bl-td-del">
                      {confirmDeleteId === row.item.id ? (
                        <span className="bl-confirm-del">
                          <span className="bl-confirm-text">точно удалить?</span>
                          <button className="bl-del-btn warn" onClick={() => deleteBacklogItem(row.item.id)}>Да</button>
                          <button className="bl-del-btn" onClick={() => setConfirmDeleteId(null)}>Нет</button>
                        </span>
                      ) : (
                        <button
                          className="bl-del-btn"
                          title="Delete from backlog"
                          onClick={() => setConfirmDeleteId(row.item.id)}
                        >×</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>

      {editMode && (
        <div className="tg-hintbar">
          Drag bars to move · Drag edges to resize · Click a bar or row to edit
        </div>
      )}

      <div className="tg-statusbar">
        <span>{taskCount} task{taskCount === 1 ? "" : "s"} · {lanes.length} engineer{lanes.length === 1 ? "" : "s"}</span>
        <span className="tg-legend">
          <span><i className="sw solid" /> active</span>
          <span><i className="sw dash" /> queued</span>
          <span><i className="sw red" /> idle</span>
          <span><i className="sw amber" /> overdue</span>
          <span><i className="sw done" /> done</span>
        </span>
        <span className="tg-status-right">
          {lastUpdated && (
            <span>Updated {lastUpdated.slice(0, 16).replace("T", " ")} UTC</span>
          )}
          <span>
            {editMode
              ? (changeQueue.length > 0 ? `Edit mode — ${changeQueue.length} unsaved change${changeQueue.length === 1 ? "" : "s"}` : "Edit mode")
              : "View mode"}
          </span>
        </span>
      </div>

      {editMode && (
        <TaskSidePanel
          assignment={selectedId != null ? assignmentsById[selectedId] : null}
          engineers={draft.engineers || []}
          editMode={editMode}
          width={panelWidth}
          onWidthChange={setPanelWidth}
          onApply={updateAssignment}
          onDelete={deleteAssignment}
          onClose={() => setSelectedId(null)}
        />
      )}

      {detailBacklogItem && (
        <TaskDetailModal
          taskKey={`b-${detailBacklogItem.id}`}
          title={detailBacklogItem.title}
          titleEditable
          badge={<span className={`bl-chip ${priorityChipClass(detailBacklogItem.priority)}`}>{detailBacklogItem.priority}</span>}
          body={detailBacklogItem.description}
          meta={[
            { label: "Owner", value: detailBacklogItem.owner || "—" },
            { label: "Est", value: formatEstMeta(detailBacklogItem) },
            { label: "Статус / для старта", value: detailBacklogItem.status || "—" },
            { label: "База оценки / источник", value: detailBacklogItem.source || "—" },
            { label: "Ист.", value: detailBacklogItem.origin || "—" },
          ]}
          editable={editMode}
          onClose={closeTaskDetail}
          onSave={(patch) => updateBacklogItem(detailBacklogItem.id, {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.body !== undefined ? { description: patch.body } : {}),
          })}
        />
      )}

      {detailAssignmentInfo && (
        <TaskDetailModal
          taskKey={`g-${detailAssignmentInfo.assignment.id}`}
          title={detailAssignmentInfo.assignment.project || "Untitled"}
          titleEditable={false}
          badge={<GanttDetailBadge assignment={detailAssignmentInfo.assignment} />}
          body={detailAssignmentInfo.assignment.note}
          meta={ganttDetailMeta(detailAssignmentInfo.bar, detailAssignmentInfo.assignment, detailAssignmentInfo.engineerName)}
          editable={editMode}
          onClose={closeTaskDetail}
          onSave={(patch) => updateAssignment(detailAssignmentInfo.assignment.id, { note: patch.body })}
        />
      )}
    </div>
  );
}

/* ---------------- scoped styles ---------------- */

function Style() {
  return (
    <style>{`
      /* Viewport-filling shell: the board owns the only scrollport, so the
       * sticky timeline header pins to the board rather than to the browser
       * viewport. Scoped body lock (added/removed on mount) because
       * body{min-height:100vh} is shared with every other route. */
      .tg-viewport-lock{overflow:hidden}
      .tg-wrap{width:100%;max-width:none;margin:0;padding:0;height:100dvh;
        display:flex;flex-direction:column;overflow:hidden;background:var(--surface-0)}
      /* The side panel is position:fixed; on a full-bleed board it would sit on
       * top of real timeline and over the toolbar's Save button, so make room
       * for it while it's open. MUST stay after .tg-wrap — same specificity,
       * so declaring it earlier lets the padding:0 there win instead. */
      .tg-wrap-panel{padding-right:var(--tg-panel-w,200px)}
      .tg-loading{padding:60px 0;text-align:center;color:var(--muted)}
      .tg-error{color:var(--danger);padding:6px 12px;font-size:12px}

      .tg-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;
        padding:6px 12px;border-bottom:1px solid var(--border);background:var(--surface-1)}
      .tg-title{font-size:13px;font-weight:600;margin:0;letter-spacing:-.01em;white-space:nowrap}
      .tg-back{font-size:15px;color:var(--text-muted);text-decoration:none;padding:0 4px;line-height:1}
      .tg-back:hover{color:var(--text-accent)}
      .tg-controls{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}
      .tg-sep{width:1px;height:18px;background:var(--border-strong);flex:none}
      .tg-tabs{display:flex;align-items:center;gap:2px}
      .tg-tab{height:28px;padding:4px 12px;border:1px solid transparent;border-radius:var(--radius);
        background:none;color:var(--text-muted);font-family:inherit;font-size:11px;font-weight:500;cursor:pointer}
      .tg-tab:hover{color:var(--text);background:var(--surface-0)}
      .tg-tab.on{background:var(--bg-accent);color:var(--text-accent);border-color:var(--border-accent)}

      /* Done tab: a read-only archive. Bars are context for when the work sat,
       * not something to interact with, so they recede. */
      .tg-view-done .tg-bar{opacity:.4}
      .tg-view-done .tg-task-row{cursor:pointer}
      /* Every row here is closed, so a strike-through on all of them is noise. */
      .tg-view-done .tg-task-done .tg-task-name{text-decoration:none;color:var(--text)}
      /* "28 Aug" needs more room than "100%". */
      .tg-view-done .tg-task-row,
      .tg-view-done .tg-name-header{grid-template-columns:28px 1fr 72px 56px}
      .tg-actions{display:flex;align-items:center;gap:6px}
      .tg-actions-off{opacity:.4;pointer-events:none}
      .tg-alerts{flex:0 0 auto;display:flex;flex-direction:column;gap:4px;padding:6px 12px}

      .tg-hintbar{flex:0 0 auto;font-size:10px;color:var(--text-muted);background:var(--bg-accent);
        border-top:1px solid var(--border-accent);padding:4px 12px}
      .tg-statusbar{flex:0 0 auto;font-size:10px;color:var(--text-muted);background:var(--surface-1);
        border-top:1px solid var(--border);padding:4px 12px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
      .tg-status-right{margin-left:auto;display:flex;gap:16px;align-items:center}

      .tg-btn{height:28px;padding:4px 10px;border-radius:var(--radius);border:1px solid var(--border-strong);
        background:var(--surface-0);color:var(--text);font-size:11px;font-weight:500;cursor:pointer;
        font-family:inherit;display:flex;align-items:center;gap:4px;white-space:nowrap}
      .tg-btn.on{background:var(--accent1);color:var(--on-accent);border-color:var(--accent1)}
      .tg-btn:disabled{opacity:.4;cursor:not-allowed}
      .tg-btn-save.on{background:var(--fill-accent);border-color:var(--fill-accent);color:var(--on-accent)}
      .tg-btn-discard:not(:disabled){color:var(--danger);border-color:var(--danger)}
      .tg-icon-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px}
      .tg-toast{margin-top:12px;padding:8px 14px;border-radius:8px;background:rgba(34,197,94,.12);color:var(--success);font-size:12.5px;font-weight:600}
      .tg-toast-link{background:rgba(0,207,255,.12);color:var(--accent1)}

      .tg-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:var(--text-muted);align-items:center}
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

      /* Stacking order for the board. Sticky cells must outrank everything
       * that scrolls under them, and the corner must outrank both sticky axes:
       *   0  weekend columns, day cells
       *   1  today line, row dividers, group band
       *   2  bars (5 while inline-editing)
       *   6  dependency arrows
       *   8  backlog lane-drop overlay
       *   10 sticky timeline header (rows 1-2)
       *   20 sticky left pane (column 1)
       *   30 sticky corner (.tg-name-header)
       * .tg-bar-resize (11) and .tg-editor (10) live inside .tg-bar's own
       * stacking context, so they can't escape above the sticky pane. */
      .tg-scroll{flex:1 1 auto;min-height:0;overflow:auto}
      .tg-grid{display:grid;position:relative;min-width:1224px}
      .tg-arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;overflow:visible}

      /* corner: sticky on BOTH axes, so it holds the top-left while either
       * scrollbar moves. Same 4-col template as the task rows below it. */
      .tg-name-header{position:sticky;left:0;top:0;z-index:30;background:var(--surface-1);
        display:grid;grid-template-columns:28px 1fr 72px 40px;align-items:end;gap:0;
        padding:0 0 4px;border-bottom:1px solid var(--border);border-right:2px solid var(--border-strong)}
      .tg-name-header span{font-size:10px;font-weight:500;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.06em;padding:4px 6px}
      .tg-hdr-pct{text-align:right}

      .tg-week-cell{position:sticky;top:0;z-index:10;background:var(--surface-1);
        font-size:10px;font-weight:500;color:var(--text-secondary);padding:0 6px;
        border-bottom:1px solid var(--border);border-right:1px solid var(--border-strong);
        display:flex;align-items:center;white-space:nowrap;overflow:hidden}
      .tg-day-cell{position:sticky;top:22px;z-index:10;background:var(--surface-1);
        font-size:10px;color:var(--text-muted);text-align:center;
        border-bottom:1px solid var(--border);pointer-events:none;
        display:flex;align-items:center;justify-content:center}
      .tg-day-cell.weekend{opacity:.4}
      .tg-day-cell.today{color:var(--text-accent);font-weight:500;background:var(--bg-accent)}
      .tg-weekend-col{position:relative;background:var(--surface-1);opacity:.6;pointer-events:none;z-index:0}
      .tg-today-col{position:relative;pointer-events:none;z-index:1}
      .tg-today-line{position:absolute;left:50%;top:0;bottom:0;width:1.5px;background:var(--border-accent);transform:translateX(-50%);pointer-events:none}
      .tg-row-divider{position:relative;pointer-events:none;z-index:1;border-bottom:1px solid var(--border)}

      /* ---- left pane ---- */
      .tg-group-name{position:sticky;left:0;z-index:20;background:var(--surface-1);
        display:flex;align-items:center;gap:8px;padding:0 8px;
        border-bottom:1px solid var(--border);border-right:2px solid var(--border-strong)}
      .tg-group-band{background:var(--surface-1);border-bottom:1px solid var(--border);position:relative;z-index:1}
      .tg-dot{width:8px;height:8px;border-radius:50%;flex:none}
      .tg-eng-name{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tg-eng-count{margin-left:auto;font-size:10px;color:var(--text-muted);font-variant-numeric:tabular-nums}

      .tg-task-row{position:sticky;left:0;z-index:20;background:var(--surface-0);
        display:grid;grid-template-columns:28px 1fr 72px 40px;align-items:center;
        border-bottom:1px solid var(--border);border-right:2px solid var(--border-strong);cursor:pointer}
      .tg-task-row:hover{background:var(--surface-1)}
      .tg-task-selected,.tg-task-selected:hover{background:var(--bg-accent)}
      .tg-task-idle{cursor:default;opacity:.55}
      .tg-task-idle:hover{background:var(--surface-0)}
      .tg-task-name{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px}
      .tg-task-done .tg-task-name{color:var(--text-muted);text-decoration:line-through}
      .tg-task-pct{font-size:11px;color:var(--text-muted);text-align:right;padding-right:6px;font-variant-numeric:tabular-nums}
      .tg-pending-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--fill-accent);margin-left:5px;vertical-align:middle}

      .tg-check{width:13px;height:13px;border:1px solid var(--border-strong);border-radius:3px;
        margin:0 auto;display:flex;align-items:center;justify-content:center;color:var(--text-success)}
      .tg-check.on{background:var(--bg-success);border-color:var(--text-success)}
      .tg-check-live{cursor:pointer}

      .tg-pill{font-size:9px;padding:1px 5px;border-radius:20px;justify-self:start;
        white-space:nowrap;border:1px solid transparent}
      .tg-pill-active{background:var(--bg-accent);color:var(--text-accent)}
      .tg-pill-queued{background:transparent;color:var(--text-muted);border-color:var(--border-strong)}
      .tg-pill-done{background:var(--bg-success);color:var(--text-success)}
      .tg-pill-continuous{background:var(--bg-success);color:var(--text-success)}
      .tg-pill-overdue{background:#faeeda;color:#633806;border-color:#e8a838}
      .tg-pill-error{background:transparent;color:var(--danger);border-color:var(--danger)}

      .tg-add-row{position:sticky;left:0;z-index:20;background:var(--surface-0);
        border:none;border-bottom:1px solid var(--border);border-right:2px solid var(--border-strong);
        font-family:inherit;font-size:11px;color:var(--text-muted);text-align:left;
        padding:3px 6px 3px 34px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tg-add-row:hover{background:var(--surface-1);color:var(--text-accent)}

      .tg-bar{position:relative;z-index:2;align-self:center;min-height:16px;border-radius:3px;display:flex;align-items:center;padding:0 6px 0 8px;font-size:9px;font-weight:500;overflow:hidden;border:1px solid transparent;cursor:default}
      .tg-bar.tg-editing{position:relative;z-index:5;flex-direction:column;align-items:flex-start;padding:6px 8px;overflow:visible;min-height:auto}
      .tg-bar.tg-draggable{cursor:grab}
      .tg-bar.tg-draggable.tg-dragging{cursor:grabbing}
      /* Outline only in edit mode — in viewer mode a bar isn't a drag target,
       * so hover shouldn't advertise one. */
      .tg-bar.tg-draggable:hover{outline:1.5px solid var(--border-accent);outline-offset:1px;z-index:3}
      /* 6px grab strips, only rendered in edit mode; revealed on bar hover. */
      .tg-bar-resize{position:absolute;top:0;bottom:0;width:6px;cursor:col-resize;z-index:11;opacity:0;background:var(--text);transition:opacity 120ms ease}
      .tg-bar:hover .tg-bar-resize{opacity:.3}
      .tg-bar-resize:hover{opacity:.6}
      .tg-bar-resize-left{left:0;border-radius:3px 0 0 3px}
      .tg-bar-resize-right{right:0;border-radius:0 3px 3px 0}
      .tg-bar-selected{outline:1.5px solid var(--border-accent);outline-offset:1px;z-index:3}

      /* right-side editor panel */
      .tg-side-panel{position:fixed;top:0;right:0;bottom:0;width:var(--tg-panel-w,200px);z-index:60;display:flex;flex-direction:column;gap:2px;
        padding:14px 12px;overflow-y:auto;background:var(--card);border-left:1px solid var(--border);
        box-shadow:-8px 0 24px rgba(0,0,0,.18);transform:translateX(100%);transition:transform 200ms ease}
      .tg-side-panel.open{transform:translateX(0)}
      /* Left-edge resize grip. Sits above the panel's own content but below the
       * modals (z 60 stacking context), and stays inside panelRef so grabbing
       * it never trips the click-outside-to-close handler. */
      .tg-sp-resize{position:absolute;left:0;top:0;bottom:0;width:4px;cursor:col-resize;
        z-index:5;background:transparent;display:flex;align-items:center;justify-content:center}
      /* 30% tint via an overlay rather than color-mix, and on ::before rather
       * than the handle itself so the grip keeps its own opacity. */
      .tg-sp-resize::before{content:"";position:absolute;inset:0;background:var(--border-strong);
        opacity:0;transition:opacity 120ms ease}
      .tg-sp-resize:hover::before{opacity:.3}
      /* Three stacked dots: the centre one plus two box-shadow copies 5px out. */
      .tg-sp-grip{position:relative;width:2px;height:2px;border-radius:1px;color:var(--text-muted);
        background:currentColor;opacity:.35;transition:opacity 120ms ease;
        box-shadow:0 -5px 0 currentColor, 0 5px 0 currentColor}
      /* Faintly visible at rest so the edge reads as draggable at all, and
       * brighter on hover once the pointer finds it. */
      .tg-sp-resize:hover .tg-sp-grip{opacity:.85}
      .tg-sp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .tg-sp-title{font-size:13px;font-weight:700;color:var(--text)}
      .tg-sp-close{border:none;background:none;color:var(--muted);font-size:20px;line-height:1;cursor:pointer;padding:0 2px}
      .tg-sp-label{font-size:11px;font-weight:600;color:var(--muted);margin-top:10px;margin-bottom:4px}
      .tg-sp-input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--border);
        background:var(--surface-0);color:var(--text);font-size:12.5px;font-family:inherit}
      .tg-sp-range{width:100%;margin:2px 0}
      /* var(--text) is this project's primary text token — there is no
       * --text-primary defined anywhere, so naming one would render the
       * textarea with an inherited colour. */
      .tg-sp-textarea{width:100%;box-sizing:border-box;font-family:inherit;font-size:11px;
        line-height:1.45;padding:6px 8px;border:0.5px solid var(--border-strong);
        border-radius:var(--radius);background:var(--surface-1);color:var(--text);
        resize:vertical;min-height:60px}
      .tg-sp-textarea::placeholder{color:var(--text-muted)}
      .tg-sp-assignee{display:flex;align-items:center;gap:6px}
      .tg-sp-assignee .tg-sp-select{flex:1;min-width:0}
      .tg-sp-assignee-ro{font-size:12.5px;color:var(--text);padding:6px 0}
      .tg-sp-status{display:flex;flex-wrap:wrap;gap:4px}
      .tg-sp-status button{flex:1 1 auto;padding:4px 6px;border-radius:999px;border:1px solid var(--border);background:var(--surface-0);
        color:var(--muted);font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit}
      .tg-sp-status button.on{background:var(--text);color:var(--card);border-color:var(--text)}
      .tg-sp-actions{display:flex;gap:6px;margin-top:16px}
      .tg-sp-actions .tg-btn{flex:1;padding:7px 8px;text-align:center}
      .tg-sp-delete{color:var(--danger);border-color:var(--danger)}
      .tg-bar-fillwrap{position:absolute;inset:0;display:flex}
      .tg-bar-fill{height:100%}
      .tg-bar-rest{height:100%;opacity:.25}
      /* Thin progress strip along the bottom edge, on top of the engineer-colour
       * fill — reads as progress even when the bar is only a few columns wide. */
      .tg-bar-progress{position:absolute;bottom:0;left:0;height:2px;background:rgba(255,255,255,.35);border-radius:0 0 0 3px;z-index:1;pointer-events:none}
      .tg-bar-label{position:relative;z-index:1;color:var(--on-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tg-active .tg-bar-label{color:var(--on-accent)}
      .tg-active.tg-overdue{outline:1.5px solid #e8a838;outline-offset:1px}
      .tg-overdue-tag{position:relative;z-index:1;margin-left:6px;font-size:9px;background:#e8a838;color:#4a2800;border-radius:20px;padding:0 6px}
      .tg-dep-warn{position:relative;z-index:1;margin-left:6px;font-size:10px;color:var(--warning)}
      .tg-continuous{border:1px solid var(--border)}
      .tg-continuous .tg-bar-label{color:var(--text)}
      .tg-done{border:1px solid var(--border)}
      .tg-done .tg-bar-label{color:var(--text-muted)}
      .tg-idle{background:transparent;border:1px dashed var(--danger);color:var(--danger)}
      .tg-idle .tg-bar-label{color:var(--danger)}
      .tg-queued{background:transparent;border:1px dashed var(--border-strong)}
      .tg-queued .tg-bar-label{color:var(--text-secondary)}
      .tg-bar-error{background:rgba(245,158,11,.12);border:1.5px solid var(--warning);color:var(--warning);cursor:help;max-width:220px}
      .tg-bar-error .tg-bar-label{color:var(--warning)}
      .tg-bar-pending{outline:2px dashed var(--accent1);outline-offset:1px}
      .tg-pending-badge{position:relative;z-index:1;margin-left:8px;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--accent1);color:var(--on-accent);border-radius:8px;padding:1px 6px;white-space:nowrap}

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
      .tg-e-status button.on{background:var(--accent1);color:var(--on-accent);border-color:var(--accent1)}
      .tg-e-del{width:20px;height:20px;border-radius:5px;border:1px solid var(--danger);background:none;color:var(--danger);cursor:pointer;font-size:10px}
      .tg-e-detail{width:20px;height:20px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--accent1);cursor:pointer;font-size:11px;line-height:1}

      .tg-e-depends{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);width:100%}
      .tg-e-depends-label{white-space:nowrap}
      .tg-e-depends-name{font-weight:600;color:var(--text)}
      .tg-e-depends button{background:none;border:1px solid var(--border);border-radius:6px;color:var(--accent1);font-size:11px;padding:2px 8px;cursor:pointer;font-family:inherit}
      .tg-e-depends-hint{color:var(--accent1);font-style:italic}
      .tg-e-snap-warn{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;font-size:11px;color:var(--warning);background:rgba(245,158,11,.1);border-radius:6px;padding:4px 8px}
      .tg-e-snap-warn button{background:var(--warning);border:none;border-radius:6px;color:var(--on-accent);font-size:10.5px;font-weight:600;padding:3px 9px;cursor:pointer;font-family:inherit}

      .tg-lane-drop{position:relative;z-index:8;border-radius:6px}
      .tg-lane-drop-over{background:rgba(0,207,255,.14);outline:2px dashed var(--accent1);outline-offset:-2px}

      /* Bottom dock: fixed share of the shell, with its own inner scrollport so
   * the board above keeps the rest of the height. */
      /* flex:0 0 auto against the board's flex:1 — whatever the dock gives up
       * when it collapses is taken by the timeline automatically. */
      .bl-section{flex:0 0 auto;display:flex;flex-direction:column;max-height:38vh;min-height:0;
        border-top:0.5px solid var(--border-strong);background:var(--surface-1);padding:6px 12px 0}
      /* Collapsed: the header IS the dock — a fixed 36px strip at the bottom. */
      .bl-section.bl-collapsed{height:36px;max-height:36px;padding:0 12px;overflow:hidden}
      .bl-section.bl-collapsed .bl-head-row{height:36px;margin:0;flex-wrap:nowrap;cursor:pointer}
      .bl-section.bl-collapsed .bl-head-row:hover .bl-title,
      .bl-section.bl-collapsed .bl-head-row:hover .bl-chevron{color:var(--text-accent)}
      .bl-head-row{flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
      .bl-collapse-btn{background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;padding:0 2px;font-family:inherit;line-height:1}
      .bl-collapse-btn:hover{color:var(--text-accent)}
      .bl-collapse-end{margin-left:auto}
      /* One glyph for both states — rotating it reads as the section opening,
       * rather than swapping to a different arrow. */
      .bl-chevron{display:inline-block;transition:transform 140ms ease}
      .bl-chevron.on{transform:rotate(90deg)}
      .bl-title{font-size:12px;font-weight:600;margin:0;letter-spacing:-.01em}
      .bl-count{font-size:10px;color:var(--text-muted);white-space:nowrap}
      .bl-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
      .bl-filter-search{font-family:inherit;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:4px 8px;width:140px}
      .bl-filter-priorities{display:flex;gap:4px}
      .bl-filter-chip{border:1px solid transparent;font-family:inherit;cursor:pointer;opacity:.5}
      .bl-filter-chip:hover{opacity:.8}
      .bl-filter-chip-active{opacity:1;border-color:currentColor}
      .bl-filter-owner{font-family:inherit;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px;max-width:160px}
      .bl-filter-reset{background:none;border:none;color:var(--accent1);font-size:11px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:0}
      .bl-filter-hint{font-size:10.5px;color:var(--warning);margin:-4px 0 8px}
      .bl-source-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:12px}
      .bl-url-display{color:var(--text);font-family:monospace;font-size:10.5px}
      .bl-url-edit-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--accent1);font-size:11px;padding:1px 6px;cursor:pointer;font-family:inherit}
      .bl-url-input{font-family:inherit;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 8px;width:min(360px,60vw)}
      .bl-url-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:2px 8px;cursor:pointer;font-family:inherit}
      .bl-last-sync{white-space:nowrap}

      .bl-table-scroll{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--border);
        border-radius:var(--radius) var(--radius) 0 0;background:var(--surface-0)}
      .bl-table{width:100%;border-collapse:collapse;font-size:11px;min-width:820px}
      .bl-table thead th{position:sticky;top:0;background:var(--surface-1);z-index:2;text-align:left;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:5px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
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
      .bl-group-header td{padding:4px 10px;background:var(--panel2, rgba(127,127,127,.08));color:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
      .bl-grip{color:var(--muted);font-size:13px;line-height:1}
      .bl-row{cursor:pointer}
      .bl-row[draggable="true"]{cursor:grab}
      .bl-row[draggable="true"]:active{cursor:grabbing}
      .bl-row-dragging{opacity:.4}
      .bl-row-pending{box-shadow:inset 3px 0 0 var(--accent1)}
      .bl-pending-badge{margin-left:8px}
      .bl-row-drop-above{box-shadow:inset 0 2px 0 var(--accent1)}
      .bl-row-drop-below{box-shadow:inset 0 -2px 0 var(--accent1)}
      .bl-row-add td{background:rgba(0,207,255,.05)}
      .bl-add-input{font-family:inherit;font-size:12px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:4px 8px;width:100%}
      .bl-add-select{font-family:inherit;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px}
      .bl-add-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:3px 9px;cursor:pointer;font-family:inherit;margin-right:6px}
      .bl-add-hours{font-family:inherit;font-size:11.5px;font-variant-numeric:tabular-nums;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px;width:64px}

      .bl-th-esth,.bl-td-esth{width:60px;font-variant-numeric:tabular-nums}
      .bl-esth-static{color:var(--text)}
      .bl-esth-display{background:none;border:1px solid transparent;border-radius:6px;color:var(--text);font-family:inherit;font-size:12px;font-variant-numeric:tabular-nums;padding:2px 6px;cursor:pointer}
      .bl-esth-display:hover{border-color:var(--border)}
      .bl-esth-edit{position:relative;display:inline-block}
      .bl-esth-input{font-family:inherit;font-size:12px;font-variant-numeric:tabular-nums;border-radius:6px;border:1px solid var(--accent1);background:var(--card);color:var(--text);padding:2px 6px;width:56px}
      .bl-esth-err{position:absolute;top:100%;left:0;white-space:nowrap;background:var(--danger);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-top:2px;z-index:5}

      .bl-chip{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;letter-spacing:.02em}
      .bl-chip-p0{background:rgba(239,68,68,.14);color:var(--danger)}
      .bl-chip-p1{background:rgba(245,158,11,.14);color:var(--warning)}
      .bl-chip-p2{background:rgba(120,120,140,.16);color:var(--muted)}
      .bl-chip-enabler{background:rgba(0,207,255,.14);color:var(--accent1)}
      .bl-chip-gated{background:rgba(120,120,140,.3);color:var(--text)}
      .bl-chip-btn{border:1px solid transparent;font-family:inherit;cursor:pointer}
      .bl-chip-btn:hover{border-color:currentColor}
      .bl-priority-select{font-family:inherit;font-size:10.5px;font-weight:700;letter-spacing:.02em;border-radius:10px;border:1px solid currentColor;padding:2px 6px;cursor:pointer}

      .bl-th-assign,.bl-td-assign{width:130px}
      .bl-assign-select{font-family:inherit;font-size:11.5px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:3px 6px;width:100%}
      .bl-th-del,.bl-td-del{width:24px}
      .bl-del-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--danger);font-size:12px;padding:2px 8px;cursor:pointer;font-family:inherit;line-height:1}
      .bl-del-btn.warn{background:var(--danger);color:#fff;border-color:var(--danger)}
      .bl-confirm-del{display:flex;align-items:center;gap:6px;white-space:nowrap}
      .bl-confirm-text{font-size:10.5px;color:var(--warning)}

      .bl-modal-backdrop{position:fixed;inset:0;background:rgba(6,9,26,.55);display:flex;align-items:flex-start;justify-content:center;padding:60px 20px;z-index:60;overflow-y:auto}
      .bl-modal{position:relative;width:100%;max-width:640px;max-height:80vh;display:flex;flex-direction:column;padding:20px;overflow:hidden}
      .bl-modal-close{position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;font-size:15px;line-height:1}
      .bl-modal-head{display:flex;align-items:center;gap:10px;padding-right:36px;margin-bottom:14px}
      .bl-modal-title{font-size:18px;font-weight:800;margin:0;letter-spacing:-.01em}
      .bl-modal-title-input{font-size:16px;font-weight:700;font-family:inherit;flex:1;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:6px 10px}
      .bl-modal-body{overflow-y:auto;flex:1}
      .bl-modal-desc{font-size:13px;line-height:1.5;color:var(--text);margin-bottom:16px;white-space:pre-wrap}
      .bl-modal-desc-line{min-height:1.5em}
      .bl-modal-desc-input{width:100%;font-family:inherit;font-size:13px;line-height:1.5;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);padding:8px 10px;resize:vertical;margin-bottom:16px}
      .bl-modal-meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 20px;border-top:1px solid var(--border);padding-top:14px}
      .bl-modal-meta-label{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px}
      .bl-modal-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}

      .tg-modal-badge-wrap{display:flex;align-items:center;gap:8px}
      .tg-status-chip{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;letter-spacing:.02em;text-transform:uppercase}
      .tg-status-active{background:rgba(0,207,255,.14);color:var(--accent1)}
      .tg-status-queued{background:rgba(120,120,140,.16);color:var(--muted)}
      .tg-status-continuous{background:rgba(0,207,255,.14);color:var(--accent1)}
      .tg-status-done{background:rgba(34,197,94,.16);color:var(--success)}
      .tg-modal-percent{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

      @media(max-width:900px){
        .tg-wrap{padding:8px 12px 64px}
      }
    `}</style>
  );
}
