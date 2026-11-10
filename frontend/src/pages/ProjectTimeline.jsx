/* ProjectTimeline — «Проекты», /projects.
 *
 * Отвечает на вопрос, который Сардор задал на IT Weekly 06.11: «как долго
 * человек тянет проект и не заканчивает его». Поэтому строка — проект, а не
 * таск, и первая колонка после названия — длительность.
 *
 * Строка проекта разбита по неделям, и неделя закрашена только когда работа
 * действительно шла: по проекту была открытая задача И её исполнитель в ту
 * неделю сдавал ежедневные отчёты. Неделя без отчётов остаётся пустой — это и
 * есть разрыв. Отпуск штрихуется отдельно.
 *
 * Данные: GET /api/gantt (задачи и отпуска) и GET /api/reports/days (в какие
 * дни кто отчитывался). Страница ничего не пишет.
 *
 * Привязка задачи к проекту к отчётам не имеет отношения: она идёт только с
 * доски, через lib/projectMap.js. Текст отчётов не разбирается — совпадение
 * слова не считается доказательством работы по проекту.
 */
import { Fragment, useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import AppFooter from '../components/AppFooter'
import {
  projectOf, GIT_HISTORY, BOARD_START, GIT_START, VACATION, VACATION_WORKING,
} from '../lib/projectMap'

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DAY = 864e5
const OPEN_STATUSES = ['active', 'queued', 'continuous']
const STATUS_RU = { done: 'закрыто', active: 'в работе', queued: 'в очереди', continuous: 'постоянная' }

const ZOOMS = {
  board: { from: BOARD_START, label: 'доска: с 6 июля' },
  git: { from: GIT_START, label: 'git: с 6 апреля' },
  quarter: { from: null, months: 3, label: 'квартал' },
}
/* Кого показываем при открытии. Остальных можно вернуть прямо на странице —
 * это фильтр отображения, ничего не скрывает в данных. */
const DEFAULT_LEADS = ['Andrey Pogrebnyak', 'Andrey Brunetkin', 'Azizbek Turgunov']

const SORTS = {
  duration: 'по длительности',
  owner: 'по разработчику',
  start: 'по началу',
  size: 'по числу задач',
}

/** Фамилия — в колонке «Кто». Имена на доске английские и фамилии не повторяются,
 *  так что двух Андреев и двух Дмитриев она различает, а имя целиком не влезает. */
const lastName = (full) => (full || '').trim().split(/\s+/).pop()

const iso = (d) => d.toISOString().slice(0, 10)
const fmtDate = (s) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY)

function addWorkingDays(start, days) {
  const d = new Date(start)
  let left = Math.max(1, days || 1) - 1
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) left--
  }
  return iso(d)
}

/** Понедельник недели, в которую попадает дата. */
function mondayOf(dateStr) {
  const d = new Date(dateStr)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return iso(d)
}

function weeksBetween(from, to) {
  const out = []
  const cur = new Date(mondayOf(from))
  const end = new Date(to)
  while (cur <= end) {
    out.push(iso(cur))
    cur.setDate(cur.getDate() + 7)
  }
  return out
}

function monthsBetween(from, to) {
  const out = []
  const end = new Date(to)
  const cur = new Date(new Date(from).getFullYear(), new Date(from).getMonth(), 1)
  while (cur <= end) {
    out.push(new Date(cur))
    cur.setMonth(cur.getMonth() + 1)
  }
  return out
}

/** Отпуска с доски: по инженеру — отрезки, когда его не было. */
function readVacations(engineers) {
  const byEngineer = new Map()
  for (const eng of engineers || []) {
    for (const a of eng.assignments || []) {
      if (!a.start_date || !VACATION.test(a.project || '')) continue
      if (VACATION_WORKING.test(a.project || '')) continue
      if (!byEngineer.has(eng.name)) byEngineer.set(eng.name, [])
      byEngineer.get(eng.name).push({
        start: a.start_date,
        end: addWorkingDays(a.start_date, a.est_days),
        label: a.project,
      })
    }
  }
  return byEngineer
}

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
        engineerId: eng.id,
        color: eng.color || 'var(--accent1)',
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
    const counts = tasks.reduce((m, t) => m.set(t.who, (m.get(t.who) || 0) + 1), new Map())
    const lead = [...counts].sort((a, b) => b[1] - a[1])[0][0]
    out.push({
      name, tasks, git, boardStart, lastEnd, start, end, finished, lead,
      span: daysBetween(start, end),
      openCount: open.length,
      doneCount: tasks.filter((t) => t.status === 'done').length,
      percent: Math.round(tasks.reduce((s, t) => s + (t.percent ?? 0), 0) / tasks.length),
      leadColor: tasks.find((t) => t.who === lead)?.color || 'var(--accent1)',
      team: [...counts.keys()],
    })
  }
  return out
}

