import { I18N, LANGS, writeLang } from '../i18n/itRequests'

/* One stylesheet and the two controls all four request pages share, so the form,
 * the status page, "my requests" and triage cannot drift apart. Everything is
 * built from the --ios-* tokens the Gantt restyle added, which is what makes the
 * dark theme work without a second set of rules. */

export function LangToggle({ lang, onChange }) {
  return (
    <div className="itr-seg itr-lang" role="group">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={`itr-seg-btn${lang === l ? ' on' : ''}`}
          aria-pressed={lang === l}
          onClick={() => { writeLang(l); onChange(l) }}
        >
          {I18N[l].langName[l]}
        </button>
      ))}
    </div>
  )
}

/** Page chrome: title on the left, language on the right. */
export function PageHead({ title, subtitle, lang, onLang, children }) {
  return (
    <header className="itr-head">
      <div className="itr-head-main">
        <h1 className="itr-title">{title}</h1>
        {subtitle && <p className="itr-sub">{subtitle}</p>}
      </div>
      {children}
      <LangToggle lang={lang} onChange={onLang} />
    </header>
  )
}

/** iOS segmented control over a list of {value,label}. */
export function Segmented({ options, value, onChange, name }) {
  return (
    <div className="itr-seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`itr-seg-btn${value === o.value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Chip row — same job as Segmented, but wraps and suits eight options. */
export function Chips({ options, value, onChange }) {
  return (
    <div className="itr-chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`itr-chip${value === o.value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function StatusPill({ status, label }) {
  return <span className={`itr-pill itr-pill-${status}`}>{label}</span>
}

export function RequestsStyle() {
  return <style>{CSS}</style>
}

const CSS = `
.itr-page{min-height:100vh;display:flex;flex-direction:column;
  background:var(--ios-bg,#F2F2F7);color:var(--ios-label,#1C1C1E);
  font-family:var(--ios-font,-apple-system,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif);
  -webkit-font-smoothing:antialiased;font-size:14px;line-height:1.45}
.itr-main{flex:1 1 auto;width:100%;max-width:820px;margin:0 auto;padding:22px 20px 40px}
.itr-main-wide{max-width:1320px}

.itr-head{display:flex;align-items:flex-start;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.itr-head-main{flex:1;min-width:200px}
.itr-title{margin:0;font-size:24px;font-weight:700;letter-spacing:-.4px}
.itr-sub{margin:6px 0 0;font-size:13.5px;color:var(--ios-label2,#636366);max-width:56ch}

/* ── segmented control ── */
.itr-seg{display:inline-flex;gap:2px;background:var(--ios-sep,#E5E5EA);border-radius:9px;padding:2px;flex-wrap:wrap}
.itr-seg-btn{border:none;background:none;border-radius:7px;padding:5px 12px;cursor:pointer;
  font-family:inherit;font-size:13px;font-weight:500;color:var(--ios-label,#1C1C1E);white-space:nowrap}
.itr-seg-btn.on{background:var(--ios-card,#fff);font-weight:600;box-shadow:var(--ios-shadow-btn,0 1px 2px rgba(0,0,0,.08))}
.itr-lang{flex:none}

.itr-chips{display:flex;flex-wrap:wrap;gap:7px}
.itr-chip{border:none;border-radius:9px;padding:7px 13px;cursor:pointer;font-family:inherit;
  font-size:13px;background:var(--ios-card,#fff);color:var(--ios-label,#1C1C1E);
  box-shadow:var(--ios-shadow-btn,0 1px 2px rgba(0,0,0,.08))}
.itr-chip.on{background:var(--ios-blue-fill,#0A6CE0);color:#fff;font-weight:600}

/* ── cards and fields ── */
.itr-card{background:var(--ios-card,#fff);border-radius:14px;box-shadow:var(--ios-shadow,0 1px 3px rgba(0,0,0,.06));
  padding:18px 20px;margin-bottom:14px}
.itr-card-title{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ios-label3,#6D6D72);margin:0 0 14px}
.itr-field{margin-bottom:16px}
.itr-field:last-child{margin-bottom:0}
.itr-label{display:flex;align-items:baseline;gap:7px;font-size:13px;font-weight:600;margin-bottom:6px}
.itr-req{font-size:10.5px;font-weight:500;color:var(--ios-label3,#6D6D72);text-transform:uppercase;letter-spacing:.04em}
.itr-hint{font-size:12px;color:var(--ios-label3,#6D6D72);margin-top:5px}
.itr-warn{font-size:12px;color:var(--ios-orange-text,#7A3E00);margin-top:5px}
.itr-err{font-size:12px;color:#C4241C;margin-top:5px}
.itr-input,.itr-textarea,.itr-select{width:100%;box-sizing:border-box;border:none;border-radius:10px;
  background:var(--ios-bg,#F2F2F7);color:var(--ios-label,#1C1C1E);font-family:inherit;font-size:14px;
  padding:9px 11px}
.itr-textarea{resize:vertical;min-height:86px;line-height:1.5}
.itr-input:focus,.itr-textarea:focus,.itr-select:focus{outline:2px solid var(--ios-blue,#007AFF);outline-offset:-1px}
.itr-input-err{outline:2px solid #FF3B30;outline-offset:-1px}
.itr-row{display:flex;gap:12px;flex-wrap:wrap}
.itr-row>*{flex:1 1 180px;min-width:0}

/* ── buttons ── */
.itr-btn{border:none;border-radius:10px;padding:9px 16px;cursor:pointer;font-family:inherit;
  font-size:14px;font-weight:600;background:var(--ios-card,#fff);color:var(--ios-blue-ink,#0A63D2);
  box-shadow:var(--ios-shadow-btn,0 1px 2px rgba(0,0,0,.08))}
.itr-btn:hover{opacity:.8}
.itr-btn:disabled{opacity:.45;cursor:not-allowed}
.itr-btn-primary{background:var(--ios-blue-fill,#0A6CE0);color:#fff}
.itr-btn-green{background:var(--ios-green-tint,#E3F6E8);color:var(--ios-green-text,#1E7A3A)}
.itr-btn-danger{background:var(--ios-card,#fff);color:#C4241C}
.itr-btn-sm{padding:6px 12px;font-size:13px}
.itr-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}

/* ── status pills ── */
.itr-pill{display:inline-block;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:9px;white-space:nowrap}
.itr-pill-new{background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91)}
.itr-pill-accepted{background:var(--ios-blue-tint,#D6E6FF);color:var(--ios-blue-text,#0A3D91)}
.itr-pill-in_progress{background:var(--ios-orange-tint,#FFE5CC);color:var(--ios-orange-text,#7A3E00)}
.itr-pill-waiting_requester{background:var(--ios-orange-tint,#FFE5CC);color:var(--ios-orange-text,#7A3E00)}
.itr-pill-done{background:var(--ios-green-tint,#E3F6E8);color:var(--ios-green-text,#1E7A3A)}
.itr-pill-rejected{background:#FFE3E1;color:#9B1C15}
[data-theme="dark"] .itr-pill-rejected{background:#3A1310;color:#FFC7C2}
[data-theme="dark"] .itr-btn-danger{color:#FF9A93}
[data-theme="dark"] .itr-err{color:#FF9A93}

/* ── misc ── */
.itr-meta{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--ios-label2,#636366)}
.itr-meta b{font-weight:600;color:var(--ios-label,#1C1C1E)}
.itr-empty{padding:30px 0;text-align:center;color:var(--ios-label3,#6D6D72);font-size:13.5px}
.itr-link{color:var(--ios-blue-ink,#0A63D2);text-decoration:none}
.itr-link:hover{text-decoration:underline}
.itr-mono{font-variant-numeric:tabular-nums;font-weight:700;letter-spacing:.02em}


/* Fact grids and the event log are used by both the status page and triage, so
 * they live in the shared sheet — a page-local copy would leave the other page
 * rendering the same markup unstyled. */
.itr-fact dt{font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:var(--ios-label3,#6D6D72)}
.itr-fact dd{margin:2px 0 0;font-size:13.5px;white-space:pre-wrap}
.itr-log{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;font-size:12.5px}
.itr-log li{display:flex;gap:12px;align-items:baseline}
.itr-log-time{flex:none;width:150px;color:var(--ios-label3,#6D6D72);font-variant-numeric:tabular-nums}
.itr-log-text{color:var(--ios-label2,#636366)}
.itr-log-body{color:var(--ios-label3,#6D6D72)}

@media(max-width:640px){
  .itr-main{padding:16px 14px 28px}
  .itr-log li{flex-direction:column;gap:1px}
  .itr-log-time{width:auto}
  .itr-title{font-size:21px}
  .itr-row{flex-direction:column;gap:0}
  .itr-row>*{flex:1 1 auto}
}
`
