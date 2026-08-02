import { useState } from 'react'
import { Layers, Pencil, Plus, X } from 'lucide-react'
import { SidebarInlineRenameField } from './SidebarInlineRenameField'
import { useModalA11y } from './useModalA11y'

export interface SpaceManagerDialogSpace {
  readonly id: string
  readonly label: string
  readonly dot: string
}

export interface SpaceManagerDialogProps {
  readonly spaces: readonly SpaceManagerDialogSpace[]
  readonly onClose: () => void
  readonly onRename: (id: string, label: string) => void
  readonly onAdd: () => void
}

/** Manages space names and creation without owning the sidebar's navigation state. */
export function SpaceManagerDialog({ spaces, onClose, onRename, onAdd }: SpaceManagerDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const modalRef = useModalA11y(onClose)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'rgba(45,40,34,0.28)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="管理空间"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full rounded-xl overflow-hidden outline-none"
        style={{
          maxWidth: 440,
          background: 'var(--aa-surface)',
          border: '1px solid var(--aa-border)',
          boxShadow: '0 20px 60px rgba(45,40,34,0.24)',
        }}
      >
        <header className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--aa-border)' }}>
          <div className="flex items-center gap-2">
            <Layers size={15} style={{ color: 'var(--aa-accent)' }}/>
            <h2 className="text-sm font-semibold m-0" style={{ color: 'var(--aa-text-1)' }}>管理空间</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5" style={{ color: 'var(--aa-text-3)' }}>
            <X size={15}/>
          </button>
        </header>

        <div className="px-3 py-2 max-h-[52vh] overflow-y-auto">
          {spaces.length === 0 && (
            <p className="text-xs text-center py-6" style={{ color: 'var(--aa-text-3)' }}>还没有空间,点下方「新建空间」开始。</p>
          )}
          {spaces.map((space) => (
            <div
              key={space.id}
              className="group/mrow flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-black/5"
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: space.dot, flexShrink: 0 }}/>
              {editingId === space.id ? (
                <SidebarInlineRenameField
                  value={space.label}
                  onCommit={(label) => { onRename(space.id, label); setEditingId(null) }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span className="flex-1 text-sm truncate" style={{ color: 'var(--aa-text-1)' }}>{space.label}</span>
              )}
              {editingId !== space.id && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/mrow:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditingId(space.id)}
                    title="重命名"
                    className="p-1.5 rounded-md hover:bg-black/10"
                    style={{ color: 'var(--aa-text-3)' }}
                  >
                    <Pencil size={13}/>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="px-3 py-3" style={{ borderTop: '1px solid var(--aa-border)' }}>
          <button
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-accent)', border: '1px dashed var(--aa-border)' }}
          >
            <Plus size={14}/>
            新建空间
          </button>
        </footer>
      </div>
    </div>
  )
}
