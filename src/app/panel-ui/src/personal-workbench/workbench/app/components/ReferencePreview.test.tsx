import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ReferencePreview } from './ReferencePreview'
import type { DocumentPreview } from './referencePreviewClient'
import { clearReferencePreviewCacheForTesting, createSpaceReferenceEntry, fetchDocumentPreview, getCachedReferencePreview, getReferencePreviewError, invalidateDocumentPreviews, saveDocumentText, subscribeReferencePreviewCache } from './referencePreviewClient'

const getPdfDocumentMock = vi.hoisted(() => vi.fn())
const createPdfWorkerMock = vi.hoisted(() => vi.fn(() => ({ destroy: vi.fn() })))
vi.mock('unpdf/pdfjs', () => ({
  getDocument: getPdfDocumentMock,
  PDFWorker: { create: createPdfWorkerMock },
}))
vi.mock('./DocxDocumentSurface', () => ({
  DocxDocumentSurface: ({ url }: { url: string }) => <div data-testid="docx-document-surface">{url}</div>,
}))
vi.mock('./SpreadsheetDocumentSurface', () => ({
  SpreadsheetDocumentSurface: ({ url }: { url: string }) => <div data-testid="xlsx-document-surface">{url}</div>,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  getPdfDocumentMock.mockReset()
  createPdfWorkerMock.mockClear()
  clearReferencePreviewCacheForTesting()
})

test('drops deleted Agent-side references from the preview cache', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ preview: textPreview('1:1', '旧内容') }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))

  await fetchDocumentPreview('deleted-reference')
  expect(getCachedReferencePreview('deleted-reference')).toBeDefined()
  invalidateDocumentPreviews(['deleted-reference'])
  expect(getCachedReferencePreview('deleted-reference')).toBeUndefined()
})

test('refreshes an opened preview when an Agent-side change invalidates its cache', async () => {
  let current = textPreview('1:4', '旧内容')
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ preview: current }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)

  render(<ReferencePreview itemId="reference-one" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByDisplayValue('旧内容')).toBeTruthy()

  current = textPreview('2:4', '新内容')
  invalidateDocumentPreviews(['reference-one'])

  expect(await screen.findByText('来源已更新，当前内容仍保持不变。')).toBeTruthy()
  expect(screen.getByDisplayValue('旧内容')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('does not let a dirty desktop preview block the custom window close control', async () => {
  Object.defineProperty(window, 'agentarborDesktop', { configurable: true, value: {} })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ preview: textPreview('1:4', '原始内容') }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))

  try {
    render(<ReferencePreview itemId="reference-desktop-close" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
    const editor = await screen.findByDisplayValue('原始内容')
    fireEvent.change(editor, { target: { value: '尚未保存的草稿' } })

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(false)
  } finally {
    Object.defineProperty(window, 'agentarborDesktop', { configurable: true, value: undefined })
  }
})

test('renders structured and file PDFs through the same application surface', async () => {
  const previews: Record<string, DocumentPreview> = {
    structured: previewWithPresentation('structured', 'pdf', { kind: 'pages', pages: ['第一页'] }),
    file: previewWithPresentation('file', 'pdf', { kind: 'media', mediaKind: 'pdf', mimeType: 'application/pdf', url: '/api/files/file/content' }),
  }
  const destroy = vi.fn(async () => undefined)
  getPdfDocumentMock.mockReturnValue({ promise: Promise.resolve({ numPages: 0, destroy }) })
  vi.stubGlobal('Worker', class {
    terminate() {}
  })
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).includes('/file/') ? 'file' : 'structured'
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="structured" fallbackTitle="预置.pdf" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByText('第一页')).toBeTruthy()
  expect(rendered.container.querySelector('.aa-pdf-document[data-pdf-source="structured"]')).not.toBeNull()
  expect(rendered.container.querySelector('object')).toBeNull()

  rendered.rerender(<ReferencePreview itemId="file" fallbackTitle="本地.pdf" canOpen={false} onOpen={() => undefined} />)
  await waitFor(() => expect(rendered.container.querySelector('.aa-pdf-document[data-pdf-source="file"]')).not.toBeNull())
  expect(rendered.container.querySelector('object')).toBeNull()
  expect(getPdfDocumentMock).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/files/file/content' }))
})

