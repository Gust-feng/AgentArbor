import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

interface DeferredSurfaceBoundaryProps {
  readonly children: ReactNode
  readonly resetKey: string
  readonly label: string
  readonly onRetry?: () => void
}

interface DeferredSurfaceBoundaryState {
  readonly error?: Error
}

/** Keeps a failed deferred capability inside the Redesign surface that owns it. */
export class DeferredSurfaceBoundary extends Component<DeferredSurfaceBoundaryProps, DeferredSurfaceBoundaryState> {
  override state: DeferredSurfaceBoundaryState = {}

  static getDerivedStateFromError(error: Error): DeferredSurfaceBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DeferredSurfaceBoundary]', error, info.componentStack)
  }

  override componentDidUpdate(previous: DeferredSurfaceBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== undefined) {
      this.setState({ error: undefined })
    }
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children
    return (
      <DeferredFailure
        label={this.props.label}
        detail={this.state.error.message}
        onRetry={this.props.onRetry ?? (() => window.location.reload())}
      />
    )
  }
}

function DeferredFailure(props: {
  readonly label: string
  readonly detail: string
  readonly onRetry: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6" role="alert">
      <div className="flex max-w-md items-start gap-3">
        <AlertCircle className="mt-0.5 shrink-0" size={16} style={{ color: 'var(--aa-status-error)' }} />
        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--aa-text-1)' }}>{props.label}</p>
          <p className="mt-1 break-words text-xs leading-5" style={{ color: 'var(--aa-text-3)' }}>{props.detail}</p>
          <button
            type="button"
            onClick={props.onRetry}
            className="mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-black/5"
            style={{ color: 'var(--aa-accent)', border: '1px solid var(--aa-border)' }}
          >
            <RotateCcw size={12} />
            重新加载
          </button>
        </div>
      </div>
    </div>
  )
}
