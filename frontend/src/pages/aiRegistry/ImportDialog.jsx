import { useState } from 'react'
import { Drawer, DrawerHead, fmtDate, today } from './shared'

/* Usage import — the part that keeps the register alive. Claude → Analytics →
 * Members export (or the audit sheet) goes to POST /ai-access/import: first as
 * a dry run, so the diff is read before anything is written, then for real. */

function apiBase() {
  const raw = import.meta.env.VITE_API_URL || ''
  return raw.startsWith('http') ? `${raw}/api` : `${window.location.origin}/api`
}

async function upload(file, { pw, serviceId, dryRun, asOf }) {
  const form = new FormData()
  form.append('file', file)
  const params = new URLSearchParams({ password: pw, dry_run: dryRun ? 'true' : 'false' })
  if (serviceId) params.set('service_id', serviceId)
  if (asOf) params.set('as_of', asOf)
  const res = await fetch(`${apiBase()}/ai-access/import?${params}`, { method: 'POST', body: form })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text).detail || text } catch { /* plain text */ }
    throw new Error(msg)
  }
  return JSON.parse(text)
}

export default function ImportDialog({ pw, services, defaultServiceId, onClose, onImported }) {
  // The open service tab decides where the export goes; on "Все" it is Claude.
  const claude = services.find((s) => s.id === defaultServiceId) || services.find((s) => /claude/i.test(s.name))
  const [file, setFile] = useState(null)
  const [serviceId, setServiceId] = useState(claude ? String(claude.id) : '')
  const [asOf, setAsOf] = useState(today())
  const [diff, setDiff] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      const res = await upload(file, { pw, serviceId, dryRun, asOf })
      setDiff(res)
      if (!dryRun) { setDone(true); onImported(res) }
    } catch (e) {
      setErr(String(e.message || 'Не удалось загрузить'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer label="Загрузить выгрузку использования" onClose={onClose} wide>
      <DrawerHead title="Выгрузка использования" sub="Claude → Analytics → Members, CSV" onClose={onClose} />
      <div className="aia-panel-body">
        <section className="aia-block">
          <label className="itr-field aia-f">
            <span className="itr-label">Файл CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setDiff(null); setDone(false) }} />
          </label>
          <div className="itr-row">
            <label className="itr-field aia-f">
              <span className="itr-label">Сервис</span>
              <select className="itr-select" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setDiff(null) }}>
                <option value="">Claude (по инструменту)</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.plan ? ` · ${s.plan}` : ''}</option>)}
              </select>
            </label>
            <label className="itr-field aia-f">
              <span className="itr-label">Данные на</span>
              <input className="itr-input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </label>
          </div>
          <p className="itr-hint">
            Колонки читаются по смыслу: email, name, role, plan/seat, и chats / cowork / code за 30, 60 и 90 дней
            (например «Chats (30d)» или «code_90»). Сначала — проверка без записи.
          </p>
          {err && <div className="itr-err">{err}</div>}
          <div className="itr-actions">
            <button type="button" className="itr-btn" disabled={!file || busy} onClick={() => run(true)}>
              {busy && !diff ? 'Проверяю…' : 'Проверить'}
            </button>
            <button type="button" className="itr-btn itr-btn-primary" disabled={!file || busy || !diff || done}
              onClick={() => run(false)}>
              {done ? '✓ Загружено' : 'Загрузить'}
            </button>
          </div>
        </section>

        {diff && <ImportDiff diff={diff} />}
      </div>
    </Drawer>
  )
}

/** What the export changed — the same shape a dry run and a real run return. */
export function ImportDiff({ diff: d }) {
  const List = ({ title, rows, render, tone, empty }) => (
    <section className="aia-block">
      <h3>{title} · {rows.length}</h3>
      {!rows.length ? <div className="aia-muted">{empty}</div> : (
        <ul className={`aia-difflist${tone ? ` aia-difflist-${tone}` : ''}`}>
          {rows.slice(0, 200).map((r, i) => <li key={r.id || r.email || i}>{render(r)}</li>)}
        </ul>
      )}
    </section>
  )
  return (
    <>
      <section className="aia-block">
        <h3>{d.dry_run ? 'Проверка — ничего не записано' : 'Загружено'}</h3>
        <div className="aia-sum-line">
          {d.rows_total} строк · совпало {d.rows_matched} · новых {d.rows_new} · нет в выгрузке {d.rows_missing}
        </div>
        <div className="aia-muted">{d.service} · {d.filename} · данные на {fmtDate(d.as_of)}</div>
        {d.unmapped?.length > 0 && <div className="aia-muted">Не распознаны колонки: {d.unmapped.join(', ')}</div>}
      </section>
      <List title="Упало до нуля за 30 дней" tone="red" rows={d.dropped_to_zero || []} empty="Никто"
        render={(r) => <><b>{r.name}</b> {r.email} · {r.before_30d} → 0</>} />
      <List title="Есть в реестре, нет в выгрузке — возможно, уже сняты" tone="amber" rows={d.missing || []} empty="Все на месте"
        render={(r) => <><b>{r.name}</b> {r.email}{r.plan ? ` · ${r.plan}` : ''}</>} />
      <List title="Новые — нет в реестре" rows={d.new || []} empty="Новых нет"
        render={(r) => <><b>{r.name || r.email}</b> {r.email}{r.plan ? ` · ${r.plan}` : ''} · 30д: {r.usage_30d ?? '—'}</>} />
      <List title="Совпало" rows={d.matched || []} empty="Ни одного совпадения по почте"
        render={(r) => <><b>{r.name}</b> · 30д {r.before_30d ?? '—'} → {r.after_30d ?? '—'} · 90д {r.before_90d ?? '—'} → {r.after_90d ?? '—'}</>} />
    </>
  )
}
