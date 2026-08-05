import { expect, test } from 'vitest'
import { selectHomeAmbientCopy } from './home-ambient-copy'

test('keeps ambient copy stable within the same local date and period', () => {
  const first = selectHomeAmbientCopy(new Date(2026, 7, 3, 1, 5))
  const later = selectHomeAmbientCopy(new Date(2026, 7, 3, 4, 55))

  expect(later).toEqual(first)
})

test('varies ambient copy pairs across the week and broad day periods', () => {
  const copies = [
    new Date(2026, 7, 3, 1, 0),
    new Date(2026, 7, 3, 6, 0),
    new Date(2026, 7, 3, 9, 0),
    new Date(2026, 7, 3, 12, 30),
    new Date(2026, 7, 3, 15, 0),
    new Date(2026, 7, 3, 19, 0),
    new Date(2026, 7, 3, 22, 0),
    new Date(2026, 7, 7, 19, 0),
    new Date(2026, 7, 8, 9, 0),
    new Date(2026, 7, 9, 19, 0),
  ].map(selectHomeAmbientCopy)

  expect(new Set(copies.map((copy) => `${copy.lead}${copy.idleTail}`)).size).toBeGreaterThanOrEqual(6)
})

test('keeps idle copy open-ended and active copy declarative', () => {
  const copies = Array.from({ length: 35 }, (_, dayOffset) => (
    [1, 6, 9, 12, 15, 19, 22].map((hour) => (
      selectHomeAmbientCopy(new Date(2026, 7, 1 + dayOffset, hour))
    ))
  )).flat()

  expect(copies.every((copy) => /[?？]/u.test(`${copy.lead}${copy.idleTail}`))).toBe(true)
  expect(copies.every((copy) => !/[?!？！]/u.test(`${copy.lead}${copy.activeTail}`))).toBe(true)
  expect(copies.every((copy) => `${copy.lead}${copy.idleTail}`.length >= 16)).toBe(true)
  expect(copies.every((copy) => `${copy.lead}${copy.activeTail}`.length >= 16)).toBe(true)
})
