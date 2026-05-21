import { useState, useEffect } from 'react'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import MetricCard from '../components/MetricCard'
import BottleneckBars from '../components/BottleneckBars'
import XPChart from '../components/XPChart'
import Leaderboard from '../components/Leaderboard'
import AIUsageTab from './AIUsageTab'

const TABS = [
  { key: 'dev', label: 'Разработка' },
  { key: 'support', label: 'Суппорт' },
  { key: 'docs', label: 'Документация' },
  { key: 'ai', label: '⬡ AI Usage' },
]

function DevTab({ data }) {
  if (!data) return <div className="spinner" style={{ margin: '40px auto', display: 'block' }} />
  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="PRs merged" value={totals.prs_merged} sub="за неделю" accent="accent1" />
        <MetricCard label="Tickets closed" value={totals.tickets_closed} sub="за неделю" accent="accent2" />
        <MetricCard
          label="Avg cycle time"
          value={`${totals.avg_cycle_time}d`}
          sub={totals.avg_cycle_time < 2 ? '✓ под целью' : '⚠ выше 2д'}
          accent={totals.avg_cycle_time < 2 ? 'success' : 'warning'}
        />
        <MetricCard label="Features / week" value={totals.features_completed} sub="завершено" accent="accent1" />
        <MetricCard
          label="Deploy freq"
          value={`${totals.deploy_frequency}x`}
          sub={`${totals.deploys} deploys total`}
          accent="accent2"
        />
      </div>

      <div className="two-col">
        <XPChart data={weekly_chart} color="#00cfff" name="XP" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BottleneckBars
            title="PRs merged"
            rows={bottlenecks.map((b) => ({ name: b.name, value: b.prs_merged }))}
            color="var(--accent1)"
          />
          <BottleneckBars
            title="Cycle time (дней)"
            rows={bottlenecks.map((b) => ({ name: b.name, value: b.cycle_time_days, unit: 'd' }))}
            color="var(--accent2)"
          />
        </div>
      </div>
    </>
  )
}

function SupportTab({ data }) {
  if (!data) return <div className="spinner" style={{ margin: '40px auto', display: 'block' }} />
  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="Incidents opened" value={totals.incidents_opened} sub="за неделю" accent="warning" />
        <MetricCard label="Incidents resolved" value={totals.incidents_resolved} sub="за неделю" accent="success" />
        <MetricCard
          label="Avg resolution"
          value={`${totals.avg_resolution_hours}h`}
          sub={totals.avg_resolution_hours < 2 ? '✓ в пределах SLA' : '⚠ выше 2ч'}
          accent={totals.avg_resolution_hours < 2 ? 'success' : 'danger'}
        />
        <MetricCard
          label="SLA %"
          value={`${totals.sla_percentage}%`}
          sub={`${totals.sla_breached} нарушений`}
          accent={totals.sla_percentage >= 90 ? 'success' : 'danger'}
        />
      </div>

      <div className="two-col">
        <XPChart data={weekly_chart} color="#00ff9d" name="XP" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BottleneckBars
            title="Resolved per engineer"
            rows={bottlenecks.map((b) => ({ name: b.name, value: b.incidents_resolved }))}
            color="var(--success)"
          />
          <BottleneckBars
            title="SLA breaches"
            rows={bottlenecks.map((b) => ({ name: b.name, value: b.sla_breached }))}
            color="var(--danger)"
          />
        </div>
      </div>
    </>
  )
}

function DocsTab({ data }) {
  if (!data) return <div className="spinner" style={{ margin: '40px auto', display: 'block' }} />
  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="Docs created" value={totals.docs_created} sub="за неделю" accent="warning" />
        <MetricCard label="Docs updated" value={totals.docs_updated} sub="за неделю" accent="accent2" />
        <MetricCard
          label="Coverage"
          value={`${totals.coverage_percentage}%`}
          sub={`${totals.projects_covered} / ${totals.projects_total} проектов`}
          accent={totals.coverage_percentage >= 80 ? 'success' : 'warning'}
        />
      </div>

      <div className="two-col">
        <XPChart data={weekly_chart} color="#ffd700" name="XP" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BottleneckBars
            title="Docs created per engineer"
            rows={bottlenecks.map((b) => ({ name: b.name, value: b.docs_created }))}
            color="var(--warning)"
          />
          <BottleneckBars
            title="Docs updated"
            rows={bottlenecks.map((b) => ({ name: b.name, value: b.docs_updated }))}
            color="var(--accent2)"
          />
        </div>
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
    if (tabData[activeTab]) return
    const endpoint = activeTab === 'ai' ? '/ai-usage' : `/metrics/${activeTab}`
    api.get(endpoint)
      .then((d) => setTabData((prev) => ({ ...prev, [activeTab]: d })))
      .catch(console.error)
  }, [activeTab])

  const totalScore = leaderboard
    ? leaderboard.reduce((s, m) => s + m.total_score, 0)
    : 0

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
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

        {activeTab === 'dev'     && <DevTab data={tabData.dev} />}
        {activeTab === 'support' && <SupportTab data={tabData.support} />}
        {activeTab === 'docs'    && <DocsTab data={tabData.docs} />}
        {activeTab === 'ai'      && <AIUsageTab data={tabData.ai} />}

        {activeTab !== 'ai' && <Leaderboard data={leaderboard} />}
      </div>
    </>
  )
}
