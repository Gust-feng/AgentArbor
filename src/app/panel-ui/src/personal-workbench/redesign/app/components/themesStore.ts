import { useCallback, useEffect, useState } from 'react'

/**
 * 主题数据层 —— 知识库的「可多属分组」(见与用户的设计对话)。
 * ===================================================================
 *
 * 不是文件夹(树、一物一处),而是标签式主题(网、可多属):
 *   一个对象(笔记 / 材料)可以同时属于多个主题。
 *
 * 两只手共管:
 *   - agent 提议:自动读内容 + 看链接,把相关对象聚成主题(origin/by = 'agent')。
 *   - 用户裁决:重命名、合并、删主题;把对象拖进/拖出主题;「锁定」某个归属
 *     (locked=true)让 agent 之后重聚类时别再动它。
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 给后来接后端 / 接真 agent 的人                                │
 * │ UI 只依赖本文件导出的函数签名,不直接碰 localStorage。         │
 * │ 接后端:改 read/write 两组实现 →                              │
 * │   themes       → GET/POST/PATCH/DELETE /api/themes            │
 * │   assignments  → GET/POST/DELETE /api/themes/:id/pages        │
 * │ 接真 agent:agent 只产出「未锁定」的 assignment;重聚类时先读   │
 * │   locked 的归属当约束,不覆盖用户裁决。                        │
 * └─────────────────────────────────────────────────────────────┘
 */

export interface Theme {
  id: string
  name: string
  color: string
  /** 这个主题是 agent 聚出来的还是用户建的。 */
  origin: 'agent' | 'user'
}

/** 对象 ↔ 主题 的多对多归属(一条 = 一个对象进了一个主题)。 */
export interface Assignment {
  refId: string // 指向 note.id / material.id
  themeId: string
  /** 这条归属是谁定的。 */
  by: 'agent' | 'user'
  /** 用户锁定后 agent 不得移除。 */
  locked: boolean
}

const THEMES_KEY = 'aa.themes.v1'
const ASSIGN_KEY = 'aa.assignments.v1'

/** 主题配色 —— 沿用全局的沉静色。 */
const C = { indigo: '#6865a7', rust: '#c07a55', green: '#6f8778', plum: '#8a6aa0' }

/** 首次进入的种子:模拟 agent「已经帮你分好」,含跨主题的重叠归属。接后端后删除。 */
const SEED_THEMES: Theme[] = [
  { id: 't-transformer', name: 'Transformer', color: C.indigo, origin: 'agent' },
  { id: 't-training', name: '训练与实践', color: C.rust, origin: 'agent' },
  { id: 't-method', name: '读书与方法', color: C.green, origin: 'agent' },
  { id: 't-inspo', name: '灵感与杂谈', color: C.plum, origin: 'agent' },
]

const a = (refId: string, themeId: string): Assignment => ({ refId, themeId, by: 'agent', locked: false })
const SEED_ASSIGN: Assignment[] = [
  // Transformer 一族
  a('m-attn-pdf', 't-transformer'),
  a('m-transformer-md', 't-transformer'),
  a('m-train-code', 't-transformer'),
  // 训练与实践(m-train-code / note-seed-1 跨主题)
  a('f1-1', 't-training'),
  a('m-train-code', 't-training'),
  a('m-loss-img', 't-training'),
  a('note-seed-1', 't-training'),
  a('m-stanford-video', 't-training'),
  // 读书与方法(m-transformer-md 跨主题)
  a('f2-2', 't-method'),
  a('note-seed-2', 't-method'),
  a('m-transformer-md', 't-method'),
  // 灵感与杂谈
  a('m-inspo-img', 't-inspo'),
  a('m-podcast-audio', 't-inspo'),
  a('m-distill-web', 't-inspo'),
]

/* ------------------------------ 底层读写 ------------------------------ */

function readJSON<T>(key: string, seed: T[]): T[] {
  if (typeof window === 'undefined') return seed
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) {
      window.localStorage.setItem(key, JSON.stringify(seed))
      return seed
    }
    return JSON.parse(raw) as T[]
  } catch {
    return []
  }
}

function writeJSON<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 忽略存储失败 */
  }
}

const readThemes = () => readJSON<Theme>(THEMES_KEY, SEED_THEMES)
const writeThemes = (v: Theme[]) => writeJSON(THEMES_KEY, v)
const readAssign = () => readJSON<Assignment>(ASSIGN_KEY, SEED_ASSIGN)
const writeAssign = (v: Assignment[]) => writeJSON(ASSIGN_KEY, v)

