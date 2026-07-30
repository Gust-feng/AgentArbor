import { useState } from 'react'
import {
  X,
  Sun,
  Moon,
  Monitor,
  Cpu,
  HardDrive,
  Keyboard,
  Info,
  Check,
  ChevronRight,
  Folder,
  Globe,
  Zap,
  BookOpen,
} from 'lucide-react'
import { RADII } from './tokens'
import {
  loadPrefs,
  savePrefs,
  type ReadingFont,
  type ReadingWidth,
} from './readingPrefs'
import { useModalA11y } from './useModalA11y'

interface SettingsModalProps {
  onClose: () => void
}

type Section = 'appearance' | 'reading' | 'model' | 'data' | 'shortcuts' | 'about'

const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: 'appearance', label: '外观', icon: <Sun size={14} /> },
  { key: 'reading', label: '阅读偏好', icon: <BookOpen size={14} /> },
  { key: 'model', label: '语言模型', icon: <Cpu size={14} /> },
  { key: 'data', label: '数据存储', icon: <HardDrive size={14} /> },
  { key: 'shortcuts', label: '快捷键', icon: <Keyboard size={14} /> },
  { key: 'about', label: '关于', icon: <Info size={14} /> },
]

/* ─── Appearance ─── */
const THEMES = [
  { key: 'system', label: '跟随系统', icon: <Monitor size={15} /> },
  { key: 'light', label: '浅色', icon: <Sun size={15} /> },
  { key: 'dark', label: '深色', icon: <Moon size={15} /> },
]

const FONT_SIZES = ['小', '中', '大']

