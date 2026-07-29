import { requestJson } from '../../../../api'
import { readNextReleaseLegacyData, clearNextReleaseLegacyData } from './compat/v-next-local-storage-import'
import type { Assignment, BrainLink, BrainPage, Note, Theme } from './personalKnowledgeTypes'

export type { Assignment, BrainLink, BrainPage, Note, PageKind, Theme } from './personalKnowledgeTypes'

interface Snapshot {
  notes: Note[]
  pages: BrainPage[]
  links: BrainLink[]
  themes: Theme[]
  assignments: Assignment[]
  recentlyOpened: Record<string, number>
}

export type PersonalKnowledgeLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'retrying' }
  | { readonly status: 'error'; readonly message: string }

export interface PersonalKnowledgeSearchHit {
  readonly note: Omit<Note, 'body'>
  readonly snippet: string
}

type ServerSnapshot = Omit<Snapshot, 'notes'> & {
  notes: Array<Omit<Note, 'body'> & { bodyMarkdown: string }>
}

let snapshot: Snapshot = readNextReleaseLegacyData()
let authoritativeSnapshot: Snapshot = snapshot
let activeSpaceId = 'personal-unassigned'
let loaded = false
let loading: Promise<void> | undefined
let refreshing: Promise<void> | undefined
let persistenceEnabled = false
let mutationQueue = Promise.resolve()
let lastError: string | undefined
let loadState: PersonalKnowledgeLoadState = { status: 'idle' }
const pendingMutations: PendingMutation[] = []
const pendingNotes = new Map<string, number>()
const noteErrors = new Map<string, string>()
const listeners = new Set<() => void>()

