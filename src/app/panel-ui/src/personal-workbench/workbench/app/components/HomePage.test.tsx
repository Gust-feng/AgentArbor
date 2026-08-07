import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ChatInputProps } from '../../../../contracts/composer'
import type { ConversationSummary } from '../../../../contracts/conversation'
import { HomePage } from './HomePage'
import { selectHomeAmbientCopy } from './home-ambient-copy'
import { HOME_AMBIENT_COPY_INPUT_DELAY_MS } from './HomeAmbientCopy'

afterEach(() => {
  vi.useRealTimers()
})

test('presents one stable ambient line with the quiet task entry', () => {
  const now = new Date(2026, 7, 3, 1, 30)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  render(
    <HomePage
      onNavigate={vi.fn()}
      onOpenConversation={() => true}
      conversations={[]}
      input={inputProps()}
      focusRequest={0}
    />,
  )

  expect(screen.getByRole('region', { name: '开始任务' })).toBeTruthy()
  const copy = selectHomeAmbientCopy(now)
  expect(screen.getByLabelText(`${copy.lead}${copy.idleTail}`)).toBeTruthy()
  expect(screen.getByPlaceholderText('想从哪里开始？')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /工作区/u })).toBeNull()
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

test('hides context usage until the task entry becomes a conversation', () => {
  render(
    <HomePage
      onNavigate={vi.fn()}
      onOpenConversation={vi.fn()}
      conversations={[]}
      input={inputProps({
        contextUsage: {
          source: 'provider_usage',
          usedTokens: 1,
          maxTokens: 100,
          percent: 1,
          ringPercent: 1,
          tone: 'normal',
          label: '上下文已用 1%',
        },
      })}
      focusRequest={0}
    />,
  )

  expect(screen.queryByRole('progressbar', { name: '上下文已用 1%' })).toBeNull()
})

test('enters the working state only after non-whitespace input', () => {
  vi.useFakeTimers()
  const props = {
    onNavigate: vi.fn(),
    onOpenConversation: vi.fn(),
    conversations: [] as ConversationSummary[],
    focusRequest: 0,
  }
  const { container, rerender } = render(
    <HomePage {...props} input={inputProps()} />,
  )
  const home = container.querySelector('.aa-agent-home')
  const ambient = container.querySelector('.aa-agent-home__ambient')
  const textarea = screen.getByPlaceholderText('想从哪里开始？')

  fireEvent.focus(textarea)
  expect(ambient?.getAttribute('data-state')).toBe('idle')

  rerender(<HomePage {...props} input={inputProps({ value: '   ' })} />)
  expect(ambient?.getAttribute('data-state')).toBe('idle')

  rerender(<HomePage {...props} input={inputProps({ value: '整理当前任务' })} />)
  expect(home?.hasAttribute('data-has-draft')).toBe(false)
  expect(ambient?.getAttribute('data-state')).toBe('idle')

  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS - 1))
  expect(ambient?.getAttribute('data-state')).toBe('idle')

  act(() => vi.advanceTimersByTime(1))
  expect(ambient?.getAttribute('data-state')).toBe('active')
})

test('waits for Chinese input to be committed before entering the working state', () => {
  vi.useFakeTimers()
  const props = {
    onNavigate: vi.fn(),
    onOpenConversation: vi.fn(),
    conversations: [] as ConversationSummary[],
    focusRequest: 0,
  }
  const { container, rerender } = render(
    <HomePage {...props} input={inputProps()} />,
  )
  const textarea = screen.getByPlaceholderText('想从哪里开始？')
  const ambient = container.querySelector('.aa-agent-home__ambient')

  fireEvent.compositionStart(textarea)
  rerender(<HomePage {...props} input={inputProps({ value: 'zheng li' })} />)
  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS * 2))
  expect(ambient?.getAttribute('data-state')).toBe('idle')

  fireEvent.compositionEnd(textarea)
  rerender(<HomePage {...props} input={inputProps({ value: '整理' })} />)
  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS))
  expect(ambient?.getAttribute('data-state')).toBe('active')
})

test('keeps committed draft state while composing additional Chinese input', () => {
  vi.useFakeTimers()
  const props = {
    onNavigate: vi.fn(),
    onOpenConversation: vi.fn(),
    conversations: [] as ConversationSummary[],
    focusRequest: 0,
  }
  const { container, rerender } = render(
    <HomePage {...props} input={inputProps({ value: '整理' })} />,
  )
  const textarea = screen.getByPlaceholderText('想从哪里开始？')
  const ambient = container.querySelector('.aa-agent-home__ambient')

  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS))
  expect(ambient?.getAttribute('data-state')).toBe('active')

  fireEvent.compositionStart(textarea)
  rerender(<HomePage {...props} input={inputProps({ value: '整理 ren wu' })} />)
  expect(ambient?.getAttribute('data-state')).toBe('active')
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
