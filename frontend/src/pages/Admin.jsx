import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

const STREAMS = ['dev', 'support', 'docs']
const STREAM_LABELS = { dev: 'Разработка', support: 'Суппорт', docs: 'Документация' }

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
      setError('Неверный пароль')
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
            placeholder="Пароль"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Войти'}
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
      <h2>Конфигурация</h2>
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
            {saved ? '✓ Сохранено' : 'Сохранить'}
          </button>
        </div>
      </div>
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
  const [stream, setStream]   = useState(member.stream)
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
          <label>Неделя</label>
          <input type="number" min={1} max={53} value={week} onChange={(e) => setWeek(+e.target.value || 1)} />
        </div>
        <div className="form-group" style={{ maxWidth: 100 }}>
          <label>Год</label>
          <input type="number" value={year} onChange={(e) => setYear(+e.target.value || 2025)} />
        </div>
        <div className="form-group" style={{ maxWidth: 140 }}>
          <label>Поток</label>
          <select value={stream} onChange={(e) => setStream(e.target.value)}>
            {STREAMS.map(s => <option key={s} value={s}>{STREAM_LABELS[s]}</option>)}
          </select>
        </div>
        <button className="btn btn-ghost" style={{ padding: '5px 10px', marginBottom: 2 }} onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--accent1)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5, fontWeight: 600 }}>
            ЧТО СДЕЛАНО
          </div>
          <textarea
            rows={4} style={inputStyle} placeholder={"Одна задача — одна строка\nФикс бага в авторизации\nCode review #234"}
            value={whatDone} onChange={(e) => setWhatDone(e.target.value)}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--accent2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5, fontWeight: 600 }}>
            ПЛАН НА СЛЕДУЮЩУЮ НЕДЕЛЮ
          </div>
          <textarea
            rows={4} style={inputStyle} placeholder={"Одна задача — одна строка\nРефакторинг модуля X\nНаписать тесты"}
            value={plan} onChange={(e) => setPlan(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : saved ? '✓ Сохранено' : 'Сохранить'}
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
  const [newMember, setNewMember] = useState({ name: '', stream: 'dev', avatar_color: '#00cfff' })

  const load = () => api.get('/team').then(setMembers)
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!newMember.name.trim()) return
    await api.post('/team', newMember, pw)
    setNewMember({ name: '', stream: 'dev', avatar_color: '#00cfff' })
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Удалить участника?')) return
    await api.del(`/team/${id}`, pw)
    if (expandedId === id) setExpandedId(null)
    load()
  }

  const handleSaveEdit = async () => {
    await api.put(`/team/${editing.id}`, {
      name: editing.name, stream: editing.stream, avatar_color: editing.avatar_color,
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
      <h2>Участники команды</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {members.map((m) => (
          <div key={m.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Member row */}
            {editing?.id === m.id ? (
              <div style={{ display: 'flex', gap: 8, padding: '10px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  style={{ flex: 1, minWidth: 140, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13 }} />
                <select value={editing.stream} onChange={(e) => setEditing({ ...editing, stream: e.target.value })}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13 }}>
                  {STREAMS.map(s => <option key={s} value={s}>{STREAM_LABELS[s]}</option>)}
                </select>
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
                <span className={`tag tag-${m.stream}`}>{STREAM_LABELS[m.stream]}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
                  {expandedId === m.id ? '▲ задачи' : '▼ задачи'}
                </span>
                <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); setEditing({ ...m }); setExpandedId(null) }}>✏</button>
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
            placeholder="Имя нового участника" value={newMember.name}
            onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
            style={{ flex: 1, minWidth: 140, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13 }}
          />
          <select value={newMember.stream} onChange={(e) => setNewMember({ ...newMember, stream: e.target.value })}
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 8px', fontSize: 13 }}>
            {STREAMS.map(s => <option key={s} value={s}>{STREAM_LABELS[s]}</option>)}
          </select>
          <input type="color" value={newMember.avatar_color} onChange={(e) => setNewMember({ ...newMember, avatar_color: e.target.value })} />
          <button className="btn btn-primary" style={{ padding: '5px 14px' }} onClick={handleAdd}>+ Добавить</button>
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
      <h2>Метрики по неделям</h2>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <div className="form-group" style={{ maxWidth: 180 }}>
          <label>Поток</label>
          <select value={stream} onChange={(e) => setStream(e.target.value)}>
            {STREAMS.map((s) => <option key={s} value={s}>{STREAM_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ maxWidth: 120 }}>
          <label>Неделя</label>
          <input type="number" min={1} max={53} value={week} onChange={(e) => setWeek(parseInt(e.target.value) || 1)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: 16 }}>Нет участников в этом потоке</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Участник</th>
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
      <h2>Правила начисления очков</h2>
      {STREAMS.map((s) => (
        <div key={s} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {STREAM_LABELS[s]}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Правило</th>
                  <th style={{ width: 120 }}>Очки</th>
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
    { key: 'config', label: 'Конфигурация' },
    { key: 'team', label: 'Команда' },
    { key: 'metrics', label: 'Метрики' },
    { key: 'rules', label: 'Правила' },
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
            Выйти
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
          {section === 'config' && <ConfigSection pw={pw} />}
          {section === 'team' && <TeamSection pw={pw} />}
          {section === 'metrics' && <MetricsSection pw={pw} />}
          {section === 'rules' && <RulesSection pw={pw} />}
        </div>
      </div>
    </div>
  )
}
