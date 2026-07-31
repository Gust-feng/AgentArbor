import React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { BrainPage } from './BrainPage'
import { mutatePersonalKnowledge, resetPersonalKnowledgeForTesting } from './personalKnowledgeClient'

beforeEach(() => {
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

test('keeps related files outside the document scroll area', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} spaces={[]} onOpenSpaceReference={() => undefined} />)

  await user.click(screen.getByRole('button', { name: /知识库.*顺着链接逛/u }))
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))

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
  render(<BrainPage selectedId={null} onSelect={() => undefined} spaces={[]} onOpenSpaceReference={() => undefined} />)

  await user.click(screen.getByRole('button', { name: /知识库.*顺着链接逛/u }))
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
  expect(scrollTo).toHaveBeenCalledWith({ left: 414, behavior: 'smooth' })
})

test('focuses a folded pane without removing the rest of the reading trail', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} spaces={[]} onOpenSpaceReference={() => undefined} />)

  await user.click(screen.getByRole('button', { name: /知识库.*顺着链接逛/u }))
  await user.click(screen.getByRole('button', { name: /第一篇笔记/u }))
  const viewport = document.querySelector<HTMLElement>('[data-wiki-scroll-viewport]')
  const scrollTo = vi.fn()
  expect(viewport).not.toBeNull()
  Object.defineProperty(viewport!, 'scrollTo', { configurable: true, value: scrollTo })

  const relatedFiles = screen.getByRole('navigation', { name: '第一篇笔记的关联文件' })
  await user.click(within(relatedFiles).getByRole('button', { name: /第二篇笔记/u }))
  await user.click(screen.getByRole('button', { name: '展开第一篇笔记' }))

  expect(document.querySelector('[data-wiki-pane="note-second"]')).not.toBeNull()
  await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' }))
})

test('focuses a previously opened linked pane without changing the reading trail', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} spaces={[]} onOpenSpaceReference={() => undefined} />)

  await user.click(screen.getByRole('button', { name: /知识库.*顺着链接逛/u }))
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
  await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' }))
  const callsBeforeReopen = scrollTo.mock.calls.length
  await user.click(within(firstRelations).getByRole('button', { name: /第三篇笔记/u }))

  const panes = [...document.querySelectorAll<HTMLElement>('[data-wiki-pane]')]
  expect(panes.map((pane) => pane.dataset.wikiPane)).toEqual(['note-first', 'note-second', 'note-third'])
  await waitFor(() => {
    expect(scrollTo.mock.calls.length).toBe(callsBeforeReopen + 1)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 828, behavior: 'smooth' })
  })
})

test('starts a new branch only when an earlier pane opens a new linked file', async () => {
  const user = userEvent.setup()
  render(<BrainPage selectedId={null} onSelect={() => undefined} spaces={[]} onOpenSpaceReference={() => undefined} />)

  await user.click(screen.getByRole('button', { name: /知识库.*顺着链接逛/u }))
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
  render(<BrainPage selectedId={null} onSelect={() => undefined} spaces={[]} onOpenSpaceReference={() => undefined} />)

  await user.click(screen.getByRole('button', { name: /知识库.*顺着链接逛/u }))
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
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 414, behavior: 'smooth' })
  })
})
