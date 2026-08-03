import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { QueuedChatMessage } from '../../../../contracts/composer'
import { QueuedMessageList } from './QueuedMessageList'

test('shows queued messages and supports edit and recall', () => {
  const messages: readonly QueuedChatMessage[] = [
    { id: 'queued-1', content: '先整理这份报告' },
    { id: 'queued-2', content: '再给出一个简短结论' },
  ]
  const onRemove = vi.fn()
  const onUpdate = vi.fn()

  render(<QueuedMessageList messages={messages} onRemove={onRemove} onUpdate={onUpdate} />)

  expect(screen.getByRole('list', { name: '待发送消息队列' })).toBeTruthy()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)

  fireEvent.click(screen.getAllByRole('button', { name: '编辑待发送消息' })[0]!)
  const editor = screen.getByRole('textbox', { name: '编辑待发送消息' })
  fireEvent.change(editor, { target: { value: '整理并标注这份报告' } })
  fireEvent.click(screen.getByRole('button', { name: '保存待发送消息' }))

  expect(onUpdate).toHaveBeenCalledWith('queued-1', '整理并标注这份报告')

  fireEvent.click(screen.getAllByRole('button', { name: '撤回待发送消息' })[1]!)
  expect(onRemove).toHaveBeenCalledWith('queued-2')
})
