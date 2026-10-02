import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import PasswordField from '../components/PasswordField'
import { I18N, readLang } from '../i18n/itRequests'
import { RequestsStyle, Segmented, Chips } from './itRequestsStyle'
import { AI_TOOLS } from '../lib/aiTools'
import { STATUSES, CSS, Num, money, plural, today, downloadCsv } from './aiRegistry/shared'
import {
  SERVICE_FILTERS, filterServices, ServicesTable, ServicePanel, ServiceForm, CancelDialog,
} from './aiRegistry/ServicesTab'
import {
  EMPTY_PERSON, PEOPLE_FLAGS, PeopleTable, PersonPanel, PersonForm, RevokeDialog,
} from './aiRegistry/PeopleTab'
import { RisksTable, RiskForm, GanttFromRisk } from './aiRegistry/RisksTab'

/* AI registry — what the company pays for AI, who sits on it, and what could
 * go wrong. Admin-only (sessionStorage.admin_pw, like /it-backlog) and not in
 * the tab bar: the footer's Admin group and the direct URL are the ways in.
 *
 * Three tabs. Сервисы holds the money as the invoices state it (one row per
 * subscription); Люди is the seat register; Риски is a short list with a way
 * onto the Gantt. Every figure on the page is a link to the rows behind it —
 * a KPI sets the tab and a filter and says so in a removable chip, a count in
 * a table opens the panel that explains it. Flags are computed by the backend
 * so the cards, the tables and the CSVs can never disagree. */

const PW_TEXT = (I18N[readLang('ru')] || I18N.ru).common
const APPROVER_KEY = 'ai_access_approver'

