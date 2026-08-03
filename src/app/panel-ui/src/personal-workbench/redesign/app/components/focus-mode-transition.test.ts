import { beforeEach, expect, test, vi } from 'vitest'
import { shouldUseMotion } from '../../../../app-motion'
import { runFocusModeTransition } from './focus-mode-transition'

vi.mock('../../../../app-motion', () => ({
  shouldUseMotion: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(shouldUseMotion).mockReturnValue(true)
})

test('keeps long transcript movement horizontal when focus mode exits', () => {
  const root = document.createElement('div')
  const main = element('aa-workbench-main', rect(235, 44, 1205, 856))
  const surface = element('aa-conversation-surface', rect(0, 0, 1440, 900))
  const content = element('aa-conversation-scroll-content', rect(340, -15000, 760, 16618))
  const composer = element('aa-conversation-composer-frame', rect(340, 760, 760, 116))
  const header = element('aa-focus-header', rect(0, 0, 1440, 44))
  const body = element('conversation-body', rect(0, 44, 1440, 856))
  body.append(content, composer)
  surface.append(header, body)
  root.append(main, surface)
  const update = vi.fn()

  runFocusModeTransition({ root, direction: 'exit', update })

  expect(content.animate).toHaveBeenCalledWith(
    [
      { transform: 'translate(0px, 0px)' },
      { transform: 'translate(117.5px, 0px)' },
    ],
    expect.objectContaining({ duration: 320 }),
  )
  expect(composer.animate).toHaveBeenCalledWith(
    [
      { transform: 'translate(0px, 0px)' },
      { transform: 'translate(117.5px, 0px)' },
    ],
    expect.objectContaining({ duration: 320 }),
  )
})

test('cancels a stale transition without clearing the replacement state', () => {
  const root = transitionRoot()
  const firstUpdate = vi.fn()
  const secondUpdate = vi.fn()

  runFocusModeTransition({ root, direction: 'exit', update: firstUpdate })
  const replacement = runFocusModeTransition({ root, direction: 'exit', update: secondUpdate })

  expect(root.dataset.focusTransition).toBe('exit')
  expect(firstUpdate).not.toHaveBeenCalled()

  replacement.cancel()

  expect(root.dataset.focusTransition).toBeUndefined()
  expect(secondUpdate).not.toHaveBeenCalled()
})

test('updates immediately when reduced motion is active', () => {
  vi.mocked(shouldUseMotion).mockReturnValue(false)
  const root = transitionRoot()
  const update = vi.fn()

  const handle = runFocusModeTransition({ root, direction: 'enter', update })

  expect(update).toHaveBeenCalledOnce()
  expect(root.dataset.focusTransition).toBeUndefined()
  handle.cancel()
})

test('commits exit and clears the transition marker after the animation budget', () => {
  vi.useFakeTimers()
  try {
    const root = transitionRoot()
    const update = vi.fn()

    runFocusModeTransition({ root, direction: 'exit', update })
    vi.advanceTimersByTime(360)

    expect(update).toHaveBeenCalledOnce()
    expect(root.dataset.focusTransition).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

function element(className: string, bounds: DOMRect): HTMLElement {
  const node = document.createElement('div')
  node.className = className
  node.getBoundingClientRect = () => bounds
  Object.defineProperty(node, 'animate', {
    configurable: true,
    value: vi.fn(() => ({
      finished: new Promise<void>(() => undefined),
      cancel: vi.fn(),
    }) as unknown as Animation),
  })
  return node
}

function transitionRoot(): HTMLElement {
  const root = document.createElement('div')
  const main = element('aa-workbench-main', rect(235, 44, 1205, 856))
  const surface = element('aa-conversation-surface', rect(0, 0, 1440, 900))
  const content = element('aa-conversation-scroll-content', rect(340, 100, 760, 1600))
  const composer = element('aa-conversation-composer-frame', rect(340, 760, 760, 116))
  surface.append(content, composer)
  root.append(main, surface)
  return root
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}
