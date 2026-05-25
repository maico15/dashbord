import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

const STREAMS = ['dev', 'support', 'docs']
const STREAM_LABELS = { dev: 'Development', support: 'Support', docs: 'Documentation' }

const METRIC_FIELDS = {
  dev: [
    { key: 'prs_merged', label: 'PRs merged', type: 'number' },
    { key: 'tickets_closed', label: 'Tickets closed', type: 'number' },
    { key: 'cycle_time_days', label: 'Cycle time (days)', type: 'number', step: '0.1' },
    { key: 'features_completed', label: 'Features', type: 'number' },
    { key: 'deploys', label: 'Deploys', type: 'number' },
  ],
  support: [
    { key: 'incidents_opened', label: 'Opened', type: 'number' },
    { key: 'incidents_resolved', label: 'Resolved', type: 'number' },
    { key: 'avg_resolution_hours', label: 'Avg res. (h)', type: 'number', step: '0.1' },
    { key: 'sla_breached', label: 'SLA breached', type: 'number' },
    { key: 'total_incidents', label: 'Total incidents', type: 'number' },
  ],
  docs: [
    { key: 'docs_created', label: 'Created', type: 'number' },
    { key: 'docs_updated', label: 'Updated', type: 'number' },
    { key: 'projects_covered', label: 'Projects covered', type: 'number' },
    { key: 'projects_total', label: 'Projects total', type: 'number' },
  ],
}

