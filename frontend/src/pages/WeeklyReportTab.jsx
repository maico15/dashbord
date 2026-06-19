import { useState, useEffect } from 'react'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'
import EngineerWeeklyBlock from '../components/EngineerWeeklyBlock'

// ── Date helpers ───────────────────────────────────────────────────────────────

function getWeekRange(week, year) {
  const jan4 = new Date(year, 0, 4)
  const dow = jan4.getDay() || 7
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - (dow - 1))
  const mon = new Date(week1Mon)
  mon.setDate(week1Mon.getDate() + (week - 1) * 7)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  return { mon, fri }
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10)
}

function weekDateRange(week, year) {
  const { mon, fri } = getWeekRange(week, year)
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(mon)} – ${fmt(fri)}`
}

// ── Engineer row ───────────────────────────────────────────────────────────────

function EngineerRow({ engineer, score, onScoreChange, week, year }) {
  const initials = engineer.name.split(' ').slice(0, 2).map(w => w[0]).join('')
  const [localScore, setLocalScore] = useState(score || '')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)

  useEffect(() => {
    setLocalScore(score || '')
  }, [score, week, year])

  const handleSave = async (val) => {
    const num = parseInt(val)
    if (!val || isNaN(num) || num < 1 || num > 10) return
    setSaving(true)
    try {
      await api.post('/performance-scores?password=admin123', {
        engineer_id: engineer.id,
        week,
        year,
        score: num,
      })
      onScoreChange(num)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      console.error('Score save error:', e)
    } finally {
      setSaving(false)
    }
  }

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
        <div style={{ flex: 1 }}>
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

        {/* Score input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Score</span>
          <input
            type="number"
            min="1"
            max="10"
            value={localScore}
            onChange={e => setLocalScore(e.target.value)}
            onBlur={e => handleSave(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave(e.target.value)}
            placeholder="—"
            style={{
              width: 52,
              textAlign: 'center',
              fontSize: 15,
              fontWeight: 600,
              padding: '4px 6px',
              borderRadius: 8,
              border: `1.5px solid ${localScore ? engineer.color : 'var(--border)'}`,
              background: localScore ? `${engineer.color}15` : 'var(--card)',
              color: localScore ? engineer.color : 'var(--muted)',
              outline: 'none',
            }}
          />
          {saving && <span style={{ fontSize: 11, color: 'var(--muted)' }}>...</span>}
          {saved  && <span style={{ fontSize: 11, color: 'var(--success)' }}>✓</span>}
        </div>
      </div>
      <div style={{ paddingLeft: 58 }}>
        <EngineerWeeklyBlock engineer={engineer} />
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WeeklyReportTab() {
  const [week, setWeek]         = useState(null)
  const [year, setYear]         = useState(null)
  const [report, setReport]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState(null)
  const [genDone, setGenDone]       = useState(false)
  const [scores, setScores]         = useState({})

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
    setGenDone(false)
    api.get(`/reports/weekly?week=${week}&year=${year}`)
      .then(d => { setReport(d); setLoading(false) })
      .catch(e => { console.error(e); setError('Failed to load weekly report'); setLoading(false) })
  }, [week, year])

  useEffect(() => {
    if (!week || !year) return
    api.get(`/performance-scores?week=${week}&year=${year}`)
      .then(setScores)
      .catch(() => {})
  }, [week, year])

  const navigate = (delta) => {
    let w = (week ?? 1) + delta
    let y = year ?? new Date().getFullYear()
    if (w < 1)  { w = 52; y-- }
    if (w > 52) { w = 1;  y++ }
    setWeek(w)
    setYear(y)
  }

  const handleGenerateSummary = async () => {
    if (!report || !week || !year) return
    setGenerating(true)
    setGenError(null)
    setGenDone(false)

    const pw = 'admin123'

    try {
      const { mon, fri } = getWeekRange(week, year)
      const fromDate = fmtDate(mon)
      const toDate   = fmtDate(fri)

      await Promise.all(report.engineers.map(async (eng) => {
        const dailyReports = await api.get(
          `/reports/engineer/${eng.id}?from_date=${fromDate}&to_date=${toDate}`
        )
        if (!dailyReports || dailyReports.length === 0) return

        const allCompleted  = dailyReports.flatMap(r => r.completed      || [])
        const allInvisible  = dailyReports.flatMap(r => r.invisible_work || [])
        const allNext       = dailyReports.flatMap(r => r.next_tasks     || [])
        const allRisks      = dailyReports.flatMap(r => r.delayed_risks  || [])

        if (allCompleted.length === 0 && allInvisible.length === 0) return

        const res = await api.post(
          '/ai/weekly-summary',
          {
            engineer_name:  eng.name,
            completed:      allCompleted,
            invisible_work: allInvisible,
            next_tasks:     allNext,
            delayed_risks:  allRisks,
            week_label:     `${fromDate} to ${toDate}`,
          },
          pw
        )
        const summary = res.summary
        if (!summary) return

        await api.post('/weekly-tasks', { engineer_id: eng.id, week, year, tasks: summary }, pw)
      }))

      const updated = await api.get(`/reports/weekly?week=${week}&year=${year}`)
      setReport(updated)
      setGenDone(true)
    } catch (e) {
      console.error(e)
      setGenError(e.message || 'Failed to generate summary')
    } finally {
      setGenerating(false)
    }
  }

  const dateRange = week && year ? weekDateRange(week, year) : ''

  return (
    <div>
      {/* Navigation + AI Summary button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, marginBottom: 8 }}>
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

        <button
          className="btn btn-primary"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px' }}
          onClick={handleGenerateSummary}
          disabled={generating || !report}
        >
          {generating ? <span className="spinner" style={{ animation: 'spin 0.7s linear infinite' }} /> : '✨'}
          {generating ? 'Generating…' : 'AI Summary'}
        </button>
      </div>

      {/* Status messages */}
      {genDone && !genError && (
        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>
          ✓ Summary generated — scroll down to see weekly tasks
        </div>
      )}
      {genError && (
        <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>
          ✕ {genError}
        </div>
      )}

      <div style={{ marginBottom: 20 }} />

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
          {report.engineers.map(eng => (
            <EngineerRow
              key={eng.id}
              engineer={eng}
              score={scores[eng.id] || ''}
              onScoreChange={(val) => setScores(prev => ({ ...prev, [eng.id]: val }))}
              week={week}
              year={year}
            />
          ))}
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