/* Что было в эту неделю по проекту.
 *
 *   work     — в отчётах есть пункты по этому проекту; level 1..3 по объёму
 *   vacation — задача есть, но все её исполнители были в отпуске
 *   idle     — задача на доске есть, а в отчётах по проекту ни одного пункта.
 *              Это и есть «проект лежит»: открыт, но работа шла не по нему
 *   none     — задач на эту неделю нет
 *
 * Объём — число пунктов ежедневных отчётов, отнесённых к проекту
 * (backend/project_rules.py). Шкала грубая нарочно: разницу между 1 и 2
 * пунктами показывать нечестно, а между 1 и 30 — нужно. */
function weekCell(project, weekStart, activity, vacations) {
  const weekEnd = iso(new Date(new Date(weekStart).getTime() + 6 * DAY))
  const count = (activity[project.name] || {})[weekStart] || 0
  if (count > 0) {
    return { state: 'work', count, level: count >= 10 ? 3 : count >= 3 ? 2 : 1 }
  }
  const inWeek = project.tasks.filter((t) => t.start <= weekEnd && t.end >= weekStart)
  if (!inWeek.length) return { state: 'none', count: 0 }

  const owners = [...new Set(inWeek.map((t) => t.who))]
  const away = owners.every((who) =>
    (vacations.get(who) || []).some((v) => v.start <= weekEnd && v.end >= weekStart))
  return { state: away ? 'vacation' : 'idle', count: 0 }
}

