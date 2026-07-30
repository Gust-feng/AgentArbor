import { requestJson } from '../../../../api'
import type { SpaceReferencePreview } from '../../../../../../panel-api-contracts'

export type { SpaceReferencePreview } from '../../../../../../panel-api-contracts'

const previewCache = new Map<string, SpaceReferencePreview>()
const previewGeneration = new Map<string, number>()
const previewInFlight = new Map<string, Promise<SpaceReferencePreview>>()
const previewMutationInFlight = new Map<string, Promise<SpaceReferencePreview>>()
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
  return previewCache.get(previewCacheKey(apiBase, itemId, relativePath))
}

export function clearReferencePreviewCacheForTesting(): void {
  previewCache.clear()
  previewGeneration.clear()
  previewInFlight.clear()
  previewMutationInFlight.clear()
  previewCacheVersions.clear()
  pendingPreviewNotifications.clear()
  if (previewNotificationTimer !== undefined) {
    clearTimeout(previewNotificationTimer)
    previewNotificationTimer = undefined
  }
}

export async function fetchSpaceReferencePreview(itemId: string, relativePath = '', signal?: AbortSignal, apiBase = '/api/spaces/references'): Promise<SpaceReferencePreview> {
  const key = previewCacheKey(apiBase, itemId, relativePath)
  const existing = previewInFlight.get(key)
  if (existing !== undefined) return await withAbort(existing, signal)
  const generation = previewGeneration.get(key) ?? 0
  const query = relativePath.length === 0 ? '' : `?path=${encodeURIComponent(relativePath)}`
  let request!: Promise<SpaceReferencePreview>
  request = (async () => {
    const response = await requestJson<{ preview: SpaceReferencePreview }>(
      `${apiBase}/${encodeURIComponent(itemId)}/preview${query}`,
      { headers: { accept: 'application/json' } },
    )
    if ((previewGeneration.get(key) ?? 0) !== generation) {
      const mutation = previewMutationInFlight.get(key)
      if (mutation !== undefined) return await mutation
      const replacement = previewInFlight.get(key)
      if (replacement !== undefined && replacement !== request) return await replacement
      return previewCache.get(key) ?? await fetchSpaceReferencePreview(itemId, relativePath, undefined, apiBase)
    }
    setCachedPreview(apiBase, key, response.preview)
    return response.preview
  })().finally(() => {
    if (previewInFlight.get(key) === request) previewInFlight.delete(key)
  })
  previewInFlight.set(key, request)
  return await withAbort(request, signal)
}

export async function saveSpaceReferenceText(input: {
  readonly itemId: string
  readonly relativePath: string
  readonly expectedFingerprint: string
  readonly text: string
}, apiBase = '/api/spaces/references'): Promise<SpaceReferencePreview> {
  const key = previewCacheKey(apiBase, input.itemId, input.relativePath)
  const generation = (previewGeneration.get(key) ?? 0) + 1
  previewGeneration.set(key, generation)
  let request!: Promise<SpaceReferencePreview>
  request = (async () => {
    const response = await requestJson<{ preview: SpaceReferencePreview }>(
      `${apiBase}/${encodeURIComponent(input.itemId)}/content`,
      {
        method: 'PUT',
        headers: { accept: 'application/json' },
        body: JSON.stringify({
          relativePath: input.relativePath,
          expectedFingerprint: input.expectedFingerprint,
          text: input.text,
        }),
      },
    )
    if ((previewGeneration.get(key) ?? 0) !== generation) {
      const newer = previewMutationInFlight.get(key)
      if (newer !== undefined && newer !== request) return await newer
      const cached = previewCache.get(key)
      if (cached !== undefined) return cached
      return response.preview
    }
    setCachedPreview(apiBase, key, response.preview)
    return response.preview
  })().finally(() => {
    if (previewMutationInFlight.get(key) === request) previewMutationInFlight.delete(key)
  })
  previewMutationInFlight.set(key, request)
  return await request
}

function previewCacheKey(apiBase: string, itemId: string, relativePath: string): string {
  return `${apiBase}:${itemId}:${relativePath}`
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

export async function createSpaceReferenceEntry(
  itemId: string,
  parentRelativePath: string,
  name: string,
  kind: 'file' | 'directory' = 'file',
): Promise<string> {
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
  const keys = new Set([...previewCache.keys(), ...previewGeneration.keys(), ...previewInFlight.keys()])
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    if (previewCache.delete(key)) schedulePreviewNotification(apiBase)
    previewGeneration.set(key, (previewGeneration.get(key) ?? 0) + 1)
    previewInFlight.delete(key)
    previewMutationInFlight.delete(key)
  }
}

function setCachedPreview(apiBase: string, key: string, preview: SpaceReferencePreview): void {
  previewCache.set(key, preview)
  schedulePreviewNotification(apiBase)
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
