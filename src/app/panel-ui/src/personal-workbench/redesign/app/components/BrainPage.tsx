import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  NotebookPen,
  FileText,
  Globe,
  Image as ImageIcon,
  Film,
  Link2,
  CornerUpLeft,
  Plus,
  X,
  Trash2,
  ChevronLeft,
  Search,
  Music,
  Code2,
  Sparkles,
  Tag,
  Lock,
  Check,
  Clock,
  LayoutGrid,
} from 'lucide-react'
import { getNote } from './notesStore'
import { CodeDocumentSurface } from './CodeDocumentSurface'
import { MarkdownDocumentSurface } from './MarkdownDocumentSurface'
import { useBrain, type ResolvedPage } from './brainStore'
import { useThemes, type Theme } from './themesStore'
import { ImageWithFallback } from './figma/ImageWithFallback'
import type { PersonalSpaceProjection } from '../../../space'
import { ReferencePreview } from './ReferencePreview'
import { fetchSpaceReferencePreview, getCachedReferencePreview } from './referencePreviewClient'

/**
 * 知识库 —— 顶层场所(见 docs/概念与设计.md §5)。
 *
 * 门面是「卡片画廊」,不是文件列表:进门第一眼要轻,大量留白,
 * 顶部只有一排轻筛选(类型 + 搜索)。降低心智负担——不逼用户先在
 * 「资源库 vs wiki」之间做选择。
 *
 * 「资源库 / wiki」降级为用时才出现的透镜:点开一张卡片进入阅读态,
 * 链接 / 反向链接(第二大脑的核心机制)才作为右栏透镜出现。
 */

type Kind = 'all' | 'note' | 'file' | 'pdf' | 'web' | 'image' | 'video' | 'audio' | 'code'

const FILTERS: { key: Kind; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'note', label: '笔记' },
  { key: 'file', label: '文件' },
  { key: 'pdf', label: 'PDF' },
  { key: 'web', label: '网页' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'code', label: '代码' },
]

