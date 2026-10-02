import { useEffect } from 'react'

/* Shared by the three tabs of /ai-access: formatting, the vocabularies the
 * backend validates against, the side drawer and the stylesheet. */

export const STATUSES = [
  { value: 'pending',   label: 'Ожидает' },
  { value: 'active',    label: 'Активен' },
  { value: 'to_revoke', label: 'К отзыву' },
  { value: 'revoked',   label: 'Отозван' },
]
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]))

export const EMPLOYMENT = [
  { value: 'active',     label: 'Работает' },
  { value: 'contractor', label: 'Подрядчик' },
  { value: 'terminated', label: 'Уволен' },
  { value: 'unknown',    label: 'Неизвестно' },
]

/* Keys match AI_SERVICE_DECISIONS in backend/main.py. */
export const DECISIONS = [
  { value: 'keep',      label: 'оставить' },
  { value: 'review',    label: 'разобрать' },
  { value: 'kill',      label: 'отключить' },
  { value: 'cancelled', label: 'отключено' },
  { value: 'transfer',  label: 'передать' },
]
export const DECISION_LABEL = Object.fromEntries(DECISIONS.map((d) => [d.value, d.label]))

export const RISK_SEVERITIES = [
  { value: 'high',   label: 'Высокий' },
  { value: 'medium', label: 'Средний' },
]
export const RISK_STATUSES = [
  { value: 'open',        label: 'Открыт' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'closed',      label: 'Закрыт' },
]

export const USAGE_WINDOWS = [30, 60, 90]
export const USAGE_KINDS = [
  { key: 'chats',  label: 'Чаты' },
  { key: 'cowork', label: 'Cowork' },
  { key: 'code',   label: 'Code' },
]

export const today = () => new Date().toISOString().slice(0, 10)

/** "2026-09-24" → "24 сент. 2026". Dates here are calendar days, so they are
 * read as such and never shifted by the reader's time zone. */
export function fmtDate(value) {
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

export function money(n, digits = 0) {
  if (n == null || n === '') return '—'
  return `$${Number(n).toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits || 2,
  })}`
}

export function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())

/** A number that is a link. Every count on this page is one — a figure you
 * cannot click is a figure you cannot check. */
export function Num({ onClick, children, className = '', title }) {
  return (
    <button type="button" className={`aia-numlink ${className}`} onClick={onClick} title={title}>
      {children}
    </button>
  )
}

/** Right-hand drawer with Esc and backdrop-click to close. */
export function Drawer({ label, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="aia-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className={`aia-panel${wide ? ' aia-panel-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </div>
  )
}

export function DrawerHead({ title, sub, onClose }) {
  return (
    <div className="aia-panel-head">
      <div className="aia-panel-headtext">
        <h2>{title}</h2>
        {sub && <div className="aia-muted">{sub}</div>}
      </div>
      <button type="button" className="aia-close" onClick={onClose} aria-label="Закрыть">×</button>
    </div>
  )
}

/** Centered modal for a short form (revoke, cancel a service, create a task). */
export function Dialog({ label, onCancel, onSubmit, children }) {
  return (
    <div className="aia-overlay aia-overlay-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <form className="itr-card aia-dialog" role="dialog" aria-modal="true" aria-label={label}
        onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
        <h2 className="aia-dialog-title">{label}</h2>
        {children}
      </form>
    </div>
  )
}

export function Fact({ label, children }) {
  return (
    <div className="aia-factrow">
      <div className="aia-factlabel">{label}</div>
      <div className="aia-factval">{children}</div>
    </div>
  )
}

/** Download a CSV through fetch, so the password never lands in the browser
 * history or a download manager's log. */
