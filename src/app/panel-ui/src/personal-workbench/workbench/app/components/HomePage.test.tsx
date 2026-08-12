import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChatInputProps } from '../../../../contracts/composer'
import { HomePage } from './HomePage'
import { selectHomeAmbientCopy } from './home-ambient-copy'
import { HOME_AMBIENT_COPY_INPUT_DELAY_MS } from './HomeAmbientCopy'
import {
  HOME_TYPEWRITER_START_DELAY_MS,
  homeTypewriterCharDelay,
  selectHomeTypewriterCopy,
} from './home-typewriter'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

test('presents one stable ambient line with the quiet task entry', () => {
  const now = new Date(2026, 7, 3, 1, 30)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  render(
    <HomePage
      input={inputProps()}
      focusRequest={0}
    />,
  )

  expect(screen.getByRole('region', { name: '开始任务' })).toBeTruthy()
  const copy = selectHomeAmbientCopy(now).copy
  expect(screen.getByLabelText(`${copy.lead}${copy.idleTail}`)).toBeTruthy()
  expect(screen.getByPlaceholderText('想从哪里开始？')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /工作区/u })).toBeNull()
  expect(screen.queryByRole('heading')).toBeNull()
  expect(screen.queryByLabelText('AgentArbor Agent')).toBeNull()
})

test('hides context usage until the task entry becomes a conversation', () => {
  render(
    <HomePage
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

test('picks a space or workspace owner from the task entry context', () => {
  const onOwnerChange = vi.fn()
  render(
    <HomePage
      spaces={[{ spaceId: 'space-study', title: '学习空间' }]}
      workspaces={[{ workspaceId: 'workspace-1', title: 'AgentArbor', status: 'available', linkCount: 0 }]}
      ownerSelection={null}
      onOwnerChange={onOwnerChange}
      input={inputProps()}
      focusRequest={0}
    />,
  )

  const trigger = screen.getByRole('button', { name: '对话空间' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')

  fireEvent.click(trigger)
  expect(screen.getByRole('option', { name: '学习空间' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'AgentArbor' })).toBeTruthy()

  fireEvent.click(screen.getByRole('option', { name: '学习空间' }))
  expect(onOwnerChange).toHaveBeenCalledWith({ kind: 'space', id: 'space-study' })
  expect(screen.queryByRole('option')).toBeNull()
})

test('shows the selected owner on the task entry trigger', () => {
  render(
    <HomePage
      spaces={[{ spaceId: 'space-study', title: '学习空间' }]}
      workspaces={[]}
      ownerSelection={{ kind: 'space', id: 'space-study' }}
      onOwnerChange={vi.fn()}
      input={inputProps()}
      focusRequest={0}
    />,
  )

  expect(screen.getByRole('button', { name: '对话空间' })).toBeTruthy()
  expect(screen.getByText('学习空间')).toBeTruthy()
})

test('disables the owner picker when no space or workspace exists', () => {
  render(
    <HomePage
      spaces={[]}
      workspaces={[]}
      ownerSelection={null}
      onOwnerChange={vi.fn()}
      input={inputProps()}
      focusRequest={0}
    />,
  )

  expect(screen.getByRole('button', { name: '对话空间' }).hasAttribute('disabled')).toBe(true)
})

test('enters the working state only after non-whitespace input', () => {
  vi.useFakeTimers()
  const props = {
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

test('clicks the task entry and types the demo copy character by character', () => {
  const now = new Date(2026, 7, 3, 10, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const copy = selectHomeTypewriterCopy(now)

  render(<ControlledHomePage initialValue="" />)
  const textarea = screen.getByPlaceholderText('想从哪里开始？')

  fireEvent.pointerDown(textarea)
  act(() => vi.advanceTimersByTime(HOME_TYPEWRITER_START_DELAY_MS))
  expect((textarea as HTMLTextAreaElement).value).toBe(copy.slice(0, 1))
  for (let index = 1; index < copy.length; index += 1) {
    act(() => vi.advanceTimersByTime(homeTypewriterCharDelay(index, copy)))
    expect((textarea as HTMLTextAreaElement).value).toBe(copy.slice(0, index + 1))
  }

  act(() => vi.advanceTimersByTime(5_000))
  expect((textarea as HTMLTextAreaElement).value).toBe(copy)
})

test('does not type when the task entry is focused programmatically', () => {
  vi.useFakeTimers()
  render(<ControlledHomePage initialValue="" />)
  const textarea = screen.getByPlaceholderText('想从哪里开始？')

  fireEvent.focus(textarea)
  act(() => vi.advanceTimersByTime(10_000))
  expect((textarea as HTMLTextAreaElement).value).toBe('')
})

test('does not restart typing when the task entry already has content', () => {
  vi.useFakeTimers()
  render(<ControlledHomePage initialValue="已有的想法" />)
  const textarea = screen.getByPlaceholderText('想从哪里开始？')

  fireEvent.pointerDown(textarea)
  act(() => vi.advanceTimersByTime(10_000))
  expect((textarea as HTMLTextAreaElement).value).toBe('已有的想法')
})

test('stops typing when the user edits the draft manually', () => {
  const now = new Date(2026, 7, 3, 10, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const copy = selectHomeTypewriterCopy(now)

  render(<ControlledHomePage initialValue="" />)
  const textarea = screen.getByPlaceholderText('想从哪里开始？')

  fireEvent.pointerDown(textarea)
  act(() => vi.advanceTimersByTime(HOME_TYPEWRITER_START_DELAY_MS))
  act(() => vi.advanceTimersByTime(homeTypewriterCharDelay(1, copy)))
  expect((textarea as HTMLTextAreaElement).value).toBe(copy.slice(0, 2))

  fireEvent.change(textarea, { target: { value: `${copy.slice(0, 2)}手动补充` } })
  act(() => vi.advanceTimersByTime(10_000))
  expect((textarea as HTMLTextAreaElement).value).toBe(`${copy.slice(0, 2)}手动补充`)
})

test('stops typing when the task entry loses focus, keeping partial text', () => {
  const now = new Date(2026, 7, 3, 10, 0)
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const copy = selectHomeTypewriterCopy(now)

  render(<ControlledHomePage initialValue="" />)
  const textarea = screen.getByPlaceholderText('想从哪里开始？')

  fireEvent.pointerDown(textarea)
  act(() => vi.advanceTimersByTime(HOME_TYPEWRITER_START_DELAY_MS))
  act(() => vi.advanceTimersByTime(homeTypewriterCharDelay(1, copy)))
  act(() => vi.advanceTimersByTime(homeTypewriterCharDelay(2, copy)))

  fireEvent.blur(textarea)
  act(() => vi.advanceTimersByTime(10_000))
  expect((textarea as HTMLTextAreaElement).value).toBe(copy.slice(0, 3))
})

function ControlledHomePage({ initialValue }: { readonly initialValue: string }) {
  const [value, setValue] = React.useState(initialValue)
  return (
    <HomePage
      input={inputProps({ value, onChange: setValue })}
      focusRequest={0}
    />
  )
}

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
