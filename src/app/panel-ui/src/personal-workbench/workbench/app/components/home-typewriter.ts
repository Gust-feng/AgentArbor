import { useCallback, useEffect, useRef } from 'react'

/**
 * ⚠️ 动画层次演示模块 —— 禁止提交。
 *
 * 本文件只服务于产品演示动画（路演）中的「首页输入框逐字输入」效果，
 * 不属于 AgentArbor 产品功能，严禁随任何提交进入仓库。
 * 当前未被任何产品代码引用（零引用），删除本文件即可完全移除动画能力；
 * 移除时无需改动任何产品文件，不会影响编译与测试。
 *
 * —— 演示时临时接线（接线改动同样禁止提交，演示结束必须还原）——
 * 1. HomePage.tsx：调用 useHomeTypewriter({ value, onChange, busy })，
 *    把返回的 startIfIdle 接到 ConversationComposer 的 onUserActivate，
 *    把返回的 stop 接到 onFocusChange（失焦时停止自动输入）；
 * 2. ConversationComposer.tsx：新增两个可选 props（仅动画演示使用）：
 *    - onUserActivate?: () => void —— 在 textarea 的 onPointerDown（鼠标主键）
 *      触发，程序化聚焦不触发，用于区分「用户点击」与「自动聚焦」；
 *    - onFocusChange?: (focused: boolean) => void —— 在 onFocus / onBlur 触发。
 * 接线后逐字输入会真实写入输入框的受控 value，可被现有提交链路直接使用。
 *
 * —— 行为 ——
 * - 用户点击输入框且输入框为空时，把演示文案逐字写入输入框；
 * - 用户手动输入、编辑、清空、失焦或进入忙碌时立即放弃自动输入；
 * - 演示文案为占位测试文案，替换候选池即可换文案。
 *
 * —— 节奏 ——
 * 模拟人类输入：每个字的间隔在基础值上按字序做确定性抖动，
 * 标点处停顿更久，末字稍作收尾，让逐字过程更连贯、不机械。
 */
export const HOME_TYPEWRITER_DEMO_COPIES = [
  '帮我整理今天的工作任务',
  '把这份 PDF 总结成学习笔记，再整理成要点',
  '为下周制定一份学习计划',
] as const

/** 基础逐字间隔：实际间隔在此基础上按字序确定性抖动。 */
export const HOME_TYPEWRITER_BASE_CHAR_MS = 95

/** 标点后的停顿，毫秒。 */
export const HOME_TYPEWRITER_PUNCTUATION_PAUSE_MS = 420

/** 点击输入框后到第一个字出现的延迟，毫秒。 */
export const HOME_TYPEWRITER_START_DELAY_MS = 220

const TYPEWRITER_PUNCTUATION = new Set('，。、！？；：…,.!?;:')

/** 第 index 个字之前的等待时长：标点停顿更久，末字稍慢，其余按字序确定性抖动。 */
export function homeTypewriterCharDelay(index: number, copy: string): number {
  const char = copy[index]
  if (char !== undefined && TYPEWRITER_PUNCTUATION.has(char)) {
    return HOME_TYPEWRITER_PUNCTUATION_PAUSE_MS
  }
  const jitter = (((index * 2_654_435_761) >>> 0) % 51) - 25
  if (index === copy.length - 1) return HOME_TYPEWRITER_BASE_CHAR_MS + 60
  return HOME_TYPEWRITER_BASE_CHAR_MS + jitter
}

/** 按日期稳定选择一个演示文案：同一天内多次点击保持同一句。 */
export function selectHomeTypewriterCopy(now: Date = new Date()): string {
  const day = Math.floor(now.getTime() / 86_400_000)
  return HOME_TYPEWRITER_DEMO_COPIES[day % HOME_TYPEWRITER_DEMO_COPIES.length]!
}

export interface HomeTypewriterOptions {
  /** 输入框当前值，用于与自动进度比对。 */
  readonly value: string
  /** 输入框变更回调，逐字写入演示文案。 */
  readonly onChange: (value: string) => void
  /** 输入框忙碌状态：忙碌时暂停自动输入。 */
  readonly busy: boolean
  /** 演示文案，默认按日期从候选池选取。 */
  readonly copy?: string
}

export interface HomeTypewriterController {
  /** 输入框空闲且为空时开始逐字输入；进行中或已有内容时忽略。 */
  readonly startIfIdle: () => void
  /** 停止自动输入，保留已输入的部分文本。 */
  readonly stop: () => void
}

export function useHomeTypewriter(options: HomeTypewriterOptions): HomeTypewriterController {
  const copy = options.copy ?? selectHomeTypewriterCopy()

  const stateRef = useRef(options)
  stateRef.current = options
  const copyRef = useRef(copy)
  copyRef.current = copy

  const typedRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stopRef = useRef(stop)
  stopRef.current = stop

  const startIfIdle = useCallback(() => {
    if (timerRef.current !== null) return
    const { value: currentValue, busy: currentBusy } = stateRef.current
    if (currentBusy || currentValue.length > 0) return
    const copyText = copyRef.current
    if (copyText.length === 0) return

    typedRef.current = ''
    const step = (): void => {
      const { value: latestValue, onChange: latestOnChange, busy: latestBusy } = stateRef.current
      if (latestBusy) {
        stopRef.current()
        return
      }
      // 值与自动进度不一致（用户手动输入或编辑）时，立即放弃自动输入。
      if (latestValue !== typedRef.current) {
        stopRef.current()
        return
      }
      const nextIndex = typedRef.current.length
      const next = copyText.slice(0, nextIndex + 1)
      typedRef.current = next
      latestOnChange(next)
      if (next.length === copyText.length) {
        stopRef.current()
        return
      }
      timerRef.current = setTimeout(step, homeTypewriterCharDelay(nextIndex + 1, copyText))
    }
    timerRef.current = setTimeout(step, HOME_TYPEWRITER_START_DELAY_MS)
  }, [])

  // 自动输入之外的值变化（用户编辑、清空、外部赋值）或进入忙碌时，停止自动输入。
  useEffect(() => {
    if (timerRef.current === null) return
    const { value: latestValue, busy: latestBusy } = stateRef.current
    if (latestValue !== typedRef.current || latestBusy) stop()
  }, [options.value, options.busy, stop])

  useEffect(() => stop, [stop])

  return { startIfIdle, stop }
}
