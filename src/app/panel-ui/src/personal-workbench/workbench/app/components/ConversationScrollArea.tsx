import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'

const BOTTOM_THRESHOLD_PX = 48

export function ConversationScrollArea(props: {
  readonly scrollKey: string
  readonly contentClassName: string
  readonly children?: ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followLatestRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const measurePosition = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
    const atBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX
    followLatestRef.current = atBottom
    setShowJumpToLatest(!atBottom)
  }, [])

  const jumpToLatest = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    followLatestRef.current = true
    viewport.scrollTop = viewport.scrollHeight
    setShowJumpToLatest(false)
  }, [])

  useLayoutEffect(() => {
    followLatestRef.current = true
    setShowJumpToLatest(false)
    const frame = requestAnimationFrame(jumpToLatest)
    return () => cancelAnimationFrame(frame)
  }, [jumpToLatest, props.scrollKey])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (viewport === null || content === null) return

    const handleResize = () => {
      if (followLatestRef.current) {
        viewport.scrollTop = viewport.scrollHeight
        setShowJumpToLatest(false)
        return
      }
      measurePosition()
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(handleResize)
    observer?.observe(content)
    observer?.observe(viewport)
    viewport.addEventListener('scroll', measurePosition, { passive: true })

    return () => {
      observer?.disconnect()
      viewport.removeEventListener('scroll', measurePosition)
    }
  }, [measurePosition])

  return (
    <div className="aa-conversation-scroll-shell relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        className="aa-conversation-scroll-viewport h-full overflow-y-auto"
        data-conversation-scroll="viewport"
      >
        <div
          ref={contentRef}
          className={`aa-conversation-scroll-content ${props.contentClassName}`}
          style={{ maxWidth: 'var(--reading-width)' }}
        >
          {props.children}
        </div>
      </div>
      {showJumpToLatest && (
        <button
          type="button"
          className="aa-conversation-jump-to-latest"
          onClick={jumpToLatest}
          aria-label="跳到最新回答"
        >
          <ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
