import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { PersonalSpaceProjection } from '../../../space'
import { ApiError } from '../../../../api'
import { refreshDocumentPreview } from './referencePreviewClient'
import { projectSpaceItem, useMountedTree } from './useMountedTree'

const previewCache = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  preview: undefined as { presentation: { kind: 'web' } } | undefined,
  version: 0,
}))

vi.mock('./referencePreviewClient', () => ({
  getCachedReferencePreview: vi.fn(() => previewCache.preview),
  getReferencePreviewCacheVersion: vi.fn(() => previewCache.version),
  invalidateDocumentPreviews: vi.fn(),
  refreshDocumentPreview: vi.fn(),
  subscribeReferencePreviewCache: vi.fn((listener: () => void) => {
    previewCache.listeners.add(listener)
    return () => previewCache.listeners.delete(listener)
  }),
}))

const refreshPreview = vi.mocked(refreshDocumentPreview)

describe('useMountedTree', () => {
  beforeEach(() => {
    refreshPreview.mockReset()
    previewCache.listeners.clear()
    previewCache.preview = undefined
    previewCache.version = 0
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

  test('drops a removed reference silently instead of reporting a load error', async () => {
    // 用户取消引用后、树投影刷新前的窗口：目录加载会命中 404
    // space_reference_not_found。这是投影收敛中的正常事实，不是操作失败。
    const onError = vi.fn()
    const space = mountedSpace('space-a')
    refreshPreview.mockRejectedValueOnce(new ApiError(404, 'space_reference_not_found', '未找到空间引用。'))

    const { result } = renderHook(() => useMountedTree({ spaceId: 'space-a', space, onError }))
    await waitFor(() => expect(refreshPreview).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.directories.size).toBe(0))

    expect(onError).not.toHaveBeenCalled()
  })

  test('still reports other directory load failures through onError', async () => {
    const onError = vi.fn()
    const space = mountedSpace('space-a')
    refreshPreview.mockRejectedValueOnce(new Error('磁盘读取失败。'))

    const { result } = renderHook(() => useMountedTree({ spaceId: 'space-a', space, onError }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('磁盘读取失败。'))

    expect([...result.current.directories.values()][0]?.status).toBe('error')
  })

  test('uses the preview presentation to distinguish web assets from document assets', () => {
    const asset = {
      itemId: 'course-home',
      referenceId: 'course-home',
      assetId: 'course-home',
      title: '课程主页',
      kind: 'workbench_asset' as const,
    }

    expect(projectSpaceItem(asset, () => 'web')?.type).toBe('web')
    expect(projectSpaceItem(asset, () => 'pdf')?.type).toBe('file')
  })

  test('updates a mounted asset icon type when preview warmup identifies a web page', () => {
    const space: PersonalSpaceProjection = {
      spaceId: 'space-a',
      title: 'space-a',
      items: [{
        itemId: 'course-home',
        referenceId: 'course-home',
        assetId: 'course-home',
        title: '课程主页',
        kind: 'workbench_asset',
      }],
    }
    const { result } = renderHook(() => useMountedTree({ spaceId: 'space-a', space }))
    expect(result.current.tree[0]?.type).toBe('file')

    act(() => {
      previewCache.preview = { presentation: { kind: 'web' } }
      previewCache.version += 1
      previewCache.listeners.forEach((listener) => listener())
    })

    expect(result.current.tree[0]?.type).toBe('web')
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