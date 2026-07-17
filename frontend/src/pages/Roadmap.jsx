import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

const PRIORITIES = {
  P0: { label: 'P0', color: '#dc2626' },
  P1: { label: 'P1', color: '#f97316' },
  P2: { label: 'P2', color: '#2563eb' },
  P3: { label: 'P3', color: '#7c3aed' },
}

const PALETTE = ['#7c3aed', '#2563eb', '#0891b2', '#dc2626', '#ea580c', '#16a34a', '#db2777', '#0d9488', '#9333ea', '#64748b']

const WEEK_START = 27, WEEK_END = 38, WEEK_COUNT = 12 // Q3 weeks
const ROW_HEIGHT = 44

const EMPTY_DRAFT = { title: '', owner_id: '', priority: 'P2', description: '', epic_id: '' }

function groupByEpic(tasks, epics) {
  const groups = epics.map(e => ({
    ...e,
    tasks: tasks.filter(t => t.epic_id === e.id),
  }))
  const orphan = tasks.filter(t => !t.epic_id || !epics.find(e => e.id === t.epic_id))
  if (orphan.length) groups.push({ id: null, name: 'No epic', color: '#64748b', tasks: orphan })
  for (const g of groups) {
    const s = g.tasks.map(t => t.start_week).filter(Boolean)
    const en = g.tasks.map(t => t.end_week).filter(Boolean)
    g.start_week = s.length ? Math.min(...s) : null
    g.end_week = en.length ? Math.max(...en) : null
    g.doneCount = g.tasks.filter(t => t.status === 'done').length
  }
  return groups.filter(g => g.tasks.length)
}

// estimate_days → доля от 12-недельной сетки. 5 рабочих дней = 1 неделя.
function durationWidthPct(estimateDays, startWeek, endWeek) {
  if (estimateDays && estimateDays > 0) {
    const weeks = estimateDays / 5            // рабочие дни → недели
    return Math.max(2, (weeks / WEEK_COUNT) * 100)   // минимум 2% чтобы полоса была видна
  }
  // fallback: старый горизонт если оценки нет
  const s = startWeek ?? WEEK_START, e = endWeek ?? s
  return ((e - s + 1) / WEEK_COUNT) * 100
}

function durationLabel(estimateDays) {
  if (!estimateDays) return ''
  return estimateDays >= 5 ? `${(estimateDays / 5).toFixed(1)}w` : `${estimateDays}d`
}

