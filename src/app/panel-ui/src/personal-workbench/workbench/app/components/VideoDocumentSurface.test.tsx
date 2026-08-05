import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { VideoDocumentSurface } from './VideoDocumentSurface'

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})

test('renders frames through an sRGB canvas and owns the playback controls', async () => {
  const user = userEvent.setup()
  const drawImage = vi.fn()
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  const rendered = render(<VideoDocumentSurface url="/video.mp4" title="演示视频" duration="2:00" />)
  const video = rendered.container.querySelector('video')
  const canvas = screen.getByRole('img', { name: '演示视频 画面' })
  const player = rendered.container.querySelector<HTMLElement>('.aa-video-document__player')
  expect(video).not.toBeNull()
  expect(player).not.toBeNull()
  expect(video!.hasAttribute('controls')).toBe(false)
  expect(video!.getAttribute('aria-hidden')).toBe('true')
  expect(video!.getAttribute('preload')).toBe('auto')
  expect(screen.getByRole('group', { name: '视频播放控件' })).toBeTruthy()
  expect(screen.getByRole('status', { name: '正在加载视频' }).textContent).toContain('正在准备视频预览')
  expect(screen.getByText('演示视频')).toBeTruthy()

  let paused = true
  let ended = false
  let currentTime = 0
  let volume = 1
  let muted = false
  Object.defineProperties(video!, {
    videoWidth: { configurable: true, value: 2560 },
    videoHeight: { configurable: true, value: 1440 },
    duration: { configurable: true, value: 120 },
    paused: { configurable: true, get: () => paused },
    ended: { configurable: true, get: () => ended },
    currentTime: { configurable: true, get: () => currentTime, set: (value: number) => { currentTime = value } },
    volume: { configurable: true, get: () => volume, set: (value: number) => { volume = value } },
    muted: { configurable: true, get: () => muted, set: (value: boolean) => { muted = value } },
  })
  const play = vi.spyOn(video!, 'play').mockImplementation(async () => { paused = false })
  const pause = vi.spyOn(video!, 'pause').mockImplementation(() => { paused = true })

  fireEvent.loadedMetadata(video!)
  fireEvent.loadedData(video!)
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('ready')
  expect(canvas).toBeTruthy()
  expect(getContext).toHaveBeenCalledWith('2d', expect.objectContaining({ colorSpace: 'srgb' }))
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 2560, 1440)
  expect(screen.getByText('0:00 / 2:00')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: '播放' }))
  expect(play).toHaveBeenCalledOnce()
  fireEvent.play(video!)
  await user.click(screen.getByRole('button', { name: '暂停' }))
  expect(pause).toHaveBeenCalledOnce()
  fireEvent.pause(video!)

  fireEvent.change(screen.getByRole('slider', { name: '播放进度' }), { target: { value: '30' } })
  expect(currentTime).toBe(30)
  fireEvent.change(screen.getByRole('slider', { name: '音量' }), { target: { value: '0.4' } })
  expect(volume).toBe(0.4)
  await user.click(screen.getByRole('button', { name: '静音' }))
  expect(muted).toBe(true)

  let fullscreenElement: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
  const requestFullscreen = vi.fn(async () => {
    fullscreenElement = player
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  Object.defineProperty(player!, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  await user.click(screen.getByRole('button', { name: '全屏' }))
  expect(requestFullscreen).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '退出全屏' })).toBeTruthy()
})

test('shows an available poster immediately without a loading surface', () => {
  const rendered = render(
    <VideoDocumentSurface
      url="/warmed-video.mp4"
      title="已预热视频"
      poster="data:image/jpeg;base64,warmed-frame"
    />,
  )

  expect(screen.queryByRole('status', { name: '正在加载视频' })).toBeNull()
  expect(screen.queryByText('正在准备视频预览')).toBeNull()
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('poster')
  expect(rendered.container.querySelector<HTMLImageElement>('.aa-video-document__poster')?.src).toContain('data:image/jpeg;base64,warmed-frame')
})

test('keeps a cancelled first-frame callback from overriding an error', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  const rendered = render(<VideoDocumentSurface url="/broken.mp4" title="损坏视频" />)
  const video = rendered.container.querySelector('video')
  let firstFrameCallback: (() => void) | undefined
  const cancelVideoFrameCallback = vi.fn()
  Object.defineProperties(video!, {
    videoWidth: { configurable: true, value: 0 },
    videoHeight: { configurable: true, value: 0 },
    requestVideoFrameCallback: { configurable: true, value: vi.fn((callback: () => void) => { firstFrameCallback = callback; return 7 }) },
    cancelVideoFrameCallback: { configurable: true, value: cancelVideoFrameCallback },
  })

  fireEvent.loadedData(video!)
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('loading')
  fireEvent.error(video!)
  expect(cancelVideoFrameCallback).toHaveBeenCalledWith(7)
  act(() => firstFrameCallback?.())
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('error')
})

test('ignores a cancelled first-frame callback after the media URL changes', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  const rendered = render(<VideoDocumentSurface url="/first.mp4" title="切换视频" />)
  const video = rendered.container.querySelector('video')
  const callbacks: Array<() => void> = []
  let frameReady = false
  Object.defineProperties(video!, {
    videoWidth: { configurable: true, get: () => frameReady ? 1920 : 0 },
    videoHeight: { configurable: true, get: () => frameReady ? 1080 : 0 },
    requestVideoFrameCallback: { configurable: true, value: vi.fn((callback: () => void) => { callbacks.push(callback); return 7 }) },
    cancelVideoFrameCallback: { configurable: true, value: vi.fn() },
  })

  fireEvent.loadedData(video!)
  rendered.rerender(<VideoDocumentSurface url="/second.mp4" title="切换视频" />)
  fireEvent.loadedData(video!)
  act(() => callbacks[0]?.())
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('loading')
  frameReady = true
  act(() => callbacks[1]?.())
  expect(rendered.container.querySelector('.aa-video-document')?.getAttribute('data-state')).toBe('ready')
})
