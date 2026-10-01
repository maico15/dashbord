import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import { I18N, readLang, formatDate } from '../i18n/itRequests'
import { RequestsStyle, PageHead, StatusPill } from './itRequestsStyle'
import { useRequesterIdentity, identityName, normaliseSlack } from '../hooks/useRequesterIdentity'

/* The front door. Four addresses existed and none of them was the one to hand
 * someone — this is that one: /it-requests/home.
 *
 * It asks who you are once, then it is a list of your own requests with the
 * form on top. Identity comes from useRequesterIdentity and nowhere else, so
 * the day HA ID login lands this page keeps its shape. */

const CORPORATE_DOMAIN = 'homealliance.com'
const OPEN_STATUSES = ['new', 'accepted', 'in_progress', 'waiting_requester']
const RECENT_CLOSED = 3

export default function ITRequestsHome() {
  const [lang, setLang] = useState(() => readLang('en'))
  const t = I18N[lang]
  const { identity, ready, save, clear } = useRequesterIdentity()

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main">
        <PageHead
          title={t.home.title}
          // Greeted, not "signed in as": there is no session to sign into yet,
          // and saying otherwise would promise an account nobody has.
          subtitle={identity ? `${t.home.greeting}, ${identityName(identity)} · ${identity.email}` : undefined}
          lang={lang}
          onLang={setLang}
        />

        {!ready && <div className="itr-empty">{t.common.loading}</div>}
        {ready && !identity && <IdentityForm t={t} onSave={save} />}
        {ready && identity && (
          <>
            <NewRequestCard t={t} />
            <p className="ith-covers">
              {t.home.covers}
              <b>{t.home.outage}</b>
            </p>
            <MyRequests t={t} lang={lang} email={identity.email} />
            <LookupCard t={t} />
            <p className="ith-notyou">
              <button type="button" className="itr-link ith-linkbtn" onClick={clear}>{t.home.notYou}</button>
            </p>
          </>
        )}
      </main>
      <AppFooter lang={lang} />
      <style>{CSS}</style>
    </div>
  )
}

/* ---------------- first visit ---------------- */

function IdentityForm({ t, onSave }) {
  const [email, setEmail] = useState('')
  const [slack, setSlack] = useState('')
  const [errors, setErrors] = useState({})
  // Clear a field's error as soon as it is typed into: an error from an empty
  // submit otherwise sits there contradicting what is now on screen — and hides
  // the foreign-address note, which is the one thing worth reading here.
  const clearError = (key) => setErrors((e) => (e[key] ? { ...e, [key]: '' } : e))

  // Said, not enforced: contractors and agency people have other addresses, and
  // turning that into an error would just stop them asking for help.
  const foreign = email.includes('@')
    && !email.trim().toLowerCase().endsWith(`@${CORPORATE_DOMAIN}`)

  const submit = (ev) => {
    ev.preventDefault()
    const e = {}
    if (!email.trim()) e.email = t.home.emailError
    if (!slack.trim()) e.slack = t.home.slackError
    setErrors(e)
    if (Object.keys(e).length) return
    onSave({ email: email.trim(), slack })
  }

  return (
    <form className="itr-card" onSubmit={submit}>
      <h2 className="ith-card-title">{t.home.askTitle}</h2>
      <p className="ith-card-text">{t.home.askText}</p>
      <div className="itr-row">
        <label className="itr-field">
          <span className="itr-label">{t.home.email}</span>
          <input className={`itr-input${errors.email ? ' itr-input-err' : ''}`} type="email"
            value={email} onChange={(e) => { setEmail(e.target.value); clearError('email') }}
            placeholder={t.home.emailPlaceholder} autoFocus />
          {errors.email && <span className="itr-err">{errors.email}</span>}
          {!errors.email && foreign && <span className="itr-warn">{t.home.emailForeign}</span>}
        </label>
        <label className="itr-field">
          <span className="itr-label">{t.home.slack}</span>
          <input className={`itr-input${errors.slack ? ' itr-input-err' : ''}`}
            value={slack} onChange={(e) => { setSlack(e.target.value); clearError('slack') }}
            onBlur={() => setSlack((v) => normaliseSlack(v))}
            placeholder={t.home.slackPlaceholder} />
          {errors.slack && <span className="itr-err">{errors.slack}</span>}
        </label>
      </div>
      <div className="itr-actions ith-ask-actions">
        <button className="itr-btn itr-btn-primary" type="submit">{t.home.continue}</button>
      </div>
    </form>
  )
}

/* ---------------- the one thing most people came for ---------------- */

function NewRequestCard({ t }) {
  return (
    <Link className="itr-card ith-primary" to="/it-requests">
      <span className="ith-primary-main">
        <span className="ith-primary-title">{t.home.newTitle}</span>
        <span className="ith-primary-text">{t.home.newText}</span>
      </span>
      <span className="ith-primary-go" aria-hidden="true">›</span>
    </Link>
  )
}

/* ---------------- your own requests ---------------- */

