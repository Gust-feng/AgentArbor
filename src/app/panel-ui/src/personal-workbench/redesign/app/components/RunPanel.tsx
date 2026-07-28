import { Check, ChevronDown, ChevronRight, Square } from 'lucide-react'
import { useState } from 'react'
import { RADII, contentCard } from './tokens'

/* ─── run steps ───────────────────────────────────────────────────────────────
 * 运行时的每一步都是 agent 的"计划"的一环。pending → active → done。
 * active 步骤高亮并展示实时细节；done 步骤保留一行结果预览，让过程可读、可信。
 */
export type RunStepStatus = 'pending' | 'active' | 'done'

export interface RunStep {
  id: string
  label: string
  icon: React.ReactNode
  status: RunStepStatus
  /** 完成/进行中时的一行结果预览，例如「找到 3 条相关笔记」。 */
  detail?: string
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m > 0 ? `${m}:${String(rem).padStart(2, '0')}` : `${rem}s`
}

interface RunPanelProps {
  steps: RunStep[]
  /** 是否仍在运行；false 表示已结束（完成或停止）。 */
  running: boolean
  /** 结束后的收束状态标签，例如「已完成」「已停止」。 */
  finishedLabel?: string
  /** 是否为被用户停止（区别于正常完成，用不同图标/配色）。 */
  stopped?: boolean
  elapsedMs: number
  onStop?: () => void
  /** 已结束时默认折叠，运行中始终展开。 */
  defaultCollapsed?: boolean
}

/**
 * 运行面板：把 agent 的工作过程从折叠的黑盒变成可见的工作台。
 * 顶部是状态 + 计时 + 停止；下面是带连接线的计划步骤，逐步点亮。
 */
export function RunPanel({
  steps,
  running,
  finishedLabel,
  stopped = false,
  elapsedMs,
  onStop,
  defaultCollapsed = false,
}: RunPanelProps) {
  // 运行中强制展开；结束后允许用户折叠。
  const [collapsed, setCollapsed] = useState(defaultCollapsed && !running)
  const open = running || !collapsed

  const doneCount = steps.filter((s) => s.status === 'done').length
  const activeStep = steps.find((s) => s.status === 'active')

  return (
    <div className="mb-3 overflow-hidden" style={{ ...contentCard, borderRadius: RADII.md }}>
      <style>{`@keyframes rp-pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>

      {/* 头部：状态 · 进度 · 计时 · 停止 */}
      <div
        className="w-full flex items-center gap-2 px-3 py-2 text-xs select-none"
        style={{ cursor: running ? 'default' : 'pointer' }}
        onClick={() => !running && setCollapsed((c) => !c)}
      >
        {running ? (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: 'var(--aa-accent)', animation: 'rp-pulse 1.3s ease-in-out infinite' }}
          />
        ) : stopped ? (
          <Square size={11} fill="currentColor" style={{ color: 'var(--aa-text-3)', flexShrink: 0 }} />
        ) : (
          <Check size={12} style={{ color: 'var(--aa-status-done)', flexShrink: 0 }} />
        )}

        <span
          className="font-medium"
          style={{ color: running ? 'var(--aa-accent)' : stopped ? 'var(--aa-text-3)' : 'var(--aa-status-done)' }}
        >
          {running ? (activeStep ? activeStep.label : '正在运行') : finishedLabel ?? '已完成'}
        </span>

        <span style={{ color: 'var(--aa-text-3)' }}>· {doneCount}/{steps.length} 步</span>

        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="font-mono tabular-nums text-[11px]" style={{ color: 'var(--aa-text-3)' }}>
            {fmtElapsed(elapsedMs)}
          </span>
          {running && onStop ? (
            <button
              onClick={(e) => { e.stopPropagation(); onStop() }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(200,64,64,0.1)', color: 'var(--aa-status-error)' }}
            >
              <Square size={9} fill="currentColor" />
              停止
            </button>
          ) : (
            <span style={{ color: 'var(--aa-text-3)' }}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          )}
        </span>
      </div>

      {/* 计划步骤 */}
      {open && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--aa-border)' }}>
          <div className="relative pl-1 pt-1">
            {/* 连接线 */}
            <span
              aria-hidden
              className="absolute"
              style={{
                left: 7, top: 10, bottom: 12, width: 1,
                background: 'var(--aa-border)',
              }}
            />
            <div className="space-y-2.5">
              {steps.map((step) => {
                const isActive = step.status === 'active'
                const isDone = step.status === 'done'
                return (
                  <div key={step.id} className="relative flex gap-2.5">
                    {/* 状态节点 */}
                    <span
                      className="relative z-10 flex items-center justify-center shrink-0"
                      style={{ width: 15, height: 15, marginTop: 1 }}
                    >
                      {isDone ? (
                        <span
                          className="flex items-center justify-center rounded-full"
                          style={{ width: 15, height: 15, background: 'var(--aa-status-done)' }}
                        >
                          <Check size={9} style={{ color: '#fff' }} strokeWidth={3} />
                        </span>
                      ) : isActive ? (
                        <span
                          className="rounded-full border-[1.5px] border-t-transparent animate-spin"
                          style={{ width: 13, height: 13, borderColor: 'var(--aa-accent)', borderTopColor: 'transparent', background: 'var(--aa-canvas)' }}
                        />
                      ) : (
                        <span
                          className="rounded-full border-[1.5px]"
                          style={{ width: 12, height: 12, borderColor: 'var(--aa-text-3)', background: 'var(--aa-canvas)' }}
                        />
                      )}
                    </span>

                    {/* 步骤内容 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="shrink-0"
                          style={{ color: isActive ? 'var(--aa-accent)' : isDone ? 'var(--aa-text-2)' : 'var(--aa-text-3)', lineHeight: 0 }}
                        >
                          {step.icon}
                        </span>
                        <span
                          className="text-xs truncate"
                          style={{
                            color: isActive ? 'var(--aa-text-1)' : isDone ? 'var(--aa-text-2)' : 'var(--aa-text-3)',
                            fontWeight: isActive ? 500 : 400,
                          }}
                        >
                          {step.label}
                        </span>
                      </div>
                      {step.detail && (isActive || isDone) && (
                        <p
                          className="mt-0.5 text-[11px] truncate"
                          style={{ color: 'var(--aa-text-3)', paddingLeft: 0 }}
                        >
                          {step.detail}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
