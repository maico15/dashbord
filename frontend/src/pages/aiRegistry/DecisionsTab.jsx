import { useState, useMemo } from 'react'
import Combobox from '../../components/Combobox'
import { USAGE_WINDOWS, Num, Dialog, fmtDate, money, plural, today } from './shared'

/* Решения — the default tab. It answers one question a month: who has a paid
 * AI seat and does not use it. The backend sorts every active seat into one
 * bucket (first rule wins) and returns the money each represents; this tab
 * shows the buckets in rule order with the numbers each decision rests on,
 * and one-click actions that all go through POST /ai-access/{id}/decision so
 * every change leaves an event behind. */

const STATE_TEXT = {
  open: null,
  not_sent: 'уведомление не ушло',
  waiting: 'ждёт руководителя',
  escalated: 'эскалация',
  confirmed: 'руководитель согласен снять',
  kept: 'оставлен',
  downgrade: 'понизить тариф',
  revoked: 'снято',
}

/** "N мест ждут решения · $X в месяц · продление Claude через D дней" */
export function DecisionSummary({ report, onImport }) {
  const s = report.summary
  const h = report.headline
  const imp = report.last_import
  const r = s.renewal
  return (
    <section className="itr-card aia-sum">
      <div className="aia-sum-line">
        <b>{s.open_seats}</b> {plural(s.open_seats, 'место ждёт', 'места ждут', 'мест ждут')} решения
        {' · '}<b>{money(s.open_money_month)}</b> в месяц
        {r && <> · продление {r.service} {r.days === 0 ? 'сегодня' : `через ${r.days} ${plural(r.days, 'день', 'дня', 'дней')}`}</>}
      </div>
      <div className="aia-sum-sub">
        {s.waiting > 0 && <span>у руководителей: {s.waiting}</span>}
        {s.escalated > 0 && <span className="aia-bad">эскалация: {s.escalated}</span>}
        {s.notify_failed > 0 && <span className="aia-warn-cell">уведомление не ушло: {s.notify_failed}</span>}
        {s.confirmed > 0 && <span>согласовано к снятию: {s.confirmed}</span>}
        {h.seats_before !== h.seats_now && (
          <span className="aia-good">
            было {h.seats_before} {plural(h.seats_before, 'место', 'места', 'мест')}, стало {h.seats_now}
            {h.saving_month > 0 && `, экономия ${money(h.saving_month)}`}
            {h.saving_from && ` с ${fmtDate(h.saving_from)}`}
          </span>
        )}
      </div>
      <div className="aia-sum-import">
        <span className="aia-muted">
          {imp ? `Использование: выгрузка ${imp.service}, данные на ${fmtDate(imp.as_of)} · загружено ${fmtDate(imp.created_at)} · ${imp.rows_matched} совпало, ${imp.rows_new} новых, ${imp.rows_missing} нет в выгрузке` : 'Выгрузок ещё не было — цифры использования из ручного ввода'}
        </span>
        <button type="button" className="itr-btn itr-btn-sm" onClick={onImport}>Загрузить выгрузку</button>
      </div>
    </section>
  )
}

export function DecisionMetrics({ report, onShowPeople }) {
  const m = report.metrics
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)
  return (
    <div className="aia-strip">
      <span>Решение принято: <b>{m.decided}</b> / {m.active}</span>
      <span>Без руководителя: <Num className="aia-numlink-blue" onClick={() => onShowPeople('no_manager')}><b>{m.no_manager}</b></Num></span>
      <span>От предложения до снятия: <b>{m.avg_days_to_revoke == null ? '—' : `${m.avg_days_to_revoke} дн.`}</b></span>
      <span>Экономия уже идёт: <b>{money(m.saving_counted_month)}</b>/мес</span>
      <span>Ноль за 90 дней: <b>{pct(m.zero_90_share)}</b>
        {m.with_usage ? <span className="aia-muted"> ({m.zero_90} из {m.with_usage})</span> : null}</span>
    </div>
  )
}

/* ── bucket card ───────────────────────────────────────────────────────── */

