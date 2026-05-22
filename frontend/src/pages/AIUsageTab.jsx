import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import BottleneckBars from '../components/BottleneckBars'

const AI_COLOR = '#a855f7'

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

function TokensLine({ data }) {
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="section-title" style={{ margin: '0 0 14px' }}>
        Tokens per day · 30 days
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

  const tokensRows = (tokens_per_user || []).map((u) => ({
    name: u.name,
    value: Math.round(u.tokens / 1000),
    unit: 'K',
  }))

  const leverageRows = (leverage_scores || []).map((s) => ({
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

      <div className="metric-grid" style={{ marginTop: 16 }}>
        <AICard label="Total tokens / 30d" value={fmt(total_tokens)} sub="input + output" />
        <AICard label="Total cost / 30d" value={`$${total_cost_usd?.toFixed(2)}`} sub="≈ $0.000003 avg/token" color="#a855f7" />
        <AICard label="Most active" value={mostActive?.name ?? '—'} sub={mostActive ? `${fmt(mostActive.tokens)} tokens` : ''} color="#c084fc" />
      </div>

      <TokensLine data={tokens_per_day || []} />

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
