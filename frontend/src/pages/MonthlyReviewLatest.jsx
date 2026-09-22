import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api/client'

/* /review/latest — the address the footer links to, so a link printed once
 * keeps working as new months are published. Resolves the newest month through
 * the same endpoint the Dashboard tab uses and hands over to the review page. */
const FALLBACK = '/review/2026/8'

export default function MonthlyReviewLatest() {
  const [path, setPath] = useState(null)

  useEffect(() => {
    api.get('/monthly-review/latest')
      .then((d) => setPath(d && d.year && d.month ? `/review/${d.year}/${d.month}` : FALLBACK))
      .catch(() => setPath(FALLBACK))   // 404 = nothing published yet
  }, [])

  if (!path) return null
  return <Navigate to={path} replace />
}
