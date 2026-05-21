import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

function useCountUp(target, duration = 1800) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!target) return
    let start = 0
    const step = target / (duration / 16)
    const id = setInterval(() => {
      start += step
      if (start >= target) {
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

export default function TopBar({ teamName, week, year, totalScore }) {
  const animated = useCountUp(totalScore)

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

      <Link to="/admin" className="topbar-admin-link">
        Admin ↗
      </Link>
    </div>
  )
}
