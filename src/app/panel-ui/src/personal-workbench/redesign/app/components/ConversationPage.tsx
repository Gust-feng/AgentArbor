import { useState, useEffect, useRef, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Send,
  Maximize2,
  MoreHorizontal,
  Wrench,
  Check,
  FileText,
  Search,
  Database,
  Copy,
  RotateCcw,
} from 'lucide-react'
import { Sparkles, X, ArrowUp, BookOpen, Compass, Zap, PenLine } from 'lucide-react'
import { motion } from 'motion/react'
import { type View } from './Sidebar'
import { RADII, GUTTER, HEADER_H, contentCard, composerSurface } from './tokens'
import { type RunStep } from './RunPanel'
import type { ChatInputProps } from '../../../../components/chat-empty'

type ConvStatus = 'active' | 'done' | 'new' | 'empty'

interface ConversationPageProps {
  status?: ConvStatus
  onNavigate?: (v: View) => void
  initialMessage?: string
  /**
   * Production data enters through this narrow view contract. The surrounding
   * conversation page remains the prototype's original visual composition.
   */
  live?: LiveConversationPageProps
}

export type LiveConversationState = 'initial' | 'working' | 'attention' | 'completed' | 'failed'

export interface LiveConversationPageProps {
  readonly title: string
  readonly state: LiveConversationState
  readonly hasContent: boolean
  readonly content?: ReactNode
  readonly activity?: ReactNode
  readonly input: ChatInputProps
  readonly error?: string
  readonly onFocus?: () => void
}

/* ─── types ─── */
interface ToolItem {
  id: string
  name: string
  icon: React.ReactNode
  status: 'done' | 'running' | 'pending'
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolItems?: ToolItem[]
  toolRunning?: boolean
  generating?: boolean
}

/* ─── markdown renderer ─── */
function inlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*([^*]+)\*\*/)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ color: 'var(--aa-text-1)', fontWeight: 600 }}>
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

function renderMd(content: string) {
  const paras = content.split('\n\n').filter(Boolean)
  return paras.map((para, pi) => {
    const lines = para.split('\n').filter(Boolean)
    if (lines.every((l) => l.startsWith('- ') || l.startsWith('   - '))) {
      return (
        <div key={pi} className="mb-3 space-y-1.5">
          {lines.map((l, li) => {
            const indent = l.startsWith('   - ')
            return (
              <div key={li} className="flex gap-2 text-sm" style={{ paddingLeft: indent ? 16 : 0 }}>
                <span className="mt-1 shrink-0" style={{ color: 'var(--aa-text-3)', fontSize: 10 }}>●</span>
                <span style={{ lineHeight: 1.75 }}>{inlineBold(l.slice(indent ? 5 : 2))}</span>
              </div>
            )
          })}
        </div>
      )
    }
    const firstLine = lines[0]
    if (firstLine.startsWith('**') && firstLine.endsWith('**') && lines.length === 1) {
      return (
        <p key={pi} className="mt-4 mb-1.5 font-semibold text-sm" style={{ color: 'var(--aa-text-1)' }}>
          {firstLine.slice(2, -2)}
        </p>
      )
    }
    return (
      <p key={pi} className="mb-3 text-sm" style={{ lineHeight: 1.85, color: 'var(--aa-text-1)' }}>
        {lines.flatMap((l, li) => [
          li > 0 ? <br key={`br-${li}`} /> : null,
          ...inlineBold(l),
        ])}
      </p>
    )
  })
}

