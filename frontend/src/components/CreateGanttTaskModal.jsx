import { useState } from 'react'
import { api } from '../api/client'
import { formatDate } from '../i18n/itRequests'

/* "Create task on the Gantt" — the step where a request becomes work.
 *
 * Everything is prefilled from the request and everything stays editable: the
 * triage person is the one who knows whether the requester's wording is the
 * task's wording. On failure the modal stays open with what was typed — losing
 * a hand-written note to a network blip is the one thing it must not do. */

const MAX_PROJECT = 70

/** "2 d", "2 дня", "2-3 days" → 2. Anything without a number → 1. */
export function estimateToDays(estimate) {
  const m = String(estimate || '').match(/\d+/)
  const n = m ? parseInt(m[0], 10) : 0
  return n > 0 ? Math.min(365, n) : 1
}

/** The requester as a person: their Slack handle, or the local part of the email. */
export function requesterName(req) {
  const handle = String(req.requester_slack || '').replace(/^@/, '').trim()
  if (handle) return handle
  return String(req.requester_email || '').split('@')[0]
}

/** The bilingual note the Gantt expects, built from what the requester wrote. */
export function buildNote(req, what, lang) {
  const who = requesterName(req)
  const sent = formatDate(req.created_at, lang === 'ru' ? 'ru' : 'en')
  const statusPath = `/it-requests/status/${req.ref}`
  const dash = '—'
  return [
    `TASK: ${req.summary}`,
    `WHAT: ${what || dash}`,
    `BENEFIT: ${req.business_value || dash}`,
    `SOURCE: request ${req.ref}, ${who} ${sent}`,
    `CUSTOMER: ${who}${req.department ? `, ${req.department}` : ''}`,
    '____ ru',
    `ЗАДАЧА: ${req.summary}`,
    `ЧТО: ${what || dash}`,
    `ВЫГОДА: ${req.business_value || dash}`,
    `ИСТОЧНИК: заявка ${req.ref}, ${who} ${sent}`,
    `ЗАКАЗЧИК: ${who}${req.department ? `, ${req.department}` : ''}`,
    `Заявка ${req.ref} · ${statusPath}`,
  ].join('\n')
}

