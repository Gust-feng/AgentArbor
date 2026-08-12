import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { ConversationScrollArea } from './ConversationScrollArea'

let resizeCallback: ResizeObserverCallback
let scrollHeight = 1_000
/** 平滑滚动目标 = scrollHeight - clientHeight（真实可见底部）。 */
let latestTarget = 600

beforeEach(() => {
  scrollHeight = 1_000
  latestTarget = 600
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback
    }

    observe() {}
    disconnect() {}
  })
})

test('follows new content until the user scrolls away and can jump back to the latest answer', () => {
  const rendered = render(
    <ConversationScrollArea scrollKey="conversation-a" contentClassName="transcript">
      <p>回答</p>
    </ConversationScrollArea>,
  )
  const viewport = rendered.container.querySelector<HTMLElement>('[data-conversation-scroll="viewport"]')!

  expect(viewport.scrollTop).toBe(latestTarget)

  viewport.scrollTop = 200
  fireEvent.scroll(viewport)
  expect(screen.getByRole('button', { name: '跳到最新回答' })).not.toBeNull()

  scrollHeight = 1_200
  latestTarget = 800
  resizeCallback([], {} as ResizeObserver)
  expect(viewport.scrollTop).toBe(200)

  fireEvent.click(screen.getByRole('button', { name: '跳到最新回答' }))
  expect(viewport.scrollTop).toBe(latestTarget)
  expect(screen.queryByRole('button', { name: '跳到最新回答' })).toBeNull()

  scrollHeight = 1_400
  latestTarget = 1_000
  resizeCallback([], {} as ResizeObserver)
  expect(viewport.scrollTop).toBe(latestTarget)

  scrollHeight = 1_600
  latestTarget = 1_200
  rendered.rerender(
    <ConversationScrollArea scrollKey="conversation-b" contentClassName="transcript">
      <p>另一条回答</p>
    </ConversationScrollArea>,
  )
  expect(viewport.scrollTop).toBe(latestTarget)
})

test('smooth following reaches the bottom progressively instead of jumping', () => {
  const frames: Array<() => void> = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(() => callback(0))
    return frames.length
  })

  const rendered = render(
    <ConversationScrollArea scrollKey="conversation-smooth" contentClassName="transcript">
      <p>回答</p>
    </ConversationScrollArea>,
  )
  const viewport = rendered.container.querySelector<HTMLElement>('[data-conversation-scroll="viewport"]')!

  // 初始 jump 帧已入队但未执行：尚未滚动。
  expect(viewport.scrollTop).toBe(0)
  expect(frames.length).toBeGreaterThan(0)

  frames.shift()!()
  const firstStep = viewport.scrollTop
  expect(firstStep).toBeGreaterThan(0)
  expect(firstStep).toBeLessThan(latestTarget)

  let guard = 0
  while (frames.length > 0 && guard < 200) {
    frames.shift()!()
    guard += 1
  }
  expect(viewport.scrollTop).toBe(latestTarget)
  expect(screen.queryByRole('button', { name: '跳到最新回答' })).toBeNull()
})

test('user wheel input hands control back and stops smooth following', () => {
  const rendered = render(
    <ConversationScrollArea scrollKey="conversation-wheel" contentClassName="transcript">
      <p>回答</p>
    </ConversationScrollArea>,
  )
  const viewport = rendered.container.querySelector<HTMLElement>('[data-conversation-scroll="viewport"]')!
  expect(viewport.scrollTop).toBe(latestTarget)

  viewport.scrollTop = 100
  fireEvent.wheel(viewport)
  expect(screen.getByRole('button', { name: '跳到最新回答' })).not.toBeNull()

  scrollHeight = 1_300
  latestTarget = 900
  resizeCallback([], {} as ResizeObserver)
  expect(viewport.scrollTop).toBe(100)
})