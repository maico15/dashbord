import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import { I18N, readLang, fmt, formatDate, formatDateTime } from '../i18n/itRequests'
import { RequestsStyle, PageHead, StatusPill } from './itRequestsStyle'

/* Public status page. Reachable by ref alone — no login — because the person
 * who filed the request is often not the person chasing it. */

const STEPS = ['submitted', 'accepted', 'in_progress', 'done', 'confirmed']
// How far along the five steps each stored status sits.
const STEP_OF = {
  new: 0, accepted: 1, waiting_requester: 2, in_progress: 2, done: 3, rejected: 0,
}

export default function ITRequestStatus() {
  const { ref: refParam } = useParams()
  const navigate = useNavigate()
  const [lang, setLang] = useState(() => readLang('en'))
  const t = I18N[lang]

  const [data, setData] = useState(null)      // {request, events}
  const [loading, setLoading] = useState(!!refParam)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [reopenText, setReopenText] = useState('')
  const [busy, setBusy] = useState('')
  const [lookup, setLookup] = useState('')

  const load = useCallback(() => {
    if (!refParam) return
    setLoading(true)
    api.get(`/it-requests/ref/${encodeURIComponent(refParam)}`)
      .then((d) => { setData(d); setError('') })
      .catch(() => setError(t.statusPage.notFound))
      .finally(() => setLoading(false))
    // t is re-created per language; the message is read at call time either way.
  }, [refParam]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const act = async (kind) => {
    const body = kind === 'reopen' ? reopenText.trim()
      : kind === 'comment' ? comment.trim()
        : ''
    if ((kind === 'comment' || kind === 'reopen') && !body) return
    setBusy(kind)
    setError('')
    try {
      const res = await api.post(`/it-requests/ref/${encodeURIComponent(refParam)}/${kind}`, { body })
      setData((d) => ({
        request: res.request || d.request,
        events: res.events || d.events,
      }))
      if (kind === 'comment') setComment('')
      if (kind === 'reopen') setReopenText('')
      if (kind === 'confirm') load()
    } catch (err) {
      setError(String(err.message || ''))
    } finally {
      setBusy('')
    }
  }

  const goLookup = (ev) => {
    ev.preventDefault()
    const v = lookup.trim()
    if (!v) return
    if (v.includes('@')) navigate(`/it-requests/mine?email=${encodeURIComponent(v)}`)
    else navigate(`/it-requests/status/${encodeURIComponent(v.toUpperCase())}`)
  }

  // No ref in the URL (the footer's "check status" link) — ask for one.
  if (!refParam) {
    return (
      <div className="itr-page">
        <RequestsStyle />
        <main className="itr-main">
          <PageHead title={t.statusPage.lookupTitle} lang={lang} onLang={setLang} />
          <section className="itr-card">
            <form className="itr-actions" onSubmit={goLookup}>
              <input className="itr-input itr-lookup-input" value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder={t.statusPage.lookupPlaceholder} aria-label={t.statusPage.lookupTitle} />
              <button className="itr-btn itr-btn-primary" type="submit">{t.statusPage.lookupGo}</button>
            </form>
            <p className="itr-hint">
              <Link className="itr-link" to="/it-requests/mine">{t.statusPage.lookupByEmail}</Link>
            </p>
          </section>
        </main>
        <AppFooter lang={lang} />
        <style>{CSS}</style>
      </div>
    )
  }

  const req = data && data.request
  const events = (data && data.events) || []
  const rejected = req && req.status === 'rejected'
  const currentStep = req ? STEP_OF[req.status] ?? 0 : 0
  const reachedStep = req && req.confirmed_at ? 4 : currentStep
  const thread = events.filter((e) => ['reply', 'comment', 'reopen', 'confirm'].includes(e.kind))

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main">
        <PageHead
          title={`${t.statusPage.title} ${refParam.toUpperCase()}`}
          lang={lang}
          onLang={setLang}
        />

        {loading && <div className="itr-empty">{t.common.loading}</div>}
        {!loading && !req && <div className="itr-card itr-empty">{error || t.statusPage.notFound}</div>}

        {req && (
          <>
            {/* ── progress ── */}
            <section className="itr-card">
              {rejected ? (
                <div className="itr-rejected">
                  <StatusPill status="rejected" label={t.status.rejected} />
                  {req.reject_reason && (
                    <p className="itr-rejected-why">
                      <b>{t.statusPage.rejectedReason}:</b> {req.reject_reason}
                    </p>
                  )}
                </div>
              ) : (
                <ol className="itr-steps">
                  {STEPS.map((s, i) => (
                    <li key={s} className={`itr-step${i <= reachedStep ? ' on' : ''}${i === reachedStep ? ' now' : ''}`}>
                      <span className="itr-step-dot" />
                      <span className="itr-step-label">{t.steps[s]}</span>
                    </li>
                  ))}
                </ol>
              )}
              {/* Phone: five labels do not fit side by side, so the bar keeps
                * the dots and names only where the request has got to. */}
              {!rejected && (
                <div className="itr-step-current">{t.steps[STEPS[reachedStep]]}</div>
              )}

              <div className="itr-meta itr-status-meta">
                <span><StatusPill status={req.status} label={t.status[req.status]} /></span>
                <span>{t.statusPage.owner}: <b>{req.owner || t.statusPage.unassigned}</b></span>
                <span>{t.statusPage.due}: <b>{req.due_date ? formatDate(req.due_date, lang) : t.statusPage.none}</b></span>
                <span>{t.statusPage.priority}: <b>{req.priority || t.statusPage.none}</b></span>
              </div>

              {req.confirmed_at && (
                <p className="itr-note itr-note-ok">
                  {fmt(t.statusPage.confirmed, { date: formatDate(req.confirmed_at, lang) })}
                </p>
              )}
              {!req.confirmed_at && Number(req.auto_closed) === 1 && (
                <p className="itr-note">{t.statusPage.autoClosed}</p>
              )}
            </section>

            {/* ── what the requester wrote ── */}
            <section className="itr-card">
              <h2 className="itr-card-title">{t.statusPage.yourRequest}</h2>
              <p className="itr-summary">{req.summary}</p>
              <dl className="itr-facts">
                <Fact label={t.statusPage.fields.created} value={formatDateTime(req.created_at, lang)} />
                <Fact label={t.statusPage.fields.kind} value={t.kind[req.kind]} />
                <Fact label={t.statusPage.fields.system} value={t.system[req.system]} />
                <Fact label={t.statusPage.fields.impact} value={t.impact[req.impact]} />
                <Fact label={t.statusPage.fields.department} value={req.department} />
                <Fact label={t.statusPage.fields.workaround} value={req.current_workaround} />
                <Fact label={t.statusPage.fields.value} value={req.business_value} />
                <Fact label={t.statusPage.fields.people} value={req.people_affected} />
                <Fact label={t.statusPage.fields.desired}
                  value={req.desired_date ? formatDate(req.desired_date, lang) : ''} />
                <Fact label={t.statusPage.fields.links} value={req.links} />
              </dl>
            </section>

            {/* ── conversation ── */}
            <section className="itr-card">
              <h2 className="itr-card-title">{t.statusPage.itResponse}</h2>
              {thread.length === 0 && <p className="itr-hint">{t.statusPage.noResponse}</p>}
              {thread.map((e) => (
                <div key={e.id} className={`itr-msg itr-msg-${e.actor}`}>
                  <div className="itr-msg-head">
                    <b>{t.statusPage.actor[e.actor] || e.actor}</b>
                    <span>{formatDateTime(e.created_at, lang)}</span>
                  </div>
                  {/* The requester's and IT's own words, shown exactly as typed. */}
                  <div className="itr-msg-body">{e.body || t.statusPage.event[e.kind]}</div>
                </div>
              ))}

              <div className="itr-field itr-comment">
                <label className="itr-label">{t.statusPage.commentTitle}</label>
                <textarea className="itr-textarea" rows={2} value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t.statusPage.commentPlaceholder} />
                <div className="itr-actions itr-comment-actions">
                  <button className="itr-btn" type="button"
                    disabled={!comment.trim() || busy === 'comment'}
                    onClick={() => act('comment')}>
                    {t.statusPage.commentSend}
                  </button>
                </div>
              </div>

              {req.status === 'done' && !req.confirmed_at && (
                <div className="itr-confirm">
                  <div className="itr-label">{t.statusPage.confirmTitle}</div>
                  <div className="itr-actions">
                    <button className="itr-btn itr-btn-green" type="button"
                      disabled={busy === 'confirm'} onClick={() => act('confirm')}>
                      {t.statusPage.confirm}
                    </button>
                  </div>
                  <textarea className="itr-textarea itr-reopen-text" rows={2} value={reopenText}
                    onChange={(e) => setReopenText(e.target.value)}
                    placeholder={t.statusPage.reopenPlaceholder} />
                  <div className="itr-actions">
                    <button className="itr-btn itr-btn-danger" type="button"
                      disabled={!reopenText.trim() || busy === 'reopen'}
                      onClick={() => act('reopen')}>
                      {t.statusPage.reopen}
                    </button>
                  </div>
                </div>
              )}
              {error && <div className="itr-err">{error}</div>}
            </section>

            {/* ── full log ── */}
            <section className="itr-card">
              <h2 className="itr-card-title">{t.statusPage.log}</h2>
              <ul className="itr-log">
                {/* 'notify' rows say whether Slack accepted the message. They
                  * matter to IT (and stay on the triage page), but to the
                  * requester they are noise between the real events. */}
                {events.filter((e) => e.kind !== 'notify').map((e) => (
                  <li key={e.id}>
                    <span className="itr-log-time">{formatDateTime(e.created_at, lang)}</span>
                    <span className="itr-log-text">
                      {e.kind === 'status'
                        ? fmt(t.statusPage.event.status, {
                          from: t.status[e.from_status] || e.from_status,
                          to: t.status[e.to_status] || e.to_status,
                        })
                        : t.statusPage.event[e.kind] || e.kind}
                      {e.body && e.kind !== 'reply' && e.kind !== 'comment' && (
                        <span className="itr-log-body"> · {e.body}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
      <AppFooter lang={lang} />
      <style>{CSS}</style>
    </div>
  )
}

function Fact({ label, value }) {
  if (!value) return null
  return (
    <div className="itr-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

const CSS = `
.itr-lookup-input{max-width:220px}

.itr-steps{list-style:none;display:flex;margin:0 0 16px;padding:0;gap:0}
.itr-step{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;
  font-size:12px;color:var(--ios-label3,#6D6D72);text-align:center}
/* The connector is drawn by each step except the first, so it always spans
 * exactly the gap between two dots whatever the column widths do. */
.itr-step::before{content:"";position:absolute;top:6px;right:50%;left:-50%;height:2px;
  background:var(--ios-sep,#E5E5EA)}
.itr-step:first-child::before{display:none}
.itr-step.on::before{background:var(--ios-blue,#007AFF)}
.itr-step-dot{position:relative;width:13px;height:13px;border-radius:50%;
  background:var(--ios-sep,#E5E5EA);z-index:1}
.itr-step.on .itr-step-dot{background:var(--ios-blue,#007AFF)}
.itr-step.now .itr-step-dot{box-shadow:0 0 0 4px var(--ios-blue-tint,#D6E6FF)}
.itr-step.on .itr-step-label{color:var(--ios-label,#1C1C1E);font-weight:600}

.itr-status-meta{padding-top:4px}
.itr-rejected{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;
  border-left:3px solid #FF3B30;padding-left:12px}
.itr-rejected-why{margin:0;font-size:13.5px}
.itr-note{margin:12px 0 0;font-size:13px;color:var(--ios-label2,#636366)}
.itr-note-ok{color:var(--ios-green-text,#1E7A3A)}

.itr-summary{margin:0 0 14px;font-size:15px;line-height:1.5;white-space:pre-wrap}
.itr-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:11px 20px;margin:0}

.itr-msg{border-radius:10px;padding:10px 12px;margin-bottom:9px;background:var(--ios-bg,#F2F2F7)}
.itr-msg-it{background:var(--ios-blue-tint,#D6E6FF)}
.itr-msg-head{display:flex;gap:10px;align-items:baseline;font-size:11.5px;
  color:var(--ios-label2,#636366);margin-bottom:4px}
.itr-msg-it .itr-msg-head{color:var(--ios-blue-text,#0A3D91)}
.itr-msg-body{font-size:13.5px;white-space:pre-wrap}
.itr-msg-it .itr-msg-body{color:var(--ios-blue-text,#0A3D91)}
.itr-comment{margin-top:16px}
.itr-comment-actions{margin-top:8px}
.itr-confirm{margin-top:18px;padding-top:14px;border-top:0.5px solid var(--ios-sep,#E5E5EA);
  display:flex;flex-direction:column;gap:10px}
.itr-reopen-text{margin-top:4px}

.itr-step-current{display:none}
@media(max-width:640px){
  .itr-step-label{display:none}
  .itr-step-current{display:block;margin:-6px 0 14px;text-align:center;font-size:13px;
    font-weight:600;color:var(--ios-label,#1C1C1E)}
}
`
