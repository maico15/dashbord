import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { I18N, readLang } from '../i18n/itRequests'

/* Shared footer: every address in the dashboard in one place, plus whether the
 * backend answered. Rendered at the bottom of every route.
 *
 * `lang` comes from pages that carry an EN/RU toggle; the rest pass nothing and
 * get whatever language the reader last chose (the toggle's stored value), so
 * the footer never contradicts the interface above it. */
export default function AppFooter({ lang }) {
  const active = lang || readLang('en')
  const t = (I18N[active] || I18N.en).footer
  // null while the probe is in flight — the dot only turns green on a real answer.
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/overview')
      .then(() => { if (alive) setHealth(true) })
      .catch(() => { if (alive) setHealth(false) })
    return () => { alive = false }
  }, [])

  const groups = [
    {
      key: 'team',
      title: t.team,
      links: [
        { to: '/', label: t.dashboard },
        { to: '/team-gantt', label: t.gantt },
        { to: '/reports', label: t.reports },
        { to: '/review/latest', label: t.review },
      ],
    },
    {
      key: 'requests',
      title: t.requests,
      links: [
        { to: '/it-requests', label: t.submit },
        { to: '/it-requests/status', label: t.check },
        { to: '/it-requests/mine', label: t.mine },
      ],
    },
    {
      // Always listed, always muted: these pages ask for the password
      // themselves, so linking them costs nothing and hiding them only means
      // people paste URLs to each other instead.
      key: 'admin',
      title: t.admin,
      muted: true,
      links: [
        { to: '/it-backlog', label: t.backlog },
        { to: '/it-requests/admin', label: t.triage },
        { to: '/admin', label: t.adminPanel },
      ],
    },
  ]

  return (
    <footer className="appf">
      <div className="appf-groups">
        {groups.map((g) => (
          <div key={g.key} className={`appf-group${g.muted ? ' appf-group-muted' : ''}`}>
            <div className="appf-title">{g.title}</div>
            <ul className="appf-links">
              {g.links.map((l) => (
                <li key={l.to}><Link to={l.to}>{l.label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="appf-bottom">
        <span>{t.org}</span>
        <span className="appf-health">
          <i className={`appf-dot${health ? ' on' : ''}`} />
          {health ? t.healthOk : t.healthDown}
        </span>
      </div>
      <style>{CSS}</style>
    </footer>
  )
}

const CSS = `
.appf{flex:0 0 auto;font-family:var(--ios-font,-apple-system,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif);
  font-size:12px;color:var(--ios-label3,#6D6D72);background:transparent;
  padding:22px 20px 26px;border-top:0.5px solid var(--ios-sep,#E5E5EA);margin-top:auto}
.appf-groups{display:flex;gap:44px;flex-wrap:wrap;max-width:1200px;margin:0 auto}
.appf-group{min-width:150px}
.appf-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ios-label2,#636366);margin-bottom:7px}
.appf-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.appf-links a{color:var(--ios-label2,#636366);text-decoration:none}
.appf-links a:hover{color:var(--ios-blue-ink,#0A63D2)}
/* The admin group stays readable but visibly secondary. */
.appf-group-muted .appf-links a{color:var(--ios-label3,#6D6D72)}
.appf-bottom{display:flex;gap:14px;align-items:center;flex-wrap:wrap;max-width:1200px;
  margin:18px auto 0;padding-top:12px;border-top:0.5px solid var(--ios-sep,#E5E5EA)}
.appf-health{display:flex;align-items:center;gap:6px;margin-left:auto}
.appf-dot{width:7px;height:7px;border-radius:50%;background:var(--ios-fill3,#C7C7CC)}
.appf-dot.on{background:var(--ios-green,#34C759)}
@media(max-width:640px){
  .appf{padding:18px 16px 22px}
  .appf-groups{flex-direction:column;gap:18px}
  .appf-bottom{margin-top:14px}
  .appf-health{margin-left:0}
}
`
