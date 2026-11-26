/* Адрес нынешнего бэкенда зашит по умолчанию, а не берётся из переменной
 * окружения. Так сделано нарочно: в Lovable проект должен открыться и
 * показать данные сразу после импорта, без единой настройки. Настройка,
 * без которой пустой экран, — это настройка, о которой узнают по пустому
 * экрану.
 *
 * VITE_API_URL всё ещё перекрывает это значение — она нужна, когда бэкенд
 * поднят локально или появится новый адрес. */
const DEFAULT_API = 'https://dashbord-5u0i.onrender.com'

const _rawApiUrl = import.meta.env.VITE_API_URL || ''

/* Единственное место, где решается адрес бэкенда. Несколько страниц раньше
 * считали его сами и получали пустой экран там, где переменная окружения не
 * задана; теперь они берут отсюда. Новый код, которому нужен адрес, тоже
 * импортирует API_ORIGIN, а не читает import.meta.env. */
export const API_ORIGIN = _rawApiUrl.startsWith('http') ? _rawApiUrl : DEFAULT_API

const BASE = `${API_ORIGIN}/api`

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
