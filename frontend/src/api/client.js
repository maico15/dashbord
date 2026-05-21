const BASE = '/api'

async function req(method, path, body, password) {
  const url = new URL(`${window.location.origin}${BASE}${path}`)
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
