import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Home,
  Settings2,
  Layers,
  Library,
  MoreHorizontal,
  Pencil,
  Trash2,
  Pin,
  PinOff,
  Plus,
  AlertCircle,
  RotateCcw,
  LoaderCircle,
  X,
} from 'lucide-react'
import { SidebarAnimation } from './SidebarAnimation'
import type { ConversationSummary } from '../../../../contracts/conversation'
import type { PersonalSpaceProjection } from '../../../space'
import { useModalA11y } from './useModalA11y'

export type View = 'home' | 'conv-active' | 'conv-done' | 'space' | 'search' | 'focus' | 'brain'

interface SidebarProps {
  view: View
  onNavigate: (v: View) => void
  onOpenSettings: () => void
  collapsed: boolean
  conversations: readonly ConversationSummary[]
  spaces: readonly PersonalSpaceProjection[]
  spaceLoadState?: {
    readonly loading: boolean
    readonly mutationPending?: boolean
    readonly error?: string
    readonly onRetry: () => void | Promise<void>
  }
  activeSpaceId: string | null
  activeConversationId?: string
  onOpenConversation: (conversationId: string) => boolean | Promise<boolean>
  pendingConversationIds: ReadonlySet<string>
  onRenameConversation: (conversationId: string, title: string) => void | Promise<void>
  onToggleConversationPinned: (conversationId: string, pinned: boolean) => void | Promise<void>
  onDeleteConversation: (conversationId: string) => void | Promise<void>
  onOpenSpace?: (spaceId: string) => void | Promise<void>
  onActiveSpaceChange: (spaceId: string) => void
  onCreateSpace?: (title: string) => void | Promise<void>
  onRenameSpace?: (spaceId: string, title: string) => void | Promise<void>
}

const SIDEBAR_W           = 236
const SIDEBAR_COLLAPSED_W = 0

interface SpaceItem {
  id: string
  label: string
  dot: string
}

const CONVERSATION_DOT_PALETTE = ['#6865a7', '#6f9279', '#c18a42', '#6f84a5', '#a66f66'] as const
const SPACE_DOT_FALLBACK = '#a8c4b4'

// ── NavRow ──────────────────────────────────────────────────────────────────
// icon:  always rendered in a fixed-width 20px slot → icon NEVER moves
// label: opacity/translateX transition → no layout shift
// meta:  right-side content (chevron, time, …) — only when labelsVisible
interface NavRowProps {
  active:        boolean
  onClick:       () => void
  labelsVisible: boolean
  collapsed:     boolean
  tooltip?:      string
  icon:          React.ReactNode
  label:         string
  meta?:         React.ReactNode
}

function NavRow({ active, onClick, labelsVisible, collapsed, tooltip, icon, label, meta }: NavRowProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={!labelsVisible ? tooltip : undefined}
      className="relative w-full text-sm"
      style={{
        // The icon is ABSOLUTELY positioned (see below), so the button itself
        // has no internal layout that the width animation can perturb. Nothing
        // here transitions geometry → the icon can never drift while the rail
        // collapses. Only the label (also absolute) fades away.
        display: 'block',
        height: 32,
        transition: 'color 120ms ease',
        color:   active   ? 'var(--aa-accent)'
               : hovered  ? 'var(--aa-text-1)'
               :            'var(--aa-text-2)',
      }}
    >
      {/* Row background — its own layer so it can be a full-width row when
          expanded and contract into a compact pill that HUGS the icon when
          collapsed (instead of a full-width block clipped by the rail edge). */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: collapsed ? 40 : '100%',
          borderRadius: 8,
          background: active   ? 'var(--aa-accent-bg)'
                    : hovered  ? 'rgba(45,40,34,0.04)'
                    :            'transparent',
          transition: 'background 120ms ease, width 240ms cubic-bezier(0.4,0,0.2,1)',
        }}
      />

      {/* Active bar — always left-edge, never moves */}
      {active && (
        <span aria-hidden="true" style={{
          position: 'absolute',
          left: 3,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 3,
          height: 14,
          borderRadius: 2,
          background: 'var(--aa-accent)',
          zIndex: 1,
        }}/>
      )}

      {/* Icon — absolutely pinned at a fixed left offset. Its centre sits at
          x=20 from the button edge (= 28px from the rail edge, the shared axis
          with the brand mark and toggle). Fully decoupled from the width
          animation, so it is pixel-locked in both states and while animating. */}
      <span style={{
        position: 'absolute',
        left: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 20,
        height: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {icon}
      </span>

      {/* Label + meta — absolutely positioned to the right of the icon slot so
          it never participates in layout. Fades / clipped as the rail narrows. */}
      <span style={{
        position: 'absolute',
        left: 38,
        right: 10,
        top: '50%',
        transform: labelsVisible ? 'translateY(-50%)' : 'translateY(-50%) translateX(-6px)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        opacity:   labelsVisible ? 1 : 0,
        transition: 'opacity 160ms ease, transform 160ms ease',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        minWidth: 0,
        pointerEvents: labelsVisible ? 'auto' : 'none',
      }}>
        <span className="flex-1 text-left truncate">{label}</span>
        {meta && (
          <span style={{ flexShrink: 0 }}>{meta}</span>
        )}
      </span>
    </button>
  )
}

