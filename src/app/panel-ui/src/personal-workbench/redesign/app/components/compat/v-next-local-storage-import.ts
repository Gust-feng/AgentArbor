import type { Assignment, BrainLink, BrainPage, Note, Theme } from '../personalKnowledgeTypes'

const KEYS = ['aa.notes', 'aa.brain.pages.v3', 'aa.brain.links.v3', 'aa.brain.opened.v1', 'aa.themes.v1', 'aa.assignments.v1'] as const
const HOUR = 60 * 60 * 1000

/** Delete this module after the next release has imported the redesign prototype data. */
export function readNextReleaseLegacyData(): {
  notes: Note[]
  pages: BrainPage[]
  links: BrainLink[]
  themes: Theme[]
  assignments: Assignment[]
  recentlyOpened: Record<string, number>
} {
  const now = Date.now()
  return {
    notes: read('aa.notes', [
      {
        id: 'note-seed-1', spaceId: '', title: '反向传播:我自己的理解',
        body: '# 反向传播:我自己的理解\n\n先记下来,慢慢改。\n\n反向传播说到底就是**链式法则**沿着计算图往回走。前向算出每个节点的值,反向算出损失对每个节点的偏导。\n\n## 卡住的地方\n\n- 为什么梯度要"累加"? 因为一个节点可能被多条路径用到。\n- optimizer.zero_grad() 到底清的是什么?\n\n## 下一步\n\n- 手推一遍两层网络\n- 对照 PyTorch 的 autograd 再看一次',
        createdAt: now - HOUR * 48, updatedAt: now - HOUR, revision: 1,
      },
      {
        id: 'note-seed-2', spaceId: '', title: '读书方法:试试不同的方向',
        body: '# 读书方法:试试不同的方向\n\n从记事本开始,不预设结构。\n\n一个想法:每读完一节,先用**自己的话**重写一遍,再想它和已有笔记能连到哪里。连接比记录重要。',
        createdAt: now - HOUR * 24, updatedAt: now - HOUR * 24, revision: 1,
      },
    ]).map((note) => ({ ...note, spaceId: note.spaceId || 'legacy', revision: note.revision || 1 })),
    pages: read('aa.brain.pages.v3', [
      { refId: 'note-seed-1', kind: 'note', collectedAt: now - HOUR * 30 },
      { refId: 'note-seed-2', kind: 'note', collectedAt: now - HOUR * 20 },
      { refId: 'f1-1', kind: 'material', collectedAt: now - HOUR * 50 },
      { refId: 'f2-2', kind: 'material', collectedAt: now - HOUR * 12 },
      { refId: 'm-attn-pdf', kind: 'material', collectedAt: now - HOUR * 8 },
      { refId: 'm-transformer-md', kind: 'material', collectedAt: now - HOUR * 7 },
      { refId: 'm-loss-img', kind: 'material', collectedAt: now - HOUR * 6 },
      { refId: 'm-stanford-video', kind: 'material', collectedAt: now - HOUR * 5 },
      { refId: 'm-podcast-audio', kind: 'material', collectedAt: now - HOUR * 4 },
      { refId: 'm-train-code', kind: 'material', collectedAt: now - HOUR * 3 },
      { refId: 'm-distill-web', kind: 'material', collectedAt: now - HOUR * 2 },
      { refId: 'm-inspo-img', kind: 'material', collectedAt: now - HOUR },
    ]),
    links: read('aa.brain.links.v3', [
      { from: 'note-seed-1', to: 'f1-1' },
      { from: 'note-seed-2', to: 'f2-2' },
      { from: 'note-seed-2', to: 'note-seed-1' },
      { from: 'm-transformer-md', to: 'm-attn-pdf' },
      { from: 'm-transformer-md', to: 'f2-2' },
      { from: 'note-seed-1', to: 'm-stanford-video' },
      { from: 'm-loss-img', to: 'f1-1' },
      { from: 'm-train-code', to: 'm-attn-pdf' },
    ]),
    themes: read('aa.themes.v1', [
      { id: 't-transformer', name: 'Transformer', color: '#6865a7', origin: 'agent' },
      { id: 't-training', name: '训练与实践', color: '#c07a55', origin: 'agent' },
      { id: 't-method', name: '读书与方法', color: '#6f8778', origin: 'agent' },
      { id: 't-inspo', name: '灵感与杂谈', color: '#8a6aa0', origin: 'agent' },
    ]),
    assignments: read('aa.assignments.v1', [
      { refId: 'm-attn-pdf', themeId: 't-transformer', by: 'agent', locked: false },
      { refId: 'm-transformer-md', themeId: 't-transformer', by: 'agent', locked: false },
      { refId: 'm-train-code', themeId: 't-transformer', by: 'agent', locked: false },
      { refId: 'f1-1', themeId: 't-training', by: 'agent', locked: false },
      { refId: 'm-train-code', themeId: 't-training', by: 'agent', locked: false },
      { refId: 'm-loss-img', themeId: 't-training', by: 'agent', locked: false },
      { refId: 'note-seed-1', themeId: 't-training', by: 'agent', locked: false },
      { refId: 'm-stanford-video', themeId: 't-training', by: 'agent', locked: false },
      { refId: 'f2-2', themeId: 't-method', by: 'agent', locked: false },
      { refId: 'note-seed-2', themeId: 't-method', by: 'agent', locked: false },
      { refId: 'm-transformer-md', themeId: 't-method', by: 'agent', locked: false },
      { refId: 'm-inspo-img', themeId: 't-inspo', by: 'agent', locked: false },
      { refId: 'm-podcast-audio', themeId: 't-inspo', by: 'agent', locked: false },
      { refId: 'm-distill-web', themeId: 't-inspo', by: 'agent', locked: false },
    ]),
    recentlyOpened: readRecord('aa.brain.opened.v1', {
      'm-transformer-md': now - HOUR * 2,
      'note-seed-1': now - HOUR * 5,
      'm-attn-pdf': now - HOUR * 26,
    }),
  }
}

export function clearNextReleaseLegacyData(): void {
  if (typeof window === 'undefined') return
  for (const key of KEYS) window.localStorage.removeItem(key)
  window.localStorage.setItem('aa.sqlite-import.v1', 'completed')
}

function read<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T[]
  } catch { return fallback }
}

function readRecord(key: string, fallback: Record<string, number>): Record<string, number> {
  if (typeof window === 'undefined') return fallback
  try { return JSON.parse(window.localStorage.getItem(key) ?? JSON.stringify(fallback)) as Record<string, number> } catch { return fallback }
}
