import React from "react";
import type { RuntimeEnvironmentTool } from "../contracts/config";
import { SettingRow } from "./workspace-common";

export function RuntimeEnvironmentSettings(props: {
  readonly tools?: readonly RuntimeEnvironmentTool[];
}): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>环境检测</h3>
      <SettingRow label="本机工具">
        <div className="settings-runtime-list" aria-label="环境检测">
          {runtimeTools(props.tools).map((tool) => (
            <span className="settings-runtime-item" data-status={tool.available ? "available" : "missing"} key={tool.id}>
              <span className="settings-runtime-name">{tool.label}</span>
              <span className="settings-runtime-status">{tool.available ? "可用" : "未发现"}</span>
              {tool.executable !== undefined && <span className="settings-runtime-path">{tool.executable}</span>}
            </span>
          ))}
        </div>
      </SettingRow>
    </section>
  );
}

function runtimeTools(tools: readonly RuntimeEnvironmentTool[] | undefined): readonly {
  readonly id: string;
  readonly label: string;
  readonly executable?: string;
  readonly available: boolean;
}[] {
  const detected = tools ?? [];
  if (detected.length === 0) {
    return [
      { id: "node", label: "Node.js", available: false },
      { id: "python", label: "Python", available: false },
      { id: "git-bash", label: "Git Bash", available: false },
    ];
  }
  return detected.map((tool, index) => ({
    id: tool.id ?? tool.label ?? `runtime-tool-${index}`,
    label: tool.label ?? tool.id ?? "Runtime",
    executable: tool.executable,
    available: tool.availability === "available",
  }));
}
