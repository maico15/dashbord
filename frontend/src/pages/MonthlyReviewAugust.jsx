import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTheme, toggleTheme } from '../hooks/useTheme'
import { api } from '../api/client'
import {
  PERIOD, ASSUMPTIONS, SUMMARY, SUMMARY_TONES, ENGINEERS,
  ENGINEER_IDS, SCORE_WEEK, SCORE_YEAR,
} from '../data/august2026'

/**
 * MonthlyReviewAugust — curated August 2026 review.
 *
 * Every string of content lives bilingually in ../data/august2026; T below is
 * page chrome only. Unlike /review/june-2026 this page renders task-shaped data
 * (goal / effect / value + confidence), so a claim always carries how sure we
 * are of it and, where a dollar figure needs a business input we do not have,
 * names the missing input instead of guessing.
 */

// ── Translations (chrome only) ────────────────────────────────────────────────
const T = {
  en: {
    title: 'IT Department',
    subtitle: 'Engineering · Infrastructure · AI · Operations',
    presented: 'Presented',
    presentedDate: 'September 1, 2026',
    prevReview: 'Previous review',
    prevReviewDate: 'June 2026 — July 1',
    teamSize: 'Team size',
    period: 'Period',
    periodDates: 'Aug 3 – Aug 31, 2026',
    backToDashboard: '← Dashboard',
    sectionSummary: 'August 2026 — Bottom Line',
    sectionMethod: 'How these numbers were derived',
    sectionEngineers: 'Work by Engineer — August 2026',
    method: 'Method',
    goal: 'Goal',
    effect: 'Result',
    score: 'Score',
    tasks: 'tasks',
    footer: 'Engineering Dashboard · Sources: EOD/EOW reports, #devs-and-product, #devs-apollo',
    nextReview: 'Next review: October 1, 2026 →',
    conf: {
      confirmed: 'Confirmed',
      estimate: 'Estimate',
      needs_data: 'Needs data',
      none: 'Not measured',
    },
  },
  ru: {
    title: 'IT Отдел',
    subtitle: 'Разработка · Инфраструктура · AI · Операции',
    presented: 'Презентация',
    presentedDate: '1 сентября 2026',
    prevReview: 'Предыдущий обзор',
    prevReviewDate: 'Июнь 2026 — 1 июля',
    teamSize: 'Команда',
    period: 'Период',
    periodDates: '3 – 31 августа 2026',
    backToDashboard: '← Дашборд',
    sectionSummary: 'Август 2026 — Итог',
    sectionMethod: 'Как получены эти цифры',
    sectionEngineers: 'Работа по инженерам — Август 2026',
    method: 'Методика',
    goal: 'Задача',
    effect: 'Результат',
    score: 'Оценка',
    tasks: 'задач',
    footer: 'Engineering Dashboard · Источники: EOD/EOW репорты, #devs-and-product, #devs-apollo',
    nextReview: 'Следующий обзор: 1 октября 2026 →',
    conf: {
      confirmed: 'Подтверждено',
      estimate: 'Оценка',
      needs_data: 'Нужны данные',
      none: 'Не измерено',
    },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function HALogo() {
  return (
    <svg height="30" viewBox="0 0 42 28" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" fillRule="evenodd">
        <path fill="#33C" d="M0 27.903 15.514 0h8.276l-6.514 11.59h1.513L25.374 0h8.19L20.948 22.347h-8.163l4.965-8.858h-1.525l-8.14 14.414z"/>
        <path d="m33.564 0 8.318 15.364h-8.201l-4.32-7.93L33.564 0zm-4.992 8.86 3.54 6.504h-7.203l3.663-6.504zM23.79 0l.77 1.44-4.166 7.321-.803-1.3L23.79 0z" fill="#293359"/>
      </g>
    </svg>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 20, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  )
}

const CONF_COLOR = {
  confirmed:  'var(--success)',
  estimate:   'var(--warning)',
  needs_data: 'var(--accent1)',
  none:       'var(--muted)',
}

function confColor(level) {
  return CONF_COLOR[level] || CONF_COLOR.none
}


function ConfidenceBadge({ level, t }) {
  const color = confColor(level)
  return (
    <span style={{
      fontSize: 11, padding: '2px 9px', borderRadius: 10, fontWeight: 500,
      whiteSpace: 'nowrap', flexShrink: 0,
      // Tint derived from the var() so the pill tracks the theme's own palette
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
    }}>
      {(t.conf[level] || t.conf.none)}
    </span>
  )
}

// ── Score Input Component ─────────────────────────────────────────────────────
function ScoreInput({ engId, color, scores, saveScore, savedId, failedId, t }) {
  const [localScore, setLocalScore] = useState(scores[engId] || '')
  useEffect(() => { setLocalScore(scores[engId] || '') }, [scores[engId]])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.score}</span>
      <input
        type="number" min="1" max="10"
        value={localScore}
        placeholder="—"
        onChange={e => setLocalScore(e.target.value)}
        onBlur={e => saveScore(engId, e.target.value)}
        onKeyDown={e => e.key === 'Enter' && saveScore(engId, e.target.value)}
        style={{
          width: 52, textAlign: 'center', fontSize: 15, fontWeight: 600,
          padding: '4px 6px', borderRadius: 8, outline: 'none',
          border: `1.5px solid ${localScore ? color : 'var(--border)'}`,
          background: localScore ? `${color}18` : 'var(--card)',
          color: localScore ? color : 'var(--muted)',
        }}
      />
      {savedId === engId && <span style={{ fontSize: 11, color: 'var(--success)' }}>✓</span>}
      {failedId === engId && <span style={{ fontSize: 11, color: 'var(--muted)' }} title="Admin session required">✕</span>}
    </div>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task, lang, t, last }) {
  const color = confColor(task.value.confidence)
  return (
    <div style={{ padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, marginBottom: 6 }}>{task.title[lang]}</div>

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 5 }}>
        <span style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 10 }}>{t.goal}</span>
        {'  '}{task.goal[lang]}
      </div>

      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 10, color: 'var(--muted)' }}>{t.effect}</span>
        {'  '}{task.effect[lang]}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', color }}>{task.value.amount}</span>
        <ConfidenceBadge level={task.value.confidence} t={t} />
        <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, flex: 1, minWidth: 160 }}>{task.value.note[lang]}</span>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MonthlyReviewAugust() {
  const [lang, setLang] = useState('en')
  const theme = useTheme()
  const t = T[lang]
  const [scores, setScores] = useState({})
  const [savedId, setSavedId] = useState(null)
  const [failedId, setFailedId] = useState(null)

  useEffect(() => {
    api.get(`/performance-scores?week=${SCORE_WEEK}&year=${SCORE_YEAR}`)
      .then(setScores)
      .catch(() => {})
  }, [])

  const saveScore = async (engineerId, val) => {
    const num = parseInt(val)
    if (!val || isNaN(num) || num < 1 || num > 10) return
    const pw = sessionStorage.getItem('admin_pw') || ''
    try {
      await api.post('/performance-scores',
        { engineer_id: engineerId, week: SCORE_WEEK, year: SCORE_YEAR, score: num }, pw)
      setScores(prev => ({ ...prev, [engineerId]: num }))
      setSavedId(engineerId)
      setTimeout(() => setSavedId(null), 1500)
    } catch (e) {
      // Most likely a 403 — the page is public, saving needs an admin session.
      console.error('Score save error:', e)
      setFailedId(engineerId)
      setTimeout(() => setFailedId(null), 2500)
    }
  }

  const totalTasks = ENGINEERS.reduce((n, e) => n + e.tasks.length, 0)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg, var(--card) 0%, var(--bg) 70%)', borderBottom: '1px solid var(--border)', padding: '36px 60px 28px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <HALogo />
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Engineering Review</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.1 }}>
            {t.title}<br />
            <span style={{ background: 'linear-gradient(90deg, #3333cc, #00cfff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{PERIOD.label[lang]}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>{t.subtitle}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(51,51,204,.15)', border: '1px solid rgba(51,51,204,.3)', fontSize: 12, fontWeight: 500, color: '#8888ff', marginTop: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
            {t.presented} {t.presentedDate}
          </div>
        </div>
        <div style={{ textAlign: 'right', paddingTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 2.2 }}>
            <div>{t.prevReview}: <strong style={{ color: 'var(--text)' }}>{t.prevReviewDate}</strong></div>
            <div>{t.teamSize}: <strong style={{ color: 'var(--text)' }}>{ENGINEERS.length}</strong></div>
            <div>{t.period}: <strong style={{ color: 'var(--text)' }}>{t.periodDates}</strong></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, transition: 'all .2s' }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {/* Language toggle */}
            <div style={{ display: 'flex', gap: 6 }}>
              {['en', 'ru'].map(l => (
                <button key={l} onClick={() => setLang(l)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', background: lang === l ? 'var(--accent1)' : 'var(--card)', color: lang === l ? 'var(--on-accent)' : 'var(--muted)', transition: 'all .2s' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '40px 60px 80px', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── Back link ── */}
        <div style={{ marginBottom: 32 }}>
          <Link to="/" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>{t.backToDashboard}</Link>
        </div>

        {/* ── SUMMARY ── */}
        <div style={{ marginBottom: 40 }}>
          <SectionLabel>{t.sectionSummary}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SUMMARY[lang].length}, 1fr)`, gap: 12 }}>
            {SUMMARY[lang].map((tile, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${confColor(SUMMARY_TONES[i])}, transparent)` }} />
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: confColor(SUMMARY_TONES[i]) }}>{tile.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, fontWeight: 500 }}>{tile.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>{tile.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── METHOD / ASSUMPTIONS ── */}
        <div style={{ marginBottom: 44 }}>
          <SectionLabel>{t.sectionMethod}</SectionLabel>
          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', paddingTop: 3, flexShrink: 0 }}>{t.method}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.65 }}>{ASSUMPTIONS[lang]}</span>
          </div>
          {/* Confidence legend — the reader needs it before the first pill */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            {['confirmed', 'estimate', 'needs_data', 'none'].map(level => (
              <ConfidenceBadge key={level} level={level} t={t} />
            ))}
          </div>
        </div>

        {/* ── ENGINEERS ── */}
        <div style={{ marginBottom: 52 }}>
          <SectionLabel>{t.sectionEngineers} · {totalTasks} {t.tasks}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, alignItems: 'start' }}>
            {ENGINEERS.map(eng => (
              <div key={eng.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: eng.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>{eng.initials}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{eng.name[lang]}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{eng.role[lang]}</div>
                    </div>
                  </div>
                  <ScoreInput
                    engId={ENGINEER_IDS[eng.id]}
                    color={eng.color}
                    scores={scores}
                    saveScore={saveScore}
                    savedId={savedId}
                    failedId={failedId}
                    t={t}
                  />
                </div>
                {eng.tasks.map((task, ti) => (
                  <TaskRow key={ti} task={task} lang={lang} t={t} last={ti === eng.tasks.length - 1} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
          <div>{t.footer} · {t.presentedDate}</div>
          <div style={{ color: 'var(--accent1)', fontWeight: 500 }}>{t.nextReview}</div>
        </div>

      </div>
    </div>
  )
}
