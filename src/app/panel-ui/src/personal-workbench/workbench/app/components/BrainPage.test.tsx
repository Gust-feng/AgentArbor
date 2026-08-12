import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { BrainPage } from './BrainPage'
import { mutatePersonalKnowledge, resetPersonalKnowledgeForTesting } from './personalKnowledgeClient'
import { clearReferencePreviewCacheForTesting, primeReferencePreviewCache } from './referencePreviewClient'

beforeEach(() => {
  clearReferencePreviewCacheForTesting()
  window.localStorage.removeItem('agentarbor:knowledge-view')
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  resetPersonalKnowledgeForTesting({
    notes: [
      {
        id: 'note-first',
        spaceId: 'space-reading',
        title: '第一篇笔记',
        bodyMarkdown: '# 第一篇\n\n'.repeat(80),
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'note-second',
        spaceId: 'space-reading',
        title: '第二篇笔记',
        bodyMarkdown: '# 第二篇',
        revision: 1,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'note-third',
        spaceId: 'space-reading',
        title: '第三篇笔记',
        bodyMarkdown: '# 第三篇',
        revision: 1,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 'note-fourth',
        spaceId: 'space-reading',
        title: '第四篇笔记',
        bodyMarkdown: '# 第四篇',
        revision: 1,
        createdAt: 4,
        updatedAt: 4,
      },
    ],
    pages: [
      { refId: 'note-first', kind: 'note', collectedAt: 1 },
      { refId: 'note-second', kind: 'note', collectedAt: 2 },
      { refId: 'note-third', kind: 'note', collectedAt: 3 },
      { refId: 'note-fourth', kind: 'note', collectedAt: 4 },
    ],
    links: [
      { from: 'note-first', to: 'note-second' },
      { from: 'note-first', to: 'note-third' },
      { from: 'note-second', to: 'note-third' },
      { from: 'note-first', to: 'note-fourth' },
    ],
  })
})

async function enterStackView(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '知识库' }))
  await user.click(screen.getByRole('menuitemradio', { name: /堆叠阅读/u }))
  await waitFor(() => expect(document.querySelector('[data-knowledge-nav-context="stack"]')).not.toBeNull())
}

test('keeps the knowledge navigation stable while changing view surfaces', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  const navigation = screen.getByRole('navigation', { name: '知识库导航' })
  const navigationViewport = document.querySelector('[data-knowledge-nav-viewport]')
  expect(document.querySelector('[data-knowledge-view-surface="browse"]')).not.toBeNull()

  await enterStackView(user)

  expect(screen.getByRole('navigation', { name: '知识库导航' })).toBe(navigation)
  expect(document.querySelector('[data-knowledge-nav-viewport]')).toBe(navigationViewport)
  expect(document.querySelector('[data-knowledge-nav-context="stack"]')).not.toBeNull()
  expect(document.querySelector('[data-knowledge-view-surface="stack"]')).not.toBeNull()
})

test('returns focus to the knowledge view trigger after selecting a view', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  const trigger = screen.getByRole('button', { name: '知识库' })
  await user.click(trigger)
  await user.click(screen.getByRole('menuitemradio', { name: /堆叠阅读/u }))

  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(document.querySelector('[data-knowledge-nav-context="stack"]')).not.toBeNull()
})

test('supports standard arrow-key navigation in the knowledge view menu', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await user.click(screen.getByRole('button', { name: '知识库' }))
  const browseOption = screen.getByRole('menuitemradio', { name: /浏览视图/u })
  const stackOption = screen.getByRole('menuitemradio', { name: /堆叠阅读/u })
  await waitFor(() => expect(document.activeElement).toBe(browseOption))

  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(stackOption)
  await user.keyboard('{Home}')
  expect(document.activeElement).toBe(browseOption)
  await user.keyboard('{End}')
  expect(document.activeElement).toBe(stackOption)
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(browseOption)
})

