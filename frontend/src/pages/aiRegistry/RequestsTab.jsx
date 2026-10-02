import { useState } from 'react'
import { aiToolName, guessAiTool } from '../../lib/aiTools'
import { Num, Dialog, fmtDate } from './shared'

/* Запросы на доступ — seats waiting for approval, plus AI access requests
 * filed through IT requests that are not in the register yet. Approving sets
 * the seat live with decision=keep and the reason it was granted for. */

export function RequestsTable({ pending, requests, onApprove, onReject, onAdd, onOpenPerson }) {
  if (!pending.length && !requests.length) {
    return <div className="itr-empty">Запросов нет.</div>
  }
  return (
    <table className="aia-table">
      <thead>
        <tr>
          <th>Сотрудник</th>
          <th>Кто просил</th>
          <th>Зачем</th>
          <th>Руководитель</th>
          <th>Решение</th>
        </tr>
      </thead>
      <tbody>
        {pending.map((r) => (
          <tr key={`s${r.id}`}>
            <td data-label="Сотрудник">
              <Num className="aia-person" onClick={() => onOpenPerson(r.id)}>{r.person_name}</Num>
              <div className="aia-muted">{r.person_email} · {aiToolName(r)}{r.plan ? ` · ${r.plan}` : ''}</div>
            </td>
            <td data-label="Кто просил">
              {r.requested_by || <span className="aia-muted">—</span>}
              {r.request_ref && <div className="aia-muted aia-ref">{r.request_ref}</div>}
            </td>
            <td data-label="Зачем"><div className="aia-detail">{r.justification || r.request_summary || <span className="aia-muted">не указано</span>}</div></td>
            <td data-label="Руководитель">{r.manager_name || <span className="aia-missing">нет</span>}</td>
            <td className="aia-actions">
              <div className="aia-actions-stack">
                <button type="button" className="itr-btn itr-btn-sm itr-btn-green" onClick={() => onApprove(r)}>Согласовать</button>
                <button type="button" className="itr-btn itr-btn-sm itr-btn-danger" onClick={() => onReject(r)}>Отказать</button>
              </div>
            </td>
          </tr>
        ))}
        {requests.map((q) => (
          <tr key={`r${q.id}`}>
            <td data-label="Сотрудник">
              <div className="aia-person">{q.requester_email}</div>
              <div className="aia-muted">{q.ref} · {fmtDate(q.created_at)} · ещё не в реестре</div>
            </td>
            <td data-label="Кто просил">{q.requester_slack || q.requester_email}</td>
            <td data-label="Зачем"><div className="aia-detail">{q.summary}{q.business_value ? ` — ${q.business_value}` : ''}</div></td>
            <td data-label="Руководитель"><span className="aia-muted">—</span></td>
            <td className="aia-actions">
              <div className="aia-actions-stack">
                <button type="button" className="itr-btn itr-btn-sm itr-btn-primary" onClick={() => onAdd(q)}>В реестр</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The pending row an IT request becomes when it is added to the register. */
export function seatFromRequest(q) {
  const email = String(q.requester_email || '').trim().toLowerCase()
  return {
    person_email: email,
    person_name: email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    department: q.department || '',
    tool: guessAiTool(q.summary) || 'claude',
    request_ref: q.ref,
    justification: q.summary || '',
    status: 'pending',
  }
}

export function ApproveDialog({ seat, approver, onCancel, onConfirm }) {
  const [reason, setReason] = useState(seat.justification || '')
  const [by, setBy] = useState(approver || '')
  const [busy, setBusy] = useState(false)
  const ok = reason.trim() && by.trim()
  return (
    <Dialog label="Согласовать доступ" onCancel={onCancel} onSubmit={async () => {
      if (!ok) return
      setBusy(true)
      try { await onConfirm({ reason: reason.trim(), by: by.trim() }) } finally { setBusy(false) }
    }}>
      <p className="itr-hint">{seat.person_name} · {aiToolName(seat)}. Место станет активным, решение — «оставить» с этой причиной.</p>
      <label className="itr-field aia-f">
        <span className="itr-label">Зачем нужен доступ *</span>
        <textarea className="itr-textarea" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="itr-field aia-f">
        <span className="itr-label">Кто согласует *</span>
        <input className="itr-input" value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <div className="itr-actions">
        <button className="itr-btn itr-btn-green" type="submit" disabled={!ok || busy}>Согласовать</button>
        <button className="itr-btn" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  )
}
