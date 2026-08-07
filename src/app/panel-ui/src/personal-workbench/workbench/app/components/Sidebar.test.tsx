import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Sidebar } from './Sidebar'

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

  expect(screen.queryByText('张明')).toBeNull()
  expect(screen.queryByText('张')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
  expect(onOpenSettings).toHaveBeenCalledOnce()
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

  fireEvent.mouseEnter(screen.getByRole('button', { name: /^项目空间/u }))
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }))

  expect(screen.getByRole('button', { name: '重命名' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
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

  fireEvent.click(screen.getByRole('button', { name: /^Rust 学习$/u }))
  expect(onOpenConversation).toHaveBeenCalledWith('conversation-1')
})
