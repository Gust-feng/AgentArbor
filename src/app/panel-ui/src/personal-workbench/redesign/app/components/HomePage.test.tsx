import React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ChatInputProps } from '../../../../components/chat-empty'
import type { ConversationSummary } from '../../../../contracts/conversation'
import { HomePage } from './HomePage'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('carries wheel input through a decelerating trail and lets reverse input take over', () => {
  const animationFrames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    animationFrames.push(callback)
    return animationFrames.length
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))

  const conversations: ConversationSummary[] = Array.from({ length: 6 }, (_, index) => ({
    conversationId: `conversation-${index}`,
    title: `会话 ${index}`,
    updatedAt: new Date(2026, 6, index + 1).toISOString(),
  }))
  const { container } = render(
    <HomePage
      onNavigate={() => undefined}
      onOpenConversation={() => true}
      conversations={conversations}
      input={inputProps()}
      focusRequest={0}
    />,
  )
  const trail = container.querySelector<HTMLElement>('[data-home-activity-trail]')!
  Object.defineProperties(trail, {
    clientWidth: { configurable: true, value: 720 },
    scrollWidth: { configurable: true, value: 1_700 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  })
  animationFrames.length = 0

  fireEvent.wheel(trail, { deltaY: 100, deltaMode: 0 })
  expect(trail.scrollLeft).toBe(0)
  expect(animationFrames).toHaveLength(1)

  act(() => animationFrames.shift()!(0))
  const firstDistance = trail.scrollLeft
  act(() => animationFrames.shift()!(1000 / 60))
  const secondDistance = trail.scrollLeft - firstDistance

  expect(firstDistance).toBeGreaterThan(0)
  expect(secondDistance).toBeGreaterThan(0)
  expect(secondDistance).toBeLessThan(firstDistance)

  fireEvent.wheel(trail, { deltaY: -100, deltaMode: 0 })
  const positionBeforeReverseFrame = trail.scrollLeft
  act(() => animationFrames.shift()!(2000 / 60))
  expect(trail.scrollLeft).toBeLessThan(positionBeforeReverseFrame)
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
    attachments: [],
    onSelectAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
  }
}
