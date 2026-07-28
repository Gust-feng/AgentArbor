import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { HTML5Backend, getEmptyImage } from 'react-dnd-html5-backend'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Globe,
  MessageSquare,
  Plus,
  Search,
  Maximize2,
  ArrowRight,
  NotebookPen,
  Brain,
  MoreHorizontal,
  Pencil,
  Trash2,
  GripVertical,
} from 'lucide-react'
import { type View } from './Sidebar'
import { getMaterial, KIND_META } from './materials'
import { MaterialView, MaterialBody } from './MaterialView'
import { NoteEditor } from './NoteEditor'
import { getAllNotes, useNotes } from './notesStore'
import { useBrain } from './brainStore'

/**
 * 学习空间 —— VS Code 式分栏:左侧资源管理器(我的笔记 + 资料),右侧书写/查看。
 * 单击进入,追求心流。笔记(可写)与资料(只读)分区呈现,层次清晰。
 */

interface SpaceItem {
  id: string
  name: string
  type: 'folder' | 'file' | 'web' | 'conversation'
  meta?: string
  defaultExpanded?: boolean
  children?: SpaceItem[]
}

/**
 * 空间里「读进来的材料 / 对话引用」—— 只读参考,服务于书写。
 * (「我写的笔记」是另一类可写对象,来自 notesStore,不在这棵树里。)
 * 接后端后,这份 mock 会被空间的真实内容列表替换。
 */
const SPACE_TREE: SpaceItem[] = [
  {
    id: 'f1',
    name: '2026年学习资料',
    type: 'folder',
    defaultExpanded: true,
    children: [
      { id: 'f1-1', name: 'PyTorch 入门笔记.pdf', type: 'file', meta: '2.4 MB' },
      { id: 'f1-2', name: 'CS231n 课程主页', type: 'web', meta: 'cs231n.stanford.edu' },
      { id: 'f1-3', name: '关于梯度下降的讨论', type: 'conversation', meta: '昨天' },
      { id: 'f1-5', name: '神经网络结构图.png', type: 'file', meta: '1.8 MB' },
      { id: 'f1-6', name: '梯度下降讲解.mp4', type: 'file', meta: '08:24' },
    ],
  },
  {
    id: 'f2',
    name: '阅读笔记',
    type: 'folder',
    defaultExpanded: false,
    children: [
      { id: 'f2-2', name: '卡片笔记法完整介绍', type: 'web', meta: 'zettelkasten.de' },
      { id: 'f2-3', name: '认知偏见与阅读整理', type: 'conversation', meta: '3天前' },
    ],
  },
  { id: 'f4', name: '学习框架制定对话', type: 'conversation', meta: '1周前' },
]

function itemIcon(type: SpaceItem['type'], size = 13) {
  switch (type) {
    case 'folder':
      return <Folder size={size} style={{ color: 'var(--aa-accent, #6865a7)' }} />
    case 'file':
      return <FileText size={size} style={{ color: '#87827c' }} />
    case 'web':
      return <Globe size={size} style={{ color: '#a8c4b4' }} />
    case 'conversation':
      return <MessageSquare size={size} style={{ color: 'var(--aa-accent, #6865a7)' }} />
  }
}

