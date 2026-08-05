import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  FilePlus,
  Globe,
  MessageSquare,
  Plus,
  Search,
  ArrowRight,
  NotebookPen,
  Brain,
  MoreHorizontal,
  Pencil,
  Trash2,
  Unlink,
  GripVertical,
} from 'lucide-react'
import { type View } from './Sidebar'
import type {
  PersonalSpaceActions,
  PersonalSpaceProjection,
} from '../../../space'
import { ReferencePreview, type ReferencePreviewHandle } from './ReferencePreview'
import { NoteEditor } from './NoteEditor'
import { createSpaceReferenceEntry, deleteSpaceReferenceEntry, fetchDocumentPreview, getCachedReferencePreview, renameSpaceReferenceEntry } from './referencePreviewClient'
import { prefetchDocumentSurface } from './documentPreviewWarmup'
import { DeferredSurfaceBoundary } from './DeferredSurfaceBoundary'
import {
  useMountedTree,
  getItem,
  referenceChildId,
  isFileSystemFolderKind,
  actionErrorMessage,
  type SpaceItem,
} from './useMountedTree'
import { useNotes } from './notesStore'
import { useBrain, type PageKind } from './brainStore'
import {
  ActionConfirmationDialog,
  type ActionConfirmationRequest,
} from './ActionConfirmationDialog'

/**
 * 学习空间 —— VS Code 式分栏:左侧资源管理器(我的笔记 + 资料),右侧书写/查看。
 * 单击进入,追求心流。笔记与外部引用分区呈现；引用是否可编辑由来源能力决定。
 */

/**
 * 空间里的材料 / 对话引用。引用保留外部来源身份，文本来源可在冲突保护下编辑。
 * (「我写的笔记」是另一类可写对象,来自 notesStore,不在这棵树里。)
 * 所有条目都来自 SpaceFeature 的真实投影；初始内容由后端首次启动初始化。
 */

