import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { ChatInputProps } from '../../../../contracts/composer'
import type { ConversationSummary } from '../../../../contracts/conversation'
import { type View } from './Sidebar'
import { ConversationComposer } from './ConversationComposer'
import { HomeAmbientCopy } from './HomeAmbientCopy'
import { selectHomeAmbientCopy } from './home-ambient-copy'
import './home-page.css'

interface HomePageProps {
  onNavigate: (view: View) => void
  onOpenConversation: (conversationId: string) => boolean | Promise<boolean>
  conversations: readonly ConversationSummary[]
  input: ChatInputProps
  focusRequest: number
}

export function HomePage({ input, focusRequest }: HomePageProps) {
  const [ambientCopy] = useState(() => selectHomeAmbientCopy())
  const [compositionBaseValue, setCompositionBaseValue] = useState<string | null>(null)
  const ambientDraftValue = compositionBaseValue ?? input.value
  const hasDraft = ambientDraftValue.trim().length > 0
  const homeInput = input.contextUsage === undefined
    ? input
    : { ...input, contextUsage: undefined }

  const handleCompositionChange = (composing: boolean): void => {
    setCompositionBaseValue(composing ? input.value : null)
  }

  return (
    <div className="aa-agent-home">
      <HomeBackdrop />
      <section className="aa-agent-home__stage" aria-label="开始任务">
        <div className="aa-agent-home__field">
          <HomeAmbientCopy copy={ambientCopy} hasDraft={hasDraft} />

          <div className="aa-agent-home__composer">
            <ConversationComposer
              key={focusRequest}
              input={homeInput}
              onCompositionChange={handleCompositionChange}
            />
          </div>

          {input.onSelectWorkspaceDirectory !== undefined && (
            <div className="aa-agent-home__context">
              <button
                type="button"
                className="aa-agent-home__workspace"
                onClick={input.onSelectWorkspaceDirectory}
                aria-label={input.selectedWorkspaceDirectory === undefined
                  ? '选择工作区'
                  : `切换工作区：${input.selectedWorkspaceDirectory}`}
              >
                <FolderOpen size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>{workspaceLabel(input.selectedWorkspaceDirectory)}</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * Keeps the former home visual language as a background layer while the task
 * entry surface remains owned by the current home layout.
 */
function HomeBackdrop() {
  const width = 1440
  const height = 900

  return (
    <div className="aa-agent-home__backdrop" aria-hidden="true">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMax slice"
        width="100%"
        height="100%"
        focusable="false"
      >
        <defs>
          <linearGradient id="aa-home-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#efeaf6" />
            <stop offset="0.34" stopColor="#f1edf4" />
            <stop offset="0.64" stopColor="#f4f1ee" />
            <stop offset="1" stopColor="#f4f2ef" />
          </linearGradient>
          <radialGradient id="aa-home-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#faf0e2" />
            <stop offset="0.42" stopColor="#f7ecdd" stopOpacity="0.9" />
            <stop offset="1" stopColor="#f7ecdd" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={width} height={height} fill="url(#aa-home-sky)" />
        <circle cx="1090" cy="250" r="240" fill="url(#aa-home-sun)" />
        <circle cx="1090" cy="250" r="52" fill="#f8efdb" />
        <rect x="0" y="392" width={width} height="120" fill="rgba(104,101,167,0.04)" />

        <g
          fill="none"
          stroke="rgba(110,103,132,0.45)"
          strokeLinecap="round"
          strokeWidth="2.4"
        >
          <path d="M732 84 q15 -13 30 0 q15 -13 30 0" />
          <path d="M806 116 q11 -9 22 0 q11 -9 22 0" />
          <path d="M696 138 q8 -7 16 0 q8 -7 16 0" />
        </g>

        <path
          d="M0 486 C240 430 420 448 620 424 C840 398 1060 424 1240 408 C1340 399 1410 410 1440 404 L1440 900 L0 900 Z"
          fill="rgba(104,101,167,0.08)"
        />
        <path
          d="M0 566 C220 512 400 528 600 506 C820 482 1020 512 1220 496 C1330 487 1400 506 1440 498 L1440 900 L0 900 Z"
          fill="rgba(122,150,124,0.12)"
        />
        <path
          d="M0 650 C200 602 380 626 580 612 C800 597 1020 628 1220 616 C1330 609 1400 628 1440 620 L1440 900 L0 900 Z"
          fill="rgba(96,116,100,0.16)"
        />
      </svg>
    </div>
  )
}

function workspaceLabel(path: string | undefined): string {
  if (path === undefined) return '选择工作区'
  const normalized = path.replace(/[\\/]+$/u, '')
  return normalized.split(/[\\/]/u).at(-1) || path
}
