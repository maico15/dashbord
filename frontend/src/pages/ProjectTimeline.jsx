/* Страница «Проекты» — /projects
 *
 * Источников ровно два, и оба говорят о сделанной работе, а не о заведённой задаче:
 *   1) ежедневные отчёты инженеров — GET /api/projects/activity;
 *   2) серия «Dev meet (optional)» из Fireflies — ../data/devmeet.json.
 *
 * Доска Team Gantt здесь не участвует вообще: открытая задача говорит только о том,
 * что строку завели, и из неё нельзя узнать, работали ли по ней на этой неделе.
 * Поэтому и проект, и его ведущий, и длительность берутся из отчётов.
 *
 * Что показывает строка: не «проект открыт N дней», а в какие недели по нему
 * действительно шла работа. Пустая клетка между закрашенными — это и есть ответ
 * на «IT полгода тянет один проект»: проект не тянут, к нему возвращаются.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import AppFooter from '../components/AppFooter'
import devmeet from '../data/devmeet.json'

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DAY = 864e5

/* Показываем проекты только этих троих. Ведущий считается по отчётам. */
const LEADS = ['Andrey Pogrebnyak', 'Andrey Brunetkin', 'Azizbek Turgunov']

const SORTS = {
  gaps: 'по числу возвратов',
  weeks: 'по неделям работы',
  items: 'по объёму работы',
  owner: 'по разработчику',
}
const ZOOMS = { all: 'весь период', quarter: 'последний квартал' }

/** Фамилия — в колонке «Кто»: имена английские, фамилии не повторяются. */
const lastName = (full) => (full || '').trim().split(/\s+/).pop()

const iso = (d) => d.toISOString().slice(0, 10)
const fmtWeek = (s) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function weekRange(from, to) {
  const out = []
  for (let d = new Date(from); iso(d) <= to; d.setDate(d.getDate() + 7)) out.push(iso(d))
  return out
}

/** Уровень насыщенности клетки — чтобы «одна строчка» и «десять» не выглядели одинаково. */
const levelOf = (n) => (n >= 10 ? 3 : n >= 3 ? 2 : 1)

/* Проекты собираются целиком из ответа /api/projects/activity. */
/* Страница считает ТОЛЬКО по этим троим — и в строке проекта, и внутри неё.
 * Пункты остальных инженеров не красят неделю и не попадают в «кто»: иначе
 * строка Брюнеткина загоралась бы от того, что по тому же проекту написал
 * Мисан. Проект попадает на доску, если по нему писал хоть кто-то из троих. */
function buildProjects(activity) {
  const byPerson = activity.by_person || {}
  const talk = devmeet.projects || {}

  return Object.keys(byPerson).map((name) => {
    const mine = Object.entries(byPerson[name] || {}).filter(([who]) => LEADS.includes(who))

    /* Недели проекта — сумма по трём, а не общий счёт из ответа. */
    const weeks = {}
    for (const [, byWeek] of mine) {
      for (const [w, n] of Object.entries(byWeek)) weeks[w] = (weeks[w] || 0) + n
    }
    const active = Object.keys(weeks).filter((w) => weeks[w] > 0).sort()
    const who = mine
      .map(([n, byWeek]) => [n, Object.values(byWeek).reduce((s, x) => s + x, 0)])
      .sort((a, b) => b[1] - a[1])
    /* Сколько раз к проекту возвращались после паузы: число непрерывных
     * отрезков минус один. Ровный проект — 0, рваный — много. */
    let runs = 0
    let prev = null
    for (const w of active) {
      if (!prev || new Date(w) - new Date(prev) > 7 * DAY) runs += 1
      prev = w
    }
    return {
      name,
      weeks,
      talk: talk[name] || {},
      activeWeeks: active,
      first: active[0] || null,
      last: active[active.length - 1] || null,
      items: Object.values(weeks).reduce((s, n) => s + n, 0),
      lead: who.length ? who[0][0] : null,
      people: who,
      byPerson: Object.fromEntries(mine),
      runs,
      returns: Math.max(0, runs - 1),
    }
  })
}

