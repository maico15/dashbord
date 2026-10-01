import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { api } from '../api/client'
import AppFooter from '../components/AppFooter'
import PasswordField from '../components/PasswordField'
import { I18N, readLang } from '../i18n/itRequests'
import { RequestsStyle, Segmented } from './itRequestsStyle'
import { AI_TOOLS, AI_TOOL, aiToolName, guessAiTool } from '../lib/aiTools'

/* AI access register — who uses which AI tool, on whose approval, at what cost.
 * Admin-only (sessionStorage.admin_pw, like /it-backlog) and not in the tab bar:
 * the footer's Admin group and the direct URL are the ways in.
 *
 * Three things make it a register rather than a list, and the row tint follows
 * them: who approved the seat and when, what it costs, and when the person last
 * used it. The flags are computed by the backend so this page, the KPI cards
 * and the CSV can never disagree. */

const STATUSES = [
  { value: 'pending',   label: 'Ожидает' },
  { value: 'active',    label: 'Активен' },
  { value: 'to_revoke', label: 'К отзыву' },
  { value: 'revoked',   label: 'Отозван' },
]
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]))
const EMPLOYMENT = [
  { value: 'active',     label: 'Работает' },
  { value: 'contractor', label: 'Подрядчик' },
  { value: 'terminated', label: 'Уволен' },
  { value: 'unknown',    label: 'Неизвестно' },
]
const PW_TEXT = (I18N[readLang('ru')] || I18N.ru).common
const APPROVER_KEY = 'ai_access_approver'

const EMPTY = {
  person_name: '', person_email: '', department: '', manager_name: '', manager_email: '',
  employment: 'active', tool: 'claude', tool_other: '', plan: '', cost_month: '',
  cost_note: '', justification: '', approved_by: '', approved_at: '', request_ref: '',
  granted_at: '', last_used_at: '', last_verified_at: '', status: 'pending',
  revoked_at: '', revoke_reason: '', notes: '',
}

/* ── formatting ────────────────────────────────────────────────────────── */

const today = () => new Date().toISOString().slice(0, 10)

/** "2026-09-24" → "24 сент. 2026". Dates here are calendar days, so they are
 * read as such and never shifted by the reader's time zone. */
function fmtDate(value) {
  const s = String(value || '').slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return value || ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).formatToParts(d)
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || ''
  return `${get('day')} ${get('month').replace(/\s+г\.?$/, '')} ${get('year')}`
}

function money(n, digits = 0) {
  if (n == null || n === '') return '—'
  return `$${Number(n).toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits || 2,
  })}`
}

