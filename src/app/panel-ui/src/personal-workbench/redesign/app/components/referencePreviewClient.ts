export type SpaceReferencePreview = {
  readonly itemId: string
  readonly title: string
  readonly sourceKind: 'local_file' | 'workspace_folder' | 'web_page' | 'generated_artifact' | 'conversation'
  readonly source: string
  readonly status: 'ready' | 'missing' | 'unsupported'
  readonly fingerprint?: string
  readonly byteLength?: number
  readonly modifiedAt?: number
  readonly content:
    | { readonly kind: 'text'; readonly text: string; readonly truncated: boolean; readonly editable: boolean; readonly language?: string; readonly encoding?: string }
    | { readonly kind: 'directory'; readonly relativePath: string; readonly entries: readonly { readonly name: string; readonly relativePath: string; readonly kind: 'file' | 'directory' | 'other' }[]; readonly truncated: boolean }
    | { readonly kind: 'media'; readonly mediaKind: 'image' | 'pdf' | 'video' | 'audio'; readonly mimeType: string; readonly url: string }
    | { readonly kind: 'web'; readonly url: string }
    | { readonly kind: 'unavailable'; readonly message: string }
}

const previewCache = new Map<string, SpaceReferencePreview>()
const previewGeneration = new Map<string, number>()
const previewInFlight = new Map<string, Promise<SpaceReferencePreview>>()

export function getCachedReferencePreview(itemId: string, relativePath = '', apiBase = '/api/spaces/references'): SpaceReferencePreview | undefined {
  return previewCache.get(previewCacheKey(apiBase, itemId, relativePath))
}

export function clearReferencePreviewCacheForTesting(): void {
  previewCache.clear()
  previewGeneration.clear()
  previewInFlight.clear()
}

export async function fetchSpaceReferencePreview(itemId: string, relativePath = '', signal?: AbortSignal, apiBase = '/api/spaces/references'): Promise<SpaceReferencePreview> {
  const key = previewCacheKey(apiBase, itemId, relativePath)
  const existing = previewInFlight.get(key)
  if (existing !== undefined) return await withAbort(existing, signal)
  const generation = previewGeneration.get(key) ?? 0
  const query = relativePath.length === 0 ? '' : `?path=${encodeURIComponent(relativePath)}`
  const request = (async () => {
    const response = await fetch(`${apiBase}/${encodeURIComponent(itemId)}/preview${query}`, { headers: { accept: 'application/json' } })
    const body = await response.json().catch(() => undefined) as { preview?: SpaceReferencePreview; message?: string } | undefined
    if (!response.ok || body?.preview === undefined) throw new Error(body?.message ?? `引用预览加载失败（${response.status}）。`)
    if ((previewGeneration.get(key) ?? 0) !== generation) return previewCache.get(key) ?? body.preview
    previewCache.set(key, body.preview)
    return body.preview
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
  previewGeneration.set(key, (previewGeneration.get(key) ?? 0) + 1)
  const response = await fetch(`${apiBase}/${encodeURIComponent(input.itemId)}/content`, {
    method: 'PUT',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      relativePath: input.relativePath,
      expectedFingerprint: input.expectedFingerprint,
      text: input.text,
    }),
  })
  const body = await response.json().catch(() => undefined) as { preview?: SpaceReferencePreview; error?: { message?: string } } | undefined
  if (!response.ok || body?.preview === undefined) {
    const error = new Error(body?.error?.message ?? `引用文件保存失败（${response.status}）。`)
    Object.assign(error, { status: response.status })
    throw error
  }
  previewCache.set(key, body.preview)
  return body.preview
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
  const response = await fetch(`/api/spaces/references/${encodeURIComponent(itemId)}/entry`, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
  if (!response.ok) throw new Error(body?.error?.message ?? `文件操作失败（${response.status}）。`)
  return body ?? {}
}

function invalidateReferencePreview(itemId: string, apiBase = '/api/spaces/references'): void {
  const prefix = `${apiBase}:${itemId}:`
  const keys = new Set([...previewCache.keys(), ...previewGeneration.keys(), ...previewInFlight.keys()])
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    previewCache.delete(key)
    previewGeneration.set(key, (previewGeneration.get(key) ?? 0) + 1)
  }
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
