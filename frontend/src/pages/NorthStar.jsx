import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export default function NorthStar() {
  const [meta, setMeta] = useState({})
  const [objectives, setObjectives] = useState([])
  const [editing, setEditing] = useState(null) // key of the field being edited
  const pw = sessionStorage.getItem('admin_pw') || ''

  const load = () =>
    api.get('/roadmap/strategy').then(d => { setMeta(d.meta || {}); setObjectives(d.objectives || []) })
  useEffect(() => { load() }, [])

  const saveMeta = (key, value) => {
    setMeta(prev => ({ ...prev, [key]: value }))
    api.put('/roadmap/strategy', { [key]: value }, pw)
    setEditing(null)
  }

  // Editable field: click → textarea, blur → save
  const Editable = ({ fieldKey, value, style, placeholder }) => {
    if (editing === fieldKey) {
      return (
        <textarea autoFocus defaultValue={value}
          onBlur={(e) => saveMeta(fieldKey, e.target.value)}
          style={{
            ...style, width: '100%', background: 'var(--card)', border: '1px solid var(--accent2)',
            borderRadius: 8, padding: 8, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit',
          }} />
      )
    }
    return (
      <div onClick={() => setEditing(fieldKey)} style={{ ...style, cursor: 'text' }}
        title="Click to edit">
        {value || <span style={{ color: 'var(--muted)' }}>{placeholder}</span>}
      </div>
    )
  }

  const TRAJ = [
    ['traj_q3', 'Q3 2026 · NOW', true],
    ['traj_q4', 'Q4 2026', false],
    ['traj_q1', 'Q1 2027', false],
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--base)' }}>
      <div className="topbar">
        <div className="topbar-left"><div className="topbar-logo"><span>◆</span> North Star</div></div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/roadmap" className="topbar-admin-link">Roadmap →</Link>
          <Link to="/" className="topbar-admin-link">← Dashboard</Link>
        </div>
      </div>

      <div className="page" style={{ paddingTop: 32, maxWidth: 1000 }}>

        {/* NORTH STAR */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(51,51,204,0.16), rgba(6,182,212,0.10))',
          border: '1px solid var(--border)', borderRadius: 18, padding: '36px 40px', marginBottom: 36,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--accent2)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            ◆ North Star
          </div>
          <Editable fieldKey="north_star"
            value={meta.north_star}
            placeholder="Set the company's North Star goal…"
            style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-.01em' }} />
          <div style={{ marginTop: 14 }}>
            <Editable fieldKey="north_star_sub"
              value={meta.north_star_sub}
              placeholder="Add a supporting sentence…"
              style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.5 }} />
          </div>
        </div>

        {/* TRAJECTORY */}
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: '.07em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)',
        }}>
          Trajectory — where each quarter takes us
        </div>
        <div style={{ display: 'flex', gap: 14, marginBottom: 40, alignItems: 'stretch' }}>
          {TRAJ.map(([key, label, now], i) => (
            <div key={key} style={{ flex: 1, position: 'relative', display: 'flex' }}>
              <div style={{
                flex: 1, background: 'var(--card)', borderRadius: 12,
                border: now ? '1px solid var(--accent2)' : '1px solid var(--border)',
                boxShadow: now ? '0 0 0 1px var(--accent2)' : 'none', padding: '18px 20px',
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent2)', marginBottom: 8 }}>{label}</div>
                <Editable fieldKey={key} value={meta[key]} placeholder="Describe this quarter's milestone…"
                  style={{ fontSize: 13.5, lineHeight: 1.45 }} />
              </div>
              {i < TRAJ.length - 1 && (
                <div style={{
                  position: 'absolute', right: -11, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--muted)', fontSize: 18, zIndex: 2,
                }}>→</div>
              )}
            </div>
          ))}
        </div>

        {/* OBJECTIVES */}
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: '.07em', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)',
        }}>
          Objectives this quarter
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {objectives.map(obj => (
            <div key={obj.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, background: 'var(--card)',
              border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px',
            }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 600 }}>{obj.title}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 'auto', textAlign: 'right' }}>{obj.metric}</span>
            </div>
          ))}
          {objectives.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
              No objectives yet. Seed them via the roadmap strategy script.
            </div>
          )}
        </div>

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <Link to="/roadmap" style={{ fontSize: 13, color: 'var(--accent2)', textDecoration: 'none' }}>
            See the work behind these goals → Roadmap
          </Link>
        </div>

      </div>
    </div>
  )
}
