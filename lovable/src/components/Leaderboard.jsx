import { useNavigate } from 'react-router-dom'

const BADGE_LABELS = {
  mvp: { label: 'MVP', cls: 'badge-mvp' },
  fire: { label: '🔥 Streak', cls: 'badge-fire' },
  shield: { label: '🛡 Shield', cls: 'badge-shield' },
  scribe: { label: '✍ Scribe', cls: 'badge-scribe' },
}

const STREAM_LABELS = { dev: 'Dev', support: 'Support', docs: 'Docs' }

const RANK_CLS = ['top1', 'top2', 'top3']

function Avatar({ name, color }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <div className="lb-avatar" style={{ background: color }}>
      {initials}
    </div>
  )
}

function BreakdownText({ breakdown, stream }) {
  if (!breakdown || Object.keys(breakdown).length === 0) return <span style={{ color: 'var(--muted)' }}>—</span>
  const labels = {
    pr_merged:        'PRs',
    commit:           'Commits',
    incident_resolved:'Resolved',
    fast_resolve:     'Quick',
    sla_breached:     'SLA↓',
    doc_created:      'Created',
    doc_updated:      'Updated',
    no_docs_penalty:  'NoDocs',
  }
  return (
    <div className="lb-breakdown">
      {Object.entries(breakdown)
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => (
          <span key={k} style={{ color: v < 0 ? 'var(--danger)' : 'var(--muted)' }}>
            {labels[k] || k}: {v > 0 ? '+' : ''}{v}
          </span>
        ))}
    </div>
  )
}

const MULTISOURCE_LABELS = {
  github:     { label: 'GH',      color: 'var(--accent1)' },
  ai_tokens:  { label: 'AI',      color: 'var(--accent2)' },
  browser_ai: { label: 'Browser', color: 'var(--warning)' },
  reports:    { label: 'Reports', color: 'var(--success)' },
}

function MultiSourceBreakdown({ breakdown }) {
  if (!breakdown) return <span style={{ color: 'var(--muted)' }}>—</span>
  return (
    <div className="lb-breakdown-multi">
      {Object.entries(MULTISOURCE_LABELS).map(([key, { label, color }]) => {
        const v = breakdown[key] ?? 0
        return (
          <div key={key} className="lb-bbar-row" title={`${label}: ${v}/100`}>
            <span className="lb-bbar-label">{label}</span>
            <div className="lb-bbar-track">
              <div className="lb-bbar-fill" style={{ width: `${v}%`, background: color }} />
            </div>
            <span className="lb-bbar-val">{v}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function Leaderboard({ data, scoringMode = 'github', onScoringModeChange }) {
  const navigate = useNavigate()
  if (!data) return null

  return (
    <div className="leaderboard">
      <div className="lb-header-row">
        <div className="section-title" style={{ margin: 0 }}>
          Leaderboard · {scoringMode === 'multisource' ? 'multi-source' : '8 weeks'}
        </div>
        {onScoringModeChange && (
          <div className="lb-scoring-toggle">
            <button
              className={scoringMode === 'github' ? 'active' : ''}
              onClick={() => onScoringModeChange('github')}
            >
              GitHub
            </button>
            <button
              className={scoringMode === 'multisource' ? 'active' : ''}
              onClick={() => onScoringModeChange('multisource')}
            >
              Multi-source
            </button>
          </div>
        )}
      </div>
      {data.length <= 1 ? (
        <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--muted)', fontSize: 13 }}>
          No leaderboard yet — add more engineers to this department.
        </div>
      ) : (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="lb-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Engineer</th>
              <th>Stream</th>
              <th>Score</th>
              <th>Breakdown</th>
              <th>Badges</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.map((member, i) => (
              <tr
                key={member.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/engineer/${member.id}`)}
                title="Open profile"
              >
                <td>
                  <span className={`lb-rank ${RANK_CLS[i] || ''}`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </span>
                </td>
                <td>
                  <div className="lb-name-cell">
                    <Avatar name={member.name} color={member.avatar_color} />
                    <span className="lb-name" style={{ textDecoration: 'underline', textDecorationColor: 'var(--border)' }}>
                      {member.name}
                    </span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(member.streams || [member.stream]).map((s) => (
                      <span key={s} className={`tag tag-${s}`}>
                        {STREAM_LABELS[s] || s}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className="lb-score">{member.total_score.toLocaleString()}</span>
                </td>
                <td>
                  {scoringMode === 'multisource'
                    ? <MultiSourceBreakdown breakdown={member.breakdown} />
                    : <BreakdownText breakdown={member.breakdown} stream={member.stream} />}
                </td>
                <td>
                  <div className="badges">
                    {(member.badges || []).map((b) => {
                      const info = BADGE_LABELS[b]
                      if (!info) return null
                      return (
                        <span key={b} className={`badge ${info.cls}`}>
                          {info.label}
                        </span>
                      )
                    })}
                  </div>
                </td>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>→</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
