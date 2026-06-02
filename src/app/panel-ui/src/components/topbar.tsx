import React from "react";
import { CheckCircle2, FolderOpen, PanelLeft } from "lucide-react";
import { compact, STATUS_LABELS } from "../text";
import type { ConfigResponse } from "../contracts/config";
import type { BasicAgentRun } from "../contracts/run";

export function TopBar(props: {
  readonly sidebarCollapsed: boolean;
  readonly run?: BasicAgentRun;
  readonly config?: ConfigResponse;
  readonly pendingCount: number;
  readonly onToggleSidebar: () => void;
}): React.ReactElement {
  const workspace = props.config?.workspace?.workspaceDirectory;
  const workspaceLabel = topbarWorkspaceLabel(workspace);
  const statusLabel = topbarStatusText(props.run?.status, props.pendingCount);
  const showChips = workspaceLabel !== undefined || statusLabel !== undefined;
  return (
    <header className="topbar">
      <button
        type="button"
        onClick={props.onToggleSidebar}
        aria-pressed={props.sidebarCollapsed}
        className={`topbar-sidebar-button ${props.sidebarCollapsed ? "active" : ""}`}
        aria-label={props.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        <PanelLeft size={15} className={props.sidebarCollapsed ? "rotated" : ""} />
      </button>

      <div className="topbar-spacer" />

      {showChips && (
        <div className="topbar-chips" aria-label="当前状态">
          {workspaceLabel !== undefined && (
            <span className="topbar-chip" title={workspace}>
              <FolderOpen size={13} />
              {workspaceLabel}
            </span>
          )}
          {statusLabel !== undefined && (
            <span className={`topbar-chip ${props.pendingCount > 0 ? "strong" : ""}`}>
              <CheckCircle2 size={13} />
              {statusLabel}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

function topbarStatusText(status: BasicAgentRun["status"] | undefined, pendingCount: number): string | undefined {
  if (pendingCount > 0) return `${pendingCount} 个待确认`;
  if (status === "queued" || status === "planning" || status === "running") return STATUS_LABELS[status];
  if (status === "needs_input" || status === "approval_needed" || status === "paused" || status === "blocked" || status === "failed" || status === "cancelled") {
    return STATUS_LABELS[status];
  }
  return undefined;
}

function topbarWorkspaceLabel(workspace: string | undefined): string | undefined {
  const trimmed = workspace?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return compact(segments.at(-1) ?? trimmed, 28);
}
