import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ActionConfirmationDialog } from './ActionConfirmationDialog'

test('presents the action, consequence, and explicit controls inside the workbench', () => {
  render(
    <ActionConfirmationDialog
      request={{
        eyebrow: '空间操作',
        title: '删除空间“项目空间”',
        description: '空间内的引用将被移除。',
        consequence: '原文件、文件夹和对话不会被删除。',
        confirmLabel: '删除空间',
      }}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  )

  expect(screen.getByRole('alertdialog', { name: '删除空间“项目空间”' })).toBeTruthy()
  expect(screen.getByText('空间内的引用将被移除。')).toBeTruthy()
  expect(screen.getByText('原文件、文件夹和对话不会被删除。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除空间' })).toBeTruthy()
  expect(screen.queryByText('AgentArbor')).toBeNull()
})

test('supports Escape cancellation and does not confirm before the primary action', () => {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <ActionConfirmationDialog
      request={{
        eyebrow: '空间资料',
        title: '删除“报告.md”',
        description: '这会从磁盘上删除该文件。',
        consequence: '此操作不可撤销。',
        confirmLabel: '删除文件',
      }}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )

  expect(onConfirm).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledOnce()

  fireEvent.click(screen.getByRole('button', { name: '删除文件' }))
  expect(onConfirm).toHaveBeenCalledOnce()
})