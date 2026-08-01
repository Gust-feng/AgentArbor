import { useMemo, useSyncExternalStore } from 'react'
import { getNote } from './notesStore'
import { getCachedReferencePreview, getReferencePreviewCacheVersion, getReferencePreviewError, subscribeReferencePreviewCache } from './referencePreviewClient'
import {
  executePersonalKnowledgeCommand,
  collectManagedSpaceReference,
  getPersonalKnowledgeSnapshot,
  isPersonalKnowledgeMutationPending,
  subscribePersonalKnowledge,
  spaceReferenceSourceKey,
  type BrainLink,
  type BrainPage,
  type PageKind,
} from './personalKnowledgeClient'
import { classifyReferencePreview, type DocumentMaterialKind } from './documentProjection'

export type { BrainLink, BrainPage, PageKind } from './personalKnowledgeClient'

export function getPages(): BrainPage[] { return [...getPersonalKnowledgeSnapshot().pages].sort((a, b) => b.collectedAt - a.collectedAt) }
export function isCollected(refId: string): boolean { return getPages().some((page) => page.refId === refId) }
export function collect(refId: string, kind: PageKind): void {
  if (isCollected(refId) || isPersonalKnowledgeMutationPending(refId)) return
  const page = { refId, kind, collectedAt: Date.now() }
  const optimistic = (value: ReturnType<typeof getPersonalKnowledgeSnapshot>) => ({ ...value, pages: [page, ...value.pages] })
  if (kind === 'space_reference') return
  executePersonalKnowledgeCommand(optimistic, { type: 'knowledge.collect', page }, refId)
}
export function findCollectedSpaceReference(referenceId: string, relativePath = ''): BrainPage | undefined {
  const sourceKey = spaceReferenceSourceKey(referenceId, relativePath)
  return getPages().find((page) => page.kind === 'space_reference'
    && page.asset?.sourceReferenceId === referenceId
    && spaceReferenceSourceKey(referenceId, page.asset.sourceRelativePath) === sourceKey)
}
export function collectSpaceReference(referenceId: string, relativePath = ''): void {
  const sourceKey = spaceReferenceSourceKey(referenceId, relativePath)
  if (findCollectedSpaceReference(referenceId, relativePath) !== undefined || isPersonalKnowledgeMutationPending(sourceKey)) return
  collectManagedSpaceReference(referenceId, relativePath)
}
export function uncollect(refId: string, operationKey = refId): void {
  if (isPersonalKnowledgeMutationPending(operationKey)) return
  executePersonalKnowledgeCommand(
    (value) => ({
      ...value,
      pages: value.pages.filter((page) => page.refId !== refId),
      links: value.links.filter((link) => link.from !== refId && link.to !== refId),
      assignments: value.assignments.filter((assignment) => assignment.refId !== refId),
    }),
    { type: 'knowledge.uncollect', refId },
    operationKey,
  )
}
export function getLinks(): BrainLink[] { return getPersonalKnowledgeSnapshot().links }
export function markOpened(refId: string): void {
  const openedAt = Date.now()
  executePersonalKnowledgeCommand(
    (value) => ({ ...value, recentlyOpened: { ...value.recentlyOpened, [refId]: openedAt } }),
    { type: 'knowledge.opened', refId, openedAt },
  )
}
export function recentlyOpened(limit = 6): string[] {
  const value = getPersonalKnowledgeSnapshot()
  const alive = new Set(value.pages.map((page) => page.refId))
  return Object.keys(value.recentlyOpened).filter((refId) => alive.has(refId))
    .sort((left, right) => value.recentlyOpened[right] - value.recentlyOpened[left]).slice(0, limit)
}
export function recentlyCollected(limit = 6): string[] { return getPages().slice(0, limit).map((page) => page.refId) }
export function outgoing(refId: string): string[] { return getLinks().filter((link) => link.from === refId).map((link) => link.to) }
export function backlinks(refId: string): string[] { return getLinks().filter((link) => link.to === refId).map((link) => link.from) }
export function addLink(from: string, to: string): void {
  if (from === to || getLinks().some((link) => link.from === from && link.to === to)) return
  const link = { from, to }
  executePersonalKnowledgeCommand((value) => ({ ...value, links: [...value.links, link] }), { type: 'knowledge.link_add', link })
}
export function removeLink(from: string, to: string): void {
  executePersonalKnowledgeCommand(
    (value) => ({ ...value, links: value.links.filter((link) => link.from !== from || link.to !== to) }),
    { type: 'knowledge.link_remove', link: { from, to } },
  )
}

export interface ResolvedPage {
  refId: string
  kind: PageKind
  title: string
  collectedAt: number
  materialKind?: DocumentMaterialKind
  thumbnail?: string
  spaceId?: string
  detail?: string
  previewText?: string
  language?: string
  documentTarget?: { readonly apiBase: string; readonly itemId: string }
  exists: boolean
}

