import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TopBar } from './TopBar'

afterEach(() => {
  Object.defineProperty(window, 'agentarborDesktop', { configurable: true, value: undefined })
})

test('keeps global search as an accessible icon trigger', () => {
  const onSearch = vi.fn()

  render(
    <TopBar
      view="home"
      onNavigate={vi.fn()}
      onSearch={onSearch}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  const trigger = screen.getByRole('button', { name: '搜索内容与文件' })
  expect(trigger.classList.contains('topbar-search-trigger')).toBe(true)

  fireEvent.click(trigger)
  expect(onSearch).toHaveBeenCalledOnce()
})

test('does not render the search trigger on the search page', () => {
  render(
    <TopBar
      view="search"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.queryByRole('button', { name: '搜索内容与文件' })).toBeNull()
})

test('renders the active surface title supplied by the workbench', () => {
  render(
    <TopBar
      view="conv-active"
      surfaceTitle="当前真实会话"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.getByText('当前真实会话')).toBeTruthy()
  expect(screen.queryByText('关于机器学习的学习方法')).toBeNull()
})

test('connects frameless desktop window controls to the preload bridge', () => {
  const minimizeWindow = vi.fn()
  const toggleMaximizeWindow = vi.fn()
  const closeWindow = vi.fn()
  Object.defineProperty(window, 'agentarborDesktop', {
    configurable: true,
    value: {
      getWindowState: vi.fn().mockResolvedValue({ maximized: false, animating: false }),
      onWindowStateChanged: vi.fn(() => vi.fn()),
      minimizeWindow,
      toggleMaximizeWindow,
      closeWindow,
    },
  })

  render(
    <TopBar
      view="home"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))
  fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))

  expect(minimizeWindow).toHaveBeenCalledOnce()
  expect(toggleMaximizeWindow).toHaveBeenCalledOnce()
  expect(closeWindow).toHaveBeenCalledOnce()
})
