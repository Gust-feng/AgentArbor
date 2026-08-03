import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { FocusModeHeader } from './FocusMode'

afterEach(() => {
  Object.defineProperty(window, 'agentarborDesktop', { configurable: true, value: undefined })
})

test('shows only conversation states that still need attention', () => {
  const props = {
    title: '会话标题',
    onExit: vi.fn(),
  }
  const { rerender } = render(<FocusModeHeader {...props} state="failed" />)

  expect(screen.queryByText('未完成')).toBeNull()

  rerender(<FocusModeHeader {...props} state="attention" />)
  expect(screen.getByText('需要确认')).toBeTruthy()

  rerender(<FocusModeHeader {...props} state="working" />)
  expect(screen.getByText('处理中')).toBeTruthy()
})

test('keeps frameless window controls inside the focus header', () => {
  Object.defineProperty(window, 'agentarborDesktop', {
    configurable: true,
    value: {
      getWindowState: vi.fn().mockResolvedValue({ maximized: false, animating: false }),
      onWindowStateChanged: vi.fn(() => vi.fn()),
      minimizeWindow: vi.fn(),
      toggleMaximizeWindow: vi.fn(),
      closeWindow: vi.fn(),
    },
  })

  const rendered = render(
    <FocusModeHeader title="会话标题" state="initial" onExit={vi.fn()} />,
  )

  expect(rendered.container.querySelector('[data-desktop-drag-region]')).not.toBeNull()
  expect(screen.getByRole('button', { name: '最小化窗口' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '最大化窗口' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '关闭窗口' })).toBeTruthy()
})
