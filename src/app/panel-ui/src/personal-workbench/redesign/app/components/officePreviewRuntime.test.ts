import { afterEach, expect, test, vi } from 'vitest'

import { loadOfficeDocument } from './officePreviewRuntime'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('keys the bounded Office binary cache by source fingerprint', async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(['office'])))
  vi.stubGlobal('fetch', fetchMock)
  const url = `/versioned-${crypto.randomUUID()}.docx`

  await loadOfficeDocument({ url, byteLength: 6, sourceVersion: 'v1', signal: new AbortController().signal })
  await loadOfficeDocument({ url, byteLength: 6, sourceVersion: 'v1', signal: new AbortController().signal })
  await loadOfficeDocument({ url, byteLength: 6, sourceVersion: 'v2', signal: new AbortController().signal })

  expect(fetchMock).toHaveBeenCalledTimes(2)
})