export default function ProjectTimeline() {
  const [engineers, setEngineers] = useState(null)
  const [overview, setOverview] = useState(null)
  const [teamXp, setTeamXp] = useState(0)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState('board')
  const [sort, setSort] = useState('duration')
  const [leads, setLeads] = useState(null)   // null = ещё не выбирали, берём DEFAULT_LEADS
  const [opened, setOpened] = useState(() => new Set())

  const today = iso(new Date())

  useEffect(() => {
    let alive = true
    api.get('/gantt')
      .then((d) => { if (alive) setEngineers(d.engineers || []) })
      .catch((e) => { if (alive) setError(e.message) })
    api.get(`/projects/activity?start=${GIT_START}&end=${today}`)
      .then((d) => { if (alive) setActivity(d) })
      .catch(() => { /* без отчётов недели останутся в состоянии «задача есть» */ })
    // Шапка страницы — та же, что на остальном дашборде.
    api.get('/overview').then((d) => { if (alive) setOverview(d) }).catch(() => {})
    api.get('/leaderboard')
      .then((d) => { if (alive) setTeamXp((d || []).reduce((sum, m) => sum + (m.total_score || 0), 0)) })
      .catch(() => {})
    return () => { alive = false }
  }, [today])

  const projects = useMemo(
    () => (engineers ? buildProjects(engineers, today) : []),
    [engineers, today],
  )
  const vacations = useMemo(() => readVacations(engineers), [engineers])
  const byProject = activity?.projects || {}
  /* Сколько проектов команда вела одновременно в последнюю неделю с отчётами —
   * вторая половина ответа на «человек тянет один проект». */
  const lastWeek = activity?.weeks?.[activity.weeks.length - 1]
  const parallel = lastWeek ? activity.team_week?.[lastWeek] : null

  /* В режиме «по разработчику» строки собираются в группы с шапкой на человека —
   * тогда его отпуск виден одной полосой сразу по всем его проектам. */
  /* Все, кто что-то ведёт, в порядке числа проектов — для строки фильтра. */
  const allLeads = useMemo(() => {
    const c = new Map()
    for (const p of projects) c.set(p.lead, (c.get(p.lead) || 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [projects])

  const shown = useMemo(() => {
    if (!allLeads.length) return projects
    const picked = leads ?? allLeads.filter((n) => DEFAULT_LEADS.includes(n))
    if (!picked.length) return projects
    return projects.filter((p) => picked.includes(p.lead))
  }, [projects, leads, allLeads])

  const groups = useMemo(() => {
    const byDuration = (a, b) => (a.finished - b.finished) || (b.span - a.span)
    if (sort !== 'owner') {
      const list = [...shown]
      if (sort === 'start') list.sort((a, b) => a.start.localeCompare(b.start))
      else if (sort === 'size') list.sort((a, b) => b.tasks.length - a.tasks.length)
      else list.sort(byDuration)
      return [{ key: null, projects: list }]
    }
    const byLead = new Map()
    for (const p of shown) {
      if (!byLead.has(p.lead)) byLead.set(p.lead, [])
      byLead.get(p.lead).push(p)
    }
    return [...byLead.entries()]
      .map(([lead, list]) => {
        list.sort(byDuration)
        return {
          key: lead,
          color: list[0].leadColor,
          projects: list,
          open: list.filter((p) => !p.finished).length,
          longest: list.reduce((m, p) => (!p.finished && p.span > m ? p.span : m), 0),
        }
      })
      .sort((a, b) => b.longest - a.longest || b.projects.length - a.projects.length)
  }, [shown, sort])

  const scale = useMemo(() => {
    const last = shown.reduce((m, p) => (p.end > m ? p.end : m), today)
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
      from, to: iso(to),
      months: monthsBetween(from, iso(to)),
      weeks: weeksBetween(from, iso(to)),
      pos: (d) => Math.max(0, Math.min(100, ((new Date(d) - t0) / DAY / span) * 100)),
    }
  }, [shown, zoom, today])

  const toggle = (name) => setOpened((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const openProjects = shown.filter((p) => !p.finished)
  const longest = openProjects.reduce((a, p) => (!a || p.span > a.span ? p : a), null)
  const taskCount = shown.reduce((s, p) => s + p.tasks.length, 0)
  const hasActivity = Boolean(activity)

  return (
    <>
      <TopBar
        teamName={overview?.team_name}
        week={overview?.current_week}
        year={overview?.current_year}
        totalScore={teamXp}
      />
      <div className="page">
        <Style />

        {/* Та же полоса вкладок, что на дашборде. Здесь только те, за которыми
          * стоит свой адрес: вкладки-состояния живут на самом дашборде. */}
        <div className="tabs">
          <Link to="/" className="tab-btn">← Дашборд</Link>
          <Link to="/team-gantt" className="tab-btn">📅 Gantt</Link>
          <span className="tab-btn active">🗂 Проекты</span>
          <Link to="/it-requests/home" className="tab-btn">IT request</Link>
          <Link to="/team-plan" className="tab-btn">Team Plan</Link>
        </div>

        <h1 className="pt-h1">Проекты</h1>
      <p className="pt-lede">
        Сколько тянется проект и сколько по нему на самом деле работали. Насыщенность недели —
        объём работы по отчётам за ту неделю; бледная неделя значит, что задача открыта, а работа
        шла не по ней; штриховка — отпуск. Открытый проект и проект в работе — разные вещи.
      </p>

      {error && <div className="pt-note pt-note-err">Не удалось загрузить доску: {error}</div>}
      {!engineers && !error && <div className="pt-note">Загружаю доску…</div>}

      {engineers && !error && (
        <>
          <div className="pt-stats">
            <Stat value={shown.length} label="проектов" />
            <Stat value={openProjects.length} label="открыто" />
            <Stat value={shown.length - openProjects.length} label="закрыто" />
            <Stat value={taskCount} label="задач" />
            {parallel && <Stat value={parallel.projects} label="проектов в работе на прошлой неделе" />}
            {longest && <Stat value={`${longest.span} дн`} label={`дольше всех открыт: ${longest.name}`} wide />}
          </div>

          <div className="pt-controls">
            <Group title="Масштаб" options={ZOOMS} value={zoom} onChange={setZoom} />
            <Group title="Сортировка" options={SORTS} value={sort} onChange={setSort} />
          </div>

          <div className="pt-controls">
            <div className="pt-ctl">
              <em>Разработчики</em>
              {allLeads.map((name) => {
                const picked = (leads ?? allLeads.filter((n) => DEFAULT_LEADS.includes(n))).includes(name)
                return (
                  <button
                    key={name} type="button" className="pt-chip" aria-pressed={picked}
                    onClick={() => setLeads((prev) => {
                      const base = prev ?? allLeads.filter((n) => DEFAULT_LEADS.includes(n))
                      return base.includes(name) ? base.filter((n) => n !== name) : [...base, name]
                    })}
                  >
                    {lastName(name)}
                  </button>
                )
              })}
              <button type="button" className="pt-chip" onClick={() => setLeads(allLeads)}>все</button>
            </div>
          </div>

          {shown.length < projects.length && (
            <p className="pt-filtered">
              Показаны проекты троих: {shown.length} из {projects.length}. Остальные скрыты
              фильтром, из данных ничего не убрано.
            </p>
          )}

          <div className="pt-board">
            <div className="pt-scroll">
              <div className="pt-grid">
                <div className="pt-row pt-head">
                  <div className="pt-c">Проект</div>
                  <div className="pt-c pt-who">Кто</div>
                  <div className="pt-c pt-dur">Тянется</div>
                  <div className="pt-track pt-months" style={{ gridTemplateColumns: `repeat(${scale.months.length},1fr)` }}>
                    {scale.months.map((m) => <span key={+m} className="pt-mo">{MONTHS_RU[m.getMonth()]}</span>)}
                  </div>
                </div>

                {groups.map((g) => (
                <Fragment key={g.key || 'all'}>
                {g.key && (
                  <div className="pt-row pt-owner">
                    <div className="pt-c">
                      <span className="pt-dot" style={{ background: g.color }} />
                      <span className="pt-nm">{g.key}</span>
                    </div>
                    <div className="pt-c pt-who">{g.projects.length}&nbsp;пр.</div>
                    <div className="pt-c pt-dur">{g.open ? `${g.open} откр.` : 'всё закрыто'}</div>
                    <div className="pt-track">
                      {(vacations.get(g.key) || []).map((v) => (
                        <span
                          key={v.start}
                          className="pt-vacband"
                          title={`${g.key}: ${v.label}, ${fmtDate(v.start)} — ${fmtDate(v.end)}`}
                          style={{ left: `${scale.pos(v.start)}%`, width: `${Math.max(scale.pos(v.end) - scale.pos(v.start), 0.5)}%` }}
                        />
                      ))}
                      <span className="pt-today" style={{ left: `${scale.pos(today)}%` }} />
                    </div>
                  </div>
                )}
                {g.projects.map((p) => {
                  const isOpen = opened.has(p.name)
                  return (
                    <div key={p.name} className="pt-g">
                      <div
                        className={`pt-row pt-proj${isOpen ? ' is-open' : ''}`}
                        role="button" tabIndex={0} aria-expanded={isOpen}
                        onClick={() => toggle(p.name)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.name) } }}
                      >
                        <div className="pt-c">
                          <span className="pt-tog" aria-hidden="true">▶</span>
                          <span className="pt-nm" title={p.name}>{p.name}</span>
                          <span className={`pt-pill${p.finished ? ' is-done' : ''}`}>
                            {p.finished ? 'закрыт' : `${p.openCount} в работе`}
                          </span>
                        </div>
                        <div className="pt-c pt-who" title={`Ведёт: ${p.lead}. Участвуют: ${p.team.join(', ')}`}>
                          <span className="pt-dot" style={{ background: p.leadColor }} />
                          <span className="pt-who-nm">{lastName(p.lead)}</span>
                          {p.team.length > 1 && <span className="pt-more">+{p.team.length - 1}</span>}
                        </div>
                        <div className={`pt-c pt-dur${!p.finished && p.span >= 150 ? ' is-hot' : ''}`}>
                          <b>{p.span}</b>&nbsp;дн{p.git && <sup title="длительность по git">*</sup>}
                        </div>
                        <div className="pt-track" title={projectTitle(p, hasActivity, byProject)}>
                          <span
                            className={`pt-span${p.finished ? ' is-done' : ''}`}
                            style={{ left: `${scale.pos(p.start)}%`, width: `${Math.max(scale.pos(p.end) - scale.pos(p.start), 0.6)}%` }}
                          />
                          {scale.weeks.map((w) => {
                            const cell = weekCell(p, w, byProject, vacations)
                            if (cell.state === 'none') return null
                            const wEnd = iso(new Date(new Date(w).getTime() + 6 * DAY))
                            return (
                              <span
                                key={w}
                                className="pt-wk"
                                data-state={cell.state}
                                data-level={cell.level || 0}
                                data-done={p.finished ? '1' : '0'}
                                title={cell.count
                                  ? `${fmtDate(w)}: ${cell.count} пунктов отчётов по проекту`
                                  : `${fmtDate(w)}: по проекту ничего в отчётах`}
                                style={{ left: `${scale.pos(w)}%`, width: `${Math.max(scale.pos(wEnd) - scale.pos(w), 0.4)}%` }}
                              />
                            )
                          })}
                          <span className="pt-today" style={{ left: `${scale.pos(today)}%` }} />
                          <span className="pt-lbl">{p.lead} · {p.doneCount}/{p.tasks.length}</span>
                        </div>
                      </div>

                      {isOpen && p.tasks.map((t) => (
                        <div key={t.ref || t.title} className="pt-row pt-task">
                          <div className="pt-c">
                            <span className="pt-nm pt-nm-sub" title={t.title}>{t.title}</span>
                          </div>
                          <div className="pt-c pt-who pt-who-sub">
                            <span className="pt-dot" style={{ background: t.color }} />
                            <span className="pt-who-nm">{lastName(t.who)}</span>
                          </div>
                          <div className="pt-c pt-dur pt-dur-sub">{t.days}&nbsp;р.д.</div>
                          <div className="pt-track" title={taskTitle(t)}>
                            <span
                              className="pt-bar"
                              data-status={t.status}
                              style={{
                                left: `${scale.pos(t.start)}%`,
                                width: `${Math.max(scale.pos(t.end) - scale.pos(t.start), 0.6)}%`,
                                background: t.status === 'done' ? 'var(--border-strong)' : t.color,
                              }}
                            >
                              <i>{t.who}</i>
                            </span>
                            {/* Отпуск показываем только внутри самой задачи — иначе
                              * штриховка висит в пустоте, где работы и не было. */}
                            {(vacations.get(t.who) || []).map((v) => {
                              const from = v.start > t.start ? v.start : t.start
                              const to = v.end < t.end ? v.end : t.end
                              if (from > to) return null
                              return (
                                <span
                                  key={v.start}
                                  className="pt-vac"
                                  title={`${t.who}: ${v.label}, ${fmtDate(v.start)} — ${fmtDate(v.end)}`}
                                  style={{ left: `${scale.pos(from)}%`, width: `${Math.max(scale.pos(to) - scale.pos(from), 0.4)}%` }}
                                />
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
                </Fragment>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-legend">
            <span><i className="pt-k" data-state="work" data-level="1" />1–2 пункта за неделю</span>
            <span><i className="pt-k" data-state="work" data-level="2" />3–9</span>
            <span><i className="pt-k" data-state="work" data-level="3" />10 и больше</span>
            <span><i className="pt-k" data-state="idle" />задача открыта, работы по ней нет</span>
            <span><i className="pt-k" data-state="vacation" />отпуск</span>
            <span><i className="pt-k pt-k-done" />проект закрыт</span>
            <span><i className="pt-k pt-k-today" />сегодня</span>
            <span>* длительность по git</span>
          </div>

          <p className="pt-foot">
            <b>Открытый проект и проект в работе — разные вещи.</b> Длительность берётся с доски
            Team Gantt (с 6 июля 2026), а насыщенность недели — из ежедневных отчётов: сколько
            пунктов за ту неделю относятся к проекту. Пункт относится к проекту по отличительному
            слову — «HA ID», «Apollo», «n8n», «QuickBooks»; общие слова вроде «CRM», «доступ» или
            «Claude» в правила не взяты, они встречаются почти в каждом отчёте.
            {activity && ` Поэтому из ${activity.items_total} пунктов за период в проекты попали
            ${activity.items_matched} — остальное тоже работа, просто не привязанная к этим
            проектам, и выдавать её за ноль было бы неверно.`} Правила —
            <code> backend/project_rules.py</code>, группировка задач доски —
            <code> frontend/src/lib/projectMap.js</code>; имена проектов в обоих файлах обязаны
            совпадать. Длительность четырёх проектов — карта Брюнеткина из git (с 6 апреля);
            его линии «Call center», «Alliance Connect», «CRMv2» и «DWH» с доской не сведены.
          </p>
        </>
      )}
      </div>
      <AppFooter />
    </>
  )
}

const projectTitle = (p, hasActivity, byProject) => [
  p.name,
  `Ведёт: ${p.lead}`,
  `Участвуют: ${p.team.join(', ')}`,
  `На доске с ${fmtDate(p.boardStart)}`,
  p.git ? `В git с ${fmtDate(p.git.start)} — ${p.git.stages} этапов, карта Брюнеткина` : null,
  p.finished ? `Закрыт ${fmtDate(p.lastEnd)}` : `Открыт до сих пор, ${p.span} дн`,
  `Задачи: ${p.doneCount} из ${p.tasks.length} закрыто${p.openCount ? `, ${p.openCount} в работе` : ''}`,
  hasActivity
    ? `Недель с работой по отчётам: ${Object.keys(byProject[p.name] || {}).length}`
    : 'Отчёты не загрузились — недели показаны по доске',
].filter(Boolean).join('\n')

const taskTitle = (t) => [
  t.title,
  `Кто: ${t.who}`,
  `Период: ${fmtDate(t.start)} — ${fmtDate(t.end)}, ${t.days} раб. дн.`,
  `Статус: ${STATUS_RU[t.status] || t.status}, ${t.percent}%`,
  t.ref ? `Номер: ${t.ref}` : null,
].filter(Boolean).join('\n')

function Stat({ value, label, wide }) {
  return (
    <div className={`pt-stat${wide ? ' is-wide' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function Group({ title, options, value, onChange }) {
  return (
    <div className="pt-ctl">
      <em>{title}</em>
      {Object.entries(options).map(([key, opt]) => (
        <button
          key={key} type="button" className="pt-chip"
          aria-pressed={key === value} onClick={() => onChange(key)}
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
.tabs .tab-btn{text-decoration:none;display:inline-flex;align-items:center}
.tabs span.tab-btn{cursor:default}
.pt-h1{font-size:24px;margin:20px 0 6px;letter-spacing:-.01em}
.pt-lede{color:var(--muted);font-size:13.5px;line-height:1.55;margin:0 0 18px;max-width:82ch}
.pt-note{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px;color:var(--muted);font-size:14px}
.pt-note-err{color:var(--danger);border-color:var(--danger)}
.pt-stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.pt-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:9px 14px}
.pt-stat.is-wide{flex:1;min-width:230px}
.pt-stat b{display:block;font-size:19px;font-variant-numeric:tabular-nums;color:var(--text)}
.pt-stat span{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.pt-controls{display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin-bottom:12px}
.pt-ctl{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pt-ctl>em{font-style:normal;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.pt-chip{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;
  padding:5px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
.pt-chip:hover{border-color:var(--border-strong);color:var(--text)}
.pt-chip[aria-pressed="true"]{background:var(--fill-accent);border-color:var(--fill-accent);color:var(--on-accent);font-weight:600}
.pt-chip:focus-visible{outline:2px solid var(--accent1);outline-offset:2px}
.pt-board{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.pt-scroll{overflow-x:auto}
.pt-grid{min-width:920px}
.pt-row{display:grid;grid-template-columns:230px 126px 84px 1fr;border-bottom:1px solid var(--border)}
.pt-g:last-child .pt-row:last-child{border-bottom:0}
.pt-head{position:sticky;top:0;background:var(--card);z-index:3}
.pt-head .pt-c,.pt-mo{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.pt-c{padding:8px 14px;display:flex;align-items:center;gap:8px;min-width:0}
.pt-proj{cursor:pointer;background:var(--card2)}
.pt-proj:hover{background:var(--row-hover)}
.pt-proj:focus-visible{outline:2px solid var(--accent1);outline-offset:-2px}
.pt-tog{width:13px;flex:0 0 13px;font-size:9px;color:var(--muted);transition:transform .14s}
.pt-proj.is-open .pt-tog{transform:rotate(90deg)}
.pt-nm{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.pt-nm-sub{font-weight:400;font-size:12.5px;color:var(--muted);padding-left:21px}
.pt-pill{flex:0 0 auto;font-size:10px;padding:2px 7px;border-radius:999px;white-space:nowrap;
  background:var(--accent1-bg);color:var(--text-accent);border:1px solid var(--accent1-border)}
.pt-pill.is-done{background:var(--success-bg);color:var(--success);border-color:transparent}
.pt-dur{justify-content:flex-end;font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap;color:var(--text)}
.pt-dur.is-hot b{color:var(--danger)}
.pt-dur-sub{color:var(--muted);font-size:11.5px}
.pt-track{position:relative;min-width:0;padding:9px 0;height:38px}
.pt-months{display:grid;padding:0;height:auto}
.pt-mo{padding:8px 0 8px 8px;border-left:1px solid var(--border);overflow:hidden;white-space:nowrap}
.pt-span{position:absolute;top:50%;transform:translateY(-50%);height:20px;border-radius:4px;
  background:var(--accent1-bg);border:1px solid var(--accent1-border)}
.pt-span.is-done{background:var(--success-bg);border-color:transparent}
.pt-wk{position:absolute;top:50%;transform:translateY(-50%);height:20px}
.pt-wk[data-state="work"]{background:var(--accent1)}
.pt-wk[data-state="work"][data-level="1"]{opacity:.32}
.pt-wk[data-state="work"][data-level="2"]{opacity:.62}
.pt-wk[data-state="work"][data-level="3"]{opacity:1}
.pt-wk[data-state="work"][data-done="1"]{background:var(--success)}
.pt-wk[data-state="idle"]{background:var(--border-strong);opacity:.4}
.pt-wk[data-state="vacation"]{background:repeating-linear-gradient(45deg,
  var(--border-strong) 0 3px,transparent 3px 6px)}
.pt-lbl{position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:600;
  color:var(--text);text-shadow:0 0 4px var(--card),0 0 4px var(--card);pointer-events:none;white-space:nowrap}
.pt-bar{position:absolute;top:50%;transform:translateY(-50%);height:17px;border-radius:4px;
  display:flex;align-items:center;padding:0 6px;overflow:hidden}
.pt-bar i{font-style:normal;font-size:10px;color:#06091a;font-weight:600;white-space:nowrap}
.pt-bar[data-status="done"] i{color:var(--text)}
.pt-vac{position:absolute;top:50%;transform:translateY(-50%);height:17px;border-radius:4px;
  background:repeating-linear-gradient(45deg,var(--border-strong) 0 3px,transparent 3px 6px)}
.pt-today{position:absolute;top:0;bottom:0;width:2px;background:var(--danger);z-index:2}

.pt-who{gap:6px;padding-left:8px;padding-right:8px;font-size:12px;color:var(--text-secondary);min-width:0}
.pt-who-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-who-sub{color:var(--muted);font-size:11.5px}
.pt-dot{flex:0 0 8px;width:8px;height:8px;border-radius:50%}
.pt-more{flex:0 0 auto;font-size:10px;color:var(--muted)}
.pt-owner{background:var(--card2);border-top:2px solid var(--border-strong)}
.pt-owner .pt-c{padding-top:10px;padding-bottom:10px}
.pt-owner .pt-nm{font-size:13.5px;font-weight:700}
.pt-owner .pt-who,.pt-owner .pt-dur{color:var(--muted);font-size:11.5px}
.pt-vacband{position:absolute;top:4px;bottom:4px;border-radius:4px;
  background:repeating-linear-gradient(45deg,var(--border-strong) 0 4px,transparent 4px 8px);
  border:1px solid var(--border-strong)}
.pt-filtered{color:var(--muted);font-size:12.5px;margin:0 0 10px}
.pt-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:13px;font-size:12px;color:var(--muted)}
.pt-k{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-2px}
.pt-k[data-state="work"]{background:var(--accent1)}
.pt-k[data-state="work"][data-level="1"]{opacity:.32}
.pt-k[data-state="work"][data-level="2"]{opacity:.62}
.pt-k[data-state="idle"]{background:var(--border-strong);opacity:.4}
.pt-k[data-state="vacation"]{background:repeating-linear-gradient(45deg,var(--border-strong) 0 3px,transparent 3px 6px)}
.pt-k-done{background:var(--success)}
.pt-k-today{background:var(--danger);width:2px;border-radius:0}
.pt-foot{color:var(--muted);font-size:12.5px;line-height:1.6;margin:14px 0 0;max-width:82ch}
.pt-foot b{color:var(--text)}
.pt-foot code{font-size:11.5px;color:var(--text-secondary)}
@media(max-width:860px){.pt-row{grid-template-columns:200px 108px 78px 1fr}.pt-more{display:none}}
@media(max-width:560px){.pt-row{grid-template-columns:150px 92px 1fr}.pt-h1{font-size:21px}
  .pt-pill{display:none}.pt-dur{display:none}}
    `}</style>
  )
}
