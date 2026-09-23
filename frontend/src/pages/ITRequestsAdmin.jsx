import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import PasswordField from '../components/PasswordField'
import Combobox from '../components/Combobox'
import CreateGanttTaskModal from '../components/CreateGanttTaskModal'
import { I18N, readLang, fmt, formatDate, formatDateTime, withZone } from '../i18n/itRequests'
import { RequestsStyle, PageHead, Segmented, StatusPill } from './itRequestsStyle'

/* Triage. Password-gated with the same sessionStorage.admin_pw pattern as
 * /it-backlog, and deliberately not linked from the tab bar — the footer's
 * Admin group and the direct URL are the ways in. */

const QUEUES = ['new', 'accepted', 'in_progress', 'waiting_requester', 'closed']
const STATUSES = ['new', 'accepted', 'in_progress', 'waiting_requester', 'done', 'rejected']
const SYSTEMS = ['apollo', 'passport', 'techapp', 'fos', 'websites', 'ghl_n8n', 'telephony', 'other']

export default function ITRequestsAdmin() {
  // Triage opens in Russian — it is the IT team's working language.
  const [lang, setLang] = useState(() => readLang('ru'))
  const t = I18N[lang]

  const [pw, setPw] = useState(() => sessionStorage.getItem('admin_pw') || '')
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')

  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  // The owner picker searches this list client-side — it is ~10 people, and a
  // round trip per keystroke would be slower than the typing.
  const [team, setTeam] = useState([])
  const [queue, setQueue] = useState('new')
  const [system, setSystem] = useState('')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)   // {request, events}
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!pw) return
    api.get(`/it-requests?password=${encodeURIComponent(pw)}`)
      .then((d) => { setRows(d.requests || []); setError('') })
      .catch((e) => {
        if (String(e.message || '').includes('Unauthorized')) {
          sessionStorage.removeItem('admin_pw')
          setPw('')
        } else setError(String(e.message || ''))
      })
    api.get(`/it-requests/stats?password=${encodeURIComponent(pw)}`)
      .then(setStats)
      .catch(() => setStats(null))
  }, [pw])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.get('/team').then((d) => setTeam(Array.isArray(d) ? d : (d.members || [])))
      .catch(() => setTeam([]))
  }, [])

  // The detail panel reads the full record — the list row carries everything
  // already, but the events only come with the by-ref read.
  useEffect(() => {
    if (selectedId == null) { setDetail(null); return }
    const row = rows.find((r) => r.id === selectedId)
    if (!row) return
    api.get(`/it-requests/ref/${encodeURIComponent(row.ref)}`)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedId, rows])

  const login = async (ev) => {
    ev.preventDefault()
    setPwError('')
    try {
      await api.post(`/admin/verify?password=${encodeURIComponent(pwInput)}`, {})
      sessionStorage.setItem('admin_pw', pwInput)
      setPw(pwInput)
      setPwInput('')
    } catch {
      setPwError(t.admin.passwordWrong)
    }
  }

  const visible = useMemo(() => rows.filter((r) => {
    const inQueue = queue === 'closed'
      ? (r.status === 'done' || r.status === 'rejected')
      : r.status === queue
    const text = `${r.ref} ${r.summary} ${r.requester_email}`.toLowerCase()
    return inQueue
      && (!system || r.system === system)
      && (!q.trim() || text.includes(q.trim().toLowerCase()))
  }), [rows, queue, system, q])

  const counts = useMemo(() => {
    const out = {}
    for (const s of QUEUES) {
      out[s] = rows.filter((r) => (s === 'closed'
        ? (r.status === 'done' || r.status === 'rejected')
        : r.status === s)).length
    }
    return out
  }, [rows])

  const applied = (updated) => {
    setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)))
  }

  if (!pw) {
    return (
      <div className="itr-page">
        <RequestsStyle />
        <main className="itr-main">
          <PageHead title={t.admin.title} lang={lang} onLang={setLang} />
          <section className="itr-card itr-login">
            <h2 className="itr-card-title">{t.admin.passwordTitle}</h2>
            <p className="itr-hint itr-login-hint">{t.admin.passwordHint}</p>
            <form className="itr-actions" onSubmit={login}>
              <PasswordField
                className="itr-login-field"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder={t.common.password}
                autoFocus
                labels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
              />
              <button className="itr-btn itr-btn-primary" type="submit">{t.admin.passwordSubmit}</button>
            </form>
            {pwError && <div className="itr-err">{pwError}</div>}
          </section>
        </main>
        <AppFooter lang={lang} />
        <style>{CSS}</style>
      </div>
    )
  }

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main itr-main-wide">
        <PageHead title={t.admin.title} lang={lang} onLang={setLang} />

        <section className="itr-kpis">
          <Kpi label={t.admin.kpiNew} value={stats ? stats.new_count : '—'} />
          <Kpi label={t.admin.kpiOverdue} value={stats ? stats.overdue_response_count : '—'}
            warn={!!(stats && stats.overdue_response_count)} />
          <Kpi label={t.admin.kpiAccept}
            value={stats && stats.avg_hours_to_accept_30d != null
              ? `${stats.avg_hours_to_accept_30d} ${t.admin.hours}` : '—'} />
          <Kpi label={t.admin.kpiCreated} value={stats ? stats.created_30d : '—'} />
        </section>

        {stats && stats.by_owner && stats.by_owner.some((b) => b.open || b.closed_30d) && (
          <section className="itr-card itr-load">
            <h2 className="itr-card-title">{t.admin.load}</h2>
            <div className="itr-load-rows">
              {stats.by_owner.filter((b) => b.open || b.closed_30d).map((b) => (
                <span key={b.engineer_id ?? b.name} className="itr-load-row">
                  <i className="itr-owner-dot"
                    style={{ background: b.color || 'var(--ios-fill3,#C7C7CC)' }} />
                  <b>{b.name}</b>
                  <span className="itr-load-open">{b.open} {t.admin.loadOpen}</span>
                  <span className="itr-load-closed">{b.closed_30d} {t.admin.loadClosed}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {error && <div className="itr-card itr-err">{error}</div>}

        <div className="itr-admin-grid">
          {/* ── queue ── */}
          <section className="itr-card itr-queue">
            <Segmented
              name={t.admin.filterAll}
              value={queue}
              onChange={setQueue}
              options={QUEUES.map((s) => ({
                value: s,
                label: `${s === 'closed' ? t.admin.filterClosed : t.status[s]} ${counts[s] || 0}`,
              }))}
            />
            <div className="itr-queue-filters">
              <select className="itr-select" value={system} onChange={(e) => setSystem(e.target.value)}
                aria-label={t.admin.systemAll}>
                <option value="">{t.admin.systemAll}</option>
                {SYSTEMS.map((s) => <option key={s} value={s}>{t.system[s]}</option>)}
              </select>
              <input className="itr-input" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t.admin.searchPlaceholder} aria-label={t.admin.searchPlaceholder} />
            </div>

            {visible.length === 0 && <div className="itr-empty">{t.admin.empty}</div>}
            {visible.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`itr-qrow${selectedId === r.id ? ' on' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span className={`itr-impact itr-impact-${r.impact}`} title={t.impactShort[r.impact]} />
                <span className="itr-qrow-main">
                  <span className="itr-qrow-title">{r.summary}</span>
                  <span className="itr-qrow-tags">
                    <span className="itr-tag">{t.system[r.system]}</span>
                    <span className="itr-tag">{t.kind[r.kind]}</span>
                    {r.owner_name && (
                      <span className="itr-qrow-owner">
                        <i className="itr-owner-dot"
                          style={{ background: r.owner_color || 'var(--ios-fill3,#C7C7CC)' }} />
                        {r.owner_name}
                      </span>
                    )}
                    <span className="itr-qrow-email">{r.requester_email}</span>
                  </span>
                </span>
                <Age request={r} t={t} />
              </button>
            ))}
          </section>

          {/* ── detail ── */}
          <section className="itr-card itr-detail">
            {!detail && <div className="itr-empty">{t.admin.pickOne}</div>}
            {detail && (
              <Detail
                key={detail.request.id}
                data={detail}
                lang={lang}
                t={t}
                pw={pw}
                team={team}
                onApplied={(res) => { applied(res.request); setDetail(res); load() }}
              />
            )}
          </section>
        </div>
      </main>
      <AppFooter lang={lang} />
      <style>{CSS}</style>
    </div>
  )
}

function Kpi({ label, value, warn }) {
  return (
    <div className={`itr-kpi${warn ? ' warn' : ''}`}>
      <div className="itr-kpi-value">{value}</div>
      <div className="itr-kpi-label">{label}</div>
    </div>
  )
}

/** Hours since arrival — red and bold once a new request passes 24 h. */
function Age({ request, t }) {
  const created = new Date(withZone(request.created_at))
  const hours = (Date.now() - created.getTime()) / 3600000
  const late = request.status === 'new' && hours > 24
  const text = hours < 1 ? t.admin.age.now
    : hours < 48 ? fmt(t.admin.age.hours, { n: Math.round(hours) })
      : fmt(t.admin.age.days, { n: Math.round(hours / 24) })
  return <span className={`itr-age${late ? ' late' : ''}`}>{text}</span>
}

function Detail({ data, lang, t, pw, team, onApplied }) {
  const req = data.request
  const [form, setForm] = useState({
    status: req.status,
    owner_engineer_id: req.owner_engineer_id ?? null,
    owner_external: req.owner_external || '',
    priority: req.priority || '',
    due_date: req.due_date || '',
    estimate: req.estimate || '',
    gantt_id: req.gantt_id == null ? '' : String(req.gantt_id),
    backlog_id: req.backlog_id == null ? '' : String(req.backlog_id),
  })
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState(req.reject_reason || '')
  const [linked, setLinked] = useState({ gantt: null, backlog: null, ganttDone: false })

  // owner picker
  const [ownerQuery, setOwnerQuery] = useState('')
  const [ownerExternalMode, setOwnerExternalMode] = useState(!!req.owner_external)
  // link picker
  const [linkQuery, setLinkQuery] = useState('')
  const [linkResults, setLinkResults] = useState([])
  const [creating, setCreating] = useState(false)

  const set = (key) => (ev) => {
    setForm((f) => ({ ...f, [key]: ev.target ? ev.target.value : ev }))
    setSaved(false)
  }

  const ownerEngineer = team.find((m) => m.id === form.owner_engineer_id) || null

  // Titles for whatever this request is linked to, read from the boards' own
  // APIs so a renamed task never shows a stale name here. The Gantt task's own
  // state comes with it — that is what the "finished" banner watches.
  useEffect(() => {
    let alive = true
    if (form.gantt_id) {
      api.get('/gantt').then((d) => {
        if (!alive) return
        const all = (d.engineers || []).flatMap((e) => e.assignments || [])
        const hit = all.find((a) => String(a.id) === String(form.gantt_id))
        setLinked((l) => ({
          ...l,
          gantt: hit ? hit.project : null,
          ganttDone: !!hit && (hit.status === 'done' || Number(hit.percent) >= 100),
        }))
      }).catch(() => {})
    } else setLinked((l) => ({ ...l, gantt: null, ganttDone: false }))
    if (form.backlog_id) {
      api.get('/it-backlog').then((d) => {
        if (!alive) return
        const hit = (d.items || []).find((i) => String(i.id) === String(form.backlog_id))
        setLinked((l) => ({ ...l, backlog: hit ? hit.title : null }))
      }).catch(() => {})
    } else setLinked((l) => ({ ...l, backlog: null }))
    return () => { alive = false }
  }, [form.gantt_id, form.backlog_id])

  // Task search, debounced. An empty box still asks: the endpoint answers with
  // the most recent tasks, which is a useful starting list.
  useEffect(() => {
    let alive = true
    const handle = setTimeout(() => {
      api.get(`/search/tasks?password=${encodeURIComponent(pw)}&q=${encodeURIComponent(linkQuery)}&limit=10`)
        .then((d) => { if (alive) setLinkResults(d.results || []) })
        .catch(() => { if (alive) setLinkResults([]) })
    }, 180)
    return () => { alive = false; clearTimeout(handle) }
  }, [linkQuery, pw])

  /* The duplicate hint the backend logged when the request arrived — worth
   * offering before anything is typed, since it is usually the right link. */
  const suggestion = useMemo(() => {
    const ev = (data.events || []).find(
      (e) => e.kind === 'system' && String(e.body || '').includes('Possible duplicate')
    )
    if (!ev) return null
    const m = String(ev.body).match(/(gantt|backlog)\s+#(\d+):\s*(.+)$/i)
    return m ? { source: m[1].toLowerCase(), id: Number(m[2]), title: m[3].trim() } : null
  }, [data.events])

  const save = async (patch) => {
    setSaving(true)
    setErr('')
    try {
      const res = await api.patch(`/it-requests/${req.id}`, patch || form, pw)
      if (reply.trim()) {
        const withReply = await api.post(`/it-requests/${req.id}/reply`, { body: reply.trim() }, pw)
        res.events = withReply.events
        setReply('')
      }
      setSaved(true)
      onApplied(res)
    } catch (e) {
      setErr(String(e.message || ''))
    } finally {
      setSaving(false)
    }
  }

  const doReject = async () => {
    if (!rejectReason.trim()) return
    await save({ ...form, status: 'rejected', reject_reason: rejectReason.trim() })
    setRejecting(false)
  }

  return (
    <div className="itr-detail-inner">
      <div className="itr-detail-head">
        <span className="itr-mono">{req.ref}</span>
        <StatusPill status={req.status} label={t.status[req.status]} />
        <span className={`itr-impact itr-impact-${req.impact}`} />
        <span className="itr-detail-impact">{t.impactShort[req.impact]}</span>
      </div>
      <h2 className="itr-detail-title">{req.summary}</h2>

      <div className="itr-detail-facts">
        <Fact label={t.admin.requester} value={`${req.requester_email} · ${req.requester_slack}`} />
        <Fact label={t.statusPage.fields.created} value={formatDateTime(req.created_at, lang)} />
        <Fact label={t.statusPage.fields.kind} value={t.kind[req.kind]} />
        <Fact label={t.statusPage.fields.system} value={t.system[req.system]} />
        <Fact label={t.statusPage.fields.department} value={req.department} />
        <Fact label={t.statusPage.fields.workaround} value={req.current_workaround} />
        <Fact label={t.statusPage.fields.value} value={req.business_value} />
        <Fact label={t.statusPage.fields.people} value={req.people_affected} />
        <Fact label={t.statusPage.fields.desired}
          value={req.desired_date ? formatDate(req.desired_date, lang) : ''} />
        <Fact label={t.statusPage.fields.links} value={req.links} />
      </div>

      <h3 className="itr-card-title itr-triage-title">{t.admin.triage}</h3>
      <div className="itr-chips itr-status-chips">
        {STATUSES.map((s) => (
          <button key={s} type="button"
            className={`itr-chip${form.status === s ? ' on' : ''}`}
            onClick={() => { setForm((f) => ({ ...f, status: s })); setSaved(false) }}>
            {t.status[s]}
          </button>
        ))}
      </div>

      <div className="itr-row itr-triage-row">
        <div className="itr-linkfield">
          <span className="itr-linklabel">{t.admin.ownerLabel}</span>
          {ownerExternalMode && !form.owner_engineer_id ? (
            <>
              <input className="itr-input" value={form.owner_external}
                onChange={(e) => { set('owner_external')(e); }}
                placeholder={t.admin.ownerExternal} autoFocus />
              <span className="itr-hint">{t.admin.ownerExternalHint}</span>
            </>
          ) : (
            <Combobox
              value={ownerEngineer
                ? { label: ownerEngineer.name, sublabel: ownerEngineer.position || '',
                    color: ownerEngineer.avatar_color }
                : (form.owner_external ? { label: form.owner_external, sublabel: '' } : null)}
              query={ownerQuery}
              onQuery={setOwnerQuery}
              placeholder={t.admin.ownerSearch}
              emptyText={t.admin.ownerNoMatch}
              options={team
                .filter((m) => m.name.toLowerCase().includes(ownerQuery.trim().toLowerCase()))
                .map((m) => ({
                  key: `eng-${m.id}`, id: m.id, label: m.name,
                  sublabel: m.position || '', color: m.avatar_color,
                }))}
              footer={{
                label: t.admin.ownerOutside,
                onSelect: () => {
                  setOwnerExternalMode(true)
                  setForm((f) => ({ ...f, owner_engineer_id: null, owner_external: '' }))
                  setSaved(false)
                },
              }}
              onSelect={(row) => {
                setOwnerExternalMode(false)
                setOwnerQuery('')
                setForm((f) => ({ ...f, owner_engineer_id: row.id, owner_external: '' }))
                setSaved(false)
              }}
              onClear={() => {
                setOwnerExternalMode(false)
                setForm((f) => ({ ...f, owner_engineer_id: null, owner_external: '' }))
                setSaved(false)
              }}
            />
          )}
        </div>
        <div className="itr-linkfield">
          <span className="itr-linklabel">{t.statusPage.priority}</span>
          <input className="itr-input" value={form.priority} onChange={set('priority')}
            placeholder={t.admin.priorityPlaceholder} aria-label={t.statusPage.priority} />
        </div>
      </div>
      <div className="itr-row itr-triage-row">
        <div className="itr-linkfield">
          <span className="itr-linklabel">{t.statusPage.due}</span>
          <input className="itr-input" value={form.due_date} onChange={set('due_date')}
            placeholder={t.admin.duePlaceholder} aria-label={t.statusPage.due} />
        </div>
        <div className="itr-linkfield">
          <span className="itr-linklabel">{t.admin.createEst}</span>
          <input className="itr-input" value={form.estimate} onChange={set('estimate')}
            placeholder={t.admin.estimatePlaceholder} aria-label={t.admin.estimatePlaceholder} />
        </div>
      </div>
      {/* One control for both boards: what matters is which task, not which
        * table it lives in, so the source is a label on the row. */}
      <div className="itr-triage-row">
        <span className="itr-linklabel">{t.admin.linkLabel}</span>
        <Combobox
          value={linkValue(form, linked, t)}
          query={linkQuery}
          onQuery={setLinkQuery}
          placeholder={t.admin.linkSearch}
          emptyText={t.admin.linkNoMatch}
          groupLabels={{ gantt: t.admin.linkGantt, backlog: t.admin.linkBacklog,
                         suggested: t.admin.linkSuggested }}
          options={linkOptions(linkResults, suggestion, linkQuery)}
          onSelect={(row) => {
            setLinkQuery('')
            setForm((f) => ({
              ...f,
              gantt_id: row.source === 'gantt' ? String(row.id) : '',
              backlog_id: row.source === 'backlog' ? String(row.id) : '',
            }))
            setSaved(false)
          }}
          onClear={() => {
            setForm((f) => ({ ...f, gantt_id: '', backlog_id: '' }))
            setSaved(false)
          }}
        />
        <div className="itr-actions itr-link-actions">
          <button type="button" className="itr-btn itr-btn-sm" onClick={() => setCreating(true)}>
            {t.admin.createTask}
          </button>
        </div>
      </div>

      {/* Two-way hint, never a two-way write: the request closes when a person
        * says so, because only they know the requester actually got what they
        * asked for. */}
      {linked.ganttDone && form.status !== 'done' && form.status !== 'rejected' && (
        <div className="itr-sync">
          <div>
            <b>{t.admin.syncTitle}</b>
            <span className="itr-sync-task"> · {linked.gantt}</span>
            <div className="itr-sync-q">{t.admin.syncAction}</div>
          </div>
          <button type="button" className="itr-btn itr-btn-green itr-btn-sm"
            disabled={saving}
            onClick={() => { setForm((f) => ({ ...f, status: 'done' })); save({ ...form, status: 'done' }) }}>
            {t.admin.syncButton}
          </button>
        </div>
      )}

      {creating && (
        <CreateGanttTaskModal
          request={req}
          engineer={ownerEngineer}
          ownerPatch={form.owner_engineer_id
            ? { owner_engineer_id: form.owner_engineer_id }
            : (form.owner_external ? { owner_external: form.owner_external } : null)}
          t={t}
          lang={lang}
          pw={pw}
          onClose={() => setCreating(false)}
          onCreated={({ ganttId, request: updated }) => {
            setCreating(false)
            setForm((f) => ({
              ...f,
              gantt_id: String(ganttId),
              status: updated.status,
              owner_engineer_id: updated.owner_engineer_id ?? null,
              owner_external: updated.owner_external || '',
            }))
            onApplied({ request: updated, events: data.events })
          }}
        />
      )}

      <div className="itr-field itr-reply">
        <label className="itr-label">{t.admin.replyTitle}</label>
        <textarea className="itr-textarea" rows={3} value={reply}
          onChange={(e) => setReply(e.target.value)} placeholder={t.admin.replyPlaceholder} />
      </div>

      {rejecting ? (
        <div className="itr-reject">
          <label className="itr-label">{t.admin.rejectTitle}</label>
          <textarea className="itr-textarea" rows={2} value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)} placeholder={t.admin.rejectPlaceholder} />
          <div className="itr-actions">
            <button className="itr-btn itr-btn-danger" type="button"
              disabled={!rejectReason.trim() || saving} onClick={doReject}>
              {t.admin.rejectConfirm}
            </button>
            <button className="itr-btn" type="button" onClick={() => setRejecting(false)}>
              {t.admin.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="itr-actions itr-triage-actions">
          <button className="itr-btn itr-btn-primary" type="button" disabled={saving}
            onClick={() => save(null)}>
            {saving ? t.admin.saving : t.admin.save}
          </button>
          <button className="itr-btn itr-btn-danger" type="button" onClick={() => setRejecting(true)}>
            {t.admin.reject}
          </button>
          {saved && <span className="itr-saved">{t.admin.saved}</span>}
        </div>
      )}
      {err && <div className="itr-err">{err}</div>}

      <h3 className="itr-card-title itr-triage-title">{t.admin.log}</h3>
      <ul className="itr-log">
        {(data.events || []).map((e) => (
          <li key={e.id}>
            <span className="itr-log-time">{formatDateTime(e.created_at, lang)}</span>
            <span className="itr-log-text">
              <b>{t.statusPage.actor[e.actor] || e.actor}</b>{' · '}
              {e.kind === 'status'
                ? fmt(t.statusPage.event.status, {
                  from: t.status[e.from_status] || e.from_status,
                  to: t.status[e.to_status] || e.to_status,
                })
                : t.statusPage.event[e.kind] || e.kind}
              {e.body && <span className="itr-log-body"> · {e.body}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The linked task as a chip, whichever board it came from. */
function linkValue(form, linked, t) {
  if (form.gantt_id) {
    return { label: linked.gantt || `#${form.gantt_id}`, sublabel: t.admin.linkGantt }
  }
  if (form.backlog_id) {
    return { label: linked.backlog || `#${form.backlog_id}`, sublabel: t.admin.linkBacklog }
  }
  return null
}

/** Search results, with the backend's duplicate hint pinned on top until the
 *  reader starts typing their own search. */
function linkOptions(results, suggestion, query) {
  const rows = results.map((r) => ({
    key: `${r.source}-${r.id}`,
    source: r.source,
    id: r.id,
    group: r.source,
    label: r.title,
    sublabel: r.engineer_name || '',
    meta: r.percent == null ? r.status : `${r.status} · ${r.percent}%`,
    color: r.engineer_color || null,
  }))
  if (suggestion && !query.trim()) {
    const already = rows.findIndex((r) => r.source === suggestion.source && r.id === suggestion.id)
    if (already >= 0) rows.splice(already, 1)
    rows.unshift({
      key: `suggested-${suggestion.source}-${suggestion.id}`,
      source: suggestion.source,
      id: suggestion.id,
      group: 'suggested',
      label: suggestion.title,
      sublabel: '',
      meta: '',
    })
  }
  return rows
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
.itr-login{max-width:420px}
.itr-login-hint{margin:0 0 12px}
.itr-login-field{max-width:240px;flex:0 0 240px}

.itr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}
.itr-kpi{background:var(--ios-card,#fff);border-radius:14px;box-shadow:var(--ios-shadow,0 1px 3px rgba(0,0,0,.06));
  padding:14px 16px}
.itr-kpi-value{font-size:26px;font-weight:700;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
.itr-kpi-label{font-size:12px;color:var(--ios-label3,#6D6D72);margin-top:3px}
.itr-kpi.warn .itr-kpi-value{color:#C4241C}
[data-theme="dark"] .itr-kpi.warn .itr-kpi-value{color:#FF9A93}

.itr-admin-grid{display:grid;grid-template-columns:minmax(320px,440px) 1fr;gap:14px;align-items:start}
.itr-queue{padding:14px 12px}
.itr-queue-filters{display:flex;gap:8px;margin:12px 0 8px}
.itr-queue-filters .itr-select{max-width:170px}

.itr-qrow{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:none;
  background:none;font-family:inherit;padding:10px;border-radius:10px;cursor:pointer;color:inherit}
.itr-qrow:hover{background:var(--ios-bg,#F2F2F7)}
.itr-qrow.on{background:var(--ios-blue-tint,#D6E6FF)}
.itr-qrow-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.itr-qrow-title{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.itr-qrow-tags{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.itr-qrow-email{font-size:11.5px;color:var(--ios-label3,#6D6D72)}
.itr-tag{font-size:11px;padding:1px 7px;border-radius:7px;background:var(--ios-bg,#F2F2F7);
  color:var(--ios-label2,#636366)}
.itr-qrow.on .itr-tag{background:var(--ios-card,#fff)}
.itr-impact{width:8px;height:8px;border-radius:50%;flex:none;margin-top:5px}
.itr-impact-blocked{background:#FF3B30}
.itr-impact-daily{background:var(--ios-orange,#FF9500)}
.itr-impact-can_wait{background:var(--ios-fill3,#C7C7CC)}
.itr-age{flex:none;font-size:11.5px;color:var(--ios-label3,#6D6D72);font-variant-numeric:tabular-nums}
.itr-age.late{color:#C4241C;font-weight:700}
[data-theme="dark"] .itr-age.late{color:#FF9A93}

.itr-load{padding:14px 16px}
.itr-load-rows{display:flex;flex-wrap:wrap;gap:8px 18px}
.itr-load-row{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ios-label2,#636366)}
.itr-load-row b{font-weight:600;color:var(--ios-label,#1C1C1E)}
.itr-load-open{font-variant-numeric:tabular-nums}
.itr-load-closed{color:var(--ios-label3,#6D6D72);font-variant-numeric:tabular-nums}
.itr-owner-dot{width:12px;height:12px;border-radius:50%;flex:none}
.itr-qrow-owner{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;
  color:var(--ios-label2,#636366)}

.itr-link-actions{margin-top:10px}
.itr-sync{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:space-between;
  margin:14px 0 4px;padding:12px 14px;border-radius:12px;
  background:var(--ios-green-tint,#E3F6E8);color:var(--ios-green-text,#1E7A3A);font-size:13px}
.itr-sync-task{font-weight:600}
.itr-sync-q{margin-top:3px;color:var(--ios-label2,#636366)}
[data-theme="dark"] .itr-sync-q{color:var(--ios-green-text,#9EE6B0);opacity:.85}

.itr-detail{min-height:280px}
.itr-detail-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.itr-detail-impact{font-size:12px;color:var(--ios-label2,#636366)}
.itr-detail-title{margin:10px 0 14px;font-size:18px;font-weight:700;letter-spacing:-.2px;line-height:1.35}
.itr-detail-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:11px 18px;
  padding-bottom:16px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
.itr-triage-title{margin:16px 0 10px}
.itr-status-chips{margin-bottom:12px}
.itr-triage-row{margin-bottom:10px}
.itr-linkfield{display:flex;flex-direction:column;gap:4px;flex:1 1 180px;min-width:0}
.itr-linklabel{font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.itr-reply{margin:14px 0 12px}
.itr-reject{display:flex;flex-direction:column;gap:9px;margin-bottom:10px}
.itr-triage-actions{margin-bottom:4px}
.itr-saved{font-size:12.5px;color:var(--ios-green-text,#1E7A3A)}

@media(max-width:1000px){
  .itr-admin-grid{grid-template-columns:1fr}
}
@media(max-width:640px){
  .itr-queue-filters{flex-direction:column}
  .itr-queue-filters .itr-select{max-width:none}
}
`
