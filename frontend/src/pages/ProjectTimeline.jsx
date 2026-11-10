/* ProjectTimeline — «Проекты», /projects.
 *
 * Отвечает на один вопрос, который Сардор задал на IT Weekly 06.11:
 * «Как долго человек тянет проект и не заканчивает его». Поэтому единица
 * строки — проект, а не таск, и первая колонка после названия — длительность.
 *
 * Данные: GET /api/gantt (тот же ответ, что у TeamGantt). Группировка в
 * проекты живёт в lib/projectMap.js — страница ничего не пишет в базу.
 *
 * Две шкалы времени, и они не смешаны: доска начинается 6 июля 2026, история
 * из git (карта Брюнеткина) — 6 апреля. Где проект есть в обеих, длительность
 * показана по git со звёздочкой, а состав задач — по доске.
 */
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { RequestsStyle } from './itRequestsStyle'
import { projectOf, GIT_HISTORY, BOARD_START, GIT_START } from '../lib/projectMap'

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DAY = 864e5
const OPEN_STATUSES = ['active', 'queued', 'continuous']

const ZOOMS = {
  board: { from: BOARD_START, label: 'доска: с 6 июля' },
  git: { from: GIT_START, label: 'git: с 6 апреля' },
  quarter: { from: null, label: 'квартал', months: 3 },
}
const SORTS = {
  duration: 'по длительности',
  start: 'по началу',
  size: 'по числу задач',
}
const STATUS_RU = { done: 'закрыто', active: 'в работе', queued: 'в очереди', continuous: 'постоянная' }

const iso = (d) => d.toISOString().slice(0, 10)
const addWorkingDays = (start, days) => {
  const d = new Date(start)
  let left = Math.max(1, days || 1) - 1
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) left--
  }
  return iso(d)
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY)
const fmtDate = (s) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

/** Задачи с доски → проекты с подзадачами. */
function buildProjects(engineers, today) {
  const byName = new Map()
  for (const eng of engineers || []) {
    for (const a of eng.assignments || []) {
      if (!a.start_date) continue
      const name = projectOf(a)
      if (!name) continue
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name).push({
        ref: a.ref,
        title: a.project || 'Без названия',
        who: eng.name,
        color: eng.color,
        start: a.start_date,
        end: addWorkingDays(a.start_date, a.est_days),
        days: a.est_days,
        percent: a.percent ?? 0,
        status: a.status || 'active',
      })
    }
  }

  const out = []
  for (const [name, tasks] of byName) {
    tasks.sort((x, y) => x.start.localeCompare(y.start))
    const open = tasks.filter((t) => OPEN_STATUSES.includes(t.status))
    const finished = open.length === 0
    const boardStart = tasks[0].start
    const lastEnd = tasks.reduce((m, t) => (t.end > m ? t.end : m), tasks[0].end)
    const git = GIT_HISTORY[name] || null
    const start = git ? git.start : boardStart
    const end = finished ? (git && git.last > lastEnd ? git.last : lastEnd) : today
    const lead = [...tasks.reduce((m, t) => m.set(t.who, (m.get(t.who) || 0) + 1), new Map())]
      .sort((a, b) => b[1] - a[1])[0][0]
    out.push({
      name,
      tasks,
      git,
      boardStart,
      start,
      end,
      lastEnd,
      finished,
      span: daysBetween(start, end),
      openCount: open.length,
      doneCount: tasks.filter((t) => t.status === 'done').length,
      percent: Math.round(tasks.reduce((s, t) => s + (t.percent ?? 0), 0) / tasks.length),
      lead,
      team: [...new Set(tasks.map((t) => t.who))],
    })
  }
  return out
}

function monthsBetween(from, to) {
  const out = []
  const end = new Date(to)
  const c = new Date(new Date(from).getFullYear(), new Date(from).getMonth(), 1)
  while (c <= end) {
    out.push(new Date(c))
    c.setMonth(c.getMonth() + 1)
  }
  return out
}

function Bar({ left, width, tone, label, fill, tall }) {
  return (
    <div
      className={`pt-bar${tall ? ' pt-bar-lg' : ''}`}
      data-tone={tone}
      style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}
    >
      {fill > 0 && fill < 100 && <span className="pt-bar-fill" style={{ width: `${fill}%` }} />}
      <span className="pt-bar-label">{label}</span>
    </div>
  )
}