function AppearanceSection() {
  const [theme, setTheme] = useState('system')
  const [fontSize, setFontSize] = useState(1)
  const [compactMode, setCompactMode] = useState(false)

  return (
    <div className="space-y-7">
      <SettingGroup label="主题">
        <div className="flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTheme(t.key)}
              className="flex-1 flex flex-col items-center gap-2 py-3 rounded-lg transition-all border"
              style={{
                background: theme === t.key ? 'var(--aa-accent-bg)' : 'var(--aa-surface-hover)',
                borderColor: theme === t.key ? 'rgba(104,101,167,0.3)' : 'transparent',
                color: theme === t.key ? 'var(--aa-accent)' : 'var(--aa-text-2)',
              }}
            >
              {t.icon}
              <span className="text-xs">{t.label}</span>
              {theme === t.key && (
                <Check size={10} style={{ color: 'var(--aa-accent)' }} />
              )}
            </button>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup label="字体大小">
        <div
          className="flex gap-0.5 rounded-lg p-0.5"
          style={{ background: 'var(--aa-surface-hover)' }}
        >
          {FONT_SIZES.map((sz, i) => (
            <button
              key={sz}
              onClick={() => setFontSize(i)}
              className="flex-1 py-1.5 rounded-md text-sm transition-all"
              style={{
                background: fontSize === i ? '#fff' : 'transparent',
                color: fontSize === i ? 'var(--aa-text-1)' : 'var(--aa-text-3)',
                boxShadow: fontSize === i ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {sz}
            </button>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup label="界面">
        <ToggleRow
          label="紧凑模式"
          description="减少行间距，在有限屏幕空间显示更多内容"
          value={compactMode}
          onChange={setCompactMode}
        />
      </SettingGroup>

      <SettingGroup label="语言">
        <SelectRow label="界面语言" value="简体中文" />
      </SettingGroup>
    </div>
  )
}

/* ─── Reading ─── */
const READING_FONTS: { key: ReadingFont; label: string; sample: string; family: string }[] = [
  { key: 'sans', label: '无衬线', sample: 'Aa 字', family: 'var(--reading-sans)' },
  { key: 'serif', label: '衬线', sample: 'Aa 字', family: 'var(--reading-serif)' },
]

const READING_WIDTHS: { key: ReadingWidth; label: string }[] = [
  { key: 'narrow', label: '窄' },
  { key: 'standard', label: '标准' },
  { key: 'wide', label: '宽' },
]

function ReadingSection() {
  const [prefs, setPrefs] = useState(() => loadPrefs())

  function update(patch: Partial<typeof prefs>) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next) // 立即持久化并应用到 CSS 变量，全局阅读界面当场生效
  }

  const previewFamily =
    prefs.font === 'serif' ? 'var(--reading-serif)' : 'var(--reading-sans)'

  return (
    <div className="space-y-7">
      <SettingGroup label="正文字体">
        <div className="flex gap-2">
          {READING_FONTS.map((f) => {
            const active = prefs.font === f.key
            return (
              <button
                key={f.key}
                onClick={() => update({ font: f.key })}
                className="flex-1 flex flex-col items-center gap-1.5 py-4 rounded-lg transition-all border"
                style={{
                  background: active ? 'var(--aa-accent-bg)' : 'var(--aa-surface-hover)',
                  borderColor: active ? 'rgba(104,101,167,0.3)' : 'transparent',
                }}
              >
                <span
                  style={{ fontFamily: f.family, fontSize: 22, color: 'var(--aa-text-1)', lineHeight: 1 }}
                >
                  {f.sample}
                </span>
                <span
                  className="text-xs flex items-center gap-1"
                  style={{ color: active ? 'var(--aa-accent)' : 'var(--aa-text-3)' }}
                >
                  {f.label}
                  {active && <Check size={10} />}
                </span>
              </button>
            )
          })}
        </div>
      </SettingGroup>

      <SettingGroup label="阅读栏宽度">
        <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--aa-surface-hover)' }}>
          {READING_WIDTHS.map((w) => {
            const active = prefs.width === w.key
            return (
              <button
                key={w.key}
                onClick={() => update({ width: w.key })}
                className="flex-1 py-1.5 rounded-md text-sm transition-all"
                style={{
                  background: active ? '#fff' : 'transparent',
                  color: active ? 'var(--aa-text-1)' : 'var(--aa-text-3)',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {w.label}
              </button>
            )
          })}
        </div>
      </SettingGroup>

      <SettingGroup label="预览">
        <div
          className="rounded-lg p-4"
          style={{ background: 'var(--aa-surface-hover)' }}
        >
          <p
            style={{
              fontFamily: previewFamily,
              fontSize: 14,
              lineHeight: 1.85,
              color: 'var(--aa-text-1)',
              margin: 0,
            }}
          >
            间隔重复和主动回忆在学习复杂概念时效果尤其显著：不要反复阅读笔记，而是合上材料、尝试从记忆中重建知识。
          </p>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--aa-text-3)' }}>
          阅读偏好会应用到对话流、专注模式与材料查看。
        </p>
      </SettingGroup>
    </div>
  )
}

/* ─── Model ─── */
const MODELS = [
  { id: 'claude-sonnet', name: 'Claude Sonnet 4.6', desc: '平衡速度与能力，日常使用推荐', tag: '推荐' },
  { id: 'claude-opus', name: 'Claude Opus 4.8', desc: '最强推理能力，适合复杂任务', tag: '强力' },
  { id: 'claude-haiku', name: 'Claude Haiku 4.5', desc: '极速响应，适合快速查询', tag: '快速' },
]

function ModelSection() {
  const [selected, setSelected] = useState('claude-sonnet')
  const [apiKey, setApiKey] = useState('sk-ant-••••••••••••••••••••••')
  const [showKey, setShowKey] = useState(false)

  return (
    <div className="space-y-7">
      <SettingGroup label="默认模型">
        <div className="space-y-1.5">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all border"
              style={{
                background: selected === m.id ? 'var(--aa-accent-bg)' : 'var(--aa-surface-hover)',
                borderColor: selected === m.id ? 'rgba(104,101,167,0.25)' : 'transparent',
              }}
            >
              <div
                className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                style={{
                  borderColor: selected === m.id ? 'var(--aa-accent)' : 'var(--aa-text-3)',
                }}
              >
                {selected === m.id && (
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: 'var(--aa-accent)' }}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--aa-text-1)' }}>
                    {m.name}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: selected === m.id ? 'rgba(104,101,167,0.15)' : 'rgba(45,40,34,0.07)',
                      color: selected === m.id ? 'var(--aa-accent)' : 'var(--aa-text-3)',
                    }}
                  >
                    {m.tag}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--aa-text-3)' }}>{m.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup label="API 密钥">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            border: '1px solid var(--aa-border)',
            background: 'var(--aa-surface)',
          }}
        >
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 text-sm outline-none"
            style={{ color: 'var(--aa-text-1)', background: 'transparent', fontFamily: 'monospace' }}
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="text-xs px-2 py-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-text-3)' }}
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--aa-text-3)' }}>
          密钥仅存储在本地，不会上传至任何服务器
        </p>
      </SettingGroup>
    </div>
  )
}

