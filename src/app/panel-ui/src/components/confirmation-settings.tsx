import React from "react";
import type { ToolsResponse } from "../contracts/tools";
import { confirmationRuleLabel, toolTitle } from "./settings-tool-copy";
import { SettingRow } from "./workspace-common";

export function ConfirmationSettings(props: {
  readonly tools?: ToolsResponse;
}): React.ReactElement {
  const catalog = props.tools?.tools?.catalog?.tools ?? [];
  const guardedTools = catalog.filter((tool) => tool.requiresConfirmation === true);
  return (
    <div className="workspace-settings-stack">
      <section className="settings-card">
        <h3>确认边界</h3>
        <p>确认门只处理高影响动作的授权，不替模型判断方案。具体问题会在当前会话里说明后果，让用户批准、拒绝或补充指导。</p>
        {catalog.length === 0 ? (
          <p className="settings-value">当前工具目录加载后，会在这里展示需要确认的高影响动作。</p>
        ) : guardedTools.length === 0 ? (
          <p className="settings-value">当前启用工具里没有额外确认门；其余动作仍受工作区授权和工具边界约束。</p>
        ) : (
          guardedTools.map((tool) => (
            <SettingRow key={tool.name} label={toolTitle(tool)}>
              <span className="settings-value">{confirmationRuleLabel(tool)}</span>
            </SettingRow>
          ))
        )}
      </section>
    </div>
  );
}
