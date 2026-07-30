import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef, type ReactNode } from 'react'
import { diffLines, type Change } from 'diff'
import { AlertTriangle, Check, ChevronRight, Code2, ExternalLink, FileText, Folder, RefreshCw } from 'lucide-react'
import { fetchSpaceReferencePreview, getCachedReferencePreview, refreshSpaceReferencePreview, saveSpaceReferenceText, type SpaceReferencePreview } from './referencePreviewClient'
import { MarkdownDocumentSurface } from './MarkdownDocumentSurface'
import { CodeDocumentSurface } from './CodeDocumentSurface'
import './reference-preview.css'

const REVALIDATE_MS = 15_000
const AUTOSAVE_MS = 500
type PendingReferenceSave = {
  readonly epoch: number
  readonly itemId: string
  readonly relativePath: string
  readonly text: string
}
export type ReferencePreviewHandle = { readonly flush: () => Promise<void>; readonly discard: () => void }
type ReferenceDocumentSessionProps = {
  itemId: string
  initialRelativePath?: string
  fallbackTitle: string
  canOpen: boolean
  onOpen: () => void
  actions?: ReactNode
  apiBase?: string
  readOnly?: boolean
  onNavigatePath?: (relativePath: string) => void
}

export const ReferencePreview = forwardRef<ReferencePreviewHandle, {
  itemId: string
  initialRelativePath?: string
  fallbackTitle: string
  canOpen: boolean
  onOpen: () => void
  actions?: ReactNode
  apiBase?: string
  readOnly?: boolean
  onNavigatePath?: (relativePath: string) => void
  embedded?: boolean
}>(function ReferencePreview({
  itemId,
  initialRelativePath = '',
  fallbackTitle,
  canOpen,
  onOpen,
  actions,
  apiBase,
  readOnly = false,
  onNavigatePath,
  embedded = false,
}, ref) {
  const resolvedApiBase = apiBase ?? '/api/spaces/references'
  const targetKey = `${resolvedApiBase}:${itemId}:${initialRelativePath}`
  return (
    <div className={`aa-reference-preview${embedded ? ' aa-reference-preview--embedded' : ''}`}>
      <ReferenceDocumentSession
        ref={ref}
        key={targetKey}
        itemId={itemId}
        initialRelativePath={initialRelativePath}
        fallbackTitle={fallbackTitle}
        canOpen={canOpen}
        onOpen={onOpen}
        actions={actions}
        apiBase={resolvedApiBase}
        readOnly={readOnly}
        onNavigatePath={onNavigatePath}
      />
    </div>
  )
})

const ReferenceDocumentSession = forwardRef<ReferencePreviewHandle, ReferenceDocumentSessionProps>(function ReferenceDocumentSession(props, ref) {
  return <ReferenceDocumentSessionView {...props} sessionRef={ref} />
})