/* ─── Data ─── */
function DataSection() {
  const [autoSave, setAutoSave] = useState(true)
  const [syncEnabled, setSyncEnabled] = useState(false)

  return (
    <div className="space-y-7">
      <SettingGroup label="存储位置">
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: 'var(--aa-surface-hover)' }}
        >
          <Folder size={14} style={{ color: 'var(--aa-text-3)', flexShrink: 0 }} />
          <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-2)', fontFamily: 'monospace', fontSize: 12 }}>
            ~/Library/Application Support/AgentArbor
          </span>
          <button
            className="text-xs px-2 py-0.5 rounded shrink-0 transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-accent)' }}
          >
            更改
          </button>
        </div>
      </SettingGroup>

      <SettingGroup label="自动行为">
        <div className="space-y-3">
          <ToggleRow
            label="自动保存对话"
            description="每次对话结束后自动保存到本地"
            value={autoSave}
            onChange={setAutoSave}
          />
          <ToggleRow
            label="iCloud 同步"
            description="跨设备同步空间与对话历史"
            value={syncEnabled}
            onChange={setSyncEnabled}
          />
        </div>
      </SettingGroup>

      <SettingGroup label="数据管理">
        <div className="space-y-1.5">
          <ActionRow label="导出所有数据" icon={<HardDrive size={13} />} />
          <ActionRow label="清空对话历史" icon={<X size={13} />} danger />
        </div>
      </SettingGroup>
    </div>
  )
}

/* ─── Shortcuts ─── */
const SHORTCUTS = [
  { action: '打开搜索', keys: ['⌘', 'K'] },
  { action: '新建对话', keys: ['⌘', 'N'] },
  { action: '专注模式', keys: ['⌘', 'F'] },
  { action: '返回工作台', keys: ['⌘', '1'] },
  { action: '打开空间', keys: ['⌘', '2'] },
  { action: '发送消息', keys: ['↵'] },
  { action: '换行', keys: ['⇧', '↵'] },
  { action: '退出专注模式', keys: ['Esc'] },
]

function ShortcutsSection() {
  return (
    <div className="space-y-1">
      {SHORTCUTS.map((s) => (
        <div
          key={s.action}
          className="flex items-center justify-between py-2.5 px-1"
          style={{ borderBottom: '1px solid var(--aa-border)' }}
        >
          <span className="text-sm" style={{ color: 'var(--aa-text-1)' }}>{s.action}</span>
          <div className="flex items-center gap-1">
            {s.keys.map((k, i) => (
              <kbd
                key={i}
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  background: 'var(--aa-surface-hover)',
                  color: 'var(--aa-text-2)',
                  border: '1px solid var(--aa-border)',
                  fontFamily: 'system-ui',
                  minWidth: 24,
                  textAlign: 'center',
                }}
              >
                {k}
              </kbd>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs pt-3" style={{ color: 'var(--aa-text-3)' }}>
        快捷键自定义功能即将推出
      </p>
    </div>
  )
}

/* ─── About ─── */
function AboutSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div
          className="flex items-center justify-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'var(--aa-lavender)',
          }}
        >
          <Zap size={24} style={{ color: 'var(--aa-accent)' }} />
        </div>
        <div>
          <div className="text-base font-semibold" style={{ color: 'var(--aa-text-1)' }}>
            AgentArbor
          </div>
          <div className="text-sm mt-0.5" style={{ color: 'var(--aa-text-2)' }}>
            版本 0.3.0 · 内测版
          </div>
        </div>
      </div>

      <div
        className="rounded-lg p-4 space-y-2"
        style={{ background: 'var(--aa-surface-hover)' }}
      >
        {[
          { label: '构建时间', value: '2026-07-28' },
          { label: '运行环境', value: 'macOS 15.4' },
          { label: '数据引擎', value: 'SQLite 3.45' },
          { label: '模型协议', value: 'Anthropic API v1' },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--aa-text-3)' }}>{row.label}</span>
            <span className="text-xs font-medium" style={{ color: 'var(--aa-text-2)', fontFamily: 'monospace' }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {['隐私政策', '使用条款', '开源许可'].map((link) => (
          <button
            key={link}
            className="flex items-center gap-1 text-xs transition-colors hover:opacity-80"
            style={{ color: 'var(--aa-accent)' }}
          >
            <Globe size={10} />
            {link}
            <ChevronRight size={9} />
          </button>
        ))}
      </div>

      <div
        className="rounded-lg px-4 py-3"
        style={{ background: 'var(--aa-accent-bg)', border: '1px solid rgba(104,101,167,0.15)' }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--aa-accent)' }}>
          AgentArbor 是一个私人工作台，所有数据存储在本地设备上。我们不收集任何使用数据。
        </p>
      </div>
    </div>
  )
}

/* ─── shared primitives ─── */
function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-xs font-semibold mb-3 uppercase tracking-wider"
        style={{ color: 'var(--aa-text-3)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm" style={{ color: 'var(--aa-text-1)' }}>{label}</div>
        {description && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--aa-text-3)' }}>{description}</div>
        )}
      </div>
      <button
        onClick={() => onChange(!value)}
        className="shrink-0 transition-all"
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          background: value ? 'var(--aa-accent)' : 'var(--aa-surface-active)',
          position: 'relative',
        }}
        aria-pressed={value}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 150ms ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          }}
        />
      </button>
    </div>
  )
}

