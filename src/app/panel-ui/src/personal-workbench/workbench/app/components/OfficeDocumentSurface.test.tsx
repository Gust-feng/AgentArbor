import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { DocxDocumentSurface } from './DocxDocumentSurface'
import { SpreadsheetDocumentSurface } from './SpreadsheetDocumentSurface'
import {
  getCachedDocxPreviewMarkup,
  getCachedSpreadsheetPreview,
  loadDocxPreviewMarkup,
  loadSpreadsheetPreview,
} from './officePreviewRuntime'

vi.mock('./officePreviewRuntime', () => ({
  getCachedDocxPreviewMarkup: vi.fn(),
  getCachedSpreadsheetPreview: vi.fn(),
  loadDocxPreviewMarkup: vi.fn(),
  loadSpreadsheetPreview: vi.fn(),
}))

const getCachedDocx = vi.mocked(getCachedDocxPreviewMarkup)
const getCachedSpreadsheet = vi.mocked(getCachedSpreadsheetPreview)
const loadDocx = vi.mocked(loadDocxPreviewMarkup)
const loadSpreadsheet = vi.mocked(loadSpreadsheetPreview)

afterEach(() => {
  vi.clearAllMocks()
})

test('renders a cached DOCX on the first commit without a loading state', () => {
  getCachedDocx.mockReturnValue({
    bodyHtml: '<p>Rendered Word content</p>',
    styleHtml: '<style>.aa-docx { color: black; }</style>',
  })

  const rendered = render(<DocxDocumentSurface url="/document.docx" byteLength={4} sourceVersion="v1" />)
  expect(screen.getByText('Rendered Word content')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  expect(rendered.container.querySelectorAll('.aa-docx-document__styles')).toHaveLength(1)
  expect(loadDocx).not.toHaveBeenCalled()
})

test('reports DOCX load failures and aborts the pending document request on unmount', async () => {
  let requestSignal: AbortSignal | undefined
  getCachedDocx.mockReturnValue(undefined)
  loadDocx.mockImplementation(({ signal }) => {
    requestSignal = signal
    return Promise.reject(new Error('文档损坏'))
  })

  const rendered = render(<DocxDocumentSurface url="/broken.docx" />)
  expect((await screen.findByRole('alert')).textContent).toContain('文档损坏')
  rendered.unmount()
  expect(requestSignal?.aborted).toBe(true)
})

test('switches XLSX sheets and expands rows in bounded batches', async () => {
  const firstSheet = Array.from({ length: 121 }, (_, index) => [`Row ${index + 1}`, index + 1])
  getCachedSpreadsheet.mockReturnValue(undefined)
  loadSpreadsheet.mockResolvedValue([
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
  let requestSignal: AbortSignal | undefined
  getCachedSpreadsheet.mockReturnValue(undefined)
  loadSpreadsheet.mockImplementation(({ signal }) => {
    requestSignal = signal
    return new Promise(() => undefined)
  })

  const rendered = render(<SpreadsheetDocumentSurface url="/workbook.xlsx" />)
  await waitFor(() => expect(requestSignal).toBeDefined())
  rendered.unmount()
  expect(requestSignal?.aborted).toBe(true)
})

test('renders a cached workbook on the first commit without a loading state', () => {
  getCachedSpreadsheet.mockReturnValue([{ sheet: 'Ready', data: [['Warm workbook']] }])

  render(<SpreadsheetDocumentSurface url="/ready.xlsx" byteLength={4} sourceVersion="v1" />)

  expect(screen.getByText('Warm workbook')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  expect(loadSpreadsheet).not.toHaveBeenCalled()
})