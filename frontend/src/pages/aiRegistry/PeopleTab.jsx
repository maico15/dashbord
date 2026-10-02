import { useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'
import { Segmented } from '../itRequestsStyle'
import { AI_TOOLS, AI_TOOL, aiToolName, guessAiTool } from '../../lib/aiTools'
import {
  STATUSES, STATUS_LABEL, EMPLOYMENT, USAGE_WINDOWS, USAGE_KINDS,
  Num, Drawer, DrawerHead, Dialog, Fact, fmtDate, money, isEmail,
} from './shared'

/* People tab — the register as it was (who, on whose approval, at what cost),
 * plus the subscription each seat sits on and the 30/60/90-day usage audit. */

export const EMPTY_PERSON = {
  person_name: '', person_email: '', department: '', manager_name: '', manager_email: '',
  employment: 'active', tool: 'claude', tool_other: '', plan: '', cost_month: '',
  cost_note: '', justification: '', approved_by: '', approved_at: '', request_ref: '',
  granted_at: '', last_used_at: '', last_verified_at: '', status: 'pending',
  revoked_at: '', revoke_reason: '', notes: '', service_id: '', usage_note: '', role: '',
  ...Object.fromEntries(USAGE_WINDOWS.flatMap((w) => [
    [`usage_${w}d`, ''], ...USAGE_KINDS.map((k) => [`usage_${k.key}_${w}d`, '']),
  ])),
}

/** Flag filters for the People tab; counts are shown on each and each is a link. */
export const PEOPLE_FLAGS = {
  billed:      { label: 'оплачиваемые места', test: (r) => r.status === 'active' || r.status === 'to_revoke' },
  no_approval: { label: 'без согласования', test: (r) => r.flag_no_approval },
  terminated:  { label: 'уволен, доступ жив', test: (r) => r.flag_terminated },
  unused:      { label: 'не заходил 30+ дней', test: (r) => r.flag_unused },
  no_manager:  { label: 'без руководителя', test: (r) => r.status === 'active'
    && (!r.manager_name || /^\s*(-|—|n\/?a|не найден[оа]?|not found|неизвестно)\s*$/i.test(r.manager_name)) && !r.manager_email },
  unlinked:    { label: 'не привязан к подписке', test: (r) => !r.service_id && r.status !== 'revoked' },
}

function rowTone(r) {
  if (r.flag_terminated) return 'red'
  if (r.flag_no_approval || r.flag_unused) return 'amber'
  return ''
}

/** The three usage windows as three links into the person panel. */
function Usage({ row, onOpen }) {
  return (
    <span className="aia-usage">
      {USAGE_WINDOWS.map((w) => {
        const v = row[`usage_${w}d`]
        return (
          <Num key={w} onClick={() => onOpen(w)} className={v === 0 ? 'aia-zero' : ''}
            title={`Использование за ${w} дней`}>
            {v ?? '—'}
          </Num>
        )
      })}
    </span>
  )
}

export function ServiceChip({ service, onClick }) {
  if (!service) return <span className="aia-muted">—</span>
  return (
    <button type="button" className="aia-svc-chip" onClick={onClick} title="Открыть подписку">
      {service.name}
    </button>
  )
}

/* ── table ─────────────────────────────────────────────────────────────── */

export const DECISION_LABEL = {
  keep: 'оставить', propose_revoke: 'предложено снять', awaiting_manager: 'ждёт руководителя',
  confirmed: 'согласовано снять', revoked: 'снято', downgrade: 'понизить тариф',
}

export function DecisionPill({ row }) {
  if (!row.decision) return <span className="aia-muted">—</span>
  return (
    <span className={`aia-state aia-state-d-${row.decision}${row.escalated_at ? ' aia-state-escalated' : ''}`}>
      {row.escalated_at ? 'эскалация' : DECISION_LABEL[row.decision] || row.decision}
    </span>
  )
}

/** "данные на 30 сент." — so a stale number is never read as current. */
export function UsageAsOf({ date }) {
  return <span className="aia-asof">{date ? `данные на ${fmtDate(date)}` : 'нет выгрузки'}</span>
}

export function PeopleTable({ rows, services, focusId, lastImportAt, buckets = {}, onOpen, onEdit, onApprove, onRevoke, onOpenService }) {
  const byId = Object.fromEntries(services.map((s) => [s.id, s]))
  const focusRef = useRef(null)
  useEffect(() => {
    if (focusId && focusRef.current) focusRef.current.scrollIntoView({ block: 'center' })
  }, [focusId])
  return (
    <table className="aia-table">
      <thead>
        <tr>
          <th>Сотрудник</th>
          <th>Руководитель</th>
          <th>Инструмент</th>
          <th className="aia-num">$/мес</th>
          <th><span className="aia-usage-head">Использование · <UsageAsOf date={lastImportAt} /></span>30 / 60 / 90</th>
          <th>Решение</th>
          <th>Согласовано</th>
          <th>Статус</th>
          <th aria-label="Действия" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = rowTone(r)
          const tool = AI_TOOL[r.tool] || AI_TOOL.other
          const reasons = [
            r.flag_terminated && 'уволен, доступ активен',
            r.flag_no_approval && 'нет записи о согласовании',
            r.flag_unused && 'не заходил больше 30 дней',
          ].filter(Boolean)
          const canApprove = r.status !== 'revoked' && (r.flag_no_approval || r.status === 'pending')
          const cls = [tone && `aia-tone-${tone}`, focusId === r.id && 'aia-focus'].filter(Boolean).join(' ')
          return (
            <tr key={r.id} className={cls || undefined} title={reasons.join(' · ') || undefined}
              ref={focusId === r.id ? focusRef : undefined}>
              <td data-label="Сотрудник">
                <Num className="aia-person" onClick={() => onOpen(r.id)}>{r.person_name}</Num>
                <div className="aia-muted">{r.person_email}</div>
                {r.department && <div className="aia-muted">{r.department}</div>}
                {r.employment && r.employment !== 'active' && (
                  <div className={`aia-emp aia-emp-${r.employment}`}>
                    {(EMPLOYMENT.find((e) => e.value === r.employment) || {}).label}
                  </div>
                )}
              </td>
              <td data-label="Руководитель" className="aia-wrap">{r.manager_name || <span className="aia-muted">—</span>}</td>
              <td data-label="Инструмент">
                {/* Tool, plan and the subscription it sits on — one cell, so the
                 * table fits a laptop screen without sideways scrolling. */}
                {byId[r.service_id] ? (
                  <ServiceChip service={byId[r.service_id]} onClick={() => onOpenService(r.service_id)} />
                ) : (
                  <span className="aia-tool"><i style={{ background: tool.color }} />{aiToolName(r)}</span>
                )}
                {r.plan && <div className="aia-muted">{r.plan}</div>}
              </td>
              <td data-label="$/мес" className="aia-num">
                {r.cost_month != null ? money(r.cost_month, 2) : <span className="aia-muted">—</span>}
                {r.cost_note && <div className="aia-muted aia-note-cell">{r.cost_note}</div>}
              </td>
              <td data-label="30/60/90">
                <Usage row={r} onOpen={(w) => onOpen(r.id, w)} />
                {r.usage_verified_at && r.usage_verified_at !== lastImportAt && (
                  <div className="aia-muted aia-tiny">на {fmtDate(r.usage_verified_at)}</div>
                )}
                <div className={`aia-tiny${r.flag_unused ? ' aia-warn-cell' : ' aia-muted'}`}>
                  вход: {r.last_used_at ? fmtDate(r.last_used_at) : 'нет данных'}
                </div>
              </td>
              <td data-label="Решение">
                <DecisionPill row={r} />
                {buckets[r.id] && buckets[r.id] !== 'ok' && <div className="aia-muted aia-tiny">{BUCKET_LABEL[buckets[r.id]]}</div>}
              </td>
              <td data-label="Согласовано">
                {r.flag_no_approval ? (
                  <span className="aia-missing">нет записи</span>
                ) : (
                  <>
                    <div>{r.approved_by}</div>
                    <div className="aia-muted aia-date">{fmtDate(r.approved_at)}</div>
                  </>
                )}
                {r.request_ref && <div className="aia-muted aia-ref">{r.request_ref}</div>}
              </td>
              <td data-label="Статус">
                <span className={`itr-pill aia-pill-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                {r.status === 'revoked' && r.revoked_at && <div className="aia-muted">{fmtDate(r.revoked_at)}</div>}
              </td>
              <td className="aia-actions">
                <div className="aia-actions-stack">
                  <button type="button" className="itr-btn itr-btn-sm" onClick={() => onEdit(r)}>Изменить</button>
                  {canApprove && (
                    <button type="button" className="itr-btn itr-btn-sm itr-btn-green" onClick={() => onApprove(r)}>
                      Согласовать
                    </button>
                  )}
                  {r.status !== 'revoked' && (
                    <button type="button" className="itr-btn itr-btn-sm itr-btn-danger" onClick={() => onRevoke(r)}>
                      Отозвать
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ── person panel (read) ───────────────────────────────────────────────── */

export const BUCKET_LABEL = {
  duplicate: 'дубль', revoke: 'ноль за 90 дней', ask_manager: 'ноль за 30 дней', low_use: 'почти не пользуется',
  downgrade: 'кандидат на понижение', role_mismatch: 'роль не по делу', no_data: 'нет данных', ok: 'в порядке',
}

const CHANNEL_LABEL = { ui: 'страница', slack: 'Slack', manager_link: 'ссылка руководителя', scheduler: 'расписание', import: 'выгрузка' }

export function PersonPanel({ row: r, pw, service, window: win, onClose, onEdit, onApprove, onRevoke, onOpenService }) {
  const usageRef = useRef(null)
  const [events, setEvents] = useState(null)
  useEffect(() => {
    let alive = true
    api.get(`/ai-access/${r.id}/events?password=${encodeURIComponent(pw)}`)
      .then((d) => { if (alive) setEvents(d.items || []) })
      .catch(() => { if (alive) setEvents([]) })
    return () => { alive = false }
  }, [r.id, r.decision, r.updated_at, pw])
  useEffect(() => {
    if (win && usageRef.current) {
      usageRef.current.scrollIntoView({ block: 'start' })
      usageRef.current.classList.add('flash')
    }
  }, [win, r.id])
  const flags = [
    r.flag_terminated && { t: 'уволен, доступ активен', c: '' },
    r.flag_no_approval && { t: 'нет записи о согласовании', c: 'amber' },
    r.flag_unused && { t: 'не заходил больше 30 дней', c: 'amber' },
  ].filter(Boolean)
  const hasSplit = USAGE_WINDOWS.some((w) => USAGE_KINDS.some((k) => r[`usage_${k.key}_${w}d`] != null))
  const canApprove = r.status !== 'revoked' && (r.flag_no_approval || r.status === 'pending')

  return (
    <Drawer label={r.person_name} onClose={onClose}>
      <DrawerHead title={r.person_name} sub={[r.person_email, r.department].filter(Boolean).join(' · ')} onClose={onClose} />
      <div className="aia-panel-body">
        {flags.length > 0 && (
          <div className="aia-flags">
            {flags.map((f) => <span key={f.t} className={`aia-flag${f.c ? ` aia-flag-${f.c}` : ''}`}>{f.t}</span>)}
          </div>
        )}

        <section className="aia-block" ref={usageRef}>
          <h3>Использование · <UsageAsOf date={r.usage_verified_at} /></h3>
          <table className="aia-ugrid">
            <thead>
              <tr>
                <th>Окно</th>
                {hasSplit && USAGE_KINDS.map((k) => <th key={k.key}>{k.label}</th>)}
                <th>Всего</th>
              </tr>
            </thead>
            <tbody>
              {USAGE_WINDOWS.map((w) => (
                <tr key={w} className={win === w ? 'on' : ''}>
                  <td>{w} дней</td>
                  {hasSplit && USAGE_KINDS.map((k) => <td key={k.key}>{r[`usage_${k.key}_${w}d`] ?? '—'}</td>)}
                  <td className={`tot${r[`usage_${w}d`] === 0 ? ' aia-bad' : ''}`}>{r[`usage_${w}d`] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10 }}>
            <Fact label="Последний вход">{r.last_used_at ? fmtDate(r.last_used_at) : <span className="aia-muted">нет данных</span>}</Fact>
            <Fact label="Проверено">{r.last_verified_at ? fmtDate(r.last_verified_at) : <span className="aia-muted">—</span>}</Fact>
            {r.usage_source && <Fact label="Источник">{r.usage_source}</Fact>}
            {r.role && <Fact label="Роль">{r.role}</Fact>}
            <Fact label="Аудит">
              {r.usage_note ? <span className="aia-note">{r.usage_note}</span> : <span className="aia-muted">заметки нет</span>}
            </Fact>
          </div>
        </section>

        <section className="aia-block">
          <h3>Решение</h3>
          <Fact label="Сейчас"><DecisionPill row={r} />{r.decision_at && <span className="aia-muted"> · {fmtDate(r.decision_at)}{r.decision_by ? ` · ${r.decision_by}` : ''}</span>}</Fact>
          {r.decision_reason && <Fact label="Почему"><span className="aia-note">{r.decision_reason}</span></Fact>}
          {r.keep_review_due && r.decision === 'keep' && <Fact label="Пересмотр">{fmtDate(r.keep_review_due)}</Fact>}
          {r.manager_notified_at && <Fact label="Руководителю">{fmtDate(r.manager_notified_at)} · {r.manager_notify_status === 'sent' ? 'отправлено' : 'не ушло'}</Fact>}
          {r.manager_notify_status && r.manager_notify_status !== 'sent' && r.manager_notify_error && <Fact label="Ошибка">{r.manager_notify_error}</Fact>}
          {r.saving_month != null && <Fact label="Экономия">{money(r.saving_month, 2)}/мес{r.saving_starts_at ? ` с ${fmtDate(r.saving_starts_at)}` : ''}</Fact>}
          <div className="aia-history">
            <div className="aia-factlabel">История</div>
            {events == null ? <div className="aia-muted">Загружаю…</div> : !events.length ? <div className="aia-muted">Решений ещё не было</div> : (
              <ul>
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="aia-muted">{fmtDate(e.created_at)}</span>{' '}
                    {e.from_decision === e.to_decision ? '' : `${DECISION_LABEL[e.from_decision] || 'нет решения'} → `}
                    <b>{DECISION_LABEL[e.to_decision] || e.to_decision || '—'}</b>
                    {e.reason && ` · ${e.reason}`}
                    <span className="aia-muted"> · {e.actor}{e.channel ? `, ${CHANNEL_LABEL[e.channel] || e.channel}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="aia-block">
          <h3>Доступ</h3>
          <Fact label="Инструмент">{aiToolName(r)}{r.plan ? ` · ${r.plan}` : ''}</Fact>
          <Fact label="Подписка"><ServiceChip service={service} onClick={() => onOpenService(r.service_id)} /></Fact>
          <Fact label="$/мес">{r.cost_month != null ? money(r.cost_month, 2) : (r.cost_note || '—')}</Fact>
          <Fact label="Статус"><span className={`itr-pill aia-pill-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></Fact>
          <Fact label="Выдан">{r.granted_at ? fmtDate(r.granted_at) : '—'}</Fact>
          <Fact label="Согласовано">
            {r.flag_no_approval ? <span className="aia-missing">нет записи</span> : `${r.approved_by} · ${fmtDate(r.approved_at)}`}
          </Fact>
          {r.request_ref && <Fact label="Заявка">{r.request_ref}</Fact>}
          {r.justification && <Fact label="Зачем"><span className="aia-note">{r.justification}</span></Fact>}
          {r.status === 'revoked' && <Fact label="Отозван">{[fmtDate(r.revoked_at), r.revoke_reason].filter(Boolean).join(' · ')}</Fact>}
        </section>

        <section className="aia-block">
          <h3>Сотрудник</h3>
          <Fact label="Руководитель">{r.manager_name || '—'}{r.manager_email ? ` · ${r.manager_email}` : ''}</Fact>
          <Fact label="Занятость">{(EMPLOYMENT.find((e) => e.value === r.employment) || {}).label || r.employment}</Fact>
          {r.notes && <Fact label="Заметки"><span className="aia-note">{r.notes}</span></Fact>}
        </section>
      </div>
      <div className="aia-panel-foot">
        <div className="itr-actions">
          <button className="itr-btn itr-btn-primary" type="button" onClick={onEdit}>Изменить</button>
          {canApprove && <button className="itr-btn itr-btn-green" type="button" onClick={onApprove}>Согласовать</button>}
          {r.status !== 'revoked' && <button className="itr-btn itr-btn-danger" type="button" onClick={onRevoke}>Отозвать</button>}
        </div>
      </div>
    </Drawer>
  )
}

/* ── person form (create / edit) ───────────────────────────────────────── */

export function PersonForm({ initial, services, onClose, onSave, onDelete }) {
  const isNew = !initial.id
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY_PERSON }
    for (const k of Object.keys(EMPTY_PERSON)) if (initial[k] != null) base[k] = String(initial[k])
    return base
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [hint, setHint] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  /* A new row whose email already filed an IT request starts from that request:
   * the person, their department and the ref. Only empty fields are filled, so
   * nothing typed is overwritten. An access request for an AI tool wins over the
   * newest request of any other kind. */
  const prefillFromRequest = async () => {
    const email = form.person_email.trim()
    if (!isNew || !isEmail(email)) return
    try {
      const d = await api.get(`/it-requests/by-email?email=${encodeURIComponent(email)}`)
      const list = d.requests || []
      const pick = list.find((r) => r.kind === 'access' && (r.system === 'ai_tools' || guessAiTool(r.summary)))
        || list.find((r) => r.kind === 'access') || list[0]
      if (!pick) return
      setForm((f) => ({
        ...f,
        person_name: f.person_name || email.split('@')[0].replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        department: f.department || pick.department || '',
        request_ref: f.request_ref || pick.ref,
        justification: f.justification || pick.summary || '',
        tool: f.tool === 'claude' && guessAiTool(pick.summary) ? guessAiTool(pick.summary) : f.tool,
      }))
      setHint(`Заполнено из заявки ${pick.ref}`)
    } catch { /* no request — nothing to prefill */ }
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.person_name.trim() || !form.person_email.trim()) { setErr('Имя и почта обязательны'); return }
    if (form.tool === 'other' && !form.tool_other.trim()) { setErr('Укажите, какой инструмент'); return }
    setSaving(true)
    try {
      // Empty numbers go as null, so clearing a field clears it rather than 422s.
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k,
        (k === 'cost_month' || k === 'service_id' || (k.startsWith('usage_') && k !== 'usage_note')) && v === '' ? null : v]))
      await onSave(body)
    } catch (ex) {
      setErr(String(ex.message || 'Не удалось сохранить'))
      setSaving(false)
    }
  }

  const field = (key, label, props = {}) => (
    <label className="itr-field aia-f">
      <span className="itr-label">{label}</span>
      <input className="itr-input" value={form[key]} onChange={set(key)} {...props} />
    </label>
  )
  const num = (key, label) => (
    <label className="itr-field" key={key}>
      <span className="itr-label">{label}</span>
      <input className="itr-input" inputMode="numeric" value={form[key]} onChange={set(key)} />
    </label>
  )

  return (
    <Drawer label={isNew ? 'Новый доступ' : 'Изменить доступ'} onClose={onClose}>
      <form onSubmit={submit} className="aia-panel-form">
        <DrawerHead title={isNew ? 'Новый доступ' : form.person_name || 'Доступ'} onClose={onClose} />
        <div className="aia-panel-body">
          <h3 className="itr-card-title">Сотрудник</h3>
          <div className="itr-row">
            {field('person_email', 'Почта *', { type: 'email', onBlur: prefillFromRequest, autoFocus: isNew })}
            {field('person_name', 'Имя *')}
          </div>
          {hint && <div className="itr-hint aia-prefill">{hint}</div>}
          <div className="itr-row">
            {field('department', 'Отдел')}
            {field('role', 'Роль в сервисе', { placeholder: 'User, Admin, Owner' })}
          </div>
          <div className="itr-row">
            <label className="itr-field aia-f">
              <span className="itr-label">Занятость</span>
              <select className="itr-select" value={form.employment} onChange={set('employment')}>
                {EMPLOYMENT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="itr-row">
            {field('manager_name', 'Руководитель')}
            {field('manager_email', 'Почта руководителя', { type: 'email' })}
          </div>

          <h3 className="itr-card-title">Инструмент и стоимость</h3>
          <div className="itr-row">
            <label className="itr-field aia-f">
              <span className="itr-label">Инструмент *</span>
              <select className="itr-select" value={form.tool} onChange={set('tool')}>
                {AI_TOOLS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            {form.tool === 'other'
              ? field('tool_other', 'Какой инструмент *')
              : field('plan', 'Тариф', { placeholder: 'Team, Pro, API key…' })}
          </div>
          {form.tool === 'other' && (
            <div className="itr-row">{field('plan', 'Тариф', { placeholder: 'Team, Pro, API key…' })}</div>
          )}
          <label className="itr-field aia-f">
            <span className="itr-label">Подписка</span>
            <select className="itr-select" value={form.service_id} onChange={set('service_id')}>
              <option value="">{isNew ? 'подобрать по инструменту' : '— не привязан —'}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.plan ? ` · ${s.plan}` : ''}</option>)}
            </select>
          </label>
          <div className="itr-row">
            {field('cost_month', '$ в месяц за место', { inputMode: 'decimal', placeholder: 'пусто — по использованию' })}
            {field('cost_note', 'Комментарий к цене', { placeholder: 'usage-based, входит в workspace…' })}
          </div>
          <label className="itr-field aia-f">
            <span className="itr-label">Зачем нужен доступ</span>
            <textarea className="itr-textarea" rows={2} value={form.justification} onChange={set('justification')} />
          </label>

          <h3 className="itr-card-title">Согласование</h3>
          <div className="itr-row">
            {field('approved_by', 'Кто согласовал')}
            {field('approved_at', 'Когда', { type: 'date' })}
          </div>
          <div className="itr-row">
            {field('request_ref', 'Заявка в IT', { placeholder: 'IT-0001' })}
            {field('granted_at', 'Выдан', { type: 'date' })}
          </div>

          <h3 className="itr-card-title">Использование</h3>
          <div className="itr-row">
            {field('last_used_at', 'Последний вход', { type: 'date' })}
            {field('last_verified_at', 'Проверено', { type: 'date' })}
          </div>
          {USAGE_WINDOWS.map((w) => (
            <div className="aia-f3" key={w}>
              {num(`usage_${w}d`, `Всего ${w} дн.`)}
              {USAGE_KINDS.map((k) => num(`usage_${k.key}_${w}d`, k.label))}
            </div>
          ))}
          <label className="itr-field aia-f">
            <span className="itr-label">Заметка аудита</span>
            <textarea className="itr-textarea" rows={2} value={form.usage_note} onChange={set('usage_note')}
              placeholder="Откуда цифры, что видно в выгрузке…" />
          </label>

          <h3 className="itr-card-title">Статус</h3>
          <div className="itr-field">
            <Segmented name="Статус" value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))} options={STATUSES} />
          </div>
          {form.status === 'revoked' && (
            <div className="itr-row">
              {field('revoked_at', 'Отозван', { type: 'date' })}
              {field('revoke_reason', 'Причина')}
            </div>
          )}
          <label className="itr-field aia-f">
            <span className="itr-label">Заметки</span>
            <textarea className="itr-textarea" rows={2} value={form.notes} onChange={set('notes')} />
          </label>
        </div>

        <div className="aia-panel-foot">
          {err && <div className="itr-err aia-panel-err">{err}</div>}
          <div className="itr-actions">
            <button className="itr-btn itr-btn-primary" type="submit" disabled={saving}>
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
            <button className="itr-btn" type="button" onClick={onClose}>Отмена</button>
            {onDelete && (
              <button className="itr-btn itr-btn-danger aia-del" type="button"
                onClick={() => (confirmDelete ? onDelete().catch(() => {}) : setConfirmDelete(true))}>
                {confirmDelete ? 'Точно удалить?' : 'Удалить'}
              </button>
            )}
          </div>
        </div>
      </form>
    </Drawer>
  )
}

/* ── revoke dialog ─────────────────────────────────────────────────────── */

export function RevokeDialog({ row, onCancel, onConfirm }) {
  const [reason, setReason] = useState(row.flag_terminated ? 'Сотрудник уволен' : '')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog label="Отозвать доступ" onCancel={onCancel} onSubmit={async () => {
      if (!reason.trim()) return
      setBusy(true)
      await onConfirm(reason.trim())
      setBusy(false)
    }}>
      <p className="itr-hint">
        {row.person_name} · {aiToolName(row)}
        {row.cost_month != null && ` · ${money(row.cost_month, 2)}/мес уйдёт из суммы`}
      </p>
      <label className="itr-field">
        <span className="itr-label">Причина</span>
        <textarea className="itr-textarea" rows={2} autoFocus value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Уволен, не пользуется, перешёл на другой инструмент…" />
      </label>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-danger" type="submit" disabled={!reason.trim() || busy}>Отозвать</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}
