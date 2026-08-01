import { ChevronLeft, Search, PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { DesktopWindowControls } from './DesktopWindowControls'
import { type View } from './Sidebar'
import './top-bar.css'

interface TopBarProps {
  view: View
  onNavigate: (v: View) => void
  onSearch: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  surfaceTitle?: string
  // 知识库路径面包屑:打开的文件标题(无则在知识库根部);点根部回到知识库列表。
  brainFileTitle: string | null
  onBrainRoot: () => void
}

// 有自己完整 header 的视图 → TopBar 只保留返回 + 标题
const MINIMAL_VIEWS: View[] = ['conv-active', 'conv-done', 'space']

export function TopBar({
  view,
  onNavigate,
  onSearch,
  sidebarCollapsed,
  onToggleSidebar,
  surfaceTitle,
  brainFileTitle,
  onBrainRoot,
}: TopBarProps) {
  const isMinimal = MINIMAL_VIEWS.includes(view)
  const desktopShell = typeof window !== 'undefined' && window.agentarborDesktop !== undefined

  return (
    <header
      className="topbar-shell flex items-center justify-between px-3 shrink-0"
      data-desktop-shell={desktopShell ? 'true' : 'false'}
      style={{ height: 44, background: 'transparent' }}
    >
      {/* 左 */}
      <div className="flex items-center gap-2 min-w-0">
        {/* 收起 / 展开 始终是同一个按钮、同一个位置 —— 点击前后不产生任何位移。 */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!sidebarCollapsed}
          className="topbar-nav-button shrink-0"
        >
          {sidebarCollapsed
            ? <PanelLeftOpen size={15} strokeWidth={1.75} />
            : <PanelLeftClose size={15} strokeWidth={1.75} />}
        </button>
        {view !== 'search' && (
          <button
            type="button"
            aria-label="搜索内容与文件"
            onClick={onSearch}
            className="topbar-search-trigger shrink-0"
            style={{ color: 'var(--aa-text-3)' }}
          >
            <Search className="topbar-search-icon" size={14} aria-hidden="true" />
            <span className="topbar-search-details" aria-hidden="true">
              <span className="topbar-search-label">搜索内容与文件</span>
              <kbd className="topbar-search-shortcut">⌘K</kbd>
            </span>
          </button>
        )}
        {view === 'conv-new' ? (
          /* 新对话:走「首页 / 新对话」路径面包屑 */
          <>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="topbar-nav-button topbar-back-button shrink-0"
            >
              <ChevronLeft size={15} />
              <span className="text-xs" style={{ color: 'var(--aa-text-3)' }}>
                首页
              </span>
            </button>
            <span className="text-xs -ml-0.5" style={{ color: 'var(--aa-text-3)', opacity: 0.6 }}>/</span>
            <span className="text-xs -ml-0.5" style={{ color: 'var(--aa-text-2)' }}>
              新对话
            </span>
          </>
        ) : view === 'brain' ? (
          /* 知识库:走真正的路径面包屑「知识库 › 文件」,不再是「首页」返回。
             复用与其它视图完全一致的按钮 / 标题样式,只是把返回目标换成知识库根部。 */
          <>
            <button
              type="button"
              onClick={onBrainRoot}
              className="topbar-nav-button topbar-back-button shrink-0"
            >
              <ChevronLeft size={15} />
              <span className="text-xs" style={{ color: 'var(--aa-text-3)' }}>
                知识库
              </span>
            </button>
            {brainFileTitle && (
              <span
                className="text-xs truncate max-w-[200px] -ml-1"
                style={{ color: 'var(--aa-text-3)' }}
              >
                {brainFileTitle}
              </span>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="返回首页"
              onClick={() => onNavigate('home')}
              className="topbar-nav-button topbar-back-button shrink-0"
            >
              <ChevronLeft size={15} />
              {!isMinimal && (
                <span className="text-xs" style={{ color: 'var(--aa-text-3)' }}>
                  {view === 'search' ? '搜索' : '首页'}
                </span>
              )}
            </button>

            {/* minimal 视图：在 TopBar 展示当前页标题作为路径标记 */}
            {isMinimal && surfaceTitle && (
              <span
                className="text-xs truncate max-w-[200px] -ml-1"
                style={{ color: 'var(--aa-text-3)' }}
              >
                {surfaceTitle}
              </span>
            )}
          </>
        )}
      </div>

      <DesktopWindowControls />
    </header>
  )
}