export async function downloadCsv(path, filename, pw) {
  const base = (import.meta.env.VITE_API_URL || '').startsWith('http')
    ? `${import.meta.env.VITE_API_URL}/api` : `${window.location.origin}/api`
  const res = await fetch(`${base}${path}?password=${encodeURIComponent(pw)}`)
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const CSS = `
.aia-pw{flex:1 1 220px;max-width:320px}
.aia-approver{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:var(--ios-label3,#6D6D72);width:190px}
.aia-approver .itr-input{text-transform:none;letter-spacing:0;font-weight:400;background:var(--ios-card,#fff);
  box-shadow:var(--ios-shadow-btn,0 1px 2px rgba(0,0,0,.08))}

.aia-numlink{border:none;background:none;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;
  text-align:inherit;border-radius:4px;text-decoration:underline;text-decoration-color:transparent;
  text-underline-offset:3px;transition:text-decoration-color .15s}
.aia-numlink:hover,.aia-numlink:focus-visible{text-decoration-color:currentColor}
.aia-numlink:focus-visible{outline:2px solid var(--ios-blue,#007AFF);outline-offset:2px}
.aia-numlink-blue{color:var(--ios-blue,#007AFF)}

.aia-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:10px}
.aia-kpi{background:var(--ios-card,#fff);border-radius:14px;box-shadow:var(--ios-shadow,0 1px 3px rgba(0,0,0,.06));
  padding:14px 16px;border-left:4px solid transparent;cursor:pointer;text-align:left;font:inherit;color:inherit;
  border-top:none;border-right:none;border-bottom:none;display:block;width:100%}
.aia-kpi:hover{box-shadow:0 2px 10px rgba(0,0,0,.10)}
.aia-kpi:focus-visible{outline:2px solid var(--ios-blue,#007AFF);outline-offset:2px}
.aia-kpi.on{box-shadow:0 0 0 2px var(--ios-blue,#007AFF)}
.aia-kpi-amber{border-left-color:var(--ios-orange,#FF9500)}
.aia-kpi-red{border-left-color:#FF3B30}
.aia-kpi-green{border-left-color:var(--ios-green,#34C759)}
.aia-kpi-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.aia-kpi-value{font-size:28px;font-weight:700;letter-spacing:-.5px;margin-top:4px;font-variant-numeric:tabular-nums}
.aia-kpi-sub{font-size:12.5px;color:var(--ios-label2,#636366);margin-top:2px}

.aia-strip{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--ios-label2,#636366);margin:0 2px 14px}
.aia-strip b{color:var(--ios-label,#1C1C1E);font-variant-numeric:tabular-nums}

.aia-tabs{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.aia-tabs .aia-tabs-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.aia-chip-filter{display:inline-flex;align-items:center;gap:8px;font-size:13px;padding:5px 6px 5px 12px;border-radius:999px;
  background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91);margin:0 0 12px}
.aia-chip-filter button{border:none;background:var(--ios-card,#fff);color:inherit;font:inherit;font-size:12px;
  border-radius:999px;padding:2px 10px;cursor:pointer}

.aia-filters{display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center;padding:12px 14px}
.aia-search{flex:1 1 240px;width:auto;min-width:0}
.aia-error{margin:0 0 12px}

.aia-tablecard{padding:0;overflow-x:auto}
.aia-table{width:100%;border-collapse:collapse;font-size:13px}
.aia-table th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ios-label3,#6D6D72);padding:10px 8px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);white-space:nowrap}
.aia-table td{padding:10px 8px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);vertical-align:top}
.aia-table tbody tr:last-child td{border-bottom:none}
.aia-table th:first-child,.aia-table td:first-child{padding-left:16px}
.aia-table td:last-child{padding-right:14px}
.aia-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
@media(max-width:860px){.aia-note-cell{margin-left:0;max-width:none}}
.aia-tone-amber td{background:#FFF6E0}
.aia-tone-red td{background:#FFE8E6}
.aia-tone-muted td{color:var(--ios-label3,#6D6D72)}
.aia-tone-muted td .aia-person{text-decoration:line-through;text-decoration-color:rgba(0,0,0,.25)}
.aia-focus td{box-shadow:inset 0 0 0 9999px rgba(0,122,255,.10)}
[data-theme="dark"] .aia-tone-amber td{background:#33270A}
[data-theme="dark"] .aia-tone-red td{background:#3A1310}
.aia-person{font-weight:600}
.aia-muted{color:var(--ios-label3,#6D6D72);font-size:12px}
.aia-ref{font-variant-numeric:tabular-nums}
.aia-missing{color:var(--ios-orange-text,#7A3E00);font-weight:600}
.aia-warn-cell{color:var(--ios-orange-text,#7A3E00);font-weight:600}
.aia-bad{color:#C4281C;font-weight:600}
[data-theme="dark"] .aia-bad{color:#FF8A80}
.aia-good{color:var(--ios-green-text,#1E7A3A);font-weight:600}
.aia-emp{display:inline-block;margin-top:3px;font-size:11px;font-weight:600;padding:1px 7px;border-radius:6px;
  background:var(--ios-bg,#F2F2F7);color:var(--ios-label2,#636366)}
.aia-emp-terminated{background:#FFD9D6;color:#9B1C15}
[data-theme="dark"] .aia-emp-terminated{background:#5A1C17;color:#FFC7C2}
.aia-tool{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.aia-tool i{width:10px;height:10px;border-radius:3px;flex:none}
.aia-svc-chip{display:inline-flex;align-items:center;gap:6px;border:none;cursor:pointer;font:inherit;font-size:12px;
  padding:2px 9px;border-radius:999px;background:var(--ios-bg,#F2F2F7);color:var(--ios-blue,#007AFF);white-space:nowrap}
.aia-svc-chip:hover{background:var(--ios-blue-tint,#D6E6FF)}
.aia-pill-pending{background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91)}
.aia-pill-active{background:var(--ios-green-tint,#E3F6E8);color:var(--ios-green-text,#1E7A3A)}
.aia-pill-to_revoke{background:var(--ios-orange-tint,#FFE5CC);color:var(--ios-orange-text,#7A3E00)}
.aia-pill-revoked{background:var(--ios-sep,#E5E5EA);color:var(--ios-label2,#636366)}
.aia-date{white-space:nowrap}
.aia-actions{width:1%}
.aia-actions-stack{display:flex;flex-direction:column;gap:5px;align-items:stretch}
.aia-actions .itr-btn{white-space:nowrap;padding:4px 10px;font-size:12px}
.aia-person,.aia-person+.aia-muted{overflow-wrap:anywhere}
@media(min-width:861px){.aia-table td:first-child{max-width:220px}}

.aia-usage{display:inline-flex;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap}
.aia-usage .aia-numlink{min-width:26px;text-align:center;padding:1px 4px;border-radius:6px;background:var(--ios-bg,#F2F2F7)}
.aia-usage .aia-zero{color:#C4281C}
.aia-usage-head{display:block;font-size:10px;color:var(--ios-label3,#6D6D72);letter-spacing:.04em}

.aia-dec{display:inline-flex;flex-wrap:wrap;gap:2px;background:var(--ios-fill,rgba(118,118,128,.12));border-radius:8px;padding:2px}
.aia-dec button{border:none;background:none;font:inherit;font-size:11.5px;padding:3px 7px;border-radius:6px;cursor:pointer;
  color:var(--ios-label2,#636366);white-space:nowrap}
.aia-dec button.on{background:var(--ios-card,#fff);color:var(--ios-label,#1C1C1E);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.aia-dec button.on.d-kill{color:var(--ios-orange-text,#7A3E00)}
.aia-dec button.on.d-cancelled{color:var(--ios-label3,#6D6D72)}
.aia-dec button.on.d-keep{color:var(--ios-green-text,#1E7A3A)}
.aia-saving{font-size:12px;margin-top:4px}
@media(min-width:861px){.aia-table .itr-seg{flex-wrap:nowrap;white-space:nowrap}.aia-table .aia-dec{flex-wrap:nowrap}.aia-table .aia-dec button{padding:3px 6px}}

.aia-sev{display:inline-block;width:10px;height:10px;border-radius:50%;margin-top:4px}
.aia-sev-high{background:#FF3B30}
.aia-sev-medium{background:var(--ios-orange,#FF9500)}
.aia-detail{max-width:440px;white-space:pre-wrap}

.aia-legend{display:flex;gap:8px 20px;flex-wrap:wrap;font-size:12.5px;color:var(--ios-label2,#636366);margin:4px 2px 0}
.aia-legend span{display:inline-flex;align-items:center;gap:7px}
.aia-legend-note{color:var(--ios-label3,#6D6D72)}
.aia-sw{width:14px;height:14px;border-radius:4px;display:inline-block}
.aia-sw-amber{background:#FFE7A8}
.aia-sw-red{background:#FFC9C4}
.aia-sw-muted{background:var(--ios-sep,#E5E5EA)}

.aia-overlay{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:50;display:flex;justify-content:flex-end}
.aia-overlay-center{justify-content:center;align-items:center;padding:16px}
.aia-panel{width:min(560px,100%);height:100%;background:var(--ios-bg,#F2F2F7);box-shadow:-8px 0 30px rgba(0,0,0,.15);
  display:flex;flex-direction:column}
.aia-panel-wide{width:min(640px,100%)}
.aia-panel-form{display:flex;flex-direction:column;height:100%;min-height:0}
.aia-panel-head{display:flex;align-items:flex-start;gap:10px;padding:16px 20px;background:var(--ios-card,#fff);
  border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-panel-headtext{flex:1;min-width:0}
.aia-panel-head h2{margin:0;font-size:18px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aia-close{border:none;background:none;font-size:26px;line-height:1;cursor:pointer;color:var(--ios-label2,#636366);padding:0 4px}
.aia-panel-body{flex:1;overflow-y:auto;padding:16px 20px;min-height:0}
.aia-panel-body .itr-card-title{margin:18px 0 10px}
.aia-panel-body .itr-card-title:first-child{margin-top:0}
.aia-panel-body .itr-input,.aia-panel-body .itr-select,.aia-panel-body .itr-textarea{background:var(--ios-card,#fff)}
.aia-block{background:var(--ios-card,#fff);border-radius:12px;padding:12px 14px;margin-bottom:12px;scroll-margin-top:12px}
.aia-block.flash{animation:aia-flash 1.4s ease-out}
@keyframes aia-flash{0%{box-shadow:0 0 0 3px var(--ios-blue,#007AFF)}100%{box-shadow:0 0 0 0 transparent}}
.aia-block h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.aia-factrow{display:flex;gap:12px;padding:5px 0;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);font-size:13.5px}
.aia-factrow:last-child{border-bottom:none}
.aia-factlabel{flex:0 0 150px;color:var(--ios-label2,#636366)}
.aia-factval{flex:1;min-width:0;overflow-wrap:anywhere}
.aia-big{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.aia-flags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.aia-flag{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:#FFE8E6;color:#9B1C15}
.aia-flag-amber{background:#FFF0CC;color:#7A3E00}
.aia-people{width:100%;border-collapse:collapse;font-size:13px}
.aia-people td,.aia-people th{padding:7px 4px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);text-align:left;vertical-align:top}
.aia-people th{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.aia-people tbody tr{cursor:pointer}
.aia-people tbody tr:hover td{background:var(--ios-bg,#F2F2F7)}
.aia-ugrid{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
.aia-ugrid th,.aia-ugrid td{padding:6px 6px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);text-align:right}
.aia-ugrid th:first-child,.aia-ugrid td:first-child{text-align:left}
.aia-ugrid th{font-size:11px;font-weight:600;color:var(--ios-label3,#6D6D72);text-transform:uppercase;letter-spacing:.04em}
.aia-ugrid tr.on td{background:var(--ios-blue-tint,#D6E6FF)}
.aia-ugrid td.tot{font-weight:700}
.aia-note{white-space:pre-wrap;font-size:13.5px}
.aia-f{display:block;margin-bottom:12px}
.aia-f3{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:end;margin-bottom:8px}
.aia-f3 .itr-label{font-size:11px}
.aia-prefill{margin:-6px 0 10px;color:var(--ios-green-text,#1E7A3A)}
.aia-panel-foot{padding:12px 20px;background:var(--ios-card,#fff);border-top:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-panel-err{margin:0 0 8px}
.aia-del{margin-left:auto}
.aia-dialog{width:min(440px,100%);margin:0}
.aia-dialog-title{margin:0 0 4px;font-size:18px;font-weight:700}

/* ── Решения ── */
.aia-sum{padding:14px 16px;margin-bottom:10px}
.aia-sum-line{font-size:17px;line-height:1.4}
.aia-sum-line b{font-variant-numeric:tabular-nums}
.aia-sum-sub{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;margin-top:4px;color:var(--ios-label2,#636366)}
.aia-sum-import{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;margin-top:10px;
  padding-top:10px;border-top:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-notice{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:0 0 12px;padding:9px 12px;border-radius:10px;
  background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91);font-size:13.5px}
.aia-notice button{border:none;background:none;color:inherit;font-size:20px;cursor:pointer;line-height:1}
.aia-bucket{padding:0;margin-bottom:12px;overflow:hidden;border-left:4px solid var(--ios-sep,#E5E5EA)}
.aia-bucket-duplicate,.aia-bucket-revoke{border-left-color:#FF3B30}
.aia-bucket-ask_manager,.aia-bucket-low_use{border-left-color:var(--ios-orange,#FF9500)}
.aia-bucket-downgrade,.aia-bucket-role_mismatch{border-left-color:var(--ios-blue,#007AFF)}
.aia-bucket-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;padding:12px 16px;
  border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-bucket-head h3{margin:0;font-size:16px;font-weight:700}
.aia-bucket-nums{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.aia-bucket-empty{font-size:13px;color:var(--ios-label3,#6D6D72);padding:6px 4px 10px}
.aia-seats{display:flex;flex-direction:column}
.aia-seat{display:grid;grid-template-columns:minmax(150px,1.3fr) minmax(120px,1fr) minmax(90px,.8fr) 110px minmax(120px,1fr) auto;
  gap:10px 14px;align-items:start;padding:10px 16px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA);font-size:13px}
.aia-seat:last-child{border-bottom:none}
.aia-seat-dim{opacity:.6}
.aia-seat-busy{opacity:.55;pointer-events:none}
.aia-seat > *{min-width:0;overflow-wrap:anywhere}
.aia-seat-actions{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end}
.aia-seat-actions .itr-btn{white-space:nowrap;padding:4px 10px;font-size:12px}
.aia-tiny{font-size:10.5px}
.aia-done-toggle{border:none;background:none;font:inherit;font-size:12.5px;color:var(--ios-blue,#007AFF);cursor:pointer;
  padding:8px 16px;text-align:left}
.aia-state{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;
  background:var(--ios-bg,#F2F2F7);color:var(--ios-label2,#636366)}
.aia-state-waiting,.aia-state-d-awaiting_manager{background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91)}
.aia-state-escalated,.aia-state-not_sent,.aia-state-d-propose_revoke{background:#FFE8E6;color:#9B1C15}
.aia-state-confirmed,.aia-state-d-confirmed{background:var(--ios-orange-tint,#FFE5CC);color:var(--ios-orange-text,#7A3E00)}
.aia-state-kept,.aia-state-d-keep,.aia-state-downgrade,.aia-state-d-downgrade{background:var(--ios-green-tint,#E3F6E8);color:var(--ios-green-text,#1E7A3A)}
.aia-state-revoked,.aia-state-d-revoked{background:var(--ios-sep,#E5E5EA);color:var(--ios-label2,#636366)}
.aia-asof{text-transform:none;letter-spacing:0;font-weight:500}
.aia-selects{display:flex;flex-wrap:wrap;gap:8px}
.aia-selects .itr-select{width:auto;min-width:150px}
.aia-radio{display:flex;gap:8px;align-items:center;font-size:14px;padding:4px 0;cursor:pointer}
.aia-history ul{list-style:none;margin:6px 0 0;padding:0;font-size:13px}
.aia-history li{padding:4px 0;border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
.aia-history li:last-child{border-bottom:none}
.aia-history{padding-top:6px}
.aia-difflist{margin:0;padding-left:18px;font-size:13px;max-height:260px;overflow-y:auto}
.aia-difflist li{padding:2px 0}
.aia-difflist-red li::marker{color:#FF3B30}
.aia-difflist-amber li::marker{color:var(--ios-orange,#FF9500)}
@media(max-width:1100px){
  .aia-seat{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)}
  .aia-seat-actions{grid-column:1 / -1;justify-content:flex-start}
}
@media(max-width:560px){
  .aia-seat{grid-template-columns:minmax(0,1fr) minmax(0,1fr);padding:10px 12px}
  .aia-seat-who{grid-column:1 / -1}
  .aia-bucket-head{padding:12px}
  .aia-sum-line{font-size:15.5px}
  .aia-selects{width:100%}
  .aia-selects .itr-select{flex:1 1 140px;min-width:0;width:auto;max-width:100%}
}

/* Все места: nine columns that fit a 1280px screen. Notes wrap inside their
 * cell instead of widening the column; sideways scroll stays as a fallback. */
.aia-note-cell{white-space:normal;max-width:130px;margin-left:auto;font-size:11.5px;line-height:1.3}
.aia-wrap{max-width:140px;overflow-wrap:anywhere}
.aia-table .aia-usage-head{white-space:normal}
@media(min-width:861px){
  .aia-table td:first-child{max-width:190px}
}

@media(max-width:1100px){
  .aia-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
}
/* Phone and narrow tablet: each row becomes a card, every cell labelled, so
 * nothing scrolls sideways. The tint still marks the whole card. */
@media(max-width:860px){
  .aia-approver{width:100%}
  .aia-tabs .aia-tabs-actions{margin-left:0;width:100%}
  .aia-table thead{display:none}
  .aia-table,.aia-table tbody,.aia-table tr,.aia-table td{display:block;width:100%;box-sizing:border-box}
  .aia-table tr{padding:10px 14px;border-bottom:0.5px solid var(--ios-sep,#E5E5EA)}
  .aia-table tbody tr:last-child{border-bottom:none}
  .aia-tone-amber{background:#FFF6E0}
  .aia-tone-red{background:#FFE8E6}
  .aia-focus{box-shadow:inset 0 0 0 2px var(--ios-blue,#007AFF)}
  [data-theme="dark"] .aia-tone-amber{background:#33270A}
  [data-theme="dark"] .aia-tone-red{background:#3A1310}
  .aia-table td{display:flex;gap:12px;padding:4px 0;border:none;background:transparent !important;box-shadow:none !important}
  .aia-table td > *{min-width:0}
  .aia-table th:first-child,.aia-table td:first-child{padding-left:0}
  .aia-table td[data-label]{display:grid;grid-template-columns:112px minmax(0,1fr);column-gap:12px;row-gap:2px;align-items:start}
  .aia-table td[data-label] > *{grid-column:2}
  .aia-table td[data-label]::before{content:attr(data-label);grid-column:1;grid-row:1 / span 6;font-size:11px;font-weight:600;
    letter-spacing:.03em;text-transform:uppercase;color:var(--ios-label3,#6D6D72);padding-top:2px}
  .aia-table td:first-child{display:block;padding-bottom:6px}
  .aia-table td:first-child::before{display:none}
  .aia-num{text-align:left}
  .aia-actions{width:100%;padding-top:8px !important}
  .aia-actions-stack{flex-direction:row;flex-wrap:wrap;gap:6px}
  .aia-date{white-space:normal}
  .aia-factlabel{flex-basis:120px}
  .aia-f3{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:480px){
  .aia-kpi-value{font-size:22px}
  .aia-kpis{gap:10px}
  .aia-kpi{padding:12px}
}
`
