import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { resetPersonalKnowledgeForTesting } from './personalKnowledgeClient'
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

function note(id: string, title: string): Note {
  return { id, spaceId: 'space-one', title, bodyMarkdown: '', revision: 1, createdAt: 1, updatedAt: 1 }
}