/* ─── tool activity ─── */
function ToolActivity({ items, running }: { items: ToolItem[]; running: boolean }) {
  const [open, setOpen] = useState(false)
  const doneCount = items.filter((i) => i.status === 'done').length

  return (
    <div className="mb-3 overflow-hidden" style={{ ...contentCard, borderRadius: RADII.md }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left"
      >
        <Wrench size={11} style={{ color: 'var(--aa-text-3)' }} />
        <span style={{ color: 'var(--aa-text-2)' }}>工具调用</span>
        <span
          className="ml-1 font-medium"
          style={{ color: running ? 'var(--aa-accent)' : 'var(--aa-status-done)' }}
        >
          {running ? `${doneCount}/${items.length} 进行中` : `${items.length} 已完成`}
        </span>
        {running && (
          <span
            className="ml-1 w-1.5 h-1.5 rounded-full inline-block"
            style={{ background: 'var(--aa-accent)', animation: 'pulse 1.2s infinite' }}
          />
        )}
        <span className="ml-auto" style={{ color: 'var(--aa-text-3)' }}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-2" style={{ borderTop: '1px solid var(--aa-border)' }}>
          <div className="pt-2 space-y-1.5">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--aa-text-2)' }}>
                {item.status === 'done' ? (
                  <Check size={10} style={{ color: 'var(--aa-status-done)', flexShrink: 0 }} />
                ) : item.status === 'running' ? (
                  <div
                    className="w-2.5 h-2.5 rounded-full border-[1.5px] border-t-transparent animate-spin shrink-0"
                    style={{ borderColor: 'var(--aa-accent)', borderTopColor: 'transparent' }}
                  />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full border-[1.5px] shrink-0" style={{ borderColor: 'var(--aa-text-3)' }} />
                )}
                <span className="shrink-0" style={{ color: 'var(--aa-text-3)', lineHeight: 0 }}>{item.icon}</span>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── typing indicator ─── */
function TypingIndicator() {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-1.5 py-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: 'var(--aa-accent)',
              opacity: 0.5,
              animation: `thinkingDot 1.2s ${i * 0.18}s infinite`,
            }}
          />
        ))}
        <style>{`
          @keyframes thinkingDot {
            0%, 80%, 100% { transform: scale(0.7); opacity: 0.3; }
            40% { transform: scale(1); opacity: 0.75; }
          }
        `}</style>
      </div>
    </div>
  )
}

/* ─── message bubbles ─── */
function UserMsg({ content }: { content: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex justify-end mb-5 group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-col items-end gap-1.5" style={{ maxWidth: 520 }}>
        <div
          className="px-4 py-3 text-sm"
          style={{
            ...contentCard,
            background: '#ffffff',
            color: 'var(--aa-text-1)',
            lineHeight: 1.75,
          }}
        >
          {content}
        </div>
        {/* Hover action row */}
        <div
          className="flex items-center gap-1 transition-opacity"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <button
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-3)' }}
          >
            <RotateCcw size={10} />
            重新编辑
          </button>
        </div>
      </div>
    </div>
  )
}

function AssistantMsg({
  content,
  toolItems,
  toolRunning,
  generating,
  streamCursor,
}: {
  content: string
  toolItems?: ToolItem[]
  toolRunning?: boolean
  generating?: boolean
  streamCursor?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      className="mb-7 group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {toolItems && toolItems.length > 0 && (
        <ToolActivity items={toolItems} running={toolRunning ?? false} />
      )}
      <div className="text-sm reading-prose" style={{ color: 'var(--aa-text-1)' }}>
        {renderMd(content)}
        {(generating || streamCursor) && (
          <span
            className="inline-block w-[2px] h-[1em] rounded-sm ml-0.5"
            style={{
              background: 'var(--aa-accent)',
              verticalAlign: 'text-bottom',
              animation: 'blink 0.75s step-end infinite',
            }}
          />
        )}
        <style>{`
          @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        `}</style>
      </div>
      {/* Hover action row */}
      {!generating && !streamCursor && content.length > 0 && (
        <div
          className="flex items-center gap-1 mt-2 transition-opacity"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-3)' }}
          >
            {copied ? <Check size={10} style={{ color: 'var(--aa-status-done)' }} /> : <Copy size={10} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── composer ─── */
function Composer({
  disabled,
  disabledLabel,
  running,
  placeholder,
  onSend,
}: {
  disabled?: boolean
  disabledLabel?: string
  /** 运行中：输入框保持可用，发送的消息会排队，完成后自动发出。 */
  running?: boolean
  placeholder?: string
  onSend: (text: string) => void
}) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const t = value.trim()
    if (!t || disabled) return
    onSend(t)
    setValue('')
    if (ref.current) {
      ref.current.style.height = 'auto'
    }
  }

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + 'px'
    }
  }, [value])

  if (disabled) {
    return (
      <div
        className="px-4 py-3 text-sm flex items-center gap-2.5"
        style={{ color: 'var(--aa-text-3)', ...composerSurface(false), background: 'var(--aa-surface)' }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: 'var(--aa-accent)', animation: 'pulse 1.5s infinite' }}
        />
        {disabledLabel ?? '正在回复中…'}
      </div>
    )
  }

  return (
    <div style={composerSurface(focused)}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKey}
        placeholder={running ? '运行中 · 追加的消息会排队,完成后自动发送…' : placeholder ?? '继续对话…'}
        rows={2}
        className="w-full px-4 pt-3 resize-none text-sm outline-none"
        style={{ color: 'var(--aa-text-1)', background: 'transparent', lineHeight: 1.65 }}
      />
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-3)' }}
          >
            <FileText size={11} />
            添加引用
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: 'var(--aa-text-3)' }}>
            {running ? '运行中 · Enter 排队' : 'Enter 发送'}
          </span>
          <button
            onClick={submit}
            className="w-7 h-7 flex items-center justify-center transition-all"
            style={{
              borderRadius: RADII.md,
              background: value.trim() ? 'var(--aa-accent)' : 'rgba(45,40,34,0.06)',
              color: value.trim() ? '#fff' : 'var(--aa-text-3)',
              transform: value.trim() ? 'scale(1)' : 'scale(0.9)',
            }}
          >
            <Send size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Keeps the prototype composer geometry while delegating every write, submit,
 * attachment and cancellation command to the existing Panel input contract.
 */
