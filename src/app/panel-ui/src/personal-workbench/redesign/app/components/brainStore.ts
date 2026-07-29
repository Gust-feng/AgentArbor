import { useMemo, useSyncExternalStore } from 'react'
import { getMaterial } from './materials'
import { getNote } from './notesStore'
import type { PersonalSpaceItemProjection, PersonalSpaceProjection } from '../../../space'
import {
  executePersonalKnowledgeCommand,
  getPersonalKnowledgeSnapshot,
  subscribePersonalKnowledge,
  type BrainLink,
  type BrainPage,
  type PageKind,
} from './personalKnowledgeClient'

export type { BrainLink, BrainPage, PageKind } from './personalKnowledgeClient'

export function getPages(): BrainPage[] { return [...getPersonalKnowledgeSnapshot().pages].sort((a, b) => b.collectedAt - a.collectedAt) }
export function isCollected(refId: string): boolean { return getPages().some((page) => page.refId === refId) }
export function collect(refId: string, kind: PageKind): void {
  if (isCollected(refId)) return
  const page = { refId, kind, collectedAt: Date.now() }
  executePersonalKnowledgeCommand(
    (value) => ({ ...value, pages: [page, ...value.pages] }),
    { type: 'knowledge.collect', page },
  )
}
export function uncollect(refId: string): void {
  executePersonalKnowledgeCommand(
    (value) => ({
      ...value,
      pages: value.pages.filter((page) => page.refId !== refId),
      links: value.links.filter((link) => link.from !== refId && link.to !== refId),
      assignments: value.assignments.filter((assignment) => assignment.refId !== refId),
    }),
    { type: 'knowledge.uncollect', refId },
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
  referenceKind?: PersonalSpaceItemProjection['kind']
  exists: boolean
}

export function resolvePage(page: BrainPage, spaces: readonly PersonalSpaceProjection[] = []): ResolvedPage {
  if (page.kind === 'note') {
    const note = getNote(page.refId)
    return { refId: page.refId, kind: 'note', title: note?.title || '无标题笔记', collectedAt: page.collectedAt, exists: note !== undefined }
  }
  if (page.kind === 'space_reference') {
    const resolved = findSpaceReference(spaces, page.refId)
    return {
      refId: page.refId,
      kind: 'space_reference',
      title: resolved?.item.title ?? '(空间引用已不存在)',
      collectedAt: page.collectedAt,
      materialKind: resolved?.item.kind === 'web_reference' ? 'web' : 'file',
      spaceId: resolved?.space.spaceId,
      detail: resolved?.item.detail,
      referenceKind: resolved?.item.kind,
      exists: resolved !== undefined,
    }
  }
  const material = spaces.some((space) => space.demoDataset === 'learning-workspace')
    ? getMaterial(page.refId)
    : undefined
  return {
    refId: page.refId,
    kind: 'material',
    title: material?.title ?? '(材料已不存在)',
    collectedAt: page.collectedAt,
    materialKind: material?.kind,
    thumbnail: material?.thumbnail,
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
  const pages = useMemo(
    () => [...snapshot.pages].sort((left, right) => right.collectedAt - left.collectedAt),
    [snapshot.pages],
  )
  return {
    pages,
    isCollected,
    collect,
    uncollect,
    addLink,
    removeLink,
    markOpened,
    getLinks,
    recentlyOpened,
    recentlyCollected,
    outgoing,
    backlinks,
    resolvePage: (page: BrainPage) => resolvePage(page, spaces),
    resolveById: (refId: string) => resolveById(refId, spaces),
  }
}

function findSpaceReference(
  spaces: readonly PersonalSpaceProjection[],
  refId: string,
): { space: PersonalSpaceProjection; item: PersonalSpaceItemProjection } | undefined {
  for (const space of spaces) {
    const item = findItem(space.items, refId)
    if (item !== undefined && item.kind !== 'folder') return { space, item }
  }
  return undefined
}

function findItem(items: readonly PersonalSpaceItemProjection[], refId: string): PersonalSpaceItemProjection | undefined {
  for (const item of items) {
    if (item.itemId === refId) return item
    const child = findItem(item.children ?? [], refId)
    if (child !== undefined) return child
  }
  return undefined
}
