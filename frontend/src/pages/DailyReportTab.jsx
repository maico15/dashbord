import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import LoadingSpinner from '../components/LoadingSpinner'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

function isoWeekDays(week, year) {
  const jan4 = new Date(year, 0, 4)
  const dow = jan4.getDay() || 7
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - (dow - 1))
  const monday = new Date(week1Mon)
  monday.setDate(week1Mon.getDate() + (week - 1) * 7)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function toYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayYMD() {
  return toYMD(new Date())
}

// ── Section within a report card ──────────────────────────────────────────────

function ReportSection({ icon, label, items, alwaysShow = false }) {
  if (!alwaysShow && (!items || items.length === 0)) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
        color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6,
      }}>
        {icon} {label}
      </div>
      {items && items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 4, listStyle: 'none' }}>
          {items.map((item, i) => (
            <li key={i} style={{
              fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
              paddingLeft: 14, position: 'relative',
            }}>
              <span style={{
                position: 'absolute', left: 0, color: 'var(--muted)',
              }}>•</span>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>—</span>
      )}
    </div>
  )
}

// ── Single engineer card ───────────────────────────────────────────────────────

function EngineerCard({ engineer, report }) {
  const initials = engineer.name.split(' ').slice(0, 2).map(w => w[0]).join('')
  const color = engineer.avatar_color || '#00cfff'

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 12 }}>
      {/* Header: avatar + name + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: report ? 16 : 0 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#080d1f',
          boxShadow: `0 0 0 3px ${color}33`,
        }}>
          {initials}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{engineer.name}</span>
          {report?.source === 'slack' && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: 'var(--card2)', color: 'var(--muted)',
              border: '1px solid var(--border)', fontWeight: 500,
            }}>
              via Slack
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      {!report ? (
        <div style={{
          paddingLeft: 58, fontSize: 13,
          color: 'var(--muted)', fontStyle: 'italic',
        }}>
          Отчёт не добавлен
        </div>
      ) : (
        <div style={{ paddingLeft: 58 }}>
          <ReportSection icon="✅" label="Выполнено"           items={report.completed}       alwaysShow />
          <ReportSection icon="🔵" label="Invisible work"      items={report.invisible_work} />
          <ReportSection icon="🟡" label="Далее"               items={report.next_tasks}      alwaysShow />
          <ReportSection icon="🔴" label="Блокеры / Риски"     items={report.delayed_risks} />
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DailyReportTab() {
  const [week, setWeek]         = useState(null)
  const [year, setYear]         = useState(null)
  const [weekDays, setWeekDays] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [reports, setReports]   = useState(null)
  const [loading, setLoading]   = useState(true)

  // Load overview once to get current ISO week
  useEffect(() => {
    api.get('/overview')
      .then(d => {
        const w = d.current_week || currentISOWeek()
        const y = d.current_year || new Date().getFullYear()
        setWeek(w)
        setYear(y)
      })
      .catch(() => {
        setWeek(currentISOWeek())
        setYear(new Date().getFullYear())
      })
  }, [])

  // When week/year resolves, compute Mon–Fri and pick default date
  useEffect(() => {
    if (!week || !year) return
    const days = isoWeekDays(week, year)
    setWeekDays(days)

    const today = todayYMD()
    const todayInWeek = days.find(d => toYMD(d) === today)
    const todayDow = new Date().getDay() // 0=Sun, 6=Sat
    if (todayInWeek) {
      setSelectedDate(today)
    } else if (todayDow === 0 || todayDow === 6) {
      // Weekend — default to Friday
      setSelectedDate(toYMD(days[4]))
    } else {
      // Outside current week — default to Friday
      setSelectedDate(toYMD(days[4]))
    }
  }, [week, year])

  // Load reports whenever selected date changes
  const fetchReports = useCallback((date) => {
    if (!date) return
    setLoading(true)
    setReports(null)
    api.get(`/reports?date=${date}`)
      .then(d => { setReports(d); setLoading(false) })
      .catch(e => { console.error(e); setLoading(false) })
  }, [])

  useEffect(() => {
    fetchReports(selectedDate)
  }, [selectedDate, fetchReports])

  const todayStr = todayYMD()

  return (
    <div style={{ marginTop: 16 }}>
      {/* Day-of-week navigation */}
      {weekDays.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {weekDays.map((d) => {
            const ymd = toYMD(d)
            const isFuture = ymd > todayStr
            const isActive = ymd === selectedDate
            const dowLabel = DAY_SHORT[d.getDay()]
            const dayNum   = String(d.getDate()).padStart(2, '0')
            return (
              <button
                key={ymd}
                disabled={isFuture}
                onClick={() => setSelectedDate(ymd)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: isActive
                    ? '1px solid var(--accent1)'
                    : '1px solid var(--border)',
                  background: isActive ? 'var(--accent1-bg)' : 'var(--card)',
                  color: isActive
                    ? 'var(--accent1)'
                    : isFuture ? 'var(--muted)' : 'var(--text)',
                  fontWeight: isActive ? 700 : 400,
                  fontSize: 13,
                  cursor: isFuture ? 'default' : 'pointer',
                  opacity: isFuture ? 0.45 : 1,
                  lineHeight: 1.3,
                  textAlign: 'center',
                  minWidth: 52,
                }}
              >
                <div>{dowLabel}</div>
                <div style={{ fontSize: 11, marginTop: 1 }}>{dayNum}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Content */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <LoadingSpinner />
        </div>
      )}

      {!loading && reports && (
        <div>
          {reports.map(({ engineer, report }) => (
            <EngineerCard key={engineer.id} engineer={engineer} report={report} />
          ))}
        </div>
      )}
    </div>
  )
}

function currentISOWeek() {
  const now = new Date()
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const dow = jan4.getDay() || 7
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - (dow - 1))
  const diff = now - week1Mon
  return Math.floor(diff / (7 * 86400000)) + 1
}