function prefetchReferencePreview(referenceId: string, relativePath: string): Promise<void> {
  const cached = getCachedReferencePreview(referenceId, relativePath)
  if (cached !== undefined) {
    prefetchDocumentSurface(cached)
    return Promise.resolve()
  }
  return fetchDocumentPreview(referenceId, relativePath).then((preview) => {
    prefetchDocumentSurface(preview)
  })
}
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
  onUnlink,
  onDelete,
  onCreateEntry,
  renameEnabled,
  unlinkEnabled,
  removeEnabled,
  removeManagedFolderEnabled,
  isExpanded,
  onToggleExpand,
  onPrefetch,
  creatingEntry,
  onCreateEntryCommit,
  onCreateEntryCancel,
}: {
  item: SpaceItem
  depth: number
  onSelect: (id: string) => void
  selectedId: string | null
  onRename: (item: SpaceItem, name: string) => void
  onUnlink: (item: SpaceItem) => void
  onDelete: (item: SpaceItem) => void
  onCreateEntry: (item: SpaceItem) => void
  renameEnabled: boolean
  unlinkEnabled: boolean
  removeEnabled: boolean
  removeManagedFolderEnabled: boolean
  isExpanded: (id: string) => boolean
  onToggleExpand: (id: string) => void
  onPrefetch: (item: SpaceItem) => void
  creatingEntry?: { readonly parentId: string }
  onCreateEntryCommit: (name: string) => void
  onCreateEntryCancel: () => void
}) {
  const expanded = isExpanded(item.id)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const selected = selectedId === item.id
  const canMutateExternalEntry = item.externalChild && item.referenceId !== undefined && item.relativePath !== undefined
  const isManagedFolder = !item.externalChild && item.domainKind === 'managed_folder'
  const canCreateExternalEntry = item.type === 'folder' && item.referenceId !== undefined && isFileSystemFolderKind(item.domainKind)
  const canRename = canMutateExternalEntry || (!item.externalChild && renameEnabled)
  const canUnlink = !item.externalChild
    && item.domainKind !== 'folder'
    && item.domainKind !== 'managed_folder'
    && unlinkEnabled
  const canRemove = canMutateExternalEntry
    || (isManagedFolder && removeManagedFolderEnabled)
    || (!item.externalChild && (item.domainKind === 'folder' || item.domainKind === 'local_file') && removeEnabled)
  const pl = 10 + depth * 14

  return (
    <div>
      <div
        className="group/row flex items-center gap-2 rounded-md cursor-pointer transition-colors"
        style={{
          height: 30,
          paddingLeft: pl,
          paddingRight: 8,
          background: selected
            ? 'var(--aa-surface-active, #e5e1db)'
            : hovered
            ? 'var(--aa-surface-hover, #eeebe6)'
            : 'transparent',
        }}
        onMouseEnter={() => { setHovered(true); onPrefetch(item) }}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (editing) return
          if (item.type === 'folder') {
            onToggleExpand(item.id)
            return
          }
          onSelect(item.id)
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
          <span
            className="flex-1 text-sm truncate"
            style={{ color: item.status === 'unavailable' ? 'var(--aa-text-3, #aba39b)' : 'var(--aa-text-1, #292722)' }}
            title={item.status === 'unavailable' ? '来源已找不到' : undefined}
          >
            {item.name}
            {item.status === 'unavailable' && (
              <span className="ml-1.5 text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                已找不到
              </span>
            )}
          </span>
        )}

        {!editing && (canCreateExternalEntry || canRename || canUnlink || canRemove) && (
          <RowMenu
            label={`${item.name}操作`}
            visible={hovered}
            actions={[
              ...(canCreateExternalEntry ? [{ label: '新建文件', icon: <FilePlus size={12} />, onClick: () => onCreateEntry(item) }] : []),
              ...(canRename ? [{ label: '重命名', icon: <Pencil size={12} />, onClick: () => setEditing(true) }] : []),
              ...(canUnlink ? [{ label: '取消链接', icon: <Unlink size={12} />, onClick: () => onUnlink(item) }] : []),
              ...(canRemove ? [{ label: deleteLabelFor(item), icon: <Trash2 size={12} />, danger: true, onClick: () => onDelete(item) }] : []),
            ]}
          />
        )}
        {editing && <span style={{ width: 20, flexShrink: 0 }} />}
      </div>

      {creatingEntry?.parentId === item.id && (
        <div className="flex items-center gap-2" style={{ height: 30, paddingLeft: 10 + (depth + 1) * 14, paddingRight: 8 }}>
          <span style={{ width: 12, flexShrink: 0 }} />
          <FileText size={13} style={{ color: '#87827c' }} />
          <InlineName value="" label="文件名称" onCommit={onCreateEntryCommit} onCancel={onCreateEntryCancel} />
          <span style={{ width: 20, flexShrink: 0 }} />
        </div>
      )}

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
              onUnlink={onUnlink}
              onDelete={onDelete}
              onCreateEntry={onCreateEntry}
              renameEnabled={renameEnabled}
              unlinkEnabled={unlinkEnabled}
              removeEnabled={removeEnabled}
              removeManagedFolderEnabled={removeManagedFolderEnabled}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onPrefetch={onPrefetch}
              creatingEntry={creatingEntry}
              onCreateEntryCommit={onCreateEntryCommit}
              onCreateEntryCancel={onCreateEntryCancel}
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

function deleteLabelFor(item: SpaceItem): string {
  if (item.externalChild) return item.type === 'folder' ? '删除文件夹' : '删除'
  if (item.domainKind === 'folder' || item.domainKind === 'managed_folder') return '删除文件夹'
  return item.domainKind === 'local_file' ? '删除文件' : '删除'
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
  expandedIds: ReadonlySet<string>
  scrollTop: number
}

type PendingSpaceConfirmation = {
  readonly request: ActionConfirmationRequest
  readonly action: () => void | Promise<void>
}

