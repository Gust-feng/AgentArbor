export type ReadingFont = 'sans' | 'serif'
export type ReadingWidth = 'narrow' | 'standard' | 'wide'
export type ReadingSize = 'small' | 'medium' | 'large'

export interface ReadingPrefs {
  readonly font: ReadingFont
  readonly width: ReadingWidth
  readonly size: ReadingSize
}

const STORAGE_KEY = 'aa.readingPrefs'
const DEFAULTS: ReadingPrefs = { font: 'sans', width: 'standard', size: 'medium' }

export const WIDTH_PX: Record<ReadingWidth, number> = {
  narrow: 560,
  standard: 680,
  wide: 820,
}

export const SIZE_PX: Record<ReadingSize, number> = {
  small: 15,
  medium: 16,
  large: 18,
}

export function loadPrefs(): ReadingPrefs {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ReadingPrefs>
    return {
      font: parsed.font === 'serif' ? 'serif' : 'sans',
      width: parsed.width === 'narrow' || parsed.width === 'wide' ? parsed.width : 'standard',
      size: parsed.size === 'small' || parsed.size === 'large' ? parsed.size : 'medium',
    }
  } catch {
    return DEFAULTS
  }
}

export function applyPrefs(prefs: ReadingPrefs): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--reading-font', prefs.font === 'serif' ? 'var(--reading-serif)' : 'var(--reading-sans)')
  root.style.setProperty('--reading-width', `${WIDTH_PX[prefs.width]}px`)
  root.style.setProperty('--reading-body-size', `${SIZE_PX[prefs.size]}px`)
}

export function savePrefs(prefs: ReadingPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // The preference still applies for the current window when storage is unavailable.
  }
  applyPrefs(prefs)
}