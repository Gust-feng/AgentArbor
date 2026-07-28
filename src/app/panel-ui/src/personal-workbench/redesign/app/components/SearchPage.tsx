import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, FileText, Globe, MessageSquare, NotebookPen, ArrowRight, X } from 'lucide-react'
import { type View } from './Sidebar'
import { GUTTER, READING_WIDTH, composerSurface } from './tokens'
import { getAllNotes } from './notesStore'
import { getAllMaterials, materialSearchText } from './materials'

/**
 * 全局检索 —— 覆盖「我写的笔记」与「读进来的材料」,以及对话引用。
 *
 * 索引在渲染时即时构建(数据量小,原型足够)。接后端后应替换为服务端
 * 检索接口(全文索引 / 向量检索),本组件只保留结果的呈现与筛选。
 */

type ResultType = 'note' | 'file' | 'web' | 'conversation'
type FilterType = 'all' | ResultType

interface SearchResult {
  id: string
  name: string
  type: ResultType
  space: string
  snippet: string
  /** 搜索命中所用的全文(标题+正文),不展示。 */
  haystack: string
}

/** 对话引用暂用静态占位(对话本身的数据层尚未建立)。 */
const CONVERSATION_RESULTS: SearchResult[] = [
  {
    id: 'conv-grad',
    name: '关于梯度下降的讨论',
    type: 'conversation',
    space: '学习空间',
    snippet: '…反向传播的核心是梯度的链式法则,每一层的梯度都依赖更深层的计算结果…',
    haystack: '关于梯度下降的讨论 反向传播 链式法则 梯度',
  },
  {
    id: 'conv-bias',
    name: '认知偏见与阅读整理',
    type: 'conversation',
    space: '学习空间',
    snippet: '整合了《思考,快与慢》与认知偏见的研究框架…',
    haystack: '认知偏见与阅读整理 思考快与慢 系统1 系统2',
  },
]

/** 从一段正文里,围绕命中词截取一小段摘要。 */
function makeSnippet(text: string, query: string, fallback = ''): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return fallback
  const q = query.trim().toLowerCase()
  if (q) {
    const idx = flat.toLowerCase().indexOf(q)
    if (idx >= 0) {
      const start = Math.max(0, idx - 30)
      return (start > 0 ? '…' : '') + flat.slice(start, start + 90) + '…'
    }
  }
  return flat.slice(0, 90) + (flat.length > 90 ? '…' : '')
}

/** 材料 kind → 搜索结果类型(供筛选与图标)。 */
function materialResultType(kind: string): ResultType {
  return kind === 'web' ? 'web' : 'file'
}

const FILTER_LABELS: { key: FilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'note', label: '笔记' },
  { key: 'file', label: '材料' },
  { key: 'web', label: '网页' },
  { key: 'conversation', label: '对话' },
]

function resultIcon(type: ResultType) {
  switch (type) {
    case 'note':
      return <NotebookPen size={14} style={{ color: '#6f8778' }} />
    case 'file':
      return <FileText size={14} style={{ color: '#6A90B0' }} />
    case 'web':
      return <Globe size={14} style={{ color: '#4A8A6A' }} />
    case 'conversation':
      return <MessageSquare size={14} style={{ color: 'var(--aa-lavender-mid)' }} />
  }
}

function typeLabel(type: ResultType) {
  switch (type) {
    case 'note': return '笔记'
    case 'file': return '材料'
    case 'web': return '网页'
    case 'conversation': return '对话'
  }
}

interface SearchPageProps {
  onNavigate: (v: View) => void
  /** 在空间里打开某个笔记/材料。 */
  onOpenInSpace: (id: string) => void
}