export function getPersonalKnowledgeSnapshot(): Snapshot { return snapshot }
export function getPersonalKnowledgeError(): string | undefined { return lastError }
export function getPersonalKnowledgeLoadState(): PersonalKnowledgeLoadState { return loadState }
export function getPersonalNoteSaveState(noteId: string): string {
  const error = noteErrors.get(noteId)
  if (error !== undefined) return `error:${error}`
  return (pendingNotes.get(noteId) ?? 0) > 0 ? 'saving' : 'saved'
}
export function subscribePersonalKnowledge(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setPersonalKnowledgePersistenceEnabled(enabled: boolean): void {
  if (persistenceEnabled === enabled) return
  persistenceEnabled = enabled
  loadState = enabled ? (loaded ? { status: 'ready' } : { status: 'idle' }) : { status: 'ready' }
  emit()
}

export async function searchPersonalKnowledge(
  query: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<readonly PersonalKnowledgeSearchHit[]> {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return []
  if (!persistenceEnabled) {
    return snapshot.notes
      .filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(normalized))
      .slice(0, limit)
      .map(({ body, ...note }) => ({ note, snippet: noteSnippet(body, normalized) }))
  }
  const response = await requestJson<{ results: readonly PersonalKnowledgeSearchHit[] }>(
    `/api/personal-knowledge/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { signal },
  )
  return response.results
}

export function initializePersonalKnowledge(spaceId?: string): Promise<void> {
  if (spaceId !== undefined) activeSpaceId = spaceId
  if (!persistenceEnabled) {
    loadState = { status: 'ready' }
    emit()
    return Promise.resolve()
  }
  if (loaded) {
    if (loadState.status !== 'ready') {
      loadState = { status: 'ready' }
      emit()
    }
    return Promise.resolve()
  }
  if (loading !== undefined) return loading
  loadState = { status: loadState.status === 'error' ? 'retrying' : 'loading' }
  emit()
  loading = (async () => {
    const legacy = readNextReleaseLegacyData()
    await requestJson('/api/personal-knowledge/compat/import', {
      method: 'POST',
      body: JSON.stringify({
        importKey: 'redesign-local-storage-v1',
        fallbackSpaceId: activeSpaceId,
        notes: legacy.notes.map(({ id, title, body, createdAt, updatedAt, materialRefs }) => ({ id, title, body, createdAt, updatedAt, materialRefs })),
        pages: legacy.pages,
        links: legacy.links,
        themes: legacy.themes,
        assignments: legacy.assignments,
        recentlyOpened: legacy.recentlyOpened,
      }),
    })
    await refreshPersonalKnowledge()
    clearNextReleaseLegacyData()
    loaded = true
    loadState = { status: 'ready' }
    emit()
  })().catch((error: unknown) => {
    const message = messageOf(error)
    lastError = message
    loadState = { status: 'error', message }
    emit()
    throw error
  }).finally(() => { loading = undefined })
  return loading
}

export function refreshPersonalKnowledge(): Promise<void> {
  if (refreshing !== undefined) return refreshing
  refreshing = (async () => {
    await mutationQueue
    authoritativeSnapshot = await fetchPersonalKnowledgeSnapshot()
    replayPendingMutations()
    lastError = undefined
    emit()
  })().finally(() => { refreshing = undefined })
  return refreshing
}

export function setActivePersonalKnowledgeSpace(spaceId: string): void {
  activeSpaceId = spaceId
  const mapped = authoritativeSnapshot.notes.map((note) => note.spaceId === 'legacy' || note.spaceId.length === 0 ? { ...note, spaceId } : note)
  if (mapped.some((note, index) => note !== authoritativeSnapshot.notes[index])) {
    authoritativeSnapshot = { ...authoritativeSnapshot, notes: mapped }
    replayPendingMutations()
    emit()
  }
}

/** Test seam for component tests that intentionally run without Panel Server. */
export function resetPersonalKnowledgeForTesting(): void {
  snapshot = readNextReleaseLegacyData()
  authoritativeSnapshot = snapshot
  activeSpaceId = 'personal-unassigned'
  loaded = false
  loading = undefined
  refreshing = undefined
  persistenceEnabled = false
  mutationQueue = Promise.resolve()
  pendingMutations.length = 0
  lastError = undefined
  loadState = { status: 'ready' }
  pendingNotes.clear()
  noteErrors.clear()
}

export function mutatePersonalKnowledge(
  optimistic: (current: Snapshot) => Snapshot,
  request: (authoritative: Snapshot) => Promise<unknown>,
  noteId?: string,
): void {
  if (!persistenceEnabled) {
    snapshot = optimistic(snapshot)
    authoritativeSnapshot = snapshot
    lastError = undefined
    emit()
    return
  }
  const mutation: PendingMutation = { optimistic, request, noteId }
  pendingMutations.push(mutation)
  replayPendingMutations()
  if (noteId !== undefined) {
    pendingNotes.set(noteId, (pendingNotes.get(noteId) ?? 0) + 1)
    noteErrors.delete(noteId)
  }
  emit()
  mutationQueue = mutationQueue.then(() => executeMutation(mutation))
}

export function createPersonalNote(init?: Partial<Pick<Note, 'title' | 'body' | 'materialRefs'>>): Note {
  const now = Date.now()
  const note: Note = {
    id: crypto.randomUUID(),
    spaceId: activeSpaceId,
    title: '',
    body: '',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ...init,
  }
  mutatePersonalKnowledge(
    (current) => ({ ...current, notes: [note, ...current.notes] }),
    () => requestJson('/api/personal-knowledge/notes', {
      method: 'POST',
      body: JSON.stringify({ id: note.id, spaceId: note.spaceId, title: note.title, bodyMarkdown: note.body, materialRefs: note.materialRefs }),
    }),
    note.id,
  )
  return note
}

export function updatePersonalNote(id: string, patch: Partial<Pick<Note, 'title' | 'body'>>): void {
  const current = snapshot.notes.find((note) => note.id === id)
  if (current === undefined) return
  const updatedAt = Date.now()
  mutatePersonalKnowledge(
    (value) => ({ ...value, notes: value.notes.map((note) => note.id === id ? { ...note, ...patch, updatedAt, revision: note.revision + 1 } : note) }),
    (authoritative) => {
      const note = authoritative.notes.find((candidate) => candidate.id === id)
      if (note === undefined) return Promise.reject(new Error('笔记已不存在，无法保存更改。'))
      return requestJson(`/api/personal-knowledge/notes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedRevision: note.revision, ...(patch.title === undefined ? {} : { title: patch.title }), ...(patch.body === undefined ? {} : { bodyMarkdown: patch.body }) }),
      })
    },
    id,
  )
}

