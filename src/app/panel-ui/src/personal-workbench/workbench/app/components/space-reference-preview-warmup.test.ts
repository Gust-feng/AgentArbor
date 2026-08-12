import { waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { clearReferencePreviewCacheForTesting } from './referencePreviewClient'
import { collectStartupReferencePreviewPlan, warmStartupReferencePreviews } from './space-reference-preview-warmup'

afterEach(() => {
  vi.unstubAllGlobals()
  clearReferencePreviewCacheForTesting()
})

test('selects a bounded startup preview plan without traversing filesystem folders', () => {
  const plan = collectStartupReferencePreviewPlan([{
    spaceId: 'space-one',
    title: '资料',
    items: [
      { itemId: 'local-file', title: '说明.md', kind: 'local_file' },
      { itemId: 'folder-one', title: '项目', kind: 'workspace_folder', referenceId: 'folder-one' },
      {
        itemId: 'asset-folder',
        title: '内置资料',
        kind: 'folder',
        children: [{ itemId: 'asset-one', title: '示例.docx', kind: 'workbench_asset', referenceId: 'asset-one' }],
      },
      { itemId: 'conversation-one', title: '讨论', kind: 'conversation_reference' },
      { itemId: 'artifact-one', title: '产物', kind: 'generated_artifact', openable: false },
    ],
  }])

  expect(plan).toEqual({
    fileTargets: [
      { referenceId: 'asset-one', relativePath: '' },
      { referenceId: 'local-file', relativePath: '' },
    ],
    folderTargets: [{ referenceId: 'folder-one', relativePath: '' }],
  })
})

test('warms static files, then only a few direct files from startup folders', async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === '/api/spaces/references/folder-one/preview') {
      return previewResponse('folder-one', {
        kind: 'directory',
        relativePath: '',
        entries: [
          { name: 'readme.md', relativePath: 'readme.md', kind: 'file' as const },
          { name: 'src', relativePath: 'src', kind: 'directory' as const },
          { name: 'notes.txt', relativePath: 'notes.txt', kind: 'file' as const },
          { name: 'guide.pdf', relativePath: 'guide.pdf', kind: 'file' as const },
          { name: 'demo.mp4', relativePath: 'demo.mp4', kind: 'file' as const },
        ],
        truncated: false,
      })
    }
    if (url.startsWith('/api/spaces/references/folder-one/preview?path=')) {
      return previewResponse('folder-one', textContent('已预热的目录文件'))
    }
    if (url === '/api/spaces/references/local-file/preview') {
      return previewResponse('local-file', textContent('已预热的独立文件'))
    }
    throw new Error(`unexpected preview request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const dispose = warmStartupReferencePreviews([{
    spaceId: 'space-one',
    title: '资料',
    items: [
      { itemId: 'local-file', title: '说明.md', kind: 'local_file' },
      { itemId: 'folder-one', title: '项目', kind: 'workspace_folder', referenceId: 'folder-one' },
    ],
  }])

  await waitFor(() => {
    const requests = fetchMock.mock.calls.map(([input]) => String(input))
    expect(requests).toHaveLength(6)
    expect(requests.slice(0, 2)).toEqual([
      '/api/spaces/references/local-file/preview',
      '/api/spaces/references/folder-one/preview',
    ])
    expect(requests[2]).toBe('/api/spaces/references/folder-one/preview?path=demo.mp4')
    expect(requests).toEqual(expect.arrayContaining([
      '/api/spaces/references/folder-one/preview?path=guide.pdf',
      '/api/spaces/references/folder-one/preview?path=readme.md',
      '/api/spaces/references/folder-one/preview?path=notes.txt',
    ]))
  })
  dispose()
})

function previewResponse(itemId: string, content: object): Response {
  return new Response(JSON.stringify({ preview: {
    itemId,
    title: itemId,
    sourceKind: 'local_file',
    source: itemId,
    status: 'ready',
    fingerprint: `${itemId}:1`,
    presentation: { kind: 'markdown', editable: false, sourceMode: false },
    content,
  } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function textContent(text: string) {
  return { kind: 'text', text, truncated: false, editable: false, language: 'md' }
}