import { useState, useEffect } from "react"
import { Link } from "react-router-dom"

const API = import.meta.env.VITE_API_URL || "https://dashbord-5u0i.onrender.com"
const LATEST_EXE =
  "https://github.com/maico15/dashbord/releases/latest/download/cc_telemetry_tray.exe"

export default function Releases() {
  const [releases, setReleases] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    fetch(`${API}/api/releases`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        setReleases(d.releases || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="releases-page">

      <div className="releases-header">
        <Link to="/" className="releases-back">← Back to Dashboard</Link>
        <h1 className="releases-title">⚡ CC Telemetry — Releases</h1>
        <a href={LATEST_EXE} className="releases-dl-latest" download>
          ⬇ Download Latest
        </a>
      </div>

      {loading && (
        <div className="releases-state">Loading releases...</div>
      )}
      {error && (
        <div className="releases-state releases-state--error">
          Failed to load: {error}
        </div>
      )}
      {!loading && !error && releases.length === 0 && (
        <div className="releases-state">No releases found.</div>
      )}

      <div className="releases-list">
        {releases.map((r, i) => (
          <div
            key={r.version}
            className={`releases-card${i === 0 ? " releases-card--latest" : ""}`}
          >
            <div className="releases-card-head">
              <div className="releases-card-meta">
                {i === 0 && (
                  <span className="releases-badge">LATEST</span>
                )}
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="releases-card-version"
                >
                  {r.version}
                </a>
                <span className="releases-card-name">{r.name}</span>
              </div>
              <div className="releases-card-actions">
                <span className="releases-card-date">{r.date}</span>
                {r.download_url && (
                  <a
                    href={r.download_url}
                    className="releases-card-dl"
                    download
                  >
                    ⬇ .exe
                  </a>
                )}
              </div>
            </div>

            {r.body ? (
              <pre className="releases-card-body">{r.body}</pre>
            ) : (
              <p className="releases-card-nobody">No release notes.</p>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}
