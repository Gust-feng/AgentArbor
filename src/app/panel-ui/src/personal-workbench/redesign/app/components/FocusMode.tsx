import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Minimize2, Send, Check, FileText, MoreHorizontal, Copy } from 'lucide-react'
import { RADII, contentCard, composerSurface } from './tokens'
import type { LiveConversationState } from './ConversationPage'

interface FocusModeProps {
  onExit?: () => void
  live?: LiveFocusModeProps
}

export interface LiveFocusModeProps {
  readonly title: string
  readonly state: LiveConversationState
  readonly content?: ReactNode
  readonly activity?: ReactNode
  readonly composer: ReactNode
}

function inlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*([^*]+)\*\*/)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ fontWeight: 600, color: 'var(--aa-text-1, #292722)' }}>{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

function renderMd(content: string) {
  const paras = content.split('\n\n').filter(Boolean)
  return paras.map((para, pi) => {
    const lines = para.split('\n').filter(Boolean)
    if (lines.every((l) => l.startsWith('- '))) {
      return (
        <div key={pi} className="mb-3 space-y-1.5">
          {lines.map((l, li) => (
            <div key={li} className="flex gap-2 text-sm">
              <span className="mt-1 shrink-0" style={{ color: 'var(--aa-text-3)', fontSize: 10 }}>●</span>
              <span style={{ lineHeight: 1.8 }}>{inlineBold(l.slice(2))}</span>
            </div>
          ))}
        </div>
      )
    }
    const first = lines[0]
    if (first.startsWith('**') && first.endsWith('**') && lines.length === 1) {
      return <p key={pi} className="mt-4 mb-1.5 font-semibold text-sm" style={{ color: 'var(--aa-text-1)' }}>{first.slice(2, -2)}</p>
    }
    return (
      <p key={pi} className="mb-3 text-sm" style={{ lineHeight: 1.85, color: 'var(--aa-text-1, #292722)' }}>
        {inlineBold(lines.join(' '))}
      </p>
    )
  })
}

interface Msg { id: string; role: 'user' | 'assistant'; content: string }

const INITIAL_MESSAGES: Msg[] = [
  { id: 'm1', role: 'user', content: '帮我整理关于机器学习的学习笔记，重点关注间隔重复和主动回忆这两种方法。' },
  {
    id: 'm2', role: 'assistant',
    content: `好的，来帮你整理。

**间隔重复（Spaced Repetition）**

核心原理是遵循遗忘曲线，在记忆即将消退前复习：

- 每天用 15–20 分钟复习，而不是每周集中复习
- 将核心公式制成闪卡，区分「理解」与「记忆」
- 使用 Anki 等工具管理复习间隔

**主动回忆（Active Recall）**

被动阅读效率很低；主动提取记忆会触发更深层的编码：

- 合上材料，用自己的话写出刚才学到的内容
- 制作测试题，在无提示情况下作答
- 费曼技巧：假装向别人解释，找到不清楚的地方再回头`,
  },
  { id: 'm3', role: 'user', content: '这两种方法怎么结合起来用？' },
  {
    id: 'm4', role: 'assistant',
    content: `结合使用会产生很好的协同效果。

一个有效的工作流是：**学习 → 立即主动回忆 → 制卡 → 间隔复习**。

- 学完一个概念后，立即合上材料，写下能想起的内容（主动回忆）
- 把自己写的内容转成 Anki 卡片（制卡）
- 通过 Anki 的间隔算法安排后续复习（间隔重复）

关键在于：Anki 的价值不是帮你第一次记住，而是帮你在最合适的时间点加固。第一次记住依赖主动回忆。`,
  },
]

const MOCK_REPLIES = [
  '很好的思路。在实践中，很多人发现「制卡」这一步是瓶颈——制作一张好卡片需要先真正理解概念，而这个过程本身就是一次主动回忆。\n\n建议你在学习新材料时立即制卡，而不是等到复习时再整理。',
  '这个问题很关键。间隔的长度因人而异，Anki 的算法会根据你的回忆质量自动调整。初期可能每天都需要复习同一张卡片，随着熟练度提升，间隔会拉长到数周甚至数月。',
  '你提到的这个点很准确。"遗忘"本身并不是坏事——在即将遗忘时检索，会比在记忆新鲜时检索产生更强的记忆痕迹，这叫做"间隔效应"。',
]

export function FocusMode(props: FocusModeProps) {
  if (props.live !== undefined) {
    return <LiveFocusMode {...props.live} onExit={props.onExit ?? (() => undefined)} />
  }
  return <PrototypeFocusMode onExit={props.onExit ?? (() => undefined)} />
}

function LiveFocusMode(props: LiveFocusModeProps & { readonly onExit: () => void }) {
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

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="aa-redesign-transcript reading-prose mx-auto px-6 py-10" style={{ maxWidth: 'var(--reading-width)' }}>
          {props.content}
          {props.activity !== undefined && <div className="mt-5">{props.activity}</div>}
        </div>
      </div>

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
  if (state === 'attention') return { label: '需要确认', color: 'var(--aa-status-wait)', icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} /> }
  if (state === 'completed') return { label: '已完成', color: 'var(--aa-status-done)', icon: <Check size={11} /> }
  if (state === 'failed') return { label: '未完成', color: 'var(--aa-status-error)', icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} /> }
  return undefined
}

