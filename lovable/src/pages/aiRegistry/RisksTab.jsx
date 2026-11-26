import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import { Segmented } from '../itRequestsStyle'
import { RISK_SEVERITIES, RISK_STATUSES, Drawer, DrawerHead, Dialog, today } from './shared'

/* Risks tab — a short list of what could go wrong with the AI estate. Each one
 * has an owner and a way onto the Gantt; "В задачи" creates the task through
 * the same POST /api/gantt the triage page uses and stores its id here. */

const STATUS_LABEL = Object.fromEntries(RISK_STATUSES.map((s) => [s.value, s.label]))
const SEV_LABEL = Object.fromEntries(RISK_SEVERITIES.map((s) => [s.value, s.label]))
const MAX_PROJECT = 70

export function RisksTable({ rows, onEdit, onStatus, onToGantt }) {
  return (
    <table className="aia-table">
      <thead>
        <tr>
          <th aria-label="Важность" />
          <th>Риск</th>
          <th>Подробности</th>
          <th>Владелец</th>
          <th>Статус</th>
          <th aria-label="Действия" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.status === 'closed' ? 'aia-tone-muted' : undefined}>
            <td data-label="Важность">
              <span className={`aia-sev aia-sev-${r.severity}`} title={SEV_LABEL[r.severity]} />
              <span className="aia-muted aia-sev-text"> {SEV_LABEL[r.severity]}</span>
            </td>
            <td data-label="Риск">
              <button type="button" className="aia-numlink aia-person" onClick={() => onEdit(r)}>{r.title}</button>
              {r.source && <div className="aia-muted">{r.source}</div>}
            </td>
            <td data-label="Подробности"><div className="aia-detail">{r.detail || <span className="aia-muted">—</span>}</div></td>
            <td data-label="Владелец">{r.owner || <span className="aia-missing">нет</span>}</td>
            <td data-label="Статус">
              <Segmented name="Статус риска" value={r.status} options={RISK_STATUSES}
                onChange={(v) => onStatus(r, v)} />
            </td>
            <td className="aia-actions">
              <div className="aia-actions-stack">
                {r.linked_gantt_id ? (
                  <a className="itr-btn itr-btn-sm" href="/team-gantt" title={`Задача #${r.linked_gantt_id} на Gantt`}>
                    Gantt #{r.linked_gantt_id}
                  </a>
                ) : (
                  <button type="button" className="itr-btn itr-btn-sm itr-btn-primary" onClick={() => onToGantt(r)}>
                    В задачи
                  </button>
                )}
                <button type="button" className="itr-btn itr-btn-sm" onClick={() => onEdit(r)}>Изменить</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const EMPTY_RISK = { severity: 'medium', title: '', detail: '', owner: '', status: 'open', source: '', notes: '', linked_gantt_id: '' }

export function RiskForm({ initial, onClose, onSave, onDelete }) {
  const isNew = !initial.id
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY_RISK }
    for (const k of Object.keys(EMPTY_RISK)) if (initial[k] != null) base[k] = String(initial[k])
    return base
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setErr('Название обязательно'); return }
    setSaving(true)
    setErr('')
    try {
      await onSave({ ...form, linked_gantt_id: form.linked_gantt_id === '' ? null : form.linked_gantt_id })
    } catch (ex) {
      setErr(String(ex.message || 'Не удалось сохранить'))
      setSaving(false)
    }
  }

  return (
    <Drawer label={isNew ? 'Новый риск' : 'Изменить риск'} onClose={onClose}>
      <form onSubmit={submit} className="aia-panel-form">
        <DrawerHead title={isNew ? 'Новый риск' : form.title || 'Риск'} onClose={onClose} />
        <div className="aia-panel-body">
          <label className="itr-field aia-f">
            <span className="itr-label">Риск *</span>
            <input className="itr-input" value={form.title} onChange={set('title')} autoFocus={isNew} />
          </label>
          <div className="itr-field aia-f">
            <span className="itr-label">Важность</span>
            <Segmented name="Важность" value={form.severity} options={RISK_SEVERITIES}
              onChange={(v) => setForm((f) => ({ ...f, severity: v }))} />
          </div>
          <label className="itr-field aia-f">
            <span className="itr-label">Подробности</span>
            <textarea className="itr-textarea" rows={4} value={form.detail} onChange={set('detail')} />
          </label>
          <div className="itr-row">
            <label className="itr-field aia-f">
              <span className="itr-label">Владелец</span>
              <input className="itr-input" value={form.owner} onChange={set('owner')} />
            </label>
            <label className="itr-field aia-f">
              <span className="itr-label">Источник</span>
              <input className="itr-input" value={form.source} onChange={set('source')} placeholder="аудит, счёт, заявка…" />
            </label>
          </div>
          <div className="itr-field aia-f">
            <span className="itr-label">Статус</span>
            <Segmented name="Статус" value={form.status} options={RISK_STATUSES}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))} />
          </div>
          <label className="itr-field aia-f">
            <span className="itr-label">Задача на Gantt (id)</span>
            <input className="itr-input" inputMode="numeric" value={form.linked_gantt_id} onChange={set('linked_gantt_id')} />
          </label>
          <label className="itr-field aia-f">
            <span className="itr-label">Заметки</span>
            <textarea className="itr-textarea" rows={2} value={form.notes} onChange={set('notes')} />
          </label>
        </div>
        <div className="aia-panel-foot">
          {err && <div className="itr-err aia-panel-err">{err}</div>}
          <div className="itr-actions">
            <button className="itr-btn itr-btn-primary" type="submit" disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
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