test('restores each knowledge navigation context scroll position', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  const browseContext = document.querySelector<HTMLElement>('[data-knowledge-nav-context="browse"]')!
  browseContext.scrollTop = 72
  fireEvent.scroll(browseContext)

  await enterStackView(user)
  const stackContext = document.querySelector<HTMLElement>('[data-knowledge-nav-context="stack"]')!
  stackContext.scrollTop = 36
  fireEvent.scroll(stackContext)

  await user.click(screen.getByRole('button', { name: '知识库' }))
  await user.click(screen.getByRole('menuitemradio', { name: /浏览视图/u }))
  // 视图切换由菜单退出动画驱动,新 browse 节点出现后旧的 stack 节点可能仍在退出动画中
  // (同一属性会短暂出现两个节点)。等待唯一 browse 节点稳定存在且滚动位置恢复,
  // 避免动画时序抢跑造成 flaky。
  await waitFor(() => {
    const contexts = [...document.querySelectorAll<HTMLElement>('[data-knowledge-nav-context]')]
    expect(contexts.filter((el) => el.getAttribute('data-knowledge-nav-context') === 'browse')).toHaveLength(1)
    expect(document.querySelector<HTMLElement>('[data-knowledge-nav-context="browse"]')?.scrollTop).toBe(72)
  })
})

test('keeps related files outside the document scroll area', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: '最近' })).toBeNull()
    expect(screen.queryByRole('button', { name: '全部' })).toBeNull()
  })
  expect(screen.getByText('阅读路径')).toBeTruthy()
  expect(screen.getByRole('button', { name: '起点索引' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))

  expect(screen.getByRole('button', { name: '展开起点索引' })).toBeTruthy()
  expect(document.querySelector('[data-wiki-start-picker]')).not.toBeNull()
  expect(document.querySelectorAll('[data-wiki-pane-boundary]')).toHaveLength(2)
  const runway = document.querySelector<HTMLElement>('[data-wiki-scroll-runway]')
  expect(runway?.style.width).toBe('100%')
  expect(runway?.style.minWidth).toBe('460px')

  const relatedFiles = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  const pane = relatedFiles.closest<HTMLElement>('[data-wiki-pane]')
  const documentScrollArea = pane?.querySelector<HTMLElement>('[data-wiki-pane-content]')

  expect(pane).not.toBeNull()
  expect(documentScrollArea).not.toBeNull()
  expect(documentScrollArea?.contains(relatedFiles)).toBe(false)
  expect(relatedFiles.querySelector('[data-wiki-relations-tab]')).not.toBeNull()
  expect(relatedFiles.querySelector('[data-wiki-relations-surface]')).not.toBeNull()
  expect(relatedFiles.querySelector('[data-wiki-relations-list]')?.className).toContain('overflow-x-hidden')
  expect(within(relatedFiles).getByRole('button', { name: /第二篇笔记/u })).toBeTruthy()
})

test('moves only the pane viewport when a newly mounted pane is outside it', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  const scrollTo = vi.fn()
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: scrollTo })
  const relatedFiles = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(relatedFiles).getByRole('button', { name: /第二篇笔记/u }))

  const secondPane = document.querySelector<HTMLElement>('[data-wiki-pane="note-second"]')
  expect(secondPane).not.toBeNull()
  expect(secondPane?.style.width).toBe('460px')
  expect(scrollTo).toHaveBeenCalledWith({ left: 874, behavior: 'smooth' })
})

test('focuses a folded pane without removing the rest of the reading trail', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  const scrollTo = vi.fn()
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: scrollTo })

  const relatedFiles = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(relatedFiles).getByRole('button', { name: /第二篇笔记/u }))
  await user.click(screen.getByRole('button', { name: '展开第一篇笔记' }))

  expect(document.querySelector('[data-wiki-pane="note-second"]')).not.toBeNull()
  await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ left: 460, behavior: 'smooth' }))
})