function TreeNode({
  item,
  depth,
  onSelect,
  selectedId,
  onRename,
  onDelete,
}: {
  item: SpaceItem
  depth: number
  onSelect: (id: string) => void
  selectedId: string | null
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(item.defaultExpanded ?? false)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const selected = selectedId === item.id
  const pl = 10 + depth * 14

  return (
    <div>
      <div
        className="group/row flex items-center gap-2 rounded-md cursor-pointer transition-colors"
        style={{
          paddingLeft: pl,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          background: selected
            ? 'var(--aa-surface-active, #e5e1db)'
            : hovered
            ? 'var(--aa-surface-hover, #eeebe6)'
            : 'transparent',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (editing) return
          onSelect(item.id)
          if (item.type === 'folder') setExpanded(!expanded)
        }}
      >
        {item.type === 'folder' ? (
          <span style={{ color: 'var(--aa-text-3, #aba39b)', width: 12, flexShrink: 0 }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {itemIcon(item.type)}

        {editing ? (
          <InlineName
            value={item.name}
            onCommit={(t) => {
              onRename(item.id, t)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {item.name}
          </span>
        )}

        {!editing && (
          <RowMenu
            visible={hovered}
            actions={[
              { label: '重命名', icon: <Pencil size={12} />, onClick: () => setEditing(true) },
              { label: '移除', icon: <Trash2 size={12} />, danger: true, onClick: () => onDelete(item.id) },
            ]}
          />
        )}
      </div>

      {item.type === 'folder' && expanded && item.children && (
        <div role="group">
          {item.children.map((child) => (
            <TreeNode
              key={child.id}
              item={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function countItems(tree: SpaceItem[]): number {
  return tree.reduce((n, item) => n + 1 + (item.children ? countItems(item.children) : 0), 0)
}

function getItem(tree: SpaceItem[], id: string): SpaceItem | undefined {
  for (const item of tree) {
    if (item.id === id) return item
    if (item.children) {
      const found = getItem(item.children, id)
      if (found) return found
    }
  }
  return undefined
}

/** 递归删除:返回一棵移除了 id 的新树(含其后代)。 */
function filterTree(tree: SpaceItem[], id: string): SpaceItem[] {
  return tree
    .filter((it) => it.id !== id)
    .map((it) => (it.children ? { ...it, children: filterTree(it.children, id) } : it))
}

/** 递归改写:对命中 id 的节点应用 fn,返回新树。 */
function mapTree(tree: SpaceItem[], id: string, fn: (it: SpaceItem) => SpaceItem): SpaceItem[] {
  return tree.map((it) => {
    const next = it.id === id ? fn(it) : it
    return next.children ? { ...next, children: mapTree(next.children, id, fn) } : next
  })
}

interface SpacePageProps {
  onNavigate: (v: View) => void
  /** 从搜索等入口跳转时,要求空间预先选中并打开的对象 id。 */
  targetId?: string | null
}

export function SpacePage({ onNavigate, targetId }: SpacePageProps) {
  const { notes, create, update, remove, reorder } = useNotes()
  const brain = useBrain()

  // Store order is the normal render source. A separate order exists only
  // during a drag gesture; keeping a permanent duplicate made creation render
  // against two different snapshots and visibly moved the selection.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const orderedNoteIds = dragOrder ?? notes.map((note) => note.id)
  const orderedNotes = orderedNoteIds
    .map((id) => notes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
  const moveNote = (from: number, to: number) => {
    const previous = dragOrderRef.current ?? notes.map((note) => note.id)
    const next = [...previous]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    dragOrderRef.current = next
    setDragOrder(next)
  }
  const commitOrder = () => {
    const next = dragOrderRef.current
    if (next === null) return
    reorder(next)
    dragOrderRef.current = null
    setDragOrder(null)
  }

  // 书写为中心:默认打开最近编辑的笔记(有 targetId 则优先)。
  const [selectedId, setSelectedId] = useState<string | null>(
    () => targetId ?? getAllNotes()[0]?.id ?? 'f1-1'
  )
  const [creatingNoteId, setCreatingNoteId] = useState<string | null>(null)
  const [fullscreenId, setFullscreenId] = useState<string | null>(null)
  // 资料树改为可变状态,才能支持重命名 / 移除(原型阶段;接后端后由空间内容接口驱动)。
  const [tree, setTree] = useState<SpaceItem[]>(SPACE_TREE)

  // 外部要求打开某个对象(搜索跳转)。
  useEffect(() => {
    if (targetId) setSelectedId(targetId)
  }, [targetId])

  const selectedNote = notes.find((n) => n.id === selectedId)
  const selectedItem = selectedId ? getItem(tree, selectedId) : null
  const selectedMaterial = selectedId ? getMaterial(selectedId) : undefined
  const fullscreenMaterial = fullscreenId ? getMaterial(fullscreenId) : undefined
  const itemCount = notes.length + countItems(tree)

  function handleCreateNote() {
    if (notes.length === 0) {
      const note = create({ title: '写下第一篇笔记' })
      setSelectedId(note.id)
      return
    }

    const note = create()
    openNameDraft(note.id)
  }

  function openNameDraft(id: string) {
    // The note is already inserted by the store before this selection update.
    // Normal rendering reads that same store order, so the selection never
    // renders against a stale list position.
    setSelectedId(id)
    setCreatingNoteId(id)
  }

  function finishCreatedNote(id: string, title: string) {
    update(id, { title })
    setCreatingNoteId((current) => current === id ? null : current)
  }

  function handleDeleteNote(id: string) {
    remove(id)
    if (dragOrderRef.current !== null) {
      const next = dragOrderRef.current.filter((noteId) => noteId !== id)
      dragOrderRef.current = next
      setDragOrder(next)
    }
    // 只在删的正是当前打开项时才清空右侧,避免误关别的。
    setSelectedId((prev) => (prev === id ? null : prev))
  }

  // 资料树:重命名 / 移除(递归定位)。
  function handleRenameItem(id: string, name: string) {
    setTree((t) => mapTree(t, id, (it) => ({ ...it, name })))
  }
  function handleDeleteItem(id: string) {
    setTree((t) => filterTree(t, id))
    setSelectedId((prev) => (prev === id ? null : prev))
  }

  // 就着一份材料新建笔记:带上 materialRefs(对象层),并在正文留下出处引子。
  function handleNoteFromMaterial(material: { id: string; title: string }) {
    const firstNote = notes.length === 0
    const note = create({
      title: firstNote ? '无标题' : undefined,
      body: `来自《${material.title}》\n\n`,
      materialRefs: [material.id],
    })
    if (firstNote) {
      setSelectedId(note.id)
      return
    }
    openNameDraft(note.id)
  }

  // 全屏/专注阅读材料:叠加在整屏之上
  if (fullscreenMaterial) {
    return <MaterialView material={fullscreenMaterial} onClose={() => setFullscreenId(null)} />
  }

  return (
    <DndProvider backend={HTML5Backend}>
    <section className="personal-space-surface flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      {/* 左侧资源管理器 */}
      <div
        className="shrink-0 flex flex-col"
        style={{ width: 288, borderRight: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
      >
        {/* 空间头 */}
        <header className="px-4 pt-4 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: '#a8c4b4' }} />
            <h1 className="text-sm font-semibold m-0 flex-1" style={{ color: 'var(--aa-text-1, #292722)' }}>
              学习空间
            </h1>
            <button
              onClick={() => onNavigate('search')}
              className="p-1 rounded transition-colors hover:bg-black/5"
              style={{ color: 'var(--aa-text-3, #aba39b)' }}
            >
              <Search size={13} />
            </button>
          </div>
          <p className="text-xs m-0 pl-[22px]" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
            {itemCount} 个对象
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {/* 我的笔记(可写) */}
          <div className="flex items-center justify-between px-2.5 mt-1 mb-1">
            <span className="text-xs font-medium" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              我的笔记
            </span>
            <button
              onClick={handleCreateNote}
              aria-label="新建笔记"
              className="p-0.5 rounded transition-colors hover:bg-black/5"
              style={{ color: 'var(--aa-text-3, #aba39b)' }}
            >
              <Plus size={13} />
            </button>
          </div>

          {notes.length === 0 && (
            <button
              onClick={handleCreateNote}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left transition-colors hover:bg-black/5"
              style={{ color: 'var(--aa-text-3, #aba39b)' }}
            >
              <span style={{ width: 12 }} />
              <NotebookPen size={13} />
              <span>写下第一篇笔记</span>
            </button>
          )}

          {orderedNotes.map((note, i) => (
            <NoteRow
              key={note.id}
              index={i}
              title={note.title}
              selected={selectedId === note.id}
              creating={creatingNoteId === note.id}
              onSelect={() => setSelectedId(note.id)}
              onRename={(t) => update(note.id, { title: t })}
              onCreateCommit={(title) => finishCreatedNote(note.id, title)}
              onCreateCancel={() => finishCreatedNote(note.id, '无标题')}
              onDelete={() => handleDeleteNote(note.id)}
              onMove={moveNote}
              onDrop={commitOrder}
            />
          ))}

          {/* 资料(只读参考) */}
          <div className="px-2.5 mt-4 mb-1">
            <span className="text-xs font-medium" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              资料
            </span>
          </div>
          <div role="tree">
            {tree.map((item) => (
              <TreeNode
                key={item.id}
                item={item}
                depth={0}
                onSelect={setSelectedId}
                selectedId={selectedId}
                onRename={handleRenameItem}
                onDelete={handleDeleteItem}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 右侧预览 / 编辑主区 */}
      {selectedNote ? (
        <NoteEditor
          note={selectedNote}
          onSave={update}
        />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {selectedMaterial ? (
            <>
              <header
                className="shrink-0 flex items-center gap-3 px-5"
                style={{ height: 48, borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: KIND_META[selectedMaterial.kind].color }}
                />
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
                    {selectedMaterial.title}
                  </span>
                  {selectedMaterial.meta && (
                    <span className="text-xs shrink-0" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                      {selectedMaterial.meta}
                    </span>
                  )}
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded shrink-0"
                  style={{ background: 'var(--aa-surface-hover, #eeebe6)', color: 'var(--aa-text-2, #87827c)' }}
                >
                  {selectedMaterial.origin === 'library' ? '引用自资料库' : '空间内产出'}
                </span>
                <div className="flex-1" />
                <CollectButton refId={selectedMaterial.id} kind="material" brain={brain} />
                <button
                  onClick={() => handleNoteFromMaterial(selectedMaterial)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
                  style={{ color: '#6f8778' }}
                >
                  <NotebookPen size={12} />
                  记一笔
                </button>
                <button
                  onClick={() => setFullscreenId(selectedMaterial.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
                  style={{ color: 'var(--aa-text-2, #87827c)' }}
                >
                  <Maximize2 size={12} />
                  专注
                </button>
              </header>
              <div className="flex-1 overflow-y-auto">
                <MaterialBody material={selectedMaterial} />
              </div>
            </>
          ) : selectedItem?.type === 'conversation' ? (
            <CenteredCard>
              <MessageSquare size={22} style={{ color: 'var(--aa-accent, #6865a7)' }} />
              <p className="text-sm mt-3 mb-1 font-medium" style={{ color: 'var(--aa-text-1, #292722)' }}>
                {selectedItem.name}
              </p>
              <p className="text-xs mb-5" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                对话引用 · {selectedItem.meta}
              </p>
              <button
                onClick={() => onNavigate('conv-done')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--aa-accent, #6865a7)' }}
              >
                打开对话
                <ArrowRight size={12} />
              </button>
            </CenteredCard>
          ) : selectedItem?.type === 'folder' ? (
            <FolderPane folder={selectedItem} onSelect={setSelectedId} />
          ) : (
            <CenteredCard>
              <p className="text-xs leading-relaxed text-center" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                从左侧选择一篇笔记或材料
                <br />
                即可在此书写或查看
              </p>
            </CenteredCard>
          )}
        </div>
      )}
    </section>
    </DndProvider>
  )
}

const DND_NOTE = 'space-note-row'

function NoteRow({
  index,
  title,
  selected,
  creating = false,
  onSelect,
  onRename,
  onCreateCommit,
  onCreateCancel,
  onDelete,
  onMove,
  onDrop,
}: {
  index: number
  title: string
  selected: boolean
  creating?: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onCreateCommit?: (title: string) => void
  onCreateCancel?: () => void
  onDelete: () => void
  onMove: (from: number, to: number) => void
  onDrop: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(creating)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (creating) setEditing(true)
  }, [creating])

  const [{ isDragging }, drag, preview] = useDrag({
    type: DND_NOTE,
    item: { index },
    canDrag: !editing,
    collect: (m) => ({ isDragging: m.isDragging() }),
    end: () => onDrop(), // 松手落盘
  })
  // 隐藏浏览器默认的半透明拖影(那个「原生图标」很难看);拖动反馈改由本行自身
  // 变淡(opacity)来体现,更贴合整体质感。
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true })
  }, [preview])
  const [, drop] = useDrop<{ index: number }>({
    accept: DND_NOTE,
    hover(item, monitor) {
      if (!ref.current || item.index === index) return
      const rect = ref.current.getBoundingClientRect()
      const midY = (rect.bottom - rect.top) / 2
      const offset = monitor.getClientOffset()
      if (!offset) return
      const y = offset.y - rect.top
      if (item.index < index && y < midY) return
      if (item.index > index && y > midY) return
      onMove(item.index, index)
      item.index = index // 记住新位置,避免抖动
    },
  })
  drop(ref)

  return (
    <div
      ref={ref}
      data-note-row
      className="group/note flex items-center gap-2 rounded-md cursor-pointer"
      style={{
        paddingLeft: 10,
        paddingRight: 8,
        // Draft and ordinary rows share one box size. A height change while
        // the focused title commits can move the user's click to another row.
        paddingTop: 6,
        paddingBottom: 6,
        opacity: isDragging ? 0.4 : 1,
        background: selected
          ? 'var(--aa-surface-active, #e5e1db)'
          : hovered
          ? 'var(--aa-surface-hover, #eeebe6)'
          : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!editing) onSelect()
      }}
      onDoubleClick={() => setEditing(true)}
    >
      {/* 拖拽手柄:在图标左侧,悬停时浮现,按住即可上下拖动排序。 */}
      <span
        ref={(node) => { drag(node) }}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center shrink-0 cursor-move"
        style={{ width: 12, color: 'var(--aa-text-3, #aba39b)', opacity: hovered && !editing ? 1 : 0 }}
        title=""
      >
        <GripVertical size={12} />
      </span>
      <NotebookPen size={13} style={{ color: '#6f8778' }} />
      {editing ? (
        <InlineName
          value={title}
          onCommit={(t) => {
            if (creating) onCreateCommit?.(t)
            else onRename(t)
            setEditing(false)
          }}
          onCancel={() => {
            if (creating) onCreateCancel?.()
            setEditing(false)
          }}
        />
      ) : (
        <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
          {title}
        </span>
      )}
      {!editing && (
        <RowMenu
          visible={hovered}
          actions={[
            { label: '重命名', icon: <Pencil size={12} />, onClick: () => setEditing(true) },
            { label: '删除', icon: <Trash2 size={12} />, danger: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  )
}

/** 行内重命名输入:回车/失焦提交,Esc 取消。 */
function InlineName({
  value,
  onCommit,
  onCancel,
}: {
  value: string
  onCommit: (v: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // 不再 select() 全选 —— 那会出现难看的蓝色原生选中块。
    // 改为把光标停在末尾,进入即可直接续写。
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
        color: 'var(--aa-text-1, #292722)',
        // 只用一条淡淡的下划线示意「正在编辑」,不再整体套一个蓝框。
        borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.25))',
        paddingBottom: 1,
      }}
    />
  )
}

/** 行尾「⋯」菜单:悬停时浮现,点开一个小下拉。 */
function RowMenu({
  visible,
  actions,
}: {
  visible: boolean
  actions: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded transition-colors hover:bg-black/10"
        style={{ width: 20, height: 20, color: 'var(--aa-text-3, #aba39b)', opacity: visible || open ? 1 : 0 }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 py-1 rounded-lg"
          style={{
            minWidth: 120,
            background: 'var(--aa-surface, #fff)',
            border: '1px solid var(--aa-border, rgba(45,40,34,0.09))',
            boxShadow: '0 6px 20px rgba(45,40,34,0.14)',
          }}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                setOpen(false)
                a.onClick()
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-black/5"
              style={{ color: a.danger ? '#b3543f' : 'var(--aa-text-1, #292722)' }}
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

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">{children}</div>
  )
}

function FolderPane({ folder, onSelect }: { folder: SpaceItem; onSelect: (id: string) => void }) {
  const children = folder.children ?? []
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto px-6 py-10" style={{ maxWidth: 640 }}>
        <div className="flex items-center gap-2.5 mb-1">
          <Folder size={18} style={{ color: 'var(--aa-accent, #6865a7)' }} />
          <h2 className="text-base font-semibold m-0" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {folder.name}
          </h2>
        </div>
        <p className="text-xs mb-6 pl-[26px]" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          {children.length} 个对象
        </p>

        <div className="space-y-1">
          {children.map((child) => (
            <button
              key={child.id}
              onClick={() => onSelect(child.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-left transition-colors hover:bg-black/5"
              style={{ border: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
            >
              {itemIcon(child.type, 14)}
              <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
                {child.name}
              </span>
              {child.meta && (
                <span className="text-xs shrink-0" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                  {child.meta}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 收藏进知识库 —— 把眼前这个对象从「空间里用得上」升格为「值得长期留下」。
 * 已收藏则显示为已入库状态,再点则移出。
 */
function CollectButton({
  refId,
  kind,
  brain,
}: {
  refId: string
  kind: 'note' | 'material'
  brain: ReturnType<typeof useBrain>
}) {
  const collected = brain.isCollected(refId)
  return (
    <button
      onClick={() => (collected ? brain.uncollect(refId) : brain.collect(refId, kind))}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
      style={{ color: collected ? 'var(--aa-accent, #6865a7)' : 'var(--aa-text-2, #87827c)' }}
    >
      <Brain size={12} />
      {collected ? '已收藏' : '收藏'}
    </button>
  )
}
