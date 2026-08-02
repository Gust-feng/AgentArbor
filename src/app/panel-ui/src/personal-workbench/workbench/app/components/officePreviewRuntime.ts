import type { DocumentPreview } from '../../../../../../panel-api-contracts'
import { loadDocxDocumentSurface, loadSpreadsheetDocumentSurface } from './officePreviewSurfaceLoader'

const MAX_CACHED_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_DOCUMENT_CACHE_BYTES = 24 * 1024 * 1024

type OfficeContent = Extract<DocumentPreview['content'], { readonly kind: 'office' }>
type CachedDocument = { readonly byteLength: number; readonly promise: Promise<Blob> }
type OfficeDocumentRequest = {
  readonly url: string
  readonly byteLength?: number
  readonly sourceVersion?: string
  readonly signal: AbortSignal
}

const documentCache = new Map<string, CachedDocument>()
let cachedDocumentBytes = 0
let docxRendererPromise: Promise<typeof import('docx-preview')> | undefined
let spreadsheetWorkerClientPromise: Promise<typeof import('./spreadsheetPreviewWorkerClient')> | undefined

export function loadDocxRenderer(): Promise<typeof import('docx-preview')> {
  docxRendererPromise ??= import('docx-preview').catch((reason: unknown) => {
    docxRendererPromise = undefined
    throw reason
  })
  return docxRendererPromise
}

export function loadOfficeDocument({ url, byteLength, sourceVersion, signal }: OfficeDocumentRequest): Promise<Blob> {
  const cacheable = byteLength !== undefined && byteLength <= MAX_CACHED_DOCUMENT_BYTES
  if (!cacheable) return fetchOfficeDocument(url, signal)
  const cacheKey = `${url}\u0000${sourceVersion ?? ''}`
  const cached = documentCache.get(cacheKey)
  if (cached !== undefined) {
    documentCache.delete(cacheKey)
    documentCache.set(cacheKey, cached)
    return waitForDocument(cached.promise, signal)
  }

  makeDocumentCacheRoom(byteLength)
  const promise = fetchOfficeDocument(url).catch((reason: unknown) => {
    removeCachedDocument(cacheKey)
    throw reason
  })
  documentCache.set(cacheKey, { byteLength, promise })
  cachedDocumentBytes += byteLength
  return waitForDocument(promise, signal)
}

export function prefetchOfficePreview(preview: DocumentPreview): void {
  if (preview.content.kind !== 'office') return
  warmOfficeRenderer(preview.content.officeKind)
  if (preview.byteLength !== undefined && preview.byteLength <= MAX_CACHED_DOCUMENT_BYTES) {
    void loadOfficeDocument({
      url: preview.content.url,
      byteLength: preview.byteLength,
      sourceVersion: preview.fingerprint,
      signal: new AbortController().signal,
    }).catch(() => undefined)
  }
}

export function scheduleOfficePreviewWarmup(): void {
  scheduleIdle(async () => {
    await Promise.all([loadDocxRenderer(), loadDocxDocumentSurface()]).catch(() => undefined)
    scheduleIdle(async () => {
      await loadSpreadsheetDocumentSurface().catch(() => undefined)
      const workerClient = await loadSpreadsheetWorkerClient().catch(() => undefined)
      workerClient?.warmSpreadsheetPreviewWorker()
    })
  })
}

function warmOfficeRenderer(kind: OfficeContent['officeKind']): void {
  if (kind === 'docx') {
    void Promise.all([loadDocxRenderer(), loadDocxDocumentSurface()]).catch(() => undefined)
    return
  }
  void Promise.all([
    loadSpreadsheetDocumentSurface(),
    loadSpreadsheetWorkerClient().then((client) => client.warmSpreadsheetPreviewWorker()),
  ]).catch(() => undefined)
}

function loadSpreadsheetWorkerClient(): Promise<typeof import('./spreadsheetPreviewWorkerClient')> {
  spreadsheetWorkerClientPromise ??= import('./spreadsheetPreviewWorkerClient').catch((reason: unknown) => {
    spreadsheetWorkerClientPromise = undefined
    throw reason
  })
  return spreadsheetWorkerClientPromise
}

async function fetchOfficeDocument(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, signal === undefined ? undefined : { signal })
  if (!response.ok) throw new Error(`文件内容读取失败（HTTP ${response.status}）。`)
  return response.blob()
}

function waitForDocument(promise: Promise<Blob>, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      if (!signal.aborted) resolve(value)
    }, (reason: unknown) => {
      signal.removeEventListener('abort', onAbort)
      if (!signal.aborted) reject(reason)
    })
  })
}

function makeDocumentCacheRoom(byteLength: number): void {
  while (cachedDocumentBytes + byteLength > MAX_DOCUMENT_CACHE_BYTES && documentCache.size > 0) {
    removeCachedDocument(documentCache.keys().next().value!)
  }
}

function removeCachedDocument(url: string): void {
  const cached = documentCache.get(url)
  if (cached === undefined) return
  documentCache.delete(url)
  cachedDocumentBytes -= cached.byteLength
}

function scheduleIdle(task: () => void | Promise<void>): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => { void task() }, { timeout: 3_000 })
  } else {
    window.setTimeout(() => { void task() }, 1_500)
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}
