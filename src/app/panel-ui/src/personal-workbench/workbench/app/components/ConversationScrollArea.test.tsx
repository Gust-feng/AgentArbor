import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { ConversationScrollArea } from './ConversationScrollArea'

let resizeCallback: ResizeObserverCallback
let scrollHeight = 1_000

beforeEach(() => {
  scrollHeight = 1_000
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

  expect(viewport.scrollTop).toBe(1_000)

  viewport.scrollTop = 200
  fireEvent.scroll(viewport)
  expect(screen.getByRole('button', { name: '跳到最新回答' })).not.toBeNull()

  scrollHeight = 1_200
  resizeCallback([], {} as ResizeObserver)
  expect(viewport.scrollTop).toBe(200)

  fireEvent.click(screen.getByRole('button', { name: '跳到最新回答' }))
  expect(viewport.scrollTop).toBe(1_200)
  expect(screen.queryByRole('button', { name: '跳到最新回答' })).toBeNull()

  scrollHeight = 1_400
  resizeCallback([], {} as ResizeObserver)
  expect(viewport.scrollTop).toBe(1_400)

  scrollHeight = 1_600
  rendered.rerender(
    <ConversationScrollArea scrollKey="conversation-b" contentClassName="transcript">
      <p>另一条回答</p>
    </ConversationScrollArea>,
  )
  expect(viewport.scrollTop).toBe(1_600)
})