test('routes DOCX and XLSX presentations to their application-owned surfaces', async () => {
  const previews: Record<string, DocumentPreview> = {
    docx: previewWithPresentation('docx', 'docx', {
      kind: 'office',
      officeKind: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      url: '/api/files/docx/content',
    }),
    xlsx: previewWithPresentation('xlsx', 'xlsx', {
      kind: 'office',
      officeKind: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      url: '/api/files/xlsx/content',
    }),
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).includes('/xlsx/') ? 'xlsx' : 'docx'
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="docx" fallbackTitle="document.docx" canOpen={false} onOpen={() => undefined} />)
  expect((await screen.findByTestId('docx-document-surface')).textContent).toContain('/api/files/docx/content')
  expect(screen.queryByTestId('xlsx-document-surface')).toBeNull()

  rendered.rerender(<ReferencePreview itemId="xlsx" fallbackTitle="workbook.xlsx" canOpen={false} onOpen={() => undefined} />)
  expect((await screen.findByTestId('xlsx-document-surface')).textContent).toContain('/api/files/xlsx/content')
  expect(screen.queryByTestId('docx-document-surface')).toBeNull()
})

test('uses the backend presentation as the renderer authority for text surfaces', async () => {
  const previews: Record<string, DocumentPreview> = {
    code: previewWithPresentation('code', 'code', { kind: 'text', text: 'plain words', truncated: false, editable: false, language: 'plaintext' }),
    text: previewWithPresentation('text', 'text', { kind: 'text', text: 'const value = 1', truncated: false, editable: false, language: 'typescript' }),
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).includes('/text/') ? 'text' : 'code'
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="code" fallbackTitle="无扩展名" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByText('plain words')).toBeTruthy()
  expect(rendered.container.querySelector('.aa-code-document')).not.toBeNull()

  rendered.rerender(<ReferencePreview itemId="text" fallbackTitle="source.ts" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByText('const value = 1')).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__plain')).not.toBeNull()
  expect(rendered.container.querySelector('.aa-code-document')).toBeNull()
})

test('keeps image, video, audio, and web content inside application-owned surfaces', async () => {
  const drawImage = vi.fn()
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  const previews: Record<string, DocumentPreview> = {
    image: previewWithPresentation('image', 'image', { kind: 'media', mediaKind: 'image', mimeType: 'image/png', url: '/image.png', alt: '图像替代文本' }),
    video: previewWithPresentation('video', 'video', { kind: 'media', mediaKind: 'video', mimeType: 'video/mp4', url: '/video.mp4', poster: '/poster.jpg', duration: '02:14' }),
    audio: previewWithPresentation('audio', 'audio', { kind: 'media', mediaKind: 'audio', mimeType: 'audio/mpeg', url: '/audio.mp3' }),
    web: previewWithPresentation('web', 'web', { kind: 'web', url: 'https://example.test', site: 'example.test', body: '# 网页正文' }),
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).match(/references\/([^/]+)\/preview/u)?.[1] ?? 'image'
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="image" fallbackTitle="image.png" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByAltText('图像替代文本')).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__media img')).not.toBeNull()
  expect(rendered.container.querySelector('.aa-reference-preview__media--described')).toBeNull()

  rendered.rerender(<ReferencePreview itemId="video" fallbackTitle="video.mp4" canOpen={false} onOpen={() => undefined} />)
  await screen.findByLabelText('video.pdf 画面')
  const video = rendered.container.querySelector('video')
  expect(video).not.toBeNull()
  expect(video!.closest('.aa-video-document')).not.toBeNull()
  expect(video!.closest('.aa-reference-preview__media')).toBeNull()
  expect(screen.queryByRole('status', { name: '正在加载视频' })).toBeNull()
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('poster')
  expect(rendered.container.querySelector('.aa-video-document__poster')?.getAttribute('src')).toBe('/poster.jpg')
  expect(video!.getAttribute('preload')).toBe('auto')
  expect(video!.hasAttribute('playsinline')).toBe(true)
  expect(video!.hasAttribute('controls')).toBe(false)
  expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '静音' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '全屏' })).toBeTruthy()
  expect(screen.getByText('0:00 / 02:14')).toBeTruthy()
  Object.defineProperties(video!, {
    videoWidth: { configurable: true, value: 2560 },
    videoHeight: { configurable: true, value: 1440 },
  })
  fireEvent.loadedData(video!)
  expect(video!.closest('.aa-video-document')?.getAttribute('data-state')).toBe('ready')
  expect(screen.queryByRole('status', { name: '正在加载视频' })).toBeNull()
  expect(getContext).toHaveBeenCalledWith('2d', expect.objectContaining({ alpha: false, colorSpace: 'srgb' }))
  expect(drawImage).toHaveBeenCalled()
  fireEvent.error(video!)
  expect(screen.getByRole('alert').textContent).toContain('无法播放这个视频。')

  rendered.rerender(<ReferencePreview itemId="audio" fallbackTitle="audio.mp3" canOpen={false} onOpen={() => undefined} />)
  const audio = await screen.findByLabelText('audio.pdf')
  expect(audio.closest('.aa-reference-preview__audio')).not.toBeNull()
  expect(audio.getAttribute('preload')).toBe('metadata')

  rendered.rerender(<ReferencePreview itemId="web" fallbackTitle="网页" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: '网页正文' })).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__web-source')).not.toBeNull()
})

