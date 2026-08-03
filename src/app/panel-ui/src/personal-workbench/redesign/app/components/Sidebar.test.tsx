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