function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function rowTone(r) {
  if (r.flag_terminated) return 'red'
  if (r.flag_no_approval || r.flag_unused) return 'amber'
  return ''
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default function AIAccess() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('admin_pw') || '')
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')

  const [items, setItems] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [tool, setTool] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)     // row, or EMPTY for a new one
  const [revoking, setRevoking] = useState(null)   // row awaiting a reason
  const [approver, setApprover] = useState(() => {
    try { return localStorage.getItem(APPROVER_KEY) || '' } catch { return '' }
  })
  const approverRef = useRef(null)

  const dropPassword = () => {
    sessionStorage.removeItem('admin_pw')
    setPw('')
  }

  const load = useCallback(() => {
    if (!pw) return
    const p = encodeURIComponent(pw)
    setLoading(true)
    Promise.all([api.get(`/ai-access?password=${p}`), api.get(`/ai-access/stats?password=${p}`)])
      .then(([list, s]) => { setItems(list.items || []); setStats(s); setError('') })
      .catch((e) => {
        if (String(e.message || '').includes('Unauthorized')) dropPassword()
        else setError(String(e.message || 'Не удалось загрузить реестр'))
      })
      .finally(() => setLoading(false))
  }, [pw])

  useEffect(() => { load() }, [load])

  const saveApprover = (value) => {
    setApprover(value)
    try { localStorage.setItem(APPROVER_KEY, value) } catch { /* private window */ }
  }

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

  /** Every write goes through here: the row comes back from the server with its
   * flags recomputed, and the cards are re-read because a write moves them. */
  const write = async (fn) => {
    setError('')
    try {
      const res = await fn()
      if (res && res.item) {
        setItems((list) => {
          const found = list.some((r) => r.id === res.item.id)
          return found ? list.map((r) => (r.id === res.item.id ? res.item : r)) : [...list, res.item]
        })
      }
      api.get(`/ai-access/stats?password=${encodeURIComponent(pw)}`).then(setStats).catch(() => {})
      return res
    } catch (e) {
      const msg = String(e.message || '')
      if (msg.includes('Unauthorized')) dropPassword()
      setError(`Не удалось сохранить: ${msg || 'ошибка сети'}`)
      throw e
    }
  }

  const approve = (row) => {
    const who = approver.trim()
    if (!who) {
      setError('Укажите, кто согласует, — поле «Согласующий» вверху страницы')
      approverRef.current?.focus()
      return
    }
    write(() => api.patch(`/ai-access/${row.id}`, {
      approved_by: who,
      approved_at: today(),
      status: 'active',
      granted_at: row.granted_at || today(),
    }, pw)).catch(() => {})
  }

  const revoke = async (row, reason) => {
    await write(() => api.post(`/ai-access/${row.id}/revoke`, { reason }, pw))
    setRevoking(null)
  }

  const exportCsv = async () => {
    // Fetched as a blob rather than opened as a URL, so the password never lands
    // in the browser history or a download manager's log.
    setError('')
    try {
      const base = (import.meta.env.VITE_API_URL || '').startsWith('http')
        ? `${import.meta.env.VITE_API_URL}/api` : `${window.location.origin}/api`
      const res = await fetch(`${base}/ai-access/export.csv?password=${encodeURIComponent(pw)}`)
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-access-${today()}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(`Не удалось выгрузить CSV: ${String(e.message || '')}`)
    }
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((r) => (
      (!status || r.status === status)
      && (!tool || r.tool === tool)
      && (!needle || [r.person_name, r.person_email, r.manager_name, r.department]
        .some((v) => String(v || '').toLowerCase().includes(needle)))
    ))
  }, [items, status, tool, q])

  const counts = useMemo(() => {
    const out = { '': items.length }
    for (const r of items) out[r.status] = (out[r.status] || 0) + 1
    return out
  }, [items])

  // Only tools that appear in the register get a segment, so the control does
  // not carry eight empty options on a fresh install.
  const toolOptions = useMemo(() => {
    const present = new Set(items.map((r) => r.tool))
    return [{ value: '', label: 'Все' },
      ...AI_TOOLS.filter((t) => present.has(t.key)).map((t) => ({ value: t.key, label: t.label }))]
  }, [items])

  if (!pw) {
    return (
      <div className="itr-page">
        <RequestsStyle />
        <main className="itr-main">
          <header className="itr-head">
            <div className="itr-head-main">
              <h1 className="itr-title">Реестр AI-доступов</h1>
              <p className="itr-sub">Кто и каким AI-инструментом пользуется, по чьему согласованию и за сколько.</p>
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

  return (
    <div className="itr-page">
      <RequestsStyle />
      <main className="itr-main itr-main-wide">
        <header className="itr-head">
          <div className="itr-head-main">
            <h1 className="itr-title">Реестр AI-доступов</h1>
            <p className="itr-sub">Кто и каким AI-инструментом пользуется, по чьему согласованию и за сколько.</p>
          </div>
          <label className="aia-approver">
            <span>Согласующий</span>
            <input
              ref={approverRef}
              className="itr-input"
              value={approver}
              onChange={(e) => saveApprover(e.target.value)}
              placeholder="Ваше имя"
            />
          </label>
          <div className="itr-actions">
            <button className="itr-btn" type="button" onClick={exportCsv}>Export CSV</button>
            <button className="itr-btn itr-btn-primary" type="button" onClick={() => setEditing(EMPTY)}>
              ＋ Добавить доступ
            </button>
          </div>
        </header>

        <Kpis stats={stats} />

        <section className="itr-card aia-filters">
          <Segmented
            name="Статус"
            value={status}
            onChange={setStatus}
            options={[{ value: '', label: `Все · ${counts[''] || 0}` },
              ...STATUSES.map((s) => ({ value: s.value, label: `${s.label} · ${counts[s.value] || 0}` }))]}
          />
          {toolOptions.length > 2 && (
            <Segmented name="Инструмент" value={tool} onChange={setTool} options={toolOptions} />
          )}
          <input
            className="itr-input aia-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: человек, почта, руководитель, отдел"
          />
        </section>

        {error && <div className="itr-err aia-error" role="alert">{error}</div>}

        <section className="itr-card aia-tablecard">
          {loading && !items.length ? (
            <div className="itr-empty">Загружаю…</div>
          ) : !visible.length ? (
            <div className="itr-empty">
              {items.length ? 'Под фильтр ничего не попало.' : 'В реестре пока нет ни одного доступа.'}
            </div>
          ) : (
            <table className="aia-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Отдел</th>
                  <th>Руководитель</th>
                  <th>Инструмент</th>
                  <th>Тариф</th>
                  <th className="aia-num">$/мес</th>
                  <th>Согласовано</th>
                  <th>Выдан</th>
                  <th>Последний вход</th>
                  <th>Статус</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <Row
                    key={r.id}
                    row={r}
                    onEdit={() => setEditing(r)}
                    onApprove={() => approve(r)}
                    onRevoke={() => setRevoking(r)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="aia-legend">
          <span><i className="aia-sw aia-sw-amber" />нет записи о согласовании или не заходил больше 30 дней</span>
          <span><i className="aia-sw aia-sw-red" />уволен, а доступ активен</span>
          <span className="aia-legend-note">Стоимость считается по местам «Активен» и «К отзыву»; отозванные в сумму не входят.</span>
        </div>
      </main>

      {editing && (
        <Panel
          initial={editing}
          pw={pw}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const res = await write(() => (editing.id
              ? api.patch(`/ai-access/${editing.id}`, body, pw)
              : api.post('/ai-access', body, pw)))
            setEditing(null)
            return res
          }}
          onDelete={editing.id ? async () => {
            await write(() => api.del(`/ai-access/${editing.id}`, pw))
            setItems((list) => list.filter((r) => r.id !== editing.id))
            setEditing(null)
          } : null}
        />
      )}

      {revoking && (
        <RevokeDialog
          row={revoking}
          onCancel={() => setRevoking(null)}
          onConfirm={(reason) => revoke(revoking, reason).catch(() => {})}
        />
      )}

      <AppFooter lang="ru" />
      <style>{CSS}</style>
    </div>
  )
}

/* ── KPI cards ─────────────────────────────────────────────────────────── */

function Kpis({ stats }) {
  const s = stats || {}
  const seats = s.seats_active ?? 0
  const tools = s.tools_active ?? 0
  return (
    <section className="aia-kpis">
      <div className="aia-kpi">
        <div className="aia-kpi-label">Активных мест</div>
        <div className="aia-kpi-value">{stats ? seats : '—'}</div>
        <div className="aia-kpi-sub">{tools} {plural(tools, 'инструмент', 'инструмента', 'инструментов')}</div>
      </div>
      <div className="aia-kpi">
        <div className="aia-kpi-label">В месяц</div>
        <div className="aia-kpi-value">{stats ? money(s.cost_month_total) : '—'}</div>
        <div className="aia-kpi-sub">{stats ? `${money(s.cost_year_total)} в год` : ''}</div>
      </div>
      <div className={`aia-kpi${s.no_approval ? ' aia-kpi-amber' : ''}`}>
        <div className="aia-kpi-label">Без согласования</div>
        <div className="aia-kpi-value">{stats ? s.no_approval : '—'}</div>
        <div className="aia-kpi-sub">
          {stats ? `${s.unused_30d} не заходили 30+ дней` : ''}
        </div>
      </div>
      <div className={`aia-kpi${s.terminated_active ? ' aia-kpi-red' : ''}`}>
        <div className="aia-kpi-label">Уволены, доступ жив</div>
        <div className="aia-kpi-value">{stats ? s.terminated_active : '—'}</div>
        <div className="aia-kpi-sub">отозвать в первую очередь</div>
      </div>
    </section>
  )
}

/* ── table row ─────────────────────────────────────────────────────────── */

function Row({ row: r, onEdit, onApprove, onRevoke }) {
  const tone = rowTone(r)
  const tool = AI_TOOL[r.tool] || AI_TOOL.other
  const reasons = [
    r.flag_terminated && 'уволен, доступ активен',
    r.flag_no_approval && 'нет записи о согласовании',
    r.flag_unused && 'не заходил больше 30 дней',
  ].filter(Boolean)
  const canApprove = r.status !== 'revoked' && (r.flag_no_approval || r.status === 'pending')
  return (
    <tr className={tone ? `aia-tone-${tone}` : ''} title={reasons.join(' · ') || undefined}>
      <td data-label="Сотрудник">
        <div className="aia-person">{r.person_name}</div>
        <div className="aia-muted">{r.person_email}</div>
        {r.employment && r.employment !== 'active' && (
          <div className={`aia-emp aia-emp-${r.employment}`}>
            {(EMPLOYMENT.find((e) => e.value === r.employment) || {}).label}
          </div>
        )}
      </td>
      <td data-label="Отдел">{r.department || <span className="aia-muted">—</span>}</td>
      <td data-label="Руководитель">{r.manager_name || <span className="aia-muted">—</span>}</td>
      <td data-label="Инструмент">
        <span className="aia-tool"><i style={{ background: tool.color }} />{aiToolName(r)}</span>
      </td>
      <td data-label="Тариф">{r.plan || <span className="aia-muted">—</span>}</td>
      <td data-label="$/мес" className="aia-num">
        {r.cost_month != null ? money(r.cost_month, 2) : <span className="aia-muted">{r.cost_note || '—'}</span>}
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
      <td data-label="Выдан" className="aia-date">{r.granted_at ? fmtDate(r.granted_at) : <span className="aia-muted">—</span>}</td>
      <td data-label="Последний вход" className={`aia-date${r.flag_unused ? ' aia-warn-cell' : ''}`}>
        {r.last_used_at ? fmtDate(r.last_used_at) : <span className="aia-muted">нет данных</span>}
      </td>
      <td data-label="Статус">
        <span className={`itr-pill aia-pill-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
        {r.status === 'revoked' && r.revoked_at && (
          <div className="aia-muted">{fmtDate(r.revoked_at)}</div>
        )}
      </td>
      <td className="aia-actions">
        <div className="aia-actions-stack">
        <button type="button" className="itr-btn itr-btn-sm" onClick={onEdit}>Изменить</button>
        {canApprove && (
          <button type="button" className="itr-btn itr-btn-sm itr-btn-green" onClick={onApprove}>
            Согласовать
          </button>
        )}
        {r.status !== 'revoked' && (
          <button type="button" className="itr-btn itr-btn-sm itr-btn-danger" onClick={onRevoke}>
            Отозвать
          </button>
        )}
        </div>
      </td>
    </tr>
  )
}

/* ── side panel ────────────────────────────────────────────────────────── */

function Panel({ initial, pw, onClose, onSave, onDelete }) {
  const isNew = !initial.id
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY }
    for (const k of Object.keys(EMPTY)) {
      if (initial[k] != null) base[k] = String(initial[k])
    }
    return base
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [hint, setHint] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  /* A new row whose email already filed an IT request starts from that request:
   * the person, their department and the ref. Only empty fields are filled, so
   * nothing typed is overwritten. An access request for an AI tool wins over the
   * newest request of any other kind. */
  const prefillFromRequest = async () => {
    const email = form.person_email.trim()
    if (!isNew || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return
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
    if (!form.person_name.trim() || !form.person_email.trim()) {
      setErr('Имя и почта обязательны')
      return
    }
    if (form.tool === 'other' && !form.tool_other.trim()) {
      setErr('Укажите, какой инструмент')
      return
    }
    setSaving(true)
    try {
      const body = { ...form, cost_month: form.cost_month === '' ? null : form.cost_month }
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

  return (
    <div className="aia-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="aia-panel" role="dialog" aria-modal="true"
        aria-label={isNew ? 'Новый доступ' : 'Изменить доступ'}>
        <form onSubmit={submit} className="aia-panel-form">
          <div className="aia-panel-head">
            <h2>{isNew ? 'Новый доступ' : form.person_name || 'Доступ'}</h2>
            <button type="button" className="aia-close" onClick={onClose} aria-label="Закрыть">×</button>
          </div>

          <div className="aia-panel-body">
            <h3 className="itr-card-title">Сотрудник</h3>
            <div className="itr-row">
              {field('person_email', 'Почта *', { type: 'email', onBlur: prefillFromRequest, autoFocus: isNew })}
              {field('person_name', 'Имя *')}
            </div>
            {hint && <div className="itr-hint aia-prefill">{hint}</div>}
            <div className="itr-row">
              {field('department', 'Отдел')}
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
            <div className="itr-row">
              {field('cost_month', '$ в месяц за место', { inputMode: 'decimal', placeholder: 'пусто — по использованию' })}
              {field('cost_note', 'Комментарий к цене', { placeholder: 'usage-based, входит в workspace…' })}
            </div>
            <label className="itr-field aia-f">
              <span className="itr-label">Зачем нужен доступ</span>
              <textarea className="itr-textarea" rows={2} value={form.justification} onChange={set('justification')} />
            </label>

            <h3 className="itr-card-title">Согласование и использование</h3>
            <div className="itr-row">
              {field('approved_by', 'Кто согласовал')}
              {field('approved_at', 'Когда', { type: 'date' })}
            </div>
            <div className="itr-row">
              {field('request_ref', 'Заявка в IT', { placeholder: 'IT-0001' })}
              {field('granted_at', 'Выдан', { type: 'date' })}
            </div>
            <div className="itr-row">
              {field('last_used_at', 'Последний вход', { type: 'date' })}
              {field('last_verified_at', 'Проверено', { type: 'date' })}
            </div>

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
              {onDelete && (confirmDelete ? (
                <button className="itr-btn itr-btn-danger aia-del" type="button"
                  onClick={() => onDelete().catch(() => {})}>
                  Точно удалить?
                </button>
              ) : (
                <button className="itr-btn itr-btn-danger aia-del" type="button"
                  onClick={() => setConfirmDelete(true)}>
                  Удалить
                </button>
              ))}
            </div>
          </div>
        </form>
      </aside>
    </div>
  )
}

/* ── revoke dialog ─────────────────────────────────────────────────────── */

function RevokeDialog({ row, onCancel, onConfirm }) {
  const [reason, setReason] = useState(row.flag_terminated ? 'Сотрудник уволен' : '')
  const [busy, setBusy] = useState(false)
  return (
    <div className="aia-overlay aia-overlay-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <form
        className="itr-card aia-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Отозвать доступ"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!reason.trim()) return
          setBusy(true)
          await onConfirm(reason.trim())
          setBusy(false)
        }}
      >
        <h2 className="aia-dialog-title">Отозвать доступ</h2>
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
          <button className="itr-btn itr-btn-danger" type="submit" disabled={!reason.trim() || busy}>
            Отозвать
          </button>
          <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
        </div>
      </form>
    </div>
  )
}

const CSS = `
.aia-pw{flex:1 1 220px;max-width:320px}
.aia-approver{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:var(--ios-label3,#6D6D72);width:190px}
.aia-approver .itr-input{text-transform:none;letter-spacing:0;font-weight:400;background:var(--ios-card,#fff);
  box-shadow:var(--ios-shadow-btn,0 1px 2px rgba(0,0,0,.08))}

.aia-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
.aia-kpi{background:var(--ios-card,#fff);border-radius:14px;box-shadow:var(--ios-shadow,0 1px 3px rgba(0,0,0,.06));
  padding:14px 16px;border-left:4px solid transparent}
.aia-kpi-amber{border-left-color:var(--ios-orange,#FF9500)}
.aia-kpi-red{border-left-color:#FF3B30}
.aia-kpi-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.aia-kpi-value{font-size:28px;font-weight:700;letter-spacing:-.5px;margin-top:4px;font-variant-numeric:tabular-nums}
.aia-kpi-sub{font-size:12.5px;color:var(--ios-label2,#636366);margin-top:2px}

.aia-filters{display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center;padding:12px 14px}
.aia-search{flex:1 1 240px;width:auto;min-width:0}
.aia-error{margin:0 0 12px}

.aia-tablecard{padding:0;overflow:hidden}
.aia-table{width:100%;border-collapse:collapse;font-size:13px}
.aia-table th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ios-label3,#6D6D72);padding:10px 8px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);white-space:nowrap}
.aia-table td{padding:10px 8px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);vertical-align:top}
.aia-table tbody tr:last-child td{border-bottom:none}
.aia-table th:first-child,.aia-table td:first-child{padding-left:16px}
.aia-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.aia-tone-amber td{background:#FFF6E0}
.aia-tone-red td{background:#FFE8E6}
[data-theme="dark"] .aia-tone-amber td{background:#33270A}
[data-theme="dark"] .aia-tone-red td{background:#3A1310}
.aia-person{font-weight:600}
.aia-muted{color:var(--ios-label3,#6D6D72);font-size:12px}
.aia-ref{font-variant-numeric:tabular-nums}
.aia-missing{color:var(--ios-orange-text,#7A3E00);font-weight:600}
.aia-warn-cell{color:var(--ios-orange-text,#7A3E00);font-weight:600}
.aia-emp{display:inline-block;margin-top:3px;font-size:11px;font-weight:600;padding:1px 7px;border-radius:6px;
  background:var(--ios-bg,#F2F2F7);color:var(--ios-label2,#636366)}
.aia-emp-terminated{background:#FFD9D6;color:#9B1C15}
[data-theme="dark"] .aia-emp-terminated{background:#5A1C17;color:#FFC7C2}
.aia-tool{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.aia-tool i{width:10px;height:10px;border-radius:3px;flex:none}
.aia-pill-pending{background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91)}
.aia-pill-active{background:var(--ios-green-tint,#E3F6E8);color:var(--ios-green-text,#1E7A3A)}
.aia-pill-to_revoke{background:var(--ios-orange-tint,#FFE5CC);color:var(--ios-orange-text,#7A3E00)}
.aia-pill-revoked{background:var(--ios-sep,#E5E5EA);color:var(--ios-label2,#636366)}
.aia-date{white-space:nowrap}
.aia-tablecard{overflow-x:auto}
.aia-actions{width:1%}
.aia-actions-stack{display:flex;flex-direction:column;gap:5px;align-items:stretch}
.aia-actions .itr-btn{white-space:nowrap;padding:4px 10px;font-size:12px}
.aia-table td:last-child{padding-right:14px}
.aia-person,.aia-person+.aia-muted{overflow-wrap:anywhere}
@media(min-width:861px){.aia-table td:first-child{max-width:200px}}

.aia-legend{display:flex;gap:8px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--ios-label2,#636366);margin:4px 2px 0}
.aia-legend span{display:inline-flex;align-items:center;gap:7px}
.aia-legend-note{color:var(--ios-label3,#6D6D72)}
.aia-sw{width:14px;height:14px;border-radius:4px;display:inline-block}
.aia-sw-amber{background:#FFE7A8}
.aia-sw-red{background:#FFC9C4}

.aia-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:50;display:flex;justify-content:flex-end}
.aia-overlay-center{justify-content:center;align-items:center;padding:16px}
.aia-panel{width:min(560px,100%);height:100%;background:var(--ios-bg,#F2F2F7);box-shadow:-8px 0 30px rgba(0,0,0,.15)}
.aia-panel-form{display:flex;flex-direction:column;height:100%}
.aia-panel-head{display:flex;align-items:center;gap:10px;padding:16px 20px;background:var(--ios-card,#fff);
  border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-panel-head h2{margin:0;font-size:18px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aia-close{border:none;background:none;font-size:26px;line-height:1;cursor:pointer;color:var(--ios-label2,#636366);padding:0 4px}
.aia-panel-body{flex:1;overflow-y:auto;padding:16px 20px}
.aia-panel-body .itr-card-title{margin:18px 0 10px}
.aia-panel-body .itr-card-title:first-child{margin-top:0}
.aia-panel-body .itr-input,.aia-panel-body .itr-select,.aia-panel-body .itr-textarea{background:var(--ios-card,#fff)}
.aia-f{display:block;margin-bottom:12px}
.aia-prefill{margin:-6px 0 10px;color:var(--ios-green-text,#1E7A3A)}
.aia-panel-foot{padding:12px 20px;background:var(--ios-card,#fff);border-top:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-panel-err{margin:0 0 8px}
.aia-del{margin-left:auto}
.aia-dialog{width:min(440px,100%);margin:0}
.aia-dialog-title{margin:0 0 4px;font-size:18px;font-weight:700}

@media(max-width:1100px){
  .aia-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
}
/* Phone and narrow tablet: each row becomes a card, every cell labelled, so
 * nothing scrolls sideways. The tint still marks the whole card. */
@media(max-width:860px){
  .aia-approver{width:100%}
  .aia-table thead{display:none}
  .aia-table,.aia-table tbody,.aia-table tr,.aia-table td{display:block;width:100%;box-sizing:border-box}
  .aia-table tr{padding:10px 14px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
  .aia-table tbody tr:last-child{border-bottom:none}
  .aia-tone-amber{background:#FFF6E0}
  .aia-tone-red{background:#FFE8E6}
  [data-theme="dark"] .aia-tone-amber{background:#33270A}
  [data-theme="dark"] .aia-tone-red{background:#3A1310}
  .aia-table td{display:flex;gap:12px;padding:4px 0;border:none;background:transparent !important}
  .aia-table th:first-child,.aia-table td:first-child{padding-left:0}
  .aia-table td[data-label]::before{content:attr(data-label);flex:0 0 112px;font-size:11px;font-weight:600;
    letter-spacing:.03em;text-transform:uppercase;color:var(--ios-label3,#6D6D72);padding-top:2px}
  .aia-table td:first-child{display:block;padding-bottom:6px}
  .aia-table td:first-child::before{display:none}
  .aia-num{text-align:left}
  .aia-actions{width:100%;padding-top:8px !important}
  .aia-actions-stack{flex-direction:row;flex-wrap:wrap;gap:6px}
  .aia-date{white-space:normal}
}
@media(max-width:480px){
  .aia-kpi-value{font-size:23px}
  .aia-kpis{gap:10px}
  .aia-kpi{padding:12px}
}
`