export default function AIAccess() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('admin_pw') || '')
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')

  const [people, setPeople] = useState([])
  const [services, setServices] = useState([])
  const [stats, setStats] = useState(null)
  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [tab, setTab] = useState('services')
  const [svcFilter, setSvcFilter] = useState('')
  const [svcFocus, setSvcFocus] = useState(null)
  const [status, setStatus] = useState('')
  const [tool, setTool] = useState('')
  const [flag, setFlag] = useState('')
  const [q, setQ] = useState('')
  const [personFocus, setPersonFocus] = useState(null)

  const [svcPanel, setSvcPanel] = useState(null)        // {id, section}
  const [personPanel, setPersonPanel] = useState(null)  // {id, window}
  const [editingSvc, setEditingSvc] = useState(null)
  const [editingPerson, setEditingPerson] = useState(null)
  const [revoking, setRevoking] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [editingRisk, setEditingRisk] = useState(null)
  const [ganttRisk, setGanttRisk] = useState(null)

  const [approver, setApprover] = useState(() => {
    try { return localStorage.getItem(APPROVER_KEY) || '' } catch { return '' }
  })
  const approverRef = useRef(null)

  const dropPassword = () => {
    sessionStorage.removeItem('admin_pw')
    setPw('')
  }

  const load = useCallback((quiet = false) => {
    if (!pw) return Promise.resolve()
    const p = encodeURIComponent(pw)
    if (!quiet) setLoading(true)
    return Promise.all([
      api.get(`/ai-access?password=${p}`),
      api.get(`/ai-services?password=${p}`),
      api.get(`/ai-services/stats?password=${p}`),
      api.get(`/ai-risks?password=${p}`),
    ])
      .then(([a, s, st, r]) => {
        setPeople(a.items || [])
        setServices(s.items || [])
        setStats(st)
        setRisks(r.items || [])
        setError('')
      })
      .catch((e) => {
        if (String(e.message || '').includes('Unauthorized')) dropPassword()
        else setError(String(e.message || 'Не удалось загрузить реестр'))
      })
      .finally(() => setLoading(false))
  }, [pw])

  useEffect(() => { load() }, [load])

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

  /** Every write goes through here. A write anywhere moves numbers elsewhere
   * (a revoked seat changes a service's people count, a decision moves the
   * cards), so everything is re-read quietly afterwards. */
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

  /* ── navigation: every click that lands somewhere goes through these ──── */

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
    // Keep the filter if the row is in it; otherwise drop it so the selected row is visible.
    if (svcFilter && !SERVICE_FILTERS[svcFilter].test(svc)) setSvcFilter('')
    setSvcFocus(id)
    setSvcPanel({ id, section })
  }

  const openPerson = (id, window = null) => {
    const row = people.find((r) => r.id === id)
    if (!row) return
    setSvcPanel(null)
    setTab('people')
    const hidden = (status && row.status !== status) || (tool && row.tool !== tool)
      || (flag && !PEOPLE_FLAGS[flag].test(row)) || q
    if (hidden) { setStatus(''); setTool(''); setFlag(''); setQ('') }
    setPersonFocus(id)
    setPersonPanel({ id, window })
  }

  const showPeople = (flagKey) => {
    closePanels()
    setTab('people')
    setStatus('')
    setTool('')
    setQ('')
    setFlag(flagKey)
  }

  /* ── writes ──────────────────────────────────────────────────────────── */

  const setDecision = (svc, value) => {
    if (value === 'cancelled') { setCancelling(svc); return }
    write(() => api.patch(`/ai-services/${svc.id}`, { decision: value }, pw)).catch(() => {})
  }

  const approve = (row) => {
    const who = approver.trim()
    if (!who) {
      setError('Укажите, кто согласует, — поле «Согласующий» вверху страницы')
      approverRef.current?.focus()
      return
    }
    write(() => api.patch(`/ai-access/${row.id}`, {
      approved_by: who, approved_at: today(), status: 'active', granted_at: row.granted_at || today(),
    }, pw)).catch(() => {})
  }

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

  const visibleServices = useMemo(() => filterServices(services, svcFilter), [services, svcFilter])

  const visiblePeople = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return people.filter((r) => (
      (!status || r.status === status)
      && (!tool || r.tool === tool)
      && (!flag || PEOPLE_FLAGS[flag].test(r))
      && (!needle || [r.person_name, r.person_email, r.manager_name, r.department]
        .some((v) => String(v || '').toLowerCase().includes(needle)))
    ))
  }, [people, status, tool, flag, q])

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
  const panelPerson = personPanel && people.find((r) => r.id === personPanel.id)

  if (!pw) {
    return (
      <div className="itr-page">
        <RequestsStyle />
        <main className="itr-main">
          <header className="itr-head">
            <div className="itr-head-main">
              <h1 className="itr-title">Реестр AI</h1>
              <p className="itr-sub">Подписки, места и риски: что оплачиваем, кто пользуется, кто может отключить.</p>
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

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main itr-main-wide">
        <header className="itr-head">
          <div className="itr-head-main">
            <h1 className="itr-title">Реестр AI</h1>
            <p className="itr-sub">Подписки, места и риски: что оплачиваем, кто пользуется, кто может отключить.</p>
          </div>
          {tab === 'people' && (
            <label className="aia-approver">
              <span>Согласующий</span>
              <input ref={approverRef} className="itr-input" value={approver}
                onChange={(e) => saveApprover(e.target.value)} placeholder="Ваше имя" />
            </label>
          )}
        </header>

        {/* ── KPI cards: each one is a filtered view of the Services tab ── */}
        <section className="aia-kpis">
          <button type="button" className={`aia-kpi${svcFilter === 'spend' && tab === 'services' ? ' on' : ''}`}
            onClick={() => drill('spend')}>
            <div className="aia-kpi-label">Расход в месяц</div>
            <div className="aia-kpi-value">{stats ? money(s.spend_month_total) : '—'}</div>
            <div className="aia-kpi-sub">
              {stats ? `${money(s.spend_year_total)} в год · ${s.services_count} ${plural(s.services_count, 'сервис', 'сервиса', 'сервисов')}` : ''}
            </div>
          </button>
          <button type="button"
            className={`aia-kpi${s.no_owner_count ? ' aia-kpi-red' : ''}${svcFilter === 'no_owner' && tab === 'services' ? ' on' : ''}`}
            onClick={() => drill('no_owner')}>
            <div className="aia-kpi-label">Без владельца</div>
            <div className="aia-kpi-value">{stats ? s.no_owner_count : '—'}</div>
            <div className="aia-kpi-sub">{stats ? `${money(s.no_owner_month)}/мес — некому отключить` : ''}</div>
          </button>
          <button type="button"
            className={`aia-kpi${s.saved_month ? ' aia-kpi-green' : ''}${svcFilter === 'cancelled' && tab === 'services' ? ' on' : ''}`}
            onClick={() => drill('cancelled')}>
            <div className="aia-kpi-label">Снято (экономия)</div>
            <div className="aia-kpi-value">{stats ? money(s.saved_month) : '—'}</div>
            <div className="aia-kpi-sub">
              {stats ? `в месяц · ${s.saved_count} ${plural(s.saved_count, 'сервис отключён', 'сервиса отключено', 'сервисов отключено')}` : ''}
            </div>
          </button>
          <button type="button"
            className={`aia-kpi${s.killlist_count ? ' aia-kpi-amber' : ''}${svcFilter === 'kill' && tab === 'services' ? ' on' : ''}`}
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

        <div className="aia-tabs">
          <Segmented
            name="Раздел"
            value={tab}
            onChange={(v) => { closePanels(); setTab(v) }}
            options={[
              { value: 'services', label: `Сервисы · ${services.length}` },
              { value: 'people', label: `Люди · ${people.length}` },
              { value: 'risks', label: `Риски · ${openRisks}` },
            ]}
          />
          <div className="aia-tabs-actions">
            {tab !== 'risks' && <button className="itr-btn" type="button" onClick={exportCsv}>Export CSV</button>}
            {tab === 'services' && (
              <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditingSvc({})}>＋ Сервис</button>
            )}
            {tab === 'people' && (
              <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditingPerson(EMPTY_PERSON)}>＋ Доступ</button>
            )}
            {tab === 'risks' && (
              <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditingRisk({})}>＋ Риск</button>
            )}
          </div>
        </div>

        {activeFilter && (
          <div className="aia-chip-filter" role="status">
            Фильтр: {activeFilter.label}
            <button type="button" onClick={() => (tab === 'services' ? setSvcFilter('') : setFlag(''))}>сбросить</button>
          </div>
        )}

        {error && <div className="itr-err aia-error" role="alert">{error}</div>}

        {tab === 'services' && (
          <>
            <section className="itr-card aia-tablecard">
              {loading && !services.length ? <div className="itr-empty">Загружаю…</div>
                : !visibleServices.length ? (
                  <div className="itr-empty">
                    {services.length ? 'Под фильтр ничего не попало.' : 'Подписок пока нет — добавьте их кнопкой «＋ Сервис» или через POST /api/ai-services.'}
                  </div>
                ) : (
                  <ServicesTable rows={visibleServices} focusId={svcFocus}
                    onOpen={openService} onDecision={setDecision} onEdit={(r) => setEditingSvc(r)} />
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
              {toolOptions.length > 2 && (
                <Segmented name="Инструмент" value={tool} onChange={setTool} options={toolOptions} />
              )}
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
                  <div className="itr-empty">{people.length ? 'Под фильтр ничего не попало.' : 'В реестре пока нет ни одного доступа.'}</div>
                ) : (
                  <PeopleTable
                    rows={visiblePeople}
                    services={services}
                    focusId={personFocus}
                    onOpen={openPerson}
                    onEdit={(r) => setEditingPerson(r)}
                    onApprove={approve}
                    onRevoke={(r) => setRevoking(r)}
                    onOpenService={(id) => openService(id)}
                  />
                )}
            </section>
            <div className="aia-legend">
              <span><i className="aia-sw aia-sw-amber" />нет записи о согласовании или не заходил больше 30 дней</span>
              <span><i className="aia-sw aia-sw-red" />уволен, а доступ активен</span>
              <span className="aia-legend-note">Деньги считаются по подпискам на вкладке «Сервисы»; цена места здесь — справочно.</span>
            </div>
          </>
        )}

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

      {panelService && (
        <ServicePanel
          service={panelService}
          section={svcPanel.section}
          pw={pw}
          onClose={() => setSvcPanel(null)}
          onEdit={() => setEditingSvc(panelService)}
          onOpenPerson={(id) => openPerson(id)}
          onDecision={setDecision}
        />
      )}

      {panelPerson && (
        <PersonPanel
          row={panelPerson}
          service={serviceById[panelPerson.service_id]}
          window={personPanel.window}
          onClose={() => setPersonPanel(null)}
          onEdit={() => setEditingPerson(panelPerson)}
          onApprove={() => approve(panelPerson)}
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
          onConfirm={(reason) => write(() => api.post(`/ai-access/${revoking.id}/revoke`, { reason }, pw))
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
