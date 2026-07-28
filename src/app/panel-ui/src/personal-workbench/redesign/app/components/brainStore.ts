import { useCallback, useEffect, useState } from 'react'
import { getNote } from './notesStore'
import { getMaterial } from './materials'

/**
 * 第二大脑数据层 —— 原型阶段的单一数据源。
 * ===================================================================
 *
 * 第二大脑 = 你经过判断「收藏」下来、并互相连起来的知识本体(见 docs/概念与设计.md §5)。
 * 它不重复存内容:一个「页面」只是对某个已有对象(笔记 / 材料)的引用 + 收藏时间。
 * 内容真身仍住在 notesStore(笔记) / materials(材料)里,这里只维护两件事:
 *   1. 哪些对象被收藏进了大脑(membership);
 *   2. 页面之间怎么连(links,有向边;反向链接由此算出)。
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 给后来接后端的人 (BACKEND INTEGRATION GUIDE)                 │
 * │ 约定:UI 只依赖本文件导出的函数签名,不直接碰 localStorage。   │
 * │ 接后端时只改 read / write 两组函数的实现:                    │
 * │   pages  → GET/POST/DELETE /api/brain/pages                   │
 * │   links  → GET/POST/DELETE /api/brain/links                   │
 * │ CRUD 变异步后,把 useBrain 的同步 setState 改为乐观更新。      │
 * │ 服务端负责:用户隔离、收藏/断链的幂等、删除对象时的级联断链。  │
 * └─────────────────────────────────────────────────────────────┘
 */

export type PageKind = 'note' | 'material'

/** 大脑里的一个页面 = 对某个对象的引用(不复制内容)。 */
export interface BrainPage {
  refId: string // 指向 note.id 或 material.id
  kind: PageKind
  collectedAt: number // 收藏进大脑的时间(epoch ms)
}

/** 页面之间的有向链接(from → to,存 refId);反向链接由此推导。 */
export interface BrainLink {
  from: string
  to: string
}

const PAGES_KEY = 'aa.brain.pages.v3'
const LINKS_KEY = 'aa.brain.links.v3'
/** 最近打开时间(refId → epoch ms)。支撑门面的「继续看」——取用优先的核心信号。 */
const OPENED_KEY = 'aa.brain.opened.v1'

/** 首次进入的种子:让大脑不为空、wiki 那一面有网可走。接后端后删除。 */
const H = 1000 * 60 * 60
const SEED_PAGES: BrainPage[] = [
  { refId: 'note-seed-1', kind: 'note', collectedAt: Date.now() - H * 30 },
  { refId: 'note-seed-2', kind: 'note', collectedAt: Date.now() - H * 20 },
  { refId: 'f1-1', kind: 'material', collectedAt: Date.now() - H * 50 },
  { refId: 'f2-2', kind: 'material', collectedAt: Date.now() - H * 12 },
  { refId: 'm-attn-pdf', kind: 'material', collectedAt: Date.now() - H * 8 },
  { refId: 'm-transformer-md', kind: 'material', collectedAt: Date.now() - H * 7 },
  { refId: 'm-loss-img', kind: 'material', collectedAt: Date.now() - H * 6 },
  { refId: 'm-stanford-video', kind: 'material', collectedAt: Date.now() - H * 5 },
  { refId: 'm-podcast-audio', kind: 'material', collectedAt: Date.now() - H * 4 },
  { refId: 'm-train-code', kind: 'material', collectedAt: Date.now() - H * 3 },
  { refId: 'm-distill-web', kind: 'material', collectedAt: Date.now() - H * 2 },
  { refId: 'm-inspo-img', kind: 'material', collectedAt: Date.now() - H * 1 },
]

const SEED_LINKS: BrainLink[] = [
  { from: 'note-seed-1', to: 'f1-1' }, // 反向传播理解 → 引用 PyTorch 入门笔记
  { from: 'note-seed-2', to: 'f2-2' }, // 读书方法 → 引用 卡片笔记法
  { from: 'note-seed-2', to: 'note-seed-1' }, // 读书方法 → 提到反向传播那篇
  { from: 'm-transformer-md', to: 'm-attn-pdf' }, // Transformer 精读 → 原论文
  { from: 'm-transformer-md', to: 'f2-2' }, // Transformer 精读 → 卡片笔记法
  { from: 'note-seed-1', to: 'm-stanford-video' }, // 反向传播理解 → 斯坦福公开课
  { from: 'm-loss-img', to: 'f1-1' }, // 损失曲线 → PyTorch 入门
  { from: 'm-train-code', to: 'm-attn-pdf' }, // 训练代码 → 论文
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

const readPages = () => readJSON<BrainPage>(PAGES_KEY, SEED_PAGES)
const writePages = (v: BrainPage[]) => writeJSON(PAGES_KEY, v)
const readLinks = () => readJSON<BrainLink>(LINKS_KEY, SEED_LINKS)
const writeLinks = (v: BrainLink[]) => writeJSON(LINKS_KEY, v)

/** 种子:模拟「你最近碰过这几件」,让「继续看」一进门就不空。接后端后删除。 */
const SEED_OPENED: Record<string, number> = {
  'm-transformer-md': Date.now() - H * 2,
  'note-seed-1': Date.now() - H * 5,
  'm-attn-pdf': Date.now() - H * 26,
}
function readOpened(): Record<string, number> {
  if (typeof window === 'undefined') return SEED_OPENED
  try {
    const raw = window.localStorage.getItem(OPENED_KEY)
    if (raw === null) {
      window.localStorage.setItem(OPENED_KEY, JSON.stringify(SEED_OPENED))
      return SEED_OPENED
    }
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}
function writeOpened(v: Record<string, number>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OPENED_KEY, JSON.stringify(v))
  } catch {
    /* 忽略存储失败 */
  }
}

