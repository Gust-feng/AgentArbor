import { waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import {
  clearVideoPreviewRuntimeForTesting,
  getWarmedVideoPoster,
  subscribeVideoPreviewPoster,
  warmVideoPreview,
} from './videoPreviewRuntime'

afterEach(() => {
  vi.restoreAllMocks()
  clearVideoPreviewRuntimeForTesting()
})

test('captures and publishes a bounded poster from the first decoded video frame', async () => {
  const createElement = document.createElement.bind(document)
  const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  const video = createElement('video')
  const play = vi.spyOn(video, 'play').mockResolvedValue(undefined)
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined)
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 0 },
    currentTime: { configurable: true, writable: true, value: 0 },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  })
  Object.defineProperty(video, 'load', {
    configurable: true,
    value: vi.fn(() => {
      queueMicrotask(() => {
        video.dispatchEvent(new Event('loadedmetadata'))
        video.dispatchEvent(new Event('loadeddata'))
      })
    }),
  })
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,first-frame'),
  } as unknown as HTMLCanvasElement
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName === 'video') return video
    if (tagName === 'canvas') return canvas
    return createElement(tagName)
  }) as unknown as typeof document.createElement)
  const changed = vi.fn()
  const unsubscribe = subscribeVideoPreviewPoster(changed)

  warmVideoPreview('/api/spaces/references/video-one/content', undefined, 'v1')

  await waitFor(() => expect(getWarmedVideoPoster('/api/spaces/references/video-one/content', 'v1')).toBe('data:image/jpeg;base64,first-frame'))
  expect(getWarmedVideoPoster('/api/spaces/references/video-one/content', 'v2')).toBeUndefined()
  expect(video.preload).toBe('auto')
  expect(video.muted).toBe(true)
  expect(video.playsInline).toBe(true)
  expect(play).toHaveBeenCalledOnce()
  expect(pause).toHaveBeenCalled()
  expect(video.isConnected).toBe(false)
  expect(canvas.width).toBe(960)
  expect(canvas.height).toBe(540)
  expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 960, 540)
  expect(changed).toHaveBeenCalledOnce()
  unsubscribe()
})