export function SearchPage({ onNavigate, onOpenInSpace }: SearchPageProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(t)
  }, [query])

  // 构建索引:笔记 + 材料 + 对话。debouncedQuery 变化时重算摘要。
  const index = useMemo<SearchResult[]>(() => {
    const notes: SearchResult[] = getAllNotes().map((n) => ({
      id: n.id,
      name: n.title || '无标题',
      type: 'note',
      space: '学习空间',
      snippet: makeSnippet(n.body, debouncedQuery, '(空笔记)'),
      haystack: `${n.title} ${n.body}`,
    }))
    const materials: SearchResult[] = getAllMaterials().map((m) => {
      const text = materialSearchText(m)
      return {
        id: m.id,
        name: m.title,
        type: materialResultType(m.kind),
        space: '学习空间',
        snippet: makeSnippet(text, debouncedQuery, m.meta ?? ''),
        haystack: `${m.title} ${text}`,
      }
    })
    return [...notes, ...materials, ...CONVERSATION_RESULTS]
  }, [debouncedQuery])

  const filtered = useMemo(
    () =>
      index.filter((r) => {
        const matchesType = filter === 'all' || r.type === filter
        const q = debouncedQuery.trim().toLowerCase()
        const matchesQuery = !q || r.haystack.toLowerCase().includes(q)
        return matchesType && matchesQuery
      }),
    [index, debouncedQuery, filter]
  )

  const counts = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    const hits = index.filter((r) => !q || r.haystack.toLowerCase().includes(q))
    return {
      all: hits.length,
      note: hits.filter((r) => r.type === 'note').length,
      file: hits.filter((r) => r.type === 'file').length,
      web: hits.filter((r) => r.type === 'web').length,
      conversation: hits.filter((r) => r.type === 'conversation').length,
    } as Record<FilterType, number>
  }, [index, debouncedQuery])

  function handleResultClick(result: SearchResult) {
    if (result.type === 'conversation') {
      onNavigate('conv-done')
    } else {
      onOpenInSpace(result.id)
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="mx-auto pt-8 pb-16" style={{ maxWidth: READING_WIDTH, paddingLeft: GUTTER, paddingRight: GUTTER }}>
          {/* 搜索框 */}
          <div className="flex items-center gap-3 px-4 py-3 mb-5" style={composerSurface(true)}>
            <Search size={15} style={{ color: 'var(--aa-text-3)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记、材料、对话…"
              className="flex-1 text-sm outline-none"
              style={{ color: 'var(--aa-text-1)', background: 'transparent' }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-0.5 rounded shrink-0 transition-colors hover:bg-black/5"
                style={{ color: 'var(--aa-text-3)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 类型筛选 */}
          <div className="flex items-center gap-1.5 mb-5">
            {FILTER_LABELS.map(({ key, label }) => {
              const active = filter === key
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: active ? 'var(--aa-accent-bg)' : 'var(--aa-surface-hover)',
                    color: active ? 'var(--aa-accent)' : 'var(--aa-text-2)',
                    border: active ? '1px solid rgba(104,101,167,0.2)' : '1px solid transparent',
                  }}
                >
                  {label}
                  <span
                    className="rounded px-1 text-[10px]"
                    style={{
                      background: active ? 'rgba(104,101,167,0.15)' : 'rgba(45,40,34,0.07)',
                      color: active ? 'var(--aa-accent)' : 'var(--aa-text-3)',
                    }}
                  >
                    {counts[key]}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 结果计数 */}
          <p className="text-xs mb-4" style={{ color: 'var(--aa-text-3)' }}>
            {debouncedQuery.trim() ? `找到 ${filtered.length} 条结果` : `共 ${filtered.length} 个项目`}
          </p>

          {/* 结果列表 */}
          <div className="space-y-0.5">
            {filtered.map((result) => (
              <button
                key={result.id}
                className="w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-all"
                style={{ background: hoveredId === result.id ? 'var(--aa-surface-hover)' : 'transparent' }}
                onMouseEnter={() => setHoveredId(result.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => handleResultClick(result)}
              >
                <div className="mt-0.5 shrink-0">{resultIcon(result.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium" style={{ color: 'var(--aa-text-1)' }}>
                      {result.name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: 'rgba(45,40,34,0.05)', color: 'var(--aa-text-3)' }}
                    >
                      {typeLabel(result.type)}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--aa-text-3)', lineHeight: 1.65 }}>
                    {result.snippet}
                  </p>
                </div>
                <div
                  className="mt-0.5 shrink-0 transition-opacity"
                  style={{ opacity: hoveredId === result.id ? 1 : 0, color: 'var(--aa-text-3)' }}
                >
                  <ArrowRight size={13} />
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm mb-1" style={{ color: 'var(--aa-text-2)' }}>
                没有找到匹配的内容
              </p>
              <p className="text-xs" style={{ color: 'var(--aa-text-3)' }}>
                试试其他关键词,或切换到「全部」类型
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
