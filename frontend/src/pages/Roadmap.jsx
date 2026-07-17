import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

const PRIORITIES = {
  P0: { label: 'P0', color: '#dc2626' },
  P1: { label: 'P1', color: '#f97316' },
  P2: { label: 'P2', color: '#2563eb' },
  P3: { label: 'P3', color: '#7c3aed' },
}

const EPIC_COLORS = {
  'Passport':             '#7c3aed',  // фиолетовый
  'HomeAlliance ID':      '#2563eb',  // синий
  'New Techapp':          '#0891b2',  // циан
  'AI Operating Metrics': '#dc2626',  // красный
  'FOS2':                 '#ea580c',  // оранжевый
  'FlowPress':            '#16a34a',  // зелёный
  'Alliance Capture':     '#db2777',  // розовый
  'New CRM':              '#0d9488',  // teal
  'SSO / IT':             '#9333ea',  // пурпурный
  'Other':                '#64748b',  // серый
}
// запасные цвета для эпиков не из списка
const FALLBACK_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#dc2626', '#ea580c', '#16a34a', '#db2777', '#0d9488', '#9333ea', '#c026d3', '#0284c7', '#65a30d']
function epicColor(name, index) {
  return EPIC_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

const WEEK_START = 27, WEEK_END = 38, WEEK_COUNT = 12 // Q3 weeks
const ROW_HEIGHT = 44
const EPIC_SEP = ' · '

const EMPTY_DRAFT = { title: '', owner_id: '', priority: 'P2', description: '' }

function epicNameOf(title) {
  const idx = (title || '').indexOf(EPIC_SEP)
  return idx > 0 ? title.slice(0, idx) : 'Other'
}

function shortTitle(title) {
  const idx = (title || '').indexOf(EPIC_SEP)
  return idx > 0 ? title.slice(idx + EPIC_SEP.length) : title
}

function groupIntoEpics(tasks) {
  const epics = {}
  const order = []
  for (const t of tasks) {
    const name = epicNameOf(t.title)
    if (!epics[name]) { epics[name] = []; order.push(name) }
    epics[name].push(t)
  }
  return order.map(name => {
    const items = epics[name]
    const starts = items.map(t => t.start_week).filter(Boolean)
    const ends = items.map(t => t.end_week).filter(Boolean)
    const prios = items.map(t => t.priority).filter(Boolean).sort()
    return {
      name,
      tasks: items,
      start_week: starts.length ? Math.min(...starts) : null,
      end_week: ends.length ? Math.max(...ends) : null,
      priority: prios[0] || 'P2',
      count: items.length,
      doneCount: items.filter(t => t.status === 'done').length,
    }
  })
}

function GanttView({ tasks, setTasks, pw, openId, setOpenId, saveNote, setPriority }) {
  const trackRef = useRef(null)
  const barDrag = useRef(null)   // {id, mode:'move'|'left'|'right', startX, origStart, origEnd, weekPx}
  const rowDrag = useRef(null)   // {id, startY, epicName}
  const [expandedEpics, setExpandedEpics] = useState({})
  const toggleEpic = (name) => setExpandedEpics(prev => ({ ...prev, [name]: !prev[name] }))

  const clamp = (w) => Math.max(WEEK_START, Math.min(WEEK_END, w))

  const patchSchedule = async (id, start_week, end_week) => {
    await api.patch(`/roadmap/${id}`, { start_week, end_week }, pw)
  }
  const persistOrder = async (order) => {
    await api.patch('/roadmap/reorder', { order }, pw)
  }

  // ── Horizontal drag: reschedule / resize ──────────────────────────────
  const onBarPointerDown = (e, task) => {
    e.preventDefault()
    e.stopPropagation()
    const track = trackRef.current
    if (!track) return
    const weekPx = track.getBoundingClientRect().width / WEEK_COUNT
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetInBar = e.clientX - rect.left
    let mode = 'move'
    if (offsetInBar < 8) mode = 'left'
    else if (offsetInBar > rect.width - 8) mode = 'right'
    barDrag.current = {
      id: task.id, mode, startX: e.clientX,
      origStart: task.start_week ?? WEEK_START,
      origEnd: task.end_week ?? (task.start_week ?? WEEK_START),
      weekPx,
    }
    window.addEventListener('pointermove', onBarPointerMove)
    window.addEventListener('pointerup', onBarPointerUp)
  }

  const onBarPointerMove = (e) => {
    const ds = barDrag.current
    if (!ds) return
    const deltaWeeks = Math.round((e.clientX - ds.startX) / ds.weekPx)
    if (deltaWeeks === 0) return
    setTasks(prev => prev.map(t => {
      if (t.id !== ds.id) return t
      let s = ds.origStart, en = ds.origEnd
      if (ds.mode === 'move') { s = clamp(ds.origStart + deltaWeeks); en = clamp(ds.origEnd + deltaWeeks) }
      if (ds.mode === 'left') { s = clamp(Math.min(ds.origStart + deltaWeeks, ds.origEnd)) }
      if (ds.mode === 'right') { en = clamp(Math.max(ds.origEnd + deltaWeeks, ds.origStart)) }
      return { ...t, start_week: s, end_week: en }
    }))
  }

  const onBarPointerUp = () => {
    const ds = barDrag.current
    window.removeEventListener('pointermove', onBarPointerMove)
    window.removeEventListener('pointerup', onBarPointerUp)
    if (ds) {
      setTasks(prev => {
        const t = prev.find(x => x.id === ds.id)
        if (t) patchSchedule(ds.id, t.start_week, t.end_week)
        return prev
      })
    }
    barDrag.current = null
  }

  // ── Vertical drag: reorder rows within the same epic ───────────────────
  const onRowPointerDown = (e, task) => {
    rowDrag.current = { id: task.id, startY: e.clientY, epicName: epicNameOf(task.title) }
    window.addEventListener('pointermove', onRowPointerMove)
    window.addEventListener('pointerup', onRowPointerUp)
  }

  const onRowPointerMove = (e) => {
    const rd = rowDrag.current
    if (!rd) return
    const deltaRows = Math.round((e.clientY - rd.startY) / ROW_HEIGHT)
    if (deltaRows === 0) return
    setTasks(prev => {
      const positions = []
      const ids = []
      prev.forEach((t, i) => {
        if (epicNameOf(t.title) === rd.epicName) { positions.push(i); ids.push(t.id) }
      })
      const from = ids.indexOf(rd.id)
      const to = Math.max(0, Math.min(ids.length - 1, from + deltaRows))
      if (from === to) return prev
      const reordered = [...ids]
      const [m] = reordered.splice(from, 1)
      reordered.splice(to, 0, m)
      const arr = [...prev]
      reordered.forEach((id, idx) => { arr[positions[idx]] = prev.find(t => t.id === id) })
      rd.startY = e.clientY
      return arr
    })
  }

  const onRowPointerUp = () => {
    const rd = rowDrag.current
    window.removeEventListener('pointermove', onRowPointerMove)
    window.removeEventListener('pointerup', onRowPointerUp)
    if (rd) setTasks(prev => { persistOrder(prev.map(t => t.id)); return prev })
    rowDrag.current = null
  }

  const slotLeft = (w) => ((clamp(w) - WEEK_START) / WEEK_COUNT) * 100
  const slotWidth = (s, en) => ((clamp(en) - clamp(s) + 1) / WEEK_COUNT) * 100

  const epics = groupIntoEpics(tasks)

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '250px repeat(6,1fr)', borderBottom: '1px solid var(--border)' }}>
        <div />
        {['July', 'August', 'September'].map(m => (
          <div key={m} style={{ gridColumn: 'span 2', textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '8px 0', borderLeft: '1px solid var(--border)' }}>
            {m}
          </div>
        ))}
      </div>

      {epics.map((epic, epicIndex) => {
        const isExp = !!expandedEpics[epic.name]
        const allDone = epic.count > 0 && epic.doneCount === epic.count
        const color = epicColor(epic.name, epicIndex)
        return (
          <div key={epic.name}>
            <div style={{ display: 'grid', gridTemplateColumns: '250px repeat(6,1fr)', alignItems: 'center', minHeight: ROW_HEIGHT, borderBottom: '1px solid var(--border)', background: 'var(--base)' }}>
              <div
                onClick={() => toggleEpic(epic.name)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--muted)', fontSize: 11 }}>▶</span>
                <span>{epic.name}</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>
                  {epic.doneCount > 0 ? `${epic.doneCount}/${epic.count}` : epic.count} {epic.count === 1 ? 'task' : 'tasks'}
                </span>
              </div>
              <div ref={epicIndex === 0 ? trackRef : null} style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', position: 'relative', height: '100%', alignItems: 'center' }}>
                {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={{ borderLeft: '1px solid var(--border)', height: '100%' }} />)}
                {epic.start_week && (
                  <div style={{
                    position: 'absolute', left: `${slotLeft(epic.start_week)}%`,
                    width: `${slotWidth(epic.start_week, epic.end_week ?? epic.start_week)}%`,
                    height: 26, borderRadius: 6,
                    background: allDone
                      ? `repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0, rgba(255,255,255,0.35) 5px, transparent 5px, transparent 10px), ${color}`
                      : color,
                    opacity: allDone ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', padding: '0 10px',
                    fontSize: 11, fontWeight: 600, color: '#ffffff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                  }}>{epic.name}</div>
                )}
              </div>
            </div>

            {isExp && epic.tasks.map(t => {
              const initials = (t.owner_name || '??').split(' ').map(w => w[0]).slice(0, 2).join('')
              const isOpen = openId === t.id
              const isDone = t.status === 'done'
              return (
                <div key={t.id}>
                  <div style={{ display: 'grid', gridTemplateColumns: '250px repeat(6,1fr)', alignItems: 'center', minHeight: ROW_HEIGHT, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 26px', fontSize: 12.5 }}>
                      <span
                        onPointerDown={(e) => onRowPointerDown(e, t)}
                        style={{ cursor: 'grab', color: 'var(--muted)', userSelect: 'none', touchAction: 'none' }}
                      >⠿</span>
                      <span style={{
                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                        background: t.owner_color || 'transparent', border: t.owner_color ? 'none' : '1px dashed var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#08131f',
                      }}>{t.owner_color ? initials : '??'}</span>
                      <span
                        onClick={() => setOpenId(isOpen ? null : t.id)}
                        style={{ cursor: 'pointer', userSelect: 'none', color: 'var(--muted)' }}
                      >{shortTitle(t.title)}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                        background: 'var(--card2)', color: 'var(--muted)', border: '0.5px solid var(--border)',
                      }}>{t.priority}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
                    </div>
                    <div style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', position: 'relative', height: '100%', alignItems: 'center' }}>
                      {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={{ borderLeft: '1px solid var(--border)', height: '100%' }} />)}
                      <div
                        onPointerDown={(e) => onBarPointerDown(e, t)}
                        style={{
                          position: 'absolute', left: `${slotLeft(t.start_week ?? WEEK_START)}%`,
                          width: `${slotWidth(t.start_week ?? WEEK_START, t.end_week ?? t.start_week ?? WEEK_START)}%`,
                          height: 20, borderRadius: 5,
                          background: isDone
                            ? `repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0, rgba(255,255,255,0.35) 5px, transparent 5px, transparent 10px), ${color}`
                            : color,
                          opacity: isDone ? 0.55 : 0.82,
                          display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 9, fontWeight: 600, color: '#ffffff',
                          whiteSpace: 'nowrap', overflow: 'hidden',
                          cursor: 'grab', userSelect: 'none', touchAction: 'none',
                        }}
                        title="Drag to move · edges to resize"
                      >{isDone ? '✓ ' : ''}{shortTitle(t.title)}</div>
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '12px 16px 16px 62px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ margin: '8px 0' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Description</div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{t.description || '—'}</div>
                      </div>
                      <div style={{ margin: '8px 0' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Priority</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {Object.keys(PRIORITIES).map(p => (
                            <button key={p} onClick={() => setPriority(t.id, p)}
                              style={{
                                padding: '4px 12px', borderRadius: 6, border: `1px solid ${PRIORITIES[p].color}`, cursor: 'pointer',
                                background: t.priority === p ? PRIORITIES[p].color : 'transparent',
                                color: t.priority === p ? '#fff' : PRIORITIES[p].color, fontSize: 11, fontWeight: 600,
                              }}>
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Note</div>
                        <textarea defaultValue={t.note}
                          onBlur={e => saveNote(t.id, e.target.value)}
                          placeholder="Add a note…"
                          style={{
                            width: '100%', minHeight: 60, background: 'var(--base)', border: '1px solid var(--border)',
                            borderRadius: 8, padding: 10, color: 'var(--text)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit',
                          }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      {tasks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', fontSize: 13 }}>
          No roadmap tasks yet.
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
        {epics.map((epic, i) => (
          <span key={epic.name}>
            <span style={{ display: 'inline-block', width: 14, height: 9, borderRadius: 3, background: epicColor(epic.name, i), marginRight: 5, verticalAlign: 'middle' }} />
            {epic.name}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Drag bars to reschedule · edges to resize · drag ⠿ up/down to reorder</span>
      </div>
    </div>
  )
}

export default function Roadmap() {
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [openId, setOpenId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const pw = sessionStorage.getItem('admin_pw') || ''

  const load = () => api.get('/roadmap').then(d => setTasks(d.tasks || []))
  useEffect(() => {
    load()
    api.get('/team').then(setMembers).catch(() => {})
  }, [])

  const addTask = async () => {
    if (!draft.title.trim()) return
    await api.post('/roadmap', {
      title: draft.title.trim(),
      owner_id: draft.owner_id ? Number(draft.owner_id) : null,
      priority: draft.priority,
      description: draft.description,
    }, pw)
    setDraft(EMPTY_DRAFT)
    setShowAdd(false)
    load()
  }

  const saveNote = async (id, note) => {
    await api.patch(`/roadmap/${id}`, { note }, pw)
  }

  const setPriority = async (id, priority) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority } : t))
    await api.patch(`/roadmap/${id}`, { priority }, pw)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--base)' }}>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo"><span>⬡</span> Roadmap</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/north-star" className="topbar-admin-link">◆ North Star</Link>
          <Link to="/" className="topbar-admin-link">← Dashboard</Link>
        </div>
      </div>
      <div className="page" style={{ paddingTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Drag bars to reschedule · edges to resize · drag ⠿ to reorder · click a task for details and notes
          </div>
          <button
            onClick={() => setShowAdd(v => !v)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent1)',
              background: showAdd ? 'var(--accent1)' : 'transparent',
              color: showAdd ? '#fff' : 'var(--accent1)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
            {showAdd ? '✕ Cancel' : '+ Add Task'}
          </button>
        </div>
        {showAdd && (
          <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Task title"
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <select
                value={draft.owner_id}
                onChange={e => setDraft(d => ({ ...d, owner_id: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 13, flex: 1 }}
              >
                <option value="">No owner</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select
                value={draft.priority}
                onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 13 }}
              >
                {Object.keys(PRIORITIES).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <textarea
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder="Description (optional)"
              style={{ minHeight: 60, padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <button
              onClick={addTask}
              disabled={!draft.title.trim()}
              style={{
                alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 6, border: 'none',
                background: 'var(--accent1)', color: '#fff', fontSize: 12, fontWeight: 600,
                cursor: draft.title.trim() ? 'pointer' : 'not-allowed', opacity: draft.title.trim() ? 1 : 0.5,
              }}>
              Create
            </button>
          </div>
        )}
        <GanttView
          tasks={tasks}
          setTasks={setTasks}
          pw={pw}
          openId={openId}
          setOpenId={setOpenId}
          saveNote={saveNote}
          setPriority={setPriority}
        />
      </div>
    </div>
  )
}
