import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { ChatInputProps } from '../../../../components/chat-empty'
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

  return (
    <div className="aa-agent-home">
      <section className="aa-agent-home__stage" aria-label="开始任务">
        <div className="aa-agent-home__field">
          <HomeAmbientCopy copy={ambientCopy} />

          <div className="aa-agent-home__composer">
            <ConversationComposer key={focusRequest} input={input} />
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

function workspaceLabel(path: string | undefined): string {
  if (path === undefined) return '选择工作区'
  const normalized = path.replace(/[\\/]+$/u, '')
  return normalized.split(/[\\/]/u).at(-1) || path
}
