import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { PersonalSpaceProjection } from '../../../space'
import { refreshDocumentPreview } from './referencePreviewClient'
import { useMountedTree } from './useMountedTree'

vi.mock('./referencePreviewClient', () => ({
  refreshDocumentPreview: vi.fn(),
}))

const refreshPreview = vi.mocked(refreshDocumentPreview)

describe('useMountedTree', () => {
  beforeEach(() => {
    refreshPreview.mockReset()
  })

  test('discards a directory response from the previously selected Space', async () => {
    const first = deferred<ReturnType<typeof directoryPreview>>()
    refreshPreview
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(directoryPreview('new.md'))

    const { result, rerender } = renderHook(
      ({ spaceId, space }) => useMountedTree({ spaceId, space }),
      { initialProps: { spaceId: 'space-a', space: mountedSpace('space-a') } },
    )

    rerender({ spaceId: 'space-b', space: mountedSpace('space-b') })
    await waitFor(() => expect(result.current.tree[0]?.children?.[0]?.name).toBe('new.md'))

    await act(async () => {
      first.resolve(directoryPreview('old.md'))
      await first.promise
    })

    expect(result.current.tree[0]?.children?.[0]?.name).toBe('new.md')
    expect(result.current.tree.some((item) => item.children?.some((child) => child.name === 'old.md'))).toBe(false)
  })

  test('keeps existing directory entries visible while a refresh is pending', async () => {
    const refresh = deferred<ReturnType<typeof directoryPreview>>()
    refreshPreview
      .mockResolvedValueOnce(directoryPreview('before.md'))
      .mockImplementationOnce(() => refresh.promise)

    const { result } = renderHook(() => useMountedTree({ spaceId: 'space-a', space: mountedSpace('space-a') }))
    await waitFor(() => expect(result.current.tree[0]?.children?.[0]?.name).toBe('before.md'))

    let pending!: Promise<void>
    act(() => {
      pending = result.current.refreshByReference('shared-reference', '')
    })
    expect(result.current.tree[0]?.children?.[0]?.name).toBe('before.md')

    await act(async () => {
      refresh.resolve(directoryPreview('after.md'))
      await pending
    })
    expect(result.current.tree[0]?.children?.[0]?.name).toBe('after.md')
  })

  test('preserves the managed-folder kind for children of a nested mount', async () => {
    refreshPreview.mockResolvedValueOnce(directoryPreview('inside', 'directory'))
    const space: PersonalSpaceProjection = {
      spaceId: 'space-a',
      title: 'space-a',
      itemCount: 2,
      items: [{
        itemId: 'group',
        title: '分组',
        kind: 'folder',
        children: [{
          itemId: 'shared-reference',
          referenceId: 'shared-reference',
          title: '托管文件',
          kind: 'managed_folder',
        }],
      }],
    }

    const { result } = renderHook(() => useMountedTree({ spaceId: 'space-a', space }))
    act(() => result.current.expandItem(result.current.tree[0]!.children![0]!))
    await waitFor(() => expect(result.current.tree[0]?.children?.[0]?.children?.[0]?.name).toBe('inside'))

    expect(result.current.tree[0]?.children?.[0]?.children?.[0]?.domainKind).toBe('managed_folder')
  })

  test('carries the unavailable status through to the rendered tree', () => {
    const space: PersonalSpaceProjection = {
      spaceId: 'space-a',
      title: 'space-a',
      itemCount: 2,
      items: [
        { itemId: 'here', referenceId: 'here', title: '在的文件', kind: 'local_file' },
        { itemId: 'gone', referenceId: 'gone', title: '失联文件', kind: 'local_file', status: 'unavailable' },
      ],
    }

    const { result } = renderHook(() => useMountedTree({ spaceId: 'space-a', space }))

    expect(result.current.tree[0]?.status).toBeUndefined()
    expect(result.current.tree[1]?.status).toBe('unavailable')
  })
})

function mountedSpace(spaceId: string): PersonalSpaceProjection {
  return {
    spaceId,
    title: spaceId,
    itemCount: 1,
    items: [{
      itemId: 'shared-reference',
      referenceId: 'shared-reference',
      title: '项目文件',
      kind: 'workspace_folder',
    }],
  }
}

function directoryPreview(name: string, kind: 'file' | 'directory' = 'file') {
  return {
    itemId: 'shared-reference',
    title: '项目文件',
    sourceKind: 'workspace_folder' as const,
    source: 'C:/workspace',
    status: 'ready' as const,
    presentation: { kind: 'directory' as const, editable: false, sourceMode: false },
    content: {
      kind: 'directory' as const,
      relativePath: '',
      entries: [{ name, relativePath: name, kind }],
      truncated: false,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
