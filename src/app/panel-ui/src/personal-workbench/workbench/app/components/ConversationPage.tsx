import { type ReactNode } from 'react'
import { Maximize2, X } from 'lucide-react'
import type { ChatInputProps } from '../../../../contracts/composer'
import { ConversationComposer } from './ConversationComposer'
import { ConversationScrollArea } from './ConversationScrollArea'
import { GUTTER, HEADER_H } from './tokens'
import './conversation-page.css'

export type LiveConversationState = 'initial' | 'working' | 'attention' | 'completed' | 'failed'

export interface ConversationPageProps {
  readonly title: string
  readonly state: LiveConversationState
  readonly scrollKey: string
  readonly content?: ReactNode
  readonly input: ChatInputProps
  readonly onFocus?: () => void
}

export function ConversationPage(props: ConversationPageProps) {
  const status = liveStatusLabel(props.state)
  return (
    <section className="flex min-h-0 flex-1 overflow-hidden" aria-label="对话工作台" role="region">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="aa-conversation-header flex shrink-0 items-center justify-between"
          style={{ height: HEADER_H, paddingLeft: GUTTER, paddingRight: GUTTER }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-[13px] font-normal" style={{ color: 'var(--aa-text-2)' }}>
              {props.title}
            </h2>
            {status !== undefined && (
              <span
                className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                style={{ background: status.background, color: status.color }}
              >
                {status.icon}
                {status.label}
              </span>
            )}
          </div>
          {props.onFocus !== undefined && (
            <button
              type="button"
              onClick={props.onFocus}
              title="专注阅读"
              aria-label="专注阅读"
              className="rounded p-1.5 hover:bg-black/5"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>

        <ConversationScrollArea
          scrollKey={props.scrollKey}
          contentClassName="aa-conversation-transcript reading-prose mx-auto px-6 pb-24 pt-5"
        >
          {props.content}
        </ConversationScrollArea>

        <div className="shrink-0 px-6 pb-5">
          <div className="mx-auto" style={{ maxWidth: 'var(--reading-width)' }}>
            <ConversationComposer input={props.input} />
          </div>
        </div>
      </div>
    </section>
  )
}

function liveStatusLabel(state: LiveConversationState): { readonly label: string; readonly icon: ReactNode; readonly color: string; readonly background: string } | undefined {
  switch (state) {
    case 'working':
      return {
        label: '处理中',
        icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor', animation: 'pulse 1.5s infinite' }} />,
        color: 'var(--aa-accent)',
        background: 'rgba(104,101,167,0.1)',
      }
    case 'attention':
      return { label: '需要确认', icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />, color: 'var(--aa-status-wait)', background: 'rgba(212,144,32,0.1)' }
    case 'failed':
      return { label: '未完成', icon: <X size={11} />, color: 'var(--aa-status-error)', background: 'rgba(200,64,64,0.1)' }
    case 'completed':
    case 'initial':
      return undefined
  }
}
