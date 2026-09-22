import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import { I18N, readLang, formatDate } from '../i18n/itRequests'
import { RequestsStyle, PageHead, StatusPill } from './itRequestsStyle'

/* Everything one address has sent. Public like the status page: the email in
 * the URL is the key, and it is the requester's own. */
export default function ITRequestsMine() {
  const [params, setParams] = useSearchParams()
  const [lang, setLang] = useState(() => readLang('en'))
  const t = I18N[lang]

  const emailParam = params.get('email') || ''
  const [email, setEmail] = useState(emailParam)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback((value) => {
    if (!value) { setRows(null); return }
    setLoading(true)
    api.get(`/it-requests/by-email?email=${encodeURIComponent(value)}`)
      .then((d) => setRows(d.requests || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { setEmail(emailParam); load(emailParam) }, [emailParam, load])

  const submit = (ev) => {
    ev.preventDefault()
    const v = email.trim()
    // Through the URL, so the list is a link the reader can keep.
    setParams(v ? { email: v } : {})
  }

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main">
        <PageHead title={t.mine.title} lang={lang} onLang={setLang} />

        <section className="itr-card">
          <form className="itr-actions" onSubmit={submit}>
            <input className="itr-input itr-mine-input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.mine.emailPlaceholder} aria-label={t.mine.emailPlaceholder} />
            <button className="itr-btn itr-btn-primary" type="submit">{t.mine.load}</button>
            <Link className="itr-btn" to="/it-requests">{t.mine.newRequest}</Link>
          </form>
        </section>

        {loading && <div className="itr-empty">{t.common.loading}</div>}
        {!loading && rows === null && <div className="itr-empty">{t.mine.prompt}</div>}
        {!loading && rows && rows.length === 0 && <div className="itr-empty">{t.mine.empty}</div>}

        {!loading && rows && rows.length > 0 && (
          <section className="itr-card itr-mine-list">
            {rows.map((r) => (
              <Link key={r.id} className="itr-mine-row" to={`/it-requests/status/${r.ref}`}>
                <span className="itr-mono itr-mine-ref">{r.ref}</span>
                <span className="itr-mine-summary">{r.summary}</span>
                <span className="itr-mine-sys">{t.system[r.system]}</span>
                <span className="itr-mine-date">{t.mine.sent} {formatDate(r.created_at, lang)}</span>
                <StatusPill status={r.status} label={t.status[r.status]} />
              </Link>
            ))}
          </section>
        )}
      </main>
      <AppFooter lang={lang} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.itr-mine-input{max-width:280px}
.itr-mine-list{padding:6px 8px}
.itr-mine-row{display:grid;grid-template-columns:78px 1fr 110px 150px auto;gap:12px;align-items:center;
  padding:11px 12px;border-radius:10px;text-decoration:none;color:inherit}
.itr-mine-row:hover{background:var(--ios-bg,#F2F2F7)}
.itr-mine-ref{font-size:12.5px;color:var(--ios-label2,#636366)}
.itr-mine-summary{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.itr-mine-sys,.itr-mine-date{font-size:12px;color:var(--ios-label3,#6D6D72);white-space:nowrap}
@media(max-width:640px){
  .itr-mine-row{grid-template-columns:1fr auto;gap:5px 10px}
  .itr-mine-summary{grid-column:1 / -1;white-space:normal}
  .itr-mine-sys{grid-column:1}
  .itr-mine-date{grid-column:1}
}
`
