import { useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'
import {
  DECISIONS, DECISION_LABEL, STATUS_LABEL, USAGE_WINDOWS,
  Num, Drawer, DrawerHead, Dialog, Fact, fmtDate, money, plural, today,
} from './shared'

/* Services tab — one row per subscription, with what the invoice says. The
 * people register alone understates spend (a Team plan is not seats × list
 * price, and infrastructure has no seat at all), so the money lives here. */

const live = (r) => r.decision !== 'cancelled'

/** What a KPI card or a strip link narrows the table to. `label` is the chip
 * text ("Фильтр: … · сбросить"); `sort` picks the column that explains it. */
export const SERVICE_FILTERS = {
  spend:        { label: 'всё, что ещё оплачивается', test: live, sort: 'cost' },
  no_owner:     { label: 'без владельца', test: (r) => live(r) && r.flag_no_owner, sort: 'cost' },
  cancelled:    { label: 'отключено — экономия', test: (r) => r.decision === 'cancelled', sort: 'saving' },
  kill:         { label: 'kill-list', test: (r) => r.decision === 'kill', sort: 'cost' },
  gap:          { label: 'оплачено больше мест, чем видно', test: (r) => live(r) && r.flag_gap, sort: 'gap' },
  renewal:      { label: 'продление в ближайшие 14 дней', test: (r) => live(r) && r.flag_renewal, sort: 'renewal' },
  unattributed: { label: 'ни одного человека в реестре', test: (r) => live(r) && !r.people_count, sort: 'cost' },
}

const SORTS = {
  cost:    (a, b) => (b.cost_month ?? -1) - (a.cost_month ?? -1),
  saving:  (a, b) => (b.saving_month ?? -1) - (a.saving_month ?? -1),
  gap:     (a, b) => (b.gap_cost_month ?? -1) - (a.gap_cost_month ?? -1),
  renewal: (a, b) => String(a.renewal_date || '9999').localeCompare(String(b.renewal_date || '9999')),
}

/** Default order: what is still paid, most expensive first; cancelled last. */
export function filterServices(rows, filterKey) {
  const f = SERVICE_FILTERS[filterKey]
  const out = f ? rows.filter(f.test) : [...rows]
  if (f) return out.sort(SORTS[f.sort])
  return out.sort((a, b) => (live(b) - live(a)) || SORTS.cost(a, b))
}

function serviceTone(r) {
  if (!live(r)) return 'muted'
  if (r.flag_gap || r.flag_no_owner) return 'red'
  if (r.decision === 'kill') return 'amber'
  return ''
}

function daysUntil(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const n = new Date()
  return Math.round((t - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86400000)
}

/** The five decisions as one inline control. Picking "отключено" is not a
 * write by itself: the caller asks for the saving first. */
export function DecisionControl({ value, onChange }) {
  return (
    <div className="aia-dec" role="radiogroup" aria-label="Решение">
      {DECISIONS.map((d) => (
        <button key={d.value} type="button" role="radio" aria-checked={value === d.value}
          className={`d-${d.value}${value === d.value ? ' on' : ''}`}
          onClick={() => { if (value !== d.value) onChange(d.value) }}>
          {d.label}
        </button>
      ))}
    </div>
  )
}

function Saving({ r }) {
  if (r.decision !== 'cancelled' || r.saving_month == null) return null
  const from = r.saving_from || r.renewal_date
  return (
    <div className="aia-saving aia-good">
      −{money(r.saving_month)}/мес{from ? ` с ${fmtDate(from)}` : ''}
    </div>
  )
}

/* ── table ─────────────────────────────────────────────────────────────── */

export function ServicesTable({ rows, focusId, onOpen, onDecision, onEdit }) {
  return (
    <table className="aia-table">
      <thead>
        <tr>
          <th>Сервис</th>
          <th className="aia-num">$/мес</th>
          <th>Мест: счёт / видно</th>
          <th>Продление</th>
          <th>Владелец · кто может отключить</th>
          <th>Решение</th>
          <th aria-label="Действия" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = serviceTone(r)
          const days = daysUntil(r.renewal_date)
          const cls = [tone && `aia-tone-${tone}`, focusId === r.id && 'aia-focus'].filter(Boolean).join(' ')
          return (
            <tr key={r.id} className={cls || undefined} id={`aia-svc-${r.id}`}>
              <td data-label="Сервис">
                <Num onClick={() => onOpen(r.id, 'top')} className="aia-person">{r.name}</Num>
                {r.plan && <div className="aia-muted">{r.plan}</div>}
                {r.status_note && <div className="aia-muted">{r.status_note}</div>}
              </td>
              <td data-label="$/мес" className="aia-num">
                <Num onClick={() => onOpen(r.id, 'cost')} title="Счёт и продление">
                  {r.cost_month != null ? money(r.cost_month) : <span className="aia-muted">{r.cost_note || '—'}</span>}
                </Num>
                {r.cost_year != null && <div className="aia-muted">{money(r.cost_year)}/год</div>}
              </td>
              <td data-label="Мест">
                <Num onClick={() => onOpen(r.id, 'seats')} title="Места и люди">
                  {r.seats_billed ?? '—'} / {r.seats_seen ?? '—'}
                </Num>
                {r.flag_gap && (
                  <div className="aia-bad">
                    <Num onClick={() => onOpen(r.id, 'seats')}>
                      +{r.seats_gap} {plural(r.seats_gap, 'лишнее', 'лишних', 'лишних')}
                      {r.gap_cost_month != null && ` · ${money(r.gap_cost_month)}/мес`}
                    </Num>
                  </div>
                )}
                <div className="aia-muted">
                  в реестре: <Num className="aia-numlink-blue" onClick={() => onOpen(r.id, 'people')}>{r.people_count}</Num>
                </div>
              </td>
              <td data-label="Продление" className="aia-date">
                {r.renewal_date ? (
                  <>
                    <div className={r.flag_renewal ? 'aia-warn-cell' : ''}>{fmtDate(r.renewal_date)}</div>
                    {r.flag_renewal && days != null && <div className="aia-muted">через {days} {plural(days, 'день', 'дня', 'дней')}</div>}
                  </>
                ) : <span className="aia-muted">—</span>}
              </td>
              <td data-label="Владелец">
                <div>{r.owner_name || <span className="aia-missing">нет владельца</span>}</div>
                <div className="aia-muted">
                  {r.can_cancel ? `отключить может: ${r.can_cancel}` : <span className="aia-missing">кто отключает — неизвестно</span>}
                </div>
              </td>
              <td data-label="Решение">
                <DecisionControl value={r.decision || ''} onChange={(v) => onDecision(r, v)} />
                <Saving r={r} />
              </td>
              <td className="aia-actions">
                <div className="aia-actions-stack">
                  <button type="button" className="itr-btn itr-btn-sm" onClick={() => onEdit(r)}>Изменить</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ── service panel (read) ──────────────────────────────────────────────── */

export function ServicePanel({ service: s, section, pw, onClose, onEdit, onOpenPerson, onDecision }) {
  const [people, setPeople] = useState(null)
  const [err, setErr] = useState('')
  const refs = { top: useRef(null), cost: useRef(null), seats: useRef(null), people: useRef(null) }

  useEffect(() => {
    let alive = true
    setPeople(null)
    api.get(`/ai-services/${s.id}/people?password=${encodeURIComponent(pw)}`)
      .then((d) => { if (alive) setPeople(d.items || []) })
      .catch((e) => { if (alive) { setPeople([]); setErr(String(e.message || '')) } })
    return () => { alive = false }
  }, [s.id, s.people_count, pw])

  // Land on the block the click came from, and flash it so the eye follows.
  useEffect(() => {
    const el = (refs[section] || refs.top).current
    if (!el || section === 'top') return
    el.scrollIntoView({ block: 'start' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, s.id, people == null])

  const flags = [
    s.flag_gap && { t: `оплачено на ${s.seats_gap} ${plural(s.seats_gap, 'место', 'места', 'мест')} больше, чем видно`, c: '' },
    s.flag_no_owner && { t: !s.owner_name ? 'нет владельца' : 'неизвестно, кто может отключить', c: '' },
    s.flag_renewal && { t: `продление ${fmtDate(s.renewal_date)}`, c: 'amber' },
    s.decision === 'kill' && { t: 'в kill-list', c: 'amber' },
  ].filter(Boolean)

  const billedPeople = (people || []).filter((p) => p.status === 'active' || p.status === 'to_revoke')

  return (
    <Drawer label={s.name} onClose={onClose} wide>
      <DrawerHead title={s.name} sub={[s.plan, s.decision && DECISION_LABEL[s.decision]].filter(Boolean).join(' · ')} onClose={onClose} />
      <div className="aia-panel-body">
        <div ref={refs.top} />
        {flags.length > 0 && (
          <div className="aia-flags">
            {flags.map((f) => <span key={f.t} className={`aia-flag${f.c ? ` aia-flag-${f.c}` : ''}`}>{f.t}</span>)}
          </div>
        )}

        <section className="aia-block" ref={refs.cost}>
          <h3>Счёт</h3>
          <Fact label="В месяц"><span className="aia-big">{money(s.cost_month, 2)}</span></Fact>
          <Fact label="В год">{money(s.cost_year)}</Fact>
          <Fact label="Как считается">{s.cost_note || <span className="aia-muted">—</span>}</Fact>
          <Fact label="Продление">
            {s.renewal_date ? fmtDate(s.renewal_date) : <span className="aia-muted">не указано</span>}
            {s.flag_renewal && <span className="aia-warn-cell"> · скоро</span>}
          </Fact>
          {s.decision === 'cancelled' && (
            <Fact label="Экономия">
              {s.saving_month != null ? <span className="aia-good">{money(s.saving_month, 2)}/мес</span> : '—'}
              {(s.saving_from || s.renewal_date) && ` с ${fmtDate(s.saving_from || s.renewal_date)}`}
            </Fact>
          )}
        </section>

        <section className="aia-block" ref={refs.seats}>
          <h3>Места</h3>
          <Fact label="По счёту">{s.seats_billed ?? <span className="aia-muted">—</span>}</Fact>
          <Fact label="Видно в выгрузке">{s.seats_seen ?? <span className="aia-muted">—</span>}</Fact>
          <Fact label="Разрыв">
            {s.seats_gap == null ? <span className="aia-muted">нужны оба числа</span> : (
              <span className={s.flag_gap ? 'aia-bad' : ''}>
                {s.seats_gap > 0 ? '+' : ''}{s.seats_gap}
                {s.gap_cost_month != null && ` · ${money(s.gap_cost_month, 2)}/мес`}
                {s.gap_cost_month != null && s.gap_cost_month > 0 && ` · ${money(s.gap_cost_month * 12)}/год`}
              </span>
            )}
          </Fact>
          <Fact label="Проверено">{s.seats_verified_at ? fmtDate(s.seats_verified_at) : <span className="aia-muted">—</span>}</Fact>
          <Fact label="В реестре людей">
            {billedPeople.length} {plural(billedPeople.length, 'оплачиваемое место', 'оплачиваемых места', 'оплачиваемых мест')}
            {people && people.length > billedPeople.length && <span className="aia-muted"> · всего строк {people.length}</span>}
          </Fact>
        </section>

        <section className="aia-block">
          <h3>Владелец и решение</h3>
          <Fact label="Владелец">{s.owner_name || <span className="aia-missing">нет</span>}</Fact>
          <Fact label="Может отключить">{s.can_cancel || <span className="aia-missing">неизвестно</span>}</Fact>
          <Fact label="Решение">
            <DecisionControl value={s.decision || ''} onChange={(v) => onDecision(s, v)} />
          </Fact>
          {s.decision_note && <Fact label="Почему"><span className="aia-note">{s.decision_note}</span></Fact>}
          {s.status_note && <Fact label="Статус">{s.status_note}</Fact>}
          {s.notes && <Fact label="Заметки"><span className="aia-note">{s.notes}</span></Fact>}
        </section>

        <section className="aia-block" ref={refs.people}>
          <h3>Люди на подписке{people ? ` · ${people.length}` : ''}</h3>
          {err && <div className="itr-err">{err}</div>}
          {people == null ? <div className="aia-muted">Загружаю…</div> : !people.length ? (
            <div className="aia-muted">
              Ни одного человека в реестре не связано с этим сервисом.
              {s.cost_month ? ` ${money(s.cost_month)}/мес никому не приписаны.` : ''}
            </div>
          ) : (
            <table className="aia-people">
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>30 / 60 / 90</th>
                  <th>Тариф</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} onClick={() => onOpenPerson(p.id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpenPerson(p.id) }}>
                    <td>
                      <div className="aia-person">{p.person_name}</div>
                      <div className="aia-muted">{p.department || p.person_email}</div>
                    </td>
                    <td>
                      <span className="aia-usage">
                        {USAGE_WINDOWS.map((w) => {
                          const v = p[`usage_${w}d`]
                          return <span key={w} className={v === 0 ? 'aia-zero' : ''}>{v ?? '—'}{w !== 90 && ' /'}</span>
                        })}
                      </span>
                    </td>
                    <td>{p.plan || <span className="aia-muted">—</span>}</td>
                    <td><span className={`itr-pill aia-pill-${p.status}`}>{STATUS_LABEL[p.status] || p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <div className="aia-panel-foot">
        <div className="itr-actions">
          <button className="itr-btn itr-btn-primary" type="button" onClick={onEdit}>Изменить</button>
          <button className="itr-btn" type="button" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Drawer>
  )
}

/* ── service form (create / edit) ──────────────────────────────────────── */

const EMPTY_SERVICE = {
  name: '', plan: '', cost_month: '', cost_note: '', seats_billed: '', seats_seen: '',
  seats_verified_at: '', renewal_date: '', owner_name: '', can_cancel: '', decision: '',
  decision_note: '', saving_month: '', saving_from: '', status_note: '', notes: '',
}

export function ServiceForm({ initial, onClose, onSave, onDelete }) {
  const isNew = !initial.id
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY_SERVICE }
    for (const k of Object.keys(EMPTY_SERVICE)) if (initial[k] != null) base[k] = String(initial[k])
    return base
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Название обязательно'); return }
    setSaving(true)
    setErr('')
    try {
      await onSave(form)
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

  return (
    <Drawer label={isNew ? 'Новый сервис' : 'Изменить сервис'} onClose={onClose}>
      <form onSubmit={submit} className="aia-panel-form">
        <DrawerHead title={isNew ? 'Новый сервис' : form.name || 'Сервис'} onClose={onClose} />
        <div className="aia-panel-body">
          <h3 className="itr-card-title">Сервис</h3>
          <div className="itr-row">
            {field('name', 'Название *', { autoFocus: isNew, placeholder: 'Claude, ChatGPT, Abacus.AI…' })}
            {field('plan', 'Тариф', { placeholder: 'Team, Business, infrastructure…' })}
          </div>
          <h3 className="itr-card-title">Счёт</h3>
          <div className="itr-row">
            {field('cost_month', '$ в месяц по счёту', { inputMode: 'decimal' })}
            {field('cost_note', 'Как считается', { placeholder: '$29 × 24, usage-based…' })}
          </div>
          <div className="itr-row">
            {field('renewal_date', 'Продление', { type: 'date' })}
            {field('status_note', 'Статус', { placeholder: 'ждём счёт, в переговорах…' })}
          </div>
          <h3 className="itr-card-title">Места</h3>
          <div className="itr-row">
            {field('seats_billed', 'По счёту', { inputMode: 'numeric' })}
            {field('seats_seen', 'Видно в выгрузке', { inputMode: 'numeric' })}
          </div>
          <div className="itr-row">{field('seats_verified_at', 'Проверено', { type: 'date' })}</div>
          <h3 className="itr-card-title">Владелец</h3>
          <div className="itr-row">
            {field('owner_name', 'Владелец сервиса')}
            {field('can_cancel', 'У кого доступ к биллингу')}
          </div>
          <h3 className="itr-card-title">Решение</h3>
          <div className="itr-field aia-f">
            <DecisionControl value={form.decision} onChange={(v) => setForm((f) => ({ ...f, decision: v }))} />
          </div>
          <label className="itr-field aia-f">
            <span className="itr-label">Почему</span>
            <textarea className="itr-textarea" rows={2} value={form.decision_note} onChange={set('decision_note')} />
          </label>
          {form.decision === 'cancelled' && (
            <div className="itr-row">
              {field('saving_month', 'Экономия $/мес', { inputMode: 'decimal' })}
              {field('saving_from', 'С какой даты', { type: 'date' })}
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

/* ── "отключено" asks what it saves and from when ──────────────────────── */

export function CancelDialog({ service: s, onCancel, onConfirm }) {
  const [amount, setAmount] = useState(s.saving_month != null ? String(s.saving_month)
    : s.cost_month != null ? String(s.cost_month) : '')
  const [from, setFrom] = useState(s.saving_from || s.renewal_date || today())
  const [busy, setBusy] = useState(false)
  return (
    <Dialog label={`Отключено: ${s.name}`} onCancel={onCancel} onSubmit={async () => {
      setBusy(true)
      try { await onConfirm({ saving_month: amount === '' ? null : amount, saving_from: from }) } finally { setBusy(false) }
    }}>
      <p className="itr-hint">
        Экономия начинается не сегодня, а когда перестанет приходить счёт — обычно с даты продления.
      </p>
      <div className="itr-row">
        <label className="itr-field aia-f">
          <span className="itr-label">Экономия $/мес</span>
          <input className="itr-input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="itr-field aia-f">
          <span className="itr-label">С какой даты</span>
          <input className="itr-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={busy}>Отметить отключённым</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}
