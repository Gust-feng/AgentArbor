import React from "react";
import { AlertCircle, CheckCircle, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded bg-[var(--surface-muted)] ${className}`} style={style} />;
}

// ─────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type BtnSize = "xs" | "sm" | "md";

export function Button({
  children,
  variant = "secondary",
  size = "md",
  onClick,
  className = "",
  disabled = false,
  icon,
  type = "button",
}: {
  children?: React.ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] select-none whitespace-nowrap active:scale-[0.99]";
  const sizeMap: Record<BtnSize, string> = {
    xs: "h-6 px-2 text-xs",
    sm: "h-7 px-3 text-xs",
    md: "h-8 px-4 text-sm",
  };
  const variantMap: Record<BtnVariant, string> = {
    primary: "bg-[var(--accent-strong)] text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] shadow-sm",
    secondary: "bg-[var(--surface-subtle)] text-[var(--fg)] hover:bg-[var(--surface-muted)] active:bg-[var(--border)]",
    ghost: "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--fg)]",
    outline: "border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-subtle)] shadow-sm",
    danger: "bg-[var(--danger-soft)] text-[var(--status-danger)] border border-[var(--danger-border)] hover:bg-[var(--danger-soft-hover)]",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizeMap[size]} ${variantMap[variant]} ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : ""} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Badge
// ─────────────────────────────────────────────────────────────
type BadgeColor = "neutral" | "blue" | "cyan" | "amber" | "red" | "purple";

export function Badge({ children, color = "neutral" }: { children: React.ReactNode; color?: BadgeColor }) {
  const colors: Record<BadgeColor, string> = {
    neutral: "bg-[var(--surface-subtle)] text-[var(--muted)]",
    blue: "bg-[var(--blue-soft)] text-[var(--blue-text)]",
    cyan: "bg-[var(--cyan-soft)] text-[var(--cyan-text)]",
    amber: "bg-[var(--amber-soft)] text-[var(--amber-text)]",
    red: "bg-[var(--red-soft)] text-[var(--red-text)]",
    purple: "bg-[var(--purple-soft)] text-[var(--purple-text)]",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-0 border-t border-[var(--border)]" />;
  return (
    <div className="flex items-center gap-3">
      <hr className="flex-1 border-0 border-t border-[var(--border)]" />
      <span className="text-xs text-[var(--muted)] shrink-0">{label}</span>
      <hr className="flex-1 border-0 border-t border-[var(--border)]" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SectionHeader
// ─────────────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 mb-6">
      <div>
        <h1 className="text-[var(--fg)] leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SkeletonCard
// ─────────────────────────────────────────────────────────────
export function SkeletonCard({
  onAction,
  actionLabel = "操作",
  badge,
  titleLabel = "名称占位",
  descLabel = "描述占位",
}: {
  onAction?: React.MouseEventHandler<HTMLButtonElement>;
  actionLabel?: string;
  badge?: React.ReactNode;
  titleLabel?: string;
  descLabel?: string;
}) {
  return (
    <div className="group relative bg-white rounded-2xl border border-[var(--border)] p-4 flex flex-col gap-3 hover:border-[var(--border-strong)] hover:shadow-[0_10px_28px_rgba(17,24,39,0.06)] transition-[border-color,box-shadow,transform] duration-[var(--motion-panel-duration)] ease-[var(--motion-ease-standard)] cursor-pointer active:scale-[0.995]">
      {badge && <div className="absolute top-3 right-3">{badge}</div>}
      <div className="w-10 h-10 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] flex items-center justify-center">
        <div className="w-5 h-5 rounded-lg bg-[var(--border)]" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-[var(--fg)]">{titleLabel}</p>
        <p className="text-xs text-[var(--muted)]">{descLabel}</p>
        <Skeleton className="h-2.5 w-4/5" />
      </div>
      <div className="pt-2 border-t border-[var(--border)] flex items-center justify-end">
        <Button variant="outline" size="xs" onClick={(e) => { e.stopPropagation(); onAction?.(e); }}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SettingRow
// ─────────────────────────────────────────────────────────────
type ControlKind = "toggle" | "input" | "select" | "button";

export function SettingRow({
  label,
  desc,
  control = "toggle",
  last = false,
}: {
  label: string;
  desc?: string;
  control?: ControlKind;
  last?: boolean;
}) {
  const Control = () => {
    if (control === "toggle")
      return (
        <div className="w-10 h-6 rounded-full bg-[var(--surface-muted)] relative cursor-pointer shrink-0 border border-[var(--border)]">
          <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm" />
        </div>
      );
    if (control === "input")
      return (
        <div className="h-8 w-44 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 flex items-center">
          <Skeleton className="h-2.5 flex-1" />
        </div>
      );
    if (control === "select")
      return (
        <div className="h-8 w-36 rounded-lg border border-[var(--border)] bg-white px-3 flex items-center justify-between">
          <Skeleton className="h-2.5 w-16" />
          <span className="text-[var(--muted)] text-[10px] ml-2">▾</span>
        </div>
      );
    return (
      <Button variant="outline" size="sm">
        控件占位
      </Button>
    );
  };

  return (
    <div className={`flex items-center justify-between py-4 ${!last ? "border-b border-[var(--border)]" : ""}`}>
      <div className="min-w-0 pr-8">
        <p className="text-sm text-[var(--fg)]">{label}</p>
        {desc && <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="shrink-0">
        <Control />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-[var(--surface-subtle)] border border-[var(--border)] flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <p className="text-sm text-[var(--fg)] mb-1.5">{title}</p>
      {description && <p className="text-xs text-[var(--muted)] text-center max-w-[240px] leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────
export function Modal({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  width?: number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="modal-backdrop-enter absolute inset-0 bg-black/20" />
      <div
        className="modal-card-enter relative z-10 bg-white rounded-2xl shadow-2xl border border-[var(--border)]"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--fg)]">{title}</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--fg)] transition-[background-color,color,transform] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] active:scale-[0.99]"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          {children ?? (
            <>
              {["w-14", "w-20", "w-10"].map((w, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className={`h-3 ${w}`} />
                  <div className="h-9 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]" />
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-12" />
                <div className="h-20 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]" />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="primary">确认</Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer
// ─────────────────────────────────────────────────────────────
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: React.ReactNode;
  width?: number;
}) {
  return (
    <div className={`fixed inset-0 z-50 flex justify-end ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-black/15 transition-opacity duration-[var(--motion-dialog-duration)] ease-[var(--motion-ease-standard)] ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`relative bg-white h-full border-l border-[var(--border)] shadow-2xl flex flex-col transition-transform duration-[var(--motion-dialog-duration)] ease-[var(--motion-ease-standard)] ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ width }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <span className="text-sm text-[var(--fg)]">{title}</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--fg)] transition-[background-color,color,transform] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] active:scale-[0.99]"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        <div className="shrink-0 border-t border-[var(--border)] px-6 py-4 flex items-center gap-2">
          <Button variant="primary" className="flex-1">开始使用</Button>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}

export function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="w-full h-32 rounded-2xl bg-[var(--surface-subtle)] flex items-center justify-center border border-[var(--border)]">
        <div className="w-12 h-12 rounded-2xl bg-[var(--border)]" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-4/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-18 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <Divider label="参数配置" />
      {["参数占位", "参数占位", "参数占位"].map((_, i) => (
        <div key={i} className="flex items-center justify-between py-2">
          <div>
            <Skeleton className="h-2.5 w-20 mb-1" />
            <Skeleton className="h-2 w-28" />
          </div>
          <div className="h-7 w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]" />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────
export function Toast({ show, message, type = "success" }: { show: boolean; message: string; type?: "success" | "error" }) {
  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-lg bg-white transition-[opacity,transform] duration-[var(--motion-dialog-duration)] ease-[var(--motion-ease-standard)] ${
        show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
      } ${type === "success" ? "border-[var(--border)]" : "border-[var(--danger-border)] bg-[var(--danger-soft)]"}`}
    >
      {type === "success" ? (
        <CheckCircle size={15} className="text-[var(--status-success)] shrink-0" />
      ) : (
        <AlertCircle size={15} className="text-[var(--status-danger)] shrink-0" />
      )}
      <span className="text-sm text-[var(--fg)]">{message}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// StatusDot
// ─────────────────────────────────────────────────────────────
export function StatusDot({ pulse = false }: { pulse?: boolean }) {
  if (!pulse) return <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />;
  return (
    <div className="relative w-2 h-2 flex items-center justify-center shrink-0">
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]" />
    </div>
  );
}
