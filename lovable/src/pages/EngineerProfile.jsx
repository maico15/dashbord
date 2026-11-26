import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'
import EngineerWeeklyBlock from '../components/EngineerWeeklyBlock'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function useCountUp(target, duration = 1400) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(0)
    if (!target) return
    let start = 0
    const step = target / (duration / 16)
    const id = setInterval(() => {
      start += step
      if (start >= target) { setCount(target); clearInterval(id) }
      else setCount(Math.round(start))
    }, 16)
    return () => clearInterval(id)
  }, [target])
  return count
}

const BADGE_INFO = {
  mvp:    { label: 'MVP',       cls: 'badge-mvp',    icon: '🥇' },
  fire:   { label: 'Streak',    cls: 'badge-fire',   icon: '🔥' },
  shield: { label: 'Shield',    cls: 'badge-shield', icon: '🛡' },
  scribe: { label: 'Scribe',    cls: 'badge-scribe', icon: '✍' },
}

const STREAM_LABEL = { dev: 'Development', support: 'Support', docs: 'Documentation' }
const STREAM_COLOR = { dev: 'var(--accent1)', support: 'var(--success)', docs: 'var(--warning)' }

const BD_LABELS = {
  pr_merged: 'PRs merged', ticket_closed: 'Tickets closed',
  fast_cycle: 'Fast cycle bonus', incident_resolved: 'Incidents resolved',
  fast_resolve: 'Fast resolve bonus', sla_breached: 'SLA breaches',
  doc_created: 'Docs created', doc_updated: 'Docs updated',
  no_docs_penalty: 'No-docs penalty',
}

// ── Mini chart tooltip ────────────────────────────────────────────────────────

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '7px 11px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ color: 'var(--accent1)', fontWeight: 700 }}>
        XP: {payload[0]?.value?.toLocaleString()}
      </div>
    </div>
  )
}

// ── Left column ───────────────────────────────────────────────────────────────

