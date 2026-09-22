import { useState } from 'react'

/* The one password input in the app. It is always type="password" so the value
 * renders as dots and a browser never autofills it into a visible field; the
 * eye button flips it to plain text only while it is held open, and nothing
 * here logs or echoes the value anywhere.
 *
 * `labels` carries the two aria strings so the caller's dictionary decides the
 * language; the defaults keep the component usable on pages without one. */
export default function PasswordField({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete = 'current-password',
  onKeyDown,
  className = '',
  inputClassName = '',
  labels,
  style,
}) {
  const [show, setShow] = useState(false)
  const t = {
    show: (labels && labels.show) || 'Show password',
    hide: (labels && labels.hide) || 'Hide password',
  }

  return (
    <span className={`pwf ${className}`.trim()} style={style}>
      <input
        className={`pwf-input ${inputClassName}`.trim()}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
      />
      <button
        type="button"
        className="pwf-eye"
        // Out of the tab order: the eye is a convenience, and stopping between
        // the field and the submit button to skip it is not.
        tabIndex={-1}
        aria-label={show ? t.hide : t.show}
        aria-pressed={show}
        title={show ? t.hide : t.show}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff /> : <Eye />}
      </button>
      <style>{CSS}</style>
    </span>
  )
}

function Eye() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5 13.5 12.5" />
      <path d="M6.2 5.1C4.2 5.9 2.8 7.4 1.5 8c0 0 2.4 4 6.5 4 1 0 1.9-.2 2.7-.6" />
      <path d="M12.2 10.3c1.3-.9 2.3-2.3 2.3-2.3S12.1 4 8 4c-.4 0-.8 0-1.2.1" />
    </svg>
  )
}

const CSS = `
.pwf{position:relative;display:inline-flex;align-items:center;width:100%}
.pwf-input{width:100%;box-sizing:border-box;padding:8px 34px 8px 11px;
  border-radius:10px;border:none;background:var(--ios-bg,#F2F2F7);
  color:var(--ios-label,#1C1C1E);font-family:inherit;font-size:14px;
  letter-spacing:.02em}
.pwf-input:focus{outline:2px solid var(--ios-blue,#007AFF);outline-offset:-1px}
.pwf-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  border:none;background:none;cursor:pointer;padding:0;border-radius:6px;
  color:var(--ios-label3,#6D6D72)}
.pwf-eye:hover{color:var(--ios-blue-ink,#0A63D2)}
`
