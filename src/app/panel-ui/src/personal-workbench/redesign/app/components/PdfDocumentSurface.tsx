import { useEffect, useRef, useState, type RefObject } from 'react'
import { pushResponsivenessContext } from '../../../../app-responsiveness-diagnostics'

type PdfDocumentSurfaceProps = {
  readonly source: { readonly kind: 'pages'; readonly pages: readonly string[] }
    | { readonly kind: 'url'; readonly url: string }
}

type PdfDocumentHandle = {
  readonly numPages: number
  getPage(pageNumber: number): Promise<PdfPageHandle>
  destroy(): Promise<void>
}

type PdfPageHandle = {
  getViewport(input: { readonly scale: number }): { readonly width: number; readonly height: number }
  render(input: {
    readonly canvas: HTMLCanvasElement
    readonly canvasContext: CanvasRenderingContext2D
    readonly viewport: { readonly width: number; readonly height: number }
  }): { readonly promise: Promise<void>; cancel(): void }
  cleanup(): void
}

type PdfLoadSession = {
  readonly promise: Promise<PdfDocumentHandle>
  destroy(): Promise<void>
}

const INITIAL_PAGE_COUNT = 8
const PAGE_BATCH_SIZE = 8
const MAX_CONCURRENT_PAGE_RENDERS = 2

export function PdfDocumentSurface({ source }: PdfDocumentSurfaceProps) {
  if (source.kind === 'pages') return <StructuredPdfPages pages={source.pages} />
  return <RenderedPdfDocument url={source.url} />
}

function StructuredPdfPages({ pages }: { readonly pages: readonly string[] }) {
  const pagination = useProgressivePages(pages.length)
  useResponsivenessContext(`PDF text preview (${pages.length} pages)`)
  if (pages.length === 0) return <PdfState message="这个 PDF 暂无可显示内容。" />
  return (
    <div className="aa-pdf-document" data-pdf-source="structured">
      {pages.slice(0, pagination.visibleCount).map((page, index) => (
        <article className="aa-pdf-document__page aa-pdf-document__page--text" key={index}>
          <pre>{page}</pre>
          <PageNumber current={index + 1} total={pages.length} />
        </article>
      ))}
      <PdfPageContinuation {...pagination} total={pages.length} />
    </div>
  )
}

function RenderedPdfDocument({ url }: { readonly url: string }) {
  const [document, setDocument] = useState<PdfDocumentHandle>()
  const [error, setError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)
  const pagination = useProgressivePages(document?.numPages ?? 0)
  useResponsivenessContext(document === undefined ? 'PDF loading' : `PDF preview (${document.numPages} pages)`)

  useEffect(() => {
    let disposed = false
    let session: PdfLoadSession | undefined
    setDocument(undefined)
    setError(undefined)
    void createPdfLoadSession(url).then((created) => {
      if (disposed) {
        void created.destroy()
        return
      }
      session = created
      return created.promise.then((value) => {
        if (!disposed) setDocument(value)
      })
    }).catch(() => {
      if (!disposed) setError('无法在工作台中读取这个 PDF。')
    })
    return () => {
      disposed = true
      if (session !== undefined) void session.destroy()
    }
  }, [reloadKey, url])

  if (error !== undefined) return <PdfState message={error} onRetry={() => setReloadKey((value) => value + 1)} />
  if (document === undefined) return <PdfState message="正在读取 PDF..." />
  return (
    <div className="aa-pdf-document" data-pdf-source="file">
      {Array.from({ length: pagination.visibleCount }, (_, index) => (
        <RenderedPdfPage document={document} pageNumber={index + 1} total={document.numPages} key={index} />
      ))}
      <PdfPageContinuation {...pagination} total={document.numPages} />
    </div>
  )
}

