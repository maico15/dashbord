const _rawApiUrl = import.meta.env.VITE_API_URL || ''
// Guard: PLACEHOLDER or non-http values mean the env var was never properly set.
// Fall back to same-origin /api (works with Vite proxy in dev; on production the
// Render env var must be set to the actual backend URL).
const BASE = (_rawApiUrl && _rawApiUrl.startsWith('http'))
  ? `${_rawApiUrl}/api`
  : '/api'

async function req(method, path, body, password) {
  const base = BASE.startsWith('http') ? BASE : `${window.location.origin}${BASE}`
  const url = new URL(`${base}${path}`)
  if (password) url.searchParams.set('password', password)

  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(url, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json()
}

export const api = {
  get:   (path) => req('GET', path),
  put:   (path, body, pw) => req('PUT',   path, body, pw),
  patch: (path, body, pw) => req('PATCH', path, body, pw),
  post:  (path, body, pw) => req('POST',  path, body, pw),
  del:   (path, pw)       => req('DELETE', path, null, pw),
}
