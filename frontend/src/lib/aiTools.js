/* The AI tools the access register knows about. Keys match AI_ACCESS_TOOLS in
 * backend/main.py; colours are the coloured square in the register's table.
 * `match` recognises the tool in free text — an IT request's summary — so a
 * request filed under "Other" can still be offered to the register. */

export const AI_TOOLS = [
  { key: 'claude',     label: 'Claude',     color: '#D97757', match: /\bclaude\b|anthropic/i },
  { key: 'chatgpt',    label: 'ChatGPT',    color: '#10A37F', match: /chat\s?gpt|openai/i },
  { key: 'lovable',    label: 'Lovable',    color: '#E5468C', match: /lovable/i },
  { key: 'fireflies',  label: 'Fireflies',  color: '#7C4DFF', match: /fireflies/i },
  { key: 'openrouter', label: 'OpenRouter', color: '#6466F1', match: /open\s?router/i },
  { key: 'notion',     label: 'Notion',     color: '#37352F', match: /notion/i },
  { key: 'abacus',     label: 'Abacus',     color: '#0A84FF', match: /abacus/i },
  { key: 'other',      label: 'Другое',     color: '#8E8E93', match: null },
]

export const AI_TOOL = Object.fromEntries(AI_TOOLS.map((t) => [t.key, t]))

/** The first known tool named in `text`, or null. */
export function guessAiTool(text) {
  const s = String(text || '')
  const hit = AI_TOOLS.find((t) => t.match && t.match.test(s))
  return hit ? hit.key : null
}

/** An IT request that is a request for an AI seat: an access request filed
 * under AI tools, or under any system when the summary names a known tool. */
export function isAiAccessRequest(req) {
  if (!req || req.kind !== 'access') return false
  return req.system === 'ai_tools' || !!guessAiTool(req.summary)
}

/** Display name for a row — the free-text tool when the key is `other`. */
export function aiToolName(row) {
  if (!row) return ''
  if (row.tool === 'other') return row.tool_other || AI_TOOL.other.label
  return (AI_TOOL[row.tool] || AI_TOOL.other).label
}
