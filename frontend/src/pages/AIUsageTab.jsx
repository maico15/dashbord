import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

const AI_COLOR = '#a855f7'
const AI_DIM   = 'rgba(168,85,247,0.15)'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const STREAM_LABEL = { dev: 'Dev', support: 'Support', docs: 'Docs' }
const TREND_ICON   = { up: '↑', down: '↓', stable: '→' }
const TREND_COLOR  = { up: 'var(--success)', down: 'var(--danger)', stable: 'var(--muted)' }

// ── Shared tooltip ────────────────────────────────────────────────────────────

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? fmt(p.value) : p.value}
        </div>
      ))}
    </div>
  )
}

// ── Top cards ─────────────────────────────────────────────────────────────────

function AICard({ label, value, sub, color = AI_COLOR }) {
  return (
    <div className="metric-card" style={{ borderColor: `${color}22` }}>
      <div className="label">{label}</div>
      <div className="value" style={{ color, fontSize: 26 }}>{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

// ── Tokens per day (line chart) ───────────────────────────────────────────────

function TokensLine({ data }) {
  const slim = data.filter((_, i) => i % 3 === 0 || i === data.length - 1)
  return (
    <div className="card">
      <div className="section-title" style={{ margin: '0 0 14px' }}>
        Tokens per day · 30 дней
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="ai-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={AI_COLOR} stopOpacity={0.2} />
                <stop offset="95%" stopColor={AI_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => v.slice(5)}
              tick={{ fill: 'var(--muted)', fontSize: 10 }}
              axisLine={false} tickLine={false}
              interval={4}
            />
            <YAxis
              tickFormatter={fmt}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip content={<ChartTip />} />
            <Line
              type="monotone" dataKey="tokens" name="Tokens"
              stroke={AI_COLOR} strokeWidth={2}
              dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: AI_COLOR }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Tokens per engineer (bar chart) ──────────────────────────────────────────

function TokensBar({ data }) {
  const chartData = data.map((u) => ({ name: u.name, tokens: u.tokens }))
  return (
    <div className="card">
      <div className="section-title" style={{ margin: '0 0 14px' }}>
        Tokens per engineer
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              tickFormatter={fmt}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip content={<ChartTip />} />
            <Bar dataKey="tokens" name="Tokens" fill={AI_COLOR} opacity={0.85} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Leverage score table ──────────────────────────────────────────────────────

function LeverageTable({ scores }) {
  if (!scores?.length) return null
  const maxLev = Math.max(...scores.map((s) => s.leverage_score), 0.001)

  return (
    <div style={{ marginTop: 28 }}>
      <div className="section-title">AI Leverage Score · задачи / 1K токенов</div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Инженер</th>
              <th>Поток</th>
              <th>Tokens used</th>
              <th>Tasks done</th>
              <th style={{ width: 200 }}>Leverage score</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s, i) => (
              <tr key={s.id}>
                <td style={{ color: 'var(--muted)', fontSize: 13 }}>#{i + 1}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: s.avatar_color, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#080d1f',
                      flexShrink: 0,
                    }}>
                      {s.name.split(' ').slice(0, 2).map((w) => w[0]).join('')}
                    </div>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</span>
                  </div>
                </td>
                <td>
                  <span className={`tag tag-${s.stream}`}>
                    {STREAM_LABEL[s.stream] || s.stream}
                  </span>
                </td>
                <td style={{ fontSize: 13, color: AI_COLOR, fontWeight: 600 }}>
                  {fmt(s.tokens_used)}
                </td>
                <td style={{ fontSize: 13 }}>{s.tasks_completed}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      flex: 1, height: 6, background: 'var(--card2)',
                      borderRadius: 3, overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${(s.leverage_score / maxLev) * 100}%`,
                        height: '100%',
                        background: s.leverage_score > maxLev * 0.6
                          ? 'var(--success)'
                          : s.leverage_score > maxLev * 0.3
                          ? AI_COLOR
                          : 'var(--danger)',
                        borderRadius: 3,
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 36, textAlign: 'right' }}>
                      {s.leverage_score.toFixed(2)}
                    </span>
                  </div>
                </td>
                <td>
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: TREND_COLOR[s.trend] || 'var(--muted)',
                  }}>
                    {TREND_ICON[s.trend] || '→'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
        Leverage = tasks completed ÷ (tokens used / 1K). Higher = more efficient AI use.
        {scores[0]?.tokens_used && scores[0].tokens_used < 30000
          ? ' Mock data shown — add Anthropic Admin API key in /admin to see live data.'
          : ''}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AIUsageTab({ data }) {
  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" />
      </div>
    )
  }

  const { total_tokens, total_cost_usd, tokens_per_user, tokens_per_day, leverage_scores, source, api_error } = data

  const mostActive = tokens_per_user?.[0]
  const avgPerTask = leverage_scores?.length
    ? Math.round(
        tokens_per_user.reduce((s, u) => s + u.tokens, 0) /
        Math.max(leverage_scores.reduce((s, l) => s + l.tasks_completed, 0), 1)
      )
    : 0

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
            : 'Showing mock data. Add your Anthropic Admin API key in /admin → Конфигурация to see live usage.'}
        </div>
      )}

      <div className="metric-grid" style={{ marginTop: 16 }}>
        <AICard
          label="Total tokens / 30d"
          value={fmt(total_tokens)}
          sub="input + output"
        />
        <AICard
          label="Total cost / 30d"
          value={`$${total_cost_usd?.toFixed(2)}`}
          sub="≈ $0.000003 avg/token"
          color="#a855f7"
        />
        <AICard
          label="Most active"
          value={mostActive?.name ?? '—'}
          sub={mostActive ? `${fmt(mostActive.tokens)} tokens` : ''}
          color="#c084fc"
        />
        <AICard
          label="Avg tokens / task"
          value={fmt(avgPerTask)}
          sub="across all engineers"
          color="#7c3aed"
        />
      </div>

      <div className="two-col" style={{ marginTop: 20 }}>
        <TokensLine data={tokens_per_day || []} />
        <TokensBar  data={tokens_per_user || []} />
      </div>

      <LeverageTable scores={leverage_scores} />
    </>
  )
}
