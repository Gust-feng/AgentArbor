import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ReferencePreview } from './ReferencePreview'
import type { SpaceReferencePreview } from './referencePreviewClient'
import { clearReferencePreviewCacheForTesting, createSpaceReferenceEntry, fetchSpaceReferencePreview, getCachedReferencePreview, saveSpaceReferenceText } from './referencePreviewClient'

afterEach(() => {
  vi.unstubAllGlobals()
  clearReferencePreviewCacheForTesting()
})

test('keeps an edited reference stable until the user loads the external version', async () => {
  const user = userEvent.setup()
  const original = textPreview('1:4', '原始内容')
  const external = textPreview('2:6', '外部新版')
  let current = original
  let savedText = ''
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { text: string }
      savedText = body.text
      current = textPreview('1:12', body.text)
    }
    return new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByDisplayValue('原始内容')).toBeTruthy()
  const editor = screen.getByRole('textbox')
  await user.clear(editor)
  await user.type(editor, '我的草稿')
  await waitFor(() => expect(savedText).toBe('我的草稿'))
  expect(screen.getByText('已保存')).toBeTruthy()

  current = external
  window.dispatchEvent(new Event('focus'))
  expect(await screen.findByText('来源已更新，当前内容仍保持不变。')).toBeTruthy()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('我的草稿')

  await user.click(screen.getByRole('button', { name: '加载新版' }))
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('外部新版'))
})

test('loading an external version cancels the older scheduled autosave', async () => {
  const original = textPreview('1:4', '原始内容')
  const external = textPreview('2:6', '外部新版')
  let current = original
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') writes += 1
    return new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
  const editor = await screen.findByDisplayValue('原始内容')
  fireEvent.change(editor, { target: { value: '尚未保存的草稿' } })
  current = external
  window.dispatchEvent(new Event('focus'))
  await screen.findByText('来源已更新，当前内容仍保持不变。')

  fireEvent.click(screen.getByRole('button', { name: '加载新版' }))
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('外部新版'))
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(writes).toBe(0)
})

test('does not let a late preview GET replace a newer saved preview', async () => {
  const stale = textPreview('1:4', '旧内容')
  const saved = textPreview('2:4', '新内容')
  let resolveGet: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify({ preview: saved }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return await new Promise<Response>((resolve) => { resolveGet = resolve })
  }))

  const staleRequest = fetchSpaceReferencePreview('reference-one')
  await saveSpaceReferenceText({ itemId: 'reference-one', relativePath: '', expectedFingerprint: '1:4', text: '新内容' })
  resolveGet?.(new Response(JSON.stringify({ preview: stale }), { status: 200, headers: { 'content-type': 'application/json' } }))

  expect(await staleRequest).toEqual(saved)
  expect(getCachedReferencePreview('reference-one')).toEqual(saved)
})