function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm" style={{ color: 'var(--aa-text-1)' }}>{label}</span>
      <button
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors hover:bg-black/5"
        style={{
          background: 'var(--aa-surface-hover)',
          color: 'var(--aa-text-2)',
        }}
      >
        {value}
        <ChevronRight size={12} style={{ color: 'var(--aa-text-3)' }} />
      </button>
    </div>
  )
}

function ActionRow({
  label,
  icon,
  danger,
}: {
  label: string
  icon: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors hover:bg-black/5"
      style={{
        color: danger ? 'var(--aa-status-error)' : 'var(--aa-text-2)',
      }}
    >
      <span style={{ opacity: 0.7 }}>{icon}</span>
      {label}
    </button>
  )
}

/* ─── modal shell ─── */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [section, setSection] = useState<Section>('appearance')
  const modalRef = useModalA11y(onClose)

  const sectionContent: Record<Section, React.ReactNode> = {
    appearance: <AppearanceSection />,
    reading: <ReadingSection />,
    model: <ModelSection />,
    data: <DataSection />,
    shortcuts: <ShortcutsSection />,
    about: <AboutSection />,
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.22)', backdropFilter: 'blur(4px)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="偏好设置"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="flex overflow-hidden outline-none"
        style={{
          width: 620,
          height: 500,
          borderRadius: 14,
          background: 'var(--aa-surface)',
          border: '1px solid var(--aa-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.14)',
        }}
      >
        {/* Left nav */}
        <div
          className="shrink-0 flex flex-col py-4"
          style={{
            width: 160,
            borderRight: '1px solid var(--aa-border)',
            background: 'var(--aa-canvas)',
          }}
        >
          <div className="px-4 pb-3 mb-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--aa-text-3)' }}>
              偏好设置
            </span>
          </div>
          <nav className="flex-1 px-2 space-y-0.5">
            {NAV.map((item) => {
              const active = section === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
                  style={{
                    background: active ? 'var(--aa-accent-bg)' : 'transparent',
                    color: active ? 'var(--aa-accent)' : 'var(--aa-text-2)',
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.7 }}>{item.icon}</span>
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4 shrink-0"
            style={{ borderBottom: '1px solid var(--aa-border)' }}
          >
            <h2 className="text-sm font-semibold" style={{ color: 'var(--aa-text-1)' }}>
              {NAV.find((n) => n.key === section)?.label}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md transition-colors hover:bg-black/5"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Scrollable content */}
          <div
            className="flex-1 overflow-y-auto px-6 py-5"
            style={{ scrollbarWidth: 'none' }}
          >
            {sectionContent[section]}
          </div>
        </div>
      </div>
    </div>
  )
}
