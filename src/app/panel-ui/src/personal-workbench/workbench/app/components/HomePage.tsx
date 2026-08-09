import { useState } from 'react'
import type { ChatInputProps } from '../../../../contracts/composer'
import type { PersonalWorkspaceProjection } from '../../../workspace'
import { ConversationComposer } from './ConversationComposer'
import { HomeAmbientCopy } from './HomeAmbientCopy'
import { selectHomeAmbientCopy } from './home-ambient-copy'
import { HomeBackdrop } from './HomeBackdrop'
import { type HomeOwnerSelection, HomeOwnerPicker } from './HomeOwnerPicker'
import './home-page.css'

interface HomePageProps {
  spaces?: readonly { readonly spaceId: string; readonly title: string }[]
  workspaces?: readonly PersonalWorkspaceProjection[]
  ownerSelection?: HomeOwnerSelection | null
  onOwnerChange?: (owner: HomeOwnerSelection | null) => void
  input: ChatInputProps
  focusRequest: number
}

export function HomePage({
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
            <HomeOwnerPicker
              spaces={spaces}
              workspaces={workspaces}
              value={ownerSelection}
              onChange={(owner) => onOwnerChange?.(owner)}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
