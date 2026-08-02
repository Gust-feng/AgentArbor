import { type ReactNode } from 'react'
import { Minimize2 } from 'lucide-react'
import type { LiveConversationState } from './ConversationPage'
import { ConversationScrollArea } from './ConversationScrollArea'

export interface FocusModeProps {
  readonly title: string
  readonly state: LiveConversationState
  readonly scrollKey: string
  readonly content?: ReactNode
  readonly composer: ReactNode
  readonly onExit: () => void
}

export function FocusMode(props: FocusModeProps) {
  const status = focusStatus(props.state)

  return (
    <section
      className="fixed inset-0 z-50 flex h-screen flex-col overflow-hidden"
      style={{ background: 'var(--aa-canvas)', fontFamily: '"Noto Sans SC", Inter, system-ui, sans-serif' }}
      aria-label="专注阅读"
    >
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ height: 44, borderBottom: '1px solid var(--aa-border)', paddingLeft: 24, paddingRight: 16 }}
      >
        <span className="truncate text-sm font-medium" style={{ color: 'var(--aa-text-2)' }}>
          {props.title}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {status !== undefined && (
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: status.color }}>
              {status.icon}
              {status.label}
            </span>
          )}
          <button
            type="button"
            onClick={props.onExit}
            className="ml-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/5"
            style={{ background: 'var(--aa-surface-hover)', color: 'var(--aa-text-1)' }}
          >
            <Minimize2 size={11} />
            退出专注
          </button>
        </div>
      </div>

      <ConversationScrollArea
        scrollKey={props.scrollKey}
        contentClassName="aa-conversation-transcript reading-prose mx-auto px-6 py-10"
      >
        {props.content}
      </ConversationScrollArea>

      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto" style={{ maxWidth: 'var(--reading-width)' }}>
          {props.composer}
        </div>
      </div>
    </section>
  )
}

function focusStatus(state: LiveConversationState): { readonly label: string; readonly color: string; readonly icon: ReactNode } | undefined {
  if (state === 'working') {
    return {
      label: '处理中',
      color: 'var(--aa-accent)',
      icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor', animation: 'pulse 1.5s infinite' }} />,
    }
  }
  if (state === 'attention') {
    return { label: '需要确认', color: 'var(--aa-status-wait)', icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} /> }
  }
  if (state === 'failed') {
    return { label: '未完成', color: 'var(--aa-status-error)', icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} /> }
  }
  return undefined
}
