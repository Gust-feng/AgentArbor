/**
 * 阅读偏好 —— 单一来源。
 *
 * 偏好写入 localStorage，并作为 CSS 变量应用到 <html> 上；所有阅读界面
 * （对话流、专注模式、未来的材料视图）通过 var(--reading-font) /
 * var(--reading-width) 消费，无需各自持有状态。
 */

export type ReadingFont = 'sans' | 'serif'
export type ReadingWidth = 'narrow' | 'standard' | 'wide'

export interface ReadingPrefs {
  font: ReadingFont
  width: ReadingWidth
}

const STORAGE_KEY = 'aa.readingPrefs'

const DEFAULTS: ReadingPrefs = { font: 'sans', width: 'standard' }

/** 栏宽档位 → 实际像素，与 tokens 的 READING_WIDTH(680) 对齐为「标准」。 */
export const WIDTH_PX: Record<ReadingWidth, number> = {
  narrow: 560,
  standard: 680,
  wide: 820,
}

export function loadPrefs(): ReadingPrefs {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ReadingPrefs>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

/** 把偏好落到 <html> 的 CSS 变量上。 */
export function applyPrefs(prefs: ReadingPrefs) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty(
    '--reading-font',
    prefs.font === 'serif' ? 'var(--reading-serif)' : 'var(--reading-sans)'
  )
  root.style.setProperty('--reading-width', `${WIDTH_PX[prefs.width]}px`)
}

export function savePrefs(prefs: ReadingPrefs) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      /* 忽略存储失败（隐私模式等） */
    }
  }
  applyPrefs(prefs)
}
