import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

const PRIORITIES = {
  P0: { label: 'P0', color: '#dc2626' },
  P1: { label: 'P1', color: '#f97316' },
  P2: { label: 'P2', color: '#2563eb' },
  P3: { label: 'P3', color: '#7c3aed' },
}

const EMPTY_DRAFT = { title: '', owner_id: '', priority: 'P2', description: '' }

export default function Roadmap() {
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [openId, setOpenId] = useState(null)
  const [dragId, setDragId] = useState(null)
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

  const onDrop = async (targetId) => {
    if (dragId == null || dragId === targetId) return
    const ids = tasks.map(t => t.id)
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    const reordered = ids.map(id => tasks.find(t => t.id === id))
    setTasks(reordered)
    setDragId(null)
    await api.patch('/roadmap/reorder', { order: ids }, pw)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--base)' }}>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo"><span>⬡</span> Roadmap</div>
        </div>
        <Link to="/" className="topbar-admin-link">← Dashboard</Link>
      </div>
      <div className="page" style={{ paddingTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Drag rows to reorder priority · click a task for details and notes
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map(t => {
            const prio = PRIORITIES[t.priority] || PRIORITIES.P2
            const isOpen = openId === t.id
            return (
              <div key={t.id}
                draggable
                onDragStart={() => setDragId(t.id)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(t.id)}
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, opacity: dragId === t.id ? 0.4 : 1 }}>
                <div onClick={() => setOpenId(isOpen ? null : t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
                  <span style={{ cursor: 'grab', color: 'var(--muted)', fontSize: 14 }}>⠿</span>
                  <span style={{ width: 28, fontSize: 11, fontWeight: 700, color: prio.color }}>{prio.label}</span>
                  {t.owner_color && <span style={{ width: 22, height: 22, borderRadius: '50%', background: t.owner_color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#08131f' }}>{(t.owner_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('')}</span>}
                  <span style={{ flex: 1, fontSize: 14 }}>{t.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.owner_name || '—'}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '0 16px 16px 56px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ margin: '12px 0' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Description</div>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{t.description || '—'}</div>
                    </div>
                    <div style={{ margin: '12px 0' }}>
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
          {tasks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', fontSize: 13 }}>
              No roadmap tasks yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