function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return '刚刚'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)} 分钟前`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)} 小时前`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)} 天前`
  return `${Math.floor(d / 7)} 周前`
}

function pageIcon(p: ResolvedPage, size = 13) {
  if (p.kind === 'note') return <NotebookPen size={size} style={{ color: '#6f8778' }} />
  switch (p.materialKind) {
    case 'web':
      return <Globe size={size} style={{ color: '#6686a2' }} />
    case 'image':
      return <ImageIcon size={size} style={{ color: '#7d8a63' }} />
    case 'video':
      return <Film size={size} style={{ color: '#8a6aa0' }} />
    case 'audio':
      return <Music size={size} style={{ color: '#b0885a' }} />
    case 'code':
      return <Code2 size={size} style={{ color: '#5f8a86' }} />
    default:
      return <FileText size={size} style={{ color: '#c07a55' }} />
  }
}

const kindLabel = (p: ResolvedPage) =>
  p.kind === 'note'
    ? '笔记'
    : { file: '文件', pdf: 'PDF', web: '网页', image: '图片', video: '视频', markdown: 'Markdown', audio: '音频', code: '代码' }[
        p.materialKind ?? 'pdf'
      ]

function matchesFilter(p: ResolvedPage, f: Kind): boolean {
  if (f === 'all') return true
  if (f === 'note') return p.kind === 'note'
  return p.kind !== 'note' && p.materialKind === f
}

function clean(src: string | undefined): string {
  if (!src) return ''
  return src
    .replace(/\\n/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

/** 一段如实的文字摘要:笔记 / Markdown / 网页 / PDF 都取各自真实正文。 */
function previewText(p: ResolvedPage): string {
  if (p.kind === 'note') return clean(getNote(p.refId)?.bodyMarkdown).slice(0, 280)
  return clean(p.previewText).slice(0, 280)
}

export function BrainPage({
  selectedId,
  onSelect,
  spaces,
  onOpenSpaceReference,
}: {
  // 当前打开的文件 id 提升到 App 管理,好让顶栏渲染「知识库 › 文件」的路径面包屑。
  selectedId: string | null
  onSelect: (id: string | null) => void
  spaces: readonly PersonalSpaceProjection[]
  onOpenSpaceReference: (spaceId: string, itemId: string) => void
}) {
  const brain = useBrain(spaces)
  const themeApi = useThemes()
  const [filter, setFilter] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  // 左栏导航当前落点:'recent'(最近)/'all'(全部)/'unclassified'(未归类)/ 或某个 themeId。
  const [nav, setNav] = useState<string>('recent')
  // 是否进入 Wiki 堆叠阅读(知识库的「进阶形态」)。起点由用户在视图内选。
  const [wikiOpen, setWikiOpen] = useState(false)

  const resolved = useMemo(() => brain.pages.map(brain.resolvePage), [brain.pages])
  const byId = useMemo(() => {
    const m = new Map<string, ResolvedPage>()
    resolved.forEach((p) => m.set(p.refId, p))
    return m
  }, [resolved])

  const searching = query.trim().length > 0

  // 搜索结果:命中标题或正文即算。取用优先——带着念头进来直接捞。
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return resolved
      .filter((p) => matchesFilter(p, filter))
      .filter((p) => p.title.toLowerCase().includes(q) || previewText(p).toLowerCase().includes(q))
      .sort((a, b) => b.collectedAt - a.collectedAt)
  }, [resolved, filter, query])

  // 主题透镜里用的全量卡片(不受搜索影响,只受类型筛选)。
  const cards = useMemo(
    () => [...resolved].filter((p) => matchesFilter(p, filter)).sort((a, b) => b.collectedAt - a.collectedAt),
    [resolved, filter]
  )

  const selected = resolved.find((p) => p.refId === selectedId) ?? null
  const degreeOf = (refId: string) => brain.outgoing(refId).length + brain.backlinks(refId).length
  const openCard = (refId: string) => {
    brain.markOpened(refId) // 记一笔「继续看」
    onSelect(refId)
  }

  // 进入堆叠阅读(Wiki)。起点在视图内由用户选择,不预选。
  if (wikiOpen) {
    return <WikiView brain={brain} resolved={resolved} onExit={() => setWikiOpen(false)} />
  }

  // 进入阅读态 —— 链接透镜在此出现。
  if (selected) {
    return (
      <ReadingView
        page={selected}
        resolved={resolved}
        brain={brain}
        onBack={() => onSelect(null)}
        onOpen={openCard}
        onOpenSpaceReference={onOpenSpaceReference}
      />
    )
  }

  const resume = brain.recentlyOpened(6).map((id) => byId.get(id)).filter(Boolean) as ResolvedPage[]
  const recent = brain.recentlyCollected(8).map((id) => byId.get(id)).filter(Boolean) as ResolvedPage[]

  // 当前左栏落点对应的卡片(搜索时右主区改由 results 接管)。
  const navCards =
    nav === 'all'
      ? cards
      : nav === 'unclassified'
        ? cards.filter((c) => themeApi.themesOf(c.refId).length === 0)
        : nav === 'recent'
          ? []
          : cards.filter((c) => themeApi.themesOf(c.refId).includes(nav))
  const activeTheme = themeApi.themes.find((t) => t.id === nav) ?? null

  if (resolved.length === 0) {
    return (
      <section className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <EmptyState />
      </section>
    )
  }

  return (
    <section className="flex-1 flex" style={{ minHeight: 0 }}>
      {/* ── 左栏:纯导航入口 ── */}
      <LeftNav
        nav={nav}
        setNav={(n) => {
          setNav(n)
          setQuery('')
        }}
        total={resolved.length}
        cards={cards}
        themeApi={themeApi}
        onEnterWiki={() => setWikiOpen(true)}
      />

      {/* ── 右主区:搜索框 + 随导航切换的内容 ── */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <div className="mx-auto w-full px-10 py-10" style={{ maxWidth: 860 }}>
          {/* 搜索框:任何时候都能盖过导航直接取用 */}
          <div
            className="flex items-center gap-3 px-4 rounded-2xl mb-9"
            style={{
              height: 48,
              background: 'var(--aa-surface, #fff)',
              border: `1px solid ${searching ? 'var(--aa-accent, #6865a7)' : 'var(--aa-border, rgba(45,40,34,0.1))'}`,
              boxShadow: searching ? '0 4px 16px rgba(104,101,167,0.12)' : '0 1px 2px rgba(45,40,34,0.03)',
              transition: 'all .15s',
            }}
          >
            <Search size={17} style={{ color: searching ? 'var(--aa-accent, #6865a7)' : 'var(--aa-text-3, #aba39b)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="想找点什么?搜标题、正文,或直接问……"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--aa-text-1, #292722)' }}
            />
            {searching && (
              <button onClick={() => setQuery('')} className="p-1 rounded-full hover:bg-black/5">
                <X size={15} style={{ color: 'var(--aa-text-3, #aba39b)' }} />
              </button>
            )}
          </div>

          {searching ? (
            <SearchResults
              results={results}
              filter={filter}
              setFilter={setFilter}
              degreeOf={degreeOf}
              themeApi={themeApi}
              onOpen={openCard}
            />
          ) : nav === 'recent' ? (
            <div className="space-y-10">
              {resume.length > 0 && (
                <Strip title="继续看" pages={resume} degreeOf={degreeOf} themeApi={themeApi} onOpen={openCard} />
              )}
              <Strip title="最近收藏" pages={recent} degreeOf={degreeOf} themeApi={themeApi} onOpen={openCard} />
            </div>
          ) : (
            <div>
              {/* 主区标题:全部 / 未归类 / 某主题(主题可改名、删) */}
              {activeTheme ? (
                <ThemeHeader theme={activeTheme} count={navCards.length} themeApi={themeApi} onDeleted={() => setNav('recent')} />
              ) : (
                <h2 className="m-0 mb-5 text-sm font-semibold" style={{ color: 'var(--aa-text-2, #87827c)' }}>
                  {nav === 'all' ? '全部' : '未归类'}
                  <span className="ml-2" style={{ color: 'var(--aa-text-3, #aba39b)', fontWeight: 400 }}>
                    {navCards.length}
                  </span>
                </h2>
              )}
              {navCards.length === 0 ? (
                <p className="py-16 text-center text-sm" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                  这里还没有东西。
                </p>
              ) : (
                <CardGrid>
                  {navCards.map((p) => (
                    <Card key={p.refId} page={p} degree={degreeOf(p.refId)} themeApi={themeApi} onOpen={() => openCard(p.refId)} />
                  ))}
                </CardGrid>
              )}
            </div>
          )}
        </div>
      </div>

    </section>
  )
}

/* ------------------------------ Wiki 入口面板 ------------------------------ */

/**
 * 「知识库」标题 —— 文字本身就是按钮,带动效。
 * 平时是安静的标题;悬停时逐字轻轻上浮、染成主题色,
 * 底下一条链式下划线从左画到右,末尾冒出「顺着链接逛」的小提示。
 * 点它 = 进入链式浏览(Wiki),把知识库逛成一张网。
 */
function WikiTitle({ onEnter }: { onEnter?: () => void }) {
  const chars = '知识库'.split('')
  return (
    <motion.button
      onClick={onEnter}
      disabled={!onEnter}
      initial="rest"
      animate="rest"
      whileHover={onEnter ? 'hover' : undefined}
      whileTap={onEnter ? { scale: 0.97 } : undefined}
      className="group relative inline-flex items-center gap-1.5"
      style={{ cursor: onEnter ? 'pointer' : 'default' }}
    >
      <span className="inline-flex">
        {chars.map((c, i) => (
          <motion.span
            key={i}
            className="text-lg font-semibold leading-none transition-colors group-hover:text-[#6865a7]"
            style={{ color: '#292722' }}
            variants={{ rest: { y: 0 }, hover: { y: -2 } }}
            transition={{ type: 'spring', stiffness: 320, damping: 15, delay: i * 0.05 }}
          >
            {c}
          </motion.span>
        ))}
      </span>

      {/* 悬停冒出的小提示 */}
      <motion.span
        className="flex items-center gap-1 text-xs whitespace-nowrap"
        style={{ color: 'var(--aa-accent, #6865a7)' }}
        variants={{ rest: { opacity: 0, x: -6 }, hover: { opacity: 1, x: 0 } }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <Link2 size={12} />
        顺着链接逛
      </motion.span>

      {/* 链式下划线:从左画到右 */}
      <motion.span
        className="absolute left-0 rounded-full"
        style={{ bottom: -4, height: 2, width: '100%', background: 'var(--aa-accent, #6865a7)', transformOrigin: 'left' }}
        variants={{ rest: { scaleX: 0, opacity: 0 }, hover: { scaleX: 1, opacity: 1 } }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      />
    </motion.button>
  )
}

/* ------------------------------ 左栏导航 ------------------------------ */

function LeftNav({
  nav,
  setNav,
  total,
  cards,
  themeApi,
  onEnterWiki,
}: {
  nav: string
  setNav: (n: string) => void
  total: number
  cards: ResolvedPage[]
  themeApi: ReturnType<typeof useThemes>
  onEnterWiki?: () => void
}) {
  const countIn = (themeId: string) => cards.filter((c) => themeApi.themesOf(c.refId).includes(themeId)).length
  const unclassifiedCount = cards.filter((c) => themeApi.themesOf(c.refId).length === 0).length
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  return (
    <nav
      className="shrink-0 overflow-y-auto"
      style={{
        width: 224,
        borderRight: '1px solid var(--aa-border, rgba(45,40,34,0.08))',
        background: 'var(--aa-surface-2, #faf8f5)',
      }}
    >
      <div className="px-4 py-6">
        <div className="mb-5 px-2">
          <WikiTitle onEnter={onEnterWiki} />
        </div>

        <div className="space-y-0.5">
          <NavItem icon={<Clock size={15} />} label="最近" active={nav === 'recent'} onClick={() => setNav('recent')} />
          <NavItem icon={<LayoutGrid size={15} />} label="全部" count={total} active={nav === 'all'} onClick={() => setNav('all')} />
        </div>

        <div className="mt-6 mb-2 px-2 flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
            主题
          </span>
          <button
            onClick={() => setAdding(true)}
            className="p-0.5 rounded hover:bg-black/5"
            style={{ color: 'var(--aa-text-3, #aba39b)' }}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="space-y-0.5">
          {themeApi.themes.map((t) => (
            <NavItem
              key={t.id}
              icon={<span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />}
              label={t.name}
              count={countIn(t.id)}
              active={nav === t.id}
              agent={t.origin === 'agent'}
              onClick={() => setNav(t.id)}
            />
          ))}
          {unclassifiedCount > 0 && (
            <NavItem
              icon={<span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--aa-text-3, #cfc9c1)' }} />}
              label="未归类"
              count={unclassifiedCount}
              active={nav === 'unclassified'}
              onClick={() => setNav('unclassified')}
            />
          )}
          {adding && (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim()) {
                  const id = themeApi.createTheme(name)
                  setNav(id)
                }
                setName('')
                setAdding(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setName('')
                  setAdding(false)
                }
              }}
              placeholder="主题名…"
              className="w-full px-2 py-1.5 rounded-lg bg-transparent outline-none text-sm"
              style={{ color: 'var(--aa-text-1, #292722)', border: '1px solid var(--aa-accent, #6865a7)' }}
            />
          )}
        </div>
      </div>
    </nav>
  )
}

function NavItem({
  icon,
  label,
  count,
  active,
  agent,
  onClick,
}: {
  icon: ReactNode
  label: string
  count?: number
  active?: boolean
  agent?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg text-left transition-colors"
      style={{
        background: active ? 'var(--aa-accent, #6865a7)' : 'transparent',
        color: active ? '#fff' : 'var(--aa-text-1, #292722)',
      }}
    >
      <span className="shrink-0 flex items-center justify-center" style={{ width: 15, opacity: active ? 1 : 0.7 }}>
        {icon}
      </span>
      <span className="flex-1 truncate text-sm">{label}</span>
      {agent && <Sparkles size={11} style={{ opacity: active ? 0.9 : 0.5 }} />}
      {count != null && (
        <span className="text-xs" style={{ opacity: 0.6 }}>
          {count}
        </span>
      )}
    </button>
  )
}

/* 主区里某个主题的标题条:改名 / 删除 / agent 标记。 */
function ThemeHeader({
  theme,
  count,
  themeApi,
  onDeleted,
}: {
  theme: Theme
  count: number
  themeApi: ReturnType<typeof useThemes>
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(theme.name)
  return (
    <div className="flex items-center gap-2 mb-5">
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: theme.color }} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            themeApi.renameTheme(theme.id, draft)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(theme.name)
              setEditing(false)
            }
          }}
          className="text-base font-semibold bg-transparent outline-none border-b"
          style={{ color: 'var(--aa-text-1, #292722)', borderColor: theme.color }}
        />
      ) : (
        <h2
          className="m-0 text-base font-semibold cursor-text"
          style={{ color: 'var(--aa-text-1, #292722)' }}
          onClick={() => (setDraft(theme.name), setEditing(true))}
        >
          {theme.name}
        </h2>
      )}
      <span className="text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
        {count}
      </span>
      {theme.origin === 'agent' && (
        <span
          className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
          style={{ background: '#6865a712', color: 'var(--aa-accent, #6865a7)' }}
        >
          <Sparkles size={10} />
          agent
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => {
          themeApi.deleteTheme(theme.id)
          onDeleted()
        }}
        className="p-1 rounded hover:bg-black/5"
        style={{ color: 'var(--aa-text-3, #aba39b)' }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

/* ------------------------------ 主题分段 ------------------------------ */

function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {children}
    </div>
  )
}

/* ---------------------- 静息态:横排小条 ---------------------- */

function Strip({
  title,
  pages,
  degreeOf,
  themeApi,
  onOpen,
}: {
  title: string
  pages: ResolvedPage[]
  degreeOf: (refId: string) => number
  themeApi: ReturnType<typeof useThemes>
  onOpen: (refId: string) => void
}) {
  return (
    <div>
      <h2 className="m-0 mb-3 text-sm font-semibold" style={{ color: 'var(--aa-text-2, #87827c)' }}>
        {title}
      </h2>
      <CardGrid>
        {pages.map((p) => (
          <Card key={p.refId} page={p} degree={degreeOf(p.refId)} themeApi={themeApi} onOpen={() => onOpen(p.refId)} />
        ))}
      </CardGrid>
    </div>
  )
}

/* ---------------------- 搜索态:命中平铺 ---------------------- */

function SearchResults({
  results,
  filter,
  setFilter,
  degreeOf,
  themeApi,
  onOpen,
}: {
  results: ResolvedPage[]
  filter: Kind
  setFilter: (k: Kind) => void
  degreeOf: (refId: string) => number
  themeApi: ReturnType<typeof useThemes>
  onOpen: (refId: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <span className="text-sm" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          {results.length} 个结果
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <FilterChip key={f.key} active={filter === f.key} label={f.label} onClick={() => setFilter(f.key)} />
          ))}
        </div>
      </div>
      {results.length === 0 ? (
        <p className="py-16 text-center text-sm" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          没有命中的东西。
        </p>
      ) : (
        <CardGrid>
          {results.map((p) => (
            <Card key={p.refId} page={p} degree={degreeOf(p.refId)} themeApi={themeApi} onOpen={() => onOpen(p.refId)} />
          ))}
        </CardGrid>
      )}
    </div>
  )
}

/* ------------------------------ 阅读态(链接透镜) ------------------------------ */

function ReadingView({
  page,
  resolved,
  brain,
  onBack,
  onOpen,
  onOpenSpaceReference,
}: {
  page: ResolvedPage
  resolved: ResolvedPage[]
  brain: ReturnType<typeof useBrain>
  onBack: () => void
  onOpen: (id: string) => void
  onOpenSpaceReference: (spaceId: string, itemId: string) => void
}) {
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const outIds = brain.outgoing(page.refId)
  const backIds = brain.backlinks(page.refId)
  const linkableTargets = resolved.filter((p) => p.refId !== page.refId && !outIds.includes(p.refId))

  return (
    <section className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* 路径面包屑(知识库 › 文件)已上移到顶栏;这里只留内容操作。 */}
        <header className="shrink-0 flex items-center gap-2 px-5" style={{ height: 44 }}>
          <div className="flex-1" />
          <button
            onClick={() => {
              brain.uncollect(page.refId)
              onBack()
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-3, #aba39b)' }}
          >
            <Trash2 size={12} />
            移出
          </button>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <PageContent page={page} onOpenSpaceReference={onOpenSpaceReference} />
        </div>
      </div>

      {/* 右:链接 + 反向链接(透镜) */}
      <div
        className="shrink-0 flex flex-col overflow-y-auto"
        style={{ width: 256, borderLeft: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
      >
        <div className="px-4 py-4">
          <SectionHead icon={<CornerUpLeft size={12} />} label="反向链接" count={backIds.length} />
          {backIds.length === 0 ? (
            <p className="text-xs mb-5" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              还没有页面链到这里。
            </p>
          ) : (
            <div className="space-y-1 mb-5">
              {backIds.map((id) => {
                const rp = resolved.find((p) => p.refId === id)
                if (!rp) return null
                return <LinkChip key={id} page={rp} onClick={() => onOpen(id)} />
              })}
            </div>
          )}

          <SectionHead icon={<Link2 size={12} />} label="链接到" count={outIds.length} />
          <div className="space-y-1">
            {outIds.map((id) => {
              const rp = resolved.find((p) => p.refId === id)
              if (!rp) return null
              return (
                <LinkChip
                  key={id}
                  page={rp}
                  onClick={() => onOpen(id)}
                  onRemove={() => brain.removeLink(page.refId, id)}
                />
              )
            })}
          </div>

          {linkPickerOpen ? (
            <div className="mt-2 rounded-md p-1" style={{ border: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}>
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                  链接到…
                </span>
                <button onClick={() => setLinkPickerOpen(false)} style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                  <X size={12} />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {linkableTargets.length === 0 ? (
                  <p className="px-1.5 py-2 text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                    没有可链接的其它页面。
                  </p>
                ) : (
                  linkableTargets.map((p) => (
                    <button
                      key={p.refId}
                      onClick={() => {
                        brain.addLink(page.refId, p.refId)
                        setLinkPickerOpen(false)
                      }}
                      className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded text-left text-xs transition-colors hover:bg-black/5"
                      style={{ color: 'var(--aa-text-1, #292722)' }}
                    >
                      {pageIcon(p, 12)}
                      <span className="flex-1 truncate">{p.title}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setLinkPickerOpen(true)}
              className="mt-2 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
              style={{ color: 'var(--aa-accent, #6865a7)' }}
            >
              <Plus size={12} />
              建立链接
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------ Wiki 堆叠阅读(独立视图) ------------------------------ */

/**
 * 堆叠阅读(Sliding Panes)—— 知识库的进阶形态,一个完全独立的视图。
 *
 * 灵感来自 Andy Matuschak 的联网笔记:你打开一篇 = 一栏;顺着这一栏底部
 * 的「关系」再点开另一篇,新的一栏滑到右边、原来的不关。于是你顺链走多深,
 * 就横向叠出多少栏——思路轨迹看得见,且从不丢上下文。读过的栏自动收成左侧
 * 一条竖书脊,像书架;点书脊即可回到那一栏(其后的栏收起)。
 *
 * 与卡片/图谱那套无关:这里就是"边读边顺着关系走"。
 */

const PANE_W = 460 // 每栏总宽
const SPINE_W = 46 // 收起后露出的书脊宽

/**
 * 起点选择列 —— 首次进入不替用户预选,让用户自己挑从哪里开始读。
 * 优先给「最近打开」,其余按关联度(出链+反链)排序,连得越多越靠前。
 */
function StartPicker({
  brain,
  byId,
  onPick,
}: {
  brain: ReturnType<typeof useBrain>
  byId: Map<string, ResolvedPage>
  onPick: (id: string) => void
}) {
  const recent = brain.recentlyOpened(4).filter((id) => byId.has(id))
  const recentSet = new Set(recent)
  const rest = [...byId.keys()]
    .filter((id) => !recentSet.has(id))
    .sort(
      (a, b) =>
        brain.outgoing(b).length + brain.backlinks(b).length - (brain.outgoing(a).length + brain.backlinks(a).length)
    )

  const renderItem = (id: string) => {
    const p = byId.get(id)
    if (!p) return null
    const degree = brain.outgoing(id).length + brain.backlinks(id).length
    return (
      <motion.button
        key={id}
        onClick={() => onPick(id)}
        whileHover={{ x: 3, backgroundColor: 'rgba(104,101,167,0.08)' }}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors"
        style={{ color: '#292722' }}
      >
        <span className="shrink-0">{pageIcon(p, 15)}</span>
        <span className="flex-1 min-w-0 truncate text-sm">{p.title}</span>
        <span className="shrink-0 text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          {kindLabel(p)}
          {degree > 0 ? ` · ${degree} 链` : ''}
        </span>
      </motion.button>
    )
  }

  return (
    <div className="shrink-0 h-full flex flex-col" style={{ width: PANE_W }}>
      <div className="px-6 pt-8 pb-4">
        <div className="flex items-center gap-2" style={{ color: '#292722' }}>
          <Sparkles size={16} style={{ color: '#6865a7' }} />
          <span className="text-base">从哪里开始?</span>
        </div>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--aa-text-2, #87827c)' }}>
          挑一个起点,之后顺着链接一栏栏往下读。
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {recent.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-xs flex items-center gap-1.5" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              <Clock size={11} /> 最近看过
            </div>
            {recent.map(renderItem)}
            <div className="px-3 pt-4 pb-1 text-xs flex items-center gap-1.5" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              <LayoutGrid size={11} /> 大脑里的全部
            </div>
          </>
        )}
        {rest.map(renderItem)}
      </div>
    </div>
  )
}

function WikiView({
  brain,
  resolved,
  onExit,
}: {
  brain: ReturnType<typeof useBrain>
  resolved: ResolvedPage[]
  onExit: () => void
}) {
  // 起点由用户选:空 = 显示「从哪里开始」选择列,选了才开第一栏。
  const [trail, setTrail] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => {
    const m = new Map<string, ResolvedPage>()
    resolved.forEach((p) => m.set(p.refId, p))
    return m
  }, [resolved])

  // 把第 i 栏滚到视野里(其左侧只留前面几栏的书脊)。非破坏式:不删任何栏。
  const scrollToPane = (i: number) => {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ left: Math.max(0, i * (PANE_W - SPINE_W)), behavior: 'smooth' })
    )
  }

  // 从第 index 栏顺着链接打开 id。
  // - 若 id 已在链上:只滚过去,绝不删除它后面的栏。
  // - 否则:插在 index 之后(其余栏原样保留),再滚到新栏。
  const openFrom = (index: number, id: string) => {
    const existing = trail.indexOf(id)
    if (existing !== -1) {
      scrollToPane(existing)
      return
    }
    brain.markOpened(id)
    setTrail((t) => [...t.slice(0, index + 1), id, ...t.slice(index + 1)])
    scrollToPane(index + 1)
  }
  // 点书脊 = 回到那一栏(滚过去,不收起后面的)。
  const revealPane = (index: number) => scrollToPane(index)
  // 关闭 = 显式地把这一栏及其之后全部合上,并滚回上一栏。
  const closeFrom = (index: number) => {
    setTrail((t) => t.slice(0, index))
    scrollToPane(index - 1)
  }

  return (
    <section
      className="flex-1 flex flex-col overflow-hidden"
      style={{ minHeight: 0, background: 'var(--aa-surface-hover, #efece7)' }}
    >
      {/* 顶栏 */}
      <header className="shrink-0 flex items-center gap-3 px-5" style={{ height: 52 }}>
        <button
          onClick={onExit}
          className="flex items-center gap-1 px-2 py-1.5 -ml-2 rounded-md text-xs transition-colors hover:bg-black/5"
          style={{ color: 'var(--aa-text-2, #87827c)' }}
        >
          <ChevronLeft size={14} />
          知识库
        </button>
        <span className="text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          堆叠阅读 · 顺着链接走,不丢上下文
        </span>
      </header>

      {/* 横向栏容器 */}
      <div ref={scrollRef} className="flex-1 flex overflow-x-auto overflow-y-hidden" style={{ minHeight: 0 }}>
        {trail.length === 0 && (
          <StartPicker
            brain={brain}
            byId={byId}
            onPick={(id) => {
              brain.markOpened(id)
              setTrail([id])
            }}
          />
        )}
        <AnimatePresence initial={false}>
          {trail.map((id, i) => {
            const page = byId.get(id)
            if (!page) return null
            return (
              <Pane
                key={id}
                page={page}
                index={i}
                isLast={i === trail.length - 1}
                brain={brain}
                byId={byId}
                onOpen={(target) => openFrom(i, target)}
                onReveal={() => revealPane(i)}
                onClose={i === 0 ? undefined : () => closeFrom(i)}
              />
            )
          })}
        </AnimatePresence>
      </div>
    </section>
  )
}

/** 单栏:左侧竖书脊 + 右侧内容(正文 + 关系)。 */
function Pane({
  page,
  index,
  isLast,
  brain,
  byId,
  onOpen,
  onReveal,
  onClose,
}: {
  page: ResolvedPage
  index: number
  isLast: boolean
  brain: ReturnType<typeof useBrain>
  byId: Map<string, ResolvedPage>
  onOpen: (id: string) => void
  onReveal: () => void
  onClose?: () => void
}) {
  // 关系:先出链(它引用了),再反向链接(被谁引用),去重。
  const out = brain.outgoing(page.refId)
  const back = brain.backlinks(page.refId).filter((id) => !out.includes(id))
  const rels = [
    ...out.map((id) => ({ id, dir: 'out' as const })),
    ...back.map((id) => ({ id, dir: 'in' as const })),
  ]
    .map((r) => ({ ...r, page: byId.get(r.id) }))
    .filter((r): r is { id: string; dir: 'out' | 'in'; page: ResolvedPage } => !!r.page)

  return (
    <motion.div
      className="shrink-0 flex h-full overflow-hidden"
      style={{ position: 'sticky', left: index * SPINE_W, zIndex: index + 1 }}
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: PANE_W }}
      exit={{ opacity: 0, width: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
    >
      {/* 竖书脊:收起时露出的就是它 */}
      <button
        onClick={onReveal}
        className="shrink-0 flex flex-col items-center gap-3 pt-4 pb-4 transition-colors hover:bg-black/[0.03]"
        style={{
          width: SPINE_W,
          background: 'var(--aa-surface, #fff)',
          borderRight: '1px solid var(--aa-border, rgba(45,40,34,0.08))',
        }}
      >
        <span className="shrink-0">{pageIcon(page, 15)}</span>
        <span
          className="text-xs overflow-hidden"
          style={{
            writingMode: 'vertical-rl',
            color: 'var(--aa-text-2, #87827c)',
            maxHeight: 220,
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {page.title}
        </span>
      </button>

      {/* 内容区:固定宽度,外层动画只裁剪显现,内容始终不回流(避免文字位移)。 */}
      <div
        className="shrink-0 flex flex-col min-w-0"
        style={{
          width: PANE_W - SPINE_W,
          background: 'var(--aa-surface, #fff)',
          borderRight: '1px solid var(--aa-border, rgba(45,40,34,0.09))',
          boxShadow: isLast ? '0 0 40px rgba(45,40,34,0.06)' : 'none',
        }}
      >
        <header
          className="shrink-0 flex items-center gap-2.5 px-4"
          style={{ height: 48, borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.07))' }}
        >
          <span className="text-sm font-semibold truncate min-w-0" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {page.title}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded shrink-0"
            style={{ background: 'var(--aa-surface-hover, #eeebe6)', color: 'var(--aa-text-2, #87827c)' }}
          >
            {kindLabel(page)}
          </span>
          <div className="flex-1" />
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-black/5 shrink-0"
              style={{ color: 'var(--aa-text-3, #aba39b)' }}
            >
              <X size={15} />
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto min-h-0">
          <PageContent page={page} />

          {/* 关系:顺着走 */}
          {rels.length > 0 && (
            <div
              className="mx-4 mb-6 mt-2 pt-5"
              style={{ borderTop: '1px dashed var(--aa-border, rgba(45,40,34,0.14))' }}
            >
              <div className="flex items-center gap-1.5 mb-3">
                <Link2 size={13} style={{ color: 'var(--aa-accent, #6865a7)' }} />
                <span className="text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                  顺着走 · {rels.length} 个链接
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {rels.map((r) => (
                  <RelRow key={r.id} page={r.page} dir={r.dir} onClick={() => onOpen(r.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/** 一条可点开的关系行:图标 + 标题 + 方向(引用/被引用)。 */
function RelRow({
  page,
  dir,
  onClick,
}: {
  page: ResolvedPage
  dir: 'out' | 'in'
  onClick: () => void
}) {
  return (
    <motion.button
      onClick={onClick}
      className="group flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left"
      style={{ background: 'var(--aa-surface-hover, #f4f1ec)' }}
      whileHover={{ x: 3, backgroundColor: 'rgba(104,101,167,0.08)' }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <span className="shrink-0">{pageIcon(page, 14)}</span>
      <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
        {page.title}
      </span>
      <span
        className="shrink-0 text-xs px-1.5 py-0.5 rounded"
        style={{
          color: dir === 'out' ? 'var(--aa-accent, #6865a7)' : 'var(--aa-text-3, #aba39b)',
          background: dir === 'out' ? 'rgba(104,101,167,0.1)' : 'transparent',
        }}
      >
        {dir === 'out' ? '引用' : '被引用'}
      </span>
      <CornerUpLeft
        size={13}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--aa-accent, #6865a7)', transform: 'scaleX(-1)' }}
      />
    </motion.button>
  )
}
/* ------------------------------ 内容渲染 ------------------------------ */

function PageContent({
  page,
  onOpenSpaceReference,
}: {
  page: ResolvedPage
  onOpenSpaceReference?: (spaceId: string, itemId: string) => void
}) {
  const [managedPath, setManagedPath] = useState('')
  const managedNavigationVersionRef = useRef(0)
  useEffect(() => {
    managedNavigationVersionRef.current += 1
    setManagedPath('')
  }, [page.refId])
  const navigateManagedPath = (relativePath: string) => {
    const apiBase = '/api/personal-knowledge/assets'
    if (getCachedReferencePreview(page.refId, relativePath, apiBase) !== undefined) {
      setManagedPath(relativePath)
      return
    }
    const pageId = page.refId
    const version = ++managedNavigationVersionRef.current
    void fetchSpaceReferencePreview(pageId, relativePath, undefined, apiBase).then(() => {
      if (managedNavigationVersionRef.current === version && page.refId === pageId) setManagedPath(relativePath)
    })
  }
  if (!page.exists) {
    return (
      <div
        className="h-full w-full overflow-y-auto px-6 py-10 text-sm"
        style={{ maxWidth: 'var(--reading-width, 680px)', color: 'var(--aa-text-3, #aba39b)' }}
      >
        这个对象已不存在(可能已被删除)。可以把它移出知识库。
      </div>
    )
  }
  if (page.kind === 'note') {
    const note = getNote(page.refId)!
    return (
      <div className="h-full w-full overflow-y-auto">
        <div className="mx-auto px-6 py-10 reading-prose" style={{ maxWidth: 'var(--reading-width, 680px)' }}>
          {note.bodyMarkdown.trim() ? (
            <MarkdownDocumentSurface markdown={note.bodyMarkdown} sourceVersion={`${note.id}:${note.updatedAt}`} />
          ) : (
            <p className="text-sm" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              这篇笔记还没有内容。
            </p>
          )}
        </div>
      </div>
    )
  }
  if (page.kind === 'space_reference') {
    if (page.managedAsset?.status === 'managed') {
      return (
        <ReferencePreview
          itemId={page.refId}
          fallbackTitle={page.title}
          canOpen={false}
          onOpen={() => undefined}
          apiBase="/api/personal-knowledge/assets"
          initialRelativePath={managedPath}
          onNavigatePath={navigateManagedPath}
          embedded
        />
      )
    }
    return null
  }
  return (
    <ReferencePreview
      itemId={page.refId}
      fallbackTitle={page.title}
      canOpen={false}
      onOpen={() => undefined}
      apiBase="/api/workbench-assets"
      embedded
    />
  )
}

/* ------------------------------ 卡片 & 小部件 ------------------------------ */

/** 哪些格式有封面(图/视频/音频/PDF/代码);文字类(笔记/Markdown/网页)无封面。 */
function pageHasCover(p: ResolvedPage): boolean {
  if (p.materialKind === 'code') return Boolean(p.previewText)
  if (p.kind !== 'material') return false
  return p.materialKind === 'image'
    || p.materialKind === 'video'
    || p.materialKind === 'audio'
    || p.materialKind === 'pdf'
}

function Card({
  page,
  degree,
  themeApi,
  onOpen,
}: {
  page: ResolvedPage
  degree: number
  themeApi: ReturnType<typeof useThemes>
  onOpen: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const cover = pageHasCover(page)
  const isWeb = page.kind !== 'note' && page.materialKind === 'web'
  const preview = cover ? '' : previewText(page)

  const myThemeIds = themeApi.themesOf(page.refId)
  const myThemes = themeApi.themes.filter((t) => myThemeIds.includes(t.id))

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setTagOpen(false)
      }}
      className="relative text-left flex flex-col rounded-2xl overflow-hidden transition-all cursor-pointer"
      style={{
        background: 'var(--aa-surface, #fff)',
        border: '1px solid var(--aa-border, rgba(45,40,34,0.09))',
        minHeight: 132,
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 6px 20px rgba(45,40,34,0.08)' : '0 1px 2px rgba(45,40,34,0.03)',
      }}
      onClick={onOpen}
    >
      {cover && <CardCover page={page} hovered={hovered} />}

      {/* 悬停时右上角出现「标签」入口 */}
      {(hovered || tagOpen) && (
        <div className="absolute top-2.5 right-2.5 z-10" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setTagOpen((v) => !v)}
            className="flex items-center justify-center rounded-full transition-colors"
            style={{
              width: 26,
              height: 26,
              background: tagOpen ? 'var(--aa-accent, #6865a7)' : 'rgba(255,255,255,0.92)',
              color: tagOpen ? '#fff' : 'var(--aa-text-2, #87827c)',
              boxShadow: '0 1px 4px rgba(45,40,34,0.15)',
            }}
          >
            <Tag size={13} />
          </button>
          {tagOpen && (
            <TagPopover page={page} themeApi={themeApi} myThemeIds={myThemeIds} onClose={() => setTagOpen(false)} />
          )}
        </div>
      )}

      <div className="flex flex-col flex-1" style={{ padding: 18 }}>
        <div className="flex items-center gap-2 mb-3">
          {isWeb && page.thumbnail ? (
            <ImageWithFallback src={page.thumbnail} alt="" className="rounded-sm" style={{ width: 14, height: 14, objectFit: 'contain' }} />
          ) : pageIcon(page)}
          <span className="text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
            {kindLabel(page)}
          </span>
        </div>
        <h3
          className="m-0 text-sm font-medium leading-snug line-clamp-2"
          style={{ color: 'var(--aa-text-1, #292722)' }}
        >
          {page.title}
        </h3>
        {preview && (
          <p
            className="m-0 mt-2 text-xs leading-relaxed line-clamp-6"
            style={{ color: 'var(--aa-text-2, #87827c)' }}
          >
            {preview}
          </p>
        )}
        <div className="flex-1" />

        {/* 归属的主题(可多属:一张卡可能挂多个) */}
        {myThemes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {myThemes.map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-1 rounded-full text-xs"
                style={{ padding: '2px 8px', background: `${t.color}18`, color: t.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4 text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          <span>{timeAgo(page.collectedAt)}</span>
          {degree > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Link2 size={11} />
                {degree}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CardCover({ page, hovered }: { page: ResolvedPage; hovered: boolean }) {
  const kind = page.materialKind
  if (kind === 'image' && page.thumbnail) return <div className="w-full overflow-hidden" style={{ height: 132 }}><ImageWithFallback src={page.thumbnail} alt={page.title} className="w-full h-full object-cover" style={{ transform: hovered ? 'scale(1.04)' : 'none', transition: 'transform 240ms ease' }} /></div>
  if (kind === 'video') {
    return <div className="relative w-full flex items-center justify-center" style={{ height: 132, background: 'linear-gradient(135deg, #2d2822 0%, #4a4038 100%)' }}>
      <span className="flex items-center justify-center rounded-full transition-transform" style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.16)', transform: hovered ? 'scale(1.1)' : 'none' }}>
        <Film size={18} style={{ color: '#fff' }} />
      </span>
    </div>
  }
  if (kind === 'audio') {
    return <div className="relative w-full flex items-end justify-center gap-1 px-6" style={{ height: 132, background: 'linear-gradient(135deg, #b0885a22 0%, #b0885a3d 100%)', paddingBottom: 28 }}>
      {WAVE.map((height, index) => <span key={index} style={{ width: 4, height: `${height}%`, borderRadius: 2, background: '#b0885a', opacity: 0.75 }} />)}
    </div>
  }
  if (kind === 'pdf' && page.previewText) {
    return <div className="w-full overflow-hidden px-4 pt-4" style={{ height: 132, background: 'var(--aa-surface-hover, #eeebe6)' }}>
      <div className="w-full h-full rounded-t-md overflow-hidden" style={{ background: '#fff', border: '1px solid rgba(45,40,34,0.08)', padding: '14px 16px' }}>
        <p className="m-0 whitespace-pre-wrap" style={{ color: 'var(--aa-text-2, #6b655e)', fontSize: 8.5, lineHeight: 1.5, fontFamily: 'var(--reading-font)' }}>{clean(page.previewText).slice(0, 240)}</p>
      </div>
    </div>
  }
  if (kind === 'code' && page.previewText) {
    return <CodeDocumentSurface source={page.previewText} language={page.language} variant="cover" />
  }
  return null
}

const WAVE = [30, 55, 40, 80, 60, 95, 50, 70, 45, 85, 35, 65, 50, 90, 40, 60, 30]

/** 卡片上的「归入主题」浮层:勾选归属 + 锁定(锁定 = agent 别再动)。 */
function TagPopover({
  page,
  themeApi,
  myThemeIds,
  onClose,
}: {
  page: ResolvedPage
  themeApi: ReturnType<typeof useThemes>
  myThemeIds: string[]
  onClose: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  return (
    <div
      className="absolute right-0 mt-2 rounded-xl overflow-hidden"
      style={{
        width: 208,
        background: 'var(--aa-surface, #fff)',
        border: '1px solid var(--aa-border, rgba(45,40,34,0.12))',
        boxShadow: '0 8px 28px rgba(45,40,34,0.16)',
      }}
    >
      <div
        className="px-3 py-2 text-xs"
        style={{ color: 'var(--aa-text-3, #aba39b)', borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.08))' }}
      >
        归入主题
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {themeApi.themes.map((t) => {
          const on = myThemeIds.includes(t.id)
          const locked = themeApi.isLocked(page.refId, t.id)
          return (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-black/[0.03]">
              <button
                onClick={() => (on ? themeApi.unassign(page.refId, t.id) : themeApi.assign(page.refId, t.id))}
                className="flex items-center gap-2 flex-1 text-left"
              >
                <span
                  className="flex items-center justify-center rounded shrink-0"
                  style={{
                    width: 16,
                    height: 16,
                    background: on ? t.color : 'transparent',
                    border: on ? 'none' : `1.5px solid ${t.color}`,
                  }}
                >
                  {on && <Check size={11} color="#fff" />}
                </span>
                <span className="text-sm" style={{ color: 'var(--aa-text-1, #292722)' }}>
                  {t.name}
                </span>
              </button>
              {on && (
                <button
                  onClick={() => themeApi.toggleLock(page.refId, t.id)}
                  className="p-0.5 rounded hover:bg-black/5"
                  style={{ color: locked ? t.color : 'var(--aa-text-3, #cfc9c1)' }}
                >
                  <Lock size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: '1px solid var(--aa-border, rgba(45,40,34,0.08))' }}>
        {creating ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) {
                const id = themeApi.createTheme(name)
                themeApi.assign(page.refId, id)
              }
              setName('')
              setCreating(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setName('')
                setCreating(false)
              }
            }}
            placeholder="新主题名…"
            className="w-full px-3 py-2 bg-transparent outline-none text-sm"
            style={{ color: 'var(--aa-text-1, #292722)' }}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-sm hover:bg-black/[0.03]"
            style={{ color: 'var(--aa-accent, #6865a7)' }}
          >
            <Plus size={13} />
            新建主题
          </button>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 rounded-full text-xs transition-colors"
      style={{
        height: 30,
        background: active ? 'var(--aa-accent, #6865a7)' : 'transparent',
        color: active ? '#fff' : 'var(--aa-text-2, #87827c)',
        border: active ? '1px solid transparent' : '1px solid var(--aa-border, rgba(45,40,34,0.09))',
      }}
    >
      {label}
      {count != null && <span style={{ opacity: 0.7 }}>{count}</span>}
    </button>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="m-0 text-sm" style={{ color: 'var(--aa-text-2, #87827c)' }}>
        知识库还空着。
      </p>
      <p className="m-0 mt-2 text-xs leading-relaxed" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
        在空间里「收藏」笔记或材料,
        <br />
        它们就会沉淀到这里。
      </p>
    </div>
  )
}

function SectionHead({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2" style={{ color: 'var(--aa-text-2, #87827c)' }}>
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
        {count}
      </span>
    </div>
  )
}

function LinkChip({ page, onClick, onRemove }: { page: ResolvedPage; onClick: () => void; onRemove?: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors"
      style={{ background: hovered ? 'var(--aa-surface-hover, #eeebe6)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {pageIcon(page, 12)}
      <span className="flex-1 text-xs truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
        {page.title}
      </span>
      {onRemove && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          style={{ color: 'var(--aa-text-3, #aba39b)' }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