export function PrototypeConversationComposer({ input }: { readonly input: ChatInputProps }) {
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
    if (input.autoFocus !== true) return
    ref.current?.focus()
  }, [input.autoFocus])

  const submit = (): void => {
    if (!canSend) return
    input.onSubmit()
  }

  return (
    <div style={composerSurface(focused)}>
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
        className="w-full resize-none px-4 pt-3 text-sm outline-none disabled:cursor-not-allowed"
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
          <span className="text-[10px]" style={{ color: 'var(--aa-text-3)' }}>
            {input.running ? '运行中 · Enter 排队' : 'Enter 发送'}
          </span>
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
  if (input.models.length === 0) {
    return (
      <button
        type="button"
        onClick={input.onOpenSettings}
        className="shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-black/5"
        style={{ color: 'var(--aa-text-2)' }}
      >
        配置模型
      </button>
    )
  }
  return (
    <label className="relative min-w-0 max-w-36 shrink">
      <span className="sr-only">模型</span>
      <select
        aria-label="模型"
        value={input.selectedModelId}
        onChange={(event) => void input.onModelSelect(event.target.value)}
        className="h-6 w-full appearance-none truncate rounded-md bg-transparent py-0 pl-2 pr-6 text-[11px] outline-none transition-colors hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--aa-accent)]"
        style={{ color: 'var(--aa-text-2)' }}
      >
        <option value="" disabled>选择模型</option>
        {input.models.map((model) => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
      </select>
      <ChevronDown
        size={10}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: 'var(--aa-text-3)' }}
        aria-hidden="true"
      />
    </label>
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
      <span className="truncate text-[10px]" style={{ color: warning ? 'var(--aa-status-wait)' : 'var(--aa-text-3)' }}>
        {usage.percent === undefined ? '上下文 --' : `上下文 ${Math.round(percent)}%`}
      </span>
      <span className="h-1 min-w-8 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--aa-surface-hover)' }}>
        <span
          className="block h-full rounded-full transition-[width,background-color] duration-200"
          style={{
            width: `${progress}%`,
            background: warning ? 'var(--aa-status-wait)' : 'var(--aa-accent)',
          }}
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
      <ChevronDown
        size={10}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: 'var(--aa-text-3)' }}
        aria-hidden="true"
      />
    </label>
  )
}

/* ─── agent running (new conversation from home) ─── */
const AGENT_RESPONSE = `好的，我来帮你整理这方面的内容。

**核心学习策略**

间隔重复和主动回忆在学习机器学习这类需要理解复杂概念的领域，效果尤其显著：

- **间隔重复**：遵循遗忘曲线，在记忆即将消退前复习，将间隔逐渐拉长
- **主动回忆**：不要反复阅读笔记，而是合上书本尝试从记忆中重建知识
- **费曼技术**：用自己的话向虚拟听众解释概念，暴露知识盲点

**应用到机器学习**

将核心公式（反向传播推导、各种损失函数）制成 Anki 闪卡，每天用 15–20 分钟复习，而不是每周集中复习。错误的回忆比正确的重复更有价值——失败让大脑重新编码。`

/* 运行时的计划：agent 声明「我打算做这几步」，随运行逐步点亮。
 * detail 只在该步完成后填入，避免结果预览抢跑。 */
const PLAN_STEPS: { id: string; label: string; icon: React.ReactNode; detail?: string }[] = [
  { id: 's1', label: '检索相关笔记', icon: <Search size={11} />, detail: '找到 3 条相关笔记' },
  { id: 's2', label: '读取资源库 · 学习方法.md', icon: <FileText size={11} />, detail: '已读取 · 约 1,240 字' },
  { id: 's3', label: '检索知识库', icon: <Database size={11} />, detail: '匹配 5 个相关知识点' },
  { id: 's4', label: '综合并生成回复', icon: <Sparkles size={11} /> },
]

