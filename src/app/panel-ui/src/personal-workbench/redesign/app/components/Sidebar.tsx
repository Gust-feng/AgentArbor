import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  X,
} from 'lucide-react'
import { SidebarAnimation } from './SidebarAnimation'

export type View = 'home' | 'conv-active' | 'conv-done' | 'conv-new' | 'space' | 'search' | 'focus' | 'brain'

interface SidebarProps {
  view: View
  onNavigate: (v: View) => void
  onOpenSettings: () => void
  collapsed: boolean
}

const SIDEBAR_W           = 236
const SIDEBAR_COLLAPSED_W = 0

interface SpaceItem {
  id: string
  label: string
  dot: string
}
interface ConvItem {
  id: string
  title: string
  time: string
  view: View
  /** 每条会话一个专属点色,取代重复的对话气泡图标(重复太丑)。 */
  dot: string
  pinned?: boolean
}

// 原型阶段的种子数据(接后端后由空间/会话接口驱动)。
const SEED_SPACES: SpaceItem[] = [
  { id: 'space-study', label: '学习空间', dot: '#a8c4b4' },
  { id: 'space-proj',  label: '项目空间', dot: '#a8b8c8' },
]

const SEED_CONVS: ConvItem[] = [
  { id: 'rc1', title: '整理机器学习学习路径', time: '今天',  view: 'conv-active', dot: '#6865a7' },
  { id: 'rc2', title: '认知偏见与阅读整理',   time: '昨天',  view: 'conv-done',   dot: '#a8c4b4' },
  { id: 'rc3', title: '卡片笔记法讨论',       time: '3天前', view: 'conv-done',   dot: '#d49020' },
]

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
  onStartRename: () => void
  onRename: (v: string) => void
  onCancelRename: () => void
  actions: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[]
}

function ListRow({ active, onClick, dot, label, meta, editing, onRename, onCancelRename, actions }: ListRowProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      role="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (!editing) onClick() }}
      className="group/row flex items-center gap-2 rounded-lg cursor-pointer text-sm"
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
        <InlineName value={label} onCommit={onRename} onCancel={onCancelRename}/>
      ) : (
        <span className="flex-1 text-left truncate">{label}</span>
      )}
      {!editing && (
        <>
          {/* 悬停时用「⋯」菜单替换右侧信息;不悬停时显示时间/箭头。 */}
          {hovered ? (
            <RowMenu actions={actions}/>
          ) : (
            meta && <span style={{ flexShrink: 0 }}>{meta}</span>
          )}
        </>
      )}
    </div>
  )
}