/* ------------------------------ 变更广播 ------------------------------ */

type Listener = () => void
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((fn) => fn())

/* ------------------------------ 公开 API ------------------------------ */

export function getThemes(): Theme[] {
  return readThemes()
}

export function getAssignments(): Assignment[] {
  return readAssign()
}

/** 一个对象归属的所有主题 id。 */
export function themesOf(refId: string): string[] {
  return readAssign()
    .filter((x) => x.refId === refId)
    .map((x) => x.themeId)
}

/** 一个主题下的所有对象 refId。 */
export function pagesOf(themeId: string): string[] {
  return readAssign()
    .filter((x) => x.themeId === themeId)
    .map((x) => x.refId)
}

export function isLocked(refId: string, themeId: string): boolean {
  return readAssign().some((x) => x.refId === refId && x.themeId === themeId && x.locked)
}

/** 把对象加入主题(幂等)。默认视作用户操作。 */
export function assign(refId: string, themeId: string, by: 'agent' | 'user' = 'user') {
  const rows = readAssign()
  if (rows.some((x) => x.refId === refId && x.themeId === themeId)) return
  writeAssign([...rows, { refId, themeId, by, locked: false }])
  emit()
}

export function unassign(refId: string, themeId: string) {
  writeAssign(readAssign().filter((x) => !(x.refId === refId && x.themeId === themeId)))
  emit()
}

/** 锁定 / 解锁某条归属(锁定 = agent 别再动)。 */
export function toggleLock(refId: string, themeId: string) {
  writeAssign(
    readAssign().map((x) =>
      x.refId === refId && x.themeId === themeId ? { ...x, locked: !x.locked } : x
    )
  )
  emit()
}

let seq = 0
export function createTheme(name: string, color = C.indigo): string {
  const id = `t-user-${Date.now()}-${seq++}`
  writeThemes([...readThemes(), { id, name: name.trim() || '新主题', color, origin: 'user' }])
  emit()
  return id
}

export function renameTheme(themeId: string, name: string) {
  writeThemes(readThemes().map((t) => (t.id === themeId ? { ...t, name: name.trim() || t.name } : t)))
  emit()
}

/** 删主题:主题本身 + 它的所有归属一起清掉(对象仍在知识库,只是不再属于该主题)。 */
export function deleteTheme(themeId: string) {
  writeThemes(readThemes().filter((t) => t.id !== themeId))
  writeAssign(readAssign().filter((x) => x.themeId !== themeId))
  emit()
}

/** 合并:把 fromId 的归属并入 toId,再删掉 fromId。 */
export function mergeTheme(fromId: string, toId: string) {
  if (fromId === toId) return
  const rows = readAssign()
  const toMembers = new Set(rows.filter((x) => x.themeId === toId).map((x) => x.refId))
  const moved = rows
    .filter((x) => x.themeId === fromId && !toMembers.has(x.refId))
    .map((x) => ({ ...x, themeId: toId }))
  writeAssign([...rows.filter((x) => x.themeId !== fromId), ...moved])
  writeThemes(readThemes().filter((t) => t.id !== fromId))
  emit()
}

/* ------------------------------ React 绑定 ------------------------------ */

export function useThemes() {
  const [, setRev] = useState(0)
  useEffect(() => {
    const refresh = () => setRev((n) => n + 1)
    listeners.add(refresh)
    return () => {
      listeners.delete(refresh)
    }
  }, [])

  return {
    themes: getThemes(),
    assignments: getAssignments(),
    themesOf,
    pagesOf,
    isLocked,
    assign: useCallback((refId: string, themeId: string) => assign(refId, themeId, 'user'), []),
    unassign: useCallback((refId: string, themeId: string) => unassign(refId, themeId), []),
    toggleLock: useCallback((refId: string, themeId: string) => toggleLock(refId, themeId), []),
    createTheme: useCallback((name: string, color?: string) => createTheme(name, color), []),
    renameTheme: useCallback((id: string, name: string) => renameTheme(id, name), []),
    deleteTheme: useCallback((id: string) => deleteTheme(id), []),
    mergeTheme: useCallback((from: string, to: string) => mergeTheme(from, to), []),
  }
}
