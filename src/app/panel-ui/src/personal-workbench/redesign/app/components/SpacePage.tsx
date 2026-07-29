import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { HTML5Backend, getEmptyImage } from 'react-dnd-html5-backend'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  FileImage,
  FileVideo,
  File,
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
import type {
  PersonalSpaceActions,
  PersonalSpaceItemProjection,
  PersonalSpaceProjection,
} from '../../../space'
import { getMaterial, KIND_META } from './materials'
import { MaterialView, MaterialBody } from './MaterialView'
import { DeferredSurfaceBoundary } from './DeferredSurfaceBoundary'
import { LEARNING_DEMO_SPACE_TREE } from './learningDemoDataset'
import { getAllNotes, useNotes } from './notesStore'
import { useBrain, type PageKind } from './brainStore'

const LazyNoteEditor = lazy(async () => {
  const module = await import('./NoteEditor')
  return { default: module.NoteEditor }
})

/**
 * 学习空间 —— VS Code 式分栏:左侧资源管理器(我的笔记 + 资料),右侧书写/查看。
 * 单击进入,追求心流。笔记(可写)与资料(只读)分区呈现,层次清晰。
 */

interface SpaceItem {
  id: string
  name: string
  type: 'folder' | 'file' | 'web' | 'conversation'
  domainKind: PersonalSpaceItemProjection['kind']
  meta?: string
  defaultExpanded?: boolean
  children?: SpaceItem[]
  demo?: boolean
  conversationId?: string
  openUrl?: string
  openable?: boolean
}

/**
 * 空间里「读进来的材料 / 对话引用」—— 只读参考,服务于书写。
 * (「我写的笔记」是另一类可写对象,来自 notesStore,不在这棵树里。)
 * 这份数据只在明确标记为 learning-workspace 的演示空间中展示。
 */
function fileIcon(name: string, size: number) {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(extension)) {
    return <FileImage size={size} style={{ color: '#6f8778' }} />
  }
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(extension)) {
    return <FileVideo size={size} style={{ color: '#9a7fae' }} />
  }
  if (extension === 'pdf') {
    return <FileText size={size} style={{ color: '#c25b45' }} />
  }
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(extension)) {
    return <FileText size={size} style={{ color: '#87827c' }} />
  }
  return <File size={size} style={{ color: '#87827c' }} />
}

