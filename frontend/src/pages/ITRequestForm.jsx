import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import { I18N, readLang } from '../i18n/itRequests'
import { RequestsStyle, PageHead, Segmented, Chips } from './itRequestsStyle'

/* Public intake form — no password, no account. The reader leaves with a ref
 * and a link; everything after that happens on the status page. */

const KINDS = ['broken', 'change', 'access', 'data', 'question']
const SYSTEMS = ['apollo', 'passport', 'techapp', 'fos', 'websites', 'ghl_n8n', 'telephony', 'other']
const IMPACTS = ['blocked', 'daily', 'can_wait']
const CORPORATE_DOMAIN = 'homealliance.com'
const DRAFT_KEY = 'it_request_draft'

const EMPTY = {
  requester_email: '', requester_slack: '', department: '',
  kind: '', system: '', summary: '',
  current_workaround: '', business_value: '', impact: '',
  people_affected: '', desired_date: '', links: '',
}

export default function ITRequestForm() {
  // The public pages open in English: about half the requesters write in it.
  const [lang, setLang] = useState(() => readLang('en'))
  const t = I18N[lang]
  const navigate = useNavigate()

  // A half-written request survives a reload or a wrong tab — cleared only
  // once the server has actually taken it.
  const [form, setForm] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
      if (saved && typeof saved === 'object') return { ...EMPTY, ...saved }
    } catch { /* corrupt draft — start clean */ }
    return EMPTY
  })
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [done, setDone] = useState(null)   // {ref, status_url}
  const [lookup, setLookup] = useState('')

  useEffect(() => {
    try {
      // An empty form is not a draft — clear the key rather than storing a
      // blank object, so a successful submit leaves nothing behind.
      const hasContent = Object.values(form).some((v) => String(v || '').trim())
      if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
      else localStorage.removeItem(DRAFT_KEY)
    } catch { /* private mode */ }
  }, [form])

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e))
  }
  const onInput = (key) => (ev) => set(key)(ev.target.value)

  const validate = () => {
    const e = {}
    if (!form.requester_email.trim()) e.requester_email = t.form.errors.email
    if (!form.requester_slack.trim()) e.requester_slack = t.form.errors.slack
    if (!form.kind) e.kind = t.form.errors.kind
    if (!form.system) e.system = t.form.errors.system
    if (!form.summary.trim()) e.summary = t.form.errors.summary
    if (!form.impact) e.impact = t.form.errors.impact
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setSendError('')
    if (!validate()) return
    setSending(true)
    try {
      const res = await api.post('/it-requests', { ...form, lang })
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ }
      setForm(EMPTY)
      setDone(res)
    } catch (err) {
      const msg = String(err.message || '')
      setSendError(msg.includes('429') || msg.toLowerCase().includes('too many')
        ? t.form.errors.rate
        : `${t.form.errors.generic} ${msg}`.trim())
    } finally {
      setSending(false)
    }
  }

  // "IT-0001" goes to that request; anything with an @ is treated as an email.
  const goLookup = (ev) => {
    ev.preventDefault()
    const v = lookup.trim()
    if (!v) return
    if (v.includes('@')) navigate(`/it-requests/mine?email=${encodeURIComponent(v)}`)
    else navigate(`/it-requests/status/${encodeURIComponent(v.toUpperCase())}`)
  }

  const emailForeign = form.requester_email.includes('@')
    && !form.requester_email.trim().toLowerCase().endsWith(`@${CORPORATE_DOMAIN}`)

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main">
        <PageHead
          title={t.form.title}
          subtitle={done ? null : t.form.subtitle}
          lang={lang}
          onLang={setLang}
        />

        {done ? (
          <section className="itr-card itr-done" aria-live="polite">
            <div className="itr-done-check">✓</div>
            <h2 className="itr-done-title">{t.form.doneTitle}</h2>
            <div className="itr-done-ref">
              <span>{t.form.doneRef}</span>
              <b className="itr-mono">{done.ref}</b>
            </div>
            <p className="itr-done-slack">{t.form.doneSlack}</p>
            <div className="itr-actions">
              <Link className="itr-btn itr-btn-primary" to={`/it-requests/status/${done.ref}`}>
                {t.form.doneTrack}
              </Link>
              <button className="itr-btn" type="button" onClick={() => setDone(null)}>
                {t.form.doneAnother}
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit} noValidate>
            {/* ── who ── */}
            <section className="itr-card">
              <h2 className="itr-card-title">{t.form.groupWho}</h2>
              <div className="itr-row">
                <Field label={t.form.email} required t={t} error={errors.requester_email}
                  hint={emailForeign ? null : t.form.emailHint}
                  warn={emailForeign ? t.form.emailForeign : null}>
                  <input className={`itr-input${errors.requester_email ? ' itr-input-err' : ''}`}
                    type="email" value={form.requester_email} onChange={onInput('requester_email')}
                    placeholder={t.form.emailPlaceholder} autoComplete="email" />
                </Field>
                <Field label={t.form.slack} required t={t} error={errors.requester_slack}>
                  <input className={`itr-input${errors.requester_slack ? ' itr-input-err' : ''}`}
                    value={form.requester_slack} onChange={onInput('requester_slack')}
                    placeholder={t.form.slackPlaceholder} />
                </Field>
              </div>
              <Field label={t.form.department} t={t}>
                <input className="itr-input" value={form.department} onChange={onInput('department')}
                  placeholder={t.form.departmentPlaceholder} />
              </Field>
            </section>

            {/* ── what ── */}
            <section className="itr-card">
              <h2 className="itr-card-title">{t.form.groupWhat}</h2>
              <Field label={t.form.kind} required t={t} error={errors.kind}>
                <Segmented
                  name={t.form.kind}
                  value={form.kind}
                  onChange={set('kind')}
                  options={KINDS.map((k) => ({ value: k, label: t.kind[k] }))}
                />
              </Field>
              <Field label={t.form.system} required t={t} error={errors.system}>
                <Chips
                  value={form.system}
                  onChange={set('system')}
                  options={SYSTEMS.map((s) => ({ value: s, label: t.system[s] }))}
                />
              </Field>
              <Field label={t.form.summary} required t={t} error={errors.summary}>
                <textarea className={`itr-textarea${errors.summary ? ' itr-input-err' : ''}`}
                  value={form.summary} onChange={onInput('summary')}
                  placeholder={t.form.summaryPlaceholder} rows={4} />
              </Field>
              <Field label={t.form.workaround} t={t}>
                <textarea className="itr-textarea" value={form.current_workaround}
                  onChange={onInput('current_workaround')}
                  placeholder={t.form.workaroundPlaceholder} rows={2} />
              </Field>
            </section>

            {/* ── why and when ── */}
            <section className="itr-card">
              <h2 className="itr-card-title">{t.form.groupWhy}</h2>
              <Field label={t.form.value} t={t}>
                <textarea className="itr-textarea" value={form.business_value}
                  onChange={onInput('business_value')} placeholder={t.form.valuePlaceholder} rows={2} />
              </Field>
              <Field label={t.form.impact} required t={t} error={errors.impact}>
                <Segmented
                  name={t.form.impact}
                  value={form.impact}
                  onChange={set('impact')}
                  options={IMPACTS.map((i) => ({ value: i, label: t.impact[i] }))}
                />
              </Field>
              <div className="itr-row">
                <Field label={t.form.people} t={t}>
                  <input className="itr-input" value={form.people_affected}
                    onChange={onInput('people_affected')} placeholder={t.form.peoplePlaceholder} />
                </Field>
                <Field label={t.form.desired} t={t}>
                  <input className="itr-input" type="date" value={form.desired_date}
                    onChange={onInput('desired_date')} />
                </Field>
              </div>
              <Field label={t.form.links} t={t}>
                <input className="itr-input" value={form.links} onChange={onInput('links')}
                  placeholder={t.form.linksPlaceholder} />
              </Field>
            </section>

            {sendError && <div className="itr-card itr-send-err">{sendError}</div>}

            <div className="itr-actions itr-submit-row">
              <button className="itr-btn itr-btn-primary" type="submit" disabled={sending}>
                {sending ? t.form.submitting : t.form.submit}
              </button>
            </div>
          </form>
        )}

        {/* ── check an existing request ── */}
        <section className="itr-card itr-check">
          <h2 className="itr-card-title">{t.form.checkTitle}</h2>
          <form className="itr-actions" onSubmit={goLookup}>
            <input className="itr-input itr-check-input" value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder={t.form.checkPlaceholder} aria-label={t.form.checkTitle} />
            <button className="itr-btn" type="submit">{t.form.checkGo}</button>
          </form>
        </section>
      </main>
      <AppFooter lang={lang} />
      <style>{CSS}</style>
    </div>
  )
}

