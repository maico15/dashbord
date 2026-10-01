import { useState, useEffect, useCallback } from 'react'

/* Who the requester is, for a product that has no login yet.
 *
 * This is a bridge, not an identity system: a work email and a Slack handle the
 * person typed once, kept in this browser. It proves nothing — the request
 * pages are public by design, and anyone with a ref can already read that
 * request — it only saves retyping and lets the front door greet someone.
 *
 * Every page reads identity through this one module. When HA ID login lands,
 * the session becomes the source of truth here and nothing above has to change:
 * callers already treat identity as something that arrives (`ready`) rather
 * than something that is simply there. */

export const IDENTITY_KEY = 'it_requests_identity'

const clean = (v) => String(v || '').trim()

/** Stored identity, or null. Shape is {email, slack}; anything else is junk. */
export function readIdentity() {
  try {
    const raw = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null')
    const email = clean(raw?.email)
    if (!email) return null
    return { email, slack: normaliseSlack(raw?.slack) }
  } catch {
    // Corrupt entry or storage blocked (private window) — unknown, not broken.
    return null
  }
}

export function writeIdentity(identity) {
  const email = clean(identity?.email)
  if (!email) return null
  const value = { email, slack: normaliseSlack(identity?.slack) }
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(value)) } catch { /* private mode */ }
  return value
}

export function clearIdentity() {
  try { localStorage.removeItem(IDENTITY_KEY) } catch { /* private mode */ }
}

/** One leading @, or none at all — never two. */
export function normaliseSlack(value) {
  const v = clean(value).replace(/^@+/, '')
  return v ? `@${v}` : ''
}

/** The display name: what is left of a work email before the domain. */
export function identityName(identity) {
  const email = clean(identity?.email)
  if (!email) return ''
  const local = email.split('@')[0]
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || email
}

export function useRequesterIdentity() {
  const [identity, setIdentity] = useState(null)
  // False until the first read has happened. Today that is one synchronous
  // effect; with a session endpoint it will be a request, and callers that
  // already wait here will not need touching.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setIdentity(readIdentity())
    setReady(true)
  }, [])

  const save = useCallback((value) => setIdentity(writeIdentity(value)), [])
  const clear = useCallback(() => { clearIdentity(); setIdentity(null) }, [])

  return { identity, ready, save, clear }
}
