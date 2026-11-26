/**
 * Bilingual weekly-task text.
 *
 * `weekly_tasks.tasks` holds one string. When it carries both languages the
 * English block comes first, then a line that is exactly `____ ru`, then the
 * Russian block. There is no schema change behind this — a row without the
 * marker is English-only, which is what every pre-existing row is.
 */

export const RU_MARKER = '____ ru'

/**
 * A marker line, allowing for the `<p>` wrapper TipTap puts around a paragraph
 * and for stray whitespace. Anything else is content.
 */
function isMarkerLine(line) {
  const bare = String(line)
    .trim()
    .replace(/^<p[^>]*>/i, '')
    .replace(/<\/p>$/i, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return bare === RU_MARKER
}

/** True for '', undefined, and HTML that renders nothing (TipTap's `<p></p>`). */
export function isBlankHtml(value) {
  if (!value) return true
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim() === ''
}

/**
 * Split stored text into its two halves on the FIRST marker line.
 * No marker → everything is English and `ru` is empty.
 */
export function splitWeeklyTasks(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const lines = text.split('\n')
  const idx = lines.findIndex(isMarkerLine)
  if (idx !== -1) {
    return {
      en: lines.slice(0, idx).join('\n').trim(),
      ru: lines.slice(idx + 1).join('\n').trim(),
    }
  }
  // TipTap emits every paragraph on one line, so a marker typed into a single
  // editor arrives as an inline `<p>____ ru</p>` with no line break around it.
  const inline = text.match(/<p[^>]*>\s*____(?:&nbsp;|\s)+ru\s*<\/p>/i)
  if (inline) {
    return {
      en: text.slice(0, inline.index).trim(),
      ru: text.slice(inline.index + inline[0].length).trim(),
    }
  }
  return { en: text, ru: '' }
}

/**
 * Inverse of splitWeeklyTasks. An empty Russian half is stored without the
 * marker at all, so a row stays byte-identical to the single-language form.
 */
export function joinWeeklyTasks(en, ru) {
  const enPart = isBlankHtml(en) ? '' : String(en).trim()
  const ruPart = isBlankHtml(ru) ? '' : String(ru).trim()
  if (!ruPart) return enPart
  return `${enPart}\n${RU_MARKER}\n${ruPart}`
}
