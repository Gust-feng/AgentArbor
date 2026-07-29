import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, Code2, Maximize2, Brain } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useBrain } from './brainStore'
import type { Note } from './notesStore'
import { getPersonalNoteSaveState, subscribePersonalKnowledge } from './personalKnowledgeClient'

/**
 * 笔记编辑器 —— 所见即所得书写面。
 *
 * 类 Typora 体验：输入 Markdown 语法即时渲染为格式化内容，无需切换预览。
 * 存储仍为纯 Markdown 文本（note.body），编辑器仅作为可视化视图层。
 *
 * 持久化交给上层（通过 onSave 落到 notesStore）。本组件只管书写体验：
 *  - 正文自动保存（去抖 500ms），右上角显示保存态。
 *  - 卸载 / 切换笔记时立即冲刷未保存的改动，避免丢字。
 *  - 提供「源码模式」切换，供需要直接看 Markdown 的用户使用。
 */

interface NoteEditorProps {
  note: Note
  /** 持久化一次改动；显式带上目标 id，避免快速切换笔记时写错对象。 */
  onSave: (id: string, patch: { title?: string; body?: string }) => void
  onOpenFocus?: () => void
}

const AUTOSAVE_MS = 500

export function NoteEditor({ note, onSave, onOpenFocus }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title)
  const [saved, setSaved] = useState(true)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceBody, setSourceBody] = useState(note.body)
  const brain = useBrain()
  const durableSaveState = useSyncExternalStore(
    subscribePersonalKnowledge,
    () => getPersonalNoteSaveState(note.id),
    () => 'saved',
  )
  const collected = brain.isCollected(note.id)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ id: string; patch: { title?: string; body?: string } } | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  function flush() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingRef.current) {
      onSaveRef.current(pendingRef.current.id, pendingRef.current.patch)
      pendingRef.current = null
    }
  }

  function scheduleSave(patch: { title?: string; body?: string }) {
    const id = note.id
    const merged = { ...(pendingRef.current?.patch ?? {}), ...patch }
    pendingRef.current = { id, patch: merged }
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      onSaveRef.current(id, merged)
      pendingRef.current = null
      saveTimer.current = null
      setSaved(true)
    }, AUTOSAVE_MS)
  }

  // Tiptap 编辑器实例
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: 'aa-code-block' } },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '从这里开始写…' }),
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: note.body,
    editorProps: {
      attributes: {
        class: 'aa-editor-prose',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = (ed.storage as unknown as Record<string, { getMarkdown: () => string }>).markdown.getMarkdown()
      scheduleSave({ body: md })
    },
  })

  // 切换到另一篇笔记时：冲刷上一篇，载入新内容。
  useEffect(() => {
    flush()
    setTitle(note.title)
    setSourceBody(note.body)
    setSaved(true)
    setSourceMode(false)
    if (editor) {
      editor.commands.setContent(note.body, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  // 外部标题/正文变更同步（如空间树重命名）。
  useEffect(() => {
    if (pendingRef.current?.id === note.id) return
    setTitle(note.title)
    setSourceBody(note.body)
    if (editor && !editor.isFocused) {
      editor.commands.setContent(note.body, { emitUpdate: false })
    }
  }, [note.body, note.id, note.title, editor])

  // 卸载前冲刷。
  useEffect(() => flush, [])

  // 源码模式切换
  const toggleSourceMode = useCallback(() => {
    if (!editor) return
    if (!sourceMode) {
      // 进入源码模式：从编辑器取 Markdown
      const md = (editor.storage as unknown as Record<string, { getMarkdown: () => string }>).markdown.getMarkdown()
      setSourceBody(md)
      setSourceMode(true)
    } else {
      // 退出源码模式：把源码写回编辑器
      editor.commands.setContent(sourceBody, { emitUpdate: false })
      scheduleSave({ body: sourceBody })
      setSourceMode(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sourceMode, sourceBody])

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* 编辑器头：保存态 + 源码切换 + 操作 */}
      <header
        className="shrink-0 flex items-center gap-3 px-5"
        style={{ height: 48, borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
      >
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: '#6f8778' }} />
        <span className="text-xs shrink-0" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          笔记
        </span>

        <span
          className="flex items-center gap-1 text-xs shrink-0"
          style={{ color: 'var(--aa-text-3, #aba39b)' }}
        >
          {saved && durableSaveState === 'saved' ? <Check size={12} /> : <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: durableSaveState.startsWith('error:') ? '#b85c52' : 'var(--aa-accent, #6865a7)' }} />}
          {durableSaveState.startsWith('error:') ? '保存失败' : saved && durableSaveState === 'saved' ? '已保存' : '保存中…'}
        </span>

        <div className="flex-1" />

        <button
          onClick={toggleSourceMode}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
          style={{ color: sourceMode ? 'var(--aa-accent, #6865a7)' : 'var(--aa-text-2, #87827c)' }}
          title={sourceMode ? '返回所见即所得' : '查看 Markdown 源码'}
        >
          <Code2 size={12} />
          {sourceMode ? '编辑' : '源码'}
        </button>
        {onOpenFocus && (
          <button
            onClick={onOpenFocus}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-2, #87827c)' }}
          >
            <Maximize2 size={12} />
            专注
          </button>
        )}
        <button
          onClick={() => (collected ? brain.uncollect(note.id) : brain.collect(note.id, 'note'))}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
          style={{ color: collected ? 'var(--aa-accent, #6865a7)' : 'var(--aa-text-2, #87827c)' }}
        >
          <Brain size={12} />
          {collected ? '已收藏' : '收藏'}
        </button>
      </header>

      {/* 标题 */}
      <div className="shrink-0 mx-auto w-full px-6 pt-8" style={{ maxWidth: 'var(--reading-width, 680px)' }}>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave({ title: e.target.value })
          }}
          placeholder="无标题"
          className="w-full outline-none bg-transparent reading-prose"
          style={{ color: 'var(--aa-text-1, #292722)', fontSize: 22, fontWeight: 600 }}
        />
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto px-6 py-4 pb-24" style={{ maxWidth: 'var(--reading-width, 680px)' }}>
          {sourceMode ? (
            <textarea
              value={sourceBody}
              onChange={(e) => {
                setSourceBody(e.target.value)
                scheduleSave({ body: e.target.value })
              }}
              className="w-full outline-none bg-transparent resize-none text-sm leading-relaxed"
              style={{
                color: 'var(--aa-text-1, #292722)',
                minHeight: '60vh',
                fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
                fontSize: 13,
                lineHeight: 1.7,
              }}
              spellCheck={false}
            />
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>
    </div>
  )
}
