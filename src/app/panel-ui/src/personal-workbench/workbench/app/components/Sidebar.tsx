import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Home,
  Settings2,
  Layers,
  Library,
  Pencil,
  Trash2,
  Pin,
  PinOff,
  Plus,
  AlertCircle,
  RotateCcw,
} from 'lucide-react'
import { SidebarAnimation } from './SidebarAnimation'
import {
  SidebarConversationScrollArea,
  SidebarListRow,
  SidebarNavRow,
  SidebarSectionLabel,
} from './SidebarRows'
import { SpaceManagerDialog } from './SpaceManagerDialog'
import type { ConversationSummary } from '../../../../contracts/conversation'
import type { PersonalSpaceProjection } from '../../../space'

export type View = 'home' | 'conv-active' | 'conv-done' | 'space' | 'search' | 'brain'

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

const CONVERSATION_DOT_PALETTE = ['#6865a7', '#6f9279', '#c18a42', '#6f84a5', '#a66f66'] as const
const SPACE_DOT_FALLBACK = '#a8c4b4'

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
          <SidebarNavRow
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
        <SidebarSectionLabel
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
            <SidebarListRow
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
        <SidebarSectionLabel
          label="最近对话"
          labelsVisible={labelsVisible}
        />
        <SidebarConversationScrollArea maxHeight={170}>
          {orderedConversations.map((conversation, index) => (
            <SidebarListRow
              key={conversation.conversationId}
            active={(view === 'conv-active' || view === 'conv-done') && activeConversationId === conversation.conversationId}
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
        </SidebarConversationScrollArea>
        </div>

        {/* 知识库 */}
        <div className="space-y-0.5 mt-4">
          <SidebarNavRow
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

      {/* Settings remains available independently of any future account/profile feature. */}
      <footer
        className="shrink-0 flex items-center"
        style={{
          borderTop: '1px solid var(--aa-border)',
          padding: '8px',
        }}
      >
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
          title={!labelsVisible ? '设置' : undefined}
          className="flex h-8 w-full items-center rounded-lg text-sm hover:bg-black/5"
          style={{
            gap: 8,
            padding: '0 10px',
            color: 'var(--aa-text-2)',
          }}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
            <Settings2 size={14}/>
          </span>
          <span
            className="truncate"
            style={{
              opacity: labelsVisible ? 1 : 0,
              transition: 'opacity 160ms ease',
            }}
          >
            设置
          </span>
        </button>
      </footer>
      </div>

      {showManager && (
        <SpaceManagerDialog
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

// ── SpaceManagerDialog ───────────────────────────────────────────────────────
// 「管理空间」入口打开的面板:集中查看 / 重命名 / 删除 / 新建所有空间。
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
