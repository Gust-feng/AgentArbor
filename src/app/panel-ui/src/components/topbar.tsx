import React from "react";
import { compact, STATUS_LABELS, statusTone } from "../text";
import type { BasicAgentRun, ConfigResponse } from "../types";

export function TopBar(props: {
  readonly run?: BasicAgentRun;
  readonly config?: ConfigResponse;
  readonly inspectorOpen: boolean;
  readonly inspectorAvailable: boolean;
  readonly onToggleInspector: () => void;
  readonly onOpenSettings: () => void;
}): React.ReactElement {
  const status = props.run?.status ?? "queued";
  const workspace = props.config?.workspace?.workspaceDirectory;
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Command Center</span>
        <strong>{props.run?.title ?? "新任务工作台"}</strong>
        {workspace && <small>当前工作区：{compact(workspace, 54)}</small>}
      </div>
      <div className="topbar-actions">
        <span className={`status-pill ${statusTone(status)}`}>{props.run === undefined ? "待开始" : STATUS_LABELS[status]}</span>
        <button
          type="button"
          className="ghost"
          disabled={!props.inspectorAvailable && !props.inspectorOpen}
          onClick={props.onToggleInspector}
        >
          {props.inspectorOpen ? "隐藏上下文" : "查看上下文"}
        </button>
        <button type="button" className="ghost" onClick={props.onOpenSettings}>
          设置
        </button>
      </div>
    </header>
  );
}