// 行内重命名输入:回车/失焦提交,Esc 取消。淡下划线示意,不套原生蓝框。
function InlineName({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [])
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
function RowMenu({ actions }: { actions: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
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

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({ view, onNavigate, onOpenSettings, collapsed }: SidebarProps) {
  // Structural state changes are intentionally atomic. The previous staged
  // label/width timers left the sidebar in a visible in-between geometry, which
  // read as horizontal drift. Only the contained mist mark retains motion.
  const labelsVisible = !collapsed

  // 空间 / 最近对话改为本地状态,支持重命名、删除、置顶(原型阶段;接后端后由接口驱动)。
  const [spaces, setSpaces] = useState<SpaceItem[]>(SEED_SPACES)
  const [convs, setConvs] = useState<ConvItem[]>(SEED_CONVS)
  // 当前激活的空间 —— 点击不同空间时切换,给出「点了有反应」的视觉反馈。
  const [activeSpaceId, setActiveSpaceId] = useState<string>(SEED_SPACES[0]?.id ?? '')
  // 新建空间后要立即进入重命名的目标 id。
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // 「管理空间」管理面板的开合。
  const [showManager, setShowManager] = useState(false)

  function selectSpace(id: string) {
    setActiveSpaceId(id)
    onNavigate('space')
  }
  function renameSpace(id: string, label: string) {
    setSpaces((s) => s.map((it) => (it.id === id ? { ...it, label } : it)))
  }
  function deleteSpace(id: string) {
    setSpaces((s) => s.filter((it) => it.id !== id))
  }
  function addSpace() {
    const id = `space-${Date.now().toString(36)}`
    const palette = ['#a8c4b4', '#a8b8c8', '#c8b0a0', '#b0a8c8', '#c8c0a0']
    setSpaces((s) => [...s, { id, label: '新空间', dot: palette[s.length % palette.length] }])
    setRenamingId(id) // 建好即进入重命名
  }

  function renameConv(id: string, title: string) {
    setConvs((c) => c.map((it) => (it.id === id ? { ...it, title } : it)))
  }
  function deleteConv(id: string) {
    setConvs((c) => c.filter((it) => it.id !== id))
  }
  function togglePinConv(id: string) {
    setConvs((c) => c.map((it) => (it.id === id ? { ...it, pinned: !it.pinned } : it)))
  }
  // 置顶的排在前面,其余保持原有顺序。
  const orderedConvs = [...convs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))

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
              aria-label="新建空间"
              className="flex items-center justify-center rounded transition-opacity hover:bg-black/5 opacity-0 group-hover/spaces:opacity-50 hover:!opacity-100"
              style={{ width: 16, height: 16, color: 'var(--aa-text-3)', marginRight: -3 }}
            >
              <Plus size={12}/>
            </button>
          }
        />
        <div className="space-y-0.5">
          {spaces.map((s) => (
            <ListRow
              key={s.id}
              active={view === 'space' && activeSpaceId === s.id}
              onClick={() => selectSpace(s.id)}
              dot={s.dot}
              label={s.label}
              editing={renamingId === s.id}
              onStartRename={() => setRenamingId(s.id)}
              onRename={(t) => { renameSpace(s.id, t); setRenamingId(null) }}
              onCancelRename={() => setRenamingId(null)}
              meta={<ChevronRight size={11} style={{ color: 'var(--aa-text-3)' }}/>}
              actions={[
                { label: '重命名', icon: <Pencil size={12}/>, onClick: () => setRenamingId(s.id) },
                { label: '删除', icon: <Trash2 size={12}/>, danger: true, onClick: () => deleteSpace(s.id) },
              ]}
            />
          ))}
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
          action={
            <button
              onClick={() => onNavigate('conv-new')}
              aria-label="新对话"
              className="flex items-center justify-center rounded transition-opacity hover:bg-black/5 opacity-0 group-hover/convs:opacity-50 hover:!opacity-100"
              style={{ width: 16, height: 16, color: 'var(--aa-text-3)', marginRight: -3 }}
            >
              <Plus size={12}/>
            </button>
          }
        />
        <div className="space-y-0.5">
          {orderedConvs.map((c) => (
            <ListRow
              key={c.id}
              active={
                (view === 'conv-active' && c.id === 'rc1') ||
                (view === 'conv-done'   && c.id === 'rc2')
              }
              onClick={() => onNavigate(c.view)}
              dot={c.dot}
              label={c.title}
              editing={renamingId === c.id}
              onStartRename={() => setRenamingId(c.id)}
              onRename={(t) => { renameConv(c.id, t); setRenamingId(null) }}
              onCancelRename={() => setRenamingId(null)}
              meta={
                <span className="flex items-center gap-1">
                  {c.pinned && <Pin size={9} style={{ color: 'var(--aa-accent)' }}/>}
                  <span className="text-[10px]" style={{ color: 'var(--aa-text-3)' }}>{c.time}</span>
                </span>
              }
              actions={[
                {
                  label: c.pinned ? '取消置顶' : '置顶',
                  icon: c.pinned ? <PinOff size={12}/> : <Pin size={12}/>,
                  onClick: () => togglePinConv(c.id),
                },
                { label: '重命名', icon: <Pencil size={12}/>, onClick: () => setRenamingId(c.id) },
                { label: '删除', icon: <Trash2 size={12}/>, danger: true, onClick: () => deleteConv(c.id) },
              ]}
            />
          ))}
        </div>
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
          spaces={spaces}
          onClose={() => setShowManager(false)}
          onRename={renameSpace}
          onDelete={deleteSpace}
          onAdd={addSpace}
        />
      )}
    </aside>
  )
}

// ── SpaceManagerModal ────────────────────────────────────────────────────────
// 「管理空间」入口打开的面板:集中查看 / 重命名 / 删除 / 新建所有空间。
function SpaceManagerModal({
  spaces,
  onClose,
  onRename,
  onDelete,
  onAdd,
}: {
  spaces: SpaceItem[]
  onClose: () => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'rgba(45,40,34,0.28)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-xl overflow-hidden"
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
                  <button
                    onClick={() => onDelete(s.id)}
                    title="删除"
                    className="p-1.5 rounded-md hover:bg-black/10"
                    style={{ color: '#b3543f' }}
                  >
                    <Trash2 size={13}/>
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