// ── ListRow ──────────────────────────────────────────────────────────────────
// 空间 / 最近对话的行:小圆点 + 标签 + 右侧信息,悬停浮现「⋯」菜单。
// 用 div(非 button)承载,好在内部嵌套菜单按钮而不违反 HTML 嵌套规则。
interface ListRowProps {
  active: boolean
  onClick: () => void
  dot: string
  label: string
  meta?: ReactNode
  editing: boolean
  editSelectAll?: boolean
  onRename: (v: string) => void
  onCancelRename: () => void
  actions: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[]
  pending?: boolean
}

function ListRow({ active, onClick, dot, label, meta, editing, editSelectAll, onRename, onCancelRename, actions, pending = false }: ListRowProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      role="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (!editing && !pending) onClick() }}
      className="group/row relative flex items-center gap-2 rounded-lg cursor-pointer text-sm"
      style={{
        height: 32,
        paddingLeft: 12,
        paddingRight: 8,
        color: active ? 'var(--aa-accent)' : 'var(--aa-text-2)',
        background: active ? 'var(--aa-accent-bg)' : hovered ? 'rgba(45,40,34,0.04)' : 'transparent',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }}/>
      {editing ? (
        <InlineName value={label} onCommit={onRename} onCancel={onCancelRename} selectAll={editSelectAll}/>
      ) : (
        <span className="flex-1 text-left truncate">{label}</span>
      )}
      {!editing && pending && (
        <LoaderCircle aria-label="处理中" size={13} className="animate-spin shrink-0" />
      )}
      {!editing && !pending && (
        <>
          {meta && (
            <span style={{ flexShrink: 0, opacity: hovered && actions.length > 0 ? 0 : 1 }}>
              {meta}
            </span>
          )}
          {actions.length > 0 && (
            <RowMenu actions={actions} visible={hovered}/>
          )}
        </>
      )}
    </div>
  )
}

// 行内重命名输入:回车/失焦提交,Esc 取消。淡下划线示意,不套原生蓝框。
function InlineName({ value, onCommit, onCancel, selectAll }: { value: string; onCommit: (v: string) => void; onCancel: () => void; selectAll?: boolean }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    if (selectAll) el.select()
    else {
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  }, [selectAll])
  function commit() {
    const t = draft.trim()
    if (t) onCommit(t)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={commit}
      className="flex-1 min-w-0 text-sm bg-transparent outline-none"
      style={{
        color: 'var(--aa-text-1)',
        borderBottom: '1px solid rgba(45,40,34,0.25)',
        paddingBottom: 1,
      }}
    />
  )
}

