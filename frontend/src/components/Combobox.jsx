import { useState, useRef, useEffect, useMemo } from 'react'

/* A search field with a dropdown, used by triage for both the owner and the
 * linked task. Once something is chosen it collapses to a chip with an × — the
 * field is for choosing, the chip is for showing.
 *
 * Options come from the caller (already filtered, or already fetched for an
 * async search); this component owns only the open/closed state, the highlight
 * and the keyboard. `footer` is an extra row pinned to the bottom of the list —
 * that is where "Outside engineering…" lives. */
export default function Combobox({
  value,              // { label, sublabel, color } | null — the current choice
  query,
  onQuery,
  options,            // [{ key, label, sublabel, meta, color, group }]
  onSelect,
  onClear,
  placeholder,
  emptyText,
  footer,             // { label, onSelect } | null
  groupLabels,        // { groupKey: 'Heading' }
  disabled,
  autoFocus,
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // Whether the reader has moved the highlight themselves. The first row is
  // highlighted as soon as the list opens, so without this the first ArrowDown
  // would skip past it to the second — which is never what was meant.
  const [moved, setMoved] = useState(false)
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  // Rows as the keyboard sees them: the footer is one more selectable row.
  const rows = useMemo(() => {
    const list = options.map((o) => ({ kind: 'option', ...o }))
    if (footer) list.push({ kind: 'footer', key: '__footer', label: footer.label })
    return list
  }, [options, footer])

  useEffect(() => { setActive(0); setMoved(false) }, [query, options.length])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const choose = (row) => {
    if (!row) return
    if (row.kind === 'footer') footer.onSelect()
    else onSelect(row)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setMoved(false); return }
      if (!moved) { setMoved(true); if (e.key === 'ArrowDown') return }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        return Math.max(0, Math.min(rows.length - 1, next))
      })
    } else if (e.key === 'Enter') {
      if (open && rows.length) { e.preventDefault(); choose(rows[active]) }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false) }
    }
  }

  if (value) {
    return (
      <div className="cbx" ref={boxRef}>
        <span className="cbx-chip">
          {value.color && <i className="cbx-chip-dot" style={{ background: value.color }} />}
          <span className="cbx-chip-label">{value.label}</span>
          {value.sublabel && <span className="cbx-chip-sub">{value.sublabel}</span>}
          <button type="button" className="cbx-chip-x" onClick={onClear}
            aria-label={placeholder} disabled={disabled}>×</button>
        </span>
        <style>{CSS}</style>
      </div>
    )
  }

  return (
    <div className="cbx" ref={boxRef}>
      <input
        ref={inputRef}
        className="cbx-input"
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => { onQuery(e.target.value); setOpen(true) }}
        onFocus={() => { setOpen(true); setMoved(false) }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul className="cbx-list" role="listbox">
          {rows.length === 0 && <li className="cbx-empty">{emptyText}</li>}
          {rows.map((row, i) => {
            const groupHead = row.kind === 'option' && groupLabels && row.group
              && (i === 0 || rows[i - 1].group !== row.group)
            return (
              <li key={row.key}>
                {groupHead && <div className="cbx-group">{groupLabels[row.group] || row.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`cbx-row${i === active ? ' on' : ''}${row.kind === 'footer' ? ' cbx-row-footer' : ''}`}
                  // mousedown, not click: the input's blur would close the list first.
                  onMouseDown={(e) => { e.preventDefault(); choose(row) }}
                  onMouseEnter={() => setActive(i)}
                >
                  {row.color && <i className="cbx-dot" style={{ background: row.color }} />}
                  <span className="cbx-row-label">{row.label}</span>
                  {row.sublabel && <span className="cbx-row-sub">{row.sublabel}</span>}
                  {row.meta && <span className="cbx-row-meta">{row.meta}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
.cbx{position:relative;width:100%}
.cbx-input{width:100%;box-sizing:border-box;border:none;border-radius:10px;
  background:var(--ios-bg,#F2F2F7);color:var(--ios-label,#1C1C1E);
  font-family:inherit;font-size:14px;padding:9px 11px}
.cbx-input:focus{outline:2px solid var(--ios-blue,#007AFF);outline-offset:-1px}

.cbx-list{position:absolute;z-index:40;top:calc(100% + 4px);left:0;right:0;margin:0;padding:4px;
  list-style:none;max-height:262px;overflow-y:auto;background:var(--ios-card,#fff);
  border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16)}
.cbx-empty{padding:10px 12px;font-size:13px;color:var(--ios-label3,#6D6D72)}
.cbx-group{padding:7px 10px 3px;font-size:10.5px;font-weight:600;letter-spacing:.05em;
  text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.cbx-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;
  background:none;font-family:inherit;font-size:13.5px;color:var(--ios-label,#1C1C1E);
  padding:8px 10px;border-radius:8px;cursor:pointer}
.cbx-row.on{background:var(--ios-blue-tint,#D6E6FF)}
.cbx-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbx-row-sub{font-size:11.5px;color:var(--ios-label3,#6D6D72);white-space:nowrap}
.cbx-row-meta{font-size:11.5px;color:var(--ios-label2,#636366);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.cbx-row-footer{color:var(--ios-blue-ink,#0A63D2);font-weight:600}
.cbx-dot,.cbx-chip-dot{width:18px;height:18px;border-radius:50%;flex:none}
.cbx-chip-dot{width:14px;height:14px}

.cbx-chip{display:inline-flex;align-items:center;gap:7px;max-width:100%;
  background:var(--ios-bg,#F2F2F7);border-radius:10px;padding:7px 8px 7px 10px}
.cbx-chip-label{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbx-chip-sub{font-size:11.5px;color:var(--ios-label3,#6D6D72);white-space:nowrap}
.cbx-chip-x{border:none;background:none;cursor:pointer;font-size:16px;line-height:1;
  color:var(--ios-label3,#6D6D72);padding:0 2px}
.cbx-chip-x:hover{color:#C4241C}
[data-theme="dark"] .cbx-chip-x:hover{color:#FF9A93}
`
