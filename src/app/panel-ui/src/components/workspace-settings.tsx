import React, { useEffect, useRef, useState } from "react";
import type { CommandShellConfig, CommandShellKind, ConfiguredCommandShellKind } from "../contracts/config";
import { RuntimeEnvironmentSettings } from "./runtime-environment-settings";
import { SettingRow } from "./workspace-common";

export function WorkspaceSettings(props: {
  readonly commandShell?: CommandShellConfig;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSave: (workspaceDirectory?: string) => void;
  readonly savingCommandShell?: boolean;
  readonly onSaveCommandShell: (kind: ConfiguredCommandShellKind) => Promise<void> | void;
}): React.ReactElement {
  const saveTimerRef = useRef<number | undefined>(undefined);
  const commandShellSaveVersionRef = useRef(0);
  const persistedCommandShellKind = props.commandShell?.configuredKind ?? props.commandShell?.kind ?? "auto";
  const [selectedCommandShellKind, setSelectedCommandShellKind] = useState<ConfiguredCommandShellKind>(persistedCommandShellKind);

  useEffect(() => {
    setSelectedCommandShellKind(persistedCommandShellKind);
  }, [persistedCommandShellKind]);

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

  function saveCommandShell(nextKind: ConfiguredCommandShellKind): void {
    const saveVersion = commandShellSaveVersionRef.current + 1;
    commandShellSaveVersionRef.current = saveVersion;
    setSelectedCommandShellKind(nextKind);
    void Promise.resolve(props.onSaveCommandShell(nextKind)).catch(() => {
      if (commandShellSaveVersionRef.current === saveVersion) {
        setSelectedCommandShellKind(persistedCommandShellKind);
      }
    });
  }

  const commandShellPending = props.savingCommandShell === true && selectedCommandShellKind !== persistedCommandShellKind;

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
            aria-busy={commandShellPending ? "true" : undefined}
            value={selectedCommandShellKind}
            onChange={(event) => saveCommandShell(commandShellKind(event.target.value))}
          >
            <option value="auto">自动</option>
            {commandShellOptions(props.commandShell).map((option) => (
              <option key={option.kind} value={option.kind} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label="当前执行">
          <span className="settings-value">{commandShellSummary(props.commandShell, commandShellPending ? selectedCommandShellKind : undefined)}</span>
        </SettingRow>
      </section>
      <RuntimeEnvironmentSettings tools={props.commandShell?.runtimeTools} />
    </div>
  );
}

function commandShellKind(value: string): ConfiguredCommandShellKind {
  return value === "cmd" ||
    value === "powershell" ||
    value === "pwsh" ||
    value === "bash" ||
    value === "sh"
    ? value
    : "auto";
}

function commandShellOptions(shell: CommandShellConfig | undefined): readonly {
  readonly kind: CommandShellKind;
  readonly label: string;
  readonly disabled: boolean;
}[] {
  const detected = shell?.availableShells?.filter((option): option is {
    readonly kind: CommandShellKind;
    readonly label?: string;
    readonly availability?: "available" | "missing";
  } => option.kind === "cmd" ||
    option.kind === "powershell" ||
    option.kind === "pwsh" ||
    option.kind === "bash" ||
    option.kind === "sh");
  if (detected !== undefined && detected.length > 0) {
    return detected.map((option) => ({
      kind: option.kind,
      label: option.label ?? defaultShellOptionLabel(option.kind),
      disabled: option.availability === "missing" && option.kind !== shell?.configuredKind,
    }));
  }
  return [
    { kind: "cmd", label: "cmd", disabled: false },
    { kind: "powershell", label: "Windows PowerShell", disabled: false },
    { kind: "pwsh", label: "PowerShell", disabled: false },
    { kind: "bash", label: "Bash", disabled: false },
    { kind: "sh", label: "POSIX sh", disabled: false },
  ];
}

function commandShellSummary(shell: CommandShellConfig | undefined, pendingKind?: ConfiguredCommandShellKind): string {
  if (pendingKind !== undefined) {
    return `保存中：${defaultShellOptionLabel(pendingKind)}`;
  }
  if (shell === undefined) {
    return "自动";
  }
  const label = shell.label ?? shell.kind ?? "自动";
  const executable = shell.executable;
  const syntax = shell.syntax;
  const mode = shell.configuredKind === "auto" || shell.autoDetected === true ? "自动" : undefined;
  return [mode, label, executable, syntax === undefined ? undefined : `语法：${syntax}`]
    .filter((item): item is string => item !== undefined && item.trim().length > 0)
    .join(" · ");
}

function defaultShellOptionLabel(kind: ConfiguredCommandShellKind): string {
  if (kind === "auto") return "自动";
  if (kind === "cmd") return "cmd";
  if (kind === "powershell") return "Windows PowerShell";
  if (kind === "pwsh") return "PowerShell";
  if (kind === "bash") return "Bash";
  return "POSIX sh";
}
