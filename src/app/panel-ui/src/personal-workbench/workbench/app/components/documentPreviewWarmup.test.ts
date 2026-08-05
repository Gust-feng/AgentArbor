import { afterEach, expect, test, vi } from 'vitest'

import type { DocumentPreview } from './referencePreviewClient'

const prefetchImage = vi.hoisted(() => vi.fn())
const prefetchOffice = vi.hoisted(() => vi.fn())
const prefetchPdf = vi.hoisted(() => vi.fn())
const prefetchVideo = vi.hoisted(() => vi.fn())

vi.mock('./imagePreviewRuntime', () => ({ prefetchImagePreview: prefetchImage }))
vi.mock('./officePreviewRuntime', () => ({ prefetchOfficePreview: prefetchOffice }))
vi.mock('./PdfDocumentSurface', () => ({ prefetchPdfPreview: prefetchPdf }))
vi.mock('./videoPreviewRuntime', () => ({ prefetchVideoPreview: prefetchVideo }))

import { prefetchDocumentSurface } from './documentPreviewWarmup'

afterEach(() => vi.clearAllMocks())

test.each([
  ['image', { kind: 'media', mediaKind: 'image', mimeType: 'image/jpeg', url: '/image.jpg' }, prefetchImage],
  ['pdf', { kind: 'media', mediaKind: 'pdf', mimeType: 'application/pdf', url: '/file.pdf' }, prefetchPdf],
  ['video', { kind: 'media', mediaKind: 'video', mimeType: 'video/mp4', url: '/video.mp4' }, prefetchVideo],
  ['docx', { kind: 'office', officeKind: 'docx', mimeType: 'application/docx', url: '/file.docx' }, prefetchOffice],
] as const)('routes %s startup work to its display-ready cache', (_kind, content, expectedPrefetch) => {
  const preview = {
    itemId: 'file-one',
    title: 'file',
    sourceKind: 'local_file',
    source: 'C:/file',
    status: 'ready',
    presentation: { kind: _kind, editable: false, sourceMode: false },
    content,
  } as DocumentPreview

  prefetchDocumentSurface(preview)

  expect(expectedPrefetch).toHaveBeenCalledWith(preview)
})