export default function ProjectTimeline() {
  const [overview, setOverview] = useState(null)
  const [teamXp, setTeamXp] = useState(0)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState('all')
  const [sort, setSort] = useState('gaps')
  const [opened, setOpened] = useState(() => new Set())

  const today = iso(new Date())

  useEffect(() => {
    let alive = true
    api.get(`/projects/activity?start=2026-01-01&end=${today}`)
      .then((d) => { if (alive) setActivity(d) })
      .catch((e) => { if (alive) setError(e.message) })
    api.get('/overview').then((d) => { if (alive) setOverview(d) }).catch(() => {})
    api.get('/leaderboard')
      .then((d) => { if (alive) setTeamXp((d || []).reduce((s, m) => s + (m.total_score || 0), 0)) })
      .catch(() => {})
    return () => { alive = false }
  }, [today])

  const all = useMemo(() => (activity ? buildProjects(activity) : []), [activity])
  const shown = useMemo(() => all.filter((p) => p.lead && p.activeWeeks.length), [all])

  const ordered = useMemo(() => {
    const list = [...shown]
    if (sort === 'weeks') list.sort((a, b) => b.activeWeeks.length - a.activeWeeks.length)
    else if (sort === 'items') list.sort((a, b) => b.items - a.items)
    else if (sort === 'owner') {
      list.sort((a, b) => a.lead.localeCompare(b.lead) || b.items - a.items)
    } else list.sort((a, b) => b.returns - a.returns || b.activeWeeks.length - a.activeWeeks.length)
    return list
  }, [shown, sort])

  /* Шкала недель: от первой недели с отчётами до текущей. */
  const scale = useMemo(() => {
    const weeks = activity?.weeks || []
    if (!weeks.length) return { weeks: [], months: [] }
    let from = weeks[0]
    if (zoom === 'quarter') {
      const q = new Date(Date.now() - 91 * DAY)
      from = weeks.find((w) => w >= iso(q)) || from
    }
    const list = weekRange(from, weeks[weeks.length - 1])
    const months = []
    for (const w of list) {
      const d = new Date(w)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const last = months[months.length - 1]
      if (last && last.key === key) last.span += 1
      else months.push({ key, label: MONTHS_RU[d.getMonth()], span: 1 })
    }
    return { weeks: list, months }
  }, [activity, zoom])

  const lastWeek = activity?.weeks?.[activity.weeks.length - 1]
  const parallel = lastWeek ? activity.team_week?.[lastWeek] : null
  const totalItems = shown.reduce((s, p) => s + p.items, 0)
  const choppiest = ordered.length
    ? [...shown].sort((a, b) => b.returns - a.returns)[0]
    : null

  const toggle = (name) => setOpened((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

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

        <div className="tabs">
          <Link to="/" className="tab-btn">← Дашборд</Link>
          <Link to="/team-gantt" className="tab-btn">📅 Gantt</Link>
          <span className="tab-btn active">🗂 Проекты</span>
          <Link to="/it-requests/home" className="tab-btn">IT request</Link>
          <Link to="/team-plan" className="tab-btn">Team Plan</Link>
        </div>

        <h1 className="pt-h1">Проекты</h1>
        <p className="pt-lede">
          В какие недели по проекту действительно шла работа. Клетка закрашена, если на той
          неделе о проекте написали в ежедневном отчёте — чем плотнее, тем больше пунктов;
          точка значит, что проект на той неделе только обсуждали на Dev meet. Пропуск между
          закрашенными неделями — не простой: в эти недели человек вёл другие проекты.
        </p>

        {error && <div className="pt-note pt-note-err">Не удалось загрузить отчёты: {error}</div>}
        {!activity && !error && <div className="pt-note">Считаю по отчётам…</div>}

        {activity && !error && (
          <>
            <div className="pt-stats">
              <Stat value={shown.length} label="проектов" />
              <Stat value={scale.weeks.length} label="недель под наблюдением" />
              <Stat value={totalItems} label="пунктов отчётов по ним" />
              {parallel && <Stat value={parallel.projects} label="проектов в работе на прошлой неделе" />}
              {choppiest && (
                <Stat
                  value={`${choppiest.returns} ${plural(choppiest.returns)}`}
                  label={`чаще всего возвращались: ${choppiest.name}`}
                  wide
                />
              )}
            </div>

            <div className="pt-controls">
              <Group title="Период" options={ZOOMS} value={zoom} onChange={setZoom} />
              <Group title="Сортировка" options={SORTS} value={sort} onChange={setSort} />
            </div>

            <p className="pt-filtered">
              На доске только Погребняк, Брюнеткин и Тургунов — и в строке проекта, и внутри
              неё. Пункты остальных инженеров не считаются совсем, поэтому «недель» и
              насыщенность клеток — это работа троих, а не всей команды.
            </p>

            <div className="pt-board">
              <div className="pt-scroll">
                <div className="pt-grid">
                  <div className="pt-row pt-head">
                    <div className="pt-c">Проект</div>
                    <div className="pt-c pt-who">Кто</div>
                    <div className="pt-c pt-dur">Недель</div>
                    <div
                      className="pt-track pt-months"
                      style={{ gridTemplateColumns: scale.months.map((m) => `${m.span}fr`).join(' ') }}
                    >
                      {scale.months.map((m) => <span key={m.key} className="pt-mo">{m.label}</span>)}
                    </div>
                  </div>

                  {ordered.map((p) => {
                    const isOpen = opened.has(p.name)
                    return (
                      <div key={p.name} className="pt-g">
                        <div
                          className={`pt-row pt-proj${isOpen ? ' is-open' : ''}`}
                          role="button" tabIndex={0}
                          onClick={() => toggle(p.name)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.name) } }}
                          title={projectTitle(p)}
                        >
                          <div className="pt-c">
                            <span className="pt-tog">▶</span>
                            <span className="pt-nm">{p.name}</span>
                          </div>
                          <div className="pt-c pt-who">
                            <span className="pt-who-nm">{lastName(p.lead)}</span>
                            {p.people.length > 1 && <span className="pt-more">+{p.people.length - 1}</span>}
                          </div>
                          <div className="pt-c pt-dur">
                            <b>{p.activeWeeks.length}</b>
                            <span className="pt-dur-sub">/{scale.weeks.length}</span>
                          </div>
                          <Track weeks={scale.weeks} counts={p.weeks} talk={p.talk} name={p.name} />
                        </div>

                        {isOpen && p.people.map(([who, n]) => (
                          <div key={who} className="pt-row pt-sub">
                            <div className="pt-c">
                              <span className="pt-nm pt-nm-sub">{who}</span>
                            </div>
                            <div className="pt-c pt-who"><span className="pt-who-sub">{n} п.</span></div>
                            <div className="pt-c pt-dur">
                              <span className="pt-dur-sub">
                                {Object.keys(p.byPerson[who] || {}).length} нед
                              </span>
                            </div>
                            <Track weeks={scale.weeks} counts={p.byPerson[who] || {}} talk={{}} name={who} />
                          </div>
                        ))}
                      </div>
                    )
                  })}

                  {!ordered.length && (
                    <div className="pt-row"><div className="pt-c">По отчётам за период нет ни одного проекта этих троих.</div></div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-legend">
              <span><i className="pt-k" data-level="1" /> 1–2 пункта за неделю</span>
              <span><i className="pt-k" data-level="2" /> 3–9</span>
              <span><i className="pt-k" data-level="3" /> 10 и больше</span>
              <span><i className="pt-k pt-k-talk" /> только обсуждали на Dev meet</span>
            </div>

            <p className="pt-foot">
              <b>Откуда цифры.</b> Ежедневные отчёты за {activity.weeks?.[0] && fmtWeek(activity.weeks[0])} —{' '}
              {lastWeek && fmtWeek(lastWeek)}: {activity.items_matched} из {activity.items_total} пунктов
              удалось отнести к проекту по отличительному слову в тексте. Остальные — общие
              формулировки без названия проекта, их никуда не приписывали.
              {' '}<b>Dev meet</b> из Fireflies: {devmeet.meetings} встреч за {devmeet.weeks.length} недель
              ({fmtWeek(devmeet.weeks[0])} — {fmtWeek(devmeet.weeks[devmeet.weeks.length - 1])}), из них{' '}
              {devmeet.matched} с упоминанием проекта. В июле записей встреч нет — там пусто не
              потому, что не работали, а потому, что встречи не записывались.
              {' '}<b>Доска Ганта в расчёте не участвует.</b>
            </p>
          </>
        )}
      </div>
      <AppFooter />
    </>
  )
}