function RenderedPdfPage({ document, pageNumber, total }: {
  readonly document: PdfDocumentHandle
  readonly pageNumber: number
  readonly total: number
}) {
  const articleRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(() => pageNumber <= 2 || typeof IntersectionObserver === 'undefined')
  const [aspectRatio, setAspectRatio] = useState(1 / Math.SQRT2)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = articleRef.current
    if (element === null || visible) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    }, { rootMargin: '800px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const article = articleRef.current
    const canvas = canvasRef.current
    if (article === null || canvas === null) return
    const abortController = new AbortController()
    let page: PdfPageHandle | undefined
    let renderTask: ReturnType<PdfPageHandle['render']> | undefined
    let renderedWidth = 0

    const render = async () => {
      const cssWidth = Math.max(1, Math.round(article.clientWidth))
      if (cssWidth === renderedWidth || abortController.signal.aborted) return
      renderedWidth = cssWidth
      await pdfPageRenderScheduler.schedule(abortController.signal, async () => {
        page ??= await document.getPage(pageNumber)
        if (abortController.signal.aborted) return
        const baseViewport = page.getViewport({ scale: 1 })
        setAspectRatio(baseViewport.width / baseViewport.height)
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
        const viewport = page.getViewport({ scale: cssWidth * pixelRatio / baseViewport.width })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d', { alpha: false })
        if (context === null) throw new Error('Canvas 2D is unavailable.')
        renderTask?.cancel()
        renderTask = page.render({ canvas, canvasContext: context, viewport })
        await renderTask.promise
        if (!abortController.signal.aborted) setFailed(false)
      })
    }

    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => { void render().catch((reason) => handleRenderFailure(reason, abortController.signal, setFailed)) })
    observer?.observe(article)
    void render().catch((reason) => handleRenderFailure(reason, abortController.signal, setFailed))
    return () => {
      abortController.abort()
      observer?.disconnect()
      renderTask?.cancel()
      page?.cleanup()
    }
  }, [document, pageNumber, visible])

  return (
    <article
      className="aa-pdf-document__page aa-pdf-document__page--canvas"
      ref={articleRef}
      style={{ aspectRatio }}
      aria-label={`PDF 第 ${pageNumber} 页`}
    >
      <canvas ref={canvasRef} />
      {failed && <span className="aa-pdf-document__page-error">这一页暂时无法显示。</span>}
      <PageNumber current={pageNumber} total={total} />
    </article>
  )
}

function PdfPageContinuation(props: {
  readonly visibleCount: number
  readonly sentinelRef: RefObject<HTMLDivElement | null>
  readonly loadMore: () => void
  readonly total: number
}) {
  if (props.visibleCount >= props.total) return null
  const remaining = props.total - props.visibleCount
  return (
    <div className="aa-pdf-document__continuation" ref={props.sentinelRef}>
      <span>{props.visibleCount} / {props.total} 页</span>
      <button type="button" onClick={props.loadMore}>继续加载后 {Math.min(PAGE_BATCH_SIZE, remaining)} 页</button>
    </div>
  )
}

function PageNumber({ current, total }: { readonly current: number; readonly total: number }) {
  return <span className="aa-pdf-document__page-number">{current} / {total}</span>
}

function PdfState({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <div className="aa-pdf-document__state" role={onRetry === undefined ? 'status' : 'alert'}>
      <span>{message}</span>
      {onRetry !== undefined && <button type="button" onClick={onRetry}>重试</button>}
    </div>
  )
}

function useProgressivePages(total: number) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(total, INITIAL_PAGE_COUNT))
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMore = () => setVisibleCount((current) => Math.min(total, current + PAGE_BATCH_SIZE))

  useEffect(() => {
    setVisibleCount(Math.min(total, INITIAL_PAGE_COUNT))
  }, [total])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || visibleCount >= total || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore()
    }, { rootMargin: '600px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [total, visibleCount])

  return { visibleCount, sentinelRef, loadMore }
}

function useResponsivenessContext(label: string): void {
  useEffect(() => pushResponsivenessContext(label), [label])
}

function handleRenderFailure(
  reason: unknown,
  signal: AbortSignal,
  setFailed: (failed: boolean) => void,
): void {
  const name = reason instanceof Error ? reason.name : undefined
  if (!signal.aborted && name !== 'RenderingCancelledException') setFailed(true)
}

class PdfPageRenderScheduler {
  private active = 0
  private readonly pending: Array<{
    readonly signal: AbortSignal
    readonly run: () => Promise<void>
    readonly resolve: () => void
    readonly reject: (reason: unknown) => void
  }> = []

  schedule(signal: AbortSignal, run: () => Promise<void>): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.pending.push({ signal, run, resolve, reject })
      this.drain()
    })
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT_PAGE_RENDERS) {
      const job = this.pending.shift()
      if (job === undefined) return
      if (job.signal.aborted) {
        job.resolve()
        continue
      }
      this.active += 1
      void job.run().then(job.resolve, job.reject).finally(() => {
        this.active -= 1
        this.drain()
      })
    }
  }
}

const pdfPageRenderScheduler = new PdfPageRenderScheduler()

async function createPdfLoadSession(url: string): Promise<PdfLoadSession> {
  if (typeof Worker === 'undefined') throw new Error('PDF worker is unavailable.')
  const pdfjs = await import('unpdf/pdfjs')
  const workerPort = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
    type: 'module',
    name: 'agentarbor-pdf-worker',
  })
  const worker = pdfjs.PDFWorker.create({ port: workerPort, name: 'agentarbor-pdf-worker' })
  const loadingTask = pdfjs.getDocument({
    url,
    worker,
    withCredentials: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  })
  let document: PdfDocumentHandle | undefined
  let destroyed = false
  return {
    promise: loadingTask.promise.then((value) => {
      document = value as PdfDocumentHandle
      return document
    }),
    async destroy() {
      if (destroyed) return
      destroyed = true
      try {
        if (document === undefined) await loadingTask.destroy()
        else await document.destroy()
      } finally {
        worker.destroy()
        workerPort.terminate()
      }
    },
  }
}
