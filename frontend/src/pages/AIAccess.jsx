import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import PasswordField from '../components/PasswordField'
import { I18N, readLang } from '../i18n/itRequests'
import { RequestsStyle, Segmented, Chips } from './itRequestsStyle'
import { AI_TOOLS, guessAiTool } from '../lib/aiTools'
import { STATUSES, CSS, Num, money, plural, today, downloadCsv } from './aiRegistry/shared'
import {
  SERVICE_FILTERS, filterServices, ServicesTable, ServicePanel, ServiceForm, CancelDialog,
} from './aiRegistry/ServicesTab'
import {
  EMPTY_PERSON, PEOPLE_FLAGS, DECISION_LABEL, BUCKET_LABEL,
  PeopleTable, PersonPanel, PersonForm, RevokeDialog,
} from './aiRegistry/PeopleTab'
import { RisksTable, RiskForm, GanttFromRisk } from './aiRegistry/RisksTab'
import {
  DecisionSummary, DecisionMetrics, BucketCard,
  KeepDialog, DowngradeDialog, RevokedDialog, AnswerDialog, ManagerDialog,
} from './aiRegistry/DecisionsTab'
import { RequestsTable, ApproveDialog, seatFromRequest } from './aiRegistry/RequestsTab'
import ImportDialog from './aiRegistry/ImportDialog'

/* AI registry — a decision tool for seat control. Admin-only
 * (sessionStorage.admin_pw, like /it-backlog) and not in the tab bar: the
 * footer's Admin group and the direct URL are the ways in.
 *
 * Tabs, decisions first:
 *   Решения          — buckets of active seats (first rule wins, computed by
 *                      GET /ai-access/buckets) with one-click decisions
 *   Все места        — the full register, for lookup
 *   Запросы на доступ — pending seats and AI access requests from IT requests
 *   Сервисы, Риски   — subscriptions and risks, as they were
 * Every figure is a link to the rows behind it, and every decision goes
 * through POST /ai-access/{id}/decision so it leaves an event behind. */

const PW_TEXT = (I18N[readLang('ru')] || I18N.ru).common
const APPROVER_KEY = 'ai_access_approver'
const ACTION_BUCKETS = ['duplicate', 'revoke', 'ask_manager', 'low_use', 'downgrade', 'role_mismatch']
// ?service= values. Mirrors _ai_slug in backend/main.py.
const slugify = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9а-я]+/g, '-').replace(/^-+|-+$/g, '') || 'service'
const DEFAULT_SERVICE = 'claude'
const UNLINKED = -1

