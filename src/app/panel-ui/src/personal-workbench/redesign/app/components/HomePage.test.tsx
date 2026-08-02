import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ChatInputProps } from '../../../../components/chat-empty'
import type { ConversationSummary } from '../../../../contracts/conversation'
import { HomePage } from './HomePage'
import { selectHomeAmbientCopy } from './home-ambient-copy'

afterEach(() => {
  vi.useRealTimers()
})

test('presents one stable ambient line with the quiet task entry', () => {
  const now = new Date(2026, 7, 3, 1, 30)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const onSelectWorkspaceDirectory = vi.fn()
  render(
    <HomePage
      onNavigate={vi.fn()}
      onOpenConversation={() => true}
      conversations={[]}
      input={inputProps({
        selectedWorkspaceDirectory: 'Z:\\AgentArbor',
        onSelectWorkspaceDirectory,
      })}
      focusRequest={0}
    />,
  )

  expect(screen.getByRole('region', { name: '开始任务' })).toBeTruthy()
  expect(screen.getByText(selectHomeAmbientCopy(now))).toBeTruthy()
  expect(screen.getByPlaceholderText('想从哪里开始？')).toBeTruthy()
  expect(screen.getByRole('button', { name: '切换工作区：Z:\\AgentArbor' }).textContent).toContain('AgentArbor')
  expect(screen.queryByRole('heading')).toBeNull()
  expect(screen.queryByLabelText('AgentArbor Agent')).toBeNull()
})

test('does not repeat conversation history on the task entry surface', () => {
  const conversations: ConversationSummary[] = [
    {
      conversationId: 'running',
      title: '重构工具边界',
      currentAction: '正在运行相关测试',
      activeRunId: 'run-1',
      updatedAt: '2026-07-30T12:00:00.000Z',
    },
    {
      conversationId: 'attention',
      title: '更新模型配置',
      nextStep: '确认配置写入',
      requiresUserAction: true,
      updatedAt: '2026-07-29T12:00:00.000Z',
    },
  ]

  render(
    <HomePage
      onNavigate={vi.fn()}
      onOpenConversation={vi.fn()}
      conversations={conversations}
      input={inputProps()}
      focusRequest={0}
    />,
  )

  expect(screen.queryByText('继续工作')).toBeNull()
  expect(screen.queryByText('重构工具边界')).toBeNull()
  expect(screen.queryByText('更新模型配置')).toBeNull()
})

function inputProps(overrides: Partial<ChatInputProps> = {}): ChatInputProps {
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
    placeholder: '想从哪里开始？',
    attachments: [],
    onSelectAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    ...overrides,
  }
}