test('focuses a previously opened linked pane without changing the reading trail', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  const scrollTo = vi.fn()
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: scrollTo })
  const firstRelations = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(firstRelations).getByRole('button', { name: /第二篇笔记/u }))
  const secondRelations = screen.getByRole('navigation', { name: '第二篇笔记的关联文件' })
  await user.click(within(secondRelations).getByRole('button', { name: /第三篇笔记/u }))

  await user.click(screen.getByRole('button', { name: '展开第一篇笔记' }))
  await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ left: 460, behavior: 'smooth' }))
  const callsBeforeReopen = scrollTo.mock.calls.length
  await user.click(within(firstRelations).getByRole('button', { name: /第三篇笔记/u }))

  const panes = [...document.querySelectorAll<HTMLElement>('[data-wiki-pane]')]
  expect(panes.map((pane) => pane.dataset.wikiPane)).toEqual(['note-first', 'note-second', 'note-third'])
  await waitFor(() => {
    expect(scrollTo.mock.calls.length).toBe(callsBeforeReopen + 1)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1288, behavior: 'smooth' })
  })
})

test('starts a new branch only when an earlier pane opens a new linked file', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: vi.fn() })
  const firstRelations = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(firstRelations).getByRole('button', { name: /第二篇笔记/u }))
  const secondRelations = screen.getByRole('navigation', { name: '第二篇笔记的关联文件' })
  await user.click(within(secondRelations).getByRole('button', { name: /第三篇笔记/u }))

  await user.click(screen.getByRole('button', { name: '展开第一篇笔记' }))
  await user.click(within(firstRelations).getByRole('button', { name: /第四篇笔记/u }))

  const panes = [...document.querySelectorAll<HTMLElement>('[data-wiki-pane]')]
  expect(panes.map((pane) => pane.dataset.wikiPane)).toEqual(['note-first', 'note-fourth'])
})

test('reindexes the reading trail when a page disappears from the knowledge snapshot', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  const scrollTo = vi.fn()
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: scrollTo })
  const firstRelations = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(firstRelations).getByRole('button', { name: /第二篇笔记/u }))
  const secondRelations = screen.getByRole('navigation', { name: '第二篇笔记的关联文件' })
  await user.click(within(secondRelations).getByRole('button', { name: /第三篇笔记/u }))

  act(() => {
    mutatePersonalKnowledge(
      (current) => ({
        ...current,
        pages: current.pages.filter((page) => page.refId !== 'note-second'),
        links: current.links.filter((link) => link.from !== 'note-second' && link.to !== 'note-second'),
      }),
      async () => undefined,
    )
  })

  const thirdPane = await waitFor(() => {
    const pane = document.querySelector<HTMLElement>('[data-wiki-pane="note-third"]')
    expect(pane?.style.left).toBe('46px')
    return pane!
  })
  const callsBeforeReveal = scrollTo.mock.calls.length
  await user.click(within(thirdPane).getByRole('button', { name: '展开第三篇笔记' }))

  await waitFor(() => {
    expect(scrollTo.mock.calls.length).toBe(callsBeforeReveal + 1)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 874, behavior: 'smooth' })
  })
})

test('keeps the reading trail when switching between knowledge views', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  expect(document.querySelector('[data-wiki-pane="note-first"]')).not.toBeNull()

  await user.click(screen.getByRole('button', { name: '知识库' }))
  await user.click(screen.getByRole('menuitemradio', { name: /浏览视图/u }))
  await waitFor(() => expect(document.querySelector('[data-wiki-scroll-viewport]')).toBeNull())

  await enterStackView(user)
  expect(document.querySelector('[data-wiki-pane="note-first"]')).not.toBeNull()
  expect(screen.getByRole('button', { name: '展开起点索引' })).toBeTruthy()
  expect(window.localStorage.getItem('agentarbor:knowledge-view')).toBe('stack')
})

test('uses the open document as the first pane when changing to stack view', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId="note-second" onSelect={() => undefined} />)

  await enterStackView(user)

  expect(document.querySelector('[data-wiki-pane="note-second"]')).not.toBeNull()
  expect(screen.getByRole('button', { name: '展开起点索引' })).toBeTruthy()
})

