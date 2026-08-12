import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { clearPdfPreviewRuntimeForTesting, PdfDocumentSurface, prefetchPdfPreview } from './PdfDocumentSurface'
import type { DocumentPreview } from './referencePreviewClient'

const getPdfDocumentMock = vi.hoisted(() => vi.fn())
const pdfWorkerDestroy = vi.hoisted(() => vi.fn())
const createPdfWorkerMock = vi.hoisted(() => vi.fn(() => ({ destroy: pdfWorkerDestroy })))

vi.mock('unpdf/pdfjs', () => ({
  getDocument: getPdfDocumentMock,
  PDFWorker: { create: createPdfWorkerMock },
}))

afterEach(async () => {
  await clearPdfPreviewRuntimeForTesting()
  getPdfDocumentMock.mockReset()
  createPdfWorkerMock.mockClear()
  pdfWorkerDestroy.mockReset()
  vi.unstubAllGlobals()
})

test('mounts long structured PDFs in bounded batches', () => {
  const pages = Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 页`)
  const rendered = render(<PdfDocumentSurface source={{ kind: 'pages', pages }} />)

  expect(rendered.container.querySelectorAll('.aa-pdf-document__page')).toHaveLength(8)
  fireEvent.click(screen.getByRole('button', { name: '继续加载后 8 页' }))
  expect(rendered.container.querySelectorAll('.aa-pdf-document__page')).toHaveLength(16)
})

test('uses a dedicated worker, limits concurrent page renders, and releases owned resources', async () => {
  const terminate = vi.fn()
  vi.stubGlobal('Worker', class {
    terminate = terminate
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)

  const pendingRenders: Array<{ readonly resolve: () => void; readonly cancel: ReturnType<typeof vi.fn> }> = []
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { readonly scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => {
      let resolve: () => void = () => {}
      const promise = new Promise<void>((done) => { resolve = done })
      const task = { promise, cancel: vi.fn() }
      pendingRenders.push({ resolve, cancel: task.cancel })
      return task
    },
    cleanup: vi.fn(),
  }))
  const destroy = vi.fn(async () => undefined)
  getPdfDocumentMock.mockReturnValue({
    promise: Promise.resolve({ numPages: 20, getPage, destroy }),
    destroy: vi.fn(async () => undefined),
  })

  const rendered = render(<PdfDocumentSurface source={{ kind: 'url', url: '/document.pdf' }} />)
  await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2))
  expect(createPdfWorkerMock).toHaveBeenCalledOnce()
  expect(getPdfDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
    url: '/document.pdf',
    worker: expect.any(Object),
  }))
  expect(rendered.container.querySelectorAll('.aa-pdf-document__page')).toHaveLength(8)

  pendingRenders[0]?.resolve()
  await waitFor(() => expect(getPage).toHaveBeenCalledTimes(3))

  rendered.unmount()
  await waitFor(() => expect(destroy).toHaveBeenCalledOnce())
  expect(pdfWorkerDestroy).toHaveBeenCalledOnce()
  expect(terminate).toHaveBeenCalledOnce()
})

test('cancels a document load when the preview closes before parsing completes', async () => {
  vi.stubGlobal('Worker', class {
    terminate() {}
  })
  const destroyLoadingTask = vi.fn(async () => undefined)
  getPdfDocumentMock.mockReturnValue({
    promise: new Promise(() => undefined),
    destroy: destroyLoadingTask,
  })

  const rendered = render(<PdfDocumentSurface source={{ kind: 'url', url: '/slow.pdf' }} />)
  await waitFor(() => expect(getPdfDocumentMock).toHaveBeenCalledOnce())
  rendered.unmount()
  await waitFor(() => expect(destroyLoadingTask).toHaveBeenCalledOnce())
})

test('uses a pre-rendered first page on the first commit without a loading state', async () => {
  vi.stubGlobal('Worker', class {
    terminate() {}
  })
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { readonly scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: renderPage,
    cleanup: vi.fn(),
  }))
  getPdfDocumentMock.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage, destroy: vi.fn(async () => undefined) }),
    destroy: vi.fn(async () => undefined),
  })
  const preview = {
    itemId: 'pdf-one',
    title: 'ready.pdf',
    sourceKind: 'local_file',
    source: 'C:/ready.pdf',
    status: 'ready',
    fingerprint: 'v1',
    byteLength: 1024,
    presentation: { kind: 'pdf', editable: false, sourceMode: false },
    content: { kind: 'media', mediaKind: 'pdf', mimeType: 'application/pdf', url: '/ready.pdf' },
  } satisfies DocumentPreview

  prefetchPdfPreview(preview)
  await waitFor(() => expect(renderPage).toHaveBeenCalledOnce())
  await Promise.resolve()
  const rendered = render(<PdfDocumentSurface source={{ kind: 'url', url: '/ready.pdf', byteLength: 1024, sourceVersion: 'v1' }} />)

  expect(screen.queryByText('正在读取 PDF...')).toBeNull()
  expect(rendered.container.querySelector('.aa-pdf-document__page')).not.toBeNull()
  expect(drawImage).toHaveBeenCalled()
})