export default function ProjectTimeline() {
  const [engineers, setEngineers] = useState(null)
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState('board')
  const [sort, setSort] = useState('duration')
  const [opened, setOpened] = useState(() => new Set())

  const today = iso(new Date())

  useEffect(() => {
    let alive = true
    api.get('/gantt')
      .then((d) => { if (alive) setEngineers(d.engineers || []) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])

  const projects = useMemo(
    () => (engineers ? buildProjects(engineers, today) : []),
    [engineers, today],
  )

  const sorted = useMemo(() => {
    const list = [...projects]
    if (sort === 'start') list.sort((a, b) => a.start.localeCompare(b.start))
    else if (sort === 'size') list.sort((a, b) => b.tasks.length - a.tasks.length)
    else list.sort((a, b) => (a.finished - b.finished) || (b.span - a.span))
    return list
  }, [projects, sort])

  const scale = useMemo(() => {
    const last = projects.reduce((m, p) => (p.end > m ? p.end : m), today)
    const to = new Date(last)
    to.setMonth(to.getMonth() + 1, 0)
    let from = ZOOMS[zoom].from
    if (!from) {
      const d = new Date(to)
      d.setMonth(d.getMonth() - (ZOOMS[zoom].months - 1), 1)
      from = iso(d)
    }
    const t0 = new Date(from)
    const span = (to - t0) / DAY || 1
    return {
      from,
      to: iso(to),
      months: monthsBetween(from, iso(to)),
      pos: (d) => Math.max(0, Math.min(100, ((new Date(d) - t0) / DAY / span) * 100)),
    }
  }, [projects, zoom, today])

  const toggle = (name) => setOpened((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const openProjects = projects.filter((p) => !p.finished)
  const longest = openProjects.reduce((a, p) => (!a || p.span > a.span ? p : a), null)
  const taskCount = projects.reduce((s, p) => s + p.tasks.length, 0)

  return (
    <div className="pt-page">
      <RequestsStyle />
      <Style />

      <div className="pt-head">
        <Link to="/" className="pt-back">← Дашборд</Link>
        <h1 className="pt-title">Проекты</h1>
        <Link to="/team-gantt" className="pt-back">Гант по задачам →</Link>
      </div>
      <p className="pt-sub">
        Сколько тянется каждый проект, а не сколько тасков закрыто. Задачи с доски Team Gantt,
        свёрнутые в проекты. По четырём проектам длительность взята из карты Брюнеткина (git,
        с 6 апреля) и помечена звёздочкой — доска начинается только 6 июля.
      </p>

      {error && <div className="pt-state pt-state-err">Не удалось загрузить: {error}</div>}
      {!engineers && !error && <div className="pt-state">Загружаю доску…</div>}

      {engineers && !error && (
        <>
          <div className="pt-stats">
            <Stat value={projects.length} label="проектов" />
            <Stat value={openProjects.length} label="открыто" />
            <Stat value={projects.length - openProjects.length} label="закрыто" />
            <Stat value={taskCount} label="задач" />
            {longest && <Stat value={`${longest.span} дн`} label={`дольше всех открыт: ${longest.name}`} />}
          </div>

          <div className="pt-controls">
            <Group title="Масштаб" options={ZOOMS} value={zoom} onChange={setZoom} />
            <Group title="Сортировка" options={SORTS} value={sort} onChange={setSort} />
          </div>

          <div className="pt-board">
            <div className="pt-scroll">
              <div className="pt-grid">
                <div className="pt-row pt-header">
                  <div className="pt-cell">Проект</div>
                  <div className="pt-cell pt-dur">Тянется</div>
                  <div className="pt-track pt-months" style={{ gridTemplateColumns: `repeat(${scale.months.length}, 1fr)` }}>
                    {scale.months.map((m) => (
                      <span key={+m} className="pt-month">{MONTHS_RU[m.getMonth()]}</span>
                    ))}
                  </div>
                </div>

                {sorted.map((p) => {
                  const isOpen = opened.has(p.name)
                  const left = scale.pos(p.start)
                  return (
                    <div key={p.name} className="pt-group">
                      <div
                        className={`pt-row pt-project${isOpen ? ' is-open' : ''}`}
                        onClick={() => toggle(p.name)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.name) } }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isOpen}
                      >
                        <div className="pt-cell">
                          <span className="pt-tog" aria-hidden="true">▶</span>
                          <span className="pt-name" title={p.name}>{p.name}</span>
                        </div>
                        <div className={`pt-cell pt-dur${!p.finished && p.span >= 150 ? ' is-hot' : ''}`}>
                          <b>{p.span}</b>&nbsp;дн{p.git && <sup title="длительность по git">*</sup>}
                        </div>
                        <div
                          className="pt-track"
                          title={projectTitle(p)}
                        >
                          <Bar
                            left={left}
                            width={scale.pos(p.end) - left}
                            tone={p.finished ? 'done' : 'open'}
                            fill={p.finished ? 0 : p.percent}
                            label={`${p.lead} · ${p.doneCount}/${p.tasks.length}`}
                            tall
                          />
                          <span className="pt-today" style={{ left: `${scale.pos(today)}%` }} />
                        </div>
                      </div>

                      {isOpen && p.tasks.map((t) => {
                        const tl = scale.pos(t.start)
                        return (
                          <div key={t.ref || t.title} className="pt-row pt-task">
                            <div className="pt-cell">
                              <span className="pt-name pt-name-sub" title={t.title}>{t.title}</span>
                            </div>
                            <div className="pt-cell pt-dur pt-dur-sub">{t.days}&nbsp;р.д.</div>
                            <div className="pt-track" title={taskTitle(t)}>
                              <Bar
                                left={tl}
                                width={scale.pos(t.end) - tl}
                                tone={t.status === 'done' ? 'done' : t.status === 'active' ? 'open' : 'idle'}
                                fill={0}
                                label={t.who}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="pt-legend">
            <span><i data-tone="open" />проект открыт</span>
            <span><i data-tone="done" />проект закрыт</span>
            <span><i data-tone="idle" />задача в очереди или постоянная</span>
            <span><i className="pt-legend-today" />сегодня</span>
            <span>* длительность по git, не по доске</span>
          </div>

          <p className="pt-note">
            <b>Два источника, не смешаны.</b> Доска Team Gantt начинается 6 июля 2026 — раньше
            задачи в ней не велись. Карта проектов Андрея Брюнеткина построена из git
            (14 репозиториев, 1 573 коммита, 1 026 заметок) и начинается 6 апреля. Где проект
            есть в обеих, длительность показана по git, а состав задач — по доске. Его линии
            «Call center», «Alliance Connect», «CRMv2» и «DWH» с доской не сведены: это его
            участки работы, а не те же проекты. Группировка задач в проекты живёт в
            <code> frontend/src/lib/projectMap.js</code> и правится там же. Отпуска исключены.
          </p>
        </>
      )}
    </div>
  )
}

const projectTitle = (p) => [
  p.name,
  `Ведёт: ${p.lead}`,
  `Участвуют: ${p.team.join(', ')}`,
  `На доске с ${fmtDate(p.boardStart)}`,
  p.git ? `В git с ${fmtDate(p.git.start)} — ${p.git.stages} этапов, карта Брюнеткина` : null,
  p.finished ? `Закрыт ${fmtDate(p.lastEnd)}` : `Открыт до сих пор, ${p.span} дн`,
  `Задачи: ${p.doneCount} из ${p.tasks.length} закрыто${p.openCount ? `, ${p.openCount} в работе` : ''}`,
].filter(Boolean).join('\n')

const taskTitle = (t) => [
  t.title,
  `Кто: ${t.who}`,
  `Период: ${fmtDate(t.start)} — ${fmtDate(t.end)}, ${t.days} раб. дн.`,
  `Статус: ${STATUS_RU[t.status] || t.status}, ${t.percent}%`,
  t.ref ? `Номер: ${t.ref}` : null,
].filter(Boolean).join('\n')

function Stat({ value, label }) {
  return (
    <div className="pt-stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function Group({ title, options, value, onChange }) {
  return (
    <div className="pt-group-ctl">
      <em>{title}</em>
      {Object.entries(options).map(([key, opt]) => (
        <button
          key={key}
          type="button"
          className="pt-chip"
          aria-pressed={key === value}
          onClick={() => onChange(key)}
        >
          {typeof opt === 'string' ? opt : opt.label}
        </button>
      ))}
    </div>
  )
}

function Style() {
  return (
    <style>{`
.pt-page{font-family:var(--ios-font);background:var(--ios-bg);color:var(--ios-label);
  min-height:100vh;padding:24px max(16px,env(safe-area-inset-left,0px)) 56px max(16px,env(safe-area-inset-right,0px))}
.pt-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;max-width:1200px;margin:0 auto 4px}
.pt-title{font-size:26px;margin:0;letter-spacing:-.02em;flex:1;min-width:0}
.pt-back{color:var(--ios-blue-text);text-decoration:none;font-size:13px;font-weight:500;white-space:nowrap}
.pt-back:hover{text-decoration:underline}
.pt-sub,.pt-note,.pt-state,.pt-stats,.pt-controls,.pt-board,.pt-legend{max-width:1200px;margin-left:auto;margin-right:auto}
.pt-sub{color:var(--ios-label2);font-size:13.5px;line-height:1.5;margin:0 0 16px;max-width:78ch}
.pt-state{background:var(--ios-card);border:1px solid var(--ios-sep);border-radius:12px;
  padding:18px;color:var(--ios-label2);font-size:14px}
.pt-state-err{color:var(--ios-orange-text);background:var(--ios-orange-tint)}
.pt-stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.pt-stat{background:var(--ios-card);border:1px solid var(--ios-sep);border-radius:10px;padding:9px 13px}
.pt-stat b{display:block;font-size:19px;font-variant-numeric:tabular-nums}
.pt-stat span{color:var(--ios-label3);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.pt-controls{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:12px}
.pt-group-ctl{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pt-group-ctl>em{font-style:normal;color:var(--ios-label3);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.pt-chip{border:1px solid var(--ios-sep);background:var(--ios-card);color:var(--ios-label2);
  border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
.pt-chip[aria-pressed="true"]{background:var(--ios-blue-fill);border-color:var(--ios-blue-fill);color:#fff}
.pt-chip:focus-visible{outline:2px solid var(--ios-blue);outline-offset:2px}
.pt-board{background:var(--ios-card);border:1px solid var(--ios-sep);border-radius:14px;
  box-shadow:var(--ios-shadow);overflow:hidden}
.pt-scroll{overflow-x:auto}
.pt-grid{min-width:900px}
.pt-row{display:grid;grid-template-columns:250px 92px 1fr;border-bottom:1px solid var(--ios-sep)}
.pt-group:last-child .pt-row:last-child{border-bottom:0}
.pt-header{position:sticky;top:0;background:var(--ios-card);z-index:3}
.pt-header .pt-cell,.pt-header .pt-month{font-size:11px;text-transform:uppercase;
  letter-spacing:.07em;color:var(--ios-label3)}
.pt-cell{padding:8px 14px;display:flex;align-items:center;gap:7px;min-width:0}
.pt-project{cursor:pointer;background:color-mix(in srgb,var(--ios-label) 5%,transparent)}
.pt-project:hover{filter:brightness(.985)}
.pt-project:focus-visible{outline:2px solid var(--ios-blue);outline-offset:-2px}
.pt-tog{width:14px;flex:0 0 14px;font-size:9px;color:var(--ios-label3);transition:transform .14s}
.pt-project.is-open .pt-tog{transform:rotate(90deg)}
.pt-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.pt-name-sub{font-weight:400;font-size:12.5px;color:var(--ios-label2);padding-left:21px}
.pt-dur{justify-content:flex-end;font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}
.pt-dur b{font-weight:600}
.pt-dur.is-hot b{color:var(--ios-orange-text)}
.pt-dur-sub{color:var(--ios-label3);font-size:11.5px}
.pt-track{position:relative;min-width:0;padding:8px 0}
.pt-months{display:grid;padding:0}
.pt-month{padding:8px 0 8px 8px;border-left:1px solid var(--ios-sep);overflow:hidden;white-space:nowrap}
.pt-bar{position:absolute;top:50%;transform:translateY(-50%);height:18px;border-radius:5px;
  display:flex;align-items:center;padding:0 7px;font-size:10.5px;overflow:hidden;white-space:nowrap}
.pt-bar-lg{height:23px;font-weight:600;font-size:11px}
.pt-bar[data-tone="done"]{background:#2f5d50;color:#fff}
.pt-bar[data-tone="open"]{background:#b4701f;color:#fff}
.pt-bar[data-tone="idle"]{background:#9a9da6;color:#fff}
.pt-bar-fill{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.24)}
.pt-bar-label{position:relative}
.pt-today{position:absolute;top:0;bottom:0;width:2px;background:#d02040;z-index:2}
.pt-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:13px;font-size:12px;color:var(--ios-label3)}
.pt-legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.pt-legend i[data-tone="done"]{background:#2f5d50}
.pt-legend i[data-tone="open"]{background:#b4701f}
.pt-legend i[data-tone="idle"]{background:#9a9da6}
.pt-legend-today{background:#d02040;width:2px!important;border-radius:0!important}
.pt-note{color:var(--ios-label3);font-size:12.5px;line-height:1.55;margin-top:14px;max-width:78ch}
.pt-note code{font-size:11.5px}
@media(max-width:560px){.pt-row{grid-template-columns:150px 74px 1fr}.pt-title{font-size:21px}}
    `}</style>
  )
}