// ── Login ────────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.post(`/admin/verify?password=${encodeURIComponent(pw)}`, {})
      sessionStorage.setItem('admin_pw', pw)
      onLogin(pw)
    } catch {
      setError('Invalid password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h2>Admin Panel</h2>
        <p>Engineering Dashboard</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Login'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  )
}

// ── Config section ────────────────────────────────────────────────────────────

function ConfigSection({ pw }) {
  const [cfg, setCfg] = useState({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.get('/config').then(setCfg)
  }, [])

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const handleSave = async () => {
    await api.put(`/config`, {
      team_name: cfg.team_name,
      current_week: parseInt(cfg.current_week),
      current_year: parseInt(cfg.current_year),
      github_token: cfg.github_token,
      jira_token: cfg.jira_token,
      anthropic_admin_key: cfg.anthropic_admin_key,
      ai_auto_sync: cfg.ai_auto_sync,
    }, pw)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await api.post(`/ai-usage/sync?password=${encodeURIComponent(pw)}`, {})
      setSyncMsg(`✓ Synced (${res.source === 'api' ? 'live API' : 'mock'}) · ${res.total_tokens?.toLocaleString()} tokens`)
    } catch (e) {
      setSyncMsg(`Error: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const set = (k, v) => setCfg((prev) => ({ ...prev, [k]: v }))

  return (
    <div className="admin-section">
      <h2>Configuration</h2>
      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Team Name</label>
            <input value={cfg.team_name || ''} onChange={(e) => set('team_name', e.target.value)} />
          </div>
          <div className="form-group" style={{ maxWidth: 120 }}>
            <label>Current Week</label>
            <input type="number" min={1} max={53} value={cfg.current_week || ''} onChange={(e) => set('current_week', e.target.value)} />
          </div>
          <div className="form-group" style={{ maxWidth: 120 }}>
            <label>Year</label>
            <input type="number" value={cfg.current_year || ''} onChange={(e) => set('current_year', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>GitHub Token</label>
            <input type="password" value={cfg.github_token || ''} onChange={(e) => set('github_token', e.target.value)} placeholder="ghp_..." />
          </div>
          <div className="form-group">
            <label>Jira Token</label>
            <input type="password" value={cfg.jira_token || ''} onChange={(e) => set('jira_token', e.target.value)} placeholder="ATATT3..." />
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0', paddingTop: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--ai)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontWeight: 600 }}>
            ⬡ AI Usage (Anthropic)
          </div>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="form-group">
              <label>Anthropic Admin API Key</label>
              <input
                type="password"
                value={cfg.anthropic_admin_key || ''}
                onChange={(e) => set('anthropic_admin_key', e.target.value)}
                placeholder="sk-ant-admin-..."
              />
            </div>
            <div className="form-group" style={{ maxWidth: 160 }}>
              <label>Auto-sync</label>
              <select
                value={cfg.ai_auto_sync || '0'}
                onChange={(e) => set('ai_auto_sync', e.target.value)}
              >
                <option value="0">Disabled</option>
                <option value="24">Every 24 hours</option>
                <option value="1">Every hour</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <button
              className="btn"
              style={{ background: 'rgba(168,85,247,0.15)', color: 'var(--ai)', border: '1px solid rgba(168,85,247,0.3)', padding: '6px 14px' }}
              onClick={handleSyncNow}
              disabled={syncing}
            >
              {syncing ? <span className="spinner" /> : '⟳ Sync now'}
            </button>
            {syncMsg && (
              <span style={{ fontSize: 12, color: syncMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)' }}>
                {syncMsg}
              </span>
            )}
          </div>
        </div>

        <div className="flex-end mt-8">
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stream checkboxes ─────────────────────────────────────────────────────────

function StreamCheckboxes({ selected, onChange }) {
  const toggle = (s) => {
    if (selected.includes(s)) {
      const next = selected.filter((x) => x !== s)
      if (next.length > 0) onChange(next)
    } else {
      onChange([...selected, s])
    }
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      {STREAMS.map((s) => (
        <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={selected.includes(s)}
            onChange={() => toggle(s)}
            style={{ accentColor: 'var(--accent1)', cursor: 'pointer' }}
          />
          <span className={`tag tag-${s}`} style={{ cursor: 'pointer' }}>{STREAM_LABELS[s]}</span>
        </label>
      ))}
    </div>
  )
}

// ── Task editor (used inside TeamSection) ────────────────────────────────────

function TaskEditor({ member, pw, onClose }) {
  const currentWeek = (() => {
    const d = new Date()
    const s = new Date(d.getFullYear(), 0, 1)
    return Math.ceil(((d - s) / 86400000 + s.getDay() + 1) / 7) || 1
  })()

  const [week, setWeek]       = useState(currentWeek)
  const [year, setYear]       = useState(new Date().getFullYear())
  const [whatDone, setWhatDone] = useState('')
  const [plan, setPlan]       = useState('')
  const [stream, setStream]   = useState((member.streams && member.streams[0]) || member.stream || 'dev')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  // Load existing tasks when week/year changes
  useEffect(() => {
    api.get(`/engineers/${member.id}/tasks?week=${week}&year=${year}`)
      .then((t) => {
        if (t) {
          setWhatDone((t.what_was_done || []).join('\n'))
          setPlan((t.next_week || []).join('\n'))
          setStream(t.stream || member.stream)
        } else {
          setWhatDone('')
          setPlan('')
          setStream(member.stream)
        }
      })
      .catch(() => { setWhatDone(''); setPlan('') })
  }, [week, year, member.id, member.stream])

  const parseLine = (s) => s.split('\n').map(l => l.trim()).filter(Boolean)

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.post(
        `/engineers/${member.id}/tasks?password=${encodeURIComponent(pw)}`,
        { week_number: week, year, what_was_done: parseLine(whatDone), next_week: parseLine(plan), stream },
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', background: 'var(--card2)',
    border: '1px solid var(--border)', borderRadius: 7,
    color: 'var(--text)', padding: '8px 10px',
    fontSize: 13, fontFamily: 'inherit', outline: 'none',
    resize: 'vertical',
  }

  return (
    <div style={{
      padding: '16px 20px', background: 'rgba(0,207,255,0.03)',
      borderTop: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="form-group" style={{ maxWidth: 100 }}>
          <label>Week</label>
          <input type="number" min={1} max={53} value={week} onChange={(e) => setWeek(+e.target.value || 1)} />
        </div>
        <div className="form-group" style={{ maxWidth: 100 }}>
          <label>Year</label>
          <input type="number" value={year} onChange={(e) => setYear(+e.target.value || 2025)} />
        </div>
        <div className="form-group" style={{ maxWidth: 140 }}>
          <label>Stream</label>
          <select value={stream} onChange={(e) => setStream(e.target.value)}>
            {STREAMS.map(s => <option key={s} value={s}>{STREAM_LABELS[s]}</option>)}
          </select>
        </div>
        <button className="btn btn-ghost" style={{ padding: '5px 10px', marginBottom: 2 }} onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--accent1)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5, fontWeight: 600 }}>
            WHAT WAS DONE
          </div>
          <textarea
            rows={4} style={inputStyle} placeholder={"One task per line\nFixed auth bug\nCode review #234"}
            value={whatDone} onChange={(e) => setWhatDone(e.target.value)}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--accent2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5, fontWeight: 600 }}>
            NEXT WEEK PLAN
          </div>
          <textarea
            rows={4} style={inputStyle} placeholder={"One task per line\nRefactor module X\nWrite tests"}
            value={plan} onChange={(e) => setPlan(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Team section ──────────────────────────────────────────────────────────────

function TeamSection({ pw }) {
  const [members, setMembers]   = useState([])
  const [editing, setEditing]   = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [newMember, setNewMember] = useState({ name: '', streams: ['dev'], avatar_color: '#00cfff' })

  const load = () => api.get('/team').then(setMembers)
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!newMember.name.trim()) return
    await api.post('/team', newMember, pw)
    setNewMember({ name: '', streams: ['dev'], avatar_color: '#00cfff' })
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete member?')) return
    await api.del(`/team/${id}`, pw)
    if (expandedId === id) setExpandedId(null)
    load()
  }

  const handleSaveEdit = async () => {
    await api.put(`/team/${editing.id}`, {
      name: editing.name, streams: editing.streams, avatar_color: editing.avatar_color,
    }, pw)
    setEditing(null)
    load()
  }

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id)
    setEditing(null)
  }

  return (
    <div className="admin-section">
      <h2>Team Members</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {members.map((m) => (
          <div key={m.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Member row */}
            {editing?.id === m.id ? (
              <div style={{ display: 'flex', gap: 8, padding: '10px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  style={{ flex: 1, minWidth: 140, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13 }} />
                <StreamCheckboxes
                  selected={editing.streams || [editing.stream]}
                  onChange={(v) => setEditing({ ...editing, streams: v })}
                />
                <input type="color" value={editing.avatar_color} onChange={(e) => setEditing({ ...editing, avatar_color: e.target.value })} />
                <button className="btn btn-primary" style={{ padding: '5px 12px' }} onClick={handleSaveEdit}>✓</button>
                <button className="btn btn-ghost"   style={{ padding: '5px 12px' }} onClick={() => setEditing(null)}>✕</button>
              </div>
            ) : (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                onClick={() => toggleExpand(m.id)}
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: m.avatar_color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#080d1f' }}>
                  {m.name.split(' ').slice(0, 2).map(w => w[0]).join('')}
                </div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{m.name}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(m.streams || [m.stream]).map(s => (
                    <span key={s} className={`tag tag-${s}`}>{STREAM_LABELS[s]}</span>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
                  {expandedId === m.id ? '▲ tasks' : '▼ tasks'}
                </span>
                <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); setEditing({ ...m, streams: m.streams || [m.stream] }); setExpandedId(null) }}>✏</button>
                <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}>✕</button>
              </div>
            )}

            {/* Task editor (expanded) */}
            {expandedId === m.id && (
              <TaskEditor member={m} pw={pw} onClose={() => setExpandedId(null)} />
            )}
          </div>
        ))}

        {/* Add new member row */}
        <div className="card" style={{ display: 'flex', gap: 8, padding: '10px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="New member name" value={newMember.name}
            onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
            style={{ flex: 1, minWidth: 140, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13 }}
          />
          <StreamCheckboxes
            selected={newMember.streams}
            onChange={(v) => setNewMember({ ...newMember, streams: v })}
          />
          <input type="color" value={newMember.avatar_color} onChange={(e) => setNewMember({ ...newMember, avatar_color: e.target.value })} />
          <button className="btn btn-primary" style={{ padding: '5px 14px' }} onClick={handleAdd}>+ Add</button>
        </div>
      </div>
    </div>
  )
}

// ── Metrics section ───────────────────────────────────────────────────────────

function MetricsSection({ pw }) {
  const [stream, setStream] = useState('dev')
  const [week, setWeek] = useState(new Date().getDay() > 0 ? Math.ceil(new Date() / 604800000 - 1970 * 52.18) % 53 || 1 : 1)
  const [rows, setRows] = useState([])
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState({})

  // Simpler week calc
  useEffect(() => {
    const d = new Date()
    const startOfYear = new Date(d.getFullYear(), 0, 1)
    const w = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
    setWeek(w || 1)
  }, [])

  const loadMetrics = () => {
    api.get(`/admin/metrics/${stream}/${week}?password=${encodeURIComponent(pw)}`)
      .then((data) => {
        setRows(data)
        const initial = {}
        data.forEach((r) => {
          if (r.metrics) initial[r.member.id] = { ...r.metrics }
        })
        setEdits(initial)
      })
      .catch(console.error)
  }

  useEffect(() => { loadMetrics() }, [stream, week, pw])

  const setField = (memberId, key, val) => {
    setEdits((prev) => ({
      ...prev,
      [memberId]: { ...(prev[memberId] || {}), [key]: parseFloat(val) || 0 },
    }))
  }

  const handleSave = async (memberId) => {
    setSaving((s) => ({ ...s, [memberId]: true }))
    await api.put(
      `/admin/metrics/${stream}/${week}/${memberId}`,
      { metrics: edits[memberId] || {} },
      pw,
    )
    setSaving((s) => ({ ...s, [memberId]: false }))
  }

  const fields = METRIC_FIELDS[stream] || []

  return (
    <div className="admin-section">
      <h2>Weekly Metrics</h2>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <div className="form-group" style={{ maxWidth: 180 }}>
          <label>Stream</label>
          <select value={stream} onChange={(e) => setStream(e.target.value)}>
            {STREAMS.map((s) => <option key={s} value={s}>{STREAM_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ maxWidth: 120 }}>
          <label>Week</label>
          <input type="number" min={1} max={53} value={week} onChange={(e) => setWeek(parseInt(e.target.value) || 1)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: 16 }}>No members in this stream</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                {fields.map((f) => <th key={f.key}>{f.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mid = r.member.id
                const edit = edits[mid] || {}
                return (
                  <tr key={mid}>
                    <td style={{ fontWeight: 500 }}>{r.member.name}</td>
                    {fields.map((f) => (
                      <td key={f.key}>
                        <input
                          type="number"
                          step={f.step || '1'}
                          min={0}
                          value={edit[f.key] ?? 0}
                          onChange={(e) => setField(mid, f.key, e.target.value)}
                          style={{
                            background: 'var(--card2)', border: '1px solid var(--border)',
                            borderRadius: 5, color: 'var(--text)', padding: '4px 6px',
                            fontSize: 13, width: 80,
                          }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 12px' }}
                        onClick={() => handleSave(mid)}
                        disabled={saving[mid]}
                      >
                        {saving[mid] ? <span className="spinner" /> : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Score rules section ───────────────────────────────────────────────────────

function RulesSection({ pw }) {
  const [rules, setRules] = useState([])
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState({})

  useEffect(() => {
    api.get('/score-rules').then((data) => {
      setRules(data)
      const init = {}
      data.forEach((r) => { init[r.id] = r.points })
      setEdits(init)
    })
  }, [])

  const handleSave = async (rule) => {
    setSaving((s) => ({ ...s, [rule.id]: true }))
    await api.put(`/score-rules/${rule.id}`, { points: parseInt(edits[rule.id]) || 0 }, pw)
    setSaving((s) => ({ ...s, [rule.id]: false }))
  }

  const grouped = STREAMS.reduce((acc, s) => {
    acc[s] = rules.filter((r) => r.stream === s)
    return acc
  }, {})

  return (
    <div className="admin-section">
      <h2>Score Rules</h2>
      {STREAMS.map((s) => (
        <div key={s} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {STREAM_LABELS[s]}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th style={{ width: 120 }}>Points</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {grouped[s]?.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.label}</td>
                    <td>
                      <input
                        type="number"
                        value={edits[rule.id] ?? rule.points}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                        style={{
                          background: 'var(--card2)', border: '1px solid var(--border)',
                          borderRadius: 5, color: parseInt(edits[rule.id]) < 0 ? 'var(--danger)' : 'var(--success)',
                          padding: '4px 8px', fontSize: 13, width: 80, fontWeight: 600,
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => handleSave(rule)}
                        disabled={saving[rule.id]}
                      >
                        {saving[rule.id] ? <span className="spinner" /> : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Security section ──────────────────────────────────────────────────────────

function SecuritySection({ pw, onPasswordChange }) {
  const [currentPw,  setCurrentPw]  = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [status,     setStatus]     = useState(null)
  const [loading,    setLoading]    = useState(false)

  const handleSave = async () => {
    setStatus(null)
    if (!currentPw || !newPw || !confirmPw) {
      return setStatus({ ok: false, msg: 'Fill in all fields' })
    }
    if (newPw !== confirmPw) {
      return setStatus({ ok: false, msg: 'Passwords do not match' })
    }
    if (newPw.length < 4) {
      return setStatus({ ok: false, msg: 'Minimum 4 characters' })
    }
    setLoading(true)
    try {
      await api.post('/admin/change-password', { current_password: currentPw, new_password: newPw })
      sessionStorage.setItem('admin_pw', newPw)
      onPasswordChange(newPw)
      setStatus({ ok: true, msg: 'Password changed successfully' })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e) {
      const msg = e.message.includes('Incorrect') ? 'Incorrect current password' : e.message
      setStatus({ ok: false, msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-section">
      <h2>Security</h2>
      <div className="card" style={{ maxWidth: 400 }}>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Current password</label>
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>New password</label>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Confirm new password</label>
          <input
            type="password" value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            autoComplete="new-password"
          />
        </div>
        {status && (
          <div style={{
            fontSize: 13, marginBottom: 12,
            color: status.ok ? 'var(--success)' : 'var(--danger)',
          }}>
            {status.ok ? '✓ ' : '✕ '}{status.msg}
          </div>
        )}
        <div className="flex-end">
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reports admin section ────────────────────────────────────────────────────

function ReportsAdminSection({ pw }) {
  const [date,     setDate]     = useState(() => new Date().toISOString().split('T')[0])
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [editing,  setEditing]  = useState({})   // {engineerId: {completed,invisible_work,next_tasks,delayed_risks}}
  const [saving,   setSaving]   = useState({})
  const [syncing,  setSyncing]  = useState(false)
  const [syncMsg,  setSyncMsg]  = useState(null)
  const [lastSync, setLastSync] = useState(null)

  const load = () => {
    setLoading(true)
    api.get(`/reports?date=${date}`)
      .then(d => { setItems(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [date])

  useEffect(() => {
    api.get(`/sync/slack-reports/status?password=${encodeURIComponent(pw)}`)
      .then(setLastSync).catch(() => {})
  }, [])

  const startEdit = (item) => {
    const r = item.report
    setEditing(prev => ({
      ...prev,
      [item.engineer.id]: {
        completed:      (r?.completed      || []).join('\n'),
        invisible_work: (r?.invisible_work || []).join('\n'),
        next_tasks:     (r?.next_tasks     || []).join('\n'),
        delayed_risks:  (r?.delayed_risks  || []).join('\n'),
      }
    }))
  }

  const cancelEdit = (eid) => setEditing(prev => { const n = { ...prev }; delete n[eid]; return n })

  const parseLine = s => s.split('\n').map(l => l.trim()).filter(Boolean)

  const handleSave = async (item) => {
    const eid = item.engineer.id
    setSaving(prev => ({ ...prev, [eid]: true }))
    const draft = editing[eid]
    const payload = {
      completed:      parseLine(draft.completed),
      invisible_work: parseLine(draft.invisible_work),
      next_tasks:     parseLine(draft.next_tasks),
      delayed_risks:  parseLine(draft.delayed_risks),
    }
    try {
      if (item.report) {
        await api.put(`/reports/${item.report.id}`, payload, pw)
      } else {
        await api.post('/reports/manual', {
          engineer_id: eid, report_date: date, ...payload, source: 'manual',
        }, pw)
      }
      cancelEdit(eid)
      load()
    } finally {
      setSaving(prev => ({ ...prev, [eid]: false }))
    }
  }

  const handleDelete = async (report) => {
    if (!confirm('Delete this report?')) return
    await api.del(`/reports/${report.id}`, pw)
    load()
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await api.post(`/sync/slack-reports?password=${encodeURIComponent(pw)}`, {})
      setSyncMsg({ ok: true, msg: `Synced ${res.records_updated} report(s)` })
      load()
      const status = await api.get(`/sync/slack-reports/status?password=${encodeURIComponent(pw)}`)
      setLastSync(status)
    } catch (e) {
      let msg = e.message; try { msg = JSON.parse(msg).detail || msg } catch {}
      setSyncMsg({ ok: false, msg })
    } finally {
      setSyncing(false)
    }
  }

  const taStyle = {
    width: '100%', background: 'var(--card2)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text)', padding: '6px 8px',
    fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
  }

  return (
    <div className="admin-section">
      <h2>Daily Reports</h2>

      {/* Slack sync status bar */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Channel: <code style={{ color: 'var(--accent1)' }}>C08NK2SD5CK</code></span>
        <button
          className="btn"
          style={{ background: 'rgba(74,21,75,0.2)', color: '#e879f9', border: '1px solid rgba(232,121,249,0.3)', padding: '5px 12px', fontSize: 12 }}
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? <span className="spinner" /> : '⟳ Sync from Slack'}
        </button>
        {syncMsg && (
          <span style={{ fontSize: 12, color: syncMsg.ok ? 'var(--success)' : 'var(--danger)' }}>
            {syncMsg.ok ? '✓ ' : '✕ '}{syncMsg.msg}
          </span>
        )}
        {lastSync && lastSync.status !== 'never' && (
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
            Last sync: {new Date(lastSync.timestamp).toLocaleString()} · {lastSync.records_updated} records
          </span>
        )}
      </div>

      {/* Date selector */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>Date</label>
        <input
          type="date" value={date}
          onChange={e => e.target.value && setDate(e.target.value)}
          style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '5px 10px', fontSize: 13 }}
        />
        <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }}
          onClick={() => setDate(new Date().toISOString().split('T')[0])}>Today</button>
      </div>

      {loading ? (
        <div className="spinner" style={{ display: 'block', margin: '20px auto' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(item => {
            const eid = item.engineer.id
            const draft = editing[eid]
            const r = item.report
            return (
              <div key={eid} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Row header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: draft ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: item.engineer.avatar_color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#080d1f' }}>
                    {item.engineer.name.split(' ').slice(0,2).map(w=>w[0]).join('')}
                  </div>
                  <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{item.engineer.name}</span>
                  {r ? (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(0,255,157,0.1)', color: 'var(--success)', border: '1px solid rgba(0,255,157,0.25)' }}>
                      Submitted · {r.source}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,80,80,0.1)', color: 'var(--danger)', border: '1px solid rgba(255,80,80,0.2)' }}>
                      Missing
                    </span>
                  )}
                  {!draft && (
                    <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => startEdit(item)}>
                      {r ? '✏ Edit' : '+ Add'}
                    </button>
                  )}
                  {r && !draft && (
                    <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => handleDelete(r)}>✕</button>
                  )}
                </div>

                {/* Inline edit form */}
                {draft && (
                  <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { key: 'completed',      label: 'Completed',       color: 'var(--success)' },
                      { key: 'invisible_work', label: 'Invisible Work',  color: '#60a5fa' },
                      { key: 'next_tasks',     label: 'Next',            color: 'var(--accent1)' },
                      { key: 'delayed_risks',  label: 'Delayed / Risks', color: 'var(--danger)' },
                    ].map(s => (
                      <div key={s.key}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: s.color, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {s.label}
                        </div>
                        <textarea
                          rows={3}
                          style={taStyle}
                          placeholder="One item per line"
                          value={draft[s.key]}
                          onChange={e => setEditing(prev => ({
                            ...prev,
                            [eid]: { ...prev[eid], [s.key]: e.target.value }
                          }))}
                        />
                      </div>
                    ))}
                    <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button className="btn btn-ghost" style={{ padding: '5px 12px' }} onClick={() => cancelEdit(eid)}>Cancel</button>
                      <button className="btn btn-primary" style={{ padding: '5px 14px' }} onClick={() => handleSave(item)} disabled={saving[eid]}>
                        {saving[eid] ? <span className="spinner" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Integrations section ─────────────────────────────────────────────────────

function IntegrationsSection({ pw }) {
  const [jiraDomain,   setJiraDomain]   = useState('')
  const [jiraEmail,    setJiraEmail]    = useState('')
  const [jiraToken,    setJiraToken]    = useState('')
  const [projectKeys,  setProjectKeys]  = useState('')
  const [usernameMap,  setUsernameMap]  = useState([])
  const [newRow,       setNewRow]       = useState({ jira_email: '', engineer_name: '' })
  const [saved,        setSaved]        = useState(false)
  const [syncing,      setSyncing]      = useState(false)
  const [syncResult,   setSyncResult]   = useState(null)
  const [lastSync,     setLastSync]     = useState(null)
  const [slackToken,   setSlackToken]   = useState('')
  const [slackChannel, setSlackChannel] = useState('C08NK2SD5CK')
  const [slackSyncResult, setSlackSyncResult] = useState(null)
  const [slackTesting, setSlackTesting] = useState(false)
  const [slackTestResult, setSlackTestResult] = useState(null)
  const [slackLastSync, setSlackLastSync] = useState(null)

  const loadStatus = () => {
    api.get(`/sync/jira/status?password=${encodeURIComponent(pw)}`)
      .then(setLastSync)
      .catch(() => {})
  }

  useEffect(() => {
    api.get('/config').then((c) => {
      setJiraDomain(c.jira_domain || '')
      setJiraEmail(c.jira_email || '')
      setJiraToken(c.jira_api_token || '')
      try {
        setProjectKeys(JSON.parse(c.jira_project_keys || '[]').join(', '))
      } catch { setProjectKeys('') }
      try {
        setUsernameMap(
          Object.entries(JSON.parse(c.jira_username_map || '{}')).map(
            ([jira_email, engineer_name]) => ({ jira_email, engineer_name })
          )
        )
      } catch { setUsernameMap([]) }
      setSlackToken(c.slack_bot_token || '')
      setSlackChannel(c.slack_reports_channel_id || 'C08NK2SD5CK')
    })
    loadStatus()
    api.get(`/sync/slack-reports/status?password=${encodeURIComponent(pw)}`)
      .then(setSlackLastSync).catch(() => {})
  }, [])

  const handleSave = async () => {
    const mapObj = {}
    usernameMap.forEach(({ jira_email, engineer_name }) => {
      if (jira_email.trim() && engineer_name.trim()) mapObj[jira_email.trim()] = engineer_name.trim()
    })
    const keys = projectKeys.split(',').map(k => k.trim()).filter(Boolean)
    await api.put('/config', {
      jira_domain:      jiraDomain,
      jira_email:       jiraEmail,
      jira_api_token:   jiraToken,
      jira_project_keys: JSON.stringify(keys),
      jira_username_map: JSON.stringify(mapObj),
      slack_bot_token: slackToken,
      slack_reports_channel_id: slackChannel,
    }, pw)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await api.post(`/sync/jira?password=${encodeURIComponent(pw)}`, {})
      setSyncResult({ ok: true, msg: `Synced ${res.records_updated} record(s)` })
      loadStatus()
    } catch (e) {
      let msg = e.message
      try { msg = JSON.parse(msg).detail || msg } catch {}
      setSyncResult({ ok: false, msg })
    } finally {
      setSyncing(false)
    }
  }

  const handleSlackTest = async () => {
    setSlackTesting(true)
    setSlackTestResult(null)
    try {
      const res = await api.post(`/sync/slack-reports/test?password=${encodeURIComponent(pw)}`, {})
      setSlackTestResult({ ok: true, msg: `Connected as ${res.user} in ${res.team}` })
    } catch (e) {
      let msg = e.message; try { msg = JSON.parse(msg).detail || msg } catch {}
      setSlackTestResult({ ok: false, msg })
    } finally {
      setSlackTesting(false)
    }
  }

  const handleSlackSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await api.post(`/sync/slack-reports?password=${encodeURIComponent(pw)}`, {})
      setSyncResult({ ok: true, msg: `Synced ${res.records_updated} report(s) from Slack` })
      const status = await api.get(`/sync/slack-reports/status?password=${encodeURIComponent(pw)}`)
      setSlackLastSync(status)
    } catch (e) {
      let msg = e.message; try { msg = JSON.parse(msg).detail || msg } catch {}
      setSyncResult({ ok: false, msg })
    } finally {
      setSyncing(false)
    }
  }

  const addRow = () => {
    if (!newRow.jira_email.trim() || !newRow.engineer_name.trim()) return
    setUsernameMap(prev => [...prev, { ...newRow }])
    setNewRow({ jira_email: '', engineer_name: '' })
  }

  const removeRow = (idx) => setUsernameMap(prev => prev.filter((_, i) => i !== idx))

  const updateRow = (idx, field, val) =>
    setUsernameMap(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))

  const statusDot = lastSync?.status === 'success'
    ? 'var(--success)'
    : lastSync?.status === 'error'
      ? 'var(--danger)'
      : 'var(--muted)'

  const inputStyle = {
    flex: 1, background: 'var(--card2)', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13,
  }

  return (
    <div className="admin-section">
      <h2>Integrations</h2>

      <div style={{ fontSize: 11, color: 'var(--accent1)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontWeight: 600 }}>
        Jira Cloud
      </div>

      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Jira Domain</label>
            <input value={jiraDomain} onChange={e => setJiraDomain(e.target.value)} placeholder="yourcompany.atlassian.net" />
          </div>
          <div className="form-group">
            <label>Jira Email</label>
            <input type="email" value={jiraEmail} onChange={e => setJiraEmail(e.target.value)} placeholder="admin@yourcompany.com" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Jira API Token</label>
            <input type="password" value={jiraToken} onChange={e => setJiraToken(e.target.value)} placeholder="ATATT3..." />
          </div>
          <div className="form-group">
            <label>Project Keys (comma-separated)</label>
            <input value={projectKeys} onChange={e => setProjectKeys(e.target.value)} placeholder="DEV, SUPPORT, DOCS" />
          </div>
        </div>

        <div style={{ margin: '16px 0 8px', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Jira Email → Engineer Name Mapping
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {usernameMap.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={row.jira_email}
                onChange={e => updateRow(idx, 'jira_email', e.target.value)}
                placeholder="jira-email@company.com"
                style={inputStyle}
              />
              <span style={{ color: 'var(--muted)', fontSize: 13, flexShrink: 0 }}>→</span>
              <input
                value={row.engineer_name}
                onChange={e => updateRow(idx, 'engineer_name', e.target.value)}
                placeholder="Engineer Name"
                style={inputStyle}
              />
              <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 12, flexShrink: 0 }} onClick={() => removeRow(idx)}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={newRow.jira_email}
              onChange={e => setNewRow(p => ({ ...p, jira_email: e.target.value }))}
              placeholder="jira-email@company.com"
              style={inputStyle}
              onKeyDown={e => e.key === 'Enter' && addRow()}
            />
            <span style={{ color: 'var(--muted)', fontSize: 13, flexShrink: 0 }}>→</span>
            <input
              value={newRow.engineer_name}
              onChange={e => setNewRow(p => ({ ...p, engineer_name: e.target.value }))}
              placeholder="Engineer Name"
              style={inputStyle}
              onKeyDown={e => e.key === 'Enter' && addRow()}
            />
            <button className="btn btn-primary" style={{ padding: '3px 12px', fontSize: 12, flexShrink: 0 }} onClick={addRow}>+ Add</button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn"
              style={{ background: 'rgba(0,207,255,0.1)', color: 'var(--accent1)', border: '1px solid rgba(0,207,255,0.25)', padding: '6px 14px' }}
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? <span className="spinner" /> : '⟳ Sync Now'}
            </button>
            {syncResult && (
              <span style={{ fontSize: 12, color: syncResult.ok ? 'var(--success)' : 'var(--danger)' }}>
                {syncResult.ok ? '✓ ' : '✕ '}{syncResult.msg}
              </span>
            )}
          </div>

          {lastSync && lastSync.status !== 'never' && (
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot, display: 'inline-block', flexShrink: 0 }} />
              Last sync: {new Date(lastSync.timestamp).toLocaleString()} · {lastSync.records_updated} record(s)
              {lastSync.status === 'error' && (
                <span style={{ color: 'var(--danger)', marginLeft: 4 }}>— {lastSync.error}</span>
              )}
            </div>
          )}

          <button className="btn btn-primary" onClick={handleSave}>{saved ? '✓ Saved' : 'Save'}</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#e879f9', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 24, fontWeight: 600 }}>
        Slack
      </div>

      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Slack Bot Token</label>
            <input type="password" value={slackToken} onChange={e => setSlackToken(e.target.value)} placeholder="xoxb-..." />
          </div>
          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>Reports Channel ID</label>
            <input value={slackChannel} onChange={e => setSlackChannel(e.target.value)} placeholder="C08NK2SD5CK" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <button
            className="btn"
            style={{ background: 'rgba(74,21,75,0.2)', color: '#e879f9', border: '1px solid rgba(232,121,249,0.3)', padding: '6px 14px' }}
            onClick={handleSlackTest}
            disabled={slackTesting}
          >
            {slackTesting ? <span className="spinner" /> : '✓ Test Connection'}
          </button>
          <button
            className="btn"
            style={{ background: 'rgba(74,21,75,0.2)', color: '#e879f9', border: '1px solid rgba(232,121,249,0.3)', padding: '6px 14px' }}
            onClick={handleSlackSync}
            disabled={syncing}
          >
            {syncing ? <span className="spinner" /> : '⟳ Sync Reports Now'}
          </button>
          {slackTestResult && (
            <span style={{ fontSize: 12, color: slackTestResult.ok ? 'var(--success)' : 'var(--danger)' }}>
              {slackTestResult.ok ? '✓ ' : '✕ '}{slackTestResult.msg}
            </span>
          )}
          {syncResult && (
            <span style={{ fontSize: 12, color: syncResult.ok ? 'var(--success)' : 'var(--danger)' }}>
              {syncResult.ok ? '✓ ' : '✕ '}{syncResult.msg}
            </span>
          )}
        </div>
        {slackLastSync && slackLastSync.status !== 'never' && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            Last sync: {new Date(slackLastSync.timestamp).toLocaleString()} · {slackLastSync.records_updated} record(s)
            {slackLastSync.status === 'error' && <span style={{ color: 'var(--danger)', marginLeft: 6 }}>— {slackLastSync.error}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main admin page ───────────────────────────────────────────────────────────

export default function Admin() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('admin_pw') || '')
  const [authed, setAuthed] = useState(false)
  const [section, setSection] = useState('config')

  useEffect(() => {
    if (pw) {
      api.post(`/admin/verify?password=${encodeURIComponent(pw)}`, {})
        .then(() => setAuthed(true))
        .catch(() => { sessionStorage.removeItem('admin_pw'); setPw('') })
    }
  }, [])

  const handleLogin = (password) => {
    setPw(password)
    setAuthed(true)
  }

  const handleLogout = () => {
    sessionStorage.removeItem('admin_pw')
    setPw('')
    setAuthed(false)
  }

  if (!authed) return <Login onLogin={handleLogin} />

  const SECTIONS = [
    { key: 'config',        label: 'Configuration' },
    { key: 'team',          label: 'Team' },
    { key: 'metrics',       label: 'Metrics' },
    { key: 'rules',         label: 'Rules' },
    { key: 'integrations',  label: 'Integrations' },
    { key: 'reports',       label: 'Reports' },
    { key: 'security',      label: 'Security' },
  ]

  return (
    <div style={{ background: 'var(--base)', minHeight: '100vh' }}>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-logo"><span>⬡</span> Admin Panel</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/" className="topbar-admin-link">← Dashboard</Link>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="admin-page">
        <div className="tabs" style={{ marginTop: 16 }}>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`tab-btn${section === s.key ? ' active' : ''}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          {section === 'config'       && <ConfigSection pw={pw} />}
          {section === 'team'         && <TeamSection pw={pw} />}
          {section === 'metrics'      && <MetricsSection pw={pw} />}
          {section === 'rules'        && <RulesSection pw={pw} />}
          {section === 'integrations' && <IntegrationsSection pw={pw} />}
          {section === 'reports'      && <ReportsAdminSection pw={pw} />}
          {section === 'security'     && <SecuritySection pw={pw} onPasswordChange={setPw} />}
        </div>
      </div>
    </div>
  )
}
