import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TopBar } from './TopBar'

const originalNavigatorPlatform = window.navigator.platform

afterEach(() => {
  Object.defineProperty(window, 'agentarborDesktop', { configurable: true, value: undefined })
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: originalNavigatorPlatform })
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
  expect(screen.queryByRole('button', { name: '返回首页' })).toBeNull()

  fireEvent.click(trigger)
  expect(onSearch).toHaveBeenCalledOnce()
})

test.each([
  ['Win32', 'Ctrl K'],
  ['MacIntel', '⌘K'],
])('shows the search shortcut for %s', (platform, shortcut) => {
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: platform })

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

  expect(screen.getByText(shortcut)).toBeTruthy()
  expect(screen.getByRole('button', { name: '搜索内容与文件' }).getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K')
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
  const onEnterFocus = vi.fn()
  render(
    <TopBar
      view="conv-active"
      surfaceTitle="当前真实会话"
      conversationState="working"
      onEnterFocus={onEnterFocus}
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.getByText('当前真实会话')).toBeTruthy()
  expect(screen.getByText('处理中')).toBeTruthy()
  expect(screen.queryByText('关于机器学习的学习方法')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '专注阅读' }))
  expect(onEnterFocus).toHaveBeenCalledOnce()
})

test('keeps the conversation chrome stable while focus mode owns the surface', () => {
  render(
    <TopBar
      view="conv-active"
      surfaceTitle="当前真实会话"
      conversationState="working"
      onEnterFocus={vi.fn()}
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.getByText('当前真实会话')).toBeTruthy()
  expect(screen.getByText('处理中')).toBeTruthy()
  expect(screen.queryByText('首页')).toBeNull()
  expect(screen.getByRole('button', { name: '专注阅读' })).toBeTruthy()
})

test('shows the running conversation status on non-conversation views without forcing navigation', () => {
  render(
    <TopBar
      view="home"
      conversationState="working"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.getByText('处理中')).toBeTruthy()
})

test('shows the pending confirmation status on non-conversation views without forcing navigation', () => {
  render(
    <TopBar
      view="brain"
      conversationState="attention"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.getByText('需要确认')).toBeTruthy()
})

test('keeps terminal conversation outcomes out of the top bar', () => {
  const { rerender } = render(
    <TopBar
      view="conv-done"
      surfaceTitle="已结束会话"
      conversationState="failed"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.queryByText('未完成')).toBeNull()

  rerender(
    <TopBar
      view="conv-done"
      surfaceTitle="已结束会话"
      conversationState="completed"
      onNavigate={vi.fn()}
      onSearch={vi.fn()}
      sidebarCollapsed={false}
      onToggleSidebar={vi.fn()}
      brainFileTitle={null}
      onBrainRoot={vi.fn()}
    />,
  )

  expect(screen.queryByText('已完成')).toBeNull()
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

  const rendered = render(
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

  expect(rendered.container.querySelector('[data-desktop-drag-region]')).not.toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }))
  fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }))

  expect(minimizeWindow).toHaveBeenCalledOnce()
  expect(toggleMaximizeWindow).toHaveBeenCalledOnce()
  expect(closeWindow).toHaveBeenCalledOnce()
})
