import { useState } from 'react'
import { Layers, MessageSquare } from 'lucide-react'
import type { ChatInputProps } from '../../../../contracts/composer'
import type { ConversationSummary } from '../../../../contracts/conversation'
import type { PersonalWorkspaceProjection } from '../../../workspace'
import { type View } from './Sidebar'
import { ConversationComposer } from './ConversationComposer'
import { HomeAmbientCopy } from './HomeAmbientCopy'
import { selectHomeAmbientCopy } from './home-ambient-copy'
import './home-page.css'

export type HomeOwnerSelection = { readonly kind: 'space' | 'workspace'; readonly id: string }

interface HomePageProps {
  onNavigate: (view: View) => void
  onOpenConversation: (conversationId: string) => boolean | Promise<boolean>
  conversations: readonly ConversationSummary[]
  spaces?: readonly { readonly spaceId: string; readonly title: string }[]
  workspaces?: readonly PersonalWorkspaceProjection[]
  ownerSelection?: HomeOwnerSelection | null
  onOwnerChange?: (owner: HomeOwnerSelection | null) => void
  activeSpaceId?: string | null
  onActiveSpaceChange?: (spaceId: string | null) => void
  input: ChatInputProps
  focusRequest: number
}

const RECENT_CONVERSATION_LIMIT = 8

export function HomePage({
  onOpenConversation,
  conversations,
  spaces = [],
  workspaces = [],
  ownerSelection = null,
  onOwnerChange,
  input,
  focusRequest,
}: HomePageProps) {
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

  const spaceTitle = (spaceId: string): string =>
    spaces.find((space) => space.spaceId === spaceId)?.title ?? '空间'
  const workspaceTitle = (workspaceId: string): string =>
    workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.title ?? '工作区'

  const recentConversations = [...conversations]
    .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt))
    .slice(0, RECENT_CONVERSATION_LIMIT)

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

          <div className="aa-agent-home__context">
            <label className="aa-agent-home__space">
              <Layers size={13} strokeWidth={1.8} aria-hidden="true" />
              <select
                aria-label="对话空间"
                value={ownerSelection === null ? '' : `${ownerSelection.kind}:${ownerSelection.id}`}
                onChange={(event) => {
                  const [kind, id] = event.target.value.split(':')
                  if (kind === 'space' || kind === 'workspace') onOwnerChange?.({ kind, id })
                  else onOwnerChange?.(null)
                }}
              >
                {spaces.length === 0 && workspaces.length === 0 && <option value="">请选择空间</option>}
                {spaces.length > 0 && <optgroup label="空间">
                  {spaces.map((space) => (
                    <option key={`space:${space.spaceId}`} value={`space:${space.spaceId}`}>{space.title}</option>
                  ))}
                </optgroup>}
                {workspaces.length > 0 && <optgroup label="工作区">
                  {workspaces.map((workspace) => (
                    <option key={`workspace:${workspace.workspaceId}`} value={`workspace:${workspace.workspaceId}`}>{workspace.title}</option>
                  ))}
                </optgroup>}
              </select>
            </label>
          </div>
        </div>

        {recentConversations.length > 0 && (
          <RecentConversations
            conversations={recentConversations}
            spaceTitle={spaceTitle}
            workspaceTitle={workspaceTitle}
            onOpenConversation={onOpenConversation}
          />
        )}
      </section>
    </div>
  )
}

function RecentConversations(props: {
  readonly conversations: readonly ConversationSummary[]
  readonly spaceTitle: (spaceId: string) => string
  readonly workspaceTitle: (workspaceId: string) => string
  readonly onOpenConversation: (conversationId: string) => boolean | Promise<boolean>
}) {
  return (
    <div className="aa-agent-home__recent" aria-label="最近对话">
      <div className="aa-agent-home__recent-header">
        <MessageSquare size={12} aria-hidden="true" />
        <span>最近对话</span>
      </div>
      <ul className="aa-agent-home__recent-list">
        {props.conversations.map((conversation) => {
          const ownerLabel = conversation.owner === undefined
            ? undefined
            : conversation.owner.kind === 'space'
              ? `空间 · ${props.spaceTitle(conversation.owner.id)}`
              : `工作区 · ${props.workspaceTitle(conversation.owner.id)}`
          return (
            <li key={conversation.conversationId}>
              <button
                type="button"
                className="aa-agent-home__recent-row"
                onClick={() => void props.onOpenConversation(conversation.conversationId)}
              >
                <span className="aa-agent-home__recent-title">{conversation.title}</span>
                {ownerLabel !== undefined && (
                  <span className="aa-agent-home__recent-owner">{ownerLabel}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
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

function timestampValue(value: string | undefined): number {
  if (value === undefined) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}
