import { afterEach, expect, test, vi } from 'vitest'

import {
  clearImagePreviewRuntimeForTesting,
  getWarmedImageUrl,
  warmImagePreview,
} from './imagePreviewRuntime'

afterEach(() => {
  clearImagePreviewRuntimeForTesting()
  vi.unstubAllGlobals()
})

test('publishes a fingerprinted object URL only after the image is decoded', async () => {
  let finishDecode: (() => void) | undefined
  const createObjectURL = vi.fn(() => 'blob:warmed-image')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['image']))))
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  vi.stubGlobal('Image', class {
    decoding = ''
    src = ''
    decode = vi.fn(() => new Promise<void>((resolve) => { finishDecode = resolve }))
  })

  const warm = warmImagePreview('/image.jpg', 'v1', 5)
  await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce())
  expect(getWarmedImageUrl('/image.jpg', 'v1')).toBeUndefined()

  finishDecode?.()
  await warm
  expect(getWarmedImageUrl('/image.jpg', 'v1')).toBe('blob:warmed-image')
  expect(getWarmedImageUrl('/image.jpg', 'v2')).toBeUndefined()
})

test('deduplicates a warmed version and reloads a new fingerprint', async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(['image'])))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn()
      .mockReturnValueOnce('blob:image-v1')
      .mockReturnValueOnce('blob:image-v2'),
    revokeObjectURL: vi.fn(),
  })
  vi.stubGlobal('Image', class {
    decoding = ''
    src = ''
    async decode() {}
  })

  await warmImagePreview('/image.jpg', 'v1', 5)
  await warmImagePreview('/image.jpg', 'v1', 5)
  await warmImagePreview('/image.jpg', 'v2', 5)

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(getWarmedImageUrl('/image.jpg', 'v1')).toBe('blob:image-v1')
  expect(getWarmedImageUrl('/image.jpg', 'v2')).toBe('blob:image-v2')
})
