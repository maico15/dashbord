import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'
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

// ── Task list ─────────────────────────────────────────────────────────────────

const STREAM_PILL = { dev: 'tag-dev', support: 'tag-support', docs: 'tag-docs' }
const STREAM_SHORT = { dev: 'Dev', support: 'Support', docs: 'Docs' }

function TaskList({ title, items, stream, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: accent, marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ display: 'inline-block', width: 3, height: 14, background: accent, borderRadius: 2 }} />
        {title}
      </div>
      {items.length === 0
        ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>—</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((task, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 14px',
                background: 'var(--card2)', borderRadius: 8,
                border: '1px solid var(--border)',
              }}>
                <span style={{ color: accent, marginTop: 1, flexShrink: 0, fontSize: 12 }}>◆</span>
                <span style={{ fontSize: 14, lineHeight: 1.5, flex: 1 }}>{task}</span>
                <span className={`tag ${STREAM_PILL[stream] || 'tag-dev'}`} style={{ flexShrink: 0, marginTop: 1 }}>
                  {STREAM_SHORT[stream] || stream}
                </span>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}

// ── Right column ──────────────────────────────────────────────────────────────

function WeeklyTasksPanel({ engineerId, stream, initialWeek, initialYear }) {
  const [week, setWeek]   = useState(initialWeek)
  const [year, setYear]   = useState(initialYear)
  const [tasks, setTasks] = useState(null)
  const [loading, setLoading] = useState(false)

  const streamColor = STREAM_COLOR[stream] || 'var(--accent1)'

  const loadTasks = useCallback((w, y) => {
    setLoading(true)
    api.get(`/engineers/${engineerId}/tasks?week=${w}&year=${y}`)
      .then(setTasks)
      .catch(() => setTasks(null))
      .finally(() => setLoading(false))
  }, [engineerId])

  useEffect(() => { loadTasks(week, year) }, [week, year, loadTasks])

  const handleWeekChange = (w, y) => { setWeek(w); setYear(y) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <WeekSelector week={week} year={year} onChange={handleWeekChange} />
        {tasks && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Stream: <span className={`tag ${STREAM_PILL[tasks.stream]}`}>{STREAM_SHORT[tasks.stream]}</span>
          </span>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <LoadingSpinner />
        </div>
      )}

      {!loading && !tasks && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '48px 24px',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 12, gap: 10,
        }}>
          <div style={{ fontSize: 32 }}>📋</div>
          <div style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 500 }}>No data entered</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.7 }}>
            No tasks have been added for week {week} · {year}
          </div>
        </div>
      )}

      {!loading && tasks && (
        <>
          <div className="card" style={{ padding: '20px 24px' }}>
            <TaskList
              title="What was done"
              items={tasks.what_was_done || []}
              stream={tasks.stream}
              accent={streamColor}
            />
          </div>

          <div className="card" style={{ padding: '20px 24px' }}>
            <TaskList
              title="Next week plan"
              items={tasks.next_week || []}
              stream={tasks.stream}
              accent="var(--accent2)"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Commits timeline ──────────────────────────────────────────────────────────

function CommitsTimeline({ engineerId }) {
  const [commits, setCommits] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get(`/engineers/${engineerId}/commits`)
      .then(setCommits)
      .catch(e => setError(e.message))
  }, [engineerId])

  if (error) {
    return (
      <div className="card" style={{ padding: '14px 16px', fontSize: 13, color: 'var(--danger)' }}>
        Failed to load commits: {error}
      </div>
    )
  }

  if (commits === null) {
    return (
      <div className="card" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <LoadingSpinner />
      </div>
    )
  }

  // Group: dateKey → repo → [commit, ...]
  const groupedByDate = {}
  for (const c of commits) {
    const dateKey = (c.committed_at || '').slice(0, 10)
    if (!dateKey) continue
    if (!groupedByDate[dateKey]) groupedByDate[dateKey] = {}
    if (!groupedByDate[dateKey][c.repo]) groupedByDate[dateKey][c.repo] = []
    groupedByDate[dateKey][c.repo].push(c)
  }
  const dateKeys = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a))

  const formatDate = (s) => {
    const d = new Date(s + 'T12:00:00Z')
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }
  const firstLine = (msg) => (msg || '').split('\n')[0].trim()

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div style={{
          fontSize: 11, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Commits · last 8 weeks
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {commits.length} commit{commits.length === 1 ? '' : 's'}
        </div>
      </div>

      {dateKeys.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
          No commits recorded
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {dateKeys.map(date => {
            const repos = groupedByDate[date]
            const totalForDay = Object.values(repos).reduce((a, list) => a + list.length, 0)
            return (
              <div key={date} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                {/* Timeline dot + line */}
                <div style={{
                  flexShrink: 0, width: 10, paddingTop: 4,
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: 'var(--accent1)',
                    boxShadow: '0 0 0 3px rgba(0,207,255,0.15)',
                  }} />
                  <div style={{
                    width: 2, flex: 1, background: 'var(--border)', marginTop: 4,
                  }} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Date header */}
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {formatDate(date)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {totalForDay} commit{totalForDay === 1 ? '' : 's'}
                    </span>
                  </div>

                  {/* Repo groups */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Object.entries(repos).map(([repo, list]) => (
                      <div key={repo}>
                        <div style={{
                          fontSize: 11, fontWeight: 600, color: 'var(--accent2)',
                          marginBottom: 5, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        }}>
                          {repo}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {list.map(c => (
                            <div key={c.sha} style={{
                              display: 'flex', alignItems: 'flex-start', gap: 10,
                              padding: '6px 10px',
                              background: 'var(--card2)', borderRadius: 6,
                              border: '1px solid var(--border)',
                              fontSize: 12,
                            }}>
                              <code style={{
                                color: 'var(--muted)', fontSize: 11,
                                flexShrink: 0, paddingTop: 1,
                              }}>
                                {(c.sha || '').slice(0, 7)}
                              </code>
                              <span style={{
                                flex: 1, lineHeight: 1.5, color: 'var(--text)',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {firstLine(c.message) || '(no message)'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── PR activity tab ───────────────────────────────────────────────────────────

function PRActivityTab({ engineerId }) {
  const [prs, setPrs]     = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get(`/engineers/${engineerId}/prs`)
      .then(setPrs)
      .catch(e => setError(e.message))
  }, [engineerId])

  if (error) {
    return (
      <div className="card" style={{ padding: '14px 16px', fontSize: 13, color: 'var(--danger)' }}>
        Failed to load activity: {error}
      </div>
    )
  }
  if (prs === null) {
    return (
      <div className="card" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <LoadingSpinner />
      </div>
    )
  }

  const grouped = {}
  for (const pr of prs) {
    const key = `${pr.year}-${String(pr.week).padStart(2, '0')}`
    if (!grouped[key]) grouped[key] = { week: pr.week, year: pr.year, prs: [] }
    grouped[key].prs.push(pr)
  }
  const weekKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  if (weekKeys.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '48px 24px',
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, gap: 10,
      }}>
        <div style={{ fontSize: 32 }}>🔀</div>
        <div style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 500 }}>No PR activity</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.7 }}>
          PRs will appear here after the next GitHub sync
        </div>
      </div>
    )
  }

  const shortRepo = (repo) => (repo.includes('/') ? repo.split('/')[1] : repo)
  const firstLine = (s) => (s || '').split('\n')[0].trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {weekKeys.map(key => {
        const { week, year, prs: weekPrs } = grouped[key]
        return (
          <div key={key} className="card" style={{ padding: '18px 20px' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14,
            }}>
              <span>Week {week} · {year}</span>
              <span>{weekPrs.length} PR{weekPrs.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {weekPrs.map((pr, i) => (
                <div key={pr.pr_number ?? i} style={{
                  background: 'var(--card2)', borderRadius: 8,
                  border: '1px solid var(--border)', overflow: 'hidden',
                }}>
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ color: 'var(--accent1)', flexShrink: 0, fontSize: 14, marginTop: 1 }}>⊕</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, marginBottom: 5 }}>
                          {pr.title || `PR #${pr.pr_number}`}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <code style={{
                            fontSize: 11, color: 'var(--accent2)',
                            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          }}>
                            {shortRepo(pr.repo)}
                          </code>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>#{pr.pr_number}</span>
                          <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>
                            +{pr.additions}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>
                            −{pr.deletions}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {pr.changed_files} file{pr.changed_files !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {pr.commits?.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px 12px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                        {pr.commits.length} commit{pr.commits.length !== 1 ? 's' : ''}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {pr.commits.map((commit, ci) => (
                          <div key={commit.sha || ci} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12,
                          }}>
                            <code style={{
                              color: 'var(--muted)', fontSize: 11, flexShrink: 0,
                              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                            }}>
                              {commit.sha}
                            </code>
                            <span style={{ color: 'var(--text)', lineHeight: 1.4 }}>
                              {firstLine(commit.message) || '(no message)'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EngineerProfile() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const [profile,  setProfile]  = useState(null)
  const [error,    setError]    = useState(null)
  const [rightTab, setRightTab] = useState('tasks')

  useEffect(() => {
    api.get(`/engineers/${id}/profile`)
      .then(setProfile)
      .catch((e) => setError(e.message))
  }, [id])

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ color: 'var(--danger)' }}>{error}</div>
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

        {/* Right: tabbed panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['tasks', 'Weekly Tasks'], ['activity', 'Activity'], ['commits', 'Commits']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={`btn ${rightTab === key ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 13 }}
              >
                {label}
              </button>
            ))}
          </div>
          {rightTab === 'tasks' && (
            <WeeklyTasksPanel
              engineerId={id}
              stream={profile.stream}
              initialWeek={profile.current_week}
              initialYear={profile.current_year}
            />
          )}
          {rightTab === 'activity' && <PRActivityTab engineerId={id} />}
          {rightTab === 'commits' && <CommitsTimeline engineerId={id} />}
        </div>
      </div>
    </div>
  )
}
