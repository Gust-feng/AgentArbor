import { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowUp, BookOpen, Compass, FileText, Globe, MessageSquare, Zap } from 'lucide-react'
import { type View } from './Sidebar'
import { RADII, composerSurface } from './tokens'
import type { ConversationSummary } from '../../../../contracts/conversation'
import type { PersonalSpaceProjection } from '../../../space'
import { LEARNING_DEMO_TIMELINE } from './learningDemoDataset'

interface HomePageProps {
  onNavigate: (v: View) => void
  onStartConversation: (message: string) => void
  onOpenConversation: (conversationId: string) => boolean | Promise<boolean>
  conversations: readonly ConversationSummary[]
  spaces: readonly PersonalSpaceProjection[]
}

/* ─── ambient light ───────────────────────────────────────────────────────────
 * 纯氛围的抽象光：几团大尺度、强模糊、低透明度的渐变光斑，用薰衣草/暖阳/草绿
 * 极慢地漂移与呼吸；叠一层极淡颗粒增加质感。不带任何概念，只求安静的高级感。
 * 尊重 prefers-reduced-motion：偏好减弱时保持静止。
 */
const BLOBS = [
  { color: 'rgba(104,101,167,0.30)', size: 460, x: '8%', y: '18%', dx: 46, dy: 30, dur: 22 },
  { color: 'rgba(122,150,124,0.24)', size: 420, x: '62%', y: '54%', dx: -40, dy: 34, dur: 27 },
  { color: 'rgba(247,205,150,0.26)', size: 380, x: '78%', y: '10%', dx: -34, dy: 26, dur: 19 },
]

