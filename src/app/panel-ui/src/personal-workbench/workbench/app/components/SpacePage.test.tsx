import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { SpacePage } from './SpacePage'
import { resetPersonalKnowledgeForTesting } from './personalKnowledgeClient'
import type { PersonalSpaceProjection } from '../../../space'

beforeEach(() => {
  resetPersonalKnowledgeForTesting({
    notes: [{
      id: 'fallback-note',
      spaceId: 'space-study',
      title: '切换中的笔记',
      bodyMarkdown: 'fallback-note-body',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }],
  })
})

test('keeps the conversation surface mounted while an async Space switch is pending', async () => {
  const user = userEvent.setup()
  let finishOpen!: (opened: boolean) => void
  const pendingOpen = new Promise<boolean>((resolve) => { finishOpen = resolve })
  const onOpenConversation = vi.fn<(conversationId: string) => Promise<boolean>>(() => pendingOpen)
  const space: PersonalSpaceProjection = {
    spaceId: 'space-study',
    title: '学习空间',
    items: [],
    conversations: [
      { conversationId: 'conversation-old', title: '旧会话' },
      { conversationId: 'conversation-next', title: '新会话' },
    ],
  }

  function ControlledSpacePage() {
    const [activeConversationId, setActiveConversationId] = useState('conversation-old')
    return (
      <SpacePage
        onNavigate={vi.fn()}
        space={space}
        activeConversationId={activeConversationId}
        conversationContent={<div>{activeConversationId === 'conversation-old' ? '旧会话内容' : '新会话内容'}</div>}
        onOpenConversation={(conversationId) => {
          setActiveConversationId(conversationId)
          return onOpenConversation(conversationId)
        }}
      />
    )
  }

  render(<ControlledSpacePage />)
  expect(screen.getByText('旧会话内容')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: '新会话' }))

  expect(onOpenConversation).toHaveBeenCalledWith('conversation-next')
  expect(screen.getByText('新会话内容')).toBeTruthy()
  expect(screen.queryByText('fallback-note-body')).toBeNull()

  finishOpen(true)
})

test('offers the existing focus mode from the space conversation pane', async () => {
  const user = userEvent.setup()
  const onEnterFocus = vi.fn()
  const space: PersonalSpaceProjection = {
    spaceId: 'space-study',
    title: '学习空间',
    items: [],
    conversations: [{ conversationId: 'conversation-current', title: '当前会话' }],
  }

  render(
    <SpacePage
      onNavigate={vi.fn()}
      space={space}
      activeConversationId="conversation-current"
      conversationContent={<div>会话内容</div>}
      onEnterFocus={onEnterFocus}
    />,
  )

  await user.click(screen.getByRole('button', { name: '专注阅读' }))

  expect(onEnterFocus).toHaveBeenCalledOnce()
})

test('disables native spell checking while renaming a Space item', async () => {
  const user = userEvent.setup()
  const space: PersonalSpaceProjection = {
    spaceId: 'space-study',
    title: '学习空间',
    items: [{
      itemId: 'reference-image',
      title: 'entArbor_icon_256x256.png',
      kind: 'local_file',
    }],
    conversations: [],
  }

  render(
    <SpacePage
      onNavigate={vi.fn()}
      space={space}
      actions={{ rename: vi.fn() }}
    />,
  )

  await user.hover(screen.getByText('entArbor_icon_256x256.png'))
  fireEvent.click(screen.getByRole('button', { name: 'entArbor_icon_256x256.png操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))

  expect(screen.getByRole('textbox', { name: '重命名entArbor_icon_256x256.png' }).getAttribute('spellcheck')).toBe('false')
})