test('renders an annotated web reference in the same continuous reading surface as demo web content', async () => {
  const previews: Record<string, DocumentPreview> = {
    'web-annotated': {
      ...previewWithPresentation('web-annotated', 'web', { kind: 'web', url: 'https://distill.pub/2017/feature-visualization', site: 'distill.pub' }),
      title: '特征可视化',
      sourceKind: 'web_page',
      annotation: {
        markdown: '# Agent 整理\n\n通过优化输入观察神经元激活。',
        keyPoints: ['通过优化输入观察神经元激活', '深层网络倾向于表示更抽象的概念'],
        tags: ['深度学习', '可视化'],
        revision: 2,
        updatedAt: '2026-08-11T00:00:00.000Z',
        updatedBy: 'agent',
      },
    },
    'web-bare': {
      ...previewWithPresentation('web-bare', 'web', { kind: 'web', url: 'https://example.test/private', site: 'example.test' }),
      title: '未整理网页',
      sourceKind: 'web_page',
    },
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).includes('web-annotated') ? 'web-annotated' : 'web-bare'
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="web-annotated" fallbackTitle="特征可视化" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: 'Agent 整理' })).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__annotation')).toBeNull()
  expect(rendered.container.querySelector('.aa-reference-preview__web-document')).not.toBeNull()
  expect(rendered.container.querySelector('.aa-reference-markdown-prose')?.textContent).toContain('通过优化输入观察神经元激活')
  expect(rendered.container.querySelector('.aa-reference-preview__annotation-points')?.textContent).toContain('深层网络倾向于表示更抽象的概念')
  expect(rendered.container.querySelector('.aa-reference-preview__annotation-tags')?.textContent).toContain('可视化')
  const source = rendered.container.querySelector('.aa-reference-preview__web-source')
  const document = rendered.container.querySelector('.aa-reference-markdown-prose')
  expect(source?.querySelector('a')?.getAttribute('href')).toBe('https://distill.pub/2017/feature-visualization')
  if (source === null || document === null) throw new Error('Expected the web source and document surfaces to exist.')
  expect(source.compareDocumentPosition(document) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByText('Agent 尚未整理此引用')).toBeNull()
})

test('shows an explicit unannotated state and the source entry for a bare web reference', async () => {
  const preview = {
    ...previewWithPresentation('web-bare', 'web', { kind: 'web', url: 'https://example.test/private', site: 'example.test' }),
    title: '未整理网页',
    sourceKind: 'web_page',
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ preview }), { status: 200, headers: { 'content-type': 'application/json' } })))

  const rendered = render(<ReferencePreview itemId="web-bare" fallbackTitle="未整理网页" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByText('Agent 尚未整理此引用')).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__annotation')).toBeNull()
  expect(rendered.container.querySelector('.aa-reference-preview__web a')?.getAttribute('href')).toBe('https://example.test/private')
})