function AmbientLight() {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            left: b.x, top: b.y, width: b.size, height: b.size,
            background: `radial-gradient(circle at center, ${b.color}, transparent 70%)`,
            filter: 'blur(64px)',
            willChange: 'transform',
          }}
          animate={
            reduce
              ? undefined
              : { x: [0, b.dx, 0, -b.dx * 0.6, 0], y: [0, b.dy, -b.dy * 0.5, b.dy * 0.3, 0], scale: [1, 1.08, 0.96, 1.04, 1] }
          }
          transition={{ duration: b.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {/* 极淡颗粒，提一点质感 */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.04,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}

/* ─── backdrop ─── */
function HomeBackdrop() {
  const W = 1440, Ht = 900
  return (
    <div className="pointer-events-none" aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${Ht}`} preserveAspectRatio="xMidYMax slice" width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="aa-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#efeaf6" /><stop offset="0.34" stopColor="#f1edf4" />
            <stop offset="0.64" stopColor="#f4f1ee" /><stop offset="1" stopColor="#f4f2ef" />
          </linearGradient>
          <radialGradient id="aa-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#faf0e2" />
            <stop offset="0.42" stopColor="#f7ecdd" stopOpacity="0.9" />
            <stop offset="1" stopColor="#f7ecdd" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={Ht} fill="url(#aa-sky)" />
        <circle cx="1070" cy="300" r="240" fill="url(#aa-sun)" />
        <circle cx="1070" cy="300" r="52" fill="#f8efdb" />
        <rect x="0" y="392" width={W} height="120" fill="rgba(104,101,167,0.04)" />
        <g stroke="rgba(110,103,132,0.45)" strokeWidth="2.4" fill="none" strokeLinecap="round">
          <path d="M732 84 q15 -13 30 0 q15 -13 30 0" />
          <path d="M806 116 q11 -9 22 0 q11 -9 22 0" />
          <path d="M696 138 q8 -7 16 0 q8 -7 16 0" />
        </g>
        <path d="M0 486 C240 430 420 448 620 424 C840 398 1060 424 1240 408 C1340 399 1410 410 1440 404 L1440 900 L0 900 Z" fill="rgba(104,101,167,0.08)" />
        <path d="M0 566 C220 512 400 528 600 506 C820 482 1020 512 1220 496 C1330 487 1400 506 1440 498 L1440 900 L0 900 Z" fill="rgba(122,150,124,0.12)" />
        <path d="M0 650 C200 602 380 626 580 612 C800 597 1020 628 1220 616 C1330 609 1400 628 1440 620 L1440 900 L0 900 Z" fill="rgba(96,116,100,0.16)" />
      </svg>
    </div>
  )
}

/* ─── timeline data ─── */
type EntryType = 'conversation' | 'file' | 'web'

interface TimelineEntry {
  id: string
  type: EntryType
  date: string
  time: string
  action: string
  title: string
  detail: string
  navigateTo?: View
  conversationId?: string
}

const ENTRY_ICON: Record<EntryType, React.ReactNode> = {
  conversation: <MessageSquare size={13} strokeWidth={1.8} />,
  file: <FileText size={13} strokeWidth={1.8} />,
  web: <Globe size={13} strokeWidth={1.8} />,
}

const ENTRY_COLOR: Record<EntryType, string> = {
  conversation: '#6865a7',
  file: '#6f8778',
  web: '#6686a2',
}

/* ─── suggestions ─── */
const SUGGESTIONS = [
  { icon: <BookOpen size={11} />, label: '整理笔记', prompt: '帮我整理最近的学习笔记，提炼核心要点。' },
  { icon: <Zap size={11} />, label: '继续研究', prompt: '继续帮我整理机器学习相关的学习路径。' },
  { icon: <Compass size={11} />, label: '探索想法', prompt: '我想探索一个关于' },
]

/* ─── main ─── */
export function HomePage({ onNavigate, onStartConversation, onOpenConversation, conversations, spaces }: HomePageProps) {
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const timelineEntries = useMemo(
    () => homeTimelineEntries(conversations, spaces.some((space) => space.demoDataset === 'learning-workspace')),
    [conversations, spaces],
  )

  const now = new Date()
  const h = now.getHours()
  const greeting = h < 5 ? '深夜好' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好'
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const dateLine = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}`

  function submit() {
    const t = inputValue.trim()
    if (!t) return
    onStartConversation(t)
  }

  async function openTimelineEntry(entry: TimelineEntry) {
    if (entry.conversationId !== undefined) {
      try {
        const opened = await onOpenConversation(entry.conversationId)
        if (opened !== false) onNavigate('conv-done')
      } catch {
        // Conversation loading owns the visible error state.
      }
      return
    }
    if (entry.navigateTo !== undefined) onNavigate(entry.navigateTo)
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [inputValue])

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: 'var(--aa-canvas)', minHeight: '100%' }}>
      <HomeBackdrop />
      <AmbientLight />

      <div className="relative z-10 h-full flex flex-col">
        {/* ── 上区：问候 + 输入框 ── */}
        <div className="flex-1 flex flex-col justify-center" style={{ paddingLeft: 48, paddingRight: 48, maxHeight: '62%' }}>
          <div style={{ width: 'min(540px, 100%)' }}>
            <p className="mb-2 text-xs" style={{ color: 'var(--aa-text-3)', letterSpacing: '0.07em' }}>
              {dateLine}
            </p>
            <h1 style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.15, color: 'var(--aa-text-1)', margin: '0 0 22px 0', letterSpacing: '-0.02em' }}>
              {greeting}。
            </h1>

            <div className="overflow-hidden" style={composerSurface(focused)}>
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                placeholder="想从哪里开始？"
                rows={3}
                className="w-full px-4 pt-4 pb-1 resize-none text-sm outline-none"
                style={{ color: 'var(--aa-text-1)', background: 'transparent', lineHeight: 1.75, minHeight: 72 }}
              />
              <div className="px-3 pb-3 pt-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => { setInputValue(s.prompt); setTimeout(() => textareaRef.current?.focus(), 0) }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all"
                      style={{ background: 'rgba(45,40,34,0.05)', color: 'var(--aa-text-2)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.cssText += ';background:rgba(104,101,167,0.1);color:var(--aa-accent)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.cssText += ';background:rgba(45,40,34,0.05);color:var(--aa-text-2)' }}
                    >
                      {s.icon}{s.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={submit}
                  disabled={!inputValue.trim()}
                  className="flex items-center justify-center shrink-0 transition-all"
                  style={{
                    width: 30, height: 30, borderRadius: RADII.md,
                    background: inputValue.trim() ? 'var(--aa-accent)' : 'rgba(45,40,34,0.07)',
                    color: inputValue.trim() ? '#fff' : 'var(--aa-text-3)',
                    transform: inputValue.trim() ? 'scale(1.05)' : 'scale(1)',
                  }}
                >
                  <ArrowUp size={13} />
                </button>
              </div>
            </div>

            <p className="mt-2 text-[11px]" style={{ color: 'var(--aa-text-3)', paddingLeft: 2 }}>
              Enter 发送 · Shift+Enter 换行
            </p>
          </div>
        </div>

        {/* ── 下区：活动小径 ── */}
        {timelineEntries.length > 0 && <ActivityTrail entries={timelineEntries} onSelect={(entry) => void openTimelineEntry(entry)} />}
      </div>
    </div>
  )
}