function MyRequests({ t, lang, email }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setRows(null)
    setFailed(false)
    api.get(`/it-requests/by-email?email=${encodeURIComponent(email)}`)
      .then((d) => { if (alive) setRows(d.requests || []) })
      .catch(() => { if (alive) { setRows([]); setFailed(true) } })
    return () => { alive = false }
  }, [email])

  if (rows === null) return <div className="itr-empty">{t.common.loading}</div>
  if (failed) return <div className="itr-empty">{t.home.loadFailed}</div>

  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status))
  // Closed work stays visible for a moment — long enough to confirm a fix or
  // reopen it — then stops competing with what is still live.
  const closed = rows.filter((r) => !OPEN_STATUSES.includes(r.status)).slice(0, RECENT_CLOSED)

  if (!rows.length) {
    return <div className="itr-empty">{t.home.empty}</div>
  }

  return (
    <>
      {open.length > 0 && (
        <section className="itr-card ith-list">
          <h2 className="itr-card-title">{t.home.openTitle}</h2>
          {open.map((r) => <RequestRow key={r.id} r={r} t={t} lang={lang} />)}
        </section>
      )}
      {closed.length > 0 && (
        <section className="itr-card ith-list">
          <h2 className="itr-card-title">{t.home.doneTitle}</h2>
          {closed.map((r) => <RequestRow key={r.id} r={r} t={t} lang={lang} />)}
        </section>
      )}
      <p className="ith-all">
        <Link className="itr-link" to={`/it-requests/mine?email=${encodeURIComponent(email)}`}>
          {t.home.allRequests}
        </Link>
      </p>
    </>
  )
}

function RequestRow({ r, t, lang }) {
  return (
    <Link className="ith-row" to={`/it-requests/status/${r.ref}`}>
      <span className="itr-mono ith-row-ref">{r.ref}</span>
      <span className="ith-row-summary">{r.summary}</span>
      <span className="ith-row-date">{t.home.sent} {formatDate(r.created_at, lang)}</span>
      <StatusPill status={r.status} label={t.status[r.status]} />
    </Link>
  )
}

/* ---------------- someone else's ref, or a link that was lost ---------------- */

function LookupCard({ t }) {
  const navigate = useNavigate()
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')

  const submit = (ev) => {
    ev.preventDefault()
    const v = ref.trim().toUpperCase()
    if (!/^IT-?\d+$/.test(v)) { setError(t.home.lookupError); return }
    navigate(`/it-requests/status/${v.startsWith('IT-') ? v : v.replace('IT', 'IT-')}`)
  }

  return (
    <form className="itr-card" onSubmit={submit}>
      <h2 className="itr-card-title">{t.home.lookupTitle}</h2>
      <div className="itr-actions">
        <input className={`itr-input ith-lookup${error ? ' itr-input-err' : ''}`} value={ref}
          onChange={(e) => { setRef(e.target.value); setError('') }}
          placeholder={t.home.lookupPlaceholder} aria-label={t.home.lookupTitle} />
        <button className="itr-btn" type="submit">{t.home.lookupGo}</button>
      </div>
      {error && <div className="itr-err">{error}</div>}
    </form>
  )
}

const CSS = `
.ith-card-title{margin:0 0 6px;font-size:17px;font-weight:700;letter-spacing:-.2px}
.ith-card-text{margin:0 0 16px;font-size:13.5px;color:var(--ios-label2,#636366);max-width:56ch}
.ith-ask-actions{margin-top:4px}

/* The primary action is a card, not a button: on a phone it is the whole
 * width of the screen and impossible to miss. */
.ith-primary{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit}
.ith-primary:hover{background:var(--ios-blue-tint,#D6E6FF)}
.ith-primary-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.ith-primary-title{font-size:17px;font-weight:700;letter-spacing:-.2px;color:var(--ios-blue-ink,#0A63D2)}
.ith-primary-text{font-size:13.5px;color:var(--ios-label2,#636366)}
.ith-primary-go{flex:none;font-size:22px;line-height:1;color:var(--ios-label3,#6D6D72)}
.ith-covers{margin:-4px 0 14px;padding:0 4px;font-size:12px;color:var(--ios-label3,#6D6D72)}
.ith-covers b{display:block;font-weight:500;color:var(--ios-orange-text,#7A3E00);margin-top:3px}

.ith-list{padding:14px 10px 10px}
.ith-list .itr-card-title{padding:0 10px}
.ith-row{display:grid;grid-template-columns:74px 1fr 150px auto;gap:12px;align-items:center;
  padding:11px 10px;border-radius:10px;text-decoration:none;color:inherit}
.ith-row:hover{background:var(--ios-bg,#F2F2F7)}
.ith-row-ref{font-size:12.5px;color:var(--ios-label2,#636366)}
.ith-row-summary{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ith-row-date{font-size:12px;color:var(--ios-label3,#6D6D72);white-space:nowrap}
.ith-all{margin:-4px 0 16px;padding:0 4px;font-size:13px}
.ith-lookup{max-width:170px}

.ith-notyou{margin:18px 0 0;text-align:center;font-size:12.5px}
.ith-linkbtn{border:none;background:none;font-family:inherit;font-size:inherit;cursor:pointer;padding:0}

@media(max-width:640px){
  .ith-row{grid-template-columns:1fr auto;gap:5px 10px}
  .ith-row-summary{grid-column:1 / -1;white-space:normal}
  .ith-row-date{grid-column:1}
}
`
