import { useMemo, useSyncExternalStore } from 'react'
import { getMaterial } from './materials'
import { getNote } from './notesStore'
import type { PersonalSpaceProjection } from '../../../space'
import { LEARNING_DEMO_KNOWLEDGE_MATERIAL_IDS } from './learningDemoDataset'
import { getCachedReferencePreview, getReferencePreviewCacheVersion, subscribeReferencePreviewCache } from './referencePreviewClient'
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
  materialKind?: 'file' | 'markdown' | 'pdf' | 'web' | 'image' | 'video' | 'audio' | 'code'
  thumbnail?: string
  spaceId?: string
  detail?: string
  previewText?: string
  managedAsset?: BrainPage['asset']
  demo?: boolean
  exists: boolean
}

const MANAGED_ASSET_PREVIEW_BASE = '/api/personal-knowledge/assets'
const subscribeManagedAssetPreviewCache = (listener: () => void) => subscribeReferencePreviewCache(listener, MANAGED_ASSET_PREVIEW_BASE)
const getManagedAssetPreviewCacheVersion = () => getReferencePreviewCacheVersion(MANAGED_ASSET_PREVIEW_BASE)

function managedAssetKind(page: BrainPage): NonNullable<ResolvedPage['materialKind']> {
  const asset = page.asset
  if (asset?.contentKind !== 'file') return 'file'
  const preview = getCachedReferencePreview(page.refId, '', MANAGED_ASSET_PREVIEW_BASE)
  if (preview?.content.kind === 'media') return preview.content.mediaKind
  if (preview?.content.kind === 'web') return 'web'
  if (preview?.content.kind === 'text') {
    if (preview.content.language === 'md' || preview.content.language === 'markdown') return 'markdown'
  }
  return materialKindFromSourceLabel(asset?.sourceLabel ?? asset?.title ?? '')
}

function materialKindFromSourceLabel(sourceLabel: string): NonNullable<ResolvedPage['materialKind']> {
  const source = sourceLabel.toLowerCase()
  if (/\.(?:md|markdown)$/u.test(source)) return 'markdown'
  if (/\.pdf$/u.test(source)) return 'pdf'
  if (/\.(?:png|jpe?g|gif|webp|svg|avif)$/u.test(source)) return 'image'
  if (/\.(?:mp4|webm|mov|mkv)$/u.test(source)) return 'video'
  if (/\.(?:mp3|wav|ogg|m4a|flac)$/u.test(source)) return 'audio'
  if (/\.(?:jsonc?|jsonl|ya?ml|toml|ini|xml|csv|ts|tsx|js|mjs|cjs|jsx|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|ps1|sql|graphql|vue|svelte|css|html)$/u.test(source)
    || /(?:^|[\\/])(?:\.gitignore|\.gitattributes|\.gitmodules|\.editorconfig|\.npmrc|\.nvmrc|\.env|dockerfile|makefile|license)$/u.test(source)) return 'code'
  return 'file'
}

function managedAssetPreviewText(page: BrainPage): string | undefined {
  const preview = getCachedReferencePreview(page.refId, '', MANAGED_ASSET_PREVIEW_BASE)
  return preview?.content.kind === 'text' ? preview.content.text : undefined
}

export function resolvePage(page: BrainPage, _spaces: readonly PersonalSpaceProjection[] = []): ResolvedPage {
  if (page.kind === 'note') {
    const note = getNote(page.refId)
    return { refId: page.refId, kind: 'note', title: note?.title || '无标题笔记', collectedAt: page.collectedAt, exists: note !== undefined }
  }
  if (page.kind === 'space_reference') {
    return {
      refId: page.refId,
      kind: 'space_reference',
      title: page.asset?.title ?? '(知识资产不可用)',
      collectedAt: page.collectedAt,
      materialKind: managedAssetKind(page),
      detail: page.asset?.sourceLabel,
      previewText: managedAssetPreviewText(page),
      exists: page.asset?.status === 'managed',
      managedAsset: page.asset,
    }
  }
  const material = getMaterial(page.refId)
  return {
    refId: page.refId,
    kind: 'material',
    title: material?.title ?? '(材料已不存在)',
    collectedAt: page.collectedAt,
    materialKind: material?.kind,
    thumbnail: material?.thumbnail,
    demo: LEARNING_DEMO_KNOWLEDGE_MATERIAL_IDS.includes(page.refId as (typeof LEARNING_DEMO_KNOWLEDGE_MATERIAL_IDS)[number]),
    exists: material !== undefined,
  }
}
export function resolveById(refId: string, spaces: readonly PersonalSpaceProjection[] = []): ResolvedPage | undefined {
  const page = getPages().find((candidate) => candidate.refId === refId)
  return page === undefined ? undefined : resolvePage(page, spaces)
}

export function useBrain(spaces: readonly PersonalSpaceProjection[] = []) {
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
  const pages = useMemo(() => [...snapshot.pages].sort((left, right) => right.collectedAt - left.collectedAt), [snapshot.pages, previewCacheVersion])
  const pageById = useMemo(() => new Map(pages.map((page) => [page.refId, page])), [pages])
  const isBuiltInMaterial = (refId: string) => LEARNING_DEMO_KNOWLEDGE_MATERIAL_IDS.includes(refId as (typeof LEARNING_DEMO_KNOWLEDGE_MATERIAL_IDS)[number])
  return {
    pages,
    isCollected: (refId: string) => pageById.has(refId),
    isPending: isPersonalKnowledgeMutationPending,
    findCollectedSpaceReference,
    collectSpaceReference,
    spaceReferenceSourceKey,
    collect: (refId: string, kind: PageKind) => { if (!isBuiltInMaterial(refId)) collect(refId, kind) },
    uncollect: (refId: string, operationKey = refId) => { if (!isBuiltInMaterial(refId)) uncollect(refId, operationKey) },
    addLink,
    removeLink,
    markOpened: (refId: string) => { if (!isBuiltInMaterial(refId)) markOpened(refId) },
    getLinks,
    recentlyOpened: (limit = 6) => recentlyOpened(limit).filter((refId) => pageById.has(refId)),
    recentlyCollected: (limit = 6) => pages.slice(0, limit).map((page) => page.refId),
    outgoing,
    backlinks,
    resolvePage: (page: BrainPage) => resolvePage(page, spaces),
    resolveById: (refId: string) => {
      const page = pageById.get(refId)
      return page === undefined ? undefined : resolvePage(page, spaces)
    },
  }
}