export default function AIAccess() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('admin_pw') || '')
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')

  // Every seat; `people` below is the slice the open service tab shows.
  const [allPeople, setPeople] = useState([])
  const [params, setParams] = useSearchParams()
  const serviceSlug = params.get('service') || DEFAULT_SERVICE
  const [scopeId, setScopeId] = useState(null)   // resolved from the slug on load
  const [services, setServices] = useState([])
  const [stats, setStats] = useState(null)
  const [risks, setRisks] = useState([])
  const [report, setReport] = useState(null)
  const [requests, setRequests] = useState({ pending: [], requests: [] })
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [tab, setTab] = useState('decisions')
  const [svcFilter, setSvcFilter] = useState('')
  const [svcFocus, setSvcFocus] = useState(null)
  const [status, setStatus] = useState('')
  const [tool, setTool] = useState('')
  const [flag, setFlag] = useState('')
  const [q, setQ] = useState('')
  const [fDecision, setFDecision] = useState('')
  const [fBucket, setFBucket] = useState('')
  const [fService, setFService] = useState('')
  const [fManager, setFManager] = useState('')
  const [personFocus, setPersonFocus] = useState(null)

  const [svcPanel, setSvcPanel] = useState(null)        // {id, section}
  const [personPanel, setPersonPanel] = useState(null)  // {id, window}
  const [editingSvc, setEditingSvc] = useState(null)
  const [editingPerson, setEditingPerson] = useState(null)
  const [revoking, setRevoking] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [editingRisk, setEditingRisk] = useState(null)
  const [ganttRisk, setGanttRisk] = useState(null)
  // Decisions tab dialogs and the optimistic overlay: {seatId: fields shown
  // until the server answers}. Removing the entry is the revert.
  const [dialog, setDialog] = useState(null)            // {kind, seat}
  const [pending, setPending] = useState({})
  const [importOpen, setImportOpen] = useState(false)

  const [approver, setApprover] = useState(() => {
    try { return localStorage.getItem(APPROVER_KEY) || '' } catch { return '' }
  })
  const approverRef = useRef(null)
  const actor = approver.trim() || 'admin'

  const dropPassword = () => {
    sessionStorage.removeItem('admin_pw')
    setPw('')
  }

  const load = useCallback((quiet = false) => {
    if (!pw) return Promise.resolve()
    const p = encodeURIComponent(pw)
    if (!quiet) setLoading(true)
    // The service tab is a slug in the URL; the id it stands for comes from the
    // subscriptions list, so that is read first. An unknown slug means "Все".
    return api.get(`/ai-services?password=${p}`)
      .then((s) => {
        const list = s.items || []
        const hit = list.find((x) => slugify(x.name) === serviceSlug)
        const sid = serviceSlug === 'all' ? 0 : serviceSlug === 'none' ? UNLINKED : hit ? hit.id : 0
        return Promise.all([
          Promise.resolve(s), Promise.resolve(sid),
          api.get(`/ai-access?password=${p}`),
          api.get(`/ai-services/stats?password=${p}`),
          api.get(`/ai-risks?password=${p}`),
          api.get(`/ai-access/buckets?password=${p}&service_id=${sid}`),
          api.get(`/ai-access/requests?password=${p}`),
        ])
      })
      .then(([s, sid, a, st, r, b, rq]) => {
        setPeople(a.items || [])
        setServices(s.items || [])
        setScopeId(sid)
        setStats(st)
        setRisks(r.items || [])
        setReport(b)
        setRequests(rq)
        setError('')
      })
      .catch((e) => {
        if (String(e.message || '').includes('Unauthorized')) dropPassword()
        else setError(String(e.message || 'Не удалось загрузить реестр'))
      })
      .finally(() => setLoading(false))
  }, [pw, serviceSlug])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!pw) return
    api.get('/team').then((d) => setTeam(Array.isArray(d) ? d : (d.members || []))).catch(() => {})
  }, [pw])

  const login = async (ev) => {
    ev.preventDefault()
    setPwError('')
    try {
      await api.post(`/admin/verify?password=${encodeURIComponent(pwInput)}`, {})
      sessionStorage.setItem('admin_pw', pwInput)
      setPw(pwInput)
      setPwInput('')
    } catch {
      setPwError('Неверный пароль')
    }
  }

  const saveApprover = (value) => {
    setApprover(value)
    try { localStorage.setItem(APPROVER_KEY, value) } catch { /* private window */ }
  }

  /** Every write goes through here. A write anywhere moves numbers elsewhere,
   * so everything is re-read quietly afterwards. */
  const write = async (fn) => {
    setError('')
    try {
      const res = await fn()
      await load(true)
      return res
    } catch (e) {
      const msg = String(e.message || '')
      if (msg.includes('Unauthorized')) dropPassword()
      setError(`Не удалось сохранить: ${msg || 'ошибка сети'}`)
      throw e
    }
  }

  /** A seat decision: shown at once, reverted if the server says no. */
  const decide = async (seat, body, optimistic) => {
    setError('')
    setNotice('')
    setPending((p) => ({ ...p, [seat.id]: optimistic }))
    try {
      const res = await api.post(`/ai-access/${seat.id}/decision`, { by: actor, ...body }, pw)
      if (res.notify && res.notify.status !== 'sent') {
        setNotice(`${seat.person_name}: предложение записано, но уведомление не ушло — ${res.notify.error}`)
      } else if (res.notify) {
        setNotice(`${seat.person_name}: руководителю отправлено сообщение в Slack`)
      }
      await load(true)
    } catch (e) {
      const msg = String(e.message || '')
      if (msg.includes('Unauthorized')) dropPassword()
      setError(`${seat.person_name}: не сохранилось — ${msg || 'ошибка сети'}`)
    } finally {
      setPending((p) => { const n = { ...p }; delete n[seat.id]; return n })
    }
  }

  const seatActions = {
    propose: (s) => decide(s, { decision: 'propose_revoke' }, { state: 'waiting', manager_notified_at: today() }),
    keep: (s) => setDialog({ kind: 'keep', seat: s }),
    downgrade: (s) => setDialog({ kind: 'downgrade', seat: s }),
    revoked: (s) => setDialog({ kind: 'revoked', seat: s }),
    answer: (s) => setDialog({ kind: 'answer', seat: s }),
    manager: (s) => setDialog({ kind: 'manager', seat: s }),
    renotify: async (s) => {
      setError('')
      setPending((p) => ({ ...p, [s.id]: { state: 'waiting' } }))
      try {
        const res = await api.post(`/ai-access/${s.id}/notify-manager`, { by: actor }, pw)
        setNotice(res.ok ? `${s.person_name}: напоминание отправлено` : `${s.person_name}: уведомление не ушло — ${res.notify.error}`)
        await load(true)
      } catch (e) {
        setError(`${s.person_name}: ${String(e.message || 'ошибка сети')}`)
      } finally {
        setPending((p) => { const n = { ...p }; delete n[s.id]; return n })
      }
    },
  }

  /* ── navigation ──────────────────────────────────────────────────────── */

  const closePanels = () => { setSvcPanel(null); setPersonPanel(null) }

  const drill = (key) => {
    closePanels()
    setTab('services')
    setSvcFilter(tab === 'services' && svcFilter === key ? '' : key)
    setSvcFocus(null)
  }

  const openService = (id, section = 'top') => {
    if (!id) return
    const svc = services.find((s) => s.id === id)
    if (!svc) return
    setPersonPanel(null)
    setTab('services')
    if (svcFilter && !SERVICE_FILTERS[svcFilter].test(svc)) setSvcFilter('')
    setSvcFocus(id)
    setSvcPanel({ id, section })
  }

  /** Opens the person panel. From the Решения and Запросы tabs it opens in
   * place; from anywhere else it lands on that row in Все места. */
  const openPerson = (id, window = null) => {
    const row = allPeople.find((r) => r.id === id)
    if (!row) return
    setSvcPanel(null)
    if (tab !== 'decisions' && tab !== 'requests') {
      setTab('people')
      setStatus(''); setTool(''); setFlag(''); setQ('')
      setFDecision(''); setFBucket(''); setFService(''); setFManager('')
      setPersonFocus(id)
    }
    setPersonPanel({ id, window })
  }

  const showPeople = (flagKey) => {
    closePanels()
    setTab('people')
    setStatus(''); setTool(''); setQ('')
    setFDecision(''); setFBucket(''); setFService(''); setFManager('')
    setFlag(flagKey)
  }

  /* ── writes outside the Решения tab ──────────────────────────────────── */

  const setSvcDecision = (svc, value) => {
    if (value === 'cancelled') { setCancelling(svc); return }
    write(() => api.patch(`/ai-services/${svc.id}`, { decision: value }, pw)).catch(() => {})
  }

  const approveLegacy = (row) => setDialog({ kind: 'approve', seat: row })

  const exportCsv = async () => {
    setError('')
    try {
      if (tab === 'services') await downloadCsv('/ai-services/export.csv', `ai-services-${today()}.csv`, pw)
      else await downloadCsv('/ai-access/export.csv', `ai-access-${today()}.csv`, pw)
    } catch (e) {
      setError(`Не удалось выгрузить CSV: ${String(e.message || '')}`)
    }
  }

  /* ── derived ─────────────────────────────────────────────────────────── */

  /* ── service scope: the tab row over the whole page ───────────────────── */

  const serviceIds = useMemo(() => new Set(services.map((x) => x.id)), [services])
  const inScope = useCallback((r) => (
    !scopeId ? true
      : scopeId === UNLINKED ? !serviceIds.has(r.service_id)
        : r.service_id === scopeId
  ), [scopeId, serviceIds])
  const people = useMemo(() => allPeople.filter(inScope), [allPeople, inScope])
  const scopeService = scopeId > 0 ? services.find((x) => x.id === scopeId) : null
  const serviceTabs = report?.service_tabs || []
  const pickService = (slug) => {
    closePanels()
    const next = new URLSearchParams(params)
    next.set('service', slug)
    setParams(next, { replace: true })
  }
  const scopedRequests = useMemo(() => ({
    pending: requests.pending.filter(inScope),
    // An IT request is not linked to a subscription yet; it shows under the
    // service its summary names, and always under "Все".
    requests: !scopeId ? requests.requests : requests.requests.filter((q) => {
      const key = guessAiTool(q.summary) || (q.system === 'ai_tools' ? 'claude' : '')
      return scopeService && key && slugify(scopeService.name).startsWith(key)
    }),
  }), [requests, inScope, scopeId, scopeService])

  const bucketOf = useMemo(() => {
    const out = {}
    for (const b of report?.buckets || []) for (const r of b.seats) out[r.id] = b.key
    return out
  }, [report])

  const visibleServices = useMemo(() => filterServices(services, svcFilter), [services, svcFilter])

  const managers = useMemo(() => [...new Set(people.map((r) => (r.manager_name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru')), [people])

  const visiblePeople = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return people.filter((r) => (
      (!status || r.status === status)
      && (!tool || r.tool === tool)
      && (!flag || PEOPLE_FLAGS[flag].test(r))
      && (!fDecision || (fDecision === 'none' ? !r.decision : r.decision === fDecision))
      && (!fBucket || bucketOf[r.id] === fBucket)
      && (!fService || String(r.service_id || '') === fService)
      && (!fManager || (r.manager_name || '').trim() === fManager)
      && (!needle || [r.person_name, r.person_email, r.manager_name, r.department]
        .some((v) => String(v || '').toLowerCase().includes(needle)))
    ))
  }, [people, status, tool, flag, q, fDecision, fBucket, fService, fManager, bucketOf])

  const statusCounts = useMemo(() => {
    const out = { '': people.length }
    for (const r of people) out[r.status] = (out[r.status] || 0) + 1
    return out
  }, [people])

  const flagCounts = useMemo(() => Object.fromEntries(
    Object.entries(PEOPLE_FLAGS).map(([k, f]) => [k, people.filter(f.test).length])), [people])

  const toolOptions = useMemo(() => {
    const present = new Set(people.map((r) => r.tool))
    return [{ value: '', label: 'Все' },
      ...AI_TOOLS.filter((t) => present.has(t.key)).map((t) => ({ value: t.key, label: t.label }))]
  }, [people])

  const openRisks = risks.filter((r) => r.status !== 'closed').length
  const serviceById = useMemo(() => Object.fromEntries(services.map((s) => [s.id, s])), [services])
  const panelService = svcPanel && serviceById[svcPanel.id]
  const panelPerson = personPanel && allPeople.find((r) => r.id === personPanel.id)
  // The date the usage numbers are from: the last import, else the newest date
  // any seat was verified (numbers loaded through the API, not an upload).
  const lastImportAt = report?.last_import?.as_of
    || people.reduce((m, r) => (r.usage_verified_at && r.usage_verified_at > m ? r.usage_verified_at : m), '') || null
  const requestCount = scopedRequests.pending.length + scopedRequests.requests.length
  const openSeats = report?.summary?.open_seats ?? 0

  if (!pw) {
    return (
      <div className="itr-page">
        <RequestsStyle />
        <main className="itr-main">
          <header className="itr-head">
            <div className="itr-head-main">
              <h1 className="itr-title">AI-места</h1>
              <p className="itr-sub">Кто занимает платное AI-место и не пользуется им — и что с этим решили.</p>
            </div>
          </header>
          <section className="itr-card">
            <h2 className="itr-card-title">Пароль администратора</h2>
            <form className="itr-actions" onSubmit={login}>
              <PasswordField
                className="aia-pw"
                inputClassName="itr-input"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder="Пароль"
                autoFocus
                labels={{ show: PW_TEXT.showPassword, hide: PW_TEXT.hidePassword }}
              />
              <button className="itr-btn itr-btn-primary" type="submit">Войти</button>
            </form>
            {pwError && <div className="itr-err">{pwError}</div>}
          </section>
        </main>
        <AppFooter lang="ru" />
        <style>{CSS}</style>
      </div>
    )
  }

  const s = stats || {}
  const activeFilter = tab === 'services' ? SERVICE_FILTERS[svcFilter] : tab === 'people' ? PEOPLE_FLAGS[flag] : null
  const renewalDate = (seat) => (serviceById[seat.service_id] || {}).renewal_date || report?.summary?.renewal?.date || ''

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main itr-main-wide">
        {serviceTabs.length > 0 && (
          <nav className="aia-svc-tabs" aria-label="Сервис">
            <Segmented
              name="Сервис"
              value={scopeId === UNLINKED ? 'none' : scopeService ? slugify(scopeService.name) : 'all'}
              onChange={pickService}
              options={[
                { value: 'all', label: `Все · ${serviceTabs.reduce((n, t) => n + t.active, 0)}` },
                ...serviceTabs.map((t) => ({ value: t.slug, label: `${t.name} · ${t.active}` })),
              ]}
            />
          </nav>
        )}
        <header className="itr-head">
          <div className="itr-head-main">
            <h1 className="itr-title">AI-места</h1>
            <p className="itr-sub">Кто занимает платное AI-место и не пользуется им — и что с этим решили.</p>
          </div>
          {['decisions', 'people', 'requests'].includes(tab) && (
            <label className="aia-approver">
              <span>Кто решает</span>
              <input ref={approverRef} className="itr-input" value={approver}
                onChange={(e) => saveApprover(e.target.value)} placeholder="Ваше имя" />
            </label>
          )}
        </header>

        <div className="aia-tabs">
          <Segmented
            name="Раздел"
            value={tab}
            onChange={(v) => { closePanels(); setTab(v) }}
            options={[
              { value: 'decisions', label: `Решения · ${openSeats}` },
              { value: 'people', label: `Все места · ${people.length}` },
              { value: 'requests', label: `Запросы · ${requestCount}` },
              { value: 'services', label: `Сервисы · ${services.length}` },
              { value: 'risks', label: `Риски · ${openRisks}` },
            ]}
          />
          <div className="aia-tabs-actions">
            {(tab === 'people' || tab === 'services') && <button className="itr-btn" type="button" onClick={exportCsv}>Export CSV</button>}
            {(tab === 'decisions' || tab === 'people') && (
              <button className="itr-btn" type="button" onClick={() => setImportOpen(true)}>Загрузить выгрузку</button>
            )}
            {tab === 'services' && <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditingSvc({})}>＋ Сервис</button>}
            {tab === 'people' && <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditingPerson(EMPTY_PERSON)}>＋ Доступ</button>}
            {tab === 'risks' && <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditingRisk({})}>＋ Риск</button>}
          </div>
        </div>

        {activeFilter && (
          <div className="aia-chip-filter" role="status">
            Фильтр: {activeFilter.label}
            <button type="button" onClick={() => (tab === 'services' ? setSvcFilter('') : setFlag(''))}>сбросить</button>
          </div>
        )}

        {error && <div className="itr-err aia-error" role="alert">{error}</div>}
        {notice && !error && <div className="aia-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Скрыть">×</button></div>}

        {/* ── Решения ─────────────────────────────────────────────────── */}
        {tab === 'decisions' && (
          !report ? <section className="itr-card"><div className="itr-empty">{loading ? 'Загружаю…' : 'Нет данных'}</div></section> : (
            <>
              <DecisionSummary report={report} scope={scopeService} onImport={() => setImportOpen(true)} />
              <DecisionMetrics report={report} onShowPeople={showPeople} />
              {report.buckets.filter((b) => ACTION_BUCKETS.includes(b.key)).map((b) => (
                <BucketCard key={b.key} bucket={b} pending={pending} actions={seatActions}
                  onOpenPerson={(id, w) => openPerson(id, w)} />
              ))}
              <div className="aia-legend">
                {report.buckets.filter((b) => !ACTION_BUCKETS.includes(b.key)).map((b) => (
                  <span key={b.key}>
                    {b.title}: <Num className="aia-numlink-blue" onClick={() => { closePanels(); setTab('people'); setFBucket(b.key) }}>
                      <b>{b.count}</b></Num> · {b.rule}
                  </span>
                ))}
                <span className="aia-legend-note">Корзина — первое правило, под которое место подходит. Каждое решение пишется в историю места.</span>
              </div>
            </>
          )
        )}

        {/* ── Все места ───────────────────────────────────────────────── */}
        {tab === 'people' && (
          <>
            <section className="itr-card aia-filters">
              <Segmented
                name="Статус"
                value={status}
                onChange={setStatus}
                options={[{ value: '', label: `Все · ${statusCounts[''] || 0}` },
                  ...STATUSES.map((st) => ({ value: st.value, label: `${st.label} · ${statusCounts[st.value] || 0}` }))]}
              />
              {toolOptions.length > 2 && <Segmented name="Инструмент" value={tool} onChange={setTool} options={toolOptions} />}
              <div className="aia-selects">
                <select className="itr-select" value={fDecision} onChange={(e) => setFDecision(e.target.value)} aria-label="Решение">
                  <option value="">Решение: любое</option>
                  <option value="none">без решения</option>
                  {Object.entries(DECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="itr-select" value={fBucket} onChange={(e) => setFBucket(e.target.value)} aria-label="Корзина">
                  <option value="">Корзина: любая</option>
                  {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="itr-select" value={fService} onChange={(e) => setFService(e.target.value)} aria-label="Сервис">
                  <option value="">Сервис: любой</option>
                  {services.map((sv) => <option key={sv.id} value={String(sv.id)}>{sv.name}</option>)}
                </select>
                <select className="itr-select" value={fManager} onChange={(e) => setFManager(e.target.value)} aria-label="Руководитель">
                  <option value="">Руководитель: любой</option>
                  {managers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <Chips
                value={flag}
                onChange={(v) => setFlag((cur) => (cur === v ? '' : v))}
                options={Object.entries(PEOPLE_FLAGS).filter(([k]) => k !== 'billed')
                  .map(([k, f]) => ({ value: k, label: `${f.label} · ${flagCounts[k]}` }))}
              />
              <input className="itr-input aia-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск: человек, почта, руководитель, отдел" />
            </section>
            <section className="itr-card aia-tablecard">
              {loading && !people.length ? <div className="itr-empty">Загружаю…</div>
                : !visiblePeople.length ? (
                  <div className="itr-empty">{people.length ? 'Под фильтр ничего не попало.' : 'В реестре пока нет ни одного места.'}</div>
                ) : (
                  <PeopleTable
                    rows={visiblePeople}
                    services={services}
                    focusId={personFocus}
                    lastImportAt={lastImportAt}
                    showService={!scopeId}
                    buckets={bucketOf}
                    onOpen={openPerson}
                    onEdit={(r) => setEditingPerson(r)}
                    onApprove={approveLegacy}
                    onRevoke={(r) => setRevoking(r)}
                    onOpenService={(id) => openService(id)}
                  />
                )}
            </section>
            <div className="aia-legend">
              <span><i className="aia-sw aia-sw-amber" />нет записи о согласовании или не заходил больше 30 дней</span>
              <span><i className="aia-sw aia-sw-red" />уволен, а доступ активен</span>
              <span className="aia-legend-note">Для поиска. Решения принимаются на вкладке «Решения».</span>
            </div>
          </>
        )}

        {/* ── Запросы на доступ ───────────────────────────────────────── */}
        {tab === 'requests' && (
          <section className="itr-card aia-tablecard">
            <RequestsTable
              pending={scopedRequests.pending}
              requests={scopedRequests.requests}
              onOpenPerson={(id) => openPerson(id)}
              onApprove={(r) => setDialog({ kind: 'approve', seat: r })}
              onReject={(r) => setRevoking(r)}
              onAdd={(qr) => write(() => api.post('/ai-access', seatFromRequest(qr), pw)).catch(() => {})}
            />
          </section>
        )}

        {/* ── Сервисы ─────────────────────────────────────────────────── */}
        {tab === 'services' && (
          <>
            <section className="aia-kpis">
              <button type="button" className={`aia-kpi${svcFilter === 'spend' ? ' on' : ''}`} onClick={() => drill('spend')}>
                <div className="aia-kpi-label">Расход в месяц</div>
                <div className="aia-kpi-value">{stats ? money(s.spend_month_total) : '—'}</div>
                <div className="aia-kpi-sub">
                  {stats ? `${money(s.spend_year_total)} в год · ${s.services_count} ${plural(s.services_count, 'сервис', 'сервиса', 'сервисов')}` : ''}
                </div>
              </button>
              <button type="button" className={`aia-kpi${s.no_owner_count ? ' aia-kpi-red' : ''}${svcFilter === 'no_owner' ? ' on' : ''}`}
                onClick={() => drill('no_owner')}>
                <div className="aia-kpi-label">Без владельца</div>
                <div className="aia-kpi-value">{stats ? s.no_owner_count : '—'}</div>
                <div className="aia-kpi-sub">{stats ? `${money(s.no_owner_month)}/мес — некому отключить` : ''}</div>
              </button>
              <button type="button" className={`aia-kpi${s.saved_month ? ' aia-kpi-green' : ''}${svcFilter === 'cancelled' ? ' on' : ''}`}
                onClick={() => drill('cancelled')}>
                <div className="aia-kpi-label">Снято (экономия)</div>
                <div className="aia-kpi-value">{stats ? money(s.saved_month) : '—'}</div>
                <div className="aia-kpi-sub">
                  {stats ? `в месяц · ${s.saved_count} ${plural(s.saved_count, 'сервис отключён', 'сервиса отключено', 'сервисов отключено')}` : ''}
                </div>
              </button>
              <button type="button" className={`aia-kpi${s.killlist_count ? ' aia-kpi-amber' : ''}${svcFilter === 'kill' ? ' on' : ''}`}
                onClick={() => drill('kill')}>
                <div className="aia-kpi-label">В kill-list</div>
                <div className="aia-kpi-value">{stats ? money(s.killlist_month) : '—'}</div>
                <div className="aia-kpi-sub">
                  {stats ? `в месяц · ${s.killlist_count} ${plural(s.killlist_count, 'сервис', 'сервиса', 'сервисов')} к отключению` : ''}
                </div>
              </button>
            </section>
            {stats && (
              <div className="aia-strip">
                <span>Мест в реестре: <Num className="aia-numlink-blue" onClick={() => showPeople('billed')}><b>{s.people_seats}</b></Num></span>
                <span>Оплачено сверх видимого: <Num className="aia-numlink-blue" onClick={() => drill('gap')}>
                  <b>{s.gap_seats}</b> {plural(s.gap_seats, 'место', 'места', 'мест')} · <b>{money(s.gap_cost_month)}</b>/мес</Num></span>
                <span>Ни на кого не записано: <Num className="aia-numlink-blue" onClick={() => drill('unattributed')}>
                  <b>{money(s.unattributed_month)}</b>/мес · {s.unattributed_count} {plural(s.unattributed_count, 'сервис', 'сервиса', 'сервисов')}</Num></span>
                <span>Продление ≤ 14 дн.: <Num className="aia-numlink-blue" onClick={() => drill('renewal')}><b>{s.renewal_count}</b></Num></span>
              </div>
            )}
            <section className="itr-card aia-tablecard">
              {loading && !services.length ? <div className="itr-empty">Загружаю…</div>
                : !visibleServices.length ? (
                  <div className="itr-empty">
                    {services.length ? 'Под фильтр ничего не попало.' : 'Подписок пока нет — добавьте их кнопкой «＋ Сервис» или через POST /api/ai-services.'}
                  </div>
                ) : (
                  <ServicesTable rows={visibleServices} focusId={svcFocus}
                    onOpen={openService} onDecision={setSvcDecision} onEdit={(r) => setEditingSvc(r)} />
                )}
            </section>
            <div className="aia-legend">
              <span><i className="aia-sw aia-sw-red" />оплачено больше мест, чем видно, или нет владельца</span>
              <span><i className="aia-sw aia-sw-amber" />в kill-list</span>
              <span><i className="aia-sw aia-sw-muted" />отключено</span>
              <span className="aia-legend-note">Расход — всё, кроме отключённых. Экономия начинается с даты, указанной при отключении.</span>
            </div>
          </>
        )}

        {/* ── Риски ───────────────────────────────────────────────────── */}
        {tab === 'risks' && (
          <section className="itr-card aia-tablecard">
            {loading && !risks.length ? <div className="itr-empty">Загружаю…</div>
              : !risks.length ? <div className="itr-empty">Рисков пока нет.</div> : (
                <RisksTable
                  rows={risks}
                  onEdit={(r) => setEditingRisk(r)}
                  onStatus={(r, v) => write(() => api.patch(`/ai-risks/${r.id}`, { status: v }, pw)).catch(() => {})}
                  onToGantt={(r) => setGanttRisk(r)}
                />
              )}
          </section>
        )}
      </main>

      {/* ── panels and dialogs ─────────────────────────────────────────── */}

      {panelService && (
        <ServicePanel
          service={panelService}
          section={svcPanel.section}
          pw={pw}
          onClose={() => setSvcPanel(null)}
          onEdit={() => setEditingSvc(panelService)}
          onOpenPerson={(id) => openPerson(id)}
          onDecision={setSvcDecision}
        />
      )}

      {panelPerson && (
        <PersonPanel
          row={panelPerson}
          pw={pw}
          service={serviceById[panelPerson.service_id]}
          window={personPanel.window}
          onClose={() => setPersonPanel(null)}
          onEdit={() => setEditingPerson(panelPerson)}
          onApprove={() => approveLegacy(panelPerson)}
          onRevoke={() => setRevoking(panelPerson)}
          onOpenService={(id) => openService(id)}
        />
      )}

      {editingSvc && (
        <ServiceForm
          initial={editingSvc}
          onClose={() => setEditingSvc(null)}
          onSave={async (body) => {
            await write(() => (editingSvc.id
              ? api.patch(`/ai-services/${editingSvc.id}`, body, pw)
              : api.post('/ai-services', body, pw)))
            setEditingSvc(null)
          }}
          onDelete={editingSvc.id ? async () => {
            await write(() => api.del(`/ai-services/${editingSvc.id}`, pw))
            setEditingSvc(null)
            setSvcPanel(null)
          } : null}
        />
      )}

      {editingPerson && (
        <PersonForm
          initial={editingPerson}
          services={services}
          onClose={() => setEditingPerson(null)}
          onSave={async (body) => {
            await write(() => (editingPerson.id
              ? api.patch(`/ai-access/${editingPerson.id}`, body, pw)
              : api.post('/ai-access', body, pw)))
            setEditingPerson(null)
          }}
          onDelete={editingPerson.id ? async () => {
            await write(() => api.del(`/ai-access/${editingPerson.id}`, pw))
            setEditingPerson(null)
            setPersonPanel(null)
          } : null}
        />
      )}

      {revoking && (
        <RevokeDialog
          row={revoking}
          onCancel={() => setRevoking(null)}
          onConfirm={(reason) => write(() => api.post(`/ai-access/${revoking.id}/revoke`, { reason, by: actor }, pw))
            .then(() => setRevoking(null)).catch(() => {})}
        />
      )}

      {cancelling && (
        <CancelDialog
          service={cancelling}
          onCancel={() => setCancelling(null)}
          onConfirm={(body) => write(() => api.patch(`/ai-services/${cancelling.id}`, { decision: 'cancelled', ...body }, pw))
            .then(() => setCancelling(null)).catch(() => {})}
        />
      )}

      {dialog?.kind === 'keep' && (
        <KeepDialog seat={dialog.seat} onCancel={() => setDialog(null)} onConfirm={async (reason) => {
          setDialog(null)
          await decide(dialog.seat, { decision: 'keep', reason }, { state: 'kept' })
        }} />
      )}
      {dialog?.kind === 'downgrade' && (
        <DowngradeDialog seat={dialog.seat} onCancel={() => setDialog(null)} onConfirm={async (body) => {
          setDialog(null)
          await decide(dialog.seat, { decision: 'downgrade', ...body }, { state: 'downgrade', target_plan: body.target_plan })
        }} />
      )}
      {dialog?.kind === 'revoked' && (
        <RevokedDialog seat={dialog.seat} renewal={renewalDate(dialog.seat)} onCancel={() => setDialog(null)}
          onConfirm={async (body) => {
            setDialog(null)
            await decide(dialog.seat, { decision: 'revoked', ...body }, { state: 'revoked' })
          }} />
      )}
      {dialog?.kind === 'answer' && (
        <AnswerDialog seat={dialog.seat} onCancel={() => setDialog(null)} onConfirm={async (body) => {
          await write(() => api.post(`/ai-access/${dialog.seat.id}/manager-response`, { ...body, by: actor }, pw))
            .then(() => setDialog(null)).catch(() => {})
        }} />
      )}
      {dialog?.kind === 'manager' && (
        <ManagerDialog seat={dialog.seat} people={allPeople} team={team} onCancel={() => setDialog(null)}
          onConfirm={async (body) => {
            await write(() => api.patch(`/ai-access/${dialog.seat.id}`, body, pw))
              .then(() => setDialog(null)).catch(() => {})
          }} />
      )}
      {dialog?.kind === 'approve' && (
        <ApproveDialog seat={dialog.seat} approver={approver} onCancel={() => setDialog(null)} onConfirm={async (body) => {
          if (body.by !== approver) saveApprover(body.by)
          await write(() => api.post(`/ai-access/${dialog.seat.id}/approve`, body, pw))
            .then(() => setDialog(null)).catch(() => {})
        }} />
      )}

      {importOpen && (
        <ImportDialog pw={pw} services={services} defaultServiceId={scopeId > 0 ? scopeId : null} onClose={() => setImportOpen(false)}
          onImported={() => load(true)} />
      )}

      {editingRisk && (
        <RiskForm
          initial={editingRisk}
          onClose={() => setEditingRisk(null)}
          onSave={async (body) => {
            await write(() => (editingRisk.id
              ? api.patch(`/ai-risks/${editingRisk.id}`, body, pw)
              : api.post('/ai-risks', body, pw)))
            setEditingRisk(null)
          }}
          onDelete={editingRisk.id ? async () => {
            await write(() => api.del(`/ai-risks/${editingRisk.id}`, pw))
            setEditingRisk(null)
          } : null}
        />
      )}

      {ganttRisk && (
        <GanttFromRisk
          risk={ganttRisk}
          pw={pw}
          onClose={() => setGanttRisk(null)}
          onCreated={() => { setGanttRisk(null); load(true) }}
        />
      )}

      <AppFooter lang="ru" />
      <style>{CSS}</style>
    </div>
  )
}
