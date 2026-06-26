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

// ── Browser AI tools ─────────────────────────────────────────────────────────
const TOOL_COLORS = {
  claude:  '#d97706',
  chatgpt: '#10a37f',
  lovable: '#ff6b6b',
  gemini:  '#4285f4',
  copilot: '#7b61ff',
}

const TOOL_LABELS = {
  claude:  'Claude.ai',
  chatgpt: 'ChatGPT',
  lovable: 'Lovable',
  gemini:  'Gemini',
  copilot: 'Copilot',
}

function formatMinutes(mins) {
  if (!mins) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function BrowserToolsSection({ data }) {
  if (!data) return null
  const noData = !data.tools?.length && !data.per_engineer?.length
  const maxMins = Math.max(...(data.tools || []).map(t => t.total_minutes), 1)

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 500, color: 'var(--muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
      }}>
        Browser AI tools — this week
      </div>
      <div className="two-col">
        {/* Left: time by tool */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{
            fontSize: 11, color: 'var(--muted)', marginBottom: 12,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Time by tool
          </div>
          {noData ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
              No browser data yet — install telemetry app
            </div>
          ) : (data.tools || []).map(t => (
            <div key={t.tool} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                background: TOOL_COLORS[t.tool] || '#888',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 10, color: '#fff', fontWeight: 600 }}>
                  {(TOOL_LABELS[t.tool] || t.tool)[0].toUpperCase()}
                </span>
              </div>
              <span style={{ fontSize: 13, minWidth: 80 }}>{TOOL_LABELS[t.tool] || t.tool}</span>
              <div style={{ flex: 1, height: 5, background: 'var(--card2)', borderRadius: 3 }}>
                <div style={{
                  height: 5, borderRadius: 3,
                  background: TOOL_COLORS[t.tool] || '#888',
                  width: `${Math.round(t.total_minutes / maxMins * 100)}%`,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 40, textAlign: 'right' }}>
                {formatMinutes(t.total_minutes)}
              </span>
            </div>
          ))}
        </div>

        {/* Right: per engineer */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{
            fontSize: 11, color: 'var(--muted)', marginBottom: 12,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Per engineer
          </div>
          {noData ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
              No data yet
            </div>
          ) : (data.per_engineer || []).map(eng => (
            <div key={eng.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: (eng.color || '#888') + '22',
                color: eng.color || '#888',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 500,
              }}>
                {eng.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{eng.name}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                  {(eng.tools || []).slice(0, 3).map(t => (
                    <span key={t.tool} style={{
                      fontSize: 11, padding: '1px 7px', borderRadius: 10,
                      background: (TOOL_COLORS[t.tool] || '#888') + '22',
                      color: TOOL_COLORS[t.tool] || '#888',
                    }}>
                      {TOOL_LABELS[t.tool] || t.tool} {formatMinutes(t.minutes)}
                    </span>
                  ))}
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{formatMinutes(eng.total_minutes)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Empty / no-collector state ────────────────────────────────────────────────
function EmptyState({ week, departmentId, departmentName }) {
  if (departmentId !== 1) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8, color: 'var(--text)' }}>
          No data yet for {departmentName || 'this department'}
        </div>
        <div style={{ fontSize: 13, marginBottom: 20, maxWidth: 340, margin: '0 auto 20px' }}>
          Install the telemetry app and register with department &ldquo;{departmentName}&rdquo;
          to start tracking AI usage.
        </div>
        <a
          href="https://github.com/maico15/dashbord/releases/latest/download/cc_telemetry_tray.exe"
          style={{
            display: 'inline-block', padding: '8px 20px',
            background: 'var(--accent1)', color: '#fff',
            borderRadius: 8, textDecoration: 'none', fontSize: 13,
          }}
        >
          ⬇ Download Telemetry App
        </a>
      </div>
    )
  }
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
export default function AIUsageTab({ departmentId = 1, departmentName }) {
  const [week, setWeek]       = useState(null)
  const [year, setYear]       = useState(null)
  const [report, setReport]           = useState(null)
  const [browserData, setBrowserData] = useState(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)

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
    setBrowserData(null)
    const deptParam = departmentId ? `&department_id=${departmentId}` : ''
    api.get(`/ai-usage/weekly?week=${week}&year=${year}${deptParam}`)
      .then(d => { setReport(d); setLoading(false) })
      .catch(() => { setError('Failed to load AI usage data'); setLoading(false) })
    api.get(`/ai-usage/browser?week=${week}&year=${year}${deptParam}`)
      .then(d => setBrowserData(d))
      .catch(() => setBrowserData(null))
  }, [week, year, departmentId])

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, marginBottom: 20 }}>
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
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setError(null); setLoading(true); const dp = departmentId !== 1 ? `&department_id=${departmentId}` : ''; api.get(`/ai-usage/weekly?week=${week}&year=${year}${dp}`).then(d => { setReport(d); setLoading(false) }).catch(e => { setError('Failed to load AI usage data'); setLoading(false) }) }}>↺ Retry</button>
        </div>
      )}

      {!loading && !error && !hasData && <EmptyState week={week} departmentId={departmentId} departmentName={departmentName} />}

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
            <AICard
              label="Browser AI time"
              value={browserData?.total_minutes ? formatMinutes(browserData.total_minutes) : '—'}
              sub={`${browserData?.tools?.length || 0} tool${(browserData?.tools?.length || 0) !== 1 ? 's' : ''}`}
              color="#7b61ff"
            />
          </div>

          <DailyChart daily={report.daily || []} />
          <BrowserToolsSection data={browserData} />

          <div className="two-col" style={{ marginTop: 20 }}>
            <BottleneckBars
              title="Input tokens per engineer"
              rows={(report.engineers || []).map(e => ({
                name: e.name,
                value: Math.round((e.tokens_input || 0) / 1000),
                unit: 'K',
              })).filter(r => r.value > 0)}
              color={COLOR_INPUT}
            />
            <BottleneckBars
              title="Output tokens per engineer"
              rows={(report.engineers || []).map(e => ({
                name: e.name,
                value: Math.round((e.tokens_output || 0) / 1000),
                unit: 'K',
              })).filter(r => r.value > 0)}
              color={COLOR_OUTPUT}
            />
          </div>
        </>
      )}
    </>
  )
}
