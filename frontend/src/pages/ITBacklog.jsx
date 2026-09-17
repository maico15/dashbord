import { useState, useEffect, useMemo, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { api } from '../api/client'
import { useTheme, toggleTheme } from '../hooks/useTheme'

/* IT backlog — a hidden page. It is deliberately not linked from the tab bar,
 * the Gantt toolbar, the home page or any menu: the only way in is typing
 * /it-backlog. Keep it that way — adding a link here (or to here) defeats the
 * point of the page. */

const STATUSES = [
  { key: 'new',         label: 'Новое',    bar: 'var(--danger)'  },
  { key: 'in_progress', label: 'В работе', bar: 'var(--warning)' },
  { key: 'done',        label: 'Сделано',  bar: 'var(--success)' },
]
const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.key, s.label]))

/* The block above the sections: decisions that are waiting on the reader rather
 * than on an engineer. Static for now (the spec calls for hard-coded text that
 * moves into the database later), so it lives here as plain data — one string
 * per item, or {title, note} when a line needs a second sentence. */
const DECISIONS = [
  // TODO: paste the 7 items from IT_backlog_2026-09-17.html here. The block
  // renders only when this array is non-empty, so the page is correct meanwhile.
]

/* ── time ──────────────────────────────────────────────────────────────── */

/** Russian plural: plural(3, 'день','дня','дней') -> 'дня'. */
function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** The API writes naive UTC ISO strings ("2026-09-17T08:12:03"); a browser reads
 * those as local time, so pin them to UTC unless they already carry a zone. */
function parseUtc(iso) {
  if (!iso) return null
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso)
  const d = new Date(hasZone ? iso : `${iso}Z`)
  return isNaN(d.getTime()) ? null : d
}