/** The bilingual note the Gantt expects, built from the risk. */
function riskNote(r) {
  const dash = '—'
  return [
    `TASK: ${r.title}`,
    `WHAT: ${r.detail || dash}`,
    `SOURCE: AI risk #${r.id}${r.source ? `, ${r.source}` : ''}`,
    '____ ru',
    `ЗАДАЧА: ${r.title}`,
    `ЧТО: ${r.detail || dash}`,
    `ИСТОЧНИК: AI-риск #${r.id}${r.source ? `, ${r.source}` : ''}`,
    'Реестр AI · /ai-access',
  ].join('\n')
}

/** "В задачи": pick the engineer (the risk's owner if they are one), then POST
 * the task and store its id on the risk. On failure the dialog stays open with
 * what was typed. */
export function GanttFromRisk({ risk, pw, onClose, onCreated }) {
  const [team, setTeam] = useState([])
  const [engineerId, setEngineerId] = useState('')
  const [project, setProject] = useState(String(risk.title || '').slice(0, MAX_PROJECT))
  const [startDate, setStartDate] = useState(today())
  const [estDays, setEstDays] = useState(risk.severity === 'high' ? 2 : 3)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.get('/team').then((d) => {
      const list = Array.isArray(d) ? d : (d.members || [])
      setTeam(list)
      const owner = String(risk.owner || '').trim().toLowerCase()
      const hit = owner && list.find((m) => m.name.toLowerCase() === owner
        || m.name.toLowerCase().split(' ').some((part) => part.length > 2 && owner.includes(part)))
      setEngineerId(String((hit || list[0] || {}).id || ''))
    }).catch(() => setErr('Не удалось загрузить команду'))
  }, [risk.owner])

  const submit = async () => {
    if (!engineerId) { setErr('Выберите исполнителя'); return }
    setBusy(true)
    setErr('')
    try {
      const created = await api.post('/gantt', {
        engineer_id: Number(engineerId),
        project: project.trim().slice(0, MAX_PROJECT) || risk.title.slice(0, MAX_PROJECT),
        start_date: startDate,
        est_days: Number(estDays) || 1,
        percent: 0,
        status: 'active',
        note: riskNote(risk),
      }, pw)
      const patch = { linked_gantt_id: created.id }
      if (risk.status === 'open') patch.status = 'in_progress'
      const res = await api.patch(`/ai-risks/${risk.id}`, patch, pw)
      onCreated(res.item)
    } catch (e) {
      setErr(String(e.message || 'Не удалось создать задачу'))
      setBusy(false)
    }
  }

  return (
    <Dialog label="Задача на Gantt" onCancel={onClose} onSubmit={submit}>
      <p className="itr-hint">Из риска «{risk.title}». Заметка задачи заполнится из подробностей риска.</p>
      <label className="itr-field aia-f">
        <span className="itr-label">Название ({MAX_PROJECT} символов)</span>
        <input className="itr-input" value={project} maxLength={MAX_PROJECT} onChange={(e) => setProject(e.target.value)} />
      </label>
      <label className="itr-field aia-f">
        <span className="itr-label">Исполнитель</span>
        <select className="itr-select" value={engineerId} onChange={(e) => setEngineerId(e.target.value)}>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <div className="itr-row">
        <label className="itr-field aia-f">
          <span className="itr-label">Начало</span>
          <input className="itr-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="itr-field aia-f">
          <span className="itr-label">Дней</span>
          <input className="itr-input" inputMode="numeric" value={estDays} onChange={(e) => setEstDays(e.target.value)} />
        </label>
      </div>
      {err && <div className="itr-err">{err}</div>}
      <div className="itr-actions">
        <button className="itr-btn itr-btn-primary" type="submit" disabled={busy}>{busy ? 'Создаю…' : 'Создать задачу'}</button>
        <button className="itr-btn" type="button" onClick={onClose}>Отмена</button>
      </div>
    </Dialog>
  )
}
