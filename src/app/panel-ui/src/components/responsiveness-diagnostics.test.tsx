import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import {
  clearResponsivenessIncidents,
  getResponsivenessIncidents,
  pushResponsivenessContext,
  recordResponsivenessIncident,
  startPanelResponsivenessDiagnostics,
} from '../app-responsiveness-diagnostics'
import { ResponsivenessDiagnostics } from './responsiveness-diagnostics'

afterEach(() => {
  clearResponsivenessIncidents()
  vi.unstubAllGlobals()
})

test('records only long tasks and associates the active workbench context', () => {
  let callback: PerformanceObserverCallback | undefined
  vi.stubGlobal('PerformanceObserver', class {
    constructor(next: PerformanceObserverCallback) { callback = next }
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  })
  const releaseContext = pushResponsivenessContext('PDF preview (40 pages)')
  const stop = startPanelResponsivenessDiagnostics()

  callback?.({
    getEntries: () => [
      { duration: 80 } as PerformanceEntry,
      { duration: 180 } as PerformanceEntry,
    ],
  } as PerformanceObserverEntryList, {} as PerformanceObserver)

  expect(getResponsivenessIncidents()).toHaveLength(1)
  expect(getResponsivenessIncidents()[0]).toMatchObject({ durationMs: 180, context: 'PDF preview (40 pages)' })
  releaseContext()
  stop()
})

test('shows and clears local responsiveness incidents', () => {
  recordResponsivenessIncident(240, '知识库')
  render(<ResponsivenessDiagnostics />)

  expect(screen.getByText('知识库')).toBeTruthy()
  expect(screen.getByText('240ms')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清空界面响应记录' }))
  expect(screen.getByText('当前没有检测到超过 100ms 的界面阻塞。')).toBeTruthy()
})