function ReferenceDocumentSessionView({
  itemId,
  initialRelativePath = '',
  fallbackTitle,
  canOpen,
  onOpen,
  actions,
  apiBase = '/api/spaces/references',
  readOnly = false,
  onNavigatePath,
  sessionRef,
}: ReferenceDocumentSessionProps & { sessionRef: ForwardedRef<ReferencePreviewHandle> }) {
  const cachedPreview = getCachedReferencePreview(itemId, initialRelativePath, apiBase)
  const [preview, setPreview] = useState<SpaceReferencePreview | undefined>(cachedPreview)
  const [incoming, setIncoming] = useState<SpaceReferencePreview>()
  const [showDiff, setShowDiff] = useState(false)
  const [error, setError] = useState<string>()
  const [relativePath, setRelativePath] = useState(initialRelativePath)
  const [draft, setDraft] = useState(() => cachedPreview?.content.kind === 'text' ? cachedPreview.content.text : '')
  const [loading, setLoading] = useState(cachedPreview === undefined)
  const [sourceMode, setSourceMode] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const loadVersionRef = useRef(0)
  const targetKey = `${apiBase}:${itemId}:${initialRelativePath}`
  const draftRef = useRef(draft)
  const pendingSaveRef = useRef<PendingReferenceSave | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveChainRef = useRef(Promise.resolve())
  const saveEpochRef = useRef(0)
  const fingerprintsRef = useRef(new Map<string, string>())
  draftRef.current = draft
  const dirty = !loading && preview?.content.kind === 'text' && preview.content.editable && draft !== preview.content.text

  function persistPendingSave() {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const pending = pendingSaveRef.current
    if (pending === null) return saveChainRef.current
    pendingSaveRef.current = null
    saveChainRef.current = saveChainRef.current.then(async () => {
      if (pending.epoch !== saveEpochRef.current) return
      const expectedFingerprint = fingerprintsRef.current.get(targetKey)
      if (expectedFingerprint === undefined) return
      const saved = await saveSpaceReferenceText({
        itemId: pending.itemId,
        relativePath: pending.relativePath,
        expectedFingerprint,
        text: pending.text,
      }, apiBase)
      if (pending.epoch !== saveEpochRef.current) return
      if (saved.fingerprint !== undefined) fingerprintsRef.current.set(targetKey, saved.fingerprint)
      setPreview(saved)
      setIncoming(undefined)
      setShowDiff(false)
      setError(undefined)
      if (pendingSaveRef.current === null && draftRef.current === pending.text) setSaveState('saved')
    }, async () => undefined).catch(async (reason: unknown) => {
      if (pending.epoch !== saveEpochRef.current) return
      const status = typeof reason === 'object' && reason !== null && 'status' in reason ? Number(reason.status) : undefined
      if (status === 409) {
        const next = await refreshSpaceReferencePreview(pending.itemId, pending.relativePath, undefined, apiBase).catch(() => undefined)
        if (next !== undefined) setIncoming(next)
      }
      setSaveState('error')
      setError(reason instanceof Error ? reason.message : '引用文件保存失败。')
    })
    return saveChainRef.current
  }

  function scheduleSave(text: string, immediate = false) {
    if (readOnly || preview?.content.kind !== 'text' || !preview.content.editable || loading) return
    if (fingerprintsRef.current.get(targetKey) === undefined) return
    setDraft(text)
    setSaveState('saving')
    pendingSaveRef.current = { epoch: saveEpochRef.current, itemId, relativePath: initialRelativePath, text }
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    if (immediate) persistPendingSave()
    else saveTimerRef.current = setTimeout(persistPendingSave, AUTOSAVE_MS)
  }

  useEffect(() => () => { void persistPendingSave() }, [targetKey])

  useImperativeHandle(sessionRef, () => ({
    flush: async () => { await persistPendingSave(); await saveChainRef.current },
    discard: () => {
      saveEpochRef.current += 1
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      pendingSaveRef.current = null
    },
  }), [targetKey])

  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirty])

  useEffect(() => {
    const cached = getCachedReferencePreview(itemId, initialRelativePath, apiBase)
    if (cached !== undefined) {
      setPreview(cached)
      setRelativePath(initialRelativePath)
      setDraft(cached.content.kind === 'text' ? cached.content.text : '')
      if (cached.fingerprint !== undefined) fingerprintsRef.current.set(targetKey, cached.fingerprint)
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    const loadVersion = ++loadVersionRef.current
    setLoading(preview === undefined)
    setIncoming(undefined)
    setShowDiff(false)
    setError(undefined)
    setSourceMode(false)
    setSaveState('saved')
    void fetchSpaceReferencePreview(itemId, initialRelativePath, controller.signal, apiBase).then((value) => {
      if (loadVersion !== loadVersionRef.current) return
      setPreview(value)
      setRelativePath(initialRelativePath)
      setDraft(value.content.kind === 'text' ? value.content.text : '')
      if (value.fingerprint !== undefined) fingerprintsRef.current.set(targetKey, value.fingerprint)
      setLoading(false)
    }, (reason: unknown) => {
      if (!controller.signal.aborted && loadVersion === loadVersionRef.current) {
        setError(reason instanceof Error ? reason.message : '引用预览加载失败。')
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [apiBase, initialRelativePath, itemId, targetKey])

  useEffect(() => {
    if (preview === undefined) return
    let disposed = false
    const revalidate = async () => {
      try {
        const next = await fetchSpaceReferencePreview(itemId, relativePath, undefined, apiBase)
        if (disposed) return
        if (hasSourceChanged(preview, next)) setIncoming(next)
      } catch {
        // Keep the visible projection stable. Explicit reload still reports failures.
      }
    }
    const onFocus = () => void revalidate()
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(() => void revalidate(), REVALIDATE_MS)
    return () => {
      disposed = true
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [apiBase, itemId, preview, relativePath])

  const changes = useMemo(() => {
    if (!showDiff || preview?.content.kind !== 'text' || incoming?.content.kind !== 'text') return undefined
    return diffLines(draft, incoming.content.text)
  }, [draft, incoming, preview, showDiff])

  async function reload() {
    saveEpochRef.current += 1
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    pendingSaveRef.current = null
    const loadVersion = ++loadVersionRef.current
    setError(undefined)
    try {
      const next = incoming ?? await fetchSpaceReferencePreview(itemId, relativePath, undefined, apiBase)
      if (loadVersion !== loadVersionRef.current) return
      setPreview(next)
      setDraft(next.content.kind === 'text' ? next.content.text : '')
      if (next.fingerprint !== undefined) fingerprintsRef.current.set(targetKey, next.fingerprint)
      setIncoming(undefined)
      setShowDiff(false)
      setSaveState('saved')
    } catch (reason) {
      if (loadVersion === loadVersionRef.current) setError(reason instanceof Error ? reason.message : '引用预览加载失败。')
    }
  }

  if (preview === undefined) {
    return <PreviewState title={fallbackTitle} message={error ?? '正在读取引用内容...'} error={error !== undefined} onRetry={() => void reload()} />
  }
  const markdownDocument = isMarkdownPreview(preview)

  return (
    <div className="aa-reference-preview__session">
      <header className="aa-reference-preview__header">
        <ReferenceBreadcrumb rootTitle={fallbackTitle} relativePath={relativePath} source={preview.source} />
        <div className="aa-reference-preview__actions">
          {!readOnly && preview.content.kind === 'text' && preview.content.editable && (
            <span className="aa-reference-preview__save-state" data-state={saveState}>
              {saveState === 'saved' ? <Check size={12} /> : <span />}
              {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '保存失败'}
            </span>
          )}
          {!readOnly && markdownDocument && preview.content.kind === 'text' && preview.content.editable && (
            <button type="button" onClick={() => setSourceMode((value) => !value)} title={sourceMode ? '返回阅读视图' : '编辑 Markdown 源码'}>
              <Code2 size={13} />{sourceMode ? '阅读' : '源码'}
            </button>
          )}
          {actions}
          {canOpen && (
            <button type="button" onClick={onOpen} title="在系统中打开">
              <ExternalLink size={13} />
              在系统中打开
            </button>
          )}
        </div>
      </header>

      {incoming !== undefined && (
        <div className="aa-reference-preview__notice" role="status">
          <AlertTriangle size={14} />
          <span>来源已更新，当前内容仍保持不变。</span>
          {preview.content.kind === 'text' && incoming.content.kind === 'text' && (
            <button type="button" onClick={() => setShowDiff((value) => !value)}>{showDiff ? '返回预览' : '比较更改'}</button>
          )}
          {dirty && incoming.fingerprint !== undefined && <button type="button" onClick={() => { fingerprintsRef.current.set(targetKey, incoming.fingerprint!); scheduleSave(draft, true) }}>保留我的版本</button>}
          <button type="button" onClick={() => void reload()}>加载新版</button>
        </div>
      )}
      {error !== undefined && <div className="aa-reference-preview__error" role="alert">{error}</div>}
      {changes !== undefined ? <TextDiff changes={changes} /> : sourceMode && markdownDocument ? (
        <textarea className="aa-reference-preview__editor" value={draft} onChange={(event) => scheduleSave(event.target.value)} spellCheck={false} />
      ) : <PreviewBody preview={preview} itemId={itemId} apiBase={apiBase} relativePath={relativePath} targetKey={targetKey} draft={draft} editable={!markdownDocument && !readOnly && !loading && preview.content.kind === 'text' && preview.content.editable} markdownDocument={markdownDocument} onChange={scheduleSave} onReload={() => void reload()} onNavigatePath={onNavigatePath} />}
    </div>
  )
}

function ReferenceBreadcrumb({ rootTitle, relativePath, source }: { rootTitle: string; relativePath: string; source: string }) {
  const segments = relativePath.split('/').filter(Boolean)
  return (
    <nav className="aa-reference-preview__breadcrumb" aria-label="文件路径" title={source}>
      <span data-root>{rootTitle}</span>
      {segments.map((segment, index) => (
        <Fragment key={`${index}:${segment}`}>
          <ChevronRight size={12} aria-hidden="true" />
          <span data-current={index === segments.length - 1 || undefined} aria-current={index === segments.length - 1 ? 'page' : undefined}>{segment}</span>
        </Fragment>
      ))}
    </nav>
  )
}

function PreviewBody({ preview, itemId, apiBase, relativePath, targetKey, draft, editable, markdownDocument, onChange, onReload, onNavigatePath }: { preview: SpaceReferencePreview; itemId: string; apiBase: string; relativePath: string; targetKey: string; draft: string; editable: boolean; markdownDocument: boolean; onChange: (value: string) => void; onReload: () => void; onNavigatePath?: (relativePath: string) => void }) {
  const content = preview.content
  if (content.kind === 'unavailable') return <PreviewState title={preview.title} message={content.message} error={preview.status === 'missing'} onRetry={onReload} />
  if (content.kind === 'text') {
    return (
      markdownDocument ? (
        <div className="aa-reference-preview__reader">
          <article className="aa-reference-preview__markdown reading-prose">
            <MarkdownDocumentSurface key={targetKey} markdown={draft} sourceVersion={`${targetKey}:${preview.fingerprint ?? ''}`} editable={editable} resolveImageUrl={referenceMarkdownUrlTransform(apiBase, itemId, relativePath)} onChange={onChange} />
            {content.truncated && <p className="aa-reference-preview__truncated">仅显示前 512 KiB 内容。</p>}
          </article>
        </div>
      ) : (
        <div className="aa-reference-preview__text" data-editable={editable || undefined}>
          {editable ? (
            <textarea className="aa-reference-preview__editor aa-reference-preview__editor--inline" value={draft} readOnly={!editable} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
          ) : <CodeDocumentSurface source={draft} filename={preview.title} language={content.language ?? 'plaintext'} encoding={content.encoding} />}
          {content.truncated && <p className="aa-reference-preview__truncated">仅显示前 512 KiB 内容。</p>}
        </div>
      )
    )
  }
  if (content.kind === 'directory') {
    if (onNavigatePath !== undefined) {
      const parent = content.relativePath.split('/').filter(Boolean).slice(0, -1).join('/')
      return (
        <div className="aa-reference-preview__directory">
          {content.relativePath.length > 0 && <button type="button" onClick={() => onNavigatePath(parent)}><ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />上一级</button>}
          {content.entries.map((entry) => (
            <button type="button" key={entry.relativePath} onClick={() => onNavigatePath(entry.relativePath)}>
              {entry.kind === 'directory' ? <Folder size={14} /> : <FileText size={14} />}
              <span>{entry.name}</span>
              {entry.kind === 'directory' && <ChevronRight size={13} />}
            </button>
          ))}
          {content.entries.length === 0 && <span>这个文件夹是空的。</span>}
        </div>
      )
    }
    return <PreviewState title={preview.title} message="从左侧资源树选择文件。" error={false} onRetry={onReload} />
  }
  if (content.kind === 'web') {
    if (content.body !== undefined) {
      return (
        <div className="aa-reference-preview__reader">
          <article className="aa-reference-preview__markdown reading-prose">
            <div className="aa-reference-preview__web-source">
              <span>{content.site ?? preview.title}</span>
              <a href={content.url} target="_blank" rel="noreferrer">访问原网页<ExternalLink size={12} /></a>
            </div>
            <MarkdownDocumentSurface markdown={content.body} sourceVersion={`${targetKey}:${preview.fingerprint ?? ''}`} />
          </article>
        </div>
      )
    }
    return (
      <div className="aa-reference-preview__web">
        <FileText size={28} />
        <strong>{preview.title}</strong>
        <a href={content.url} target="_blank" rel="noreferrer">{content.url}<ExternalLink size={12} /></a>
      </div>
    )
  }
  if (content.kind === 'pages') {
    return <div className="aa-reference-preview__reader"><div className="aa-reference-preview__pages">{content.pages.map((page, index) => <article key={index}><pre>{page}</pre><span>{index + 1} / {content.pages.length}</span></article>)}</div></div>
  }
  switch (content.mediaKind) {
    case 'image': return <div className="aa-reference-preview__media aa-reference-preview__media--described"><img src={content.url} alt={content.alt ?? preview.title} />{content.caption && <p>{content.caption}</p>}</div>
    case 'pdf': return <object className="aa-reference-preview__pdf" data={content.url} type={content.mimeType}><a href={content.url}>打开 PDF</a></object>
    case 'video': return <div className="aa-reference-preview__media aa-reference-preview__media--described"><video controls src={content.url} poster={content.poster} />{content.duration && <p>{content.duration}</p>}</div>
    case 'audio': return <div className="aa-reference-preview__audio"><audio controls src={content.url} />{content.duration && <span>{content.duration}</span>}{content.transcript && <p>{content.transcript}</p>}</div>
  }
}

function referenceMarkdownUrlTransform(apiBase: string, itemId: string, relativePath: string): (value: string) => string {
  const baseParts = relativePath.split('/').filter(Boolean).slice(0, -1)
  return (value) => {
    const trimmed = value.trim()
    if (/^https?:/iu.test(trimmed)) return trimmed
    if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed) || trimmed.startsWith('//')) return ''
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(trimmed.split(/[?#]/u, 1)[0])
    } catch {
      return ''
    }
    const parts = [...baseParts]
    for (const part of decodedPath.replaceAll('\\', '/').split('/')) {
      if (part.length === 0 || part === '.') continue
      if (part === '..') {
        if (parts.length === 0) return ''
        parts.pop()
      } else {
        parts.push(part)
      }
    }
    const resolved = parts.join('/')
    return resolved.length === 0 ? '' : `${apiBase}/${encodeURIComponent(itemId)}/content?path=${encodeURIComponent(resolved)}`
  }
}

function TextDiff({ changes }: { changes: readonly Change[] }) {
  return (
    <pre className="aa-reference-preview__diff" aria-label="来源内容更改">
      {changes.map((change, index) => <span key={index} data-change={change.added ? 'added' : change.removed ? 'removed' : 'same'}>{change.value}</span>)}
    </pre>
  )
}

function PreviewState({ title, message, error, onRetry }: { title: string; message: string; error: boolean; onRetry: () => void }) {
  return (
    <div className="aa-reference-preview__state">
      {error ? <AlertTriangle size={22} /> : <FileText size={22} />}
      <strong>{title}</strong>
      <span>{message}</span>
      {error && <button type="button" onClick={onRetry}><RefreshCw size={13} />重试</button>}
    </div>
  )
}

function hasSourceChanged(current: SpaceReferencePreview, next: SpaceReferencePreview): boolean {
  return current.fingerprint !== next.fingerprint || current.status !== next.status
}

function isMarkdownPreview(preview: SpaceReferencePreview): boolean {
  return preview.content.kind === 'text' && (preview.content.language === 'md' || preview.source.toLowerCase().endsWith('.md'))
}
