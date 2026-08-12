import { afterEach, expect, test, vi } from 'vitest'

const renderDocx = vi.hoisted(() => vi.fn())
const parseSpreadsheet = vi.hoisted(() => vi.fn())

vi.mock('docx-preview', () => ({ renderAsync: renderDocx }))
vi.mock('./spreadsheetPreviewWorkerClient', () => ({
  parseSpreadsheetWorkbook: parseSpreadsheet,
  warmSpreadsheetPreviewWorker: vi.fn(),
}))

import {
  clearOfficePreviewRuntimeForTesting,
  getCachedDocxPreviewMarkup,
  getCachedSpreadsheetPreview,
  loadDocxPreviewMarkup,
  loadOfficeDocument,
  loadSpreadsheetPreview,
} from './officePreviewRuntime'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  renderDocx.mockReset()
  parseSpreadsheet.mockReset()
  clearOfficePreviewRuntimeForTesting()
})

test('keys the bounded Office binary cache by source fingerprint', async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(['office'])))
  vi.stubGlobal('fetch', fetchMock)
  const url = `/versioned-${crypto.randomUUID()}.docx`

  await loadOfficeDocument({ url, byteLength: 6, sourceVersion: 'v1', signal: new AbortController().signal })
  await loadOfficeDocument({ url, byteLength: 6, sourceVersion: 'v1', signal: new AbortController().signal })
  await loadOfficeDocument({ url, byteLength: 6, sourceVersion: 'v2', signal: new AbortController().signal })

  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('renders and caches DOCX markup before the document surface mounts', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['docx']))))
  renderDocx.mockImplementation(async (_source: Blob, body: HTMLElement, styles: HTMLElement) => {
    body.innerHTML = '<p>Warm Word document</p>'
    styles.innerHTML = '<style>.aa-docx { color: black; }</style>'
  })

  const markup = await loadDocxPreviewMarkup({
    url: '/warm.docx',
    byteLength: 4,
    sourceVersion: 'v1',
    signal: new AbortController().signal,
  })

  expect(markup.bodyHtml).toContain('Warm Word document')
  expect(getCachedDocxPreviewMarkup('/warm.docx', 'v1')).toEqual(markup)
  expect(renderDocx).toHaveBeenCalledWith(
    expect.any(Blob),
    expect.any(HTMLElement),
    expect.any(HTMLElement),
    expect.objectContaining({
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderAltChunks: false,
    }),
  )
})

test('parses and caches a workbook before the spreadsheet surface mounts', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['xlsx']))))
  const workbook = [{ sheet: 'Ready', data: [['Warm workbook']] }]
  parseSpreadsheet.mockResolvedValue(workbook)

  await loadSpreadsheetPreview({
    url: '/warm.xlsx',
    byteLength: 4,
    sourceVersion: 'v1',
    signal: new AbortController().signal,
  })

  expect(getCachedSpreadsheetPreview('/warm.xlsx', 'v1')).toEqual(workbook)
  expect(parseSpreadsheet).toHaveBeenCalledOnce()
})