function relativeTime(iso) {
  const d = parseUtc(iso)
  if (!d) return ''
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'только что'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} ${plural(hr, 'час', 'часа', 'часов')} назад`
  const day = Math.round(hr / 24)
  if (day < 31) return `${day} ${plural(day, 'день', 'дня', 'дней')} назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default function ITBacklog() {
  const theme = useTheme()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pw, setPw] = useState(() => sessionStorage.getItem('admin_pw') || '')
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')
  const [open, setOpen] = useState({})        // item id -> "Подробнее" expanded
  const [editingOwner, setEditingOwner] = useState(null)
  const [filters, setFilters] = useState({ status: [], priority: [], owner: [] })
  const [saving, setSaving] = useState({})    // item id -> true while a PATCH is in flight

  useEffect(() => {
    api.get('/it-backlog')
      .then(d => setItems(d.items || []))
      .catch(e => setError(e.message || 'Не удалось загрузить бэклог'))
      .finally(() => setLoading(false))
  }, [])

  const login = async (e) => {
    e.preventDefault()
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

  /** PATCH one field, optimistically. On failure the row snaps back to what the
   * server still holds and the reason is shown. */
  const patch = useCallback((item, body) => {
    const before = item
    setSaving(s => ({ ...s, [item.id]: true }))
    setItems(list => list.map(r => (r.id === item.id ? { ...r, ...body } : r)))
    setError('')
    api.patch(`/it-backlog/${item.id}`, body, pw)
      .then(res => {
        if (res && res.item) {
          setItems(list => list.map(r => (r.id === item.id ? res.item : r)))
        }
      })
      .catch(err => {
        setItems(list => list.map(r => (r.id === item.id ? before : r)))
        const msg = String(err.message || '')
        if (msg.includes('Unauthorized') || msg.includes('403')) {
          sessionStorage.removeItem('admin_pw')
          setPw('')
          setError('Нужен пароль администратора — изменение отменено')
        } else {
          setError(`Не удалось сохранить: ${msg || 'ошибка сети'}`)
        }
      })
      .finally(() => setSaving(s => {
        const next = { ...s }
        delete next[item.id]
        return next
      }))
  }, [pw])

  /* Facet values come from every item, so a chip never disappears just because
   * the current filter hides the last row carrying it. */
  const facets = useMemo(() => {
    const uniq = (key) => [...new Set(items.map(i => (i[key] || '').trim()).filter(Boolean))].sort()
    return { priority: uniq('priority'), owner: uniq('owner') }
  }, [items])

  const toggleFilter = (group, value) => {
    setFilters(f => {
      const on = f[group].includes(value)
      return { ...f, [group]: on ? f[group].filter(v => v !== value) : [...f[group], value] }
    })
  }
  const clearFilters = () => setFilters({ status: [], priority: [], owner: [] })
  const activeFilters = filters.status.length + filters.priority.length + filters.owner.length

  const visible = useMemo(() => items.filter(i => (
    (!filters.status.length   || filters.status.includes(i.status)) &&
    (!filters.priority.length || filters.priority.includes((i.priority || '').trim())) &&
    (!filters.owner.length    || filters.owner.includes((i.owner || '').trim()))
  )), [items, filters])

  /* Sections keep the order the API returned them in (sort_order, id), and each
   * one carries the first section_note its items supplied. */
  const sections = useMemo(() => {
    const out = []
    const byName = new Map()
    for (const item of visible) {
      const name = (item.section || '').trim() || 'Без раздела'
      let group = byName.get(name)
      if (!group) {
        group = { name, note: '', items: [] }
        byName.set(name, group)
        out.push(group)
      }
      if (!group.note && item.section_note) group.note = item.section_note
      group.items.push(item)
    }
    return out
  }, [visible])

  const slug = (name) => `itb-sec-${encodeURIComponent(name).replace(/%/g, '-')}`

  const totals = useMemo(() => {
    const counts = { new: 0, in_progress: 0, done: 0 }
    for (const i of visible) if (counts[i.status] !== undefined) counts[i.status]++
    return counts
  }, [visible])

  return (
    <div className="itb-page">
      <style>{CSS}</style>

      <aside className="itb-rail">
        <div className="itb-rail-head">
          <h1 className="itb-title">IT Backlog</h1>
          <button className="itb-theme" onClick={toggleTheme}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
        <div className="itb-sub">
          {visible.length} из {items.length} {plural(items.length, 'задачи', 'задач', 'задач')}
        </div>

        <div className="itb-rail-block">
          <div className="itb-rail-label">Разделы</div>
          {sections.length === 0 && <div className="itb-empty-small">—</div>}
          {sections.map(s => (
            <a key={s.name} href={`#${slug(s.name)}`} className="itb-index-row">
              <span className="itb-index-name">{s.name}</span>
              <span className="itb-count">{s.items.length}</span>
            </a>
          ))}
        </div>

        <div className="itb-rail-block">
          <div className="itb-rail-label">
            Фильтры
            {activeFilters > 0 && (
              <button className="itb-clear" onClick={clearFilters}>сбросить</button>
            )}
          </div>

          <div className="itb-facet">Статус</div>
          <div className="itb-chips">
            {STATUSES.map(s => (
              <button key={s.key}
                className={`itb-chip itb-chip-${s.key} ${filters.status.includes(s.key) ? 'on' : ''}`}
                onClick={() => toggleFilter('status', s.key)}>
                <span className="itb-dot" style={{ background: s.bar }} />
                {s.label}
                <span className="itb-chip-n">{totals[s.key]}</span>
              </button>
            ))}
          </div>

          {facets.priority.length > 0 && (
            <>
              <div className="itb-facet">Приоритет</div>
              <div className="itb-chips">
                {facets.priority.map(p => (
                  <button key={p}
                    className={`itb-chip ${filters.priority.includes(p) ? 'on' : ''}`}
                    onClick={() => toggleFilter('priority', p)}>{p}</button>
                ))}
              </div>
            </>
          )}

          {facets.owner.length > 0 && (
            <>
              <div className="itb-facet">Ответственный</div>
              <div className="itb-chips">
                {facets.owner.map(o => (
                  <button key={o}
                    className={`itb-chip ${filters.owner.includes(o) ? 'on' : ''}`}
                    onClick={() => toggleFilter('owner', o)}>{o}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>

      <main className="itb-main">
        {!pw && (
          <form className="itb-pwbar" onSubmit={login}>
            <span className="itb-pwbar-text">
              Пароль администратора — чтобы менять статусы и ответственных
            </span>
            <input type="password" className="itb-pwinput" value={pwInput}
              onChange={e => setPwInput(e.target.value)} placeholder="Пароль" />
            <button type="submit" className="itb-pwbtn">Войти</button>
            {pwError && <span className="itb-pwerr">{pwError}</span>}
          </form>
        )}

        {error && <div className="itb-error">{error}</div>}
        {loading && <div className="itb-loading">Загрузка…</div>}

        {!loading && DECISIONS.length > 0 && (
          <section className="itb-decisions">
            <h2 className="itb-decisions-title">Требуют твоего решения</h2>
            <ol className="itb-decisions-list">
              {DECISIONS.map((d, i) => {
                const title = typeof d === 'string' ? d : d.title
                const note = typeof d === 'string' ? '' : d.note
                return (
                  <li key={i}>
                    <span className="itb-decision-title">{title}</span>
                    {note && <span className="itb-decision-note">{note}</span>}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {!loading && items.length === 0 && (
          <div className="itb-empty">Бэклог пуст — данные ещё не загружены.</div>
        )}
        {!loading && items.length > 0 && visible.length === 0 && (
          <div className="itb-empty">Ничего не найдено по выбранным фильтрам.</div>
        )}

        {sections.map(section => (
          <section key={section.name} id={slug(section.name)} className="itb-section">
            <div className="itb-section-head">
              <h2 className="itb-section-title">{section.name}</h2>
              <span className="itb-count">{section.items.length}</span>
            </div>
            {section.note && <div className="itb-section-note">{section.note}</div>}

            {section.items.map(item => (
              <Item key={item.id} item={item} pw={pw}
                busy={!!saving[item.id]}
                expanded={!!open[item.id]}
                onToggle={() => setOpen(o => ({ ...o, [item.id]: !o[item.id] }))}
                editingOwner={editingOwner === item.id}
                onEditOwner={() => setEditingOwner(item.id)}
                onCancelOwner={() => setEditingOwner(null)}
                onPatch={patch}
                onSaveOwner={(value) => {
                  setEditingOwner(null)
                  if (value !== (item.owner || '')) patch(item, { owner: value })
                }} />
            ))}
          </section>
        ))}
      </main>
    </div>
  )
}

/* ── one row ───────────────────────────────────────────────────────────── */

function Item({ item, pw, busy, expanded, onToggle, editingOwner, onEditOwner,
                onCancelOwner, onSaveOwner, onPatch }) {
  const changed = relativeTime(item.status_changed_at)
  const hasDetails = !!(item.details_html || item.source)

  return (
    <article className={`itb-item itb-item-${item.status} ${busy ? 'itb-busy' : ''}`}>
      <div className="itb-bar" />
      <div className="itb-body">
        <div className="itb-head">
          <div className="itb-head-main">
            <h3 className="itb-item-title">{item.title}</h3>
            {changed && <div className="itb-changed">изменено {changed}</div>}
          </div>
          <Segments item={item} pw={pw} busy={busy} onPatch={onPatch} />
        </div>

        <div className="itb-tags">
          <span className={`itb-tag itb-tag-${item.status}`}>{STATUS_LABEL[item.status] || item.status}</span>
          {item.priority && <span className="itb-tag">{item.priority}</span>}
          {editingOwner ? (
            <input className="itb-owner-input" autoFocus defaultValue={item.owner || ''}
              onKeyDown={e => {
                if (e.key === 'Enter') onSaveOwner(e.currentTarget.value.trim())
                if (e.key === 'Escape') onCancelOwner()
              }}
              onBlur={onCancelOwner} />
          ) : (
            <span
              className={`itb-tag ${pw ? 'itb-tag-edit' : ''} ${item.owner ? '' : 'itb-tag-empty'}`}
              onClick={pw ? onEditOwner : undefined}
              title={pw ? 'Нажмите, чтобы изменить ответственного (Enter — сохранить)' : undefined}>
              {item.owner || (pw ? '+ ответственный' : '')}
            </span>
          )}
          {item.estimate && <span className="itb-tag">{item.estimate}</span>}
          {item.gantt_ref && <span className="itb-tag itb-tag-ref">{item.gantt_ref}</span>}
        </div>

        {item.description_html && <Html html={item.description_html} />}

        {hasDetails && (
          <button className="itb-more" onClick={onToggle}>
            {expanded ? 'Свернуть' : 'Подробнее'} <span className="itb-caret">{expanded ? '▴' : '▾'}</span>
          </button>
        )}
        {hasDetails && expanded && (
          <div className="itb-details">
            {item.details_html && <Html html={item.details_html} />}
            {item.source && <div className="itb-source">Источник: {item.source}</div>}
          </div>
        )}
      </div>
    </article>
  )
}

/** Item prose. The HTML is admin-authored (every write takes the admin password),
 * but it still goes through DOMPurify — same as EngineerWeeklyBlock — so a bad
 * paste into the seed file can never turn into script on the page. */
function Html({ html }) {
  return (
    <div className="itb-html"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) }} />
  )
}

/** Три сегмента: любое состояние → любое, одним кликом. */
function Segments({ item, pw, busy, onPatch }) {
  return (
    <div className={`itb-seg ${pw ? '' : 'itb-seg-locked'}`}
      title={pw ? undefined : 'Введите пароль администратора вверху страницы'}>
      {STATUSES.map(s => (
        <button key={s.key}
          className={`itb-seg-btn ${item.status === s.key ? 'on' : ''} itb-seg-${s.key}`}
          disabled={!pw || busy}
          onClick={() => { if (item.status !== s.key) onPatch(item, { status: s.key }) }}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

/* ── styles ────────────────────────────────────────────────────────────── */

const CSS = `
.itb-page{display:flex;align-items:flex-start;gap:0;width:100%;max-width:none;margin:0;
  min-height:100vh;background:var(--base);color:var(--text);
  font-size:14px;line-height:1.5}

/* Sticky column that always runs the full viewport height, so its surface does
 * not stop halfway down the page when the rail is shorter than the list. */
.itb-rail{flex:0 0 272px;position:sticky;top:0;align-self:flex-start;
  height:100vh;overflow-y:auto;padding:24px 20px 40px;
  border-right:1px solid var(--border);background:var(--card)}
.itb-rail-head{display:flex;align-items:center;gap:8px}
.itb-title{margin:0;font-size:19px;font-weight:700;letter-spacing:-.01em;flex:1}
.itb-theme{width:28px;height:28px;border-radius:8px;border:1px solid var(--border);
  background:transparent;color:var(--muted);cursor:pointer;font-size:13px;line-height:1}
.itb-theme:hover{color:var(--accent1);border-color:var(--accent1)}
.itb-sub{margin-top:4px;font-size:12px;color:var(--muted)}
.itb-rail-block{margin-top:26px}
.itb-rail-label{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.itb-clear{margin-left:auto;border:none;background:none;padding:0;cursor:pointer;
  font-family:inherit;font-size:10px;letter-spacing:.06em;color:var(--accent1)}
.itb-empty-small{font-size:12px;color:var(--muted)}

.itb-index-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;
  color:var(--text);text-decoration:none;font-size:13px}
.itb-index-row:hover{background:var(--accent1-bg);color:var(--accent1)}
.itb-index-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.itb-count{flex:none;min-width:20px;padding:1px 6px;border-radius:10px;text-align:center;
  background:var(--accent1-bg);border:1px solid var(--accent1-border);
  font-size:11px;font-weight:600;color:var(--accent1)}

.itb-facet{font-size:11px;color:var(--muted);margin:12px 0 6px}
.itb-chips{display:flex;flex-wrap:wrap;gap:6px}
.itb-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:14px;
  border:1px solid var(--border);background:transparent;color:var(--muted);
  font-family:inherit;font-size:11.5px;cursor:pointer}
.itb-chip:hover{color:var(--text);border-color:var(--accent1)}
.itb-chip.on{background:var(--accent1-bg);border-color:var(--accent1);color:var(--accent1);font-weight:600}
.itb-chip-n{font-variant-numeric:tabular-nums;opacity:.75}
.itb-dot{width:7px;height:7px;border-radius:50%;flex:none}

.itb-main{flex:1;min-width:0;padding:24px 28px 80px}

.itb-pwbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:18px;
  padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--card)}
.itb-pwbar-text{font-size:12.5px;color:var(--muted)}
.itb-pwinput{height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--border);
  background:var(--card2);color:var(--text);font-family:inherit;font-size:13px;width:180px}
.itb-pwinput:focus{outline:none;border-color:var(--accent1)}
.itb-pwbtn{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--accent1);
  background:var(--accent1);color:var(--on-accent);font-family:inherit;font-size:12.5px;
  font-weight:600;cursor:pointer}
.itb-pwerr{font-size:12px;color:var(--danger)}

.itb-error{margin-bottom:16px;padding:9px 13px;border-radius:8px;font-size:12.5px;
  color:var(--danger);border:1px solid var(--danger);background:transparent}
.itb-loading,.itb-empty{padding:40px 0;text-align:center;color:var(--muted);font-size:13px}

.itb-decisions{margin-bottom:30px;padding:18px 22px;border-radius:12px;
  border:1px solid var(--accent1-border);background:var(--accent1-bg)}
.itb-decisions-title{margin:0 0 12px;font-size:15px;font-weight:700;color:var(--accent1)}
.itb-decisions-list{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:9px}
.itb-decisions-list li{font-size:13.5px}
.itb-decision-title{font-weight:600}
.itb-decision-note{display:block;margin-top:2px;color:var(--muted);font-size:12.5px}

.itb-section{margin-bottom:34px}
.itb-section-head{display:flex;align-items:center;gap:10px;padding-bottom:8px;
  border-bottom:1px solid var(--border);margin-bottom:14px}
.itb-section-title{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}
.itb-section-note{margin:-8px 0 14px;font-size:12.5px;color:var(--muted)}

.itb-item{display:flex;gap:0;margin-bottom:10px;border:1px solid var(--border);
  border-radius:10px;background:var(--card);overflow:hidden}
.itb-busy{opacity:.65}
.itb-bar{flex:0 0 4px;background:var(--border)}
.itb-item-new .itb-bar{background:var(--danger)}
.itb-item-in_progress .itb-bar{background:var(--warning)}
/* Done rows are finished business — the green recedes rather than shouting. */
.itb-item-done .itb-bar{background:var(--success);opacity:.45}
.itb-item-done .itb-item-title{color:var(--muted)}

.itb-body{flex:1;min-width:0;padding:13px 16px}
.itb-head{display:flex;align-items:flex-start;gap:14px}
.itb-head-main{flex:1;min-width:0}
.itb-item-title{margin:0;font-size:14.5px;font-weight:600;line-height:1.35}
.itb-changed{margin-top:3px;font-size:11px;color:var(--muted)}

.itb-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.itb-tag{padding:2px 8px;border-radius:5px;border:1px solid var(--border);
  background:var(--card2);font-size:11px;color:var(--muted);white-space:nowrap}
.itb-tag-new{border-color:var(--danger);color:var(--danger)}
.itb-tag-in_progress{border-color:var(--warning);color:var(--warning)}
.itb-tag-done{border-color:var(--success);color:var(--success);opacity:.8}
.itb-tag-ref{border-color:var(--accent1-border);color:var(--accent1)}
.itb-tag-edit{cursor:text}
.itb-tag-edit:hover{border-color:var(--accent1);color:var(--accent1)}
.itb-tag-empty{border-style:dashed;opacity:.7}
.itb-owner-input{height:22px;width:150px;padding:0 7px;border-radius:5px;
  border:1px solid var(--accent1);background:var(--card2);color:var(--text);
  font-family:inherit;font-size:11px}
.itb-owner-input:focus{outline:none}

.itb-html{margin-top:9px;font-size:13px;color:var(--text)}
.itb-html p{margin:0 0 7px}
.itb-html p:last-child{margin-bottom:0}
.itb-html ul,.itb-html ol{margin:0 0 7px;padding-left:20px}
.itb-html li{margin-bottom:3px}
.itb-html code{padding:1px 4px;border-radius:4px;background:var(--card2);font-size:12px}
.itb-html a{color:var(--accent1)}
.itb-html table{border-collapse:collapse;font-size:12.5px}
.itb-html th,.itb-html td{border:1px solid var(--border);padding:4px 8px;text-align:left}

.itb-more{margin-top:9px;padding:0;border:none;background:none;cursor:pointer;
  font-family:inherit;font-size:12px;font-weight:600;color:var(--accent1)}
.itb-caret{font-size:9px}
.itb-details{margin-top:8px;padding-top:9px;border-top:1px dashed var(--border)}
.itb-source{margin-top:8px;font-size:11.5px;color:var(--muted)}

.itb-seg{flex:none;display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.itb-seg-locked{opacity:.45}
.itb-seg-btn{padding:4px 11px;border:none;border-right:1px solid var(--border);
  background:var(--card2);color:var(--muted);font-family:inherit;font-size:11.5px;
  cursor:pointer;white-space:nowrap}
.itb-seg-btn:last-child{border-right:none}
.itb-seg-btn:disabled{cursor:default}
.itb-seg-btn:not(:disabled):hover{color:var(--text)}
.itb-seg-new.on{background:var(--danger);color:#fff}
.itb-seg-in_progress.on{background:var(--warning);color:#1a1300}
.itb-seg-done.on{background:var(--success);color:var(--on-accent)}
.itb-seg-btn.on{font-weight:600}

@media (max-width:900px){
  .itb-page{flex-direction:column}
  .itb-rail{position:static;flex:none;width:100%;height:auto;
    border-right:none;border-bottom:1px solid var(--border)}
  .itb-main{padding:18px 16px 60px;width:100%}
  .itb-head{flex-direction:column;gap:9px}
}
`