/* ------------------------------ 变更广播 ------------------------------ */

type Listener = () => void
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((fn) => fn())

/* ------------------------------ 公开 API ------------------------------ */

/** 全部页面,按收藏时间倒序。 */
export function getPages(): BrainPage[] {
  return readPages().sort((a, b) => b.collectedAt - a.collectedAt)
}

export function isCollected(refId: string): boolean {
  return readPages().some((p) => p.refId === refId)
}

/** 把一个对象收藏进大脑(幂等)。 */
export function collect(refId: string, kind: PageKind) {
  const pages = readPages()
  if (pages.some((p) => p.refId === refId)) return
  writePages([{ refId, kind, collectedAt: Date.now() }, ...pages])
  emit()
}

/** 移出大脑,并断掉与它相关的所有链接。 */
export function uncollect(refId: string) {
  writePages(readPages().filter((p) => p.refId !== refId))
  writeLinks(readLinks().filter((l) => l.from !== refId && l.to !== refId))
  emit()
}

export function getLinks(): BrainLink[] {
  return readLinks()
}

/* ------------------------------ 最近打开 ------------------------------ */

/** 记一笔「刚打开过 refId」。门面的「继续看」据此排序。 */
export function markOpened(refId: string) {
  writeOpened({ ...readOpened(), [refId]: Date.now() })
  emit()
}

/** 最近打开过的 refId,按时间倒序(只保留仍在大脑里的)。 */
export function recentlyOpened(limit = 6): string[] {
  const opened = readOpened()
  const alive = new Set(readPages().map((p) => p.refId))
  return Object.keys(opened)
    .filter((id) => alive.has(id))
    .sort((a, b) => opened[b] - opened[a])
    .slice(0, limit)
}

/** 最近收藏进来的 refId,按收藏时间倒序。 */
export function recentlyCollected(limit = 6): string[] {
  return getPages()
    .slice(0, limit)
    .map((p) => p.refId)
}

/** from → to 的出链目标(refId 列表)。 */
export function outgoing(refId: string): string[] {
  return readLinks()
    .filter((l) => l.from === refId)
    .map((l) => l.to)
}

/** 反向链接:谁链到了 refId。第二大脑的核心。 */
export function backlinks(refId: string): string[] {
  return readLinks()
    .filter((l) => l.to === refId)
    .map((l) => l.from)
}

export function addLink(from: string, to: string) {
  if (from === to) return
  const links = readLinks()
  if (links.some((l) => l.from === from && l.to === to)) return
  writeLinks([...links, { from, to }])
  emit()
}

export function removeLink(from: string, to: string) {
  writeLinks(readLinks().filter((l) => !(l.from === from && l.to === to)))
  emit()
}

/* ------------------------------ 内容解析 ------------------------------ */

export interface ResolvedPage {
  refId: string
  kind: PageKind
  title: string
  collectedAt: number
  /** 材料的具体格式(仅 kind==='material' 时有),供 UI 选图标/颜色。 */
  materialKind?: 'markdown' | 'pdf' | 'web' | 'image' | 'video' | 'audio' | 'code'
  /** 画廊卡片缩略图(仅材料且有预览时)。 */
  thumbnail?: string
  /** 对象是否还存在(笔记可能被删)。 */
  exists: boolean
}

/** 把一个 BrainPage 解析成可展示的标题等(内容真身仍在各自 store)。 */
export function resolvePage(page: BrainPage): ResolvedPage {
  if (page.kind === 'note') {
    const note = getNote(page.refId)
    return {
      refId: page.refId,
      kind: 'note',
      title: note?.title || '无标题笔记',
      collectedAt: page.collectedAt,
      exists: !!note,
    }
  }
  const mat = getMaterial(page.refId)
  return {
    refId: page.refId,
    kind: 'material',
    title: mat?.title ?? '(材料已不存在)',
    collectedAt: page.collectedAt,
    materialKind: mat?.kind,
    thumbnail: mat?.thumbnail,
    exists: !!mat,
  }
}

export function resolveById(refId: string): ResolvedPage | undefined {
  const page = readPages().find((p) => p.refId === refId)
  return page ? resolvePage(page) : undefined
}

/* ------------------------------ React 绑定 ------------------------------ */

/**
 * 响应式读取大脑。任一处收藏/断链,全局同步刷新。
 * revision 只用于触发重渲染;实际数据每次从上面的纯函数现取。
 */
export function useBrain() {
  const [, setRev] = useState(0)

  useEffect(() => {
    const refresh = () => setRev((n) => n + 1)
    listeners.add(refresh)
    return () => {
      listeners.delete(refresh)
    }
  }, [])

  return {
    pages: getPages(),
    isCollected,
    collect: useCallback((refId: string, kind: PageKind) => collect(refId, kind), []),
    uncollect: useCallback((refId: string) => uncollect(refId), []),
    addLink: useCallback((from: string, to: string) => addLink(from, to), []),
    removeLink: useCallback((from: string, to: string) => removeLink(from, to), []),
    markOpened: useCallback((refId: string) => markOpened(refId), []),
    getLinks,
    recentlyOpened,
    recentlyCollected,
    outgoing,
    backlinks,
    resolvePage,
    resolveById,
  }
}
