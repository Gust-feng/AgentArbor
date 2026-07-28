import { useCallback, useEffect, useState } from 'react'

/**
 * 笔记数据层 —— 原型阶段的单一数据源。
 * ===================================================================
 *
 * 笔记是学习空间里唯一「可写」的一等对象(区别于只读的材料 Material)。
 * 本模块把笔记的增删改查收敛到一处,当前用 localStorage 持久化,
 * 让原型「写完刷新还在」、闭环可用。
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 给后来接后端的人 (BACKEND INTEGRATION GUIDE)                 │
 * ├─────────────────────────────────────────────────────────────┤
 * │ 约定:UI 只依赖本文件导出的函数签名,不直接碰 localStorage。   │
 * │ 接后端时「只改本文件实现,不动调用方」,即可平滑替换。         │
 * │                                                               │
 * │ 1. 把 readAll()/writeAll() 换成对后端 API 的读写:            │
 * │      GET    /api/notes            → readAll                   │
 * │      POST   /api/notes            → createNote                │
 * │      PATCH  /api/notes/:id        → updateNote                │
 * │      DELETE /api/notes/:id        → deleteNote                │
 * │ 2. CRUD 将变为异步(返回 Promise);对应地把 useNotes 里的       │
 * │    同步 setState 改为「乐观更新 + 请求确认/回滚」。            │
 * │ 3. 服务端应负责:用户维度隔离(userId / 空间 spaceId)、          │
 * │    updatedAt 以服务端时钟为准、并发写入的冲突处理(last-write   │
 * │    -wins 或版本号)。这些当前在前端 stub。                      │
 * │ 4. id 现在是前端生成(genId);接后端后应改用服务端返回的 id,     │
 * │    genId 仅用于「乐观创建」时的临时占位。                       │
 * │ 5. 多端同步/实时协作若需要,可在此订阅 WebSocket 并 emit()。    │
 * └─────────────────────────────────────────────────────────────┘
 */

/**
 * 笔记 = 「Markdown 内核 + 可生长的对象层」。
 *
 * - 内核(title/body):正文是 Markdown 源文本,可导出、可迁移、不锁定用户。
 * - 对象层(links/materialRefs/…):软件专属,承载 Markdown 装不下、但理念需要
 *   的结构。这些是「结构涌现」「页边共思」「试不同方向」将来附着的实体。
 *   demo 阶段先预留类型、不实现 UI,后续填充不返工。
 */
export interface Note {
  id: string
  title: string
  /** 正文,Markdown 源文本(内核,可导出)。 */
  body: string
  /** 创建 / 最后修改时间(epoch ms)。接后端后以服务端时钟为准。 */
  createdAt: number
  updatedAt: number

  // ——— 可生长的对象层(预留,demo 暂不实现) ———
  /** 指向其它笔记 id;笔记间的链接/反链,即「涌现的结构」。 */
  links?: string[]
  /** 引用的材料 id;记录「这段理解来自哪份材料」。 */
  materialRefs?: string[]
  // 未来:页边 agent 线程(锚定到 body 的某段)、"尝试不同方向"的分支/变体等,
  // 都作为本对象的字段生长,而不是塞进 Markdown 正文。
}

const STORAGE_KEY = 'aa.notes'

/** 首次进入时的种子笔记,让空间不为空、闭环可演示。接后端后应删除。 */
const SEED_NOTES: Note[] = [
  {
    id: 'note-seed-1',
    title: '反向传播:我自己的理解',
    body: `# 反向传播:我自己的理解

先记下来,慢慢改。

反向传播说到底就是**链式法则**沿着计算图往回走。前向算出每个节点的值,反向算出损失对每个节点的偏导。

## 卡住的地方

- 为什么梯度要"累加"?→ 因为一个节点可能被多条路径用到。
- optimizer.zero_grad() 到底清的是什么?

## 下一步

- 手推一遍两层网络
- 对照 PyTorch 的 autograd 再看一次`,
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
    updatedAt: Date.now() - 1000 * 60 * 60 * 5,
  },
  {
    id: 'note-seed-2',
    title: '读书方法:试试不同的方向',
    body: `# 读书方法:试试不同的方向

从记事本开始,不预设结构。

一个想法:每读完一节,先用**自己的话**重写一遍,再想它和已有笔记能连到哪里。连接比记录重要。`,
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24,
  },
]

