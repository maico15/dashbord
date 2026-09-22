import { useState } from 'react'
import PasswordField from './PasswordField'
import { I18N, readLang } from '../i18n/itRequests'

/* Replacement for window.prompt("Admin password:"), which rendered the password
 * in plain text in a system dialog — the one place in the app where it was
 * readable over a shoulder or in a screen share.
 *
 * Callers hand over the action that needs the password: the prompt takes it,
 * verifies it against /api/admin/verify, and only then runs the action, so the
 * click that triggered it is not lost the way a bare "enter the password first"
 * would lose it. */
export default function PasswordPrompt({ title, onCancel, onGranted }) {
  const t = I18N[readLang('en')] || I18N.en
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const submit = async (ev) => {
    ev.preventDefault()
    if (!value) return
    setChecking(true)
    setError('')
    try {
      // Verified here rather than by the action, so a typo says "wrong
      // password" instead of failing whatever the caller was doing.
      const { api } = await import('../api/client')
      await api.post(`/admin/verify?password=${encodeURIComponent(value)}`, {})
      const granted = value
      setValue('')
      onGranted(granted)
    } catch {
      setError(t.admin.passwordWrong)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="pwp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <form className="pwp-card" onSubmit={submit}>
        <h2 className="pwp-title">{title || t.admin.passwordTitle}</h2>
        <PasswordField
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.common.password}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
          labels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
        />
        {error && <div className="pwp-err">{error}</div>}
        <div className="pwp-actions">
          <button type="button" className="pwp-btn" onClick={onCancel}>{t.admin.cancel}</button>
          <button type="submit" className="pwp-btn pwp-btn-primary" disabled={!value || checking}>
            {t.admin.passwordSubmit}
          </button>
        </div>
      </form>
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.pwp-backdrop{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.4);
  display:flex;align-items:flex-start;justify-content:center;padding:14vh 20px}
.pwp-card{width:100%;max-width:340px;background:var(--ios-card,#fff);border-radius:14px;
  box-shadow:0 12px 40px rgba(0,0,0,.2);padding:20px;
  font-family:var(--ios-font,-apple-system,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif);
  color:var(--ios-label,#1C1C1E)}
.pwp-title{margin:0 0 14px;font-size:16px;font-weight:700;letter-spacing:-.2px}
.pwp-err{margin-top:8px;font-size:12.5px;color:#C4241C}
[data-theme="dark"] .pwp-err{color:#FF9A93}
.pwp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.pwp-btn{border:none;border-radius:10px;padding:8px 15px;cursor:pointer;font-family:inherit;
  font-size:13.5px;font-weight:600;background:var(--ios-bg,#F2F2F7);color:var(--ios-blue-ink,#0A63D2)}
.pwp-btn-primary{background:var(--ios-blue-fill,#0A6CE0);color:#fff}
.pwp-btn:disabled{opacity:.45;cursor:not-allowed}
`