export function deletePersonalNote(id: string): void {
  const note = snapshot.notes.find((candidate) => candidate.id === id)
  if (note === undefined) return
  mutatePersonalKnowledge(
    (value) => ({
      ...value,
      notes: value.notes.filter((candidate) => candidate.id !== id),
      pages: value.pages.filter((page) => page.refId !== id),
      links: value.links.filter((link) => link.from !== id && link.to !== id),
      assignments: value.assignments.filter((assignment) => assignment.refId !== id),
    }),
    (authoritative) => {
      const current = authoritative.notes.find((candidate) => candidate.id === id)
      if (current === undefined) return Promise.reject(new Error('笔记已不存在，无法删除。'))
      return requestJson(`/api/personal-knowledge/notes/${encodeURIComponent(id)}?expectedRevision=${current.revision}`, { method: 'DELETE' })
    },
    id,
  )
}

export function reorderPersonalNotes(orderedIds: string[]): void {
  mutatePersonalKnowledge(
    (value) => {
      const byId = new Map(value.notes.map((note) => [note.id, note]))
      const ordered = orderedIds.flatMap((id) => { const note = byId.get(id); byId.delete(id); return note === undefined ? [] : [note] })
      return { ...value, notes: [...ordered, ...value.notes.filter((note) => byId.has(note.id))] }
    },
    () => requestJson('/api/personal-knowledge/notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) }),
  )
}

export function executePersonalKnowledgeCommand(
  optimistic: (current: Snapshot) => Snapshot,
  command: Record<string, unknown>,
): void {
  mutatePersonalKnowledge(optimistic, () => requestJson('/api/personal-knowledge/commands', { method: 'POST', body: JSON.stringify(command) }))
}

function emit(): void { listeners.forEach((listener) => listener()) }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '个人知识数据保存失败。' }

interface PendingMutation {
  readonly optimistic: (current: Snapshot) => Snapshot
  readonly request: (authoritative: Snapshot) => Promise<unknown>
  readonly noteId?: string
}

async function executeMutation(mutation: PendingMutation): Promise<void> {
  try {
    await mutation.request(authoritativeSnapshot)
    authoritativeSnapshot = mutation.optimistic(authoritativeSnapshot)
    lastError = undefined
    if (mutation.noteId !== undefined) noteErrors.delete(mutation.noteId)
  } catch (error: unknown) {
    const message = messageOf(error)
    try { authoritativeSnapshot = await fetchPersonalKnowledgeSnapshot() } catch { /* keep the last known server state */ }
    lastError = message
    if (mutation.noteId !== undefined) noteErrors.set(mutation.noteId, message)
  } finally {
    const index = pendingMutations.indexOf(mutation)
    if (index >= 0) pendingMutations.splice(index, 1)
    finishNoteMutation(mutation.noteId)
    replayPendingMutations()
    emit()
  }
}

async function fetchPersonalKnowledgeSnapshot(): Promise<Snapshot> {
  const response = await requestJson<{ snapshot: ServerSnapshot }>('/api/personal-knowledge')
  return {
    ...response.snapshot,
    notes: response.snapshot.notes.map(({ bodyMarkdown, ...note }) => ({ ...note, body: bodyMarkdown })),
  }
}

function replayPendingMutations(): void {
  snapshot = pendingMutations.reduce((current, mutation) => mutation.optimistic(current), authoritativeSnapshot)
}

function finishNoteMutation(noteId: string | undefined): void {
  if (noteId === undefined) return
  const remaining = (pendingNotes.get(noteId) ?? 1) - 1
  if (remaining <= 0) pendingNotes.delete(noteId)
  else pendingNotes.set(noteId, remaining)
}

function noteSnippet(body: string, query: string): string {
  const flat = body.replace(/\s+/gu, ' ').trim()
  const index = flat.toLowerCase().indexOf(query)
  const start = index < 0 ? 0 : Math.max(0, index - 30)
  const value = flat.slice(start, start + 120)
  return `${start > 0 ? '...' : ''}${value}${start + value.length < flat.length ? '...' : ''}`
}
