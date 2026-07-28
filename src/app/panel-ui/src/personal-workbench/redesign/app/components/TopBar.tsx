import { ChevronLeft, Search, PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { type View } from './Sidebar'

interface TopBarProps {
  view: View
  onNavigate: (v: View) => void
  onSearch: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  // 知识库路径面包屑:打开的文件标题(无则在知识库根部);点根部回到知识库列表。
  brainFileTitle: string | null
  onBrainRoot: () => void
}

// 有自己完整 header 的视图 → TopBar 只保留返回 + 标题
const MINIMAL_VIEWS: View[] = ['conv-active', 'conv-done', 'space']

const VIEW_TITLE: Partial<Record<View, string>> = {
  'conv-active': '关于机器学习的学习方法',
  'conv-done': '认知偏见与阅读整理',
  space: '学习空间',
}

export function TopBar({
  view,
  onNavigate,
  onSearch,
  sidebarCollapsed,
  onToggleSidebar,
  brainFileTitle,
  onBrainRoot,
}: TopBarProps) {
  const isMinimal = MINIMAL_VIEWS.includes(view)
  const title = VIEW_TITLE[view]

  return (
    <div
      className="flex items-center justify-between px-3 shrink-0"
      style={{ height: 44, background: 'transparent' }}
    >
      {/* 左 */}
      <div className="flex items-center gap-2 min-w-0">
        {/* 收起 / 展开 始终是同一个按钮、同一个位置 —— 点击前后不产生任何位移。 */}
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!sidebarCollapsed}
          className="flex items-center justify-center px-1.5 py-1 rounded-md transition-colors hover:bg-black/5 shrink-0"
          style={{ color: 'var(--aa-text-3)' }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        {view === 'conv-new' ? (
          /* 新对话:走「首页 / 新对话」路径面包屑 */
          <>
            <button
              onClick={() => onNavigate('home')}
              className="flex items-center gap-0.5 px-1.5 py-1 rounded-md transition-colors hover:bg-black/5 shrink-0"
              style={{ color: 'var(--aa-text-3)' }}
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
              onClick={onBrainRoot}
              className="flex items-center gap-0.5 px-1.5 py-1 rounded-md transition-colors hover:bg-black/5 shrink-0"
              style={{ color: 'var(--aa-text-3)' }}
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
              onClick={() => onNavigate('home')}
              className="flex items-center gap-0.5 px-1.5 py-1 rounded-md transition-colors hover:bg-black/5 shrink-0"
              style={{ color: 'var(--aa-text-3)' }}
            >
              <ChevronLeft size={15} />
              {!isMinimal && (
                <span className="text-xs" style={{ color: 'var(--aa-text-3)' }}>
                  {view === 'search' ? '搜索' : '首页'}
                </span>
              )}
            </button>

            {/* minimal 视图：在 TopBar 展示当前页标题作为路径标记 */}
            {isMinimal && title && (
              <span
                className="text-xs truncate max-w-[200px] -ml-1"
                style={{ color: 'var(--aa-text-3)' }}
              >
                {title}
              </span>
            )}
          </>
        )}
      </div>

      {/* 右：搜索 */}
      {view !== 'search' && (
        <button
          onClick={onSearch}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/5 shrink-0"
          style={{ background: 'rgba(45,40,34,0.05)', color: 'var(--aa-text-3)', minWidth: 176 }}
        >
          <Search size={11} />
          <span className="flex-1 text-left">搜索内容与文件</span>
          <kbd
            className="px-1.5 py-0.5 rounded text-[10px]"
            style={{ background: 'rgba(45,40,34,0.08)', color: 'var(--aa-text-3)', fontFamily: 'system-ui' }}
          >
            ⌘K
          </kbd>
        </button>
      )}
    </div>
  )
}
