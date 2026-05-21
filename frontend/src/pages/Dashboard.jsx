import { useState, useEffect } from 'react'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import MetricCard from '../components/MetricCard'
import BottleneckBars from '../components/BottleneckBars'
import XPChart from '../components/XPChart'
import Leaderboard from '../components/Leaderboard'
import AIUsageTab from './AIUsageTab'

const TABS = [
  { key: 'dev', label: 'Development' },
  { key: 'support', label: 'Support' },
  { key: 'docs', label: 'Documentation' },
  { key: 'ai', label: '⬡ AI Usage' },
]

function DevTab({ data }) {
  if (!data) return <div className="spinner" style={{ margin: '40px auto', display: 'block' }} />
  const { totals, weekly_chart, bottlenecks } = data
  return (
    <>
      <div className="metric-grid">
        <MetricCard label="PRs merged" value={totals.prs_merged} sub="this week" accent="accent1"
          tooltip="Pull requests merged this week. Each PR earns XP based on the points configured in Admin → Rules." />
        <MetricCard label="Tickets closed" value={totals.tickets_closed} sub="this week" accent="accent2"
          tooltip="Jira / Linear tickets resolved this week. Counts toward the dev XP score for each engineer." />
        <MetricCard
          label="Avg cycle time"
          value={`${totals.avg_cycle_time}d`}
          sub={totals.avg_cycle_time < 2 ? '✓ below target' : '⚠ above 2d'}
          accent={totals.avg_cycle_time < 2 ? 'success' : 'warning'}
          tooltip="Average time from PR open to merge, in days. Target is under 2 days. Lower is better."
        />
        <MetricCard label="Features / week" value={totals.features_completed} sub="completed" accent="accent1"
          tooltip="Completed feature tasks delivered this week across all engineers in the dev stream." />
        <MetricCard
          label="Deploy freq"
          value={`${totals.deploy_frequency}x`}
          sub={`${totals.deploys} deploys total`}
          accent="accent2"
          tooltip="How many times the team deployed to production this week. Calculated as total deploys ÷ active engineers."
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
            title="Cycle time (days)"
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
        <MetricCard label="Incidents opened" value={totals.incidents_opened} sub="this week" accent="warning"
          tooltip="New support incidents reported this week. Tracked per engineer in the support stream." />
        <MetricCard label="Incidents resolved" value={totals.incidents_resolved} sub="this week" accent="success"
          tooltip="Incidents closed or resolved this week. Each resolved incident earns XP per the Rules table." />
        <MetricCard
          label="Avg resolution"
          value={`${totals.avg_resolution_hours}h`}
          sub={totals.avg_resolution_hours < 2 ? '✓ within SLA' : '⚠ above 2h'}
          accent={totals.avg_resolution_hours < 2 ? 'success' : 'danger'}
          tooltip="Average time to resolve an incident, in hours. SLA target is under 2 hours. Lower is better."
        />
        <MetricCard
          label="SLA %"
          value={`${totals.sla_percentage}%`}
          sub={`${totals.sla_breached} breaches`}
          accent={totals.sla_percentage >= 90 ? 'success' : 'danger'}
          tooltip="Percentage of incidents resolved within the SLA time window. Target is 90% or above. Breaches reduce XP."
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