const FOLLOWUP_REPLIES = [
  '好的，我来进一步帮你展开这个方向。根据你提到的重点，可以从以下几个角度切入：\n\n- 首先梳理目前已有的知识框架\n- 找出知识盲点与待补充的部分\n- 制定具体可执行的下一步计划',
  '这是一个很好的问题。结合你之前的笔记，我认为最关键的是建立联系而不是孤立记忆。知识网络的密度决定了回忆的效率。',
  '明白你的需求了。我来帮你整理一个清晰的结构，让这些内容更容易被消化和复用。',
]

type RunState = 'running' | 'done' | 'stopped'

function AgentRunningView({
  initialMessage,
  onNavigate,
}: {
  initialMessage: string
  onNavigate: (v: View) => void
}) {
  const [steps, setSteps] = useState<RunStep[]>(() =>
    PLAN_STEPS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, status: 'pending' as const }))
  )
  const [runState, setRunState] = useState<RunState>('running')
  const [streamedText, setStreamedText] = useState('')
  // 运行中用户追加的消息在此排队，完成后自动发出。
  const [queued, setQueued] = useState<string[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [isReplying, setIsReplying] = useState(false)

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const streamRef = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const queuedRef = useRef<string[]>([])
  queuedRef.current = queued

  const running = runState === 'running'

  // 停止所有定时器
  function haltTimers() {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    if (streamRef.current !== null) {
      cancelAnimationFrame(streamRef.current)
      streamRef.current = null
    }
  }

  function setStep(i: number, patch: Partial<RunStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  // 计划推进 + 流式生成
  useEffect(() => {
    const push = (fn: () => void, delay: number) => { timersRef.current.push(setTimeout(fn, delay)) }

    push(() => setStep(0, { status: 'active' }), 300)
    push(() => { setStep(0, { status: 'done', detail: PLAN_STEPS[0].detail }); setStep(1, { status: 'active' }) }, 1400)
    push(() => { setStep(1, { status: 'done', detail: PLAN_STEPS[1].detail }); setStep(2, { status: 'active' }) }, 2500)
    push(() => {
      setStep(2, { status: 'done', detail: PLAN_STEPS[2].detail })
      setStep(3, { status: 'active' })
      const charactersPerSecond = 300
      let i = 0
      let lastFrame = performance.now()
      const tick = (now: number) => {
        i += Math.max(1, Math.round(((now - lastFrame) / 1000) * charactersPerSecond))
        lastFrame = now
        if (i >= AGENT_RESPONSE.length) {
          setStreamedText(AGENT_RESPONSE)
          streamRef.current = null
          finish('done')
          return
        }
        setStreamedText(AGENT_RESPONSE.slice(0, i))
        streamRef.current = requestAnimationFrame(tick)
      }
      streamRef.current = requestAnimationFrame(tick)
    }, 3500)

    return () => haltTimers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function finish(state: 'done' | 'stopped') {
    haltTimers()
    setRunState(state)
    setStep(3, { status: state === 'done' ? 'done' : 'pending' })
    // 完成后自动发出排队消息
    if (state === 'done' && queuedRef.current.length > 0) {
      const q = queuedRef.current
      setQueued([])
      const userMsgs: Message[] = q.map((c, i) => ({ id: `qu${Date.now()}_${i}`, role: 'user', content: c }))
      setMessages((prev) => [...prev, ...userMsgs])
      replyLater()
    }
  }

  function replyLater() {
    setIsReplying(true)
    const t = setTimeout(() => {
      const reply = FOLLOWUP_REPLIES[Math.floor(Math.random() * FOLLOWUP_REPLIES.length)]
      setMessages((prev) => [...prev, { id: `a${Date.now()}`, role: 'assistant', content: reply }])
      setIsReplying(false)
    }, 1500 + Math.random() * 800)
    timersRef.current.push(t)
  }

  function handleSend(text: string) {
    if (running) {
      // 运行中：排队，完成后自动发出
      setQueued((prev) => [...prev, text])
      return
    }
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', content: text }])
    replyLater()
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: running ? 'auto' : 'smooth', block: 'nearest' })
  }, [steps, streamedText, messages, isReplying, queued, running])

  const shortTitle = initialMessage.length > 36 ? initialMessage.slice(0, 36) + '…' : initialMessage

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ height: HEADER_H, paddingLeft: GUTTER, paddingRight: GUTTER }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium truncate" style={{ color: 'var(--aa-text-1)' }}>
              {shortTitle}
            </h2>
            {running && (
              <span
                className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(104,101,167,0.1)', color: 'var(--aa-accent)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: 'var(--aa-accent)', animation: 'pulse 1.5s infinite' }}
                />
                运行中
              </span>
            )}
            {runState === 'stopped' && (
              <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--aa-text-3)' }}>
                已停止
              </span>
            )}
            {runState === 'done' && (
              <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--aa-status-done)' }}>
                <Check size={11} />
                已完成
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onNavigate('focus')}
              className="p-1.5 rounded hover:bg-black/5"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <Maximize2 size={13} />
            </button>
            <button className="p-1.5 rounded hover:bg-black/5" style={{ color: 'var(--aa-text-3)' }}>
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="mx-auto px-6 py-8" style={{ maxWidth: 'var(--reading-width)' }}>
            <UserMsg content={initialMessage} />

            {/* 运行指示：统一为「整理机器学习学习路径」里那种极简一行样式 */}
            <div className="mb-7 group">
              <ToolActivity
                items={steps.map((s) => ({
                  id: s.id,
                  name: s.label,
                  icon: s.icon,
                  status: s.status === 'active' ? 'running' : s.status,
                }))}
                running={running}
              />
              {(streamedText.length > 0 || running) && (
                <AssistantMsg content={streamedText} streamCursor={running} />
              )}
              {runState === 'stopped' && (
                <p className="mt-1 text-[11px]" style={{ color: 'var(--aa-text-3)' }}>
                  运行已停止 · 你可以继续对话或重新发起
                </p>
              )}
            </div>

            {/* 后续对话 */}
            {messages.map((msg) =>
              msg.role === 'user' ? (
                <UserMsg key={msg.id} content={msg.content} />
              ) : (
                <AssistantMsg key={msg.id} content={msg.content} />
              )
            )}

            {isReplying && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="px-6 pb-5 shrink-0">
          <div className="mx-auto" style={{ maxWidth: 'var(--reading-width)' }}>
            {/* 排队中的消息 */}
            {queued.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px]" style={{ color: 'var(--aa-text-3)' }}>完成后发送：</span>
                {queued.map((q, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 max-w-[240px] px-2 py-0.5 rounded-full text-[11px]"
                    style={{ background: 'var(--aa-accent-bg)', color: 'var(--aa-accent)' }}
                  >
                    <span className="truncate">{q}</span>
                    <button
                      onClick={() => setQueued((prev) => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 opacity-70 hover:opacity-100"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Composer
              disabled={isReplying}
              disabledLabel="正在回复中…"
              running={running}
              onSend={handleSend}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── new (empty) conversation ───────────────────────────────────────────────
 * 从侧边栏「＋ 新对话」进入的空白详细界面。摒弃了乏味的「顶部标题 + 底部输入条」，
 * 改成一个有呼吸感的开场：柔和漂移的氛围光背景、居中的问候、一枚醒目的大输入框、
 * 以及几条按意图分组的起手式。用户发出第一条消息后，无缝转入完整 agent 运行体验。
 */
const NEW_CONV_STARTERS = [
  { icon: <BookOpen size={13} strokeWidth={1.9} />, label: '整理笔记', prompt: '帮我整理最近的学习笔记，提炼核心要点，并指出还需要补充的部分。' },
  { icon: <Zap size={13} strokeWidth={1.9} />, label: '继续研究', prompt: '继续帮我梳理机器学习的学习路径，给出下一阶段的重点。' },
  { icon: <Compass size={13} strokeWidth={1.9} />, label: '探索想法', prompt: '我想探索一个新的想法：' },
  { icon: <PenLine size={13} strokeWidth={1.9} />, label: '起草文字', prompt: '帮我起草一段文字，主题是：' },
]

function NewConversationView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [seed, setSeed] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const now = new Date()
  const h = now.getHours()
  const greeting = h < 5 ? '深夜好' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好'

  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [value])

  function submit() {
    const t = value.trim()
    if (!t) return
    setSeed(t)
  }

  function useStarter(prompt: string) {
    // 「探索想法 / 起草文字」这类以冒号结尾的开场需要用户补全,先填入等待输入;
    // 其余直接发送。
    if (prompt.trim().endsWith('：')) {
      setValue(prompt)
      setTimeout(() => ref.current?.focus(), 0)
    } else {
      setSeed(prompt)
    }
  }

  // 发出第一条消息后,转入完整运行界面
  if (seed) {
    return <AgentRunningView initialMessage={seed} onNavigate={onNavigate} />
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--aa-canvas)', scrollbarWidth: 'none' }}>
      {/* 纯净画布上的居中 hero */}
      <div
        className="mx-auto px-6 flex flex-col items-center justify-center text-center"
        style={{ maxWidth: 620, minHeight: '100%', paddingTop: 40, paddingBottom: 48 }}
      >
        <motion.div
          className="w-full flex flex-col items-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          {/* 问候 */}
          <h1 style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2, color: 'var(--aa-text-1)', margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
            {greeting}，想从哪里开始？
          </h1>
          <p className="text-sm" style={{ color: 'var(--aa-text-2)', lineHeight: 1.75, margin: '0 0 26px 0', maxWidth: 420 }}>
            说说你想做什么，我会结合你的空间与知识库来协助你。
          </p>

          {/* 大输入框 */}
          <div className="w-full overflow-hidden" style={{ ...composerSurface(focused), maxWidth: 560 }}>
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="描述你的问题或想法…"
              rows={3}
              className="w-full px-4 pt-4 pb-1 resize-none text-sm outline-none text-left"
              style={{ color: 'var(--aa-text-1)', background: 'transparent', lineHeight: 1.75, minHeight: 84 }}
              autoFocus
            />
            <div className="px-3 pb-3 pt-1 flex items-center justify-end">
              <button
                onClick={submit}
                disabled={!value.trim()}
                className="flex items-center justify-center shrink-0 transition-all"
                style={{
                  width: 32, height: 32, borderRadius: RADII.md,
                  background: value.trim() ? 'var(--aa-accent)' : 'rgba(45,40,34,0.07)',
                  color: value.trim() ? '#fff' : 'var(--aa-text-3)',
                  transform: value.trim() ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aa-text-3)' }}>
            Enter 发送 · Shift+Enter 换行
          </p>

          {/* 起手式 */}
          <div className="mt-8 w-full" style={{ maxWidth: 560 }}>
            <div className="grid grid-cols-2 gap-2">
              {NEW_CONV_STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => useStarter(s.prompt)}
                  className="flex items-center gap-2.5 px-3.5 py-3 text-left text-sm transition-all"
                  style={{
                    borderRadius: RADII.lg,
                    background: 'var(--aa-surface)',
                    border: '1px solid var(--aa-border)',
                    color: 'var(--aa-text-1)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(104,101,167,0.4)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--aa-border)' }}
                >
                  <span
                    className="flex items-center justify-center shrink-0 rounded-lg"
                    style={{ width: 28, height: 28, background: 'rgba(104,101,167,0.1)', color: 'var(--aa-accent)' }}
                  >
                    {s.icon}
                  </span>
                  <span style={{ fontWeight: 500 }}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function LiveConversationPage(props: LiveConversationPageProps) {
  if (!props.hasContent) {
    return <LiveConversationIntro input={props.input} error={props.error} />
  }

  const status = liveStatusLabel(props.state)
  return (
    <section className="flex min-h-0 flex-1 overflow-hidden" aria-label="对话工作台" role="region">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex shrink-0 items-center justify-between"
          style={{ height: HEADER_H, paddingLeft: GUTTER, paddingRight: GUTTER }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-sm font-medium" style={{ color: 'var(--aa-text-1)' }}>
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

        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="aa-redesign-transcript reading-prose mx-auto px-6 py-8" style={{ maxWidth: 'var(--reading-width)' }}>
            {props.content}
            {props.activity !== undefined && <div className="mt-5">{props.activity}</div>}
          </div>
        </div>

        <div className="shrink-0 px-6 pb-5">
          <div className="mx-auto" style={{ maxWidth: 'var(--reading-width)' }}>
            <PrototypeConversationComposer input={props.input} />
          </div>
        </div>
      </div>
    </section>
  )
}

function LiveConversationIntro(props: { readonly input: ChatInputProps; readonly error?: string }) {
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 5 ? '深夜好' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <section className="flex min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--aa-canvas)', scrollbarWidth: 'none' }} aria-label="对话工作台" role="region">
      <div
        className="mx-auto flex min-h-full w-full flex-col items-center justify-center px-6 py-12 text-center"
        style={{ maxWidth: 620 }}
      >
        <motion.div
          className="flex w-full flex-col items-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <h1 style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2, color: 'var(--aa-text-1)', margin: '0 0 10px 0' }}>
            {greeting}，想从哪里开始？
          </h1>
          <p className="text-sm" style={{ color: 'var(--aa-text-2)', lineHeight: 1.75, margin: '0 0 26px 0', maxWidth: 420 }}>
            说说你想做什么，我会结合你的空间与知识库来协助你。
          </p>
          {props.error !== undefined && (
            <p className="mb-4 text-sm" style={{ color: 'var(--aa-status-error)' }}>{props.error}</p>
          )}

          <div className="w-full" style={{ maxWidth: 560 }}>
            <PrototypeConversationComposer input={props.input} />
          </div>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aa-text-3)' }}>
            Enter 发送 · Shift+Enter 换行
          </p>

          <div className="mt-8 w-full" style={{ maxWidth: 560 }}>
            <div className="grid grid-cols-2 gap-2">
              {NEW_CONV_STARTERS.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => props.input.onChange(starter.prompt)}
                  className="flex items-center gap-2.5 px-3.5 py-3 text-left text-sm transition-all"
                  style={{
                    borderRadius: RADII.lg,
                    background: 'var(--aa-surface)',
                    border: '1px solid var(--aa-border)',
                    color: 'var(--aa-text-1)',
                  }}
                  onMouseEnter={(event) => { event.currentTarget.style.borderColor = 'rgba(104,101,167,0.4)' }}
                  onMouseLeave={(event) => { event.currentTarget.style.borderColor = 'var(--aa-border)' }}
                >
                  <span
                    className="flex shrink-0 items-center justify-center rounded-lg"
                    style={{ width: 28, height: 28, background: 'rgba(104,101,167,0.1)', color: 'var(--aa-accent)' }}
                  >
                    {starter.icon}
                  </span>
                  <span style={{ fontWeight: 500 }}>{starter.label}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
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
    case 'completed':
      return { label: '已完成', icon: <Check size={11} />, color: 'var(--aa-status-done)', background: 'rgba(72,168,112,0.1)' }
    case 'failed':
      return { label: '未完成', icon: <X size={11} />, color: 'var(--aa-status-error)', background: 'rgba(200,64,64,0.1)' }
    case 'initial':
      return undefined
  }
}

/* ─── static conversation data ─── */
const MSGS_ACTIVE: Message[] = [
  {
    id: 'm1',
    role: 'user',
    content: '帮我整理关于机器学习的学习笔记，重点关注间隔重复和主动回忆这两种方法在技术学习中的应用。',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: `好的，我来帮你整理这方面的内容。间隔重复和主动回忆在学习机器学习这类需要理解复杂概念的领域，效果尤其显著。

**间隔重复（Spaced Repetition）**

核心原理是遵循遗忘曲线，在记忆即将消退前复习，让间隔逐渐拉长：

- 每天用 15–20 分钟复习 Anki 卡片，而不是每周集中复习
- 将核心公式（反向传播推导、各种损失函数）制成闪卡
- 区分需要「理解」的概念和需要「记忆」的知识`,
    toolItems: [
      { id: 't1', name: '搜索相关笔记', icon: <Search size={10} />, status: 'done' },
      { id: 't2', name: '读取资源库 · 学习方法.md', icon: <FileText size={10} />, status: 'running' },
    ],
    toolRunning: true,
    generating: true,
  },
]

const MSGS_DONE_INITIAL: Message[] = [
  {
    id: 'm1',
    role: 'user',
    content: '帮我梳理这个季度的阅读内容，重点是《思考快与慢》和几篇关于认知偏见的论文。',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: `好的，来帮你梳理。

**《思考快与慢》核心框架**

卡尼曼将人类思维分为两个系统：

- **系统 1**：快速、自动、直觉性，负责模式识别与情绪反应
- **系统 2**：缓慢、努力、分析性，负责复杂推理与自我控制

书中最重要的洞察是：我们大多数时候高估了系统 2 的参与程度。

**认知偏见论文重点**

- Tversky & Kahneman (1974) 奠定了「启发式与偏误」的研究框架
- Nickerson (1998) 系统综述了确认偏误的多种表现形式
- Klein et al. (2007) 对「去偏误」训练的效果提出质疑`,
    toolItems: [
      { id: 't1', name: '读取阅读笔记 · 思考快与慢摘录.md', icon: <FileText size={10} />, status: 'done' },
      { id: 't2', name: '检索相关论文摘要', icon: <Search size={10} />, status: 'done' },
    ],
    toolRunning: false,
  },
  {
    id: 'm3',
    role: 'user',
    content: '这个整合方向很好，能帮我草拟一个读书笔记大纲吗？',
  },
  {
    id: 'm4',
    role: 'assistant',
    content: `当然，根据你的阅读内容，建议以下大纲：

**认知局限与决策质量 · 读书笔记**

- 一、两个思维系统的基础（《思快》第一部分）
   - 系统 1 特征与自动化机制
   - 系统 2 的资源有限性

- 二、认知捷径与误判（《思快》第二部分 + Tversky 1974）
   - 代表性启发式 · 可得性启发式 · 锚定效应

- 三、确认偏误的深层机制（Nickerson 1998）

- 四、专业判断中的偏误（Klein et al. 2007）

- 五、个人行动建议

这个结构可以直接作为 Markdown 文件的基础。需要某一节扩展得更详细吗？`,
  },
]

/* ─── main ConversationPage ─── */
export function ConversationPage(props: ConversationPageProps) {
  if (props.live !== undefined) return <LiveConversationPage {...props.live} />
  return <PrototypeConversationPage status={props.status ?? 'empty'} onNavigate={props.onNavigate ?? (() => undefined)} initialMessage={props.initialMessage} />
}

function PrototypeConversationPage({ status, onNavigate, initialMessage }: Required<Pick<ConversationPageProps, 'status' | 'onNavigate'>> & Pick<ConversationPageProps, 'initialMessage'>) {
  const [messages, setMessages] = useState<Message[]>(() =>
    status === 'active' ? MSGS_ACTIVE : MSGS_DONE_INITIAL
  )
  const [isReplying, setIsReplying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Agent running state from home
  if (status === 'new' && initialMessage) {
    return <AgentRunningView initialMessage={initialMessage} onNavigate={onNavigate} />
  }

  // 从侧边栏「＋ 新对话」进入的空白详细界面
  if (status === 'empty') {
    return <NewConversationView onNavigate={onNavigate} />
  }

  function handleSend(text: string) {
    if (status === 'active') return // active conv is still generating
    const userMsg: Message = { id: `u${Date.now()}`, role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setIsReplying(true)

    setTimeout(() => {
      const REPLIES = [
        '明白了。根据你提到的重点，我认为可以进一步展开「确认偏误」部分——这是三篇论文中覆盖最深入的主题，也与《思快》第三部分的框架高度吻合。\n\n你希望我帮你写这一节的详细内容吗？',
        '好的，我来帮你整理。你说的这个方向和 Nickerson (1998) 的框架很吻合，可以从信息检索层面和信息解读层面两个角度展开。',
        '这是个好问题。结合你已有的笔记，我建议先把第二章的「锚定效应」部分补充完整，因为它在你的阅读笔记里提到最多次，记忆痕迹最深。',
      ]
      const reply = REPLIES[messages.length % REPLIES.length]
      setMessages((prev) => [...prev, { id: `a${Date.now()}`, role: 'assistant', content: reply }])
      setIsReplying(false)
    }, 1400 + Math.random() * 600)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, isReplying])

  const title = status === 'active' ? '关于机器学习的学习方法' : '认知偏见与阅读整理'

  return (
    <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ height: HEADER_H, paddingLeft: GUTTER, paddingRight: GUTTER }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium truncate" style={{ color: 'var(--aa-text-1)' }}>
              {title}
            </h2>
            {status === 'active' && (
              <span
                className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(104,101,167,0.1)', color: 'var(--aa-accent)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--aa-accent)', animation: 'pulse 1.5s infinite' }}
                />
                思考中
              </span>
            )}
            {status === 'done' && (
              <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: 'var(--aa-status-done)' }}>
                <Check size={11} />
                已完成
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onNavigate('focus')}
              className="p-1.5 rounded hover:bg-black/5"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <Maximize2 size={13} />
            </button>
            <button className="p-1.5 rounded hover:bg-black/5" style={{ color: 'var(--aa-text-3)' }}>
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="mx-auto px-6 py-8" style={{ maxWidth: 'var(--reading-width)' }}>
            {messages.map((msg) =>
              msg.role === 'user' ? (
                <UserMsg key={msg.id} content={msg.content} />
              ) : (
                <AssistantMsg
                  key={msg.id}
                  content={msg.content}
                  toolItems={msg.toolItems}
                  toolRunning={msg.toolRunning}
                  generating={msg.generating}
                />
              )
            )}
            {isReplying && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="px-6 pb-5 shrink-0">
          <div className="mx-auto" style={{ maxWidth: 'var(--reading-width)' }}>
            <Composer
              disabled={status === 'active' || isReplying}
              disabledLabel={status === 'active' ? '正在回复中，请稍候…' : '正在回复中…'}
              onSend={handleSend}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
