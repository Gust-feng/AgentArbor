import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Settings2, Sun } from 'lucide-react'
import {
  applyTheme,
  getInitialTheme,
  saveColorId,
  saveStyleId,
  type ThemeColorId,
} from '../../../../app-theme'

type AppearanceColorId = Extract<ThemeColorId, 'system' | 'light' | 'dark'>

const APPEARANCE_OPTIONS: readonly {
  readonly id: AppearanceColorId
  readonly label: string
  readonly description: string
  readonly icon: typeof Sun
}[] = [
  { id: 'light', label: '浅色', description: '明亮界面', icon: Sun },
  { id: 'dark', label: '深色', description: '低照度界面', icon: Moon },
  { id: 'system', label: '跟随系统', description: '使用系统偏好', icon: Monitor },
]

/**
 * 侧边栏左下角是本机工作台的稳定身份锚点，同时只承载已经可用的
 * 全局入口：设置和三种主题偏好。账号、订阅等尚未存在的产品事实不
 * 在这里预留空菜单项。
 */
export function SidebarFooter({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeColorId, setActiveColorId] = useState<AppearanceColorId>(() => {
    const initialTheme = getInitialTheme()
    return initialTheme.styleId === 'default' && isAppearanceColor(initialTheme.colorId)
      ? initialTheme.colorId
      : 'light'
  })
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const closeOnViewportChange = (): void => setMenuOpen(false)

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [menuOpen])

  function toggleMenu(): void {
    const currentTheme = getInitialTheme()
    if (currentTheme.styleId === 'default' && isAppearanceColor(currentTheme.colorId)) {
      setActiveColorId(currentTheme.colorId)
    }
    setMenuOpen((open) => !open)
  }

  function selectAppearance(colorId: AppearanceColorId): void {
    if (colorId === activeColorId && getInitialTheme().styleId === 'default') {
      setMenuOpen(false)
      return
    }
    const theme = applyTheme('default', colorId)
    saveStyleId(theme.styleId)
    saveColorId(theme.colorId)
    setActiveColorId(colorId)
    setMenuOpen(false)
  }

  function openSettings(): void {
    setMenuOpen(false)
    onOpenSettings()
  }

  return (
    <footer className="aa-sidebar-footer">
      <div ref={menuRef} className="aa-sidebar-footer-menu">
        <button
          type="button"
          onClick={toggleMenu}
          aria-label="设置与外观"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="aa-sidebar-footer__trigger"
        >
          <span className="aa-sidebar-footer__brand" aria-hidden="true">A</span>
          <span className="aa-sidebar-footer__identity">
            <span className="aa-sidebar-footer__name">AgentArbor</span>
            <small>本机工作台</small>
          </span>
          <Settings2 className="aa-sidebar-footer__action" size={15} aria-hidden="true" />
        </button>

        {menuOpen && (
          <div className="aa-sidebar-footer-menu__popover" role="menu" aria-label="设置与外观">
            <div className="aa-sidebar-footer-menu__heading">设置</div>
            <button
              type="button"
              role="menuitem"
              onClick={openSettings}
              className="aa-sidebar-footer-menu__item"
            >
              <Settings2 size={14} aria-hidden="true" />
              <span>打开设置</span>
            </button>

            <div role="separator" className="aa-sidebar-footer-menu__separator" />

            <div className="aa-sidebar-footer-menu__heading">主题</div>
            {APPEARANCE_OPTIONS.map((option) => {
              const Icon = option.icon
              const active = activeColorId === option.id && getInitialTheme().styleId === 'default'
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={`aa-sidebar-footer-menu__option${active ? ' active' : ''}`}
                  onClick={() => selectAppearance(option.id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span className="aa-sidebar-footer-menu__copy">
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </span>
                  {active && <Check size={14} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </footer>
  )
}

function isAppearanceColor(value: ThemeColorId): value is AppearanceColorId {
  return value === 'system' || value === 'light' || value === 'dark'
}
