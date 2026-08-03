import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ChatInputProps } from '../../../../contracts/composer'
import { ConversationPage } from './ConversationPage'

test('leaves conversation title and state ownership to the workbench top bar', () => {
  render(
    <ConversationPage
      scrollKey="conversation-1"
      content={<p>会话正文</p>}
      input={inputProps()}
    />,
  )

  expect(screen.queryByRole('heading')).toBeNull()
  expect(screen.getByText('会话正文')).toBeTruthy()
  expect(screen.queryByText('处理中')).toBeNull()
})

test('keeps the same scroll surface mounted while focus mode changes', () => {
  const input = inputProps()
  const { container, rerender } = render(
    <ConversationPage
      scrollKey="conversation-1"
      content={<p>会话正文</p>}
      input={input}
    />,
  )
  const scrollViewport = container.querySelector('[data-conversation-scroll="viewport"]')

  rerender(
    <ConversationPage
      scrollKey="conversation-1"
      content={<p>会话正文</p>}
      input={input}
      focus={{ title: '会话标题', state: 'completed', onExit: vi.fn() }}
    />,
  )

  expect(screen.getByRole('region', { name: '专注阅读' })).toBeTruthy()
  expect(container.querySelector('[data-conversation-scroll="viewport"]')).toBe(scrollViewport)
})

function inputProps(): ChatInputProps {
  return {
    value: '',
    onChange: vi.fn(),
    busy: false,
    models: [],
    selectedModelId: '',
    reasoningEffort: '',
    reasoningEffortEnabled: false,
    onReasoningEffortChange: vi.fn(),
    toolConfirmationPolicy: 'prompt',
    onToolConfirmationPolicyChange: vi.fn(),
    onModelSelect: vi.fn(),
    onOpenSettings: vi.fn(),
    onSubmit: vi.fn(),
    placeholder: '继续对话...',
    attachments: [],
    onSelectAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
  }
}
