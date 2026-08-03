import { useEffect, useState, type CSSProperties } from 'react'
import { shouldUseMotion } from '../../../../app-motion'

const AMBIENT_COPY_REVEALED_KEY = 'agentarbor:home-ambient-copy-revealed'
const AMBIENT_COPY_REVEAL_VERSION = 'soft-reveal-v3'
const SEGMENT_START_DELAY_MS = 80
const SEGMENT_STAGGER_MS = 140

interface HomeAmbientCopyProps {
  copy: string
}

export function HomeAmbientCopy({ copy }: HomeAmbientCopyProps) {
  const [animate] = useState(shouldAnimateCopy)
  const segments = segmentCopy(copy)

  useEffect(() => {
    if (!animate) return
    window.sessionStorage.setItem(AMBIENT_COPY_REVEALED_KEY, AMBIENT_COPY_REVEAL_VERSION)
  }, [animate])

  return (
    <p className="aa-agent-home__ambient" aria-label={copy}>
      <span className="aa-agent-home__ambient-reserve" aria-hidden="true">
        <AmbientSegments segments={segments} />
      </span>
      <span
        className={`aa-agent-home__ambient-copy${animate ? ' aa-agent-home__ambient-copy--entering' : ''}`}
        aria-hidden="true"
      >
        <AmbientSegments segments={segments} animate />
      </span>
    </p>
  )
}

function AmbientSegments(props: {
  readonly segments: readonly string[]
  readonly animate?: boolean
}) {
  return props.segments.map((segment, index) => (
    <span
      className="aa-agent-home__ambient-segment"
      key={`${segment}:${index}`}
      style={props.animate ? {
        '--aa-ambient-delay': `${SEGMENT_START_DELAY_MS + index * SEGMENT_STAGGER_MS}ms`,
      } as CSSProperties : undefined}
    >
      {segment}
    </span>
  ))
}

function shouldAnimateCopy(): boolean {
  if (typeof window === 'undefined' || !shouldUseMotion()) return false
  return window.sessionStorage.getItem(AMBIENT_COPY_REVEALED_KEY) !== AMBIENT_COPY_REVEAL_VERSION
}

function segmentCopy(copy: string): readonly string[] {
  return copy.split(/(?<=[，。；：！？])(?=[^，。；：！？])/u)
}