test('isolates caller cancellation while reusing the same preview request', async () => {
  const preview = textPreview('1:4', '共享内容')
  let resolveRequest: ((response: Response) => void) | undefined
  const fetchMock = vi.fn(async () => await new Promise<Response>((resolve) => { resolveRequest = resolve }))
  vi.stubGlobal('fetch', fetchMock)
  const firstController = new AbortController()

  const first = fetchSpaceReferencePreview('reference-one', '', firstController.signal)
  const second = fetchSpaceReferencePreview('reference-one')
  firstController.abort()

  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  resolveRequest?.(new Response(JSON.stringify({ preview }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await expect(second).resolves.toEqual(preview)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('starts a fresh preview request after a file mutation invalidates an older request', async () => {
  const stale = { ...textPreview('1:4', '旧目录'), content: { kind: 'directory' as const, relativePath: '', entries: [], truncated: false } }
  const current = { ...stale, fingerprint: '2:8', content: { ...stale.content, entries: [{ name: 'new.txt', relativePath: 'new.txt', kind: 'file' as const }] } }
  const pendingGets: Array<(response: Response) => void> = []
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ entry: { relativePath: 'new.txt' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return await new Promise<Response>((resolve) => { pendingGets.push(resolve) })
  })
  vi.stubGlobal('fetch', fetchMock)

  const staleRequest = fetchSpaceReferencePreview('reference-one')
  await waitFor(() => expect(pendingGets).toHaveLength(1))
  await createSpaceReferenceEntry('reference-one', '', 'new.txt')
  const refreshedRequest = fetchSpaceReferencePreview('reference-one')
  await waitFor(() => expect(pendingGets).toHaveLength(2))

  pendingGets[0]?.(new Response(JSON.stringify({ preview: stale }), { status: 200, headers: { 'content-type': 'application/json' } }))
  pendingGets[1]?.(new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await expect(refreshedRequest).resolves.toEqual(current)
  await expect(staleRequest).resolves.toEqual(current)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(2)
})

test('shows a compact relative breadcrumb without exposing the absolute source path', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    preview: { ...textPreview('1:4', '内容'), title: 'note.txt', sourceKind: 'workspace_folder', source: 'C:/workspace/docs/note.txt' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="reference-one" initialRelativePath="docs/note.txt" fallbackTitle="我的资料" canOpen={false} onOpen={() => undefined} />)

  const breadcrumb = await screen.findByRole('navigation', { name: '文件路径' })
  expect(breadcrumb.textContent).toBe('我的资料docsnote.txt')
  expect(breadcrumb.getAttribute('title')).toBe('C:/workspace/docs/note.txt')
  expect(screen.queryByText('C:/workspace/docs/note.txt')).toBeNull()
  expect(screen.queryByText('文件夹引用')).toBeNull()
})

test('renders complete GFM markdown and resolves relative reference assets', async () => {
  const markdown = [
    '# 阅读标题',
    '',
    '- [x] 已完成',
    '',
    '| 名称 | 状态 |',
    '| --- | --- |',
    '| 文档 | 可用 |',
    '',
    '```ts',
    'const ready = true',
    '```',
    '',
    '![结构图](../images/结构图.png)',
  ].join('\n')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    preview: { ...textPreview('1:100', markdown), title: 'guide.md', sourceKind: 'workspace_folder', source: 'C:/workspace/docs/guides/guide.md', content: { kind: 'text', text: markdown, truncated: false, editable: true, language: 'md' } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="reference-one" initialRelativePath="docs/guides/guide.md" fallbackTitle="项目" canOpen={false} onOpen={() => undefined} />)

  expect(await screen.findByRole('heading', { name: '阅读标题' })).toBeTruthy()
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.getByText('const ready = true')).toBeTruthy()
  expect(screen.getByRole('img', { name: '结构图' }).getAttribute('src')).toBe('/api/spaces/references/reference-one/content?path=docs%2Fimages%2F%E7%BB%93%E6%9E%84%E5%9B%BE.png')
  expect(document.querySelector('.aa-reference-preview__reader .aa-reference-preview__markdown')).not.toBeNull()
})

test('renders a managed Markdown asset from its language hint when the copied path has no extension', async () => {
  const markdown = '# 托管 Markdown\n\n这一段必须按 Markdown 阅读。'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    preview: {
      ...textPreview('managed:1', markdown),
      title: 'Readme.md',
      source: 'runtime/knowledge-assets/asset-one/content',
      content: { kind: 'text', text: markdown, truncated: false, editable: false, language: 'md', encoding: 'UTF-8' },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="asset-one" fallbackTitle="Readme.md" canOpen={false} onOpen={() => undefined} apiBase="/api/personal-knowledge/assets" readOnly />)

  expect(await screen.findByRole('heading', { name: '托管 Markdown' })).toBeTruthy()
  expect(screen.getByText('这一段必须按 Markdown 阅读。')).toBeTruthy()
  expect(document.querySelector('.aa-reference-preview__code')).toBeNull()
})

test('highlights known code languages and keeps encoding metadata visible', async () => {
  const json = '{"name":"AgentArbor","enabled":true}'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    preview: { ...textPreview('1:40', json), title: 'config.json', source: 'C:/workspace/config.json', content: { kind: 'text', text: json, truncated: false, editable: false, language: 'json', encoding: 'UTF-8' } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="config.json" canOpen={false} onOpen={() => undefined} />)

  expect(await screen.findByText('UTF-8')).toBeTruthy()
  expect(screen.getByText('json')).toBeTruthy()
  expect(document.querySelector('.aa-reference-preview__code .hljs-attr')?.textContent).toContain('name')
  expect(document.querySelector('.aa-reference-preview__code .hljs-string')?.textContent).toContain('AgentArbor')
})

test('opens markdown in the shared reading surface and autosaves only source edits', async () => {
  const user = userEvent.setup()
  const markdown = '# 标题\n\n第一段\n\n第二段'
  let currentMarkdown = markdown
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') currentMarkdown = (JSON.parse(String(init.body)) as { text: string }).text
    return new Response(JSON.stringify({
      preview: { ...textPreview('1:30', currentMarkdown), title: 'note.md', source: 'C:/workspace/note.md', content: { kind: 'text', text: currentMarkdown, truncated: false, editable: true, language: 'md', encoding: 'UTF-8' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="reference-one" fallbackTitle="note.md" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: '标题' })).toBeTruthy()
  expect(rendered.container.querySelectorAll('.aa-reference-markdown-prose p')).toHaveLength(2)

  const editor = rendered.container.querySelector('.aa-reference-markdown-prose')
  expect(editor?.getAttribute('contenteditable')).toBe('false')
  expect(rendered.container.querySelector('.aa-reference-preview__editor')).toBeNull()
  expect(screen.queryByRole('button', { name: '阅读' })).toBeNull()
  expect(screen.getByText('第一段')).toBeTruthy()
  expect(screen.getByText('第二段')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: '源码' }))
  const source = screen.getByRole('textbox')
  await user.type(source, '\n\n第三段')
  await waitFor(() => expect(currentMarkdown).toContain('第三段'))
  await user.click(screen.getByRole('button', { name: '阅读' }))
  expect(rendered.container.querySelector('.aa-reference-markdown-prose')?.getAttribute('contenteditable')).toBe('false')
})

test('initializes the editable draft from a cached preview without saving empty content', async () => {
  const user = userEvent.setup()
  const preview = markdownPreview('reference-cached', '1:18', '# 缓存正文\n\n不能丢失')
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') writes.push((JSON.parse(String(init.body)) as { text: string }).text)
    return new Response(JSON.stringify({ preview }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  await fetchSpaceReferencePreview('reference-cached')

  render(<ReferencePreview itemId="reference-cached" fallbackTitle="cached.md" canOpen={false} onOpen={() => undefined} />)
  expect(screen.getByRole('heading', { name: '缓存正文' })).toBeTruthy()
  expect(screen.getByText('不能丢失')).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(writes).toHaveLength(0)

  await user.click(screen.getByRole('button', { name: '源码' }))
  await user.type(screen.getByRole('textbox'), '新增内容')
  await waitFor(() => expect(writes.some((text) => text.includes('新增内容'))).toBe(true))
})

test('keeps the preview shell mounted but isolates document state while switching files', async () => {
  const previews: Record<string, SpaceReferencePreview> = {
    'reference-one': textPreview('1:3', '文件一'),
    'reference-two': { ...textPreview('2:3', '文件二'), itemId: 'reference-two', title: 'two.txt', source: 'C:/notes/two.txt' },
  }
  let resolveSecond: ((response: Response) => void) | undefined
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      writes += 1
      return new Response(JSON.stringify({ preview: previews['reference-one'] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const id = String(input).includes('reference-two') ? 'reference-two' : 'reference-one'
    if (id === 'reference-two') return await new Promise<Response>((resolve) => { resolveSecond = resolve })
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="reference-one" fallbackTitle="one.txt" canOpen={false} onOpen={() => undefined} />)
  await screen.findByDisplayValue('文件一')
  const shell = rendered.container.querySelector('.aa-reference-preview')
  const editor = screen.getByRole('textbox')

  rendered.rerender(<ReferencePreview itemId="reference-two" fallbackTitle="two.txt" canOpen={false} onOpen={() => undefined} />)
  expect(rendered.container.querySelector('.aa-reference-preview')).toBe(shell)
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.change(editor, { target: { value: '不应写入任何文件' } })
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(writes).toBe(0)

  resolveSecond?.(new Response(JSON.stringify({ preview: previews['reference-two'] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('文件二'))
})

test('does not autosave the previous markdown document into a newly selected file', async () => {
  const previews: Record<string, SpaceReferencePreview> = {
    'reference-one': markdownPreview('reference-one', '1:8', '# 文件一'),
    'reference-two': markdownPreview('reference-two', '2:8', '# 文件二'),
  }
  let resolveSecond: ((response: Response) => void) | undefined
  const writeTargets: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      writeTargets.push(String(input))
      return new Response(JSON.stringify({ preview: previews['reference-one'] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const id = String(input).includes('reference-two') ? 'reference-two' : 'reference-one'
    if (id === 'reference-two') return await new Promise<Response>((resolve) => { resolveSecond = resolve })
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="reference-one" fallbackTitle="one.md" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: '文件一' })).toBeTruthy()
  const previousEditor = rendered.container.querySelector('.aa-reference-markdown-prose')

  rendered.rerender(<ReferencePreview itemId="reference-two" fallbackTitle="two.md" canOpen={false} onOpen={() => undefined} />)
  expect(rendered.container.querySelector('.aa-reference-markdown-prose')).toBeNull()
  if (previousEditor !== null) fireEvent.input(previousEditor, { target: { textContent: '不应写入任何文件' } })
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(writeTargets.every((target) => target.includes('reference-one'))).toBe(true)
  expect(writeTargets.some((target) => target.includes('reference-two'))).toBe(false)

  resolveSecond?.(new Response(JSON.stringify({ preview: previews['reference-two'] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  expect(await screen.findByRole('heading', { name: '文件二' })).toBeTruthy()
})

function textPreview(fingerprint: string, text: string): SpaceReferencePreview {
  return {
    itemId: 'reference-one',
    title: 'note.txt',
    sourceKind: 'local_file',
    source: 'C:/notes/note.txt',
    status: 'ready',
    fingerprint,
    byteLength: text.length,
    modifiedAt: 1,
    content: { kind: 'text', text, truncated: false, editable: true, language: 'txt' },
  }
}

function markdownPreview(itemId: string, fingerprint: string, text: string): SpaceReferencePreview {
  return {
    ...textPreview(fingerprint, text),
    itemId,
    title: `${itemId}.md`,
    source: `C:/notes/${itemId}.md`,
    content: { kind: 'text', text, truncated: false, editable: true, language: 'md' },
  }
}