/* ------------------------------ 底层读写 ------------------------------ */
/* 接后端时,只需把这两个函数换成异步 API 调用即可。 */

function readAll(): Note[] {
  if (typeof window === 'undefined') return SEED_NOTES
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      // 首次:写入种子,之后以存储为准。
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_NOTES))
      return SEED_NOTES
    }
    return JSON.parse(raw) as Note[]
  } catch {
    return []
  }
}

function writeAll(notes: Note[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
  } catch {
    /* 忽略存储失败(隐私模式 / 配额) */
  }
}

/* ------------------------------ 变更广播 ------------------------------ */
/* 让分处不同组件树的订阅者(空间列表、编辑器、搜索)保持同步。          */
/* 接后端后,远端推送(WebSocket)也可复用 emit() 来触发刷新。            */

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((fn) => fn())
}

function genId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/* ------------------------------ 公开 API ------------------------------ */

/**
 * 全部笔记,按「存储数组顺序」返回 —— 即用户可手动拖拽调整的顺序。
 * 新建的笔记插在最前(见 createNote);拖拽由 reorderNotes 落盘。
 */
export function getAllNotes(): Note[] {
  return readAll()
}

export function getNote(id: string): Note | undefined {
  return readAll().find((n) => n.id === id)
}

/**
 * 新建一篇笔记并返回它(调用方通常随即选中并进入编辑)。
 * 可传入初始内容 / 对象层字段,例如「就着某份材料记一笔」时带上 materialRefs,
 * 让新笔记从诞生起就挂在知识网上。
 */
export function createNote(
  init?: Partial<Pick<Note, 'title' | 'body' | 'links' | 'materialRefs'>>
): Note {
  const now = Date.now()
  const note: Note = { id: genId(), title: '', body: '', createdAt: now, updatedAt: now, ...init }
  writeAll([note, ...readAll()])
  emit()
  return note
}

/** 局部更新;任何改动都会刷新 updatedAt。 */
export function updateNote(id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) {
  const next = readAll().map((n) =>
    n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
  )
  writeAll(next)
  emit()
}

export function deleteNote(id: string) {
  writeAll(readAll().filter((n) => n.id !== id))
  emit()
}

/** 按给定 id 顺序重排笔记(拖拽落盘)。缺失的 id 忽略,未列出的补在末尾。 */
export function reorderNotes(orderedIds: string[]) {
  const byId = new Map(readAll().map((n) => [n.id, n]))
  const next: Note[] = []
  for (const id of orderedIds) {
    const n = byId.get(id)
    if (n) {
      next.push(n)
      byId.delete(id)
    }
  }
  // 任何未在 orderedIds 里出现的,保序补到末尾(防御性)。
  for (const n of readAll()) if (byId.has(n.id)) next.push(n)
  writeAll(next)
  emit()
}

/* ------------------------------ React 绑定 ------------------------------ */

/**
 * 响应式读取全部笔记 + CRUD。订阅 store 变更,任一处改动全局同步。
 * 接后端后:内部 setState 保持不变,CRUD 改为异步并在 resolve 后 emit()。
 */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(() => getAllNotes())

  useEffect(() => {
    const refresh = () => setNotes(getAllNotes())
    listeners.add(refresh)
    return () => {
      listeners.delete(refresh)
    }
  }, [])

  return {
    notes,
    create: useCallback(
      (init?: Partial<Pick<Note, 'title' | 'body' | 'links' | 'materialRefs'>>) =>
        createNote(init),
      []
    ),
    update: useCallback(
      (id: string, patch: Partial<Pick<Note, 'title' | 'body'>>) => updateNote(id, patch),
      []
    ),
    remove: useCallback((id: string) => deleteNote(id), []),
    reorder: useCallback((orderedIds: string[]) => reorderNotes(orderedIds), []),
  }
}
