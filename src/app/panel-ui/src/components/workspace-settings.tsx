import React, { useEffect, useRef } from "react";
import { FolderOpen, RotateCcw } from "lucide-react";
import type { CommandShellConfig, ConfiguredCommandShellKind } from "../contracts/config";
import { RuntimeEnvironmentSettings } from "./runtime-environment-settings";
import { SettingRow } from "./workspace-common";

const LazyCommandShellSelection = React.lazy(async () => {
  const module = await import("./command-shell-selection");
  return { default: module.CommandShellSelection };
});

export function WorkspaceSettings(props: {
  readonly commandShell?: CommandShellConfig;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSave: (workspaceDirectory?: string) => void;
  readonly onSelectDirectory: () => void;
  readonly savingCommandShell?: boolean;
  readonly onSaveCommandShell: (kind: ConfiguredCommandShellKind) => Promise<void> | void;
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

  function saveWorkspaceNow(nextWorkspaceDirectory: string): void {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    props.setWorkspaceDirectory(nextWorkspaceDirectory);
    props.onSave(nextWorkspaceDirectory);
  }

  return (
    <div className="workspace-settings-stack">
      <section className="settings-card">
        <h3>工作目录</h3>
        <SettingRow label="文件夹">
          <div className="workspace-directory-field">
            <input
              value={props.workspaceDirectory}
              placeholder="未选择时使用默认目录"
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
            <div className="workspace-directory-actions">
              <button
                type="button"
                className="page-action-button"
                title="选择文件夹"
                onClick={props.onSelectDirectory}
                disabled={props.savingCommandShell}
              >
                <FolderOpen size={14} />
                <span>选择</span>
              </button>
              <button
                type="button"
                className="page-action-button"
                title="使用默认目录"
                onClick={() => saveWorkspaceNow("")}
                disabled={props.savingCommandShell}
              >
                <RotateCcw size={14} />
                <span>默认</span>
              </button>
            </div>
          </div>
        </SettingRow>
      </section>
      <React.Suspense fallback={<CommandShellSelectionFallback />}>
        <LazyCommandShellSelection
          commandShell={props.commandShell}
          savingCommandShell={props.savingCommandShell}
          onSaveCommandShell={props.onSaveCommandShell}
        />
      </React.Suspense>
      <RuntimeEnvironmentSettings tools={props.commandShell?.runtimeTools} />
    </div>
  );
}

function CommandShellSelectionFallback(): React.ReactElement {
  return (
    <section className="settings-card" aria-busy="true">
      <h3>命令 Shell</h3>
      <SettingRow label="运行环境">
        <select value="" disabled aria-label="命令 Shell 选择加载中">
          <option value="">正在载入</option>
        </select>
      </SettingRow>
      <SettingRow label="当前执行">
        <span className="settings-value">正在载入 Shell 选择</span>
      </SettingRow>
    </section>
  );
}
