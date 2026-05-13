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
  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">工作会话</span>
        <strong>{props.run?.title ?? "新任务"}</strong>
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
          模型 {props.config?.config?.model ? `· ${compact(props.config.config.model, 24)}` : ""}
        </button>
      </div>
    </header>
  );
}
