import { Routes, Route, Navigate, Link } from 'react-router-dom'
import TeamGantt from './pages/TeamGantt'

/* Разделы переезжают по одному. Пока здесь только Гант; остальные шесть
 * (Daily Report, Weekly Report, Monthly Review, Trends, Проекты, IT request)
 * добавляются сюда строкой каждый, когда переносятся.
 *
 * Пока раздел не перенесён, ссылка на него из футера ведёт на заглушку —
 * она честно говорит, что страница ещё на старом дашборде, и даёт туда
 * перейти, а не показывает пустой экран. */

const OLD_DASHBOARD = 'https://dashbord-frontend-hb0m.onrender.com'

function NotMigrated() {
  const path = window.location.pathname
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 24, textAlign: 'center',
      fontFamily: 'Inter, system-ui, sans-serif', color: 'var(--ios-text, #e6e6e6)',
      background: 'var(--ios-bg, #0b0d10)',
    }}>
      <div style={{ maxWidth: 440 }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>🚧</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px' }}>
          Этот раздел ещё не перенесён
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.75, margin: '0 0 20px' }}>
          Страница <code>{path}</code> пока живёт на старом дашборде.
          Разделы переезжают по одному, Гант — первый.
        </p>
        <a
          href={`${OLD_DASHBOARD}${path}`}
          style={{
            display: 'inline-block', padding: '10px 18px', borderRadius: 10,
            background: 'var(--ios-accent, #0a84ff)', color: '#fff',
            textDecoration: 'none', fontSize: 14, fontWeight: 600,
          }}
        >
          Открыть на старом дашборде
        </a>
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <Link to="/team-gantt" style={{ color: 'var(--ios-accent, #0a84ff)' }}>
            ← к Ганту
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/team-gantt" replace />} />
      <Route path="/team-gantt" element={<TeamGantt />} />
      <Route path="*" element={<NotMigrated />} />
    </Routes>
  )
}
