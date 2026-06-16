import React from "react";
import type { ToolConfirmationConfig, ToolConfirmationPolicy } from "../contracts/config";
import type { ToolsResponse } from "../contracts/tools";
import { confirmationRuleLabel, toolTitle } from "./settings-tool-copy";
import { SettingRow } from "./workspace-common";

export function ConfirmationSettings(props: {
  readonly tools?: ToolsResponse;
  readonly toolConfirmation?: ToolConfirmationConfig;
  readonly toolConfirmationPolicy: ToolConfirmationPolicy;
  readonly onToolConfirmationPolicyChange: (value: ToolConfirmationPolicy) => void;
}): React.ReactElement {
  const catalog = props.tools?.tools?.catalog?.tools ?? [];
  const guardedTools = catalog.filter((tool) => tool.requiresConfirmation === true);
  const shellCommandPolicy =
    props.toolConfirmation?.shellCommandConfirmation ??
    (props.toolConfirmationPolicy === "full_access" ? "skipped_by_full_access" : "prompt");
  return (
    <div className="workspace-settings-stack">
      <section className="settings-card">
        <h3>命令确认</h3>
        <SettingRow label="当前策略">
          <select
            value={props.toolConfirmationPolicy}
            onChange={(event) => props.onToolConfirmationPolicyChange(toolConfirmationPolicyFromValue(event.target.value))}
          >
            <option value="prompt">标准访问</option>
            <option value="full_access">完全访问</option>
          </select>
        </SettingRow>
        <SettingRow label="shell_command">
          <span className="settings-value">
            {shellCommandPolicy === "skipped_by_full_access" ? "完全访问：跳过逐条确认" : "标准访问：执行前确认"}
          </span>
        </SettingRow>
        <SettingRow label="风险边界">
          <span className="settings-value">
            {props.toolConfirmation?.riskDisclosure ??
              "这不是 sandbox；工具仍经过 ToolCenter、事件、runtime facts 和日志。"}
          </span>
        </SettingRow>
      </section>
      <section className="settings-card">
        <h3>需确认工具</h3>
        {catalog.length === 0 ? (
          <p className="settings-value">暂无工具</p>
        ) : guardedTools.length === 0 ? (
          <p className="settings-value">暂无</p>
        ) : (
          guardedTools.map((tool) => (
            <SettingRow key={tool.name} label={toolTitle(tool)}>
              <span className="settings-value">{confirmationRuleLabel(tool, props.toolConfirmationPolicy)}</span>
            </SettingRow>
          ))
        )}
      </section>
    </div>
  );
}

function toolConfirmationPolicyFromValue(value: string): ToolConfirmationPolicy {
  return value === "full_access" ? "full_access" : "prompt";
}
