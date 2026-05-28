import { useState, useEffect } from 'react'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import BottleneckBars from '../components/BottleneckBars'
import { api } from '../api/client'

const COLOR_INPUT  = '#00cfff'   // teal — accent1
const COLOR_OUTPUT = '#7b61ff'   // purple — accent2

const formatTokens = (n) => {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

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

// ── Stat card ─────────────────────────────────────────────────────────────────
function AICard({ label, value, sub, color = COLOR_OUTPUT }) {
  return (
    <div className="metric-card" style={{ borderColor: `${color}22` }}>
      <div className="label">{label}</div>
      <div className="value" style={{ color, fontSize: 26 }}>{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

// ── Stacked daily bar chart ───────────────────────────────────────────────────
const DailyTip = ({ active, payload, label }) => {
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

function DailyChart({ daily }) {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const rows = (daily || []).map(d => ({
    day: DAY_NAMES[new Date(d.date + 'T12:00:00Z').getDay()] || d.date.slice(5),
    tokens_input:  d.tokens_input  || 0,
    tokens_output: d.tokens_output || 0,
  }))

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 14,
      }}>
        Daily Token Usage
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false}
              tickFormatter={v => formatTokens(v)}
            />
            <Tooltip content={<DailyTip />} />
            <Bar dataKey="tokens_input"  name="Input"  stackId="a" fill={COLOR_INPUT}  radius={[0, 0, 0, 0]} />
            <Bar dataKey="tokens_output" name="Output" stackId="a" fill={COLOR_OUTPUT} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
        {[['Input tokens', COLOR_INPUT], ['Output tokens', COLOR_OUTPUT]].map(([label, color]) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, color: 'var(--muted)',
          }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Empty / no-collector state ────────────────────────────────────────────────
function EmptyState({ week }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 24px',
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, marginTop: 20,
    }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
        No telemetry data for week {week}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
        Install the Claude Code collector on each developer machine to start tracking token usage.
      </div>
      <div style={{
        background: 'var(--card2)', borderRadius: 8, padding: '12px 16px',
        fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        color: 'var(--accent1)', textAlign: 'left', display: 'inline-block',
        border: '1px solid var(--border)',
      }}>
        curl -sSL https://dashbord-5u0i.onrender.com/install.sh | bash
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
        Or run manually:{' '}
        <code style={{ color: 'var(--accent2)' }}>python cc_telemetry.py --once</code>
      </div>
    </div>
  )
}

// ── Tab root ──────────────────────────────────────────────────────────────────
export default function AIUsageTab() {
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
    api.get(`/ai-usage/weekly?week=${week}&year=${year}`)
      .then(d => { setReport(d); setLoading(false) })
      .catch(e => { console.error(e); setError('Failed to load AI usage data'); setLoading(false) })
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
  const hasData   = report && (
    (report.total_tokens_input || 0) + (report.total_tokens_output || 0) > 0
  )

  return (
    <>
      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, marginBottom: 20 }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ padding: '5px 14px' }}>←</button>
        <div style={{ textAlign: 'center', minWidth: 200 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Week {week ?? '…'}</div>
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
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setError(null); setLoading(true); api.get(`/ai-usage/weekly?week=${week}&year=${year}`).then(d => { setReport(d); setLoading(false) }).catch(e => { setError('Failed to load AI usage data'); setLoading(false) }) }}>↺ Retry</button>
        </div>
      )}

      {!loading && !error && !hasData && <EmptyState week={week} />}

      {!loading && hasData && (
        <>
          <div className="metric-grid">
            <AICard
              label="Total tokens"
              value={formatTokens((report.total_tokens_input || 0) + (report.total_tokens_output || 0))}
              sub="input + output"
              color={COLOR_OUTPUT}
            />
            <AICard
              label="Output tokens"
              value={formatTokens(report.total_tokens_output || 0)}
              sub={`${formatTokens(report.total_tokens_input || 0)} input`}
              color={COLOR_INPUT}
            />
            <AICard
              label="Active engineers"
              value={report.active_engineers ?? 0}
              sub={`${report.total_sessions ?? 0} session${report.total_sessions !== 1 ? 's' : ''}`}
              color="#c084fc"
            />
          </div>

          <DailyChart daily={report.daily || []} />

          <div className="two-col" style={{ marginTop: 20 }}>
            <BottleneckBars
              title="Input tokens per engineer"
              rows={(report.engineers || []).map(e => ({
                name: e.name,
                value: Math.round((e.tokens_input || 0) / 1000),
                unit: 'K',
              }))}
              color={COLOR_INPUT}
            />
            <BottleneckBars
              title="Output tokens per engineer"
              rows={(report.engineers || []).map(e => ({
                name: e.name,
                value: Math.round((e.tokens_output || 0) / 1000),
                unit: 'K',
              }))}
              color={COLOR_OUTPUT}
            />
          </div>
        </>
      )}
    </>
  )
}
