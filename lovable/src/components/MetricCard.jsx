import { useState, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

const GAP = 10     // px between card edge and tooltip
const MARGIN = 8   // minimum distance from viewport edges

function Tooltip({ text, cardRef }) {
  const tipRef = useRef(null)
  const [style, setStyle] = useState({ position: 'fixed', opacity: 0, top: 0, left: 0, zIndex: 9999 })
  const [placement, setPlacement] = useState('bottom')

  useLayoutEffect(() => {
    const card = cardRef.current?.getBoundingClientRect()
    const tip  = tipRef.current?.getBoundingClientRect()
    if (!card || !tip) return

    const vw = window.innerWidth
    const vh = window.innerHeight

    const spaceBelow = vh - card.bottom - GAP
    const spaceAbove = card.top      - GAP
    const spaceRight = vw - card.right - GAP
    const spaceLeft  = card.left     - GAP

    // Preferred order: bottom → right → left → top
    let p = 'bottom'
    if (spaceBelow >= tip.height) {
      p = 'bottom'
    } else if (spaceRight >= tip.width) {
      p = 'right'
    } else if (spaceLeft >= tip.width) {
      p = 'left'
    } else if (spaceAbove >= tip.height) {
      p = 'top'
    }

    let top, left
    switch (p) {
      case 'bottom':
        top  = card.bottom + GAP
        left = card.left + card.width / 2 - tip.width / 2
        break
      case 'top':
        top  = card.top - GAP - tip.height
        left = card.left + card.width / 2 - tip.width / 2
        break
      case 'right':
        top  = card.top + card.height / 2 - tip.height / 2
        left = card.right + GAP
        break
      case 'left':
        top  = card.top + card.height / 2 - tip.height / 2
        left = card.left - GAP - tip.width
        break
    }

    // Clamp to viewport
    top  = Math.max(MARGIN, Math.min(top,  vh - tip.height - MARGIN))
    left = Math.max(MARGIN, Math.min(left, vw - tip.width  - MARGIN))

    setStyle({ position: 'fixed', opacity: 1, top, left, zIndex: 9999 })
    setPlacement(p)
  }, [cardRef])

  // Arrow: sits on the edge facing the card
  const arrowStyle = (() => {
    const base = { position: 'absolute', width: 0, height: 0 }
    switch (placement) {
      case 'bottom': return {  // tooltip below → arrow at top pointing ▲
        ...base,
        top: -6, left: '50%', transform: 'translateX(-50%)',
        borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
        borderBottom: '6px solid var(--accent1)',
      }
      case 'top': return {    // tooltip above → arrow at bottom pointing ▽
        ...base,
        top: '100%', left: '50%', transform: 'translateX(-50%)',
        borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
        borderTop: '6px solid var(--accent1)',
      }
      case 'right': return {  // tooltip right → arrow at left pointing ◁
        ...base,
        top: '50%', left: -6, transform: 'translateY(-50%)',
        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
        borderRight: '6px solid var(--accent1)',
      }
      case 'left': return {   // tooltip left → arrow at right pointing ▷
        ...base,
        top: '50%', left: '100%', transform: 'translateY(-50%)',
        borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
        borderLeft: '6px solid var(--accent1)',
      }
      default: return { display: 'none' }
    }
  })()

  return createPortal(
    <div
      ref={tipRef}
      style={{
        ...style,
        background: 'var(--card2)',
        border: '1px solid var(--accent1)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: 'var(--text)',
        maxWidth: 280,
        width: 'max-content',
        lineHeight: 1.7,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
        textAlign: 'left',
        animation: 'tooltip-fade 0.2s ease',
      }}
    >
      {text}
      <div style={arrowStyle} />
    </div>,
    document.body,
  )
}

export default function MetricCard({ label, value, sub, accent = 'accent1', tooltip }) {
  const [visible, setVisible] = useState(false)
  const timer   = useRef(null)
  const cardRef = useRef(null)

  function handleEnter() {
    timer.current = setTimeout(() => setVisible(true), 400)
  }

  function handleLeave() {
    clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <div
      ref={cardRef}
      className={`metric-card ${accent}`}
      style={{ position: 'relative' }}
      onMouseEnter={tooltip ? handleEnter : undefined}
      onMouseLeave={tooltip ? handleLeave : undefined}
    >
      {visible && tooltip && <Tooltip text={tooltip} cardRef={cardRef} />}

      <div className="label">
        {label}
        {tooltip && (
          <span style={{ marginLeft: 5, fontSize: 11, opacity: 0.5, cursor: 'default', userSelect: 'none' }}>
            ℹ
          </span>
        )}
      </div>
      <div className="value">{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}
