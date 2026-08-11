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

test('keeps the composer toolbar compact and hides reasoning controls', () => {
  render(<ConversationComposer input={inputProps({
    models: [{
      id: 'model-1',
      name: 'Model 1',
      label: '模型一',
      providerLabel: 'OpenAI',
      providerIdentity: 'openai',
      profileId: 'profile-1',
      modelId: 'model-1',
      iconSvg: '<svg viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>',
    }],
    selectedModelId: 'model-1',
    reasoningEffortEnabled: true,
    contextUsage: {
      source: 'provider_usage',
      usedTokens: 100,
      maxTokens: 1_000,
      percent: 10,
      ringPercent: 10,
      tone: 'normal',
      label: '上下文已用 10%',
    },
  })} />)

  expect(screen.getByRole('textbox').getAttribute('rows')).toBe('1')
  const addReference = screen.getByRole('button', { name: '添加引用' })
  expect(addReference.textContent).toBe('')
  expect(addReference.querySelector('svg')).not.toBeNull()
  const toolbarRight = document.querySelector('.aa-conversation-composer__toolbar-right')!
  const context = toolbarRight.querySelector('.aa-context-usage')!
  const accessChip = toolbarRight.querySelector('.aa-composer-access')!
  const modelPicker = toolbarRight.querySelector('.model-option-picker')!
  expect(context.compareDocumentPosition(accessChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(accessChip.compareDocumentPosition(modelPicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const accessButton = screen.getByRole('button', { name: '命令确认方式' })
  expect(accessButton.textContent).toContain('标准访问')
  const modelButton = screen.getByRole('button', { name: '选择模型' })
  expect(modelButton.querySelector('.model-picker-icon svg')).not.toBeNull()
  expect(screen.getByRole('button', { name: '发送' }).querySelector('svg')).not.toBeNull()
  expect(screen.queryByRole('combobox', { name: '推理力度' })).toBeNull()
})

test('switches to full access through the confirmation policy popover', () => {
  const onToolConfirmationPolicyChange = vi.fn()
  render(<ConversationComposer input={inputProps({ onToolConfirmationPolicyChange })} />)

  const accessButton = screen.getByRole('button', { name: '命令确认方式' })
  fireEvent.click(accessButton)
  const options = screen.getAllByRole('option')
  expect(options.map((option) => option.textContent)).toEqual([
    '标准访问运行命令前会先询问',
    '完全访问运行命令时不再逐条询问',
  ])

  fireEvent.click(screen.getByRole('option', { name: /完全访问/ }))
  expect(onToolConfirmationPolicyChange).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog', { name: '要开启完全访问权限吗？' })).not.toBeNull()
  expect(screen.getByText('开启后，Agent 可以在不逐条询问的情况下运行命令，并访问当前引用范围之外的文件。')).not.toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '开启完全访问' }))
  expect(onToolConfirmationPolicyChange).toHaveBeenCalledWith('full_access')
  expect(screen.queryByRole('alertdialog', { name: '要开启完全访问权限吗？' })).toBeNull()
  expect(screen.queryByRole('listbox', { name: '命令确认方式' })).toBeNull()
})

test('full access policy shows accent label and risk disclosure', () => {
  render(<ConversationComposer input={inputProps({ toolConfirmationPolicy: 'full_access' })} />)

  const accessButton = screen.getByRole('button', { name: '命令确认方式' })
  expect(accessButton.textContent).toContain('完全访问')
  expect(accessButton.getAttribute('data-policy')).toBe('full_access')

  fireEvent.click(accessButton)
  expect(screen.getByRole('option', { name: /完全访问/ }).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.aa-composer-access__risk')).toBeNull()
})

test('closes the confirmation policy popover on Escape', () => {
  render(<ConversationComposer input={inputProps()} />)

  fireEvent.click(screen.getByRole('button', { name: '命令确认方式' }))
  expect(screen.getByRole('listbox', { name: '命令确认方式' })).not.toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('listbox', { name: '命令确认方式' })).toBeNull()
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
