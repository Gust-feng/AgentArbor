import { requestJson } from '../../../../api'
import type { SpaceReferencePreview } from '../../../../../../panel-api-contracts'

export type { SpaceReferencePreview } from '../../../../../../panel-api-contracts'

const MAX_CACHED_PREVIEWS = 64
const previewCache = new Map<string, SpaceReferencePreview>()
const previewGeneration = new Map<string, number>()
const previewMutationInFlight = new Map<string, Promise<SpaceReferencePreview>>()
const previewReadInFlight = new Map<string, Promise<SpaceReferencePreview>>()
const previewListeners = new Map<string, Set<() => void>>()
const previewCacheVersions = new Map<string, number>()
const pendingPreviewNotifications = new Set<string>()
let previewNotificationTimer: ReturnType<typeof setTimeout> | undefined

export function subscribeReferencePreviewCache(listener: () => void, apiBase = '/api/spaces/references'): () => void {
  const listeners = previewListeners.get(apiBase) ?? new Set<() => void>()
  listeners.add(listener)
  previewListeners.set(apiBase, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) previewListeners.delete(apiBase)
  }
}

export function getReferencePreviewCacheVersion(apiBase = '/api/spaces/references'): number {
  return previewCacheVersions.get(apiBase) ?? 0
}

export function getCachedReferencePreview(itemId: string, relativePath = '', apiBase = '/api/spaces/references'): SpaceReferencePreview | undefined {
  const key = previewCacheKey(apiBase, itemId, relativePath)
  const value = previewCache.get(key)
  if (value !== undefined) {
    previewCache.delete(key)
    previewCache.set(key, value)
  }
  return value
}

export function clearReferencePreviewCacheForTesting(): void {
  previewCache.clear()
  previewGeneration.clear()
  previewMutationInFlight.clear()
  previewReadInFlight.clear()
  previewCacheVersions.clear()
  pendingPreviewNotifications.clear()
  if (previewNotificationTimer !== undefined) clearTimeout(previewNotificationTimer)
  previewNotificationTimer = undefined
}

export async function fetchSpaceReferencePreview(
  itemId: string,
  relativePath = '',
  signal?: AbortSignal,
  apiBase = '/api/spaces/references',
): Promise<SpaceReferencePreview> {
  const key = previewCacheKey(apiBase, itemId, relativePath)
  const mutation = previewMutationInFlight.get(key)
  if (mutation !== undefined) {
    try { return await mutation } catch { /* read the authoritative source after a failed write */ }
  }
  if (!previewGeneration.has(key)) previewGeneration.set(key, 0)
  const generation = previewGeneration.get(key)!
  const query = relativePath.length === 0 ? '' : `?path=${encodeURIComponent(relativePath)}`
  let request!: Promise<SpaceReferencePreview>
  request = (async () => {
    const response = await requestJson<{ preview: SpaceReferencePreview }>(
      `${apiBase}/${encodeURIComponent(itemId)}/preview${query}`,
      { headers: { accept: 'application/json' }, signal },
    )
    if ((previewGeneration.get(key) ?? 0) !== generation) {
      const currentMutation = previewMutationInFlight.get(key)
      if (currentMutation !== undefined) {
        try { return await currentMutation } catch { /* fall through */ }
      }
      const newerRead = previewReadInFlight.get(key)
      if (newerRead !== undefined && newerRead !== request) return await newerRead
      return getCachedReferencePreview(itemId, relativePath, apiBase)
        ?? await fetchSpaceReferencePreview(itemId, relativePath, signal, apiBase)
    }
    setCachedPreview(apiBase, key, response.preview)
    return response.preview
  })().finally(() => {
    if (previewReadInFlight.get(key) === request) previewReadInFlight.delete(key)
  })
  previewReadInFlight.set(key, request)
  return await withAbort(request, signal)
}

export async function refreshSpaceReferencePreview(itemId: string, relativePath = '', signal?: AbortSignal, apiBase = '/api/spaces/references'): Promise<SpaceReferencePreview> {
  invalidatePreviewKey(apiBase, itemId, relativePath)
  return await fetchSpaceReferencePreview(itemId, relativePath, signal, apiBase)
}

export async function saveSpaceReferenceText(input: {
  readonly itemId: string
  readonly relativePath: string
  readonly expectedFingerprint: string
  readonly text: string
}, apiBase = '/api/spaces/references'): Promise<SpaceReferencePreview> {
  const key = previewCacheKey(apiBase, input.itemId, input.relativePath)
  const generation = advanceGeneration(key)
  let request!: Promise<SpaceReferencePreview>
  request = requestJson<{ preview: SpaceReferencePreview }>(
    `${apiBase}/${encodeURIComponent(input.itemId)}/content`,
    {
      method: 'PUT',
      headers: { accept: 'application/json' },
      body: JSON.stringify(input),
    },
  ).then((response) => {
    if ((previewGeneration.get(key) ?? 0) === generation) setCachedPreview(apiBase, key, response.preview)
    return response.preview
  }).finally(() => {
    if (previewMutationInFlight.get(key) === request) previewMutationInFlight.delete(key)
  })
  previewMutationInFlight.set(key, request)
  return await request
}

