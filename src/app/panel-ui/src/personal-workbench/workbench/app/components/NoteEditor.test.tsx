import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { resetPersonalKnowledgeForTesting, setPersonalKnowledgePersistenceEnabled } from './personalKnowledgeClient'
import { NoteEditor } from './NoteEditor'
import type { Note } from './notesStore'

beforeEach(() => resetPersonalKnowledgeForTesting())

test('flushes the previous note and saves later input against the newly selected note', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const rendered = render(<NoteEditor note={note('note-one', '第一篇')} onSave={onSave} />)

  const firstTitle = screen.getByPlaceholderText('无标题')
  await user.clear(firstTitle)
  await user.type(firstTitle, '第一篇修改')
  rendered.rerender(<NoteEditor note={note('note-two', '第二篇')} onSave={onSave} />)

  await waitFor(() => expect((screen.getByPlaceholderText('无标题') as HTMLInputElement).value).toBe('第二篇'))
  const secondTitle = screen.getByPlaceholderText('无标题')
  await user.clear(secondTitle)
  await user.type(secondTitle, '第二篇修改')

  await waitFor(() => {
    expect(onSave).toHaveBeenCalledWith('note-one', { title: '第一篇修改' })
    expect(onSave).toHaveBeenCalledWith('note-two', { title: '第二篇修改' })
  }, { timeout: 2_000 })
})

test('checks an opened note when its authoritative revision changes without reporting a local save as external', async () => {
  const user = userEvent.setup()
  let remote = note('note-one', '第一篇')
  const fetchMock = vi.fn(async (path: string | URL | Request) => {
    if (String(path).endsWith('/revisions?limit=1')) {
      return jsonResponse({ revisions: [{ noteId: remote.id, revision: remote.revision, operation: 'update', title: remote.title, bodyMarkdown: remote.bodyMarkdown, actor: { kind: 'user' }, createdAt: remote.updatedAt }] })
    }
    return jsonResponse({ note: remote })
  })
  vi.stubGlobal('fetch', fetchMock)
  setPersonalKnowledgePersistenceEnabled(true)

  const rendered = render(<NoteEditor note={remote} onSave={vi.fn()} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

  const title = screen.getByLabelText('笔记名称')
  await user.clear(title)
  await user.type(title, '第一篇修改')
  remote = note('note-one', '第一篇修改', 2)
  rendered.rerender(<NoteEditor note={remote} onSave={vi.fn()} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

  await user.clear(title)
  await user.type(title, '继续写但尚未保存')
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
  expect(screen.queryByText('其他窗口更新了这篇笔记')).toBeNull()
})

function note(id: string, title: string, revision = 1): Note {
  return { id, spaceId: 'space-one', title, bodyMarkdown: '', revision, createdAt: 1, updatedAt: revision }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response
}
