import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'
import { useTheme, toggleTheme } from '../hooks/useTheme'

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

const COLUMNS = [
  { key: 'new',         label: 'New',         color: 'var(--muted)' },
  { key: 'todo',        label: 'To Do',       color: 'var(--warning)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--accent2)' },
  { key: 'done',        label: 'Done',        color: 'var(--success)' },
]

export default function TaskBoard() {
  const [week, setWeek] = useState(null)
  const [year, setYear] = useState(null)
  const [tasks, setTasks] = useState([])
  const [archive, setArchive] = useState([])
  const [openWeeks, setOpenWeeks] = useState({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [filterEng, setFilterEng] = useState('all')
  const [dragId, setDragId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const theme = useTheme()
  const pw = sessionStorage.getItem('admin_pw') || ''

  useEffect(() => {
    api.get('/overview').then(d => {
      setWeek(d.current_week || null)
      setYear(d.current_year || new Date().getFullYear())
    })
  }, [])

  const load = useCallback(() => {
    if (!week || !year) return
    setLoading(true)
    api.get(`/tasks?week=${week}&year=${year}`)
      .then(d => setTasks(d.tasks || []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false))
    api.get(`/tasks/archive?before_week=${week}&year=${year}`)
      .then(d => setArchive(d.archive || []))
      .catch(() => setArchive([]))
  }, [week, year])

  useEffect(() => { load() }, [load])

  const handleSync = async () => {
    if (!pw) { setSyncMsg({ ok: false, msg: 'Login to Admin first to sync' }); return }
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await api.post(`/tasks/sync?week=${week}&year=${year}&password=${encodeURIComponent(pw)}`, {})
      setSyncMsg({ ok: true, msg: `Synced ${res.tasks_synced} task(s) from daily reports` })
      load()
    } catch (e) {
      let msg = e.message
      try { msg = JSON.parse(msg).detail || msg } catch {}
      setSyncMsg({ ok: false, msg })
    } finally {
      setSyncing(false)
    }
  }

  const moveTask = async (taskId, newStatus) => {
    if (!pw) { setSyncMsg({ ok: false, msg: 'Login to Admin first to move tasks' }); return }
    const prevTasks = tasks
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    try {
      await api.patch(`/tasks/${taskId}/status`, { status: newStatus }, pw)
    } catch (e) {
      setTasks(prevTasks)
      let msg = e.message
      try { msg = JSON.parse(msg).detail || msg } catch {}
      setSyncMsg({ ok: false, msg: `Move failed: ${msg}` })
    }
  }

  const engineers = [...new Set(tasks.map(t => t.engineer_name))]
  const shown = filterEng === 'all' ? tasks : tasks.filter(t => t.engineer_name === filterEng)

  return (
    <div style={{ background: 'var(--base)', minHeight: '100vh' }}>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo"><span>⬡</span> Task Board</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/" className="topbar-admin-link">← Dashboard</Link>
          <Link to="/admin" className="topbar-admin-link">Admin ↗</Link>
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, marginTop: 24, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Week {week ?? '…'}{year ? `, ${year}` : ''} · auto-generated from daily reports
          </div>

          <button
            className="btn"
            style={{ background: 'rgba(123,97,255,0.15)', color: 'var(--accent2)', border: '1px solid rgba(123,97,255,0.3)', padding: '6px 14px' }}
            onClick={handleSync}
            disabled={syncing || !week}
          >
            {syncing ? <span className="spinner" /> : '↻ Sync from reports'}
          </button>

          {syncMsg && (
            <span style={{ fontSize: 13, color: syncMsg.ok ? 'var(--success)' : 'var(--danger)' }}>
              {syncMsg.ok ? '✓ ' : '✕ '}{syncMsg.msg}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, marginTop: 16 }}>
          <button onClick={() => setFilterEng('all')} className="btn btn-ghost"
            style={{
              padding: '5px 14px', fontSize: 12,
              background: filterEng === 'all' ? 'var(--accent1)' : 'var(--card2)',
              color: filterEng === 'all' ? '#080d1f' : 'var(--muted)',
              border: '1px solid var(--border)',
            }}>
            All
          </button>
          {engineers.map(e => (
            <button key={e} onClick={() => setFilterEng(e)} className="btn btn-ghost"
              style={{
                padding: '5px 14px', fontSize: 12,
                background: filterEng === e ? 'var(--accent1)' : 'var(--card2)',
                color: filterEng === e ? '#080d1f' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>
              {e}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <LoadingSpinner />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {COLUMNS.map(col => {
              const colTasks = shown.filter(t => t.status === col.key)
              return (
                <div
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key) }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragId != null) moveTask(dragId, col.key)
                    setDragId(null)
                    setDragOverCol(null)
                  }}
                  style={{
                    background: 'var(--card)',
                    border: dragOverCol === col.key ? `1.5px solid ${col.color}` : '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 16,
                    transition: 'border-color .15s',
                    minHeight: 120,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{colTasks.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {colTasks.map(t => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move' }}
                        onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
                        style={{
                          background: 'var(--card2)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          cursor: 'grab',
                          opacity: dragId === t.id ? 0.4 : 1,
                          transition: 'opacity .15s',
                        }}
                      >
                        <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 6, color: 'var(--text)' }}>
                          {t.title}
                          {!!t.manual_override && (
                            <span title="Manually moved — kept as-is on next sync" style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>📌</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.project && (
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--border)', color: 'var(--muted)' }}>
                              {t.project}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.engineer_color || 'var(--muted)', display: 'inline-block' }} />
                            {t.engineer_name}
                          </span>
                        </div>
                      </div>
                    ))}
                    {colTasks.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 12 }}>—</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {archive.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
              color: 'var(--muted)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)',
            }}>
              Archive · completed in previous weeks
            </div>
            {archive.map(grp => {
              const isOpen = !!openWeeks[grp.week]
              return (
                <div key={grp.week} className="card" style={{ padding: 0, marginBottom: 8, overflow: 'hidden' }}>
                  <div
                    onClick={() => setOpenWeeks(p => ({ ...p, [grp.week]: !p[grp.week] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Week {grp.week}</span>
                    <span style={{ fontSize: 12, color: 'var(--success)', marginLeft: 'auto' }}>{grp.count} completed</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {grp.tasks.map(t => (
                        <div key={t.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 6, color: 'var(--text)' }}>{t.title}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {t.project && (
                              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--border)', color: 'var(--muted)' }}>
                                {t.project}
                              </span>
                            )}
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.engineer_color || 'var(--muted)', display: 'inline-block' }} />
                              {t.engineer_name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
