import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme, toggleTheme } from '../hooks/useTheme'

function useCountUp(target, duration = 400) {
  const [count, setCount] = useState(target)
  const prevRef = useRef(target)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = target
    if (!target || target === prev) {
      setCount(target)
      return
    }
    let start = prev
    const step = (target - prev) / (duration / 16)
    const id = setInterval(() => {
      start += step
      if ((step > 0 && start >= target) || (step < 0 && start <= target)) {
        setCount(target)
        clearInterval(id)
      } else {
        setCount(Math.round(start))
      }
    }, 16)
    return () => clearInterval(id)
  }, [target, duration])
  return count
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export default function TopBar({ teamName, week, year, totalScore }) {
  const animated = useCountUp(totalScore)
  const theme = useTheme()

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">
          <span>⬡</span> {teamName || 'Engineering Squad'}
        </div>
        <div className="topbar-week">
          Week {week} · {year}
        </div>
      </div>

      <div className="topbar-score">
        <span className="score-label">Team XP</span>
        <span className="score-value">{animated.toLocaleString()}</span>
      </div>

      <div className="topbar-right">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <Link to="/reports" className="topbar-admin-link">
          Reports
        </Link>
        <Link to="/admin" className="topbar-admin-link">
          Admin ↗
        </Link>
      </div>
    </div>
  )
}
