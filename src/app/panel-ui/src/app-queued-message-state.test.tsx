import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useAppQueuedMessages, type QueuedMessageDispatchRun } from './app-queued-message-state'

test('automatically sends the first queued message after the current run settles', async () => {
  const setGoal = vi.fn()
  const startTask = vi.fn().mockResolvedValue(undefined)
  const running: QueuedMessageDispatchRun = { runId: 'run-1', status: 'running', requiresUserAction: false }
  const completed: QueuedMessageDispatchRun = { runId: 'run-1', status: 'completed', requiresUserAction: false }
  const hook = renderHook(
    ({ busy, currentRun }: { busy: boolean; currentRun: QueuedMessageDispatchRun }) => useAppQueuedMessages({
      busy,
      currentRun,
      setGoal,
      startTask,
    }),
    { initialProps: { busy: true, currentRun: running } },
  )

  act(() => hook.result.current.enqueueMessage('继续补充边界条件'))
  expect(startTask).not.toHaveBeenCalled()

  hook.rerender({ busy: false, currentRun: completed })
  await waitFor(() => expect(startTask).toHaveBeenCalledWith('继续补充边界条件'))
  expect(setGoal).toHaveBeenCalledWith('继续补充边界条件')
  expect(hook.result.current.queuedMessages).toEqual([])
})

test('does not dispatch a queued message when the run still needs user action', async () => {
  const startTask = vi.fn().mockResolvedValue(undefined)
  const hook = renderHook(() => useAppQueuedMessages({
    busy: false,
    currentRun: { runId: 'run-approval', status: 'completed', requiresUserAction: true },
    setGoal: vi.fn(),
    startTask,
  }))

  act(() => hook.result.current.enqueueMessage('继续'))
  await Promise.resolve()
  expect(startTask).not.toHaveBeenCalled()
  expect(hook.result.current.queuedMessages).toHaveLength(1)
})