export default function CreateGanttTaskModal({
  request, engineer, ownerPatch, t, lang, pw, onClose, onCreated,
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [project, setProject] = useState(
    String(request.summary || '').trim().slice(0, MAX_PROJECT)
  )
  const [startDate, setStartDate] = useState(today)
  const [estDays, setEstDays] = useState(estimateToDays(request.estimate))
  // The requester says what is wrong; WHAT is what we will change about it, so
  // it starts from their workaround and is expected to be rewritten.
  const [what, setWhat] = useState(request.current_workaround || '')
  const [noteEdited, setNoteEdited] = useState(null)
  const [alsoBacklog, setAlsoBacklog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const note = noteEdited != null ? noteEdited : buildNote(request, what, lang)

  const submit = async (ev) => {
    ev.preventDefault()
    if (!engineer) { setError(t.admin.createEngineerMissing); return }
    setSaving(true)
    setError('')
    try {
      const created = await api.post('/gantt', {
        engineer_id: engineer.id,
        project: project.trim().slice(0, MAX_PROJECT) || request.ref,
        start_date: startDate,
        est_days: Number(estDays) || 1,
        percent: 0,
        status: 'active',
        note,
      }, pw)

      // Link the request to it, and move it along if triage had not yet. The
      // owner rides along unsaved-as-typed: the task was just created for that
      // engineer, so leaving the request unassigned would contradict the board.
      const patch = { gantt_id: created.id, ...(ownerPatch || {}) }
      if (request.status === 'new' || request.status === 'accepted') patch.status = 'in_progress'
      const updated = await api.patch(`/it-requests/${request.id}`, patch, pw)

      if (alsoBacklog) {
        // Best-effort: the Gantt task is the deliverable here, and a backlog
        // copy that failed should not undo it or block the panel.
        try {
          await api.post('/it-backlog', {
            title: project.trim().slice(0, MAX_PROJECT),
            section: 'Из заявок IT',
            status: 'new',
            owner: engineer.name,
            estimate: `${estDays} d`,
            description_html: `<p>${request.summary}</p>`,
            source: `${request.ref}`,
          }, pw)
        } catch { /* reported by its absence, not worth failing the create */ }
      }

      onCreated({ ganttId: created.id, project: project.trim(), request: updated.request })
    } catch (err) {
      setError(String(err.message || ''))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cgt-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="cgt-card" onSubmit={submit}>
        <h2 className="cgt-title">{t.admin.createTitle}</h2>

        <label className="cgt-field">
          <span className="cgt-label">{t.admin.createProject}</span>
          <input className="itr-input" value={project} maxLength={MAX_PROJECT}
            onChange={(e) => setProject(e.target.value)} autoFocus />
        </label>

        <div className="cgt-row">
          <label className="cgt-field">
            <span className="cgt-label">{t.admin.createEngineer}</span>
            <span className={`cgt-engineer${engineer ? '' : ' cgt-engineer-missing'}`}>
              {engineer ? (
                <>
                  <i className="cgt-dot" style={{ background: engineer.avatar_color || '#8E8E93' }} />
                  {engineer.name}
                </>
              ) : t.admin.createEngineerMissing}
            </span>
          </label>
          <label className="cgt-field cgt-field-sm">
            <span className="cgt-label">{t.admin.createStart}</span>
            <input className="itr-input" type="date" value={startDate}
              onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="cgt-field cgt-field-xs">
            <span className="cgt-label">{t.admin.createEst}</span>
            <input className="itr-input" type="number" min="1" max="365" value={estDays}
              onChange={(e) => setEstDays(e.target.value)} />
          </label>
        </div>

        <label className="cgt-field">
          <span className="cgt-label">{t.admin.createWhat}</span>
          <input className="itr-input" value={what}
            onChange={(e) => { setWhat(e.target.value); setNoteEdited(null) }} />
          <span className="itr-hint">{t.admin.createWhatHint}</span>
        </label>

        <label className="cgt-field">
          <span className="cgt-label">{t.admin.createNote}</span>
          <textarea className="itr-textarea cgt-note" rows={12} value={note}
            onChange={(e) => setNoteEdited(e.target.value)} />
        </label>

        <label className="cgt-check">
          <input type="checkbox" checked={alsoBacklog}
            onChange={(e) => setAlsoBacklog(e.target.checked)} />
          {t.admin.createAlsoBacklog}
        </label>

        {error && <div className="itr-err cgt-error">{error}</div>}

        <div className="cgt-actions">
          <button type="button" className="itr-btn" onClick={onClose}>{t.admin.cancel}</button>
          <button type="submit" className="itr-btn itr-btn-primary" disabled={saving || !engineer}>
            {saving ? t.admin.createSubmitting : t.admin.createSubmit}
          </button>
        </div>
      </form>
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.cgt-backdrop{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.4);display:flex;
  align-items:flex-start;justify-content:center;padding:5vh 20px;overflow-y:auto}
.cgt-card{width:100%;max-width:620px;background:var(--ios-card,#fff);border-radius:14px;
  box-shadow:0 12px 40px rgba(0,0,0,.2);padding:22px 24px;
  font-family:var(--ios-font,-apple-system,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif);
  color:var(--ios-label,#1C1C1E)}
.cgt-title{margin:0 0 16px;font-size:18px;font-weight:700;letter-spacing:-.2px}
.cgt-field{display:block;margin-bottom:14px}
.cgt-row{display:flex;gap:12px;flex-wrap:wrap}
.cgt-row .cgt-field{flex:1 1 200px;min-width:0}
.cgt-field-sm{flex:0 1 170px !important}
.cgt-field-xs{flex:0 1 110px !important}
.cgt-label{display:block;font-size:12px;font-weight:600;color:var(--ios-label2,#636366);margin-bottom:5px}
.cgt-engineer{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;
  background:var(--ios-bg,#F2F2F7);border-radius:10px;padding:9px 11px}
.cgt-engineer-missing{color:var(--ios-orange-text,#7A3E00);font-weight:500;font-size:13px}
.cgt-dot{width:18px;height:18px;border-radius:50%;flex:none}
.cgt-note{font-size:12.5px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.cgt-check{display:flex;align-items:center;gap:8px;font-size:13.5px;margin:2px 0 16px;cursor:pointer}
.cgt-error{margin-bottom:12px}
.cgt-actions{display:flex;gap:10px;justify-content:flex-end}
@media(max-width:640px){
  .cgt-card{padding:18px 16px}
  .cgt-field-sm,.cgt-field-xs{flex:1 1 140px !important}
}
`
