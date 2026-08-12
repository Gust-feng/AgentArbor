import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Sidebar } from './Sidebar'

test('exposes memory as an independent sidebar destination', () => {
  const onNavigate = vi.fn()
  render(
    <Sidebar
      view="home"
      onNavigate={onNavigate}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[]}
      spaces={[]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: '记忆' }))
  expect(onNavigate).toHaveBeenCalledWith('memory')
})

test('offers settings without presenting a fabricated account identity', () => {
  const onOpenSettings = vi.fn()
  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={onOpenSettings}
      collapsed={false}
      conversations={[]}
      spaces={[]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  expect(screen.getByText('设置')).toBeTruthy()
  expect(screen.queryByText('AgentArbor')).toBeNull()
  expect(screen.queryByText('本机工作台')).toBeNull()
  expect(screen.queryByText('张明')).toBeNull()
  expect(screen.queryByText('张')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '设置与外观' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '打开设置' }))
  expect(onOpenSettings).toHaveBeenCalledOnce()
})

test('keeps the footer compact and provides light, dark, and system theme controls', () => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-style')
  document.documentElement.removeAttribute('data-color')
  document.documentElement.removeAttribute('data-color-preference')

  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[]}
      spaces={[]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: '设置与外观' }))
  expect(screen.getByRole('menu', { name: '设置与外观' })).toBeTruthy()

  fireEvent.click(screen.getByRole('menuitemradio', { name: /深色/u }))
  expect(document.documentElement.getAttribute('data-style')).toBe('default')
  expect(document.documentElement.getAttribute('data-color')).toBe('dark')
  expect(document.documentElement.getAttribute('data-color-preference')).toBe('dark')

  fireEvent.click(screen.getByRole('button', { name: '设置与外观' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /跟随系统/u }))
  expect(document.documentElement.getAttribute('data-color-preference')).toBe('system')
  expect(window.localStorage.getItem('agentarbor:color')).toBe('system')
})

test('shows a static icon before the Space section without a management action', () => {
  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[]}
      spaces={[{ spaceId: 'space-1', title: '学习空间', color: '#a8c4b4', items: [] }]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  const spaceLabel = screen.getByText('空间')
  expect(spaceLabel.previousElementSibling?.querySelector('svg')).not.toBeNull()
  expect(screen.queryByRole('button', { name: '管理空间' })).toBeNull()
  expect(screen.queryByText('管理空间')).toBeNull()
})

test('offers rename and an in-workbench confirmation for Space deletion', () => {
  const onDeleteSpace = vi.fn()
  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[]}
      spaces={[{ spaceId: 'space-project', title: '项目空间', items: [] }]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
      onRenameSpace={vi.fn()}
      onDeleteSpace={onDeleteSpace}
    />,
  )

  fireEvent.mouseEnter(screen.getByRole('button', { name: '项目空间' }))
  fireEvent.click(screen.getByRole('button', { name: '项目空间操作' }))

  expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
  expect(screen.getByRole('alertdialog', { name: '删除空间“项目空间”' })).toBeTruthy()
  expect(screen.getByText('原文件、文件夹和对话不会被删除。')).toBeTruthy()
  expect(onDeleteSpace).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '删除空间' }))
  expect(onDeleteSpace).toHaveBeenCalledWith('space-project')
})

test('expands a Workspace row to reveal its owned conversations', () => {
  const onOpenConversation = vi.fn()
  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[
        { conversationId: 'conversation-1', title: 'Rust 学习', owner: { kind: 'workspace', id: 'workspace-1' } },
        { conversationId: 'conversation-2', title: '整理笔记', owner: { kind: 'workspace', id: 'workspace-1' } },
      ]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      onOpenConversation={onOpenConversation}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  expect(screen.queryByText('Rust 学习')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^AgentArbor$/u }))
  expect(screen.getByText('Rust 学习')).toBeTruthy()
  expect(screen.getByText('整理笔记')).toBeTruthy()
  expect(screen.queryByRole('img', { name: '处理中' })).toBeNull()
  expect(screen.queryByRole('img', { name: '已完成' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /^Rust 学习$/u }))
  expect(onOpenConversation).toHaveBeenCalledWith('conversation-1')
})

test('navigates as soon as the requested conversation becomes active', () => {
  let finishOpen!: (opened: boolean) => void
  const pendingOpen = new Promise<boolean>((resolve) => { finishOpen = resolve })
  const onOpenConversation = vi.fn(() => pendingOpen)
  const onNavigate = vi.fn()
  const { rerender } = render(
    <Sidebar
      view="space"
      onNavigate={onNavigate}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[{ conversationId: 'conversation-1', title: 'Rust 学习', owner: { kind: 'workspace', id: 'workspace-1' } }]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      activeConversationId="conversation-old"
      onOpenConversation={onOpenConversation}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /^AgentArbor$/u }))
  fireEvent.click(screen.getByRole('button', { name: /^Rust 学习$/u }))
  expect(onNavigate).not.toHaveBeenCalled()

  rerender(
    <Sidebar
      view="space"
      onNavigate={onNavigate}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[{ conversationId: 'conversation-1', title: 'Rust 学习', owner: { kind: 'workspace', id: 'workspace-1' } }]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      activeConversationId="conversation-1"
      onOpenConversation={onOpenConversation}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  expect(onNavigate).toHaveBeenCalledWith('space')
  finishOpen(true)
})

