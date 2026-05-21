import { useState, useRef } from 'react'

export default function MetricCard({ label, value, sub, accent = 'accent1', tooltip }) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)

  function handleEnter() {
    timer.current = setTimeout(() => setVisible(true), 5000)
  }

  function handleLeave() {
    clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <div
      className={`metric-card ${accent}`}
      style={{ position: 'relative' }}
      onMouseEnter={tooltip ? handleEnter : undefined}
      onMouseLeave={tooltip ? handleLeave : undefined}
    >
      {visible && tooltip && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 10px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0d1630',
          border: '1px solid #00cfff',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: '#c8d8f0',
          maxWidth: 280,
          width: 'max-content',
          zIndex: 100,
          animation: 'tooltip-fade 0.2s ease',
          lineHeight: 1.5,
          pointerEvents: 'none',
          whiteSpace: 'normal',
          textAlign: 'left',
        }}>
          {tooltip}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid #00cfff',
          }} />
        </div>
      )}
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}
