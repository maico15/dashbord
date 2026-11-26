import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import LoadingSpinner from '../components/LoadingSpinner'
import { api } from '../api/client'

const formatTokens = (n) => {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const delta = (curr, prev) => {
  if (prev == null || curr == null) return null
  return curr - prev
}

function DeltaCell({ curr, prev, fmt = (v) => v }) {
  const d = delta(curr, prev)
  if (d == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  if (d === 0)   return <span style={{ color: 'var(--muted)' }}>—</span>
  const up = d > 0
  return (
    <span style={{ color: up ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
      {up ? '↑' : '↓'} {fmt(Math.abs(d))}
    </span>
  )
}

// ── Custom tooltips ────────────────────────────────────────────────────────────

const GithubTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.stroke || p.fill, fontWeight: 600 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  )
}

const AiTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill, fontWeight: 600 }}>
          {p.name}: {formatTokens(p.value)}
        </div>
      ))}
    </div>
  )
}

// ── Section heading ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 14,
    }}>
      {children}
    </div>
  )
}

// ── GitHub Activity Trends ─────────────────────────────────────────────────────

function GithubTrends({ weeks }) {
  // weeks: [{week:'W16', prs:5, commits:42}, ...]  newest-last from API
  const sorted = [...weeks].sort((a, b) => {
    const na = parseInt(a.week.replace('W', ''), 10)
    const nb = parseInt(b.week.replace('W', ''), 10)
    return na - nb
  })

  // table rows newest-first
  const tableRows = [...sorted].reverse().map((row, i, arr) => {
    const prev = arr[i + 1]
    return { ...row, prevPrs: prev?.prs, prevCommits: prev?.commits }
  })

  const curWeekLabel = sorted[sorted.length - 1]?.week

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <SectionLabel>GitHub · Last 8 Weeks</SectionLabel>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={sorted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip content={<GithubTip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            type="monotone" dataKey="prs" name="PRs Merged"
            stroke="#00cfff" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
          />
          <Line
            type="monotone" dataKey="commits" name="Commits"
            stroke="#7b61ff" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div style={{ overflowX: 'auto', marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Week', 'PRs', 'Delta PRs', 'Commits', 'Delta Commits'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Week' ? 'left' : 'right',
                  padding: '6px 12px', fontSize: 11,
                  fontWeight: 700, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => {
              const isCurrent = row.week === curWeekLabel
              return (
                <tr key={row.week} style={{
                  borderBottom: '1px solid var(--border)',
                  background: isCurrent ? 'var(--accent1-bg)' : 'transparent',
                  fontWeight: isCurrent ? 700 : 400,
                }}>
                  <td style={{ padding: '7px 12px', color: isCurrent ? 'var(--accent1)' : 'var(--text)' }}>
                    {row.week}{isCurrent ? ' ·' : ''}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{row.prs ?? 0}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                    <DeltaCell curr={row.prs} prev={row.prevPrs} />
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{row.commits ?? 0}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                    <DeltaCell curr={row.commits} prev={row.prevCommits} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── AI Token Trends ────────────────────────────────────────────────────────────

function AiTrends({ weeks, engineers }) {
  // weeks: [{week:'W16', team:0, 'Andrey Brunetkin':0, ...}, ...]
  // engineers: [{name, color}]  for bar colors

  const sorted = [...weeks].sort((a, b) => {
    const na = parseInt(a.week.replace('W', ''), 10)
    const nb = parseInt(b.week.replace('W', ''), 10)
    return na - nb
  })

  const curWeekLabel = sorted[sorted.length - 1]?.week

  const tableRows = [...sorted].reverse().map((row, i, arr) => {
    const prev = arr[i + 1]
    return { ...row, prevTeam: prev?.team }
  })

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <SectionLabel>AI Tokens · Last 8 Weeks</SectionLabel>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={sorted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tickFormatter={formatTokens} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip content={<AiTip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {engineers.map((eng) => (
            <Bar
              key={eng.name}
              dataKey={eng.name}
              name={eng.name.split(' ')[0]}
              stackId="a"
              fill={eng.color}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div style={{ overflowX: 'auto', marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Week', 'Total Tokens', 'Delta', 'Sessions', 'Active Engineers'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Week' ? 'left' : 'right',
                  padding: '6px 12px', fontSize: 11,
                  fontWeight: 700, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => {
              const isCurrent = row.week === curWeekLabel
              const sessions = row._sessions ?? '—'
              const active   = row._active   ?? '—'
              return (
                <tr key={row.week} style={{
                  borderBottom: '1px solid var(--border)',
                  background: isCurrent ? 'var(--accent1-bg)' : 'transparent',
                  fontWeight: isCurrent ? 700 : 400,
                }}>
                  <td style={{ padding: '7px 12px', color: isCurrent ? 'var(--accent1)' : 'var(--text)' }}>
                    {row.week}{isCurrent ? ' ·' : ''}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                    {formatTokens(row.team)}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                    <DeltaCell curr={row.team} prev={row.prevTeam} fmt={formatTokens} />
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{sessions}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right' }}>{active}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Browser AI Usage Trends ─────────────────────────────────────────────────

const BROWSER_TOOL_COLORS = {
  'chatgpt':   '#10a37f',
  'claude.ai': '#7c3aed',
  'lovable':   '#ff6b6b',
  'gemini':    '#4285f4',
  'copilot':   '#7b61ff',
}

const BROWSER_TOOL_LABELS = {
  'chatgpt':   'ChatGPT',
  'claude.ai': 'Claude.ai',
  'lovable':   'Lovable',
  'gemini':    'Gemini',
  'copilot':   'Copilot',
}

function formatHours(mins) {
  if (!mins) return '0h'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const BrowserAiTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill, fontWeight: 600 }}>
          {p.name}: {formatHours(p.value)}
        </div>
      ))}
    </div>
  )
}

function BrowserAiTrends({ weeks }) {
  // weeks: [{week:'W19', chatgpt:120, 'claude.ai':30, total:150}, ...]
  if (!weeks || weeks.length === 0) return null

  const tools = Object.keys(BROWSER_TOOL_COLORS)
  const hasData = weeks.some(w => tools.some(t => (w[t] || 0) > 0))
  if (!hasData) return null

  const sorted = [...weeks].sort((a, b) => {
    const na = parseInt(a.week.replace('W', ''), 10)
    const nb = parseInt(b.week.replace('W', ''), 10)
    return na - nb
  })

  // active tools = tools that have at least one non-zero value
  const activeTools = tools.filter(t => sorted.some(w => (w[t] || 0) > 0))

  const curWeek = sorted[sorted.length - 1]
  const prevWeek = sorted[sorted.length - 2]
  const curTotal = activeTools.reduce((s, t) => s + (curWeek?.[t] || 0), 0)
  const prevTotal = activeTools.reduce((s, t) => s + (prevWeek?.[t] || 0), 0)
  const delta = curTotal - prevTotal

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <SectionLabel>Browser AI usage · Last 8 Weeks</SectionLabel>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>This week</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{formatHours(curTotal)}</div>
          {prevTotal > 0 && (
            <div style={{ fontSize: 11, color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {delta >= 0 ? '↑' : '↓'} {formatHours(Math.abs(delta))} vs last
            </div>
          )}
        </div>
        {activeTools.map(t => (
          <div key={t} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BROWSER_TOOL_COLORS[t], flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{BROWSER_TOOL_LABELS[t] || t}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>
              {formatHours(curWeek?.[t] || 0)}
            </div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={sorted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis
            tickFormatter={v => v >= 60 ? `${Math.floor(v / 60)}h` : `${v}m`}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
          />
          <Tooltip content={<BrowserAiTip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {activeTools.map(t => (
            <Bar
              key={t}
              dataKey={t}
              name={BROWSER_TOOL_LABELS[t] || t}
              stackId="a"
              fill={BROWSER_TOOL_COLORS[t]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TrendsTab() {
  const [loading, setLoading] = useState(true)
  const [githubWeeks, setGithubWeeks]   = useState([])
  const [aiWeeks, setAiWeeks]           = useState([])
  const [engineers, setEngineers]       = useState([])
  const [browserWeeks, setBrowserWeeks] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      // 1. overview for current week/year
      const ov = await api.get('/overview')
      const curWeek = ov.current_week
      const curYear = ov.current_year

      // 2. GitHub metrics (already contains 8 weeks in weekly_chart) + AI history
      const [devData, aiHistory, browserHistory] = await Promise.all([
        api.get(`/metrics/dev?week=${curWeek}&year=${curYear}`),
        api.get('/ai-usage/history?n=8'),
        Promise.all(
          Array.from({ length: 8 }, (_, i) => {
            const w = curWeek - (7 - i)
            return w > 0
              ? api.get(`/ai-usage/browser?week=${w}&year=${curYear}`)
                  .then(d => ({ week: `W${w}`, tools: d.tools || [] }))
                  .catch(() => ({ week: `W${w}`, tools: [] }))
              : Promise.resolve({ week: `W${w}`, tools: [] })
          })
        ),
      ])

      if (cancelled) return

      // ── GitHub: extract prs + commits from weekly_chart ──────────────────────
      const ghWeeks = (devData.weekly_chart || []).map(w => ({
        week:    w.week,
        prs:     w.prs     ?? 0,
        commits: w.commits ?? 0,   // weekly_chart has prs, tickets, deploys, score
        // score is also in w.score — not used here
      }))

      // ── AI history: collect unique engineer names from all weeks ─────────────
      const engSet = new Map()  // name -> color
      const FALLBACK_COLORS = ['#00cfff', '#7b61ff', '#00ff9d', '#ffa200']
      ;(aiHistory || []).forEach(row => {
        Object.keys(row).forEach((k, idx) => {
          if (k !== 'week' && k !== 'team' && !k.startsWith('_') && !engSet.has(k)) {
            engSet.set(k, FALLBACK_COLORS[engSet.size % FALLBACK_COLORS.length])
          }
        })
      })

      // 3. Fetch per-engineer weekly detail for the last 8 weeks (sessions + active)
      const weeksToFetch = (aiHistory || []).map(row => {
        const wNum = parseInt((row.week || '').replace('W', ''), 10)
        return { label: row.week, week: wNum, year: curYear }
      }).filter(w => w.week > 0)

      const weekDetails = await Promise.all(
        weeksToFetch.map(w =>
          api.get(`/ai-usage/weekly?week=${w.week}&year=${w.year}`)
            .then(d => ({ label: w.label, data: d }))
            .catch(() => ({ label: w.label, data: null }))
        )
      )

      if (cancelled) return

      // Build a map: week label -> {sessions, active, engineer colors}
      const weekDetailMap = {}
      weekDetails.forEach(({ label, data }) => {
        if (!data) return
        const engs = data.engineers || []
        const sessions = engs.reduce((s, e) => s + (e.sessions || 0), 0)
        const active   = engs.filter(e => (e.tokens_input + e.tokens_output) > 0).length
        weekDetailMap[label] = { sessions, active, engineers: engs }
        engs.forEach(e => {
          if (e.name && e.color) {
            engSet.set(e.name, e.color)
          }
        })
      })

      // Merge sessions/active + per-engineer tokens into aiHistory rows
      const mergedAi = (aiHistory || []).map(row => {
        const detail = weekDetailMap[row.week]
        const engTokens = {}
        if (detail?.engineers) {
          detail.engineers.forEach(e => {
            if (e.name) engTokens[e.name] = (e.tokens_output || 0)
          })
        }
        return {
          ...row,
          ...engTokens,
          _sessions: detail?.sessions ?? null,
          _active:   detail?.active   ?? null,
        }
      })

      setGithubWeeks(ghWeeks)
      setAiWeeks(mergedAi)
      setEngineers([...engSet.entries()].map(([name, color]) => ({ name, color })))

      // Build browser weeks array: [{week, chatgpt, 'claude.ai', ...}]
      const bWeeks = browserHistory.map(({ week, tools }) => {
        const row = { week }
        tools.forEach(t => { row[t.tool] = t.total_minutes || 0 })
        return row
      })
      setBrowserWeeks(bWeeks)
      setLoading(false)
    }

    load().catch(err => {
      console.error('[TrendsTab] load error:', err)
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div style={{ marginTop: 20 }}>
      <GithubTrends weeks={githubWeeks} />
      <AiTrends weeks={aiWeeks} engineers={engineers} />
      <BrowserAiTrends weeks={browserWeeks} />
    </div>
  )
}
