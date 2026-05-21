const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
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
  get: (path) => req('GET', path),
  put: (path, body, pw) => req('PUT', path, body, pw),
  post: (path, body, pw) => req('POST', path, body, pw),
  del: (path, pw) => req('DELETE', path, null, pw),
}
