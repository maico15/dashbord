import { useState } from 'react'
import DOMPurify from 'dompurify'

// Detect whether stored value is rich HTML or legacy plain text
const isHtml = s => typeof s === 'string' && /<[a-z]/i.test(s)

function SafeHtml({ html }) {
  return (
    <div
      className="rich-text-content"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) }}
    />
  )
}

function CommitRow({ commit }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
      <code style={{
        color: 'var(--muted)', fontSize: 11, flexShrink: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}>
        {commit.sha}
      </code>
      <span style={{ color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>
        {(commit.message || '').split('\n')[0] || '(no message)'}
      </span>
      {commit.time && (
        <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>{commit.time}</span>
      )}
    </div>
  )
}

function PRRow({ pr }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{
      background: 'var(--card2)', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 8,
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
      >
        <span style={{ color: 'var(--accent1)', fontSize: 13, flexShrink: 0, marginTop: 1 }}>⊕</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)' }}>#{pr.pr_number}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{pr.title || '(untitled)'}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
            {pr.lines_added > 0 && (
              <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>+{pr.lines_added}</span>
            )}
            {pr.lines_deleted > 0 && (
              <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>−{pr.lines_deleted}</span>
            )}
            {pr.changed_files > 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pr.changed_files} files</span>
            )}
            {pr.merged_at && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pr.merged_at}</span>
            )}
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
          {pr.commits.length} commit{pr.commits.length !== 1 ? 's' : ''} {open ? '▲' : '▼'}
        </span>
      </div>
      {open && pr.commits.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px 10px' }}>
          {pr.commits.map((c, i) => <CommitRow key={c.sha || i} commit={c} />)}
        </div>
      )}
    </div>
  )
}

function ProjectSection({ project }) {
  const prs = project.activity.filter(a => a.type === 'pr')
  const looseCommits = project.activity.filter(a => a.type === 'commit')

  const dayGroups = {}
  for (const c of looseCommits) {
    const k = c.date || 'unknown'
    if (!dayGroups[k]) dayGroups[k] = []
    dayGroups[k].push(c)
  }
  const dayKeys = Object.keys(dayGroups).sort((a, b) => b.localeCompare(a))

  const displayName = project.display_name || project.repo

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 12 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{displayName}</span>
          {project.display_name && project.display_name !== project.repo && (
            <code style={{
              fontSize: 11, color: 'var(--muted)',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            }}>
              {project.repo}
            </code>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          {project.commits > 0 && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(0,207,255,0.1)', color: 'var(--accent1)',
              border: '1px solid rgba(0,207,255,0.2)',
            }}>
              {project.commits} commit{project.commits !== 1 ? 's' : ''}
            </span>
          )}
          {project.prs > 0 && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(123,97,255,0.1)', color: 'var(--accent2)',
              border: '1px solid rgba(123,97,255,0.2)',
            }}>
              {project.prs} PR{project.prs !== 1 ? 's' : ''}
            </span>
          )}
          {(project.lines_added > 0 || project.lines_deleted > 0) && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              <span style={{ color: 'var(--success)' }}>+{project.lines_added}</span>
              {' / '}
              <span style={{ color: 'var(--danger)' }}>−{project.lines_deleted}</span>
            </span>
          )}
        </div>
      </div>

      {prs.map((pr, i) => <PRRow key={pr.pr_number ?? i} pr={pr} />)}

      {dayKeys.map(date => (
        <div key={date} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{date}</div>
          {dayGroups[date].map((c, i) => <CommitRow key={c.sha || i} commit={c} />)}
        </div>
      ))}
    </div>
  )
}

const tabBtnStyle = (active) => ({
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '5px 14px',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? 'var(--accent1)' : 'var(--muted)',
  borderBottom: active ? '2px solid var(--accent1)' : '2px solid transparent',
  marginBottom: -1,
  transition: 'color 0.15s',
})

export default function EngineerWeeklyBlock({ engineer }) {
  const [tab, setTab] = useState('tasks')

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        <button style={tabBtnStyle(tab === 'tasks')} onClick={() => setTab('tasks')}>
          Weekly tasks
        </button>
        <button style={tabBtnStyle(tab === 'activity')} onClick={() => setTab('activity')}>
          Activity
        </button>
      </div>

      {tab === 'tasks' && (
        <div>
          {engineer.tasks ? (
            isHtml(engineer.tasks)
              ? <SafeHtml html={engineer.tasks} />
              : <p style={{ whiteSpace: 'pre-line', margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text)' }}>
                  {engineer.tasks}
                </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
              No tasks added for this week
            </p>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div>
          {(!engineer.projects || engineer.projects.length === 0) ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
              No GitHub activity this week
            </p>
          ) : (
            engineer.projects.map((p, i) => (
              <ProjectSection key={p.repo || i} project={p} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
