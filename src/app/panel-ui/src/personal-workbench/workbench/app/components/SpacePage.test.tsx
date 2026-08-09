import React, { useState } from 'react'
import { render, screen } from '@testing-library/react'
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