function GanttView({ tasks, setTasks, pw, openId, setOpenId, saveNote, setPriority, epics, patchEpic, setTaskEpic, setEstimate, audience }) {
  const trackRef = useRef(null)
  const barDrag = useRef(null)   // {id, mode:'move'|'left'|'right', startX, origStart, origEnd, weekPx}
  const rowDrag = useRef(null)   // {id, startY, epicId}
  const [expandedEpics, setExpandedEpics] = useState({})
  const toggleEpic = (key) => setExpandedEpics(prev => ({ ...prev, [key]: !prev[key] }))
  const [editingEpicId, setEditingEpicId] = useState(undefined) // undefined = none open; supports null id for "No epic" (not editable anyway)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#2563eb')
  const [editOutcome, setEditOutcome] = useState('')

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
    rowDrag.current = { id: task.id, startY: e.clientY, epicId: task.epic_id ?? null }
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
        if ((t.epic_id ?? null) === rd.epicId) { positions.push(i); ids.push(t.id) }
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

  const openEditEpic = (group) => {
    setEditingEpicId(group.id)
    setEditName(group.name)
    setEditColor(group.color)
    setEditOutcome(group.outcome || '')
  }
  const saveEpicEdit = async () => {
    if (editingEpicId == null) return
    await patchEpic(editingEpicId, { name: editName.trim() || undefined, color: editColor, outcome: editOutcome })
    setEditingEpicId(undefined)
  }

  const groups = groupByEpic(tasks, epics)
  const isBusiness = audience === 'business'
  const groupById = Object.fromEntries(groups.filter(g => g.id != null).map(g => [g.id, g]))

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

      {isBusiness ? (
        epics.map((epic, epicIndex) => {
          const g = groupById[epic.id] || { start_week: null, end_week: null }
          const eLeft = slotLeft(g.start_week ?? WEEK_START)
          const eWidth = slotWidth(g.start_week ?? WEEK_START, g.end_week ?? g.start_week ?? WEEK_START)
          return (
            <div key={epic.id} ref={epicIndex === 0 ? trackRef : null} style={{ display: 'grid', gridTemplateColumns: '250px repeat(6,1fr)', alignItems: 'center', minHeight: 52, borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '8px 12px' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{epic.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{epic.outcome || '—'}</div>
              </div>
              <div style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', position: 'relative', height: '100%', alignItems: 'center' }}>
                {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={{ borderLeft: '1px solid var(--border)', height: '100%' }} />)}
                {g.start_week && (
                  <div style={{
                    position: 'absolute', left: `${eLeft}%`, width: `${eWidth}%`, height: 26, borderRadius: 6,
                    background: epic.color, display: 'flex', alignItems: 'center', padding: '0 10px',
                    fontSize: 11, fontWeight: 600, color: '#ffffff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                  }}>{epic.name}</div>
                )}
              </div>
            </div>
          )
        })
      ) : groups.map((group, groupIndex) => {
        const key = group.id ?? 'none'
        const isExp = !!expandedEpics[key]
        const allDone = group.tasks.length > 0 && group.doneCount === group.tasks.length
        const color = group.color
        const isEditing = editingEpicId === group.id
        return (
          <div key={key}>
            <div style={{ display: 'grid', gridTemplateColumns: '250px repeat(6,1fr)', alignItems: 'center', minHeight: ROW_HEIGHT, borderBottom: '1px solid var(--border)', background: 'var(--base)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, fontWeight: 600 }}>
                <span
                  onClick={() => toggleEpic(key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{ transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--muted)', fontSize: 11 }}>▶</span>
                  <span>{group.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>
                    {group.doneCount > 0 ? `${group.doneCount}/${group.tasks.length}` : group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                </span>
                {group.id != null && (
                  <button
                    onClick={() => openEditEpic(group)}
                    title="Edit epic"
                    style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: 2 }}
                  >✎</button>
                )}
              </div>
              <div ref={groupIndex === 0 ? trackRef : null} style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', position: 'relative', height: '100%', alignItems: 'center' }}>
                {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={{ borderLeft: '1px solid var(--border)', height: '100%' }} />)}
                {group.start_week && (
                  <div style={{
                    position: 'absolute', left: `${slotLeft(group.start_week)}%`,
                    width: `${slotWidth(group.start_week, group.end_week ?? group.start_week)}%`,
                    height: 26, borderRadius: 6,
                    background: allDone
                      ? `repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0, rgba(255,255,255,0.35) 5px, transparent 5px, transparent 10px), ${color}`
                      : color,
                    opacity: allDone ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', padding: '0 10px',
                    fontSize: 11, fontWeight: 600, color: '#ffffff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                  }}>{group.name}</div>
                )}
              </div>
            </div>

            {isEditing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--base)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    style={{ flex: 1, maxWidth: 240, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12.5 }}
                  />
                  <div style={{ display: 'flex', gap: 5 }}>
                    {PALETTE.map(c => (
                      <button key={c} onClick={() => setEditColor(c)}
                        style={{
                          width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: editColor === c ? '2px solid var(--text)' : '2px solid transparent',
                        }} />
                    ))}
                  </div>
                  <button onClick={saveEpicEdit} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent1)', color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                  <button onClick={() => setEditingEpicId(undefined)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer' }}>Cancel</button>
                </div>
                <input
                  value={editOutcome}
                  onChange={e => setEditOutcome(e.target.value)}
                  placeholder="Business outcome (shown in Business view)"
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12.5 }}
                />
              </div>
            )}

            {isExp && group.tasks.map(t => {
              const initials = (t.owner_name || '??').split(' ').map(w => w[0]).slice(0, 2).join('')
              const isOpen = openId === t.id
              const isDone = t.status === 'done'
              const durLabel = durationLabel(t.estimate_days)
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
                      >{t.title}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                        background: 'var(--card2)', color: 'var(--muted)', border: '0.5px solid var(--border)',
                      }}>{t.priority}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
                    </div>
                    <div style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', position: 'relative', height: '100%', alignItems: 'center' }}>
                      {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={{ borderLeft: '1px solid var(--border)', height: '100%' }} />)}
                      {/* буфер горизонта (бледный) — отведённый срок start_week..end_week */}
                      <div style={{
                        position: 'absolute', left: `${slotLeft(t.start_week ?? WEEK_START)}%`,
                        width: `${slotWidth(t.start_week ?? WEEK_START, t.end_week ?? t.start_week ?? WEEK_START)}%`,
                        height: 20, borderRadius: 5, background: color, opacity: 0.15,
                      }} />
                      {/* реальная длительность (насыщенная) поверх буфера */}
                      <div
                        onPointerDown={(e) => onBarPointerDown(e, t)}
                        style={{
                          position: 'absolute', left: `${slotLeft(t.start_week ?? WEEK_START)}%`,
                          width: `${durationWidthPct(t.estimate_days, t.start_week, t.end_week)}%`,
                          height: 20, borderRadius: 5,
                          background: isDone
                            ? `repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0, rgba(255,255,255,0.35) 5px, transparent 5px, transparent 10px), ${color}`
                            : color,
                          opacity: isDone ? 0.55 : 0.9,
                          display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 9, fontWeight: 600, color: '#ffffff',
                          whiteSpace: 'nowrap', overflow: 'hidden',
                          cursor: 'grab', userSelect: 'none', touchAction: 'none',
                        }}
                        title="Drag to move · edges to resize"
                      >{isDone ? '✓ ' : ''}{t.title}{durLabel ? ` · ${durLabel}` : ''}</div>
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
                      <div style={{ margin: '8px 0' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Epic</div>
                        <select
                          value={t.epic_id ?? ''}
                          onChange={e => setTaskEpic(t.id, e.target.value ? Number(e.target.value) : null)}
                          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 12.5 }}
                        >
                          <option value="">— No epic —</option>
                          {epics.map(ep => <option key={ep.id} value={ep.id}>{ep.name}</option>)}
                        </select>
                      </div>
                      <div style={{ margin: '8px 0' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Estimate (working days)</div>
                        <input type="number" min="0" step="0.5" defaultValue={t.estimate_days || ''}
                          onBlur={e => {
                            const v = e.target.value ? parseFloat(e.target.value) : null
                            setEstimate(t.id, v)
                          }}
                          placeholder="e.g. 2"
                          style={{ width: 100, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 12.5 }} />
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

      {!isBusiness && tasks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', fontSize: 13 }}>
          No roadmap tasks yet.
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
        {(isBusiness ? epics : groups).map((g, i) => (
          <span key={g.id ?? 'none'}>
            <span style={{ display: 'inline-block', width: 14, height: 9, borderRadius: 3, background: g.color, marginRight: 5, verticalAlign: 'middle' }} />
            {g.name}
          </span>
        ))}
        {!isBusiness && (
          <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Drag bars to reschedule · edges to resize · drag ⠿ up/down to reorder</span>
        )}
      </div>
    </div>
  )
}

export default function Roadmap() {
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [epics, setEpics] = useState([])
  const [openId, setOpenId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [showAddEpic, setShowAddEpic] = useState(false)
  const [newEpicName, setNewEpicName] = useState('')
  const [newEpicColor, setNewEpicColor] = useState('#2563eb')
  const [audience, setAudience] = useState('engineering') // 'engineering' | 'business'
  const pw = sessionStorage.getItem('admin_pw') || ''

  const load = () => api.get('/roadmap').then(d => setTasks(d.tasks || []))
  const loadEpics = () => api.get('/roadmap/epics').then(d => setEpics(d.epics || []))
  useEffect(() => {
    load()
    loadEpics()
    api.get('/team').then(setMembers).catch(() => {})
  }, [])

  const addTask = async () => {
    if (!draft.title.trim()) return
    await api.post('/roadmap', {
      title: draft.title.trim(),
      owner_id: draft.owner_id ? Number(draft.owner_id) : null,
      priority: draft.priority,
      description: draft.description,
      epic_id: draft.epic_id ? Number(draft.epic_id) : null,
    }, pw)
    setDraft(EMPTY_DRAFT)
    setShowAdd(false)
    load()
  }

  const addEpic = async () => {
    if (!newEpicName.trim()) return
    await api.post('/roadmap/epics', { name: newEpicName.trim(), color: newEpicColor }, pw)
    setNewEpicName('')
    setNewEpicColor('#2563eb')
    setShowAddEpic(false)
    loadEpics()
  }

  const patchEpic = async (id, fields) => {
    await api.patch(`/roadmap/epics/${id}`, fields, pw)
    loadEpics()
  }

  const saveNote = async (id, note) => {
    await api.patch(`/roadmap/${id}`, { note }, pw)
  }

  const setPriority = async (id, priority) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority } : t))
    await api.patch(`/roadmap/${id}`, { priority }, pw)
  }

  const setTaskEpic = async (id, epic_id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, epic_id } : t))
    await api.patch(`/roadmap/${id}`, { epic_id }, pw)
    load()
  }

  const setEstimate = async (id, estimate_days) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, estimate_days } : t))
    await api.patch(`/roadmap/${id}`, { estimate_days }, pw)
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['engineering', 'business'].map(a => (
            <button key={a} onClick={() => setAudience(a)}
              style={{
                padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
                background: audience === a ? 'var(--accent1)' : 'var(--card)',
                color: audience === a ? '#fff' : 'var(--muted)',
              }}>
              {a === 'engineering' ? '🛠 Engineering' : '📊 Business'}
            </button>
          ))}
        </div>
        {audience === 'engineering' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Drag bars to reschedule · edges to resize · drag ⠿ to reorder · click a task for details and notes
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowAddEpic(v => !v)}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                  background: showAddEpic ? 'var(--card2)' : 'transparent',
                  color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                {showAddEpic ? '✕ Cancel' : '+ Add Epic'}
              </button>
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
          </div>
        )}
        {audience === 'engineering' && showAddEpic && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px', padding: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <input
              value={newEpicName}
              onChange={e => setNewEpicName(e.target.value)}
              placeholder="Epic name"
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 5 }}>
              {PALETTE.map(c => (
                <button key={c} onClick={() => setNewEpicColor(c)}
                  style={{
                    width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: newEpicColor === c ? '2px solid var(--text)' : '2px solid transparent',
                  }} />
              ))}
            </div>
            <button
              onClick={addEpic}
              disabled={!newEpicName.trim()}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent1)', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: newEpicName.trim() ? 'pointer' : 'not-allowed', opacity: newEpicName.trim() ? 1 : 0.5,
              }}>
              Add
            </button>
          </div>
        )}
        {audience === 'engineering' && showAdd && (
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
                value={draft.epic_id}
                onChange={e => setDraft(d => ({ ...d, epic_id: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--base)', color: 'var(--text)', fontSize: 13, flex: 1 }}
              >
                <option value="">— No epic —</option>
                {epics.map(ep => <option key={ep.id} value={ep.id}>{ep.name}</option>)}
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
          epics={epics}
          patchEpic={patchEpic}
          setTaskEpic={setTaskEpic}
          setEstimate={setEstimate}
          audience={audience}
        />
      </div>
    </div>
  )
}
