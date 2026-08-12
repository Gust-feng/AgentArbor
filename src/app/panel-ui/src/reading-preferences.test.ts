import { beforeEach, expect, test, vi } from 'vitest'
import { applyPrefs, handleReadingSizeWheel, loadPrefs, READING_SIZE_MAX_PX, READING_SIZE_MIN_PX, savePrefs } from './reading-preferences'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('style')
})

test('reading preferences use a comfortable default and migrate older saved values', () => {
  window.localStorage.setItem('aa.readingPrefs', JSON.stringify({ font: 'serif', width: 'wide' }))

  expect(loadPrefs()).toEqual({ font: 'serif', width: 'wide', size: 'medium' })
})

test('reading size persists and applies through the shared CSS variable', () => {
  const prefs = { font: 'sans', width: 'standard', size: 'large' } as const

  savePrefs(prefs)

  expect(loadPrefs()).toEqual(prefs)
  expect(document.documentElement.style.getPropertyValue('--reading-body-size')).toBe('18px')
})

test('reading preferences can be applied without writing storage', () => {
  applyPrefs({ font: 'sans', width: 'narrow', size: 'small' })

  expect(document.documentElement.style.getPropertyValue('--reading-width')).toBe('560px')
  expect(document.documentElement.style.getPropertyValue('--reading-body-size')).toBe('15px')
})

test('ctrl plus wheel adjusts reading size, persists it, and clamps to the supported range', () => {
  const preventDefault = vi.fn()

  expect(handleReadingSizeWheel({ ctrlKey: false, deltaY: -1, preventDefault })).toBe(false)
  expect(preventDefault).not.toHaveBeenCalled()

  expect(handleReadingSizeWheel({ ctrlKey: true, deltaY: -1, preventDefault })).toBe(true)
  expect(preventDefault).toHaveBeenCalledTimes(1)
  expect(document.documentElement.style.getPropertyValue('--reading-body-size')).toBe('17px')
  expect(loadPrefs().sizePx).toBe(17)

  savePrefs({ font: 'sans', width: 'standard', size: 'medium', sizePx: READING_SIZE_MIN_PX })
  handleReadingSizeWheel({ ctrlKey: true, deltaY: 1, preventDefault })
  expect(document.documentElement.style.getPropertyValue('--reading-body-size')).toBe(`${READING_SIZE_MIN_PX}px`)

  savePrefs({ font: 'sans', width: 'standard', size: 'medium', sizePx: READING_SIZE_MAX_PX })
  handleReadingSizeWheel({ ctrlKey: true, deltaY: -1, preventDefault })
  expect(document.documentElement.style.getPropertyValue('--reading-body-size')).toBe(`${READING_SIZE_MAX_PX}px`)
})