export function BucketCard({ bucket: b, pending, actions, onOpenPerson }) {
  const [showDone, setShowDone] = useState(false)
  if (!b.count) {
    return (
      <div className="aia-bucket-empty">
        <b>{b.title}</b> · {b.rule} · <span>0</span>
      </div>
    )
  }
  const live = b.seats.filter((r) => !['kept', 'downgrade'].includes(r.state))
  const done = b.seats.filter((r) => ['kept', 'downgrade'].includes(r.state))
  return (
    <section className={`itr-card aia-bucket aia-bucket-${b.key}`}>
      <header className="aia-bucket-head">
        <div>
          <h3>{b.title}</h3>
          <div className="aia-muted">{b.rule}</div>
        </div>
        <div className="aia-bucket-nums">
          <div><b>{b.count}</b> {plural(b.count, 'место', 'места', 'мест')}{b.open !== b.count && <span className="aia-muted"> · ждут решения {b.open}</span>}</div>
          <div className="aia-muted">{money(b.money_month)}/мес</div>
        </div>
      </header>
      <div className="aia-seats">
        {live.map((r) => (
          <SeatRow key={r.id} r={pending[r.id] ? { ...r, ...pending[r.id] } : r} busy={!!pending[r.id]}
            actions={actions} onOpenPerson={onOpenPerson} />
        ))}
        {done.length > 0 && (
          <button type="button" className="aia-done-toggle" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Скрыть' : 'Показать'} решённые · {done.length}
          </button>
        )}
        {showDone && done.map((r) => (
          <SeatRow key={r.id} r={r} actions={actions} onOpenPerson={onOpenPerson} dim />
        ))}
      </div>
    </section>
  )
}

