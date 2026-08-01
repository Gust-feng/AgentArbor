import { beforeEach, expect, test } from 'vitest'
import { applyPrefs, loadPrefs, savePrefs } from './reading-preferences'

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
