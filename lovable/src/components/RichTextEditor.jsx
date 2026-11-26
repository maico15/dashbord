import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useCallback } from 'react'

// Convert stored value to TipTap HTML.
// Old plain-text entries (no HTML tags) are wrapped in <p> so line-breaks survive.
function toEditorHtml(value) {
  if (!value) return ''
  if (/<[a-z]/i.test(value)) return value   // already HTML
  return value.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('')
}

function ToolBtn({ active, title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      // onMouseDown prevents the editor from losing focus
      onMouseDown={e => { e.preventDefault(); onClick() }}
      style={{
        background: active ? 'rgba(0,207,255,0.15)' : 'transparent',
        border: 'none',
        borderRadius: 4,
        color: active ? 'var(--accent1)' : 'var(--muted)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        padding: '3px 7px',
        minWidth: 26,
        lineHeight: 1.5,
        userSelect: 'none',
      }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return (
    <span style={{
      display: 'inline-block', width: 1,
      background: 'var(--border)', margin: '2px 3px', alignSelf: 'stretch',
    }} />
  )
}

export default function RichTextEditor({ value, onChange, placeholder = 'Add tasks…' }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder }),
    ],
    content: toEditorHtml(value),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Sync when week/year changes (value reloaded from API)
  useEffect(() => {
    if (!editor) return
    const incoming = toEditorHtml(value)
    // Only update if content differs to avoid echo-loop
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, false)
    }
  }, [value])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('URL', prev || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }, [editor])

  if (!editor) return null

  const c = editor.chain().focus()

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 7,
      background: 'var(--card2)', overflow: 'hidden',
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 1, padding: '5px 6px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
      }}>
        <ToolBtn active={editor.isActive('bold')}      title="Bold (Ctrl+B)"      onClick={() => c.toggleBold().run()}>
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn active={editor.isActive('italic')}    title="Italic (Ctrl+I)"    onClick={() => c.toggleItalic().run()}>
          <em>I</em>
        </ToolBtn>
        <ToolBtn active={editor.isActive('underline')} title="Underline (Ctrl+U)" onClick={() => c.toggleUnderline().run()}>
          <span style={{ textDecoration: 'underline' }}>U</span>
        </ToolBtn>

        <Divider />

        <ToolBtn active={editor.isActive('heading', { level: 1 })} title="Heading 1" onClick={() => c.toggleHeading({ level: 1 }).run()}>H1</ToolBtn>
        <ToolBtn active={editor.isActive('heading', { level: 2 })} title="Heading 2" onClick={() => c.toggleHeading({ level: 2 }).run()}>H2</ToolBtn>
        <ToolBtn active={editor.isActive('heading', { level: 3 })} title="Heading 3" onClick={() => c.toggleHeading({ level: 3 }).run()}>H3</ToolBtn>

        <Divider />

        <ToolBtn active={editor.isActive('bulletList')}  title="Bullet list"   onClick={() => c.toggleBulletList().run()}>
          ≡
        </ToolBtn>
        <ToolBtn active={editor.isActive('orderedList')} title="Numbered list" onClick={() => c.toggleOrderedList().run()}>
          1.
        </ToolBtn>

        <Divider />

        <ToolBtn active={editor.isActive('link')} title="Insert link" onClick={handleLink}>
          ↗
        </ToolBtn>
        {editor.isActive('link') && (
          <ToolBtn active={false} title="Remove link" onClick={() => c.extendMarkRange('link').unsetLink().run()}>
            ✕
          </ToolBtn>
        )}
      </div>

      {/* ── Editor area ── */}
      <EditorContent editor={editor} className="rich-editor-content" />
    </div>
  )
}
