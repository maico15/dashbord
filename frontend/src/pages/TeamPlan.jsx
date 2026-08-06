import { useEffect, useMemo, useState } from "react";
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

function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const a = `${MONTHS[monday.getMonth()]} ${monday.getDate()}`;
  const b = monday.getMonth() === sunday.getMonth()
    ? `${sunday.getDate()}`
    : `${MONTHS[sunday.getMonth()]} ${sunday.getDate()}`;
  return `${a} - ${b}`;
}

function buildBars(assignments, rangeStart, today) {
  return (assignments || []).map((a) => {
    const effectiveStart = a.status === "queued"
      ? (a.queue_start || a.start_date || toISODate(today))
      : a.start_date;
    const start = parseISODate(effectiveStart) || today;
    const end = a.status === "continuous" ? addDays(rangeStart, DAY_COLS - 1) : nthWorkingDay(start, a.est_days);
    const rawStart = a.status === "continuous" ? 0 : dateToCol(start, rangeStart);
    const rawEnd = a.status === "continuous" ? DAY_COLS : dateToCol(end, rangeStart) + 1;
    return {
      assignment: a,
      colStart: Math.max(0, Math.min(DAY_COLS - 1, rawStart)),
      colEnd: Math.max(1, Math.min(DAY_COLS, rawEnd)),
      rawStart,
      rawEnd,
      start: effectiveStart,
      end: toISODate(end),
      color: STATUS_COLORS[a.status] || STATUS_COLORS.active,
      risk: a.status === "active" && Number(a.percent || 0) < 100 && today > end,
    };
  });
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

export default function TeamPlan() {
  const theme = useTheme();
  const [data, setData] = useState({ engineers: [] });
  const [backlog, setBacklog] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const rangeStart = useMemo(() => addDays(startOfWeekMonday(today), -7), [today]);
  const days = useMemo(() => Array.from({ length: DAY_COLS }, (_, i) => addDays(rangeStart, i)), [rangeStart]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, i) => days[i * 7]), [days]);
  const todayIdx = dateToCol(today, rangeStart);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get("/gantt"),
      api.get("/backlog").catch(() => ({ items: [] })),
    ])
      .then(([gantt, bl]) => {
        if (!alive) return;
        setData(gantt || { engineers: [] });
        setBacklog(bl?.items || []);
        setSelected(null);
        setError("");
      })
      .catch((err) => {
        if (alive) setError(err.message || "Failed to load team plan");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const engineers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.engineers || [])
      .filter((e) => teamFilter === "all" || e.name === teamFilter)
      .filter((e) => {
        if (!q) return true;
        return `${e.name} ${(e.assignments || []).map((a) => a.project).join(" ")}`.toLowerCase().includes(q);
      });
  }, [data.engineers, query, teamFilter]);

  const visibleBacklog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return backlog
      .filter((b) => !q || `${b.title} ${b.description} ${b.owner}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [backlog, query]);

  const risks = useMemo(() => {
    const rows = [];
    for (const e of data.engineers || []) {
      const cap = capacityFor(e);
      if (cap.load > 100) rows.push({ type: "capacity", title: e.name, detail: `${cap.load}% planned load` });
      for (const a of e.assignments || []) {
        const start = parseISODate(a.start_date);
        if (!start || a.status !== "active") continue;
        const end = nthWorkingDay(start, a.est_days);
        if (today > end && Number(a.percent || 0) < 100) {
          rows.push({ type: "blocked", title: a.project || "Untitled", detail: `${e.name}: overdue since ${toISODate(end)}` });
        }
      }
    }
    return rows.slice(0, 5);
  }, [data.engineers, today]);

  const selectedAssignment = selected?.type === "assignment" ? selected.item : null;
  const selectedBacklog = selected?.type === "backlog" ? selected.item : null;

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
          <button className="tp-tab active">Gantt</button>
          <button className="tp-tab">Backlog</button>
          <button className="tp-tab">Capacity</button>
          <button className="tp-tab">Risks</button>
        </nav>
        <div className="tp-actions">
          <Link to="/team-gantt" className="tp-link-btn">Old Gantt</Link>
          <Link to="/" className="tp-link-btn">Dashboard</Link>
          <button className="tp-icon-btn" onClick={toggleTheme} title="Toggle theme">{theme === "dark" ? "L" : "D"}</button>
        </div>
      </header>

      <main className="tp-layout">
        <aside className="tp-sidebar">
          <section className="tp-side-section">
            <div className="tp-section-label">Saved views</div>
            <button className="tp-view active">Team Plan <span>Current</span></button>
            <button className="tp-view">Delivery Risk</button>
            <button className="tp-view">Next 2 Weeks</button>
            <button className="tp-view">Idle Engineers</button>
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
                {(data.engineers || []).map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </label>
          </section>

          <section className="tp-side-section">
            <div className="tp-section-label">Signals</div>
            <div className="tp-signal"><b>{data.engineers?.length || 0}</b><span>engineers</span></div>
            <div className="tp-signal"><b>{backlog.length}</b><span>backlog items</span></div>
            <div className="tp-signal danger"><b>{risks.length}</b><span>open risks</span></div>
          </section>
        </aside>

        <section className="tp-board">
          <div className="tp-board-toolbar">
            <div>
              <h1>Gantt</h1>
              <p>6-week delivery plan with load and risk visibility</p>
            </div>
            <div className="tp-toolbar-actions">
              <button className="tp-small-btn">6 weeks</button>
              <button className="tp-small-btn">Today</button>
              <button className="tp-primary-btn">Plan task</button>
            </div>
          </div>

          {loading && <div className="tp-state">Loading team plan...</div>}
          {error && <div className="tp-state error">{error}</div>}

          {!loading && !error && (
            <div className="tp-gantt">
              <div className="tp-gantt-grid" style={{ gridTemplateColumns: `240px repeat(${DAY_COLS}, minmax(24px, 1fr))` }}>
                <div className="tp-name-head">Team / work</div>
                {weeks.map((w) => (
                  <div key={toISODate(w)} className="tp-week-head" style={{ gridColumn: `span 7` }}>
                    {weekLabel(w)}
                  </div>
                ))}
                <div className="tp-name-head day">Status</div>
                {days.map((d) => (
                  <div key={toISODate(d)} className={`tp-day ${isWeekend(d) ? "weekend" : ""}`}>
                    {d.getDate()}
                  </div>
                ))}
                {todayIdx >= 0 && todayIdx < DAY_COLS && (
                  <div className="tp-today" style={{ gridColumn: todayIdx + 2, gridRow: `1 / span ${Math.max(4, engineers.length + 3)}` }}>
                    <span>Today</span>
                  </div>
                )}

                {engineers.map((e, idx) => {
                  const bars = buildBars(e.assignments, rangeStart, today);
                  const cap = capacityFor(e);
                  const gridRow = idx + 3;
                  return (
                    <div className="tp-row-fragment" key={e.id} style={{ display: "contents" }}>
                      <button className="tp-engineer-cell" style={{ gridRow }} onClick={() => setSelected({ type: "engineer", item: e })}>
                        <span className="tp-avatar" style={{ background: e.color || "var(--accent1)" }}>{e.name?.[0] || "E"}</span>
                        <span className="tp-eng-text">
                          <strong>{e.name}</strong>
                          <small>{cap.active} active, {cap.queued} queued</small>
                        </span>
                        <span className={`tp-load ${cap.load > 100 ? "over" : ""}`}>{cap.load}%</span>
                      </button>
                      <div className="tp-row-bg" style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow }} />
                      {days.map((d) => isWeekend(d) && (
                        <div key={`${e.id}-${toISODate(d)}`} className="tp-weekend-bg" style={{ gridColumn: dateToCol(d, rangeStart) + 2, gridRow }} />
                      ))}
                      {bars.length === 0 && (
                        <button className="tp-idle-bar" style={{ gridColumn: `2 / ${DAY_COLS + 2}`, gridRow }} onClick={() => setSelected({ type: "engineer", item: e })}>
                          Idle window
                        </button>
                      )}
                      {bars.map((bar) => (
                        <button
                          key={bar.assignment.id}
                          className={`tp-bar ${bar.assignment.status || "active"} ${bar.risk ? "risk" : ""}`}
                          style={{
                            gridColumn: `${bar.colStart + 2} / ${bar.colEnd + 2}`,
                            gridRow,
                            "--bar-color": bar.color,
                          }}
                          onClick={() => setSelected({ type: "assignment", item: bar.assignment, engineer: e, bar })}
                          title={bar.assignment.project || "Untitled"}
                        >
                          <span>{bar.assignment.project || "Untitled"}</span>
                          <small>{bar.assignment.status}</small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="tp-backlog">
            <div className="tp-backlog-head">
              <div>
                <h2>Backlog</h2>
                <p>{backlog.length} items ready for planning</p>
              </div>
              <Link to="/team-gantt" className="tp-link-inline">Edit in old Gantt</Link>
            </div>
            <div className="tp-backlog-table">
              {visibleBacklog.map((item) => (
                <button key={item.id} className="tp-backlog-row" onClick={() => setSelected({ type: "backlog", item })}>
                  <span className={priorityClass(item.priority)}>{item.priority || "P2"}</span>
                  <span className="tp-backlog-title">{item.title}</span>
                  <span>{item.owner || "Unowned"}</span>
                  <span>{item.est_hours ? `${item.est_hours}h` : `${item.est_days || 10}d`}</span>
                  <span className="tp-assign">Assign</span>
                </button>
              ))}
              {visibleBacklog.length === 0 && <div className="tp-empty">No backlog items match the current filters.</div>}
            </div>
          </div>
        </section>

        <aside className="tp-inspector">
          <section className="tp-panel">
            <div className="tp-panel-head">
              <span>Inspector</span>
              {selected && <button onClick={() => setSelected(null)}>Clear</button>}
            </div>
            {!selected && (
              <div className="tp-muted-box">
                Select a task, backlog item, or engineer to inspect planning details.
              </div>
            )}
            {selectedAssignment && (
              <div className="tp-detail">
                <h2>{selectedAssignment.project || "Untitled"}</h2>
                <span className={`tp-status ${selectedAssignment.status}`}>{selectedAssignment.status}</span>
                <dl>
                  <div><dt>Owner</dt><dd>{selected.engineer?.name || "-"}</dd></div>
                  <div><dt>Start</dt><dd>{selectedAssignment.start_date || selectedAssignment.queue_start || "-"}</dd></div>
                  <div><dt>Estimate</dt><dd>{selectedAssignment.est_days || 10}d</dd></div>
                  <div><dt>Progress</dt><dd>{selectedAssignment.percent || 0}%</dd></div>
                </dl>
              </div>
            )}
            {selectedBacklog && (
              <div className="tp-detail">
                <h2>{selectedBacklog.title}</h2>
                <span className={priorityClass(selectedBacklog.priority)}>{selectedBacklog.priority || "P2"}</span>
                <p>{selectedBacklog.description || "No description"}</p>
                <dl>
                  <div><dt>Owner</dt><dd>{selectedBacklog.owner || "-"}</dd></div>
                  <div><dt>Estimate</dt><dd>{selectedBacklog.est_hours ? `${selectedBacklog.est_hours}h` : `${selectedBacklog.est_days || 10}d`}</dd></div>
                  <div><dt>Status</dt><dd>{selectedBacklog.status || "-"}</dd></div>
                </dl>
              </div>
            )}
            {selected?.type === "engineer" && (
              <div className="tp-detail">
                <h2>{selected.item.name}</h2>
                <dl>
                  <div><dt>Assignments</dt><dd>{selected.item.assignments?.length || 0}</dd></div>
                  <div><dt>Load</dt><dd>{capacityFor(selected.item).load}%</dd></div>
                  <div><dt>Latest report</dt><dd>{selected.item.latest_report_date || "-"}</dd></div>
                </dl>
              </div>
            )}
          </section>

          <section className="tp-panel">
            <div className="tp-panel-head"><span>Capacity</span></div>
            {(data.engineers || []).slice(0, 5).map((e) => {
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

          <section className="tp-panel">
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
      .tp-actions{display:flex;align-items:center;gap:8px}
      .tp-link-btn,.tp-icon-btn,.tp-small-btn,.tp-primary-btn{border:1px solid var(--border);border-radius:8px;background:var(--card2);color:var(--text);font-family:inherit;font-size:12px;text-decoration:none;cursor:pointer}
      .tp-link-btn{padding:7px 10px}
      .tp-icon-btn{width:32px;height:32px}
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
      .tp-toolbar-actions{display:flex;align-items:center;gap:8px}.tp-small-btn{padding:7px 10px}.tp-primary-btn{padding:8px 12px;background:var(--accent1);border-color:var(--accent1);color:#07111f;font-weight:700}
      .tp-state{padding:46px;text-align:center;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px}.tp-state.error{color:var(--danger)}
      .tp-gantt{background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:auto}
      .tp-gantt-grid{display:grid;min-width:1120px;position:relative;grid-auto-rows:40px}
      .tp-name-head,.tp-week-head,.tp-day{display:flex;align-items:center;border-bottom:1px solid var(--border);background:var(--card);font-size:11px;color:var(--muted)}
      .tp-name-head{position:sticky;left:0;z-index:5;padding:0 12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid var(--border)}
      .tp-name-head.day{grid-column:1}.tp-week-head{justify-content:center;border-right:1px solid var(--border);font-weight:700}.tp-day{justify-content:center;font-size:10px}.tp-day.weekend{background:rgba(120,120,140,.08)}
      .tp-today{position:relative;z-index:4;border-left:2px solid var(--success);pointer-events:none}.tp-today span{position:absolute;top:48px;left:-20px;background:var(--success);color:#07111f;border-radius:8px;padding:2px 7px;font-size:10px;font-weight:800}
      .tp-engineer-cell{position:sticky;left:0;z-index:3;display:flex;align-items:center;gap:9px;border:0;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--card);color:var(--text);padding:0 10px;font-family:inherit;text-align:left;cursor:pointer}
      .tp-avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#07111f;font-size:11px;font-weight:800;flex:none}.tp-eng-text{display:flex;flex-direction:column;min-width:0;flex:1}.tp-eng-text strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-eng-text small{font-size:10px;color:var(--muted)}
      .tp-load{font-size:11px;color:var(--muted);font-weight:700}.tp-load.over{color:var(--danger)}
      .tp-row-bg{border-bottom:1px solid var(--border);background:linear-gradient(180deg,transparent,rgba(120,120,140,.025))}
      .tp-weekend-bg{background:rgba(120,120,140,.07);border-bottom:1px solid var(--border)}
      .tp-bar,.tp-idle-bar{align-self:center;height:25px;margin:0 2px;border-radius:6px;border:1px solid var(--bar-color);background:color-mix(in srgb,var(--bar-color) 18%,transparent);color:var(--text);font-family:inherit;font-size:11px;font-weight:700;display:flex;align-items:center;gap:8px;padding:0 8px;overflow:hidden;cursor:pointer;z-index:2}
      .tp-bar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-bar small{margin-left:auto;text-transform:uppercase;font-size:9px;color:var(--muted)}.tp-bar.queued{border-style:dashed;background:transparent}.tp-bar.done{opacity:.65}.tp-bar.risk{outline:2px solid rgba(208,32,64,.35)}
      .tp-idle-bar{border:1px dashed var(--danger);background:rgba(208,32,64,.06);color:var(--danger);justify-content:center}
      .tp-backlog{margin-top:14px;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
      .tp-backlog-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border)}.tp-backlog-head h2{font-size:15px}.tp-backlog-head p{font-size:11px;color:var(--muted);margin-top:2px}.tp-link-inline{font-size:12px;color:var(--accent1);text-decoration:none}
      .tp-backlog-table{display:flex;flex-direction:column}.tp-backlog-row{display:grid;grid-template-columns:70px minmax(180px,1fr) 130px 70px 70px;gap:12px;align-items:center;min-height:42px;padding:0 12px;border:0;border-bottom:1px solid var(--border);background:none;color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}.tp-backlog-row:hover{background:var(--row-hover)}
      .tp-backlog-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-assign{color:var(--accent1);font-weight:700}.tp-empty{padding:18px;text-align:center;color:var(--muted);font-size:12px}
      .tp-priority{display:inline-flex;align-items:center;justify-content:center;width:max-content;min-width:34px;border-radius:8px;padding:2px 7px;font-size:10px;font-weight:800}.tp-p0{background:rgba(208,32,64,.12);color:var(--danger)}.tp-p1{background:rgba(192,128,0,.13);color:var(--warning)}.tp-p2{background:rgba(120,120,140,.14);color:var(--muted)}.tp-enabler{background:var(--accent1-bg);color:var(--accent1)}.tp-gated{background:rgba(120,120,140,.25);color:var(--text)}
      .tp-panel{background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px}.tp-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.tp-panel-head button{border:0;background:none;color:var(--accent1);font-family:inherit;font-size:11px;cursor:pointer}
      .tp-muted-box{border:1px dashed var(--border);border-radius:8px;padding:12px;color:var(--muted);font-size:12px;line-height:1.45}.tp-detail h2{font-size:16px;line-height:1.25;margin-bottom:8px}.tp-detail p{font-size:12px;line-height:1.45;color:var(--muted);margin:10px 0}.tp-detail dl{display:grid;gap:8px;margin-top:12px}.tp-detail dl div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:6px}.tp-detail dt{font-size:11px;color:var(--muted)}.tp-detail dd{font-size:12px;text-align:right}
      .tp-status{display:inline-flex;border-radius:8px;padding:2px 8px;font-size:10px;text-transform:uppercase;font-weight:800;background:var(--accent1-bg);color:var(--accent1)}
      .tp-cap-row{display:grid;grid-template-columns:1fr 88px 42px;align-items:center;gap:8px;margin-bottom:10px}.tp-cap-row strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-cap-row span{font-size:10px;color:var(--muted)}.tp-cap-track{height:7px;background:var(--card);border-radius:5px;overflow:hidden}.tp-cap-track i{display:block;height:100%;background:var(--accent1);border-radius:5px}.tp-cap-track i.over{background:var(--danger)}.tp-cap-row b{font-size:11px;color:var(--muted);text-align:right}.tp-cap-row b.over{color:var(--danger)}
      .tp-risk{display:flex;flex-direction:column;gap:3px;border-left:3px solid var(--warning);padding:8px 0 8px 10px;margin-bottom:8px}.tp-risk.blocked{border-left-color:var(--danger)}.tp-risk strong{font-size:12px}.tp-risk span{font-size:11px;color:var(--muted);line-height:1.35}
      @media(max-width:1180px){.tp-layout{grid-template-columns:210px minmax(0,1fr)}.tp-inspector{grid-column:1 / -1;border-left:0;border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.tp-panel{margin-bottom:0}.tp-topbar{grid-template-columns:220px 1fr auto}}
      @media(max-width:820px){.tp-topbar{grid-template-columns:1fr;min-height:132px;height:auto;padding:12px}.tp-tabs{justify-content:flex-start;height:38px}.tp-layout{grid-template-columns:1fr}.tp-sidebar{border-right:0;border-bottom:1px solid var(--border)}.tp-inspector{display:block}.tp-board-toolbar{align-items:flex-start;flex-direction:column}.tp-backlog-row{grid-template-columns:48px minmax(160px,1fr) 70px}.tp-backlog-row span:nth-child(3),.tp-backlog-row span:nth-child(4){display:none}}
    `}</style>
  );
}