export async function renameSpaceReferenceEntry(itemId: string, relativePath: string, name: string): Promise<string> {
  const body = await mutateReferenceEntry(itemId, 'PATCH', { relativePath, name }) as { entry?: { relativePath?: string } }
  if (body.entry?.relativePath === undefined) throw new Error('文件重命名响应无效。')
  invalidateReferencePreview(itemId)
  return body.entry.relativePath
}

export async function deleteSpaceReferenceEntry(itemId: string, relativePath: string): Promise<void> {
  await mutateReferenceEntry(itemId, 'DELETE', { relativePath })
  invalidateReferencePreview(itemId)
}

export async function createSpaceReferenceEntry(itemId: string, parentRelativePath: string, name: string, kind: 'file' | 'directory' = 'file'): Promise<string> {
  const body = await mutateReferenceEntry(itemId, 'POST', { parentRelativePath, name, kind }) as { entry?: { relativePath?: string } }
  if (body.entry?.relativePath === undefined) throw new Error('新建文件响应无效。')
  invalidateReferencePreview(itemId)
  return body.entry.relativePath
}

async function mutateReferenceEntry(itemId: string, method: 'POST' | 'PATCH' | 'DELETE', input: object): Promise<object> {
  return await requestJson<object>(`/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
    method,
    headers: { accept: 'application/json' },
    body: JSON.stringify(input),
  })
}

function invalidateReferencePreview(itemId: string, apiBase = '/api/spaces/references'): void {
  const prefix = `${apiBase}:${itemId}:`
  const keys = new Set([...previewCache.keys(), ...previewGeneration.keys()])
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    if (previewCache.delete(key)) schedulePreviewNotification(apiBase)
    advanceGeneration(key)
  }
}

function invalidatePreviewKey(apiBase: string, itemId: string, relativePath: string): void {
  const key = previewCacheKey(apiBase, itemId, relativePath)
  if (previewCache.delete(key)) schedulePreviewNotification(apiBase)
  advanceGeneration(key)
}

function advanceGeneration(key: string): number {
  const generation = (previewGeneration.get(key) ?? 0) + 1
  previewGeneration.set(key, generation)
  return generation
}

function previewCacheKey(apiBase: string, itemId: string, relativePath: string): string {
  return `${apiBase}:${itemId}:${relativePath}`
}

function setCachedPreview(apiBase: string, key: string, preview: SpaceReferencePreview): void {
  const previous = previewCache.get(key)
  if (previous !== undefined && previewsEqual(previous, preview)) return
  previewCache.delete(key)
  previewCache.set(key, preview)
  while (previewCache.size > MAX_CACHED_PREVIEWS) previewCache.delete(previewCache.keys().next().value!)
  schedulePreviewNotification(apiBase)
}

function previewsEqual(left: SpaceReferencePreview, right: SpaceReferencePreview): boolean {
  if (left.fingerprint !== right.fingerprint || left.modifiedAt !== right.modifiedAt || left.content.kind !== right.content.kind) return false
  if (left.content.kind === 'text' && right.content.kind === 'text') return left.content.text === right.content.text
  if (left.content.kind === 'directory' && right.content.kind === 'directory') {
    const rightEntries = right.content.entries
    return left.content.relativePath === right.content.relativePath
      && left.content.entries.length === right.content.entries.length
      && left.content.entries.every((entry, index) => {
        const candidate = rightEntries[index]
        return candidate?.name === entry.name && candidate.relativePath === entry.relativePath && candidate.kind === entry.kind
      })
  }
  return JSON.stringify(left.content) === JSON.stringify(right.content)
}

function schedulePreviewNotification(apiBase: string): void {
  previewCacheVersions.set(apiBase, (previewCacheVersions.get(apiBase) ?? 0) + 1)
  pendingPreviewNotifications.add(apiBase)
  if (previewNotificationTimer !== undefined) return
  previewNotificationTimer = setTimeout(() => {
    previewNotificationTimer = undefined
    const apiBases = [...pendingPreviewNotifications]
    pendingPreviewNotifications.clear()
    apiBases.forEach((base) => previewListeners.get(base)?.forEach((listener) => listener()))
  }, 16)
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
