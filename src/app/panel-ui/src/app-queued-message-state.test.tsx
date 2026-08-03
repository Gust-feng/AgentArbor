import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useAppQueuedMessages, type QueuedMessageDispatchRun } from './app-queued-message-state'

test('automatically sends the first queued message after the current run settles', async () => {
  const startTask = vi.fn().mockResolvedValue(true)
  const running: QueuedMessageDispatchRun = { runId: 'run-1', status: 'running', requiresUserAction: false }
  const completed: QueuedMessageDispatchRun = { runId: 'run-1', status: 'completed', requiresUserAction: false }
  const hook = renderHook(
    ({ busy, currentRun }: { busy: boolean; currentRun: QueuedMessageDispatchRun }) => useAppQueuedMessages({
      busy,
      queueScopeId: 'conversation-1',
      currentRun,
      startTask,
    }),
    { initialProps: { busy: true, currentRun: running } },
  )

  act(() => hook.result.current.enqueueMessage('继续补充边界条件'))
  expect(startTask).not.toHaveBeenCalled()

  hook.rerender({ busy: false, currentRun: completed })
  await waitFor(() => expect(startTask).toHaveBeenCalledWith('继续补充边界条件'))
  await waitFor(() => expect(hook.result.current.queuedMessages).toEqual([]))
})

test('does not dispatch a queued message when the run still needs user action', async () => {
  const startTask = vi.fn().mockResolvedValue(true)
  const hook = renderHook(() => useAppQueuedMessages({
    busy: false,
    queueScopeId: 'conversation-1',
    currentRun: { runId: 'run-approval', status: 'completed', requiresUserAction: true },
    startTask,
  }))

  act(() => hook.result.current.enqueueMessage('继续'))
  await Promise.resolve()
  expect(startTask).not.toHaveBeenCalled()
  expect(hook.result.current.queuedMessages).toHaveLength(1)
})

test('guides a selected queued message once for the active run', async () => {
  const startTask = vi.fn().mockResolvedValue(true)
  const hook = renderHook(() => useAppQueuedMessages({
    busy: true,
    queueScopeId: 'conversation-1',
    currentRun: { runId: 'run-active', status: 'running', requiresUserAction: false },
    startTask,
  }))

  act(() => {
    hook.result.current.enqueueMessage('先保留这个')
    hook.result.current.enqueueMessage('优先引导这个')
  })
  const guidedId = hook.result.current.queuedMessages[1]?.id
  expect(guidedId).toBeDefined()

  await act(async () => {
    await expect(hook.result.current.guideQueuedMessage(guidedId!)).resolves.toBe(true)
  })

  expect(startTask).toHaveBeenCalledWith('优先引导这个')
  expect(hook.result.current.queuedMessages.map((message) => message.content)).toEqual(['先保留这个'])
  await expect(hook.result.current.guideQueuedMessage(hook.result.current.queuedMessages[0]!.id)).resolves.toBe(false)
})

test('clears local messages when the active conversation changes', async () => {
  const startTask = vi.fn().mockResolvedValue(true)
  const hook = renderHook(
    ({ queueScopeId }: { queueScopeId: string }) => useAppQueuedMessages({
      busy: true,
      queueScopeId,
      currentRun: { runId: 'run-active', status: 'running', requiresUserAction: false },
      startTask,
    }),
    { initialProps: { queueScopeId: 'conversation-1' } },
  )

  act(() => hook.result.current.enqueueMessage('不要带到另一段对话'))
  hook.rerender({ queueScopeId: 'conversation-2' })

  await waitFor(() => expect(hook.result.current.queuedMessages).toEqual([]))
  expect(startTask).not.toHaveBeenCalled()
})

test('removes a guided item while submitting and restores it on failure', async () => {
  let resolveStart: (accepted: boolean) => void = () => undefined
  const startTask = vi.fn(() => new Promise<boolean>((resolve) => {
    resolveStart = resolve
  }))
  const hook = renderHook(() => useAppQueuedMessages({
    busy: true,
    queueScopeId: 'conversation-1',
    currentRun: { runId: 'run-active', status: 'running', requiresUserAction: false },
    startTask,
  }))

  act(() => hook.result.current.enqueueMessage('等待提交结果'))
  const messageId = hook.result.current.queuedMessages[0]!.id
  let guidePromise: Promise<boolean> | undefined
  act(() => {
    guidePromise = hook.result.current.guideQueuedMessage(messageId)
  })
  await waitFor(() => expect(hook.result.current.queuedMessages).toEqual([]))

  act(() => resolveStart(false))
  await expect(guidePromise).resolves.toBe(false)
  await waitFor(() => expect(hook.result.current.queuedMessages.map((message) => message.content)).toEqual(['等待提交结果']))
})