function Field({ label, required, t, error, hint, warn, children }) {
  return (
    <div className="itr-field">
      <label className="itr-label">
        {label}
        {required && <span className="itr-req">{t.form.required}</span>}
      </label>
      {children}
      {error && <div className="itr-err">{error}</div>}
      {warn && <div className="itr-warn">{warn}</div>}
      {hint && !error && <div className="itr-hint">{hint}</div>}
    </div>
  )
}

const CSS = `
.itr-submit-row{margin:4px 0 18px}
.itr-send-err{color:#C4241C;font-size:13.5px;padding:13px 16px}
[data-theme="dark"] .itr-send-err{color:#FF9A93}
.itr-check{background:transparent;box-shadow:none;padding:4px 0 0;border-top:0.5px solid var(--ios-sep,#E5E5EA);margin-top:6px}
.itr-check .itr-card-title{margin-top:14px}
.itr-check-input{max-width:260px}
.itr-done{text-align:left;border-top:3px solid var(--ios-green,#34C759)}
.itr-done-check{width:36px;height:36px;border-radius:50%;background:var(--ios-green-tint,#E3F6E8);
  color:var(--ios-green-text,#1E7A3A);display:flex;align-items:center;justify-content:center;
  font-size:19px;font-weight:700;margin-bottom:12px}
.itr-done-title{margin:0 0 10px;font-size:19px;font-weight:700;letter-spacing:-.2px}
.itr-done-ref{display:flex;align-items:baseline;gap:10px;font-size:13px;color:var(--ios-label2,#636366)}
.itr-done-ref b{font-size:20px;color:var(--ios-label,#1C1C1E)}
.itr-done-slack{margin:10px 0 16px;font-size:13.5px;color:var(--ios-label2,#636366)}
`