function PrototypeFocusMode({ onExit }: { readonly onExit: () => void }) {
  const [messages, setMessages] = useState<Msg[]>(INITIAL_MESSAGES)
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [isReplying, setIsReplying] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, isReplying])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [inputValue])

  function handleSend() {
    const t = inputValue.trim()
    if (!t || isReplying) return
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', content: t }])
    setInputValue('')
    setIsReplying(true)
    setTimeout(() => {
      const reply = MOCK_REPLIES[messages.length % MOCK_REPLIES.length]
      setMessages((prev) => [...prev, { id: `a${Date.now()}`, role: 'assistant', content: reply }])
      setIsReplying(false)
    }, 1500 + Math.random() * 600)
  }

  function handleCopy(id: string, content: string) {
    navigator.clipboard.writeText(content).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--aa-canvas)', fontFamily: '"Noto Sans SC", Inter, system-ui, sans-serif' }}
    >
      {/* Topbar */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ height: 44, borderBottom: '1px solid var(--aa-border)', paddingLeft: 24, paddingRight: 16 }}
      >
        <span className="text-sm font-medium truncate" style={{ color: 'var(--aa-text-2)' }}>
          关于机器学习的学习方法
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--aa-status-done)' }}>
            <Check size={11} />已完成
          </span>
          <button className="p-1.5 rounded hover:bg-black/5 ml-1" style={{ color: 'var(--aa-text-3)' }}>
            <MoreHorizontal size={14} />
          </button>
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ background: 'var(--aa-surface-hover)', color: 'var(--aa-text-1)' }}
          >
            <Minimize2 size={11} />
            退出专注
          </button>
        </div>
      </div>

      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="mx-auto px-6 py-10 reading-prose" style={{ maxWidth: 'var(--reading-width)' }}>
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end mb-6">
                <div
                  className="px-4 py-3 text-sm"
                  style={{ ...contentCard, background: '#ffffff', color: 'var(--aa-text-1)', maxWidth: 460, lineHeight: 1.75 }}
                >
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="mb-8 group">
                {renderMd(msg.content)}
                <button
                  onClick={() => handleCopy(msg.id, msg.content)}
                  className="flex items-center gap-1 mt-1.5 text-[11px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-black/5"
                  style={{ color: 'var(--aa-text-3)' }}
                >
                  {copiedId === msg.id ? <Check size={10} style={{ color: 'var(--aa-status-done)' }} /> : <Copy size={10} />}
                  {copiedId === msg.id ? '已复制' : '复制'}
                </button>
              </div>
            )
          )}

          {/* 思考指示 */}
          {isReplying && (
            <div className="mb-8 flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--aa-accent)', opacity: 0.5, animation: `thinkingDot 1.2s ${i * 0.18}s infinite` }}
                />
              ))}
              <style>{`@keyframes thinkingDot { 0%,80%,100%{transform:scale(0.7);opacity:0.3} 40%{transform:scale(1);opacity:0.75} }`}</style>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入框 */}
      <div className="px-6 pb-6 shrink-0">
        <div className="mx-auto overflow-hidden" style={{ maxWidth: 'var(--reading-width)', ...composerSurface(focused) }}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="继续对话…"
            rows={2}
            className="w-full px-4 pt-3 resize-none text-sm outline-none"
            style={{ color: 'var(--aa-text-1)', background: 'transparent', lineHeight: 1.65 }}
          />
          <div className="px-4 py-2.5 flex items-center justify-between">
            <button
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md hover:bg-black/5"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <FileText size={11} />添加引用
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[10px]" style={{ color: 'var(--aa-text-3)' }}>Enter 发送</span>
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isReplying}
                className="w-7 h-7 flex items-center justify-center transition-all"
                style={{
                  borderRadius: RADII.md,
                  background: inputValue.trim() && !isReplying ? 'var(--aa-accent)' : 'rgba(45,40,34,0.06)',
                  color: inputValue.trim() && !isReplying ? '#fff' : 'var(--aa-text-3)',
                }}
              >
                <Send size={11} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