test('ignores a stale sidebar conversation open after a newer click', async () => {
  let finishFirst!: (opened: boolean) => void
  let finishSecond!: (opened: boolean) => void
  const firstOpen = new Promise<boolean>((resolve) => { finishFirst = resolve })
  const secondOpen = new Promise<boolean>((resolve) => { finishSecond = resolve })
  const onOpenConversation = vi.fn((conversationId: string) => (
    conversationId === 'conversation-first' ? firstOpen : secondOpen
  ))
  const onNavigate = vi.fn()
  render(
    <Sidebar
      view="home"
      onNavigate={onNavigate}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[
        { conversationId: 'conversation-first', title: '第一个会话', owner: { kind: 'workspace', id: 'workspace-1' } },
        { conversationId: 'conversation-second', title: '第二个会话', owner: { kind: 'workspace', id: 'workspace-1' } },
      ]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      onOpenConversation={onOpenConversation}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /^AgentArbor$/u }))
  fireEvent.click(screen.getByRole('button', { name: '第一个会话' }))
  fireEvent.click(screen.getByRole('button', { name: '第二个会话' }))

  await act(async () => { finishFirst(true) })
  expect(onNavigate).not.toHaveBeenCalled()
  await act(async () => { finishSecond(true) })
  expect(onNavigate).toHaveBeenCalledWith('space')
})

test('shows run status markers on owned conversations: spinning, waiting, failed, done', () => {
  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[
        { conversationId: 'running-1', title: '正在整理', owner: { kind: 'workspace', id: 'workspace-1' }, status: 'running' },
        { conversationId: 'queued-1', title: '排队等待', owner: { kind: 'workspace', id: 'workspace-1' }, queuedRunCount: 1 },
        { conversationId: 'waiting-1', title: '等待确认', owner: { kind: 'workspace', id: 'workspace-1' }, status: 'approval_needed' },
        { conversationId: 'failed-1', title: '失败任务', owner: { kind: 'workspace', id: 'workspace-1' }, status: 'failed' },
        { conversationId: 'done-1', title: '完成对话', owner: { kind: 'workspace', id: 'workspace-1' }, status: 'completed' },
        { conversationId: 'quiet-1', title: '安静会话', owner: { kind: 'workspace', id: 'workspace-1' }, status: 'idle' },
      ]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /^AgentArbor$/u }))

  expect(screen.getByRole('img', { name: '处理中' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '排队中' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '需要确认' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '运行失败' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '已完成' })).toBeTruthy()
  // idle 会话不显示任何标志，全部标志恰好覆盖 5 个有状态的会话。
  expect(screen.queryAllByRole('img')).toHaveLength(5)
})

test('offers a confirmation flow for removing a Workspace without deleting external data', () => {
  const onDeleteWorkspace = vi.fn()
  render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      onOpenConversation={() => true}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
      onDeleteWorkspace={onDeleteWorkspace}
    />,
  )

  fireEvent.mouseEnter(screen.getByRole('button', { name: /^AgentArbor$/u }))
  fireEvent.click(screen.getByRole('button', { name: 'AgentArbor操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '移除工作区' }))

  expect(screen.getByRole('alertdialog', { name: '移除工作区“AgentArbor”' })).toBeTruthy()
  expect(screen.getByText('电脑上的文件夹和知识副本不会被删除。')).toBeTruthy()
  expect(onDeleteWorkspace).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '移除工作区' }))
  expect(onDeleteWorkspace).toHaveBeenCalledWith('workspace-1')
})

test('separates pinned workspace conversations from the rest with a divider', () => {
  const { container } = render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[
        { conversationId: 'pinned-1', title: '置顶会话', owner: { kind: 'workspace', id: 'workspace-1' }, pinnedAt: '2026-07-29T12:00:00.000Z' },
        { conversationId: 'plain-1', title: '普通会话', owner: { kind: 'workspace', id: 'workspace-1' }, updatedAt: '2026-07-30T12:00:00.000Z' },
      ]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      onOpenConversation={vi.fn()}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /^AgentArbor$/u }))
  const pinnedRow = screen.getByRole('button', { name: '置顶会话' })
  const plainRow = screen.getByRole('button', { name: '普通会话' })
  expect(pinnedRow.compareDocumentPosition(plainRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const divider = container.querySelector('.aa-conversation-divider')
  expect(divider).toBeTruthy()
  expect(pinnedRow.compareDocumentPosition(divider!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(divider!.compareDocumentPosition(plainRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('keeps a single conversation group without a divider', () => {
  const { container } = render(
    <Sidebar
      view="home"
      onNavigate={vi.fn()}
      onOpenSettings={vi.fn()}
      collapsed={false}
      conversations={[
        { conversationId: 'pinned-1', title: '置顶会话', owner: { kind: 'workspace', id: 'workspace-1' }, pinnedAt: '2026-07-29T12:00:00.000Z' },
      ]}
      spaces={[]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      activeSpaceId={null}
      onOpenConversation={vi.fn()}
      pendingConversationIds={new Set()}
      onRenameConversation={vi.fn()}
      onToggleConversationPinned={vi.fn()}
      onDeleteConversation={vi.fn()}
      onActiveSpaceChange={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /^AgentArbor$/u }))
  expect(container.querySelector('.aa-conversation-divider')).toBeNull()
})