function itemIcon(item: SpaceItem, size = 13) {
  switch (item.type) {
    case 'folder':
      return <Folder size={size} style={{ color: 'var(--aa-accent, #6865a7)' }} />
    case 'file':
      return fileIcon(item.name, size)
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
  renameEnabled,
  removeEnabled,
  isExpanded,
  onToggleExpand,
}: {
  item: SpaceItem
  depth: number
  onSelect: (id: string) => void
  selectedId: string | null
  onRename: (item: SpaceItem, name: string) => void
  onDelete: (item: SpaceItem) => void
  renameEnabled: boolean
  removeEnabled: boolean
  isExpanded: (id: string) => boolean
  onToggleExpand: (id: string) => void
}) {
  const expanded = isExpanded(item.id)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const selected = selectedId === item.id
  const canRename = !item.demo && renameEnabled
  const canRemove = !item.demo && item.domainKind !== 'folder' && removeEnabled
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
          if (item.type === 'folder') onToggleExpand(item.id)
        }}
      >
        {item.type === 'folder' ? (
          <span style={{ color: 'var(--aa-text-3, #aba39b)', width: 12, flexShrink: 0 }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {itemIcon(item)}

        {editing ? (
          <InlineName
            value={item.name}
            label={`重命名${item.name}`}
            onCommit={(t) => {
              onRename(item, t)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {item.name}
          </span>
        )}

        {!editing && (canRename || canRemove) && (
          <RowMenu
            label={`${item.name}操作`}
            visible={hovered}
            actions={[
              ...(canRename ? [{ label: '重命名', icon: <Pencil size={12} />, onClick: () => setEditing(true) }] : []),
              ...(canRemove ? [{ label: '移除', icon: <Trash2 size={12} />, danger: true, onClick: () => onDelete(item) }] : []),
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
              renameEnabled={renameEnabled}
              removeEnabled={removeEnabled}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
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

function projectSpaceTree(space: PersonalSpaceProjection | undefined): SpaceItem[] {
  if (space === undefined) return []
  const realItems = space.items.map(projectSpaceItem)
  return space.demoDataset === 'learning-workspace'
    ? [...LEARNING_DEMO_SPACE_TREE, ...realItems]
    : realItems
}

function projectSpaceItem(item: PersonalSpaceItemProjection): SpaceItem {
  return {
    id: item.itemId,
    name: item.title,
    type: visualItemType(item.kind),
    domainKind: item.kind,
    meta: item.detail ?? item.updatedAtLabel,
    defaultExpanded: item.kind === 'folder',
    children: item.children?.map(projectSpaceItem),
    conversationId: item.conversationId,
    openUrl: item.openUrl,
    openable: item.openable,
  }
}

function visualItemType(kind: PersonalSpaceItemProjection['kind']): SpaceItem['type'] {
  switch (kind) {
    case 'folder':
    case 'workspace_folder': return 'folder'
    case 'web_reference': return 'web'
    case 'conversation_reference': return 'conversation'
    default: return 'file'
  }
}

interface SpacePageProps {
  onNavigate: (v: View) => void
  space?: PersonalSpaceProjection
  actions?: PersonalSpaceActions
  currentConversation?: { conversationId: string; title: string }
  onOpenItem?: (spaceId: string, itemId: string) => void | Promise<void>
  onOpenConversation?: (conversationId: string) => boolean | Promise<boolean>
  /** 从搜索等入口跳转时,要求空间预先选中并打开的对象 id。 */
  targetId?: string | null
}

interface SpaceViewMemory {
  selectedId: string | null
  expandedIds: Set<string>
  scrollTop: number
}

const spaceViewMemory = new Map<string, SpaceViewMemory>()

function collectDefaultExpanded(tree: SpaceItem[], result = new Set<string>()): Set<string> {
  for (const item of tree) {
    if (item.type === 'folder' && item.defaultExpanded) result.add(item.id)
    if (item.children !== undefined) collectDefaultExpanded(item.children, result)
  }
  return result
}

export function SpacePage({
  onNavigate,
  targetId,
  space,
  actions,
  currentConversation,
  onOpenItem,
  onOpenConversation,
}: SpacePageProps) {
  const noteStore = useNotes()
  const spaceId = space?.spaceId
  const notes = useMemo(
    () => spaceId === undefined ? noteStore.notes : noteStore.notes.filter((note) => note.spaceId === spaceId),
    [noteStore.notes, spaceId],
  )
  const { create, update, remove, reorder } = noteStore
  const brain = useBrain(space === undefined ? [] : [space])

  // Store order is the normal render source. A separate order exists only
  // during a drag gesture; keeping a permanent duplicate made creation render
  // against two different snapshots and visibly moved the selection.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const orderedNotes = useMemo(() => {
    const notesById = new Map(notes.map((note) => [note.id, note]))
    const orderedNoteIds = dragOrder ?? notes.map((note) => note.id)
    return orderedNoteIds.flatMap((id) => notesById.get(id) ?? [])
  }, [dragOrder, notes])
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
  const tree = useMemo(() => projectSpaceTree(space), [space])
  const memoryKey = spaceId ?? 'prototype-space'
  const rememberedView = spaceViewMemory.get(memoryKey)
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    targetId
      ?? rememberedView?.selectedId
      ?? getAllNotes().find((note) => spaceId === undefined || note.spaceId === spaceId)?.id
      ?? tree[0]?.id
      ?? null
  ))
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(rememberedView?.expandedIds ?? collectDefaultExpanded(tree)),
  )
  const [creatingNoteId, setCreatingNoteId] = useState<string | null>(null)
  const [fullscreenId, setFullscreenId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const explorerRef = useRef<HTMLDivElement>(null)

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    const current = spaceViewMemory.get(memoryKey)
    spaceViewMemory.set(memoryKey, {
      selectedId,
      expandedIds,
      scrollTop: current?.scrollTop ?? 0,
    })
  }, [expandedIds, memoryKey, selectedId])
  useLayoutEffect(() => {
    const explorer = explorerRef.current
    if (explorer !== null) explorer.scrollTop = spaceViewMemory.get(memoryKey)?.scrollTop ?? 0
  }, [memoryKey])

  // 外部要求打开某个对象(搜索跳转)。
  useEffect(() => {
    if (targetId) setSelectedId(targetId)
  }, [targetId])

  const selectedNote = notes.find((n) => n.id === selectedId)
  const selectedItem = selectedId ? getItem(tree, selectedId) : null
  const selectedMaterial = selectedItem?.demo ? getMaterial(selectedItem.id) : undefined
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

  // Space feature owns mutations; this page only translates prototype intent.
  async function handleRenameItem(item: SpaceItem, name: string) {
    if (actions?.rename === undefined) return
    setActionError(null)
    try {
      await actions.rename({ kind: item.domainKind === 'folder' ? 'folder' : 'reference', id: item.id }, name)
    } catch (error) {
      setActionError(actionErrorMessage(error))
    }
  }
  async function handleDeleteItem(item: SpaceItem) {
    if (item.domainKind === 'folder' || actions?.removeReference === undefined) return
    setActionError(null)
    try {
      await actions.removeReference(item.id)
      setSelectedId((prev) => (prev === item.id ? null : prev))
    } catch (error) {
      setActionError(actionErrorMessage(error))
    }
  }

  async function handleOpenReference(item: SpaceItem) {
    if (item.conversationId !== undefined && onOpenConversation !== undefined) {
      const opened = await onOpenConversation(item.conversationId)
      if (opened !== false) onNavigate('conv-done')
      return
    }
    if (space !== undefined && onOpenItem !== undefined) {
      await onOpenItem(space.spaceId, item.id)
      return
    }
    if (item.openUrl !== undefined) window.open(item.openUrl, '_blank', 'noopener,noreferrer')
  }

  async function runSpaceAction(operation: () => void | Promise<void>) {
    setActionError(null)
    try {
      await operation()
    } catch (error) {
      setActionError(actionErrorMessage(error))
    }
  }

  function handleCreateFolder(title: string) {
    setCreatingFolder(false)
    if (space === undefined || actions?.createFolder === undefined) return
    void runSpaceAction(() => actions.createFolder!(space.spaceId, title))
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
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: space?.color ?? '#a8c4b4' }} />
            <h1 className="text-sm font-semibold m-0 flex-1" style={{ color: 'var(--aa-text-1, #292722)' }}>
              {space?.title ?? '空间'}
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
          {actionError && <p role="alert" className="text-xs mt-2 mb-0 pl-[22px]" style={{ color: '#b3543f' }}>{actionError}</p>}
        </header>

        <div
          ref={explorerRef}
          onScroll={(event) => {
            const current = spaceViewMemory.get(memoryKey)
            spaceViewMemory.set(memoryKey, {
              selectedId: current?.selectedId ?? selectedId,
              expandedIds: current?.expandedIds ?? expandedIds,
              scrollTop: event.currentTarget.scrollTop,
            })
          }}
          className="flex-1 overflow-y-auto px-2 pb-3"
        >
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
          <div className="flex items-center justify-between px-2.5 mt-4 mb-1">
            <span className="text-xs font-medium" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              资料
            </span>
            {space !== undefined && hasMaterialCreateAction(actions, currentConversation) && (
              <RowMenu
                label="添加资料"
                visible
                trigger={<Plus size={13} />}
                actions={[
                  ...(actions?.createFolder === undefined ? [] : [{
                    label: '新建文件夹',
                    icon: <Folder size={12} />,
                    onClick: () => setCreatingFolder(true),
                  }]),
                  ...(actions?.addLocalFile === undefined ? [] : [{
                    label: '添加本地文件',
                    icon: <FileText size={12} />,
                    onClick: () => void runSpaceAction(() => actions.addLocalFile!(space.spaceId)),
                  }]),
                  ...(actions?.addWorkspaceFolder === undefined ? [] : [{
                    label: '添加工作区文件夹',
                    icon: <Folder size={12} />,
                    onClick: () => void runSpaceAction(() => actions.addWorkspaceFolder!(space.spaceId)),
                  }]),
                  ...(actions?.addConversation === undefined || currentConversation === undefined ? [] : [{
                    label: '加入当前对话',
                    icon: <MessageSquare size={12} />,
                    onClick: () => void runSpaceAction(() => actions.addConversation!(
                      space.spaceId,
                      currentConversation.conversationId,
                      currentConversation.title,
                    )),
                  }]),
                ]}
              />
            )}
          </div>
          {creatingFolder && (
            <div className="flex items-center gap-2 rounded-md" style={{ padding: '5px 8px 5px 32px' }}>
              <Folder size={13} style={{ color: 'var(--aa-accent, #6865a7)' }} />
              <InlineName
                value=""
                label="文件夹名称"
                onCommit={handleCreateFolder}
                onCancel={() => setCreatingFolder(false)}
              />
            </div>
          )}
          <div role="tree" aria-label={`${space?.title ?? '空间'}资料`}>
            {tree.map((item) => (
              <TreeNode
                key={item.id}
                item={item}
                depth={0}
                onSelect={setSelectedId}
                selectedId={selectedId}
                onRename={handleRenameItem}
                onDelete={handleDeleteItem}
                renameEnabled={actions?.rename !== undefined}
                removeEnabled={actions?.removeReference !== undefined}
                isExpanded={(id) => expandedIds.has(id)}
                onToggleExpand={toggleExpanded}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 右侧预览 / 编辑主区 */}
      {selectedNote ? (
        <DeferredSurfaceBoundary resetKey={selectedNote.id} label="笔记编辑器暂时无法打开">
          <Suspense fallback={<NoteEditorLoading />}>
            <LazyNoteEditor
              note={selectedNote}
              onSave={update}
            />
          </Suspense>
        </DeferredSurfaceBoundary>
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
                对话引用{selectedItem.meta ? ` · ${selectedItem.meta}` : ''}
              </p>
              {(selectedItem.demo || selectedItem.conversationId !== undefined || onOpenItem !== undefined) && <button
                onClick={() => selectedItem.demo ? onNavigate('conv-done') : void handleOpenReference(selectedItem)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--aa-accent, #6865a7)' }}
              >
                打开对话
                <ArrowRight size={12} />
              </button>}
          </CenteredCard>
          ) : selectedItem?.domainKind === 'folder' ? (
            <FolderPane folder={selectedItem} onSelect={setSelectedId} />
          ) : selectedItem ? (
            <ReferencePane item={selectedItem} brain={brain} onOpen={() => void handleOpenReference(selectedItem)} />
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

function NoteEditorLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col px-12 py-10" aria-label="正在打开笔记">
      <span className="mb-8 h-7 w-2/5 animate-pulse rounded" style={{ background: 'var(--aa-surface-hover)' }} />
      <span className="mb-3 h-3 w-full animate-pulse rounded" style={{ background: 'var(--aa-surface-hover)' }} />
      <span className="mb-3 h-3 w-5/6 animate-pulse rounded" style={{ background: 'var(--aa-surface-hover)' }} />
      <span className="h-3 w-2/3 animate-pulse rounded" style={{ background: 'var(--aa-surface-hover)' }} />
    </div>
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
          label={creating ? '笔记名称' : `重命名${title}`}
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
          label={`${title}操作`}
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
  label,
  onCommit,
  onCancel,
}: {
  value: string
  label: string
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
      aria-label={label}
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
  label,
  visible,
  actions,
  trigger,
}: {
  label: string
  visible: boolean
  actions: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[]
  trigger?: ReactNode
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
        type="button"
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded transition-colors hover:bg-black/10"
        style={{ width: 20, height: 20, color: 'var(--aa-text-3, #aba39b)', opacity: visible || open ? 1 : 0 }}
      >
        {trigger ?? <MoreHorizontal size={14} />}
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

function ReferencePane({
  item,
  brain,
  onOpen,
}: {
  item: SpaceItem
  brain: ReturnType<typeof useBrain>
  onOpen: () => void
}) {
  const canOpen = item.openable === true || item.openUrl !== undefined
  return (
    <CenteredCard>
      {itemIcon(item, 24)}
      <p className="text-sm mt-3 mb-1 font-medium" style={{ color: 'var(--aa-text-1, #292722)' }}>
        {item.name}
      </p>
      <p className="text-xs mb-5 max-w-md break-all" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
        {referenceKindLabel(item.domainKind)}{item.meta ? ` · ${item.meta}` : ''}
      </p>
      <div className="flex items-center gap-2">
        <CollectButton refId={item.id} kind="space_reference" brain={brain} />
        {canOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--aa-accent, #6865a7)' }}
          >
            打开引用
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </CenteredCard>
  )
}

function referenceKindLabel(kind: PersonalSpaceItemProjection['kind']): string {
  switch (kind) {
    case 'folder': return '文件夹'
    case 'local_file': return '本地文件引用'
    case 'workspace_folder': return '工作区文件夹引用'
    case 'web_reference': return '网页引用'
    case 'generated_artifact': return '生成内容引用'
    case 'conversation_reference': return '对话引用'
  }
}

function actionErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : '空间操作没有完成，请重试。'
}

function hasMaterialCreateAction(
  actions: PersonalSpaceActions | undefined,
  currentConversation: SpacePageProps['currentConversation'],
): boolean {
  return actions?.createFolder !== undefined
    || actions?.addLocalFile !== undefined
    || actions?.addWorkspaceFolder !== undefined
    || (actions?.addConversation !== undefined && currentConversation !== undefined)
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
              {itemIcon(child, 14)}
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
  kind: PageKind
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