test('keeps the start picker underneath the first pane and reveals it from the path', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  expect(document.querySelector('[data-wiki-start-picker]')).not.toBeNull()
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  const scrollTo = vi.fn()
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: scrollTo })

  const knowledgeNav = screen.getByRole('navigation', { name: '知识库导航' })
  await user.click(within(knowledgeNav).getByRole('button', { name: '起点索引' }))

  // 滚动通过 requestAnimationFrame 调度,等待动画帧执行后再断言。
  await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' }))
  expect(document.querySelector('[data-wiki-pane="note-first"]')).not.toBeNull()
})

test('updates the active path only after horizontal scrolling settles', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  await enterStackView(user)
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const firstRelations = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(firstRelations).getByRole('button', { name: /第二篇笔记/u }))
  const secondRelations = screen.getByRole('navigation', { name: '第二篇笔记的关联文件' })
  await user.click(within(secondRelations).getByRole('button', { name: /第三篇笔记/u }))

  const knowledgeNav = screen.getByRole('navigation', { name: '知识库导航' })
  const firstPath = within(knowledgeNav).getByRole('button', { name: '第一篇笔记' })
  const thirdPath = within(knowledgeNav).getByRole('button', { name: '第三篇笔记' })
  expect(thirdPath.getAttribute('aria-current')).toBe('page')

  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')!
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 460 })
  fireEvent.scroll(viewport)

  expect(thirdPath.getAttribute('aria-current')).toBe('page')
  await waitFor(() => expect(firstPath.getAttribute('aria-current')).toBe('page'))
})

test('keeps Recent on the same title + count + grid contract as All', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  // 默认落点「最近」与「全部」共用同一展示契约:标题(名称 + 计数)+ 卡片网格。
  expect(screen.getByRole('heading', { name: '最近4' })).toBeTruthy()
  expect(screen.queryByText('继续看')).toBeNull()
  expect(screen.queryByText('最近收藏')).toBeNull()

  await user.click(screen.getByRole('button', { name: /^全部/u }))
  expect(screen.getByRole('heading', { name: '全部4' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: '最近' }))
  expect(screen.getByRole('heading', { name: '最近4' })).toBeTruthy()
})

test('orders Recent by the most recent activity, including reopened old collections', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  // 打开最旧的收藏(第一篇笔记,收藏时间 1):它应成为「最近」网格里最靠前的卡片。
  await user.click(screen.getByRole('heading', { name: '第一篇笔记' }))

  const cardTitles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
  expect(cardTitles[0]).toBe('第一篇笔记')
  expect(cardTitles).toEqual(['第一篇笔记', '第四篇笔记', '第三篇笔记', '第二篇笔记'])
})

test('keeps managed PDF cards typed before and after preview warmup', async () => {
  resetPersonalKnowledgeForTesting({
    pages: [{
      refId: 'managed-pdf-card',
      kind: 'space_reference',
      collectedAt: Date.now(),
      asset: {
        status: 'managed',
        title: 'PyTorch 入门笔记.pdf',
        sourceLabel: 'C:/资料/PyTorch 入门笔记.pdf',
        contentKind: 'file',
      },
    }],
  })

  render(<BrainPage selectedId={null} onSelect={() => undefined} />)

  expect(screen.getByText('PDF')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'PyTorch 入门笔记.pdf' })).toBeTruthy()
  expect(document.querySelector('.aa-pdf-document__thumbnail')).not.toBeNull()

  primeReferencePreviewCache([{
    itemId: 'managed-pdf-card',
    title: 'PyTorch 入门笔记.pdf',
    sourceKind: 'local_file',
    source: 'managed/managed-pdf-card/content',
    status: 'ready',
    fingerprint: 'managed-pdf-card-v1',
    presentation: { kind: 'pdf', editable: false, sourceMode: false },
    content: { kind: 'pages', pages: ['PDF 正文不应成为卡片封面。'] },
  }], '/api/personal-knowledge/assets')

  expect(await screen.findByText('PDF 正文不应成为卡片封面。')).toBeTruthy()
})
