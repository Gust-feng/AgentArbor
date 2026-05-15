import React from "react";
import { ChevronDown, PanelLeft, Sparkles } from "lucide-react";
import { compact, STATUS_LABELS } from "../text";
import type { BasicAgentRun, ConfigResponse } from "../types";

type PanelScreen = "chat" | "skills" | "tools" | "settings";

export function TopBar(props: {
  readonly run?: BasicAgentRun;
  readonly config?: ConfigResponse;
  readonly screen: PanelScreen;
  readonly sidebarCollapsed: boolean;
  readonly inspectorOpen: boolean;
  readonly inspectorAvailable: boolean;
  readonly onToggleSidebar: () => void;
  readonly onToggleInspector: () => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const status = props.run?.status ?? "queued";
  const workspace = props.config?.workspace?.workspaceDirectory;
  const isChat = props.screen === "chat";
  return (
    <header className="topbar">
      <button
        type="button"
        aria-pressed={props.sidebarCollapsed}
        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-[background-color,color,box-shadow] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] ${
          props.sidebarCollapsed
            ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-sm hover:bg-[var(--accent-border-soft)]"
            : "text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--fg)]"
        }`}
        aria-label={props.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft
          size={16}
          className={`topbar-toggle-icon ${props.sidebarCollapsed ? "rotate-180" : "rotate-0"}`}
        />
      </button>
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] flex items-center justify-center">
          <Sparkles size={12} className="text-[var(--muted)]" />
        </div>
        <span className="text-sm text-[var(--fg)]">AgentArbor</span>
      </div>
      <div className="w-px h-5 bg-[var(--border)]" />
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="text-[var(--fg)]">{topbarTitle(props.screen, props.run)}</span>
        {workspace && (
          <>
            <span className="text-[var(--border)] hidden lg:inline">/</span>
            <span className="text-[var(--muted)] truncate max-w-[360px] hidden lg:inline">{compact(workspace, 54)}</span>
          </>
        )}
      </div>
      <div className="flex-1" />
      {isChat && (
        <div className="flex items-center gap-2 h-8 px-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] text-xs transition-[background-color,color,border-color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]" />
          <span>{props.run === undefined ? "待开始" : STATUS_LABELS[status]}</span>
          <ChevronDown size={11} />
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="w-8 h-8 rounded-full bg-[var(--surface-subtle)] border border-[var(--border)] flex items-center justify-center transition-[background-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]"
          aria-label="打开设置"
          onClick={props.onOpenSettings}
        >
          <div className="w-4 h-4 rounded-full bg-[var(--surface-muted)]" />
        </button>
      </div>
    </header>
  );
}

function topbarTitle(screen: PanelScreen, run: BasicAgentRun | undefined): string {
  if (screen === "skills") return "技能";
  if (screen === "tools") return "工具";
  if (screen === "settings") return "设置";
  return run?.title ?? "对话";
}