function Track({ weeks, counts, talk, name }) {
  const w = 100 / Math.max(1, weeks.length)
  return (
    <div className="pt-track">
      {weeks.map((week, i) => {
        const n = counts[week] || 0
        const t = talk[week] || 0
        if (!n && !t) return null
        return (
          <span
            key={week}
            className="pt-wk"
            data-level={n ? levelOf(n) : 0}
            data-talk={!n && t ? 1 : 0}
            style={{ left: `${i * w}%`, width: `${w}%` }}
            title={`${name} · неделя с ${fmtWeek(week)}: ${
              n ? `${n} пунктов в отчётах` : 'в отчётах не упоминался'
            }${t ? `, обсуждали на ${t} Dev meet` : ''}`}
          />
        )
      })}
    </div>
  )
}

const plural = (n) => {
  const t = n % 10
  if (n % 100 >= 11 && n % 100 <= 14) return 'раз'
  if (t >= 2 && t <= 4) return 'раза'
  return 'раз'
}

const projectTitle = (p) => [
  p.name,
  `ведёт ${p.lead}`,
  `${p.activeWeeks.length} недель с работой, ${p.items} пунктов в отчётах`,
  p.first && `первое упоминание ${fmtWeek(p.first)}, последнее ${fmtWeek(p.last)}`,
  p.returns ? `возвращались после паузы ${p.returns} ${plural(p.returns)}` : 'шёл без перерывов',
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
      {Object.entries(options).map(([key, label]) => (
        <button
          key={key} type="button" className="pt-chip"
          aria-pressed={value === key} onClick={() => onChange(key)}
        >
          {label}
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
.pt-stat.is-wide{flex:1;min-width:250px}
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
.pt-row{display:grid;grid-template-columns:250px 120px 86px 1fr;border-bottom:1px solid var(--border)}
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
.pt-dur{justify-content:flex-end;font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap;color:var(--text)}
.pt-dur-sub{color:var(--muted);font-size:11.5px}
.pt-track{position:relative;min-width:0;padding:9px 0;height:38px}
.pt-months{display:grid;padding:0;height:auto}
.pt-mo{padding:8px 0 8px 8px;border-left:1px solid var(--border);overflow:hidden;white-space:nowrap}
.pt-wk{position:absolute;top:50%;transform:translateY(-50%);height:20px;background:var(--accent1)}
.pt-wk[data-level="1"]{opacity:.3}
.pt-wk[data-level="2"]{opacity:.62}
.pt-wk[data-level="3"]{opacity:1}
.pt-wk[data-talk="1"]{background:none;opacity:1}
.pt-wk[data-talk="1"]::after{content:"";position:absolute;left:50%;top:50%;width:5px;height:5px;
  margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--border-strong)}
.pt-who{gap:6px;padding-left:8px;padding-right:8px;font-size:12px;color:var(--text-secondary);min-width:0}
.pt-who-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-who-sub{color:var(--muted);font-size:11.5px}
.pt-more{flex:0 0 auto;font-size:10px;color:var(--muted)}
.pt-sub .pt-track{height:30px}
.pt-sub .pt-wk{height:14px}
.pt-filtered{color:var(--muted);font-size:12.5px;margin:0 0 10px;max-width:82ch}
.pt-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:13px;font-size:12px;color:var(--muted)}
.pt-k{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-2px;
  background:var(--accent1)}
.pt-k[data-level="1"]{opacity:.3}
.pt-k[data-level="2"]{opacity:.62}
.pt-k-talk{background:none;position:relative;border:1px solid var(--border)}
.pt-k-talk::after{content:"";position:absolute;left:50%;top:50%;width:5px;height:5px;
  margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--border-strong)}
.pt-foot{color:var(--muted);font-size:12.5px;line-height:1.6;margin:14px 0 0;max-width:82ch}
.pt-foot b{color:var(--text)}
@media(max-width:860px){.pt-row{grid-template-columns:200px 108px 78px 1fr}.pt-more{display:none}}
@media(max-width:560px){.pt-row{grid-template-columns:150px 92px 1fr}.pt-h1{font-size:21px}
  .pt-dur{display:none}}
    `}</style>
  )
}
