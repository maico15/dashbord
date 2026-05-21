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
    pr_merged: 'PRs',
    ticket_closed: 'Tickets',
    fast_cycle: 'Fast',
    incident_resolved: 'Resolved',
    fast_resolve: 'Quick',
    sla_breached: 'SLA↓',
    doc_created: 'Created',
    doc_updated: 'Updated',
    no_docs_penalty: 'NoDocs',
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

export default function Leaderboard({ data }) {
  const navigate = useNavigate()
  if (!data || data.length === 0)
    return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>No data</div>

  return (
    <div className="leaderboard">
      <div className="section-title">Leaderboard · 8 недель</div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="lb-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Инженер</th>
              <th>Поток</th>
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
                title="Открыть профиль"
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
                  <span className={`tag tag-${member.stream}`}>
                    {STREAM_LABELS[member.stream] || member.stream}
                  </span>
                </td>
                <td>
                  <span className="lb-score">{member.total_score.toLocaleString()}</span>
                </td>
                <td>
                  <BreakdownText breakdown={member.breakdown} stream={member.stream} />
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
    </div>
  )
}