function ProfileCard({ profile }) {
  const animated = useCountUp(profile.total_score)
  const color = profile.avatar_color || '#00cfff'
  const initials = profile.name.split(' ').slice(0, 2).map(w => w[0]).join('')
  const streamColor = STREAM_COLOR[profile.stream] || 'var(--accent1)'

  const bdEntries = Object.entries(profile.breakdown || {})
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
  const maxBd = Math.max(...bdEntries.map(([, v]) => Math.abs(v)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Avatar + name */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: color, margin: '0 auto 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 800, color: '#080d1f',
          boxShadow: `0 0 0 4px ${color}33, 0 0 24px ${color}44`,
        }}>
          {initials}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{profile.name}</div>
        <div style={{
          marginTop: 6, display: 'inline-block',
          fontSize: 11, padding: '3px 10px', borderRadius: 20,
          background: `${streamColor}18`, color: streamColor,
          border: `1px solid ${streamColor}33`,
          fontWeight: 600, letterSpacing: '0.05em',
        }}>
          {STREAM_LABEL[profile.stream] || profile.stream}
        </div>
      </div>

      {/* Score */}
      <div className="card" style={{ textAlign: 'center', padding: '16px' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Total XP · 8 weeks
        </div>
        <div style={{
          fontSize: 40, fontWeight: 800,
          background: 'linear-gradient(135deg, var(--accent1), var(--accent2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {animated.toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {profile.current_week_score > 0
            ? `+${profile.current_week_score.toLocaleString()} this week`
            : 'No data for this week'}
        </div>
      </div>

      {/* Badges */}
      {profile.badges?.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Badges
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {profile.badges.map(b => {
              const info = BADGE_INFO[b]
              if (!info) return null
              return (
                <span key={b} className={`badge ${info.cls}`} style={{ fontSize: 12, padding: '4px 10px' }}>
                  {info.icon} {info.label}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Score breakdown bars */}
      {bdEntries.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Score breakdown
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {bdEntries.map(([k, v]) => (
              <div key={k}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: 'var(--muted)' }}>{BD_LABELS[k] || k}</span>
                  <span style={{ color: v < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                    {v > 0 ? '+' : ''}{v}
                  </span>
                </div>
                <div style={{ height: 4, background: 'var(--card2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(Math.abs(v) / maxBd) * 100}%`,
                    background: v < 0 ? 'var(--danger)' : streamColor,
                    borderRadius: 2, transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mini XP chart */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          XP last 8 weeks
        </div>
        <div style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={profile.weekly_chart || []} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
              <defs>
                <linearGradient id="prof-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={streamColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={streamColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: 'var(--muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Area
                type="monotone" dataKey="score"
                stroke={streamColor} strokeWidth={2}
                fill="url(#prof-grad)"
                dot={{ fill: streamColor, r: 2, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

// ── Week selector ─────────────────────────────────────────────────────────────

function WeekSelector({ week, year, onChange }) {
  const prev = () => {
    if (week <= 1) onChange(52, year - 1)
    else onChange(week - 1, year)
  }
  const next = () => {
    if (week >= 52) onChange(1, year + 1)
    else onChange(week + 1, year)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button onClick={prev} className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 16 }}>←</button>
      <span style={{ fontWeight: 600, fontSize: 15, minWidth: 110, textAlign: 'center' }}>
        Week {week} · {year}
      </span>
      <button onClick={next} className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 16 }}>→</button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EngineerProfile() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [profile,      setProfile]      = useState(null)
  const [profileError, setProfileError] = useState(null)

  const [week,          setWeek]          = useState(null)
  const [year,          setYear]          = useState(null)
  const [weekEngineer,  setWeekEngineer]  = useState(null)
  const [weekLoading,   setWeekLoading]   = useState(false)

  // Load profile
  useEffect(() => {
    api.get(`/engineers/${id}/profile`)
      .then(p => {
        setProfile(p)
        setWeek(p.current_week)
        setYear(p.current_year)
      })
      .catch(e => setProfileError(e.message))
  }, [id])

  // Load weekly report whenever week/year/id changes
  useEffect(() => {
    if (!week || !year) return
    setWeekLoading(true)
    setWeekEngineer(null)
    api.get(`/reports/weekly?week=${week}&year=${year}`)
      .then(d => {
        const found = (d.engineers || []).find(e => String(e.id) === String(id))
        setWeekEngineer(found || null)
      })
      .catch(() => setWeekEngineer(null))
      .finally(() => setWeekLoading(false))
  }, [week, year, id])

  if (profileError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ color: 'var(--danger)' }}>{profileError}</div>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
      </div>
    )
  }

  if (!profile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <LoadingSpinner size={120} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--base)' }}>
      {/* Header bar */}
      <div className="topbar">
        <div className="topbar-left">
          <button
            onClick={() => navigate('/')}
            className="btn btn-ghost"
            style={{ padding: '5px 12px', fontSize: 13 }}
          >
            ← Dashboard
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>Engineer profile</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Week {profile.current_week} · {profile.current_year}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: '32px 24px',
        display: 'grid', gridTemplateColumns: '300px 1fr', gap: 28,
      }}>
        {/* Left: profile card */}
        <div>
          <ProfileCard profile={profile} />
        </div>

        {/* Right: weekly block with week nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {week && year && (
            <WeekSelector
              week={week}
              year={year}
              onChange={(w, y) => { setWeek(w); setYear(y) }}
            />
          )}

          {weekLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <LoadingSpinner />
            </div>
          )}

          {!weekLoading && weekEngineer && (
            <EngineerWeeklyBlock engineer={weekEngineer} />
          )}

          {!weekLoading && !weekEngineer && week && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '48px 24px',
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 12, gap: 10,
            }}>
              <div style={{ fontSize: 32 }}>📋</div>
              <div style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 500 }}>No data for this week</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.7 }}>
                No tasks or GitHub activity recorded for week {week} · {year}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
