import { useState, useEffect } from 'react'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'

function weekDateRange(week, year) {
  const jan4 = new Date(year, 0, 4)
  const dow = jan4.getDay() || 7
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - (dow - 1))
  const mon = new Date(week1Mon)
  mon.setDate(week1Mon.getDate() + (week - 1) * 7)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(mon)} – ${fmt(fri)}`
}

function CommitRow({ commit }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
      <code style={{
        color: 'var(--muted)', fontSize: 11, flexShrink: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}>
        {commit.sha}
      </code>
      <span style={{ color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>
        {(commit.message || '').split('\n')[0] || '(no message)'}
      </span>
      {commit.time && (
        <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>{commit.time}</span>
      )}
    </div>
  )
}

function PRRow({ pr }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{
      background: 'var(--card2)', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 8,
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
      >
        <span style={{ color: 'var(--accent1)', fontSize: 13, flexShrink: 0, marginTop: 1 }}>⊕</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)' }}>#{pr.pr_number}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{pr.title || '(untitled)'}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
            {pr.lines_added > 0 && (
              <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>+{pr.lines_added}</span>
            )}
            {pr.lines_deleted > 0 && (
              <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>−{pr.lines_deleted}</span>
            )}
            {pr.changed_files > 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pr.changed_files} files</span>
            )}
            {pr.merged_at && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pr.merged_at}</span>
            )}
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
          {pr.commits.length} commit{pr.commits.length !== 1 ? 's' : ''} {open ? '▲' : '▼'}
        </span>
      </div>
      {open && pr.commits.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px 10px' }}>
          {pr.commits.map((c, i) => <CommitRow key={c.sha || i} commit={c} />)}
        </div>
      )}
    </div>
  )
}

function ProjectSection({ project }) {
  const prs = project.activity.filter(a => a.type === 'pr')
  const looseCommits = project.activity.filter(a => a.type === 'commit')

  const dayGroups = {}
  for (const c of looseCommits) {
    const k = c.date || 'unknown'
    if (!dayGroups[k]) dayGroups[k] = []
    dayGroups[k].push(c)
  }
  const dayKeys = Object.keys(dayGroups).sort((a, b) => b.localeCompare(a))

  const displayName = project.display_name || project.repo

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{displayName}</span>
          {project.display_name && project.display_name !== project.repo && (
            <code style={{
              fontSize: 11, color: 'var(--muted)',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            }}>
              {project.repo}
            </code>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          {project.commits > 0 && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(0,207,255,0.1)', color: 'var(--accent1)',
              border: '1px solid rgba(0,207,255,0.2)',
            }}>
              {project.commits} commit{project.commits !== 1 ? 's' : ''}
            </span>
          )}
          {project.prs > 0 && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(123,97,255,0.1)', color: 'var(--accent2)',
              border: '1px solid rgba(123,97,255,0.2)',
            }}>
              {project.prs} PR{project.prs !== 1 ? 's' : ''}
            </span>
          )}
          {(project.lines_added > 0 || project.lines_deleted > 0) && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ color: 'var(--success)' }}>+{project.lines_added}</span>
              {' / '}
              <span style={{ color: 'var(--danger)' }}>−{project.lines_deleted}</span>
            </span>
          )}
        </div>
      </div>

      {prs.map((pr, i) => <PRRow key={pr.pr_number ?? i} pr={pr} />)}

      {dayKeys.map(date => (
        <div key={date} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{date}</div>
          {dayGroups[date].map((c, i) => <CommitRow key={c.sha || i} commit={c} />)}
        </div>
      ))}
    </div>
  )
}

function EngineerCard({ engineer }) {
  const initials = engineer.name.split(' ').slice(0, 2).map(w => w[0]).join('')
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: engineer.color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#080d1f',
          boxShadow: `0 0 0 3px ${engineer.color}33`,
        }}>
          {initials}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{engineer.name}</span>
            {engineer.position && (
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
                {engineer.position}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
            {engineer.total_commits > 0 && (
              <span style={{
                fontSize: 12, padding: '2px 10px', borderRadius: 10,
                background: 'rgba(0,207,255,0.1)', color: 'var(--accent1)',
              }}>
                {engineer.total_commits} commits
              </span>
            )}
            {engineer.total_prs > 0 && (
              <span style={{
                fontSize: 12, padding: '2px 10px', borderRadius: 10,
                background: 'rgba(123,97,255,0.1)', color: 'var(--accent2)',
              }}>
                {engineer.total_prs} PRs
              </span>
            )}
            {(engineer.lines_added > 0 || engineer.lines_deleted > 0) && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                <span style={{ color: 'var(--success)' }}>+{engineer.lines_added}</span>
                {' '}
                <span style={{ color: 'var(--danger)' }}>−{engineer.lines_deleted}</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ paddingLeft: 58 }}>
        {engineer.projects.map((p, i) => (
          <ProjectSection key={p.repo || i} project={p} />
        ))}
      </div>
    </div>
  )
}

export default function WeeklyReportTab() {
  const [week, setWeek]       = useState(null)
  const [year, setYear]       = useState(null)
  const [report, setReport]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    api.get('/overview').then(d => {
      setWeek(d.current_week || calcCurrentWeek())
      setYear(d.current_year || new Date().getFullYear())
    }).catch(() => {
      setWeek(calcCurrentWeek())
      setYear(new Date().getFullYear())
    })
  }, [])

  useEffect(() => {
    if (!week || !year) return
    setLoading(true)
    setError(null)
    setReport(null)
    api.get(`/reports/weekly?week=${week}&year=${year}`)
      .then(d => { setReport(d); setLoading(false) })
      .catch(e => { console.error(e); setError('Failed to load weekly report'); setLoading(false) })
  }, [week, year])

  const navigate = (delta) => {
    let w = (week ?? 1) + delta
    let y = year ?? new Date().getFullYear()
    if (w < 1)  { w = 52; y-- }
    if (w > 52) { w = 1;  y++ }
    setWeek(w)
    setYear(y)
  }

  const dateRange = week && year ? weekDateRange(week, year) : ''

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ padding: '5px 14px' }}>←</button>
        <div style={{ textAlign: 'center', minWidth: 180 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Week {week ?? '…'}</div>
          {dateRange && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {dateRange}, {year}
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => navigate(+1)} style={{ padding: '5px 14px' }}>→</button>
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <LoadingSpinner />
        </div>
      )}

      {!loading && error && (
        <div className="card" style={{ padding: '20px 24px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setError(null); setLoading(true); api.get(`/reports/weekly?week=${week}&year=${year}`).then(d => { setReport(d); setLoading(false) }).catch(e => { setError('Failed to load weekly report'); setLoading(false) }) }}>↺ Retry</button>
        </div>
      )}

      {!loading && !error && (!report || report.engineers.length === 0) && (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, color: 'var(--muted)' }}>No activity for week {week}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, opacity: 0.7 }}>
            Commits and PRs appear here after the next GitHub sync
          </div>
        </div>
      )}

      {!loading && report && report.engineers.length > 0 && (
        <div>
          {report.engineers.map(eng => <EngineerCard key={eng.id} engineer={eng} />)}
        </div>
      )}
    </div>
  )
}

function calcCurrentWeek() {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  return Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
}