// 行尾「⋯」菜单:点开一个小下拉,点外部关闭。
function RowMenu({
  actions,
  visible,
}: {
  actions: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[]
  visible: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const shown = visible || open
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div
      ref={ref}
      className="absolute right-2 shrink-0"
      style={{ opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="更多操作"
        aria-hidden={!shown}
        tabIndex={shown ? 0 : -1}
        className="flex items-center justify-center rounded transition-colors hover:bg-black/10"
        style={{ width: 20, height: 20, color: 'var(--aa-text-3)' }}
      >
        <MoreHorizontal size={14}/>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 py-1 rounded-lg"
          style={{
            minWidth: 128,
            background: 'var(--aa-surface)',
            border: '1px solid var(--aa-border)',
            boxShadow: '0 6px 20px rgba(45,40,34,0.14)',
          }}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => { setOpen(false); a.onClick() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-black/5"
              style={{ color: a.danger ? '#b3543f' : 'var(--aa-text-1)' }}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SectionLabel ─────────────────────────────────────────────────────────────
function SectionLabel({ label, labelsVisible, action }: { label: string; labelsVisible: boolean; action?: ReactNode }) {
  return (
    <div
      className="flex items-center justify-between pl-3 pr-2 pt-4 pb-1"
      style={{
        opacity: labelsVisible ? 1 : 0,
        transition: 'opacity 140ms ease',
        // Keep height so nav layout stays stable; only opacity changes
        pointerEvents: labelsVisible ? 'auto' : 'none',
      }}
    >
      <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--aa-text-3)' }}>
        {label}
      </span>
      {action}
    </div>
  )
}

const CONVERSATION_FADE_TOP = 20
const CONVERSATION_FADE_BOTTOM = 24

function ConversationScrollArea({ maxHeight, children }: { maxHeight: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fadeTop, setFadeTop] = useState(0)
  const [fadeBottom, setFadeBottom] = useState(0)

  const measureMask = useCallback(() => {
    const element = ref.current
    if (element === null) return
    const distanceFromTop = element.scrollTop
    const distanceFromBottom = element.scrollHeight - element.clientHeight - element.scrollTop
    const easeOut = (value: number): number => 1 - Math.pow(1 - value, 2)
    setFadeTop((previous) => {
      const next = Math.round(CONVERSATION_FADE_TOP * easeOut(Math.min(distanceFromTop / CONVERSATION_FADE_TOP, 1)))
      return next === previous ? previous : next
    })
    setFadeBottom((previous) => {
      const next = Math.round(CONVERSATION_FADE_BOTTOM * easeOut(
        Math.min(Math.max(distanceFromBottom, 0) / CONVERSATION_FADE_BOTTOM, 1),
      ))
      return next === previous ? previous : next
    })
  }, [])

  const rafRef = useRef<number | null>(null)
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      measureMask()
    })
  }, [measureMask])
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  useLayoutEffect(measureMask, [children, measureMask])

  const mask = `linear-gradient(to bottom, transparent 0px, #000 ${fadeTop}px, #000 calc(100% - ${fadeBottom}px), transparent 100%)`
  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="aa-conversation-scroll space-y-0.5 overflow-y-auto"
      style={{ maxHeight, WebkitMaskImage: mask, maskImage: mask }}
      data-conversation-scroll
    >
      {children}
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({
  view,
  onNavigate,
  onOpenSettings,
  collapsed,
  conversations,
  spaces,
  spaceLoadState,
  activeSpaceId,
  activeConversationId,
  onOpenConversation,
  pendingConversationIds,
  onRenameConversation,
  onToggleConversationPinned,
  onDeleteConversation,
  onOpenSpace,
  onActiveSpaceChange,
  onCreateSpace,
  onRenameSpace,
}: SidebarProps) {
  // Structural state changes are intentionally atomic. The previous staged
  // label/width timers left the sidebar in a visible in-between geometry, which
  // read as horizontal drift. Only the contained mist mark retains motion.
  const labelsVisible = !collapsed

  const projectedSpaces = useMemo(() => spaces.map((space) => ({
    id: space.spaceId,
    label: space.title,
    dot: space.color ?? SPACE_DOT_FALLBACK,
  })), [spaces])
  const orderedConversations = useMemo(
    () => [...conversations].sort(compareConversations),
    [conversations],
  )
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameSelectAll, setRenameSelectAll] = useState(false)
  const pendingSpaceIdsRef = useRef<Set<string> | null>(null)
  const [showManager, setShowManager] = useState(false)
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null)

  async function openConversation(conversationId: string) {
    if (openingConversationId === conversationId || pendingConversationIds.has(conversationId)) return
    setOpeningConversationId(conversationId)
    try {
      const opened = await onOpenConversation(conversationId)
      if (opened !== false) onNavigate('conv-active')
    } catch {
      // The runtime owns the visible load error; the sidebar only prevents a false navigation.
    } finally {
      setOpeningConversationId((current) => current === conversationId ? null : current)
    }
  }

  useEffect(() => {
    const previousIds = pendingSpaceIdsRef.current
    if (previousIds === null) return
    const created = projectedSpaces.find((space) => !previousIds.has(space.id))
    if (created === undefined) return
    pendingSpaceIdsRef.current = null
    setRenamingId(created.id)
    setRenameSelectAll(true)
  }, [projectedSpaces])

  function finishRename() {
    setRenamingId(null)
    setRenameSelectAll(false)
  }

  function selectSpace(id: string) {
    onActiveSpaceChange(id)
    onNavigate('space')
    void onOpenSpace?.(id)
  }
  function renameSpace(id: string, label: string) {
    void Promise.resolve().then(() => onRenameSpace?.(id, label)).catch(() => undefined)
  }
  function addSpace() {
    if (onCreateSpace === undefined) return
    pendingSpaceIdsRef.current = new Set(projectedSpaces.map((space) => space.id))
    void Promise.resolve().then(() => onCreateSpace('新空间')).catch(() => {
      pendingSpaceIdsRef.current = null
    })
  }

  return (
    <aside
      className="relative h-full shrink-0 select-none overflow-hidden"
      style={{
        width:    collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W,
        minWidth: collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W,
        background:  'var(--aa-surface)',
        // 收起后连边框都不留,做到真正意义上的「消失」。
        borderRight: collapsed ? 'none' : '1px solid var(--aa-border)',
        // Only the outer rail width animates. The inner column stays a fixed
        // width and is simply clipped, so no descendant ever reflows / drifts
        // while the rail glides between states.
        transition: 'width 260ms cubic-bezier(0.4,0,0.2,1), min-width 260ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <style>{`
        .aa-conversation-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .aa-conversation-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      {/* Full-height line-art backdrop — sits behind everything (山雾远岫 · 水月孤舟).
          Kept faint so nav labels stay legible; clipped by the rail when collapsed. */}
      <SidebarAnimation collapsed={collapsed} />

      {/* 收起 / 展开 的开关统一放在 TopBar 里(同一位置,点击前后无位移),
          这里不再自带按钮。 */}

      {/* Fixed-width inner column — never resizes, so nothing inside can be
          compressed or pushed around during the collapse animation. Sits above
          the line-art backdrop. */}
      <div
        className="relative flex flex-col h-full"
        style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W, zIndex: 1 }}
      >
      {/* ── Open sky ── */}
      {/* Empty header space so the moon + upper sky of the backdrop read clearly
          and the nav starts below them; also keeps nav from shifting on toggle. */}
      <div style={{
        height: 128,
        flexShrink: 0,
      }} />

      {/* ── Navigation ── */}
      {/* Collapsed: the whole nav column is hidden (fade out). Kept mounted so
          it can be restored instantly if we decide to bring it back. */}
      <nav
        className="flex-1 overflow-y-auto py-2 px-2"
        style={{
          scrollbarWidth: 'none',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: collapsed
            ? 'opacity 120ms ease'
            : 'opacity 260ms ease 160ms',
        }}
      >
        {/* Home */}
        <div className="space-y-0.5">
          <NavRow
            active={view === 'home'}
            onClick={() => onNavigate('home')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            tooltip="首页"
            icon={<Home size={14}/>}
            label="首页"
          />
        </div>

        {/* Spaces */}
        <div className="group/spaces">
        <SectionLabel
          label="空间"
          labelsVisible={labelsVisible}
          action={
            <button
              onClick={addSpace}
              disabled={onCreateSpace === undefined || spaceLoadState?.mutationPending === true}
              aria-label="新建空间"
              className="flex items-center justify-center rounded transition-opacity hover:bg-black/5 opacity-0 group-hover/spaces:opacity-50 hover:!opacity-100"
              style={{ width: 16, height: 16, color: 'var(--aa-text-3)', marginRight: -3 }}
            >
              <Plus size={12}/>
            </button>
          }
        />
        <div className="space-y-0.5">
          {spaceLoadState?.loading === true && projectedSpaces.length === 0 && <SpaceLoadingRows />}
          {projectedSpaces.map((s) => (
            <ListRow
              key={s.id}
              active={view === 'space' && activeSpaceId === s.id}
              onClick={() => selectSpace(s.id)}
              dot={s.dot}
              label={s.label}
              editing={renamingId === s.id}
              editSelectAll={renamingId === s.id && renameSelectAll}
              onRename={(t) => { renameSpace(s.id, t); finishRename() }}
              onCancelRename={finishRename}
              meta={<ChevronRight size={11} style={{ color: 'var(--aa-text-3)' }}/>}
              actions={onRenameSpace === undefined ? [] : [
                { label: '重命名', icon: <Pencil size={12}/>, onClick: () => { setRenameSelectAll(false); setRenamingId(s.id) } },
              ]}
            />
          ))}
          {spaceLoadState?.error !== undefined && (
            <SpaceLoadFailure message={spaceLoadState.error} onRetry={spaceLoadState.onRetry} />
          )}
          <div style={{
            opacity: labelsVisible ? 1 : 0,
            transition: 'opacity 140ms ease',
            pointerEvents: labelsVisible ? 'auto' : 'none',
          }}>
            {/* 管理空间:打开管理面板(集中重命名/删除/统览所有空间)。 */}
            <button
              onClick={() => setShowManager(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs hover:bg-black/5"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <Layers size={11}/>
              <span>管理空间</span>
            </button>
          </div>
        </div>
        </div>

        {/* Recent conversations */}
        <div className="group/convs">
        <SectionLabel
          label="最近对话"
          labelsVisible={labelsVisible}
        />
        <ConversationScrollArea maxHeight={170}>
          {orderedConversations.map((conversation, index) => (
            <ListRow
              key={conversation.conversationId}
              active={view === 'conv-active' && activeConversationId === conversation.conversationId}
              onClick={() => void openConversation(conversation.conversationId)}
              dot={CONVERSATION_DOT_PALETTE[index % CONVERSATION_DOT_PALETTE.length] ?? CONVERSATION_DOT_PALETTE[0]}
              label={conversation.title}
              editing={renamingId === conversation.conversationId}
              editSelectAll={false}
              onRename={(title) => {
                void onRenameConversation(conversation.conversationId, title)
                finishRename()
              }}
              onCancelRename={finishRename}
              meta={
                <span className="flex items-center gap-1">
                  {conversation.pinnedAt !== undefined && (
                    <Pin size={9} style={{ color: 'var(--aa-accent)' }}/>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--aa-text-3)' }}>{conversationTimeLabel(conversation.updatedAt)}</span>
                </span>
              }
              actions={[
                {
                  label: conversation.pinnedAt !== undefined ? '取消置顶' : '置顶',
                  icon: conversation.pinnedAt !== undefined ? <PinOff size={12}/> : <Pin size={12}/>,
                  onClick: () => void onToggleConversationPinned(
                    conversation.conversationId,
                    conversation.pinnedAt === undefined,
                  ),
                },
                { label: '重命名', icon: <Pencil size={12}/>, onClick: () => { setRenameSelectAll(false); setRenamingId(conversation.conversationId) } },
                { label: '删除', icon: <Trash2 size={12}/>, danger: true, onClick: () => void onDeleteConversation(conversation.conversationId) },
              ]}
              pending={openingConversationId === conversation.conversationId || pendingConversationIds.has(conversation.conversationId)}
            />
          ))}
        </ConversationScrollArea>
        </div>

        {/* 知识库 */}
        <div className="space-y-0.5 mt-4">
          <NavRow
            active={view === 'brain'}
            onClick={() => onNavigate('brain')}
            labelsVisible={labelsVisible}
            collapsed={collapsed}
            tooltip="知识库"
            icon={<Library size={14}/>}
            label="知识库"
          />
        </div>
      </nav>

      {/* ── Account footer ── */}
      <footer
        className="shrink-0 flex items-center"
        style={{
          borderTop: '1px solid var(--aa-border)',
          padding: '8px 15px',
          gap: 10,
        }}
      >
        <span
          className="flex items-center justify-center shrink-0 text-xs font-semibold"
          title={!labelsVisible ? '张明' : undefined}
          style={{
            width: 26, height: 26,
            borderRadius: '50%',
            background: 'var(--aa-lavender)',
            color: 'var(--aa-accent)',
            flexShrink: 0,
          }}
        >
          张
        </span>
        <span style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          opacity: labelsVisible ? 1 : 0,
          transition: 'opacity 160ms ease',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}>
          <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1)' }}>
            张明
          </span>
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-md hover:bg-black/5 shrink-0"
            style={{ color: 'var(--aa-text-3)' }}
          >
            <Settings2 size={14}/>
          </button>
        </span>
      </footer>
      </div>

      {showManager && (
        <SpaceManagerModal
          spaces={projectedSpaces}
          onClose={() => setShowManager(false)}
          onRename={renameSpace}
          onAdd={addSpace}
        />
      )}
    </aside>
  )
}

function SpaceLoadingRows() {
  return (
    <div className="space-y-2 px-3 py-1" role="status" aria-label="正在加载空间">
      <span className="block h-2.5 w-24 animate-pulse rounded" style={{ background: 'var(--aa-surface-hover)' }} />
      <span className="block h-2.5 w-16 animate-pulse rounded" style={{ background: 'var(--aa-surface-hover)' }} />
    </div>
  )
}

function SpaceLoadFailure(props: {
  readonly message: string
  readonly onRetry: () => void | Promise<void>
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" role="alert" title={props.message}>
      <AlertCircle size={12} className="shrink-0" style={{ color: 'var(--aa-status-error)' }} />
      <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--aa-text-3)' }}>空间同步失败</span>
      <button
        type="button"
        aria-label="重新加载空间"
        title="重新加载空间"
        onClick={() => void props.onRetry()}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-black/5"
        style={{ color: 'var(--aa-text-3)' }}
      >
        <RotateCcw size={11} />
      </button>
    </div>
  )
}

