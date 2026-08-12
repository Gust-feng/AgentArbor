import { expect, test } from 'vitest'
import type { HomeAmbientCopyMemory } from './home-ambient-copy'
import { homeAmbientCopyIdentity, selectHomeAmbientCopy } from './home-ambient-copy'

test('keeps ambient copy stable within the same local date and period', () => {
  const first = selectHomeAmbientCopy(new Date(2026, 7, 3, 1, 5))
  const later = selectHomeAmbientCopy(new Date(2026, 7, 3, 4, 55))

  expect(later).toEqual(first)
})

test('varies ambient copy pairs across days and broad day periods', () => {
  const copies = [
    new Date(2026, 7, 3, 1, 0),
    new Date(2026, 7, 3, 6, 0),
    new Date(2026, 7, 3, 9, 0),
    new Date(2026, 7, 3, 12, 30),
    new Date(2026, 7, 3, 15, 0),
    new Date(2026, 7, 3, 19, 0),
    new Date(2026, 7, 3, 22, 0),
    new Date(2026, 7, 4, 19, 0),
    new Date(2026, 7, 5, 9, 0),
    new Date(2026, 7, 6, 19, 0),
  ].map((date) => selectHomeAmbientCopy(date).copy)

  expect(new Set(copies.map((copy) => `${copy.lead}${copy.idleTail}`)).size).toBeGreaterThanOrEqual(6)
})

test('keeps idle copy open-ended and active copy declarative', () => {
  const copies = Array.from({ length: 35 }, (_, dayOffset) => (
    [1, 6, 9, 12, 15, 19, 22].map((hour) => (
      selectHomeAmbientCopy(new Date(2026, 7, 1 + dayOffset, hour)).copy
    ))
  )).flat()

  expect(copies.every((copy) => /[?？]/u.test(`${copy.lead}${copy.idleTail}`))).toBe(true)
  expect(copies.every((copy) => !/[?!？！]/u.test(`${copy.lead}${copy.activeTail}`))).toBe(true)
  expect(copies.every((copy) => `${copy.lead}${copy.idleTail}`.length >= 8)).toBe(true)
  expect(copies.every((copy) => `${copy.lead}${copy.activeTail}`.length >= 8)).toBe(true)
})

test('avoids repeating the previously shown copy once the selection period changes', () => {
  let memory: HomeAmbientCopyMemory | undefined
  for (let day = 1; day <= 14; day += 1) {
    const selection = selectHomeAmbientCopy(new Date(2026, 7, day, 9, 0), memory)
    if (memory !== undefined) {
      expect(homeAmbientCopyIdentity(selection.copy)).not.toBe(memory.copy)
    }
    memory = { key: selection.key, copy: homeAmbientCopyIdentity(selection.copy) }
  }
})
