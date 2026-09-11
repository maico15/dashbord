/**
 * EN / RU pills. Extracted from MonthlyReviewCurated so both the monthly review
 * and the weekly report share one control — active pill is filled with
 * var(--accent1).
 */
export default function LangToggle({ lang, onChange, langs = ['en', 'ru'] }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {langs.map(l => (
        <button
          key={l}
          onClick={() => onChange(l)}
          aria-pressed={lang === l}
          style={{
            padding: '5px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            background: lang === l ? 'var(--accent1)' : 'var(--card)',
            color: lang === l ? 'var(--on-accent)' : 'var(--muted)',
            transition: 'all .2s',
          }}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
