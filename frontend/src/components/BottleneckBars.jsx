export default function BottleneckBars({ title, rows, color = 'var(--accent1)' }) {
  if (!rows || rows.length === 0) return null
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <div className="card">
      <div className="section-title" style={{ margin: '0 0 14px' }}>
        {title}
      </div>
      <div className="bbar-row">
        {rows.map((r, i) => (
          <div key={i} className="bbar-item">
            <span className="bbar-name">{r.name}</span>
            <div className="bbar-track">
              <div
                className="bbar-fill"
                style={{
                  width: `${(r.value / max) * 100}%`,
                  background: color,
                  opacity: 0.85,
                }}
              />
            </div>
            <span className="bbar-val">{r.value}{r.unit || ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
