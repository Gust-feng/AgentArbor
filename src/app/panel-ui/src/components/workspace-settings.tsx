import React, { useEffect, useRef } from "react";
import type { CommandShellConfig, CommandShellKind } from "../contracts/config";
import { SettingRow } from "./workspace-common";

export function WorkspaceSettings(props: {
  readonly commandShell?: CommandShellConfig;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSave: (workspaceDirectory?: string) => void;
  readonly onSaveCommandShell: (kind: CommandShellKind | "auto") => void;
}): React.ReactElement {
  const saveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function scheduleWorkspaceSave(nextWorkspaceDirectory: string): void {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      props.onSave(nextWorkspaceDirectory);
    }, 700);
  }

  return (
    <div className="workspace-settings-stack">
      <section className="settings-card">
        <h3>工作目录</h3>
        <SettingRow label="文件夹">
          <input
            value={props.workspaceDirectory}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => {
              const nextWorkspaceDirectory = event.target.value;
              props.setWorkspaceDirectory(nextWorkspaceDirectory);
              scheduleWorkspaceSave(nextWorkspaceDirectory);
            }}
          />
        </SettingRow>
      </section>
      <section className="settings-card">
        <h3>命令 Shell</h3>
        <SettingRow label="运行环境">
          <select
            value={props.commandShell?.kind ?? "auto"}
            onChange={(event) => props.onSaveCommandShell(commandShellKind(event.target.value))}
          >
            <option value="auto">自动</option>
            <option value="cmd">cmd</option>
            <option value="powershell">Windows PowerShell</option>
            <option value="pwsh">PowerShell</option>
            <option value="bash">Bash</option>
            <option value="sh">POSIX sh</option>
          </select>
        </SettingRow>
        <SettingRow label="当前执行">
          <span className="settings-value">{commandShellSummary(props.commandShell)}</span>
        </SettingRow>
      </section>
    </div>
  );
}

function commandShellKind(value: string): CommandShellKind | "auto" {
  return value === "cmd" ||
    value === "powershell" ||
    value === "pwsh" ||
    value === "bash" ||
    value === "sh"
    ? value
    : "auto";
}

function commandShellSummary(shell: CommandShellConfig | undefined): string {
  if (shell === undefined) {
    return "自动";
  }
  const label = shell.label ?? shell.kind ?? "自动";
  const executable = shell.executable;
  const syntax = shell.syntax;
  return [label, executable, syntax === undefined ? undefined : `语法：${syntax}`]
    .filter((item): item is string => item !== undefined && item.trim().length > 0)
    .join(" · ");
}
