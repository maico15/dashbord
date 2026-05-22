import { useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js'
import BottleneckBars from '../components/BottleneckBars'
import { useTheme } from '../hooks/useTheme'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const AI_COLOR = '#a855f7'

const ENGINEERS = [
  { name: 'Andrey Brunetkin',   initials: 'AB', color: '#00cfff' },
  { name: 'Andrey Pogrebnyak',  initials: 'AP', color: '#7b61ff' },
  { name: 'Evgeniy Vinogradov', initials: 'EV', color: '#00c87a' },
]

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function AICard({ label, value, sub, color = AI_COLOR }) {
  return (
    <div className="metric-card" style={{ borderColor: `${color}22` }}>
      <div className="label">{label}</div>
      <div className="value" style={{ color, fontSize: 26 }}>{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

function TokensConsumptionChart({ tokensPerWeek, tokensPerUser }) {
  const [active, setActive] = useState(new Set(['team']))
  const theme = useTheme()
  const isDark = theme === 'dark'

  const gridColor   = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)'
  const tickColor   = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(13,19,64,0.5)'
  const tipBg       = isDark ? '#111c3a' : '#ffffff'
  const tipBorder   = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'
  const tipTitle    = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(13,19,64,0.5)'
  const tipBody     = isDark ? '#e2e8f0' : '#0d1340'

  function toggle(key) {
    setActive(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const weeks = tokensPerWeek || []

  const datasets = [
    {
      label: 'Team total',
      data: weeks.map(d => Math.round((d.team || 0) / 1000)),
      borderColor: AI_COLOR,
      backgroundColor: 'rgba(168,85,247,0.12)',
      fill: true,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      hidden: !active.has('team'),
    },
    ...ENGINEERS.map(e => ({
      label: e.name,
      data: weeks.map(d => Math.round((d[e.name] || 0) / 1000)),
      borderColor: e.color,
      backgroundColor: 'transparent',
      fill: false,
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      hidden: !active.has(e.name),
    })),
  ]

  const chartData = {
    labels: weeks.map(d => d.week),
    datasets,
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 180 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tipBg,
        borderColor: tipBorder,
        borderWidth: 1,
        titleColor: tipTitle,
        bodyColor: tipBody,
        padding: 10,
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}K`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        border: { display: false },
        ticks: { color: tickColor, font: { size: 11 } },
      },
      y: {
        grid: { color: gridColor },
        border: { display: false },
        ticks: { color: tickColor, font: { size: 11 }, callback: v => `${v}K` },
      },
    },
  }

  const legendItems = [
    {
      key: 'team',
      label: 'Team total',
      initials: 'ALL',
      color: AI_COLOR,
      tokens: (tokensPerUser || []).reduce((s, u) => s + u.tokens, 0),
    },
    ...ENGINEERS.map(e => ({
      key: e.name,
      label: e.name,
      initials: e.initials,
      color: e.color,
      tokens: (tokensPerUser || []).find(u => u.name === e.name)?.tokens || 0,
    })),
  ]

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: 'var(--muted)',
        textTransform: 'uppercase',
        marginBottom: 16,
      }}>
        AI Usage · Tokens Consumption · 8 Weeks
      </div>

      {/* Checkbox legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {legendItems.map(item => {
          const on = active.has(item.key)
          return (
            <div
              key={item.key}
              onClick={() => toggle(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                userSelect: 'none',
                padding: '6px 12px',
                borderRadius: 8,
                background: on ? `${item.color}12` : 'transparent',
                border: `1px solid ${on ? item.color + '55' : 'var(--border)'}`,
                transition: 'all 0.15s ease',
              }}
            >
              {/* Checkbox */}
              <div style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                border: `2px solid ${item.color}`,
                background: on ? item.color : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.15s ease',
              }}>
                {on && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="#080d1f" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              {/* Avatar */}
              <div style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                background: `${item.color}1a`,
                border: `1px solid ${item.color}44`,
                color: item.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 800,
                flexShrink: 0,
                letterSpacing: 0,
              }}>
                {item.initials}
              </div>
              {/* Name */}
              <span style={{
                fontSize: 13,
                color: on ? '#e2e8f0' : 'var(--muted)',
                transition: 'color 0.15s ease',
              }}>
                {item.label}
              </span>
              {/* Tokens total */}
              <span style={{ fontSize: 11, color: item.color, fontWeight: 600 }}>
                {fmt(item.tokens)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Chart */}
      <div style={{ height: 260, position: 'relative' }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  )
}

export default function AIUsageTab({ data }) {
  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" />
      </div>
    )
  }

  const {
    total_tokens, total_cost_usd,
    tokens_per_user, tokens_per_week,
    leverage_scores, source, api_error,
  } = data

  // Top consumer this week (latest week in tokens_per_week)
  const latestWeek = tokens_per_week?.[tokens_per_week.length - 1]
  let topThisWeek = { name: '—', tokens: 0, pct: 0 }
  if (latestWeek) {
    for (const e of ENGINEERS) {
      const tok = latestWeek[e.name] || 0
      if (tok > topThisWeek.tokens) topThisWeek = { name: e.name, tokens: tok, pct: 0 }
    }
    if (latestWeek.team) {
      topThisWeek.pct = Math.round(topThisWeek.tokens / latestWeek.team * 100)
    }
  }

  const tokensRows = (tokens_per_user || []).map(u => ({
    name: u.name,
    value: Math.round(u.tokens / 1000),
    unit: 'K',
  }))

  const leverageRows = (leverage_scores || []).map(s => ({
    name: s.name,
    value: Math.round(s.leverage_score * 100) / 100,
  }))

  return (
    <>
      {source === 'mock' && (
        <div style={{
          margin: '16px 0 0',
          padding: '10px 14px',
          background: 'rgba(168,85,247,0.08)',
          border: '1px solid rgba(168,85,247,0.25)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: AI_COLOR }}>⬡</span>
          {api_error
            ? `API error: ${api_error} — showing mock data.`
            : 'Showing mock data. Add your Anthropic Admin API key in /admin → Configuration to see live usage.'}
        </div>
      )}

      <TokensConsumptionChart tokensPerWeek={tokens_per_week} tokensPerUser={tokens_per_user} />

      <div className="metric-grid" style={{ marginTop: 20 }}>
        <AICard
          label="Total tokens this month"
          value={fmt(total_tokens)}
          sub="input + output"
        />
        <AICard
          label="Estimated cost"
          value={`$${total_cost_usd?.toFixed(2)}`}
          sub="$0.003 per 1K tokens"
          color="#00cfff"
        />
        <AICard
          label="Top consumer this week"
          value={topThisWeek.name}
          sub={topThisWeek.tokens > 0
            ? `${fmt(topThisWeek.tokens)} · ${topThisWeek.pct}% of total`
            : '—'}
          color="#c084fc"
        />
      </div>

      <div className="two-col" style={{ marginTop: 20 }}>
        <BottleneckBars
          title="Tokens per engineer"
          rows={tokensRows}
          color={AI_COLOR}
        />
        <BottleneckBars
          title="AI leverage score · tasks / 1K tokens"
          rows={leverageRows}
          color="var(--success)"
        />
      </div>
    </>
  )
}