/* ─── 活动小径 ───────────────────────────────────────────────────────────────
 * 底部整片区域都属于"最近活动"。一条连续、平滑起伏的枝干横贯而过，事件是挂在
 * 枝上的节点，从每个节点垂下细茎连到下方卡片；越靠右越新，最右端是"生长点"，
 * 最新一条在那里呼吸发光。进入时枝干顺势画出、节点依次点亮、卡片错落浮现。
 * 整条小径可横向滚动、两端柔化淡出。
 */
const TRAIL = {
  cardW: 216,
  pitch: 240, // 卡片间距 = 卡片宽 + 间隙
  padL: 182, // 首个节点前留白，容纳"最近活动"标签 + 枝干起段
  padR: 80,
  ridgeH: 52, // 枝干 + 细茎所占高度，卡片自此之下开始
  amp: 7, // 枝干起伏幅度（柔和）
  baseY: 26, // 枝干基准高度
}

// Catmull-Rom → 三次贝塞尔，得到一条穿过所有节点的顺滑枝干
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

function ActivityTrail({ entries, onSelect }: { entries: readonly TimelineEntry[]; onSelect: (entry: TimelineEntry) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [scrollX, setScrollX] = useState(0)
  const lastIndex = entries.length - 1

  const { cardW, pitch, padL, padR, ridgeH, amp, baseY } = TRAIL
  const nodeX = (i: number) => padL + i * pitch + cardW / 2
  const nodeY = (i: number) => baseY + amp * Math.sin(i * 0.72 + 1.1)
  const totalW = padL + lastIndex * pitch + cardW + padR
  const cardTop = ridgeH + 8

  // 枝干路径：从标签右侧的"萌芽"处生出，末端顺着同一条正弦自然收束（不再上翘）
  const originX = 150
  const branchPts = [
    { x: originX, y: baseY },
    { x: originX + 44, y: baseY - amp * 0.35 },
    ...entries.map((_, i) => ({ x: nodeX(i), y: nodeY(i) })),
    { x: nodeX(lastIndex) + 64, y: baseY + amp * Math.sin((lastIndex + 0.85) * 0.72 + 1.1) },
  ]
  const branchD = smoothPath(branchPts)

  // 标题栖在枝干起点左侧，随着向右前进平滑淡出
  const labelOpacity = Math.max(0, 1 - scrollX / 90)

  // 竖直滚轮转成横向浏览
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    el.scrollLeft += e.deltaY
  }

  const rafRef = useRef<number | null>(null)
  const latestScrollXRef = useRef(0)
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    latestScrollXRef.current = event.currentTarget.scrollLeft
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      setScrollX(latestScrollXRef.current)
    })
  }, [])
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div style={{ flexShrink: 0, paddingBottom: 8 }}>
      <style>{`@keyframes aa-breath{0%,100%{box-shadow:0 0 0 0 var(--c),0 0 0 0 transparent}50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--c) 20%,transparent),0 0 22px 3px color-mix(in srgb,var(--c) 32%,transparent)}}.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>

      {/* 可滚动小径，右端柔化淡出 */}
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
        className="overflow-x-auto overflow-y-hidden no-scrollbar"
        style={{
          paddingTop: 4,
          paddingBottom: 20,
          scrollBehavior: 'smooth',
          WebkitMaskImage: 'linear-gradient(to right, #000 0, #000 calc(100% - 72px), transparent 100%)',
          maskImage: 'linear-gradient(to right, #000 0, #000 calc(100% - 72px), transparent 100%)',
        }}
      >
        <div className="relative" style={{ width: totalW, height: cardTop + 128 }}>
          {/* 标题：枝干起点左侧，前进时淡出 */}
          <div
            className="absolute z-20 flex flex-col gap-1 pointer-events-none"
            style={{ left: 40, top: baseY, transform: 'translateY(-50%)', opacity: labelOpacity, transition: 'opacity 120ms linear' }}
          >
            <span className="text-[11px] font-semibold tracking-widest uppercase whitespace-nowrap" style={{ color: 'var(--aa-text-2)' }}>
              最近活动
            </span>
            <span className="text-[9px] whitespace-nowrap" style={{ color: 'var(--aa-text-3)', letterSpacing: '0.08em' }}>
              {entries.length} 条足迹
            </span>
          </div>

          {/* 枝干 + 细茎 + 节点 */}
          <svg className="absolute left-0 top-0" width={totalW} height={ridgeH} style={{ overflow: 'visible' }} aria-hidden>
            <defs>
              <linearGradient id="aa-branch" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="rgba(104,101,167,0)" />
                <stop offset="0.12" stopColor="rgba(104,101,167,0.16)" />
                <stop offset="0.55" stopColor="rgba(104,101,167,0.34)" />
                <stop offset="1" stopColor="rgba(104,101,167,0.52)" />
              </linearGradient>
            </defs>

            {/* 细茎：节点垂到卡片 */}
            {entries.map((_, i) => (
              <motion.line
                key={`stem-${i}`}
                x1={nodeX(i)} y1={nodeY(i)} x2={nodeX(i)} y2={cardTop}
                stroke="rgba(45,40,34,0.13)" strokeWidth={1}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.5 + i * 0.08, duration: 0.4 }}
              />
            ))}

            {/* 枝干主线 */}
            <motion.path
              d={branchD} fill="none" stroke="url(#aa-branch)" strokeWidth={2} strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.1, ease: 'easeInOut' }}
            />

            {/* 节点 */}
            {entries.map((entry, i) => {
              const color = ENTRY_COLOR[entry.type]
              const isLatest = i === lastIndex
              return (
                <motion.circle
                  key={`node-${entry.id}`}
                  cx={nodeX(i)} cy={nodeY(i)} r={isLatest ? 6 : 4}
                  fill={color} stroke="var(--aa-canvas)" strokeWidth={2}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.35 + i * 0.1, type: 'spring', stiffness: 400, damping: 20 }}
                  style={{ transformOrigin: `${nodeX(i)}px ${nodeY(i)}px` }}
                />
              )
            })}
          </svg>

          {/* 卡片 */}
          {entries.map((entry, i) => {
            const color = ENTRY_COLOR[entry.type]
            const isLatest = i === lastIndex
            const hovered = hoverId === entry.id
            return (
              <motion.button
                key={entry.id}
                onClick={() => onSelect(entry)}
                onMouseEnter={() => setHoverId(entry.id)}
                onMouseLeave={() => setHoverId(null)}
                aria-label={`${entry.date} ${entry.time}：${entry.title}`}
                className="group absolute text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--aa-accent)]"
                style={{ left: padL + i * pitch, top: cardTop, width: cardW, borderRadius: RADII.lg }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.09, duration: 0.5, ease: 'easeOut' }}
              >
                {/* 呼吸光点：栖在生长点 / 各节点末端，与细茎相接 */}
                <span
                  aria-hidden
                  className="absolute rounded-full"
                  style={{
                    top: -5, left: cardW / 2 - 3, width: 6, height: 6, background: color,
                    ['--c' as string]: color,
                    animation: isLatest ? 'aa-breath 2.6s ease-in-out infinite' : undefined,
                  }}
                />
                <div
                  className="px-3.5 py-3 transition-all duration-200"
                  style={{
                    borderRadius: RADII.lg,
                    background: hovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)',
                    border: `1px solid ${isLatest ? color + '4d' : 'rgba(45,40,34,0.09)'}`,
                    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                    transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
                    boxShadow: hovered ? '0 4px 14px rgba(73,64,58,0.06)' : '0 1px 3px rgba(73,64,58,0.03)',
                  }}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="flex shrink-0" style={{ color }}>{ENTRY_ICON[entry.type]}</span>
                    <span className="text-[10px] font-medium" style={{ color }}>{entry.action}</span>
                    {isLatest && (
                      <span className="ml-auto rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: color + '1f', color }}>
                        最新
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs font-medium" style={{ color: 'var(--aa-text-1)' }}>{entry.title}</p>
                  <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--aa-text-3)' }}>{entry.detail}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--aa-text-3)' }}>{entry.date}</span>
                    <span className="text-[10px]" style={{ color: 'var(--aa-text-3)' }}>·</span>
                    <span className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--aa-text-3)' }}>{entry.time}</span>
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function homeTimelineEntries(conversations: readonly ConversationSummary[], hasLearningDemo: boolean): TimelineEntry[] {
  if (conversations.length === 0) return hasLearningDemo ? [...LEARNING_DEMO_TIMELINE] : []
  return [...conversations]
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
    .slice(0, 6)
    .reverse()
    .map((conversation) => {
      const updatedAt = validDate(conversation.updatedAt)
      return {
        id: conversation.conversationId,
        type: 'conversation',
        date: updatedAt === undefined ? '最近' : formatDate(updatedAt),
        time: updatedAt === undefined ? '' : updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        action: conversation.status === 'running' ? '正在进行' : '继续对话',
        title: conversation.title,
        detail: conversation.preview?.trim() || conversation.currentAction?.trim() || '对话',
        conversationId: conversation.conversationId,
      }
    })
}

function timestamp(value: string | undefined): number {
  return validDate(value)?.getTime() ?? 0
}

function validDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function formatDate(date: Date): string {
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? '今天'
    : `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