const MANAGED_ASSET_PREVIEW_BASE = '/api/personal-knowledge/assets'
const WORKBENCH_ASSET_PREVIEW_BASE = '/api/workbench-assets'
const subscribeManagedAssetPreviewCache = (listener: () => void) => subscribeReferencePreviewCache(listener, MANAGED_ASSET_PREVIEW_BASE)
const getManagedAssetPreviewCacheVersion = () => getReferencePreviewCacheVersion(MANAGED_ASSET_PREVIEW_BASE)

export function resolvePage(page: BrainPage): ResolvedPage {
  if (page.kind === 'note') {
    const note = getNote(page.refId)
    return { refId: page.refId, kind: 'note', title: note?.title || '无标题笔记', collectedAt: page.collectedAt, exists: note !== undefined }
  }
  const managed = page.kind === 'space_reference'
  const apiBase = managed ? MANAGED_ASSET_PREVIEW_BASE : WORKBENCH_ASSET_PREVIEW_BASE
  const preview = getCachedReferencePreview(page.refId, '', apiBase)
  const previewError = getReferencePreviewError(page.refId, '', apiBase)
  const fields = documentCardFields(preview)
  return {
    refId: page.refId,
    kind: managed ? 'space_reference' : 'material',
    title: managed
      ? page.asset?.title ?? '(知识资产不可用)'
      : preview?.title ?? (previewError === undefined ? '(材料加载中)' : '材料暂不可用'),
    collectedAt: page.collectedAt,
    ...fields,
    detail: managed ? page.asset?.sourceLabel : previewError,
    documentTarget: { apiBase, itemId: page.refId },
    exists: managed ? page.asset?.status === 'managed' : true,
  }
}

function documentCardFields(preview: ReturnType<typeof getCachedReferencePreview>): Pick<ResolvedPage, 'materialKind' | 'previewText' | 'thumbnail' | 'language'> {
  return {
    materialKind: classifyReferencePreview(preview),
    previewText: previewTextOf(preview),
    thumbnail: preview?.content.kind === 'media' && preview.content.mediaKind === 'image' ? preview.content.url : undefined,
    language: preview?.content.kind === 'text' ? preview.content.language : undefined,
  }
}

function previewTextOf(preview: ReturnType<typeof getCachedReferencePreview>): string | undefined {
  if (preview?.content.kind === 'text') return preview.content.text
  if (preview?.content.kind === 'web') return preview.content.body
  if (preview?.content.kind === 'pages') return preview.content.pages[0]
  if (preview?.content.kind === 'media') return preview.content.caption ?? preview.content.transcript
  return undefined
}
export function resolveById(refId: string): ResolvedPage | undefined {
  const page = getPages().find((candidate) => candidate.refId === refId)
  return page === undefined ? undefined : resolvePage(page)
}

export function useBrain() {
  const snapshot = useSyncExternalStore(
    subscribePersonalKnowledge,
    getPersonalKnowledgeSnapshot,
    getPersonalKnowledgeSnapshot,
  )
  const previewCacheVersion = useSyncExternalStore(
    subscribeManagedAssetPreviewCache,
    getManagedAssetPreviewCacheVersion,
    getManagedAssetPreviewCacheVersion,
  )
  const workbenchAssetPreviewCacheVersion = useSyncExternalStore(
    (listener) => subscribeReferencePreviewCache(listener, WORKBENCH_ASSET_PREVIEW_BASE),
    () => getReferencePreviewCacheVersion(WORKBENCH_ASSET_PREVIEW_BASE),
    () => getReferencePreviewCacheVersion(WORKBENCH_ASSET_PREVIEW_BASE),
  )
  const pages = useMemo(
    () => [...snapshot.pages].sort((left, right) => right.collectedAt - left.collectedAt),
    [snapshot.pages, snapshot.notes, previewCacheVersion, workbenchAssetPreviewCacheVersion],
  )
  const pageById = useMemo(() => new Map(pages.map((page) => [page.refId, page])), [pages])
  return {
    pages,
    isCollected: (refId: string) => pageById.has(refId),
    isPending: isPersonalKnowledgeMutationPending,
    findCollectedSpaceReference,
    collectSpaceReference,
    spaceReferenceSourceKey,
    collect,
    uncollect,
    addLink,
    removeLink,
    markOpened,
    getLinks,
    recentlyOpened: (limit = 6) => recentlyOpened(limit).filter((refId) => pageById.has(refId)),
    recentlyCollected: (limit = 6) => pages.slice(0, limit).map((page) => page.refId),
    outgoing,
    backlinks,
    resolvePage,
    resolveById: (refId: string) => {
      const page = pageById.get(refId)
      return page === undefined ? undefined : resolvePage(page)
    },
  }
}