const spaceViewMemory = new Map<string, SpaceViewMemory>()

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
  const brain = useBrain()

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
  const [creatingNoteId, setCreatingNoteId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [creatingReferenceFile, setCreatingReferenceFile] = useState<{ referenceId: string; parentId: string; parentPath: string } | null>(null)
  const [pendingSpaceConfirmation, setPendingSpaceConfirmation] = useState<PendingSpaceConfirmation | null>(null)
  const explorerRef = useRef<HTMLDivElement>(null)
  const referencePreviewRef = useRef<ReferencePreviewHandle>(null)
  const memoryKey = spaceId ?? 'prototype-space'
  const rememberedView = spaceViewMemory.get(memoryKey)
  const mountedTree = useMountedTree({
    spaceId: memoryKey,
    space,
    initialExpandedIds: rememberedView?.expandedIds,
    onError: setActionError,
  })
  const { tree, projectedTree, expandedIds } = mountedTree
  // 书写为中心:默认打开最近一篇笔记(有 targetId / 记忆选择则优先)，再回退到首个空间对象。
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    targetId ?? rememberedView?.selectedId ?? notes[0]?.id ?? tree[0]?.id ?? null
  ))
  const selectedStillExists = selectedId !== null
    && (notes.some((note) => note.id === selectedId) || getItem(tree, selectedId) !== undefined)

  function selectItem(id: string) {
    setActionError(null)
    setSelectedId(id)
  }

  function prefetchTreeItem(item: SpaceItem) {
    if (item.type === 'folder') {
      void mountedTree.loadDirectory(item)
      return
    }
    const referenceId = item.referenceId ?? item.id
    const relativePath = item.relativePath ?? ''
    void prefetchReferencePreview(referenceId, relativePath).catch(() => undefined)
  }

  function selectTreeItem(id: string) {
    const item = getItem(tree, id)
    if (item === undefined || item.type === 'folder') {
      selectItem(id)
      return
    }
    const referenceId = item.referenceId ?? item.id
    const relativePath = item.relativePath ?? ''
    void prefetchReferencePreview(referenceId, relativePath).catch((error: unknown) => setActionError(actionErrorMessage(error)))
    selectItem(id)
  }

  function toggleExpanded(id: string) {
    // 展开 / 加载 / 缓存收口到 useMountedTree；这里只把 id 解析成条目后委派。
    const item = getItem(tree, id)
    if (item !== undefined) mountedTree.toggleExpand(item)
  }

  useEffect(() => {
    const current = spaceViewMemory.get(memoryKey)
    spaceViewMemory.set(memoryKey, {
      selectedId,
      expandedIds,
      scrollTop: current?.scrollTop ?? 0,
    })
  }, [expandedIds, memoryKey, selectedId])
  useEffect(() => {
    if (targetId !== null && targetId !== undefined) return
    if (selectedStillExists) return
    const nextId = notes[0]?.id ?? tree[0]?.id ?? null
    setSelectedId(nextId)
  }, [selectedStillExists, targetId, notes, tree])
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
  const selectedReferenceRoot = selectedItem?.referenceId === undefined ? undefined : getItem(tree, selectedItem.referenceId)
  const itemCount = notes.length + (space?.itemCount ?? countItems(projectedTree))

  function handleCreateNote() {
    if (notes.length === 0) {
      const note = create({ spaceId, title: '写下第一篇笔记' })
      setSelectedId(note.id)
      return
    }

    const note = create({ spaceId })
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
    if (item.externalChild && item.referenceId !== undefined && item.relativePath !== undefined) {
      setActionError(null)
      try {
        if (selectedId === item.id) await referencePreviewRef.current?.flush()
        const nextRelativePath = await renameSpaceReferenceEntry(item.referenceId, item.relativePath, name)
        await mountedTree.refreshParentOf(item.referenceId, item.relativePath)
        await fetchDocumentPreview(item.referenceId, nextRelativePath)
        setSelectedId((current) => current === item.id ? referenceChildId(item.referenceId!, nextRelativePath) : current)
      } catch (error) {
        setActionError(actionErrorMessage(error))
      }
      return
    }
    if (actions?.rename === undefined) return
    setActionError(null)
    try {
      await actions.rename({ kind: 'reference', id: item.id }, name)
    } catch (error) {
      setActionError(actionErrorMessage(error))
    }
  }
  function requestSpaceConfirmation(request: ActionConfirmationRequest, action: () => void | Promise<void>): void {
    setPendingSpaceConfirmation({ request, action })
  }

  function confirmPendingSpaceAction(): void {
    const pending = pendingSpaceConfirmation
    if (pending === null) return
    setPendingSpaceConfirmation(null)
    void runSpaceAction(pending.action)
  }

  function handleDeleteItem(item: SpaceItem) {
    if (item.externalChild && item.referenceId !== undefined && item.relativePath !== undefined) {
      const referenceId = item.referenceId
      const relativePath = item.relativePath
      requestSpaceConfirmation({
        eyebrow: item.type === 'folder' ? '文件夹操作' : '文件操作',
        title: `删除“${item.name}”`,
        description: `这会删除磁盘上的${item.type === 'folder' ? '文件夹及其内容' : '文件'}。`,
        consequence: '此操作不可撤销。',
        confirmLabel: item.type === 'folder' ? '删除文件夹' : '删除文件',
      }, async () => {
        if (selectedId === item.id) referencePreviewRef.current?.discard()
        await deleteSpaceReferenceEntry(referenceId, relativePath)
        await mountedTree.refreshParentOf(referenceId, relativePath)
        setSelectedId((current) => current === item.id ? null : current)
      })
      return
    }
    if (item.domainKind === 'managed_folder') {
      const removeReference = actions?.removeReference
      if (removeReference === undefined) return
      requestSpaceConfirmation({
        eyebrow: '软件存储',
        title: `删除“${item.name}”及其中的所有文件`,
        description: '这会从软件存储中物理删除整个文件夹。',
        consequence: '此操作不可撤销。',
        confirmLabel: '删除文件夹',
      }, async () => {
        await removeReference(item.id)
        setSelectedId((prev) => (prev === item.id ? null : prev))
      })
      return
    }
    const removeReference = actions?.removeReference
    if (removeReference === undefined) return
    const deletesLocalFile = item.domainKind === 'local_file'
    const deletesOwnedSubtree = item.domainKind === 'folder'
    requestSpaceConfirmation({
      eyebrow: deletesLocalFile || deletesOwnedSubtree ? '空间资料' : '空间链接',
      title: deletesLocalFile
        ? `删除“${item.name}”`
        : deletesOwnedSubtree
          ? `删除“${item.name}”及其所有子项`
          : `取消“${item.name}”与当前空间的链接`,
      description: deletesLocalFile
        ? '这会从磁盘上删除该文件。'
        : deletesOwnedSubtree
          ? '其中本地文件和软件自建文件夹会从磁盘删除，其他内容仅取消链接。'
          : '空间将不再引用此内容。',
      consequence: deletesLocalFile || deletesOwnedSubtree
        ? '请确认你了解这项操作对空间内容的影响。'
        : '磁盘内容不会被删除。',
      confirmLabel: deletesLocalFile
        ? '删除文件'
        : deletesOwnedSubtree
          ? '删除文件夹'
          : '取消链接',
     destructive: !deletesLocalFile && !deletesOwnedSubtree ? false : undefined,
    }, async () => {
      await removeReference(item.id)
      setSelectedId((prev) => (prev === item.id ? null : prev))
    })
  }

  async function handleUnlinkItem(item: SpaceItem) {
    if (actions?.unlinkReference === undefined) return
    setActionError(null)
    try {
      await actions.unlinkReference(item.id)
      setSelectedId((current) => current === item.id ? null : current)
    } catch (error) {
      setActionError(actionErrorMessage(error))
    }
  }

  // 目录加载 / 缓存 / 展开已收口到 useMountedTree；这里只剩读写动作与对外导航。

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
    if (space === undefined || actions?.createManagedFolder === undefined) return
    void runSpaceAction(() => actions.createManagedFolder!(space.spaceId, title))
  }

  function handleNoteFromMaterial(material: { id: string; title: string }) {
    const firstNote = notes.length === 0
    const note = create({
      spaceId,
      title: firstNote ? '无标题' : undefined,
      bodyMarkdown: `来自《${material.title}》\n\n`,
      materialRefs: [material.id],
    })
    if (firstNote) {
      setSelectedId(note.id)
      return
    }
    openNameDraft(note.id)
  }

  function beginCreateReferenceFile(targetItem?: SpaceItem) {
    const sourceReferenceId = targetItem?.referenceId
    const root = sourceReferenceId === undefined
      ? tree.find((item) => isFileSystemFolderKind(item.domainKind) && item.referenceId !== undefined)
      : getItem(tree, sourceReferenceId)
    if (root === undefined) return
    let parent = root
    if (targetItem !== undefined && sourceReferenceId !== undefined) {
      if (targetItem.type === 'folder') parent = targetItem
      else if (targetItem.relativePath !== undefined) {
        const separator = targetItem.relativePath.lastIndexOf('/')
        const parentPath = separator < 0 ? '' : targetItem.relativePath.slice(0, separator)
        parent = parentPath.length === 0 ? root : getItem(tree, referenceChildId(sourceReferenceId, parentPath)) ?? root
      }
    }
    const referenceId = parent.referenceId ?? parent.id
    mountedTree.expandItem(parent)
    setCreatingReferenceFile({ referenceId, parentId: parent.id, parentPath: parent.relativePath ?? '' })
  }

  async function finishCreateReferenceFile(name: string) {
    const target = creatingReferenceFile
    if (target === null) return
    setCreatingReferenceFile(null)
    setActionError(null)
    try {
      const relativePath = await createSpaceReferenceEntry(target.referenceId, target.parentPath, name)
      await mountedTree.refreshByReference(target.referenceId, target.parentPath)
      await fetchDocumentPreview(target.referenceId, relativePath)
      setSelectedId(referenceChildId(target.referenceId, relativePath))
    } catch (error) {
      setActionError(actionErrorMessage(error))
    }
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
              onSelect={() => selectItem(note.id)}
              onRename={(t) => update(note.id, { title: t })}
              onCreateCommit={(title) => finishCreatedNote(note.id, title)}
              onCreateCancel={() => finishCreatedNote(note.id, '无标题')}
              onDelete={() => handleDeleteNote(note.id)}
              onMove={moveNote}
              onDrop={commitOrder}
            />
          ))}

          {/* 外部资料引用 */}
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
                  ...(actions?.createManagedFolder === undefined ? [] : [{
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
                onSelect={selectTreeItem}
                selectedId={selectedId}
                onRename={handleRenameItem}
                onUnlink={handleUnlinkItem}
                onDelete={handleDeleteItem}
                onCreateEntry={beginCreateReferenceFile}
                renameEnabled={actions?.rename !== undefined}
                unlinkEnabled={actions?.unlinkReference !== undefined}
                removeEnabled={actions?.removeReference !== undefined}
                removeManagedFolderEnabled={actions?.removeReference !== undefined}
                isExpanded={(id) => expandedIds.has(id)}
                onToggleExpand={toggleExpanded}
                onPrefetch={prefetchTreeItem}
                creatingEntry={creatingReferenceFile ?? undefined}
                onCreateEntryCommit={(name) => void finishCreateReferenceFile(name)}
                onCreateEntryCancel={() => setCreatingReferenceFile(null)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 右侧预览 / 编辑主区 */}
      {selectedNote ? (
        <DeferredSurfaceBoundary resetKey={selectedNote.id} label="笔记编辑器暂时无法打开">
            <NoteEditor
              note={selectedNote}
              onSave={update}
              onClose={() => setSelectedId(null)}
              onRestoreAsNew={(draft) => {
                const restored = create({ title: draft.title.trim() || '无标题', bodyMarkdown: draft.bodyMarkdown })
                setSelectedId(restored.id)
              }}
            />
        </DeferredSurfaceBoundary>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {selectedItem?.type === 'conversation' ? (
            <CenteredCard>
              <MessageSquare size={22} style={{ color: 'var(--aa-accent, #6865a7)' }} />
              <p className="text-sm mt-3 mb-1 font-medium" style={{ color: 'var(--aa-text-1, #292722)' }}>
                {selectedItem.name}
              </p>
              <p className="text-xs mb-5" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
                对话引用{selectedItem.meta ? ` · ${selectedItem.meta}` : ''}
              </p>
              {(selectedItem.conversationId !== undefined || onOpenItem !== undefined) && <button
                onClick={() => void handleOpenReference(selectedItem)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--aa-accent, #6865a7)' }}
              >
                打开对话
                <ArrowRight size={12} />
              </button>}
          </CenteredCard>
          ) : selectedItem?.type !== 'folder' && selectedItem ? (
            <ReferencePreview
              ref={referencePreviewRef}
              itemId={selectedItem.referenceId ?? selectedItem.id}
              initialRelativePath={selectedItem.relativePath ?? ''}
              fallbackTitle={selectedReferenceRoot?.name ?? selectedItem.name}
              canOpen={selectedItem.openable === true || selectedItem.openUrl !== undefined}
              onOpen={() => void handleOpenReference(selectedItem)}
              actions={<CollectButton
                refId={selectedItem.assetId ?? selectedItem.id}
                kind={selectedItem.domainKind === 'workbench_asset' ? 'material' : 'space_reference'}
                sourceReferenceId={selectedItem.domainKind === 'workbench_asset' ? undefined : selectedItem.referenceId ?? selectedItem.id}
                sourceRelativePath={selectedItem.relativePath ?? ''}
                brain={brain}
              />}
            />
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
    <ActionConfirmationDialog
      request={pendingSpaceConfirmation?.request}
      onCancel={() => setPendingSpaceConfirmation(null)}
      onConfirm={confirmPendingSpaceAction}
    />
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
  const settledRef = useRef(false)
  const blurTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // 不再 select() 全选 —— 那会出现难看的蓝色原生选中块。
    // 改为把光标停在末尾,进入即可直接续写。
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [])
  useEffect(() => () => {
    if (blurTimerRef.current !== undefined) window.clearTimeout(blurTimerRef.current)
  }, [])
  function cancel() {
    if (settledRef.current) return
    settledRef.current = true
    onCancel()
  }
  function commit() {
    if (settledRef.current) return
    settledRef.current = true
    const t = draft.trim()
    if (t) onCommit(t)
    else onCancel()
  }
  function scheduleBlurCommit() {
    if (blurTimerRef.current !== undefined) window.clearTimeout(blurTimerRef.current)
    blurTimerRef.current = window.setTimeout(() => {
      blurTimerRef.current = undefined
      if (document.activeElement !== ref.current) commit()
    }, 0)
  }
  return (
    <input
      ref={ref}
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => {
        if (blurTimerRef.current !== undefined) window.clearTimeout(blurTimerRef.current)
        blurTimerRef.current = undefined
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={scheduleBlurCommit}
      className="flex-1 min-w-0 text-sm bg-transparent outline-none"
      style={{
        height: 20,
        lineHeight: '19px',
        boxSizing: 'border-box',
        color: 'var(--aa-text-1, #292722)',
        // 只用一条淡淡的下划线示意「正在编辑」,不再整体套一个蓝框。
        borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.25))',
        padding: 0,
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
            width: 'max-content',
            maxWidth: 220,
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
              style={{ color: a.danger ? '#b3543f' : 'var(--aa-text-1, #292722)', whiteSpace: 'nowrap' }}
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

function hasMaterialCreateAction(
  actions: PersonalSpaceActions | undefined,
  currentConversation: SpacePageProps['currentConversation'],
): boolean {
  return actions?.createManagedFolder !== undefined
    || actions?.addLocalFile !== undefined
    || actions?.addWorkspaceFolder !== undefined
    || (actions?.addConversation !== undefined && currentConversation !== undefined)
}

/**
 * 收藏进知识库 —— 把眼前这个对象从「空间里用得上」升格为「值得长期留下」。
 * 已收藏则显示为已入库状态,再点则移出。
 */
function CollectButton({
  refId,
  kind,
  brain,
  sourceReferenceId,
  sourceRelativePath = '',
}: {
  refId: string
  kind: PageKind
  brain: ReturnType<typeof useBrain>
  sourceReferenceId?: string
  sourceRelativePath?: string
}) {
  const sourcePage = sourceReferenceId === undefined ? undefined : brain.findCollectedSpaceReference(sourceReferenceId, sourceRelativePath)
  const collected = sourceReferenceId === undefined ? brain.isCollected(refId) : sourcePage !== undefined
  const pendingKey = sourceReferenceId === undefined ? refId : brain.spaceReferenceSourceKey(sourceReferenceId, sourceRelativePath)
  const pending = brain.isPending(pendingKey)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (sourceReferenceId !== undefined) {
          if (sourcePage !== undefined) brain.uncollect(sourcePage.refId, pendingKey)
          else brain.collectSpaceReference(sourceReferenceId, sourceRelativePath)
          return
        }
        if (collected) brain.uncollect(refId)
        else brain.collect(refId, kind)
      }}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
      style={{ color: collected ? 'var(--aa-accent, #6865a7)' : 'var(--aa-text-2, #87827c)' }}
    >
      <Brain size={12} />
      {pending ? (collected ? '正在取消…' : '正在收藏…') : collected ? '已收藏' : '收藏'}
    </button>
  )
}