test('refreshes an opened preview immediately when the Agent updates its annotation', async () => {
  const base = { kind: 'web' as const, url: 'https://distill.pub/2017/feature-visualization', site: 'distill.pub' }
  let current: DocumentPreview = {
    ...previewWithPresentation('web-annotation-live', 'web', base),
    title: '特征可视化',
    sourceKind: 'web_page',
    annotation: {
      markdown: '# v1 整理',
      revision: 1,
      updatedAt: '2026-08-11T00:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)

  render(<ReferencePreview itemId="web-annotation-live" fallbackTitle="特征可视化" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: 'v1 整理' })).toBeTruthy()

  current = {
    ...current,
    annotation: {
      markdown: '# v2 整理\n\nAgent 补充了与 Transformer 的关系。',
      revision: 2,
      updatedAt: '2026-08-11T01:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  invalidateDocumentPreviews(['web-annotation-live'])

  expect(await screen.findByRole('heading', { name: 'v2 整理' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'v1 整理' })).toBeNull()
  expect(screen.queryByText('来源已更新，当前内容仍保持不变。')).toBeNull()
})

test('keeps the user text draft when only the annotation changes on refresh', async () => {
  const user = userEvent.setup()
  const base = textPreview('1:4', '正文内容')
  let current: DocumentPreview = {
    ...base,
    annotation: {
      markdown: '# 整理 v1',
      revision: 1,
      updatedAt: '2026-08-11T00:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByDisplayValue('正文内容')).toBeTruthy()
  const editor = screen.getByRole('textbox')
  await user.clear(editor)
  await user.type(editor, '我的草稿')

  current = {
    ...current,
    annotation: {
      markdown: '# 整理 v2',
      revision: 2,
      updatedAt: '2026-08-11T02:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  invalidateDocumentPreviews(['reference-one'])

  expect(await screen.findByRole('heading', { name: '整理 v2' })).toBeTruthy()
  expect(screen.getByDisplayValue('我的草稿')).toBeTruthy()
  expect(screen.getByRole('textbox')).toBeTruthy()
})

test('applies a refreshed annotation but keeps the source-change notice when both changed', async () => {
  const base = textPreview('1:4', '正文内容')
  let current: DocumentPreview = {
    ...base,
    annotation: {
      markdown: '# 整理 v1',
      revision: 1,
      updatedAt: '2026-08-11T00:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByDisplayValue('正文内容')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: '整理 v1' })).toBeTruthy()

  current = {
    ...textPreview('2:6', '外部新版正文'),
    annotation: {
      markdown: '# 整理 v2',
      revision: 2,
      updatedAt: '2026-08-11T02:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  invalidateDocumentPreviews(['reference-one'])

  expect(await screen.findByRole('heading', { name: '整理 v2' })).toBeTruthy()
  expect(screen.getByText('来源已更新，当前内容仍保持不变。')).toBeTruthy()
  expect(screen.getByDisplayValue('正文内容')).toBeTruthy()
  expect(screen.getByRole('button', { name: '加载新版' })).toBeTruthy()
})

test('keeps the image caption editable alongside the Space annotation', async () => {
  const annotated = {
    ...previewWithPresentation('image-annotated', 'image', { kind: 'media', mediaKind: 'image', mimeType: 'image/png', url: '/image.png', alt: '图像', caption: '手绘的网络结构与推导草稿', captionEditable: true, captionFingerprint: 'space-image-caption:1' }),
    title: '神经网络结构图.png',
    annotation: {
      markdown: '# Agent 描述\n\n手绘网络结构与推导草稿，属于课程学习辅助素材。',
      revision: 1,
      updatedAt: '2026-08-11T00:00:00.000Z',
      updatedBy: 'agent',
    },
  }
  const bare = {
    ...previewWithPresentation('image-bare', 'image', { kind: 'media', mediaKind: 'image', mimeType: 'image/png', url: '/image.png', alt: '图像', caption: '手绘的网络结构与推导草稿' }),
    title: '神经网络结构图.png',
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).includes('image-annotated') ? 'image-annotated' : 'image-bare'
    return new Response(JSON.stringify({ preview: id === 'image-annotated' ? annotated : bare }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="image-annotated" fallbackTitle="神经网络结构图.png" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByAltText('图像')).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__media--described')).not.toBeNull()
  expect(screen.getByText('手绘的网络结构与推导草稿')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: '图片说明' })).toBeTruthy()
  expect(rendered.container.querySelector('.aa-reference-preview__annotation')).not.toBeNull()

  rendered.rerender(<ReferencePreview itemId="image-bare" fallbackTitle="神经网络结构图.png" canOpen={false} onOpen={() => undefined} />)
  await waitFor(() => expect(rendered.container.querySelector('.aa-reference-preview__media--described')).not.toBeNull())
  expect(screen.getByText('手绘的网络结构与推导草稿')).toBeTruthy()
})

test('edits an image caption and allows adding one to a captionless image', async () => {
  const user = userEvent.setup()
  let current: DocumentPreview = {
    ...previewWithPresentation('image-caption', 'image', {
      kind: 'media',
      mediaKind: 'image',
      mimeType: 'image/png',
      url: '/image.png',
      alt: '图像',
      caption: '旧说明',
      captionEditable: true,
      captionFingerprint: 'caption-v1',
    }),
    fingerprint: 'caption-v1',
  }
  const emptyPreview: DocumentPreview = {
    ...current,
    itemId: 'image-caption-empty',
    fingerprint: 'caption-empty',
    content: { ...(current.content as Extract<DocumentPreview['content'], { kind: 'media' }>), caption: undefined },
  }
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const empty = String(_input).includes('image-caption-empty')
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { caption: string }
      current = {
        ...current,
        fingerprint: `caption-${body.caption || 'empty'}`,
        content: { ...(current.content as Extract<DocumentPreview['content'], { kind: 'media' }>), caption: body.caption || undefined, captionFingerprint: `caption-${body.caption || 'empty'}` },
      }
    }
    return new Response(JSON.stringify({ preview: empty ? emptyPreview : current }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<ReferencePreview itemId="image-caption" fallbackTitle="结构图.png" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByText('旧说明')).toBeTruthy()
  const editor = screen.getByRole('textbox', { name: '图片说明' })
  await user.click(editor)
  await user.clear(editor)
  await user.type(editor, '新说明')
  fireEvent.blur(editor)
  await waitFor(() => expect(screen.getByText('新说明')).toBeTruthy())
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)

  const emptyRendered = render(<ReferencePreview itemId="image-caption-empty" fallbackTitle="结构图.png" canOpen={false} onOpen={() => undefined} />)
  const entry = await screen.findByRole('button', { name: '添加图片说明' })
  expect(emptyRendered.container.querySelector('.aa-reference-preview__caption-add')).toBe(entry)
  await user.click(entry)
  expect(screen.getAllByRole('textbox', { name: '图片说明' })).toHaveLength(2)
  emptyRendered.unmount()
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

test('saves an edited child file with its current relative path', async () => {
  let savedBody: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { relativePath: string; text: string }
      savedBody = body
      return new Response(JSON.stringify({ preview: textPreview('2:8', body.text) }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ preview: textPreview('1:4', '原始内容') }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  render(<ReferencePreview itemId="reference-one" initialRelativePath="docs/note.txt" fallbackTitle="项目文件" canOpen={false} onOpen={() => undefined} />)
  const editor = await screen.findByDisplayValue('原始内容')
  fireEvent.change(editor, { target: { value: '子文件内容' } })

  await waitFor(() => expect(savedBody).toMatchObject({ relativePath: 'docs/note.txt', text: '子文件内容' }))
  expect(savedBody).not.toHaveProperty('itemId')
})

test('keeps the preview header visible while a new document is loading', async () => {
  let resolvePreview: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn(async () => await new Promise<Response>((resolve) => { resolvePreview = resolve })))

  render(<ReferencePreview itemId="reference-loading" fallbackTitle="正在打开.md" canOpen={false} onOpen={() => undefined} />)
  expect(screen.getByRole('navigation', { name: '文件路径' })).toBeTruthy()
  expect(screen.getByText('正在读取引用内容...')).toBeTruthy()

  resolvePreview?.(new Response(JSON.stringify({ preview: markdownPreview('reference-loading', '1:4', '# 已打开') }), { status: 200, headers: { 'content-type': 'application/json' } }))
  expect(await screen.findByRole('heading', { name: '已打开' })).toBeTruthy()
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

  const staleRequest = fetchDocumentPreview('reference-one')
  await saveDocumentText('reference-one', { relativePath: '', expectedFingerprint: '1:4', text: '新内容' })
  resolveGet?.(new Response(JSON.stringify({ preview: stale }), { status: 200, headers: { 'content-type': 'application/json' } }))

  expect(await staleRequest).toEqual(saved)
  expect(getCachedReferencePreview('reference-one')).toEqual(saved)
})

test('lets an older preview GET converge on a save that is still in flight', async () => {
  const stale = textPreview('1:4', '旧内容')
  const saved = textPreview('2:4', '新内容')
  let resolveGet: ((response: Response) => void) | undefined
  let resolvePut: ((response: Response) => void) | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') return await new Promise<Response>((resolve) => { resolvePut = resolve })
    return await new Promise<Response>((resolve) => { resolveGet = resolve })
  }))

  const staleRequest = fetchDocumentPreview('reference-one')
  const saveRequest = saveDocumentText('reference-one', { relativePath: '', expectedFingerprint: '1:4', text: '新内容' })
  resolveGet?.(new Response(JSON.stringify({ preview: stale }), { status: 200, headers: { 'content-type': 'application/json' } }))
  resolvePut?.(new Response(JSON.stringify({ preview: saved }), { status: 200, headers: { 'content-type': 'application/json' } }))

  await expect(saveRequest).resolves.toEqual(saved)
  await expect(staleRequest).resolves.toEqual(saved)
  expect(getCachedReferencePreview('reference-one')).toEqual(saved)
})

test('waits for an in-flight save before starting a preview GET', async () => {
  const saved = textPreview('2:4', '新内容')
  let resolvePut: ((response: Response) => void) | undefined
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') return await new Promise<Response>((resolve) => { resolvePut = resolve })
    throw new Error('读取不应在保存完成前发起')
  })
  vi.stubGlobal('fetch', fetchMock)

  const saveRequest = saveDocumentText('reference-one', { relativePath: '', expectedFingerprint: '1:4', text: '新内容' })
  const previewRequest = fetchDocumentPreview('reference-one')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  resolvePut?.(new Response(JSON.stringify({ preview: saved }), { status: 200, headers: { 'content-type': 'application/json' } }))

  await expect(saveRequest).resolves.toEqual(saved)
  await expect(previewRequest).resolves.toEqual(saved)
  expect(getCachedReferencePreview('reference-one')).toEqual(saved)
})

test('refreshes a read after a failed save instead of propagating the write error', async () => {
  const old = textPreview('1:4', '旧缓存')
  const current = textPreview('3:4', '当前内容')
  let resolvePut: ((response: Response) => void) | undefined
  let previewReads = 0
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') return await new Promise<Response>((resolve) => { resolvePut = resolve })
    previewReads += 1
    return new Response(JSON.stringify({ preview: previewReads === 1 ? old : current }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)

  await fetchDocumentPreview('reference-one')
  const saveRequest = saveDocumentText('reference-one', { relativePath: '', expectedFingerprint: '1:4', text: '冲突内容' })
  const previewRequest = fetchDocumentPreview('reference-one')
  resolvePut?.(new Response(JSON.stringify({ error: { message: '文件已被外部修改' } }), { status: 409, headers: { 'content-type': 'application/json' } }))

  await expect(saveRequest).rejects.toMatchObject({ status: 409 })
  await expect(previewRequest).resolves.toEqual(current)
  expect(previewReads).toBe(2)
  expect(getCachedReferencePreview('reference-one')).toEqual(current)
})

test('keeps each save promise bound to its own HTTP result', async () => {
  const saved = textPreview('2:4', '第一次')
  const putResolvers: Array<(response: Response) => void> = []
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') return await new Promise<Response>((resolve) => { putResolvers.push(resolve) })
    throw new Error('不应读取')
  })
  vi.stubGlobal('fetch', fetchMock)

  const firstSave = saveDocumentText('reference-one', { relativePath: '', expectedFingerprint: '1:4', text: '第一次' })
  const secondSave = saveDocumentText('reference-one', { relativePath: '', expectedFingerprint: '1:4', text: '第二次' })
  expect(putResolvers).toHaveLength(2)

  putResolvers[0]?.(new Response(JSON.stringify({ preview: saved }), { status: 200, headers: { 'content-type': 'application/json' } }))
  putResolvers[1]?.(new Response(JSON.stringify({ error: { message: '第二次保存冲突' } }), { status: 409, headers: { 'content-type': 'application/json' } }))

  await expect(firstSave).resolves.toEqual(saved)
  await expect(secondSave).rejects.toMatchObject({ status: 409 })
})

test('cancels one preview read without affecting another caller', async () => {
  const preview = textPreview('1:4', '共享内容')
  const resolvers: Array<(response: Response) => void> = []
  const fetchMock = vi.fn(async () => await new Promise<Response>((resolve) => { resolvers.push(resolve) }))
  vi.stubGlobal('fetch', fetchMock)
  const firstController = new AbortController()

  const first = fetchDocumentPreview('reference-one', '', firstController.signal)
  const second = fetchDocumentPreview('reference-one')
  firstController.abort()

  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  resolvers.forEach((resolve) => resolve(new Response(JSON.stringify({ preview }), { status: 200, headers: { 'content-type': 'application/json' } })))
  await expect(second).resolves.toEqual(preview)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(getReferencePreviewError('reference-one')).toBeUndefined()
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

  const staleRequest = fetchDocumentPreview('reference-one')
  await waitFor(() => expect(pendingGets).toHaveLength(1))
  await createSpaceReferenceEntry('reference-one', '', 'new.txt')
  const refreshedRequest = fetchDocumentPreview('reference-one')
  await waitFor(() => expect(pendingGets).toHaveLength(2))

  pendingGets[0]?.(new Response(JSON.stringify({ preview: stale }), { status: 200, headers: { 'content-type': 'application/json' } }))
  pendingGets[1]?.(new Response(JSON.stringify({ preview: current }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await expect(refreshedRequest).resolves.toEqual(current)
  await expect(staleRequest).resolves.toEqual(current)
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(2)
})

test('batches preview notifications and keeps API data domains isolated', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const itemId = decodeURIComponent(String(input).split('/').at(-2) ?? 'unknown')
    return new Response(JSON.stringify({ preview: { ...textPreview(`1:${itemId.length}`, itemId), itemId } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  const managedListener = vi.fn()
  const spaceListener = vi.fn()
  const unsubscribeManaged = subscribeReferencePreviewCache(managedListener, '/api/personal-knowledge/assets')
  const unsubscribeSpace = subscribeReferencePreviewCache(spaceListener)

  await Promise.all([
    fetchDocumentPreview('managed-one', '', undefined, '/api/personal-knowledge/assets'),
    fetchDocumentPreview('managed-two', '', undefined, '/api/personal-knowledge/assets'),
    fetchDocumentPreview('space-one'),
  ])

  await waitFor(() => expect(managedListener).toHaveBeenCalledTimes(1))
  expect(spaceListener).toHaveBeenCalledTimes(1)
  await fetchDocumentPreview('managed-one', '', undefined, '/api/personal-knowledge/assets')
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(managedListener).toHaveBeenCalledTimes(1)
  unsubscribeManaged()
  unsubscribeSpace()
})

test('keeps same-named files in different relative paths isolated', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const first = url.includes(encodeURIComponent('folder-a/config.json'))
    const preview = { ...textPreview(first ? 'a:1' : 'b:1', first ? 'A' : 'B'), source: first ? 'C:/root/folder-a/config.json' : 'C:/root/folder-b/config.json' }
    return new Response(JSON.stringify({ preview }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  await Promise.all([
    fetchDocumentPreview('reference-one', 'folder-a/config.json'),
    fetchDocumentPreview('reference-one', 'folder-b/config.json'),
  ])

  expect(getCachedReferencePreview('reference-one', 'folder-a/config.json')?.content).toMatchObject({ kind: 'text', text: 'A' })
  expect(getCachedReferencePreview('reference-one', 'folder-b/config.json')?.content).toMatchObject({ kind: 'text', text: 'B' })
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
    preview: { ...textPreview('1:100', markdown), title: 'guide.md', sourceKind: 'workspace_folder', source: 'C:/workspace/docs/guides/guide.md', presentation: { kind: 'markdown', editable: true, sourceMode: true }, content: { kind: 'text', text: markdown, truncated: false, editable: true, language: 'md' } },
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
      presentation: { kind: 'markdown', editable: false, sourceMode: false },
      content: { kind: 'text', text: markdown, truncated: false, editable: false, language: 'md', encoding: 'UTF-8' },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="asset-one" fallbackTitle="Readme.md" canOpen={false} onOpen={() => undefined} apiBase="/api/personal-knowledge/assets" readOnly />)

  expect(await screen.findByRole('heading', { name: '托管 Markdown' })).toBeTruthy()
  expect(screen.getByText('这一段必须按 Markdown 阅读。')).toBeTruthy()
  expect(document.querySelector('.aa-code-document')).toBeNull()
})

test('highlights known code languages and keeps encoding metadata visible', async () => {
  const json = '{"name":"AgentArbor","enabled":true}'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    preview: { ...textPreview('1:40', json), title: 'config.json', source: 'C:/workspace/config.json', presentation: { kind: 'code', editable: false, sourceMode: false }, content: { kind: 'text', text: json, truncated: false, editable: false, language: 'json', encoding: 'UTF-8' } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="config.json" canOpen={false} onOpen={() => undefined} />)

  expect(await screen.findByText('UTF-8')).toBeTruthy()
  expect(screen.getByText('json')).toBeTruthy()
  expect(document.querySelector('.aa-code-document__source .hljs-attr')?.textContent).toContain('name')
  expect(document.querySelector('.aa-code-document__source .hljs-string')?.textContent).toContain('AgentArbor')
})

test('opens markdown as WYSIWYG and keeps source edits autosaved', async () => {
  const user = userEvent.setup()
  const markdown = '# 标题\n\n第一段\n\n第二段'
  let currentMarkdown = markdown
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') currentMarkdown = (JSON.parse(String(init.body)) as { text: string }).text
    return new Response(JSON.stringify({
      preview: { ...textPreview('1:30', currentMarkdown), title: 'note.md', source: 'C:/workspace/note.md', presentation: { kind: 'markdown', editable: true, sourceMode: true }, content: { kind: 'text', text: currentMarkdown, truncated: false, editable: true, language: 'md', encoding: 'UTF-8' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="reference-one" fallbackTitle="note.md" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: '标题' })).toBeTruthy()
  expect(rendered.container.querySelectorAll('.aa-reference-markdown-prose p')).toHaveLength(2)

  const editor = rendered.container.querySelector('.aa-reference-markdown-prose')
  expect(editor?.getAttribute('contenteditable')).toBe('true')
  expect(rendered.container.querySelector('.aa-reference-preview__editor')).toBeNull()
  expect(screen.queryByRole('button', { name: '阅读' })).toBeNull()
  expect(screen.getByText('第一段')).toBeTruthy()
  expect(screen.getByText('第二段')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: '源码' }))
  const source = screen.getByRole('textbox')
  await user.type(source, '\n\n第三段')
  await waitFor(() => expect(currentMarkdown).toContain('第三段'))
  await user.click(screen.getByRole('button', { name: '阅读' }))
  expect(rendered.container.querySelector('.aa-reference-markdown-prose')?.getAttribute('contenteditable')).toBe('true')
})

test('initializes the editable draft from a cached preview without saving empty content', async () => {
  const user = userEvent.setup()
  const preview = markdownPreview('reference-cached', '1:18', '# 缓存正文\n\n不能丢失')
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') writes.push((JSON.parse(String(init.body)) as { text: string }).text)
    return new Response(JSON.stringify({ preview }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  await fetchDocumentPreview('reference-cached')

  render(<ReferencePreview itemId="reference-cached" fallbackTitle="cached.md" canOpen={false} onOpen={() => undefined} />)
  expect(screen.getByRole('heading', { name: '缓存正文' })).toBeTruthy()
  expect(screen.getByText('不能丢失')).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(writes).toHaveLength(0)

  await user.click(screen.getByRole('button', { name: '源码' }))
  await user.type(screen.getByRole('textbox'), '新增内容')
  await waitFor(() => expect(writes.some((text) => text.includes('新增内容'))).toBe(true))
})

test('uses the latest successful fingerprint when edits queue behind an in-flight save', async () => {
  const putBodies: Array<{ expectedFingerprint: string; text: string }> = []
  const putResolvers: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBodies.push(JSON.parse(String(init.body)) as { expectedFingerprint: string; text: string })
      return await new Promise<Response>((resolve) => { putResolvers.push(resolve) })
    }
    return new Response(JSON.stringify({ preview: textPreview('f0', '开始') }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  render(<ReferencePreview itemId="reference-one" fallbackTitle="note.txt" canOpen={false} onOpen={() => undefined} />)
  const editor = await screen.findByRole('textbox')
  fireEvent.change(editor, { target: { value: '第一次' } })
  await waitFor(() => expect(putBodies).toHaveLength(1), { timeout: 1_500 })
  fireEvent.change(editor, { target: { value: '第二次' } })
  await new Promise((resolve) => setTimeout(resolve, 550))
  expect(putBodies).toHaveLength(1)

  putResolvers[0]?.(new Response(JSON.stringify({ preview: textPreview('f1', '第一次') }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await waitFor(() => expect(putBodies).toHaveLength(2))
  expect(putBodies[1]).toEqual(expect.objectContaining({ expectedFingerprint: 'f1', text: '第二次' }))
  putResolvers[1]?.(new Response(JSON.stringify({ preview: textPreview('f2', '第二次') }), { status: 200, headers: { 'content-type': 'application/json' } }))
  await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
})

test('keeps the preview shell mounted but isolates document state while switching files', async () => {
  const previews: Record<string, DocumentPreview> = {
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
  const previews: Record<string, DocumentPreview> = {
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

test('restores document scroll and source mode by target identity', async () => {
  const previews: Record<string, DocumentPreview> = {
    'reference-view-memory-one': markdownPreview('reference-view-memory-one', '1:8', '# 文档一\n\n正文一'),
    'reference-view-memory-two': markdownPreview('reference-view-memory-two', '2:8', '# 文档二'),
  }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const id = String(input).includes('reference-view-memory-two') ? 'reference-view-memory-two' : 'reference-view-memory-one'
    return new Response(JSON.stringify({ preview: previews[id] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))

  const rendered = render(<ReferencePreview itemId="reference-view-memory-one" fallbackTitle="文档一.md" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: '文档一' })).toBeTruthy()
  const reader = rendered.container.querySelector<HTMLElement>('[data-document-scroll="content"]')
  expect(reader).not.toBeNull()
  reader!.scrollTop = 180
  fireEvent.scroll(reader!)
  await userEvent.click(screen.getByRole('button', { name: '源码' }))

  rendered.rerender(<ReferencePreview itemId="reference-view-memory-two" fallbackTitle="文档二.md" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('heading', { name: '文档二' })).toBeTruthy()
  rendered.rerender(<ReferencePreview itemId="reference-view-memory-one" fallbackTitle="文档一.md" canOpen={false} onOpen={() => undefined} />)
  expect(await screen.findByRole('button', { name: '阅读' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: '阅读' }))

  await waitFor(() => expect(rendered.container.querySelector<HTMLElement>('[data-document-scroll="content"]')?.scrollTop).toBe(180))
})

function textPreview(fingerprint: string, text: string): DocumentPreview {
  return {
    itemId: 'reference-one',
    title: 'note.txt',
    sourceKind: 'local_file',
    source: 'C:/notes/note.txt',
    status: 'ready',
    presentation: { kind: 'text', editable: true, sourceMode: false },
    fingerprint,
    byteLength: text.length,
    modifiedAt: 1,
    content: { kind: 'text', text, truncated: false, editable: true, language: 'txt' },
  }
}

function markdownPreview(itemId: string, fingerprint: string, text: string): DocumentPreview {
  return {
    ...textPreview(fingerprint, text),
    itemId,
    title: `${itemId}.md`,
    source: `C:/notes/${itemId}.md`,
    presentation: { kind: 'markdown', editable: true, sourceMode: true },
    content: { kind: 'text', text, truncated: false, editable: true, language: 'md' },
  }
}

function previewWithPresentation(
  itemId: string,
  kind: DocumentPreview['presentation']['kind'],
  content: DocumentPreview['content'],
): DocumentPreview {
  return {
    itemId,
    title: `${itemId}.pdf`,
    sourceKind: itemId === 'structured' ? 'workbench_asset' : 'local_file',
    source: itemId === 'structured' ? `workbench-asset:${itemId}` : `C:/documents/${itemId}.pdf`,
    status: 'ready',
    presentation: { kind, editable: false, sourceMode: false },
    content,
  }
}
