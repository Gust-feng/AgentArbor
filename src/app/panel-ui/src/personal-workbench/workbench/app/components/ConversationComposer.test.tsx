import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ChatInputProps } from '../../../../contracts/composer'
import { ConversationComposer } from './ConversationComposer'

test('does not submit Enter while an input method is composing text', () => {
  const onSubmit = vi.fn()
  render(<ConversationComposer input={inputProps({ value: 'zheng li', onSubmit })} />)
  const textarea = screen.getByRole('textbox')

  fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
  expect(onSubmit).not.toHaveBeenCalled()

  fireEvent.keyDown(textarea, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledOnce()
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
    attachments: [],
    onSelectAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    ...overrides,
  }
}
