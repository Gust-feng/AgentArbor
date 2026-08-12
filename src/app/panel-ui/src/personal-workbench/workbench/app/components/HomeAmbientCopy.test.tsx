import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { shouldUseMotion } from '../../../../app-motion'
import { HomeAmbientCopy } from './HomeAmbientCopy'
import type { HomeAmbientCopyPair } from './home-ambient-copy'
import { HOME_AMBIENT_COPY_INPUT_DELAY_MS } from './HomeAmbientCopy'

vi.mock('../../../../app-motion', () => ({
  shouldUseMotion: vi.fn(),
}))

const copy: HomeAmbientCopyPair = {
  lead: '一天正在慢慢展开，',
  idleTail: '今天想把什么向前推进？',
  activeTail: '你写下的事情，正从这里开始。',
}

beforeEach(() => {
  window.sessionStorage.clear()
  vi.mocked(shouldUseMotion).mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
})

test('keeps both copy variants in the same reserved layout', () => {
  const { container } = render(<HomeAmbientCopy copy={copy} hasDraft={false} />)
  const ambient = container.querySelector('.aa-agent-home__ambient')
  const reserveVariants = container.querySelectorAll('.aa-agent-home__ambient-reserve-variant')

  expect(ambient?.getAttribute('data-state')).toBe('idle')
  expect(Array.from(reserveVariants, (variant) => variant.textContent)).toEqual([
    `${copy.lead}${copy.idleTail}`,
    `${copy.lead}${copy.activeTail}`,
  ])
  expect(container.querySelectorAll('.aa-agent-home__ambient-lead')).toHaveLength(1)
  expect(container.querySelector('.aa-agent-home__ambient-lead')?.textContent).toBe(copy.lead)
  const visibleTail = container.querySelector('.aa-agent-home__ambient-tail')
  expect(visibleTail?.textContent).toBe(copy.idleTail)
  expect(visibleTail?.childElementCount).toBe(0)
})

test('uses the entrance reveal only once in the same session', () => {
  const first = render(<HomeAmbientCopy copy={copy} hasDraft={false} />)
  expect(first.container.querySelector('.aa-agent-home__ambient-copy')?.classList.contains(
    'aa-agent-home__ambient-copy--entering',
  )).toBe(true)
  first.unmount()

  const second = render(<HomeAmbientCopy copy={copy} hasDraft={false} />)
  expect(second.container.querySelector('.aa-agent-home__ambient-copy')?.classList.contains(
    'aa-agent-home__ambient-copy--entering',
  )).toBe(false)
})

test('switches once after non-whitespace input has settled briefly', () => {
  vi.useFakeTimers()
  const { container, rerender } = render(<HomeAmbientCopy copy={copy} hasDraft={false} />)

  rerender(<HomeAmbientCopy copy={copy} hasDraft />)
  expect(container.querySelector('.aa-agent-home__ambient')?.getAttribute('data-state')).toBe('idle')

  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS - 1))
  expect(container.querySelector('.aa-agent-home__ambient')?.getAttribute('data-state')).toBe('idle')

  act(() => vi.advanceTimersByTime(1))
  const ambient = container.querySelector('.aa-agent-home__ambient')
  expect(ambient?.getAttribute('data-state')).toBe('active')
  expect(ambient?.getAttribute('aria-label')).toBe(`${copy.lead}${copy.activeTail}`)
  expect(container.querySelector('.aa-agent-home__ambient-tail')?.textContent).toBe(copy.idleTail)

  rerender(<HomeAmbientCopy copy={{ ...copy, activeTail: '你写下的事情，正在继续向前。' }} hasDraft />)
  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS))
  expect(container.querySelector('.aa-agent-home__ambient')?.getAttribute('data-state')).toBe('active')
})

test('cancels the pending switch when the draft is cleared', () => {
  vi.useFakeTimers()
  const { container, rerender } = render(<HomeAmbientCopy copy={copy} hasDraft={false} />)

  rerender(<HomeAmbientCopy copy={copy} hasDraft />)
  rerender(<HomeAmbientCopy copy={copy} hasDraft={false} />)
  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS))

  expect(container.querySelector('.aa-agent-home__ambient')?.getAttribute('data-state')).toBe('idle')
})

test('returns to the idle copy after an active draft is cleared', () => {
  vi.useFakeTimers()
  const { container, rerender } = render(<HomeAmbientCopy copy={copy} hasDraft />)

  act(() => vi.advanceTimersByTime(HOME_AMBIENT_COPY_INPUT_DELAY_MS))
  expect(container.querySelector('.aa-agent-home__ambient')?.getAttribute('data-state')).toBe('active')

  rerender(<HomeAmbientCopy copy={copy} hasDraft={false} />)
  expect(container.querySelector('.aa-agent-home__ambient')?.getAttribute('data-state')).toBe('idle')
})

test('switches immediately when motion is reduced', () => {
  vi.mocked(shouldUseMotion).mockReturnValue(false)
  const { container } = render(<HomeAmbientCopy copy={copy} hasDraft />)

  const ambient = container.querySelector('.aa-agent-home__ambient')
  expect(ambient?.getAttribute('data-state')).toBe('active')
  expect(ambient?.getAttribute('aria-label')).toBe(`${copy.lead}${copy.activeTail}`)
  expect(container.querySelector('.aa-agent-home__ambient-tail')?.textContent).toBe(copy.activeTail)
})