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
        <h3>高影响动作</h3>
        {catalog.length === 0 ? (
          <p className="settings-value">暂无工具</p>
        ) : guardedTools.length === 0 ? (
          <p className="settings-value">暂无</p>
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