function SeatRow({ r, busy, dim, actions, onOpenPerson }) {
  const state = STATE_TEXT[r.state]
  const canAct = ['open', 'not_sent'].includes(r.state)
  const inLoop = ['waiting', 'escalated'].includes(r.state)
  return (
    <div className={`aia-seat${dim ? ' aia-seat-dim' : ''}${busy ? ' aia-seat-busy' : ''}`}>
      <div className="aia-seat-who">
        <Num className="aia-person" onClick={() => onOpenPerson(r.id)}>{r.person_name}</Num>
        <div className="aia-muted">{r.person_email}</div>
      </div>
      <div className="aia-seat-mgr">
        {r.has_manager ? (
          <>
            <div>{r.manager_name || r.manager_email}</div>
            {r.manager_name && r.manager_email && <div className="aia-muted">{r.manager_email}</div>}
            {!r.manager_email && <Num className="aia-muted aia-numlink-blue" onClick={() => actions.manager(r)}>нет почты — указать</Num>}
          </>
        ) : (
          <button type="button" className="itr-btn itr-btn-sm" onClick={() => actions.manager(r)}>Назначить руководителя</button>
        )}
      </div>
      <div className="aia-seat-plan">
        <div>{r.plan || <span className="aia-muted">—</span>}</div>
        <div className="aia-muted">{r.seat_cost != null ? `${money(r.seat_cost, 2)}/мес` : r.service_name}</div>
        {r.role && /admin|owner/i.test(r.role) && <div className="aia-muted">{r.role}</div>}
      </div>
      <div className="aia-seat-usage" title="Обращений за 30 / 60 / 90 дней">
        <span className="aia-usage">
          {USAGE_WINDOWS.map((w) => {
            const v = r[`usage_${w}d`]
            return (
              <Num key={w} onClick={() => onOpenPerson(r.id, w)} className={v === 0 ? 'aia-zero' : ''}>{v ?? '—'}</Num>
            )
          })}
        </span>
        <div className="aia-muted aia-tiny">30 / 60 / 90</div>
      </div>
      <div className="aia-seat-state">
        {state && (
          <span className={`aia-state aia-state-${r.state}`}>
            {state}
            {r.state === 'waiting' && r.manager_notified_at && ` с ${fmtDate(r.manager_notified_at)}`}
            {r.state === 'kept' && r.keep_review_due && ` до ${fmtDate(r.keep_review_due)}`}
            {r.state === 'downgrade' && r.target_plan && ` → ${r.target_plan}`}
          </span>
        )}
        {r.state === 'not_sent' && r.manager_notify_error && <div className="aia-muted">{r.manager_notify_error}</div>}
        {['kept', 'downgrade'].includes(r.state) && r.decision_reason && <div className="aia-muted">{r.decision_reason}</div>}
        {r.duplicate_of && <div className="aia-muted">второе место; первое — <Num className="aia-numlink-blue" onClick={() => onOpenPerson(r.duplicate_of)}>#{r.duplicate_of}</Num></div>}
      </div>
      <div className="aia-seat-actions">
        {canAct && (
          <>
            <button type="button" className="itr-btn itr-btn-sm itr-btn-danger" disabled={busy}
              onClick={() => actions.propose(r)}>
              {r.state === 'not_sent' ? 'Отправить ещё раз' : 'Предложить снять'}
            </button>
            <button type="button" className="itr-btn itr-btn-sm" disabled={busy} onClick={() => actions.downgrade(r)}>Понизить тариф</button>
            <button type="button" className="itr-btn itr-btn-sm" disabled={busy} onClick={() => actions.keep(r)}>Оставить</button>
          </>
        )}
        {inLoop && (
          <>
            <button type="button" className="itr-btn itr-btn-sm" disabled={busy} onClick={() => actions.renotify(r)}>Напомнить</button>
            <button type="button" className="itr-btn itr-btn-sm" disabled={busy} onClick={() => actions.answer(r)}>Ответ руководителя</button>
          </>
        )}
        {r.state !== 'kept' && (
          <button type="button" className={`itr-btn itr-btn-sm${r.state === 'confirmed' ? ' itr-btn-primary' : ''}`}
            disabled={busy} onClick={() => actions.revoked(r)}>Снято</button>
        )}
      </div>
    </div>
  )
}

/* ── dialogs ───────────────────────────────────────────────────────────── */

export function KeepDialog({ seat, title = 'Оставить место', onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog label={title} onCancel={onCancel} onSubmit={async () => {
      if (!reason.trim()) return
      setBusy(true)
      try { await onConfirm(reason.trim()) } finally { setBusy(false) }
    }}>
      <p className="itr-hint">{seat.person_name} · {seat.plan || 'место'} · пересмотр через 90 дней ({fmtDate(addDays(90))}).</p>
      <label className="itr-field aia-f">
        <span className="itr-label">Почему оставляем *</span>
        <textarea className="itr-textarea" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="В отпуске до…, проект стартует в ноябре, нужен для…" />
      </label>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={!reason.trim() || busy}>Оставить</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}

export function DowngradeDialog({ seat, onCancel, onConfirm }) {
  const [plan, setPlan] = useState(/premium/i.test(seat.plan || '') ? 'Standard' : '')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = seat.seat_cost != null && price !== '' && !Number.isNaN(Number(price))
    ? Math.max(0, Math.round((seat.seat_cost - Number(price)) * 100) / 100) : null
  return (
    <Dialog label="Понизить тариф" onCancel={onCancel} onSubmit={async () => {
      if (!plan.trim()) return
      setBusy(true)
      try { await onConfirm({ target_plan: plan.trim(), saving_month: saving }) } finally { setBusy(false) }
    }}>
      <p className="itr-hint">{seat.person_name} · сейчас {seat.plan || '—'}{seat.seat_cost != null && ` · ${money(seat.seat_cost, 2)}/мес`}</p>
      <div className="itr-row">
        <label className="itr-field aia-f">
          <span className="itr-label">Новый тариф *</span>
          <input className="itr-input" autoFocus value={plan} onChange={(e) => setPlan(e.target.value)} />
        </label>
        <label className="itr-field aia-f">
          <span className="itr-label">Цена нового, $/мес</span>
          <input className="itr-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>
      <p className="itr-hint">Экономия: {saving == null ? 'укажите цену нового тарифа' : `${money(saving, 2)}/мес`}</p>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={!plan.trim() || busy}>Понизить</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}

export function RevokedDialog({ seat, renewal, onCancel, onConfirm }) {
  const [revokedAt, setRevokedAt] = useState(today())
  const [starts, setStarts] = useState(renewal || today())
  const [saving, setSaving] = useState(seat.seat_cost != null ? String(seat.seat_cost) : '')
  const [reason, setReason] = useState(seat.bucket === 'revoke' ? 'ноль обращений за 90 дней' : '')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog label="Место снято" onCancel={onCancel} onSubmit={async () => {
      setBusy(true)
      try {
        await onConfirm({ revoked_at: revokedAt, saving_starts_at: starts, saving_month: saving === '' ? null : saving, reason })
      } finally { setBusy(false) }
    }}>
      <p className="itr-hint">{seat.person_name} · {seat.person_email}. Экономия считается со дня, когда перестанет приходить счёт — обычно с продления.</p>
      <div className="itr-row">
        <label className="itr-field aia-f">
          <span className="itr-label">Снято</span>
          <input className="itr-input" type="date" value={revokedAt} onChange={(e) => setRevokedAt(e.target.value)} />
        </label>
        <label className="itr-field aia-f">
          <span className="itr-label">Экономия с</span>
          <input className="itr-input" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
        </label>
      </div>
      <div className="itr-row">
        <label className="itr-field aia-f">
          <span className="itr-label">Экономия $/мес</span>
          <input className="itr-input" inputMode="decimal" value={saving} onChange={(e) => setSaving(e.target.value)} />
        </label>
        <label className="itr-field aia-f">
          <span className="itr-label">Причина</span>
          <input className="itr-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={busy}>Отметить снятым</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}

/** Recorded on the manager's behalf — they answered in chat, not via the link. */
export function AnswerDialog({ seat, onCancel, onConfirm }) {
  const [response, setResponse] = useState('confirm')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = response === 'confirm' || reason.trim()
  return (
    <Dialog label="Ответ руководителя" onCancel={onCancel} onSubmit={async () => {
      if (!ok) return
      setBusy(true)
      try { await onConfirm({ response, reason: reason.trim() }) } finally { setBusy(false) }
    }}>
      <p className="itr-hint">{seat.person_name} · руководитель {seat.manager_name || seat.manager_email}</p>
      <div className="itr-field aia-f">
        <label className="aia-radio"><input type="radio" checked={response === 'confirm'} onChange={() => setResponse('confirm')} /> Согласен снять</label>
        <label className="aia-radio"><input type="radio" checked={response === 'keep'} onChange={() => setResponse('keep')} /> Оставить</label>
      </div>
      {response === 'keep' && (
        <label className="itr-field aia-f">
          <span className="itr-label">Почему оставить *</span>
          <textarea className="itr-textarea" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={!ok || busy}>Записать</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}

/** Search over team members and people already in the register; anything
 * typed that matches nobody can still be saved as written. */
export function ManagerDialog({ seat, people, team, onCancel, onConfirm }) {
  const [query, setQuery] = useState('')
  const [name, setName] = useState(/не найден/i.test(seat.manager_name || '') ? '' : (seat.manager_name || ''))
  const [email, setEmail] = useState(seat.manager_email || '')
  const [busy, setBusy] = useState(false)
  const known = useMemo(() => {
    const out = new Map()
    // Managers already named on other seats come first: that is who this
    // seat's manager most likely is.
    for (const p of people) {
      const n = (p.manager_name || '').trim()
      if (!n || /не найден/i.test(n)) continue
      const key = (p.manager_email || n).toLowerCase()
      if (!out.has(key)) out.set(key, { name: n, email: p.manager_email || '', group: 'managers' })
    }
    for (const m of team) {
      const key = (m.email || m.name || '').toLowerCase()
      if (m.name && !out.has(key)) out.set(key, { name: m.name, email: m.email || '', group: 'team' })
    }
    for (const p of people) {
      const key = (p.person_email || '').toLowerCase()
      if (key && !out.has(key)) out.set(key, { name: p.person_name, email: p.person_email, group: 'people' })
    }
    return [...out.values()]
  }, [people, team])
  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return known.filter((k) => `${k.name} ${k.email}`.toLowerCase().includes(q)).slice(0, 10)
      .map((k) => ({ key: k.email || k.name, label: k.name, sublabel: k.email, group: k.group, k }))
  }, [known, query])
  const valid = name.trim() && (!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
  return (
    <Dialog label="Руководитель" onCancel={onCancel} onSubmit={async () => {
      if (!valid) return
      setBusy(true)
      try { await onConfirm({ manager_name: name.trim(), manager_email: email.trim().toLowerCase() }) } finally { setBusy(false) }
    }}>
      <p className="itr-hint">{seat.person_name} · {seat.department || seat.person_email}. Почта нужна, чтобы руководитель получил сообщение в Slack.</p>
      <div className="itr-field aia-f">
        <span className="itr-label">Найти</span>
        <Combobox
          value={null}
          query={query}
          onQuery={setQuery}
          options={options}
          groupLabels={{ managers: 'Руководители', team: 'Команда', people: 'Из реестра' }}
          onSelect={(o) => { setName(o.k.name); setEmail(o.k.email || ''); setQuery('') }}
          onClear={() => {}}
          placeholder="Имя или почта"
          emptyText="Никого не нашли — впишите ниже"
          footer={query.trim() ? { label: `Записать «${query.trim()}»`, onSelect: () => { setName(query.trim()); setQuery('') } } : null}
          autoFocus
        />
      </div>
      <div className="itr-row">
        <label className="itr-field aia-f">
          <span className="itr-label">Имя *</span>
          <input className="itr-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="itr-field aia-f">
          <span className="itr-label">Почта</span>
          <input className="itr-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={!valid || busy}>Сохранить</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}

function addDays(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
