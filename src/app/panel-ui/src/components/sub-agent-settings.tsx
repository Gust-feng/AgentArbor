import React from "react";
import { RefreshCw } from "lucide-react";
import type { SubAgentDefinition } from "../contracts/sub-agents";

export function SubAgentSettings(props: {
  readonly subAgents: readonly SubAgentDefinition[];
  readonly refreshing?: boolean;
  readonly onRefresh: () => void;
}): React.ReactElement {
  const enabledCount = props.subAgents.filter((subAgent) => subAgent.enabled).length;
  return (
    <section className="skills-settings">
      <header className="skills-toolbar">
        <span>{enabledCount} / {props.subAgents.length} 启用</span>
        <button
          type="button"
          className="skills-refresh-button"
          onClick={props.onRefresh}
          disabled={props.refreshing}
        >
          <RefreshCw size={14} />
          {props.refreshing ? "刷新中" : "刷新"}
        </button>
      </header>
      {props.subAgents.length === 0 ? (
        <div className="skills-empty">暂无子 Agent</div>
      ) : (
        <div className="skills-list" aria-label="子 Agent 列表">
          {props.subAgents.map((subAgent) => (
            <SubAgentRow
              key={subAgent.id}
              subAgent={subAgent}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SubAgentRow(props: {
  readonly subAgent: SubAgentDefinition;
}): React.ReactElement {
  const hasCategory = props.subAgent.category !== undefined && props.subAgent.category.length > 0;
  const sourceLabel = subAgentSourceLabel(props.subAgent);
  const hasMeta = hasCategory || sourceLabel !== undefined;
  const hasWhenToUse = props.subAgent.whenToUse !== undefined && props.subAgent.whenToUse.length > 0;
  return (
    <article className={`skills-row ${props.subAgent.enabled ? "" : "disabled"}`}>
      <div className="skills-row-main">
        <div className="skills-row-title">
          <strong>{props.subAgent.name}</strong>
          <span className={props.subAgent.enabled ? "enabled" : "disabled"}>
            {props.subAgent.enabled ? "启用" : "停用"}
          </span>
        </div>
        <p>{props.subAgent.description || "未填写描述"}</p>
        {hasMeta && (
          <div className="skills-row-meta">
            {sourceLabel !== undefined && (
              <span className="source">
                {sourceLabel}
              </span>
            )}
            {hasCategory && <span>{props.subAgent.category}</span>}
            {props.subAgent.version !== undefined && (
              <span>v{props.subAgent.version}</span>
            )}
          </div>
        )}
        {hasWhenToUse && (
          <div className="sub-agent-when-to-use">
            <div className="sub-agent-when-to-use-label">何时使用：</div>
            <ul>
              {props.subAgent.whenToUse.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

function subAgentSourceLabel(subAgent: SubAgentDefinition): string | undefined {
  switch (subAgent.sourceKind) {
    case "builtin":
      return "内置";
    case "project":
      return "项目";
    case "user":
      return "全局";
    case "plugin":
      return "插件";
    case "custom":
      return "自定义";
    default:
      return undefined;
  }
}
