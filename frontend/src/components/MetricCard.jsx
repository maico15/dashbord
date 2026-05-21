export default function MetricCard({ label, value, sub, accent = 'accent1' }) {
  return (
    <div className={`metric-card ${accent}`}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}