// ── SpaceManagerModal ────────────────────────────────────────────────────────
// 「管理空间」入口打开的面板:集中查看 / 重命名 / 删除 / 新建所有空间。
function SpaceManagerModal({
  spaces,
  onClose,
  onRename,
  onAdd,
}: {
  spaces: SpaceItem[]
  onClose: () => void
  onRename: (id: string, label: string) => void
  onAdd: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const modalRef = useModalA11y(onClose)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'rgba(45,40,34,0.28)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="管理空间"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-xl overflow-hidden outline-none"
        style={{
          maxWidth: 440,
          background: 'var(--aa-surface)',
          border: '1px solid var(--aa-border)',
          boxShadow: '0 20px 60px rgba(45,40,34,0.24)',
        }}
      >
        <header className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--aa-border)' }}>
          <div className="flex items-center gap-2">
            <Layers size={15} style={{ color: 'var(--aa-accent)' }}/>
            <h2 className="text-sm font-semibold m-0" style={{ color: 'var(--aa-text-1)' }}>管理空间</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5" style={{ color: 'var(--aa-text-3)' }}>
            <X size={15}/>
          </button>
        </header>

        <div className="px-3 py-2 max-h-[52vh] overflow-y-auto">
          {spaces.length === 0 && (
            <p className="text-xs text-center py-6" style={{ color: 'var(--aa-text-3)' }}>还没有空间,点下方「新建空间」开始。</p>
          )}
          {spaces.map((s) => (
            <div
              key={s.id}
              className="group/mrow flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-black/5"
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.dot, flexShrink: 0 }}/>
              {editingId === s.id ? (
                <InlineName
                  value={s.label}
                  onCommit={(t) => { onRename(s.id, t); setEditingId(null) }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1)' }}>{s.label}</span>
              )}
              {editingId !== s.id && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/mrow:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditingId(s.id)}
                    title="重命名"
                    className="p-1.5 rounded-md hover:bg-black/10"
                    style={{ color: 'var(--aa-text-3)' }}
                  >
                    <Pencil size={13}/>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="px-3 py-3" style={{ borderTop: '1px solid var(--aa-border)' }}>
          <button
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-accent)', border: '1px dashed var(--aa-border)' }}
          >
            <Plus size={14}/>
            新建空间
          </button>
        </footer>
      </div>
    </div>
  )
}

function compareConversations(left: ConversationSummary, right: ConversationSummary): number {
  const leftPinned = left.pinnedAt !== undefined
  const rightPinned = right.pinnedAt !== undefined
  if (leftPinned !== rightPinned) return rightPinned ? 1 : -1
  if (leftPinned && rightPinned) {
    const pinnedOrder = timestampValue(right.pinnedAt) - timestampValue(left.pinnedAt)
    if (pinnedOrder !== 0) return pinnedOrder
  }
  return timestampValue(right.updatedAt) - timestampValue(left.updatedAt)
}

function conversationTimeLabel(value: string | undefined): string {
  const timestamp = timestampValue(value)
  if (timestamp === 0) return ''
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function timestampValue(value: string | undefined): number {
  if (value === undefined) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}
