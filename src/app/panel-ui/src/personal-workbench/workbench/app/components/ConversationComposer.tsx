import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, Send, X } from 'lucide-react'
import type { ChatInputProps } from '../../../../contracts/composer'
import { ModelOptionPicker } from '../../../../components/model-option-picker'
import { RADII, composerSurface } from './tokens'
import { QueuedMessageList } from './QueuedMessageList'

export function ConversationComposer({ input }: { readonly input: ChatInputProps }) {
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const canEdit = !input.busy || input.allowInputWhileBusy === true
  const canSend = input.value.trim().length > 0 && canEdit

  useEffect(() => {
    const textarea = ref.current
    if (textarea === null) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [input.value])

  useEffect(() => {
    if (input.autoFocus === true) ref.current?.focus()
  }, [input.autoFocus])

  const submit = (): void => {
    if (canSend) input.onSubmit()
  }

  return (
    <div className="aa-conversation-composer" style={composerSurface(focused)}>
      {input.queuedMessages !== undefined && input.queuedMessages.length > 0 && (
        <QueuedMessageList
          messages={input.queuedMessages}
          onRemove={input.onRemoveQueuedMessage ?? (() => undefined)}
          onUpdate={input.onUpdateQueuedMessage ?? (() => undefined)}
        />
      )}
      {input.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {input.attachments.map((attachment) => (
            <span
              key={attachment.attachmentId}
              className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
              style={{ background: 'var(--aa-surface-hover)', color: 'var(--aa-text-2)' }}
            >
              <FileText size={11} className="shrink-0" />
              <span className="truncate">{attachment.title}</span>
              <button
                type="button"
                onClick={() => input.onRemoveAttachment(attachment.attachmentId)}
                className="shrink-0 hover:opacity-70"
                aria-label={`移除${attachment.title}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={input.value}
        onChange={(event) => input.onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={input.placeholder ?? (input.running ? '运行中，继续输入会在完成后发送…' : '继续对话…')}
        rows={2}
        disabled={!canEdit}
        className="aa-conversation-composer__input w-full resize-none px-4 pt-3 outline-none disabled:cursor-not-allowed"
        style={{ color: 'var(--aa-text-1)', background: 'transparent', lineHeight: 1.65 }}
      />
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={input.onSelectAttachment}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-3)' }}
          >
            <FileText size={11} />
            添加引用
          </button>
          <span className="h-3 w-px shrink-0" style={{ background: 'var(--aa-border)' }} aria-hidden="true" />
          <ComposerModelSelect input={input} />
          {input.contextUsage !== undefined && <ComposerContextUsage usage={input.contextUsage} />}
          {input.reasoningEffortEnabled && <ComposerReasoningSelect input={input} />}
        </div>
        <div className="flex items-center gap-2">
          {input.running && input.onCancel !== undefined && (
            <button
              type="button"
              onClick={input.onCancel}
              className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(200,64,64,0.1)', color: 'var(--aa-status-error)' }}
            >
              {input.cancelLabel ?? '停止'}
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="发送"
            className="flex h-7 w-7 items-center justify-center transition-all disabled:cursor-not-allowed"
            style={{
              borderRadius: RADII.md,
              background: canSend ? 'var(--aa-accent)' : 'rgba(45,40,34,0.06)',
              color: canSend ? '#fff' : 'var(--aa-text-3)',
              transform: canSend ? 'scale(1)' : 'scale(0.9)',
            }}
          >
            <Send size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function ComposerModelSelect({ input }: { readonly input: ChatInputProps }) {
  return (
    <ModelOptionPicker
      options={input.models}
      selectedId={input.selectedModelId}
      onSelect={input.onModelSelect}
      emptyLabel="配置模型"
      onEmptyAction={input.onOpenSettings}
      ariaLabel="选择模型"
      variant="composer"
      placement="top"
    />
  )
}

function ComposerContextUsage({ usage }: { readonly usage: NonNullable<ChatInputProps['contextUsage']> }) {
  const percent = usage.percent ?? usage.ringPercent
  const warning = percent > 80
  const progress = Math.min(100, Math.max(0, usage.ringPercent))
  return (
    <div
      className="hidden min-w-24 max-w-28 shrink items-center gap-1.5 sm:flex"
      title={usage.label}
      role="progressbar"
      aria-label={usage.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usage.percent === undefined ? undefined : Math.round(percent)}
    >
      <span className="aa-conversation-composer__meta truncate" style={{ color: warning ? 'var(--aa-status-wait)' : 'var(--aa-text-3)' }}>
        {usage.percent === undefined ? '上下文 --' : `上下文 ${Math.round(percent)}%`}
      </span>
      <span className="h-1 min-w-8 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--aa-surface-hover)' }}>
        <span
          className="block h-full rounded-full transition-[width,background-color] duration-200"
          style={{ width: `${progress}%`, background: warning ? 'var(--aa-status-wait)' : 'var(--aa-accent)' }}
        />
      </span>
    </div>
  )
}

function ComposerReasoningSelect({ input }: { readonly input: ChatInputProps }) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">推理力度</span>
      <select
        aria-label="推理力度"
        value={input.reasoningEffort}
        onChange={(event) => input.onReasoningEffortChange(event.target.value as ChatInputProps['reasoningEffort'])}
        className="h-6 appearance-none rounded-md bg-transparent py-0 pl-2 pr-6 text-[11px] outline-none transition-colors hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--aa-accent)]"
        style={{ color: 'var(--aa-text-2)' }}
      >
        <option value="">自动</option>
        <option value="low">轻量</option>
        <option value="medium">标准</option>
        <option value="high">深入</option>
      </select>
      <ChevronDown size={10} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--aa-text-3)' }} aria-hidden="true" />
    </label>
  )
}
