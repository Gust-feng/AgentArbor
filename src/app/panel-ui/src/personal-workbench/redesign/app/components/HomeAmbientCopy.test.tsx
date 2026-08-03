import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { shouldUseMotion } from '../../../../app-motion'
import { HomeAmbientCopy } from './HomeAmbientCopy'

vi.mock('../../../../app-motion', () => ({
  shouldUseMotion: vi.fn(),
}))

beforeEach(() => {
  window.sessionStorage.clear()
  vi.mocked(shouldUseMotion).mockReturnValue(true)
})

afterEach(() => {
  window.sessionStorage.clear()
})

test('reveals the sentence in semantic segments without changing its reserved layout', () => {
  const copy = '夜深了，不必急着结束，也不必急着开始。'
  const { container } = render(<HomeAmbientCopy copy={copy} />)
  const reserve = container.querySelector('.aa-agent-home__ambient-reserve')
  const visibleCopy = container.querySelector('.aa-agent-home__ambient-copy')
  const segments = visibleCopy?.querySelectorAll('.aa-agent-home__ambient-segment') ?? []

  expect(reserve?.textContent).toBe(copy)
  expect(visibleCopy?.textContent).toBe(copy)
  expect(visibleCopy?.classList.contains('aa-agent-home__ambient-copy--entering')).toBe(true)
  expect(reserve?.querySelectorAll('.aa-agent-home__ambient-segment')).toHaveLength(3)
  expect(Array.from(segments, (segment) => segment.textContent)).toEqual([
    '夜深了，',
    '不必急着结束，',
    '也不必急着开始。',
  ])
})

test('shows the full sentence immediately on later visits in the same session', () => {
  const copy = '这个夜晚还很长，答案可以晚一点到来。'
  const first = render(<HomeAmbientCopy copy={copy} />)
  first.unmount()

  const second = render(<HomeAmbientCopy copy={copy} />)
  const visibleCopy = second.container.querySelector('.aa-agent-home__ambient-copy')
  expect(visibleCopy?.textContent).toBe(copy)
  expect(visibleCopy?.classList.contains('aa-agent-home__ambient-copy--entering')).toBe(false)
})

test('shows the full sentence immediately when motion is reduced', () => {
  vi.mocked(shouldUseMotion).mockReturnValue(false)
  const copy = '有些答案需要寻找，有些只需要给它一点时间。'
  const { container } = render(<HomeAmbientCopy copy={copy} />)

  const visibleCopy = container.querySelector('.aa-agent-home__ambient-copy')
  expect(visibleCopy?.textContent).toBe(copy)
  expect(visibleCopy?.classList.contains('aa-agent-home__ambient-copy--entering')).toBe(false)
})

test('preserves consecutive punctuation exactly as provided', () => {
  const copy = '真的想清楚了吗？！也许还可以再等等……'
  const { container } = render(<HomeAmbientCopy copy={copy} />)
  const visibleCopy = container.querySelector('.aa-agent-home__ambient-copy')

  expect(visibleCopy?.textContent).toBe(copy)
  expect(Array.from(
    visibleCopy?.querySelectorAll('.aa-agent-home__ambient-segment') ?? [],
    (segment) => segment.textContent,
  )).toEqual(['真的想清楚了吗？！', '也许还可以再等等……'])
})
