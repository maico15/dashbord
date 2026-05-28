import { useState, useEffect } from 'react'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import MetricCard from '../components/MetricCard'
import BottleneckBars from '../components/BottleneckBars'
import XPChart from '../components/XPChart'
import Leaderboard from '../components/Leaderboard'
import AIUsageTab from './AIUsageTab'
import WeeklyReportTab from './WeeklyReportTab'
import LoadingSpinner from '../components/LoadingSpinner'

const TABS = [
  { key: 'dev',    label: 'Development' },
  // { key: 'support', label: 'Support' },
  // { key: 'docs', label: 'Documentation' },
  { key: 'ai',     label: '⬡ AI Usage' },
  { key: 'report', label: '📋 Weekly Report' },
]

function calcCurrentWeek() {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  return Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
}

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

function DevTab() {
  const [week, setWeek] = useState(null)
  const [year, setYear] = useState(null)
  const [data, setData] = useState(null)

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
    setData(null)
    api.get(`/metrics/dev?week=${week}&year=${year}`).then(setData).catch(console.error)
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

  if (!data) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><LoadingSpinner /></div>

  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ padding: '5px 14px' }}>←</button>
        <div style={{ textAlign: 'center', minWidth: 200 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Week {week ?? '…'}</div>
          {dateRange && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{dateRange}, {year}</div>}
        </div>
        <button className="btn btn-ghost" onClick={() => navigate(+1)} style={{ padding: '5px 14px' }}>→</button>
      </div>

      <div className="metric-grid">
        <MetricCard label="PRs merged" value={totals.prs_merged} sub={`Week ${week}`} accent="accent1"
          tooltip="Pull requests merged this week. Each PR earns XP based on the points configured in Admin → Rules." />
        <MetricCard label="Commits" value={totals.commits_count} sub={`Week ${week}`} accent="accent2"
          tooltip="Commits pushed this week across all tracked repositories." />
        <MetricCard
          label="Avg PR size"
          value={totals.avg_pr_size > 0 ? `+${totals.avg_pr_size} lines avg` : '—'}
          sub="additions + deletions"
          accent={totals.avg_pr_size < 400 ? 'success' : 'warning'}
          tooltip={"< 100 lines — excellent, easy to review\n100–300 lines — good, normal working size\n300–600 lines — acceptable, harder to review\n600+ lines — too large, consider splitting tasks\n\nNote: auto-generated code (e.g. Lovable) may inflate this metric."}
        />
      </div>

      <XPChart data={weekly_chart} color="#00cfff" name="XP" title="Weekly XP · Development" />

      <div className="two-col" style={{ marginTop: 20 }}>
        <BottleneckBars
          title="PRs merged per engineer"
          rows={bottlenecks.map((b) => ({ name: b.name, value: b.prs_merged }))}
          color="var(--accent1)"
        />
        <BottleneckBars
          title="Commits per engineer"
          rows={bottlenecks.map((b) => ({ name: b.name, value: b.commits_count }))}
          color="var(--accent2)"
        />
      </div>
    </>
  )
}

function SupportTab({ data }) {
  if (!data) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><LoadingSpinner /></div>
  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="Incidents opened" value={totals.incidents_opened} sub="this week" accent="warning"
          tooltip="New support incidents reported this week. Tracked per engineer in the support stream." />
        <MetricCard label="Incidents resolved" value={totals.incidents_resolved} sub="this week" accent="success"
          tooltip="Incidents closed or resolved this week. Each resolved incident earns XP per the Rules table." />
        <MetricCard
          label="SLA %"
          value={`${totals.sla_percentage}%`}
          sub={`${totals.sla_breached} breaches`}
          accent={totals.sla_percentage >= 90 ? 'success' : 'danger'}
          tooltip="Percentage of incidents resolved within the SLA time window. Target is 90% or above. Breaches reduce XP."
        />
      </div>

      <XPChart data={weekly_chart} color="#00ff9d" name="XP" title="Weekly XP · Support" />

      <div className="two-col" style={{ marginTop: 20 }}>
        <BottleneckBars
          title="Incidents resolved per engineer"
          rows={bottlenecks.map((b) => ({ name: b.name, value: b.incidents_resolved }))}
          color="var(--success)"
        />
        <BottleneckBars
          title="Avg resolution time per engineer"
          rows={bottlenecks.map((b) => ({ name: b.name, value: b.avg_resolution_hours, unit: 'h' }))}
          color="var(--accent1)"
        />
      </div>
    </>
  )
}

function DocsTab({ data }) {
  if (!data) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}><LoadingSpinner /></div>
  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="Docs created" value={totals.docs_created} sub="this week" accent="warning"
          tooltip="New documentation pages written this week. Each doc created earns XP per the Rules table." />
        <MetricCard label="Docs updated" value={totals.docs_updated} sub="this week" accent="accent2"
          tooltip="Existing documentation pages revised or improved this week. Keeps docs fresh and accurate." />
        <MetricCard
          label="Coverage"
          value={`${totals.coverage_percentage}%`}
          sub={`${totals.projects_covered} / ${totals.projects_total} projects`}
          accent={totals.coverage_percentage >= 80 ? 'success' : 'warning'}
          tooltip="Percentage of active projects that have at least one documentation page. Target is 80%+."
        />
      </div>

      <XPChart data={weekly_chart} color="#ffd700" name="XP" title="Weekly XP · Documentation" />

      <div className="two-col" style={{ marginTop: 20 }}>
        <BottleneckBars
          title="Docs created per engineer"
          rows={bottlenecks.map((b) => ({ name: b.name, value: b.docs_created }))}
          color="var(--warning)"
        />
        <BottleneckBars
          title="Docs updated per engineer"
          rows={bottlenecks.map((b) => ({ name: b.name, value: b.docs_updated }))}
          color="var(--accent2)"
        />
      </div>
    </>
  )
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dev')
  const [overview, setOverview] = useState(null)
  const [leaderboard, setLeaderboard] = useState(null)
  const [tabData, setTabData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.get('/overview'), api.get('/leaderboard')])
      .then(([ov, lb]) => {
        setOverview(ov)
        setLeaderboard(lb)
        setLoading(false)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    // dev, ai, and report tabs manage their own data
    if (activeTab === 'dev' || activeTab === 'ai' || activeTab === 'report') return
    if (tabData[activeTab]) return
    api.get(`/metrics/${activeTab}`)
      .then((d) => setTabData((prev) => ({ ...prev, [activeTab]: d })))
      .catch(console.error)
  }, [activeTab])

  const totalScore = leaderboard
    ? leaderboard.reduce((s, m) => s + m.total_score, 0)
    : 0

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <LoadingSpinner size={120} />
      </div>
    )
  }

  return (
    <>
      <TopBar
        teamName={overview?.team_name}
        week={overview?.current_week}
        year={overview?.current_year}
        totalScore={totalScore}
      />
      <div className="page">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn${activeTab === t.key ? ' active' : ''}${t.key === 'ai' ? ' tab-ai' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'dev'     && <DevTab />}
        {activeTab === 'support' && <SupportTab data={tabData.support} />}
        {activeTab === 'docs'    && <DocsTab data={tabData.docs} />}
        {activeTab === 'ai'      && <AIUsageTab />}
        {activeTab === 'report'  && <WeeklyReportTab />}

        <Leaderboard data={leaderboard} />
      </div>
    </>
  )
}
