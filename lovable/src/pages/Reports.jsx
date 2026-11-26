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

function fmtDate(d) {
  return d.toISOString().split('T')[0]
}
function addDays(d, n) {
  const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd
}
function displayDate(str) {
  const d = new Date(str + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const SECTION_META = [
  { key: 'completed',      label: 'Completed',        color: 'var(--success)',  icon: '✓' },
  { key: 'invisible_work', label: 'Invisible work',   color: '#60a5fa',         icon: '◉' },
  { key: 'next_tasks',     label: 'Next',             color: 'var(--accent1)',  icon: '→' },
  { key: 'delayed_risks',  label: 'Delayed / Risks',  color: 'var(--danger)',   icon: '⚠' },
]

function Avatar({ name, color, size = 32 }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('')
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.34, fontWeight: 700, color: '#080d1f', flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function SourceBadge({ source }) {
  const isSlack = source === 'slack'
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
      background: isSlack ? 'rgba(74,21,75,0.3)' : 'rgba(0,207,255,0.12)',
      color: isSlack ? '#e879f9' : 'var(--accent1)',
      border: `1px solid ${isSlack ? 'rgba(232,121,249,0.3)' : 'rgba(0,207,255,0.25)'}`,
      textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      {isSlack ? 'Slack' : 'Manual'}
    </span>
  )
}

const taStyle = {
  width: '100%', background: 'var(--card2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', padding: '7px 10px',
  fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
}

function ReportCard({ item, date, pw, onUpdated }) {
  const { engineer, report } = item
  const [editing, setEditing]   = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [draft,   setDraft]     = useState({ completed: '', invisible_work: '', next_tasks: '', delayed_risks: '' })

  const startEdit = () => {
    setDraft({
      completed:      (report?.completed      || []).join('\n'),
      invisible_work: (report?.invisible_work || []).join('\n'),
      next_tasks:     (report?.next_tasks     || []).join('\n'),
      delayed_risks:  (report?.delayed_risks  || []).join('\n'),
    })
    setEditing(true)
  }

  const parseLine = s => s.split('\n').map(l => l.trim()).filter(Boolean)

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        completed:      parseLine(draft.completed),
        invisible_work: parseLine(draft.invisible_work),
        next_tasks:     parseLine(draft.next_tasks),
        delayed_risks:  parseLine(draft.delayed_risks),
      }
      if (report) {
        await api.put(`/reports/${report.id}`, payload, pw)
      } else {
        await api.post(`/reports/manual`, {
          engineer_id: engineer.id, report_date: date,
          ...payload, source: 'manual',
        }, pw)
      }
      setEditing(false)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this report?')) return
    await api.del(`/reports/${report.id}`, pw)
    onUpdated()
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Avatar name={engineer.name} color={engineer.avatar_color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{engineer.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{displayDate(date)}</div>
        </div>
        {report && <SourceBadge source={report.source} />}
        {pw && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={startEdit} title="Edit">✏</button>
            {report && (
              <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 12 }} onClick={handleDelete} title="Delete">✕</button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {editing ? (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SECTION_META.map(s => (
            <div key={s.key}>
              <div style={{ fontSize: 11, fontWeight: 600, color: s.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {s.icon} {s.label}
              </div>
              <textarea
                rows={3}
                style={taStyle}
                placeholder="One item per line"
                value={draft[s.key]}
                onChange={e => setDraft(p => ({ ...p, [s.key]: e.target.value }))}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" style={{ padding: '5px 12px' }} onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary" style={{ padding: '5px 14px' }} onClick={handleSave} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
          </div>
        </div>
      ) : report ? (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SECTION_META.map(s => {
            const items = report[s.key] || []
            if (items.length === 0 && s.key !== 'delayed_risks') return null
            return (
              <div key={s.key}>
                <div style={{ fontSize: 11, fontWeight: 600, color: s.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {s.icon} {s.label}
                </div>
                {items.length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>None</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                    {items.map((item, i) => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No report for this date</div>
          {pw && (
            <button
              className="btn"
              style={{ background: 'rgba(0,207,255,0.08)', color: 'var(--accent1)', border: '1px solid rgba(0,207,255,0.2)', padding: '5px 14px', fontSize: 12 }}
              onClick={startEdit}
            >
              + Add manually
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Reports() {
  const [date,     setDate]     = useState(fmtDate(new Date()))
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [syncing,  setSyncing]  = useState(false)
  const [syncMsg,  setSyncMsg]  = useState(null)
  const theme = useTheme()
  const pw = sessionStorage.getItem('admin_pw') || ''

  const load = useCallback(() => {
    setLoading(true)
    api.get(`/reports?date=${date}`)
      .then(d => { setItems(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [date])

  useEffect(() => { load() }, [load])

  const handleSync = async () => {
    if (!pw) { setSyncMsg({ ok: false, msg: 'Login to Admin first to sync' }); return }
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await api.post(`/sync/slack-reports?password=${encodeURIComponent(pw)}`, {})
      setSyncMsg({ ok: true, msg: `Synced ${res.records_updated} report(s) from Slack` })
      load()
    } catch (e) {
      let msg = e.message
      try { msg = JSON.parse(msg).detail || msg } catch {}
      setSyncMsg({ ok: false, msg })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div style={{ background: 'var(--base)', minHeight: '100vh' }}>
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo"><span>⬡</span> Daily Reports</div>
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
        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {/* Date nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 16, lineHeight: 1 }}
              onClick={() => setDate(fmtDate(addDays(new Date(date + 'T12:00:00'), -1)))}>←</button>
            <input
              type="date" value={date}
              onChange={e => e.target.value && setDate(e.target.value)}
              style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7,
                color: 'var(--text)', padding: '6px 10px', fontSize: 14, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            />
            <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 16, lineHeight: 1 }}
              onClick={() => setDate(fmtDate(addDays(new Date(date + 'T12:00:00'), 1)))}>→</button>
            <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => setDate(fmtDate(new Date()))}>Today</button>
          </div>

          {/* Sync button */}
          <button
            className="btn"
            style={{ background: 'rgba(74,21,75,0.2)', color: '#e879f9', border: '1px solid rgba(232,121,249,0.3)', padding: '6px 14px' }}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? <span className="spinner" /> : '⟳ Sync from Slack'}
          </button>

          {syncMsg && (
            <span style={{ fontSize: 13, color: syncMsg.ok ? 'var(--success)' : 'var(--danger)' }}>
              {syncMsg.ok ? '✓ ' : '✕ '}{syncMsg.msg}
            </span>
          )}

          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
            {items.filter(i => i.report).length} / {items.length} reports submitted
          </div>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <LoadingSpinner />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {items.map(item => (
              <ReportCard
                key={item.engineer.id}
                item={item}
                date={date}
                pw={pw}
                onUpdated={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
