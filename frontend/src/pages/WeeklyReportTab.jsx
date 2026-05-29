import { useState, useEffect } from 'react'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'
import EngineerWeeklyBlock from '../components/EngineerWeeklyBlock'

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

function EngineerRow({ engineer }) {
  const initials = engineer.name.split(' ').slice(0, 2).map(w => w[0]).join('')
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
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
        <EngineerWeeklyBlock engineer={engineer} />
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, marginBottom: 28 }}>
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
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13 }}
            onClick={() => {
              setError(null)
              setLoading(true)
              api.get(`/reports/weekly?week=${week}&year=${year}`)
                .then(d => { setReport(d); setLoading(false) })
                .catch(() => { setError('Failed to load weekly report'); setLoading(false) })
            }}
          >
            ↺ Retry
          </button>
        </div>
      )}

      {!loading && !error && report && (
        <div>
          {report.engineers.map(eng => <EngineerRow key={eng.id} engineer={eng} />)}
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
