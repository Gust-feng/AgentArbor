import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { DocxDocumentSurface } from './DocxDocumentSurface'
import { SpreadsheetDocumentSurface } from './SpreadsheetDocumentSurface'
import { loadDocxRenderer, loadOfficeDocument } from './officePreviewRuntime'
import { parseSpreadsheetWorkbook } from './spreadsheetPreviewWorkerClient'

vi.mock('./officePreviewRuntime', () => ({
  loadDocxRenderer: vi.fn(),
  loadOfficeDocument: vi.fn(),
}))
vi.mock('./spreadsheetPreviewWorkerClient', () => ({
  parseSpreadsheetWorkbook: vi.fn(),
}))

const loadDocument = vi.mocked(loadOfficeDocument)
const loadRenderer = vi.mocked(loadDocxRenderer)
const parseWorkbook = vi.mocked(parseSpreadsheetWorkbook)

afterEach(() => {
  vi.clearAllMocks()
})

test('renders DOCX with layout-preserving read-only options and clears it on unmount', async () => {
  const renderAsync = vi.fn(async (_source: Blob, body: HTMLElement) => {
    body.textContent = 'Rendered Word content'
  })
  loadDocument.mockResolvedValue(new Blob(['docx']))
  loadRenderer.mockResolvedValue({ renderAsync } as unknown as Awaited<ReturnType<typeof loadDocxRenderer>>)

  const rendered = render(<DocxDocumentSurface url="/document.docx" byteLength={4} sourceVersion="v1" />)
  expect(await screen.findByText('Rendered Word content')).toBeTruthy()
  expect(renderAsync).toHaveBeenCalledWith(
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
  const body = rendered.container.querySelector('.aa-docx-document__body')
  rendered.unmount()
  expect(body?.childNodes).toHaveLength(0)
})

test('reports DOCX load failures and aborts the pending document request on unmount', async () => {
  let requestSignal: AbortSignal | undefined
  loadDocument.mockImplementation(({ signal }) => {
    requestSignal = signal
    return Promise.reject(new Error('文档损坏'))
  })
  loadRenderer.mockResolvedValue({ renderAsync: vi.fn() } as unknown as Awaited<ReturnType<typeof loadDocxRenderer>>)

  const rendered = render(<DocxDocumentSurface url="/broken.docx" />)
  expect((await screen.findByRole('alert')).textContent).toContain('文档损坏')
  rendered.unmount()
  expect(requestSignal?.aborted).toBe(true)
})

test('switches XLSX sheets and expands rows in bounded batches', async () => {
  const firstSheet = Array.from({ length: 121 }, (_, index) => [`Row ${index + 1}`, index + 1])
  loadDocument.mockResolvedValue(new Blob(['xlsx']))
  parseWorkbook.mockResolvedValue([
    { sheet: 'Overview', data: firstSheet },
    { sheet: 'Details', data: [['Name', 'Value'], ['Alpha', 42]] },
    { sheet: 'Wide', data: [Array.from({ length: 41 }, (_, index) => `Column ${index + 1}`)] },
  ])

  render(<SpreadsheetDocumentSurface url="/workbook.xlsx" byteLength={4} sourceVersion="v1" />)
  expect(await screen.findByRole('tab', { name: 'Overview' })).toBeTruthy()
  expect(screen.getByText('Row 120')).toBeTruthy()
  expect(screen.queryByText('Row 121')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '继续显示行' }))
  expect(screen.getByText('Row 121')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
  expect(screen.getByText('Alpha')).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Details 工作表' })).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Wide' }))
  expect(screen.getByText('Column 40')).toBeTruthy()
  expect(screen.queryByText('Column 41')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '继续显示列' }))
  expect(screen.getByText('Column 41')).toBeTruthy()
})

test('aborts XLSX parsing when the preview closes', async () => {
  let parseSignal: AbortSignal | undefined
  loadDocument.mockResolvedValue(new Blob(['xlsx']))
  parseWorkbook.mockImplementation((_source, signal) => {
    parseSignal = signal
    return new Promise(() => undefined)
  })

  const rendered = render(<SpreadsheetDocumentSurface url="/workbook.xlsx" />)
  await waitFor(() => expect(parseSignal).toBeDefined())
  rendered.unmount()
  expect(parseSignal?.aborted).toBe(true)
})
