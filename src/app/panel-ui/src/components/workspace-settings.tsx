import React, { useEffect, useRef } from "react";
import { SettingRow } from "./workspace-common";

export function WorkspaceSettings(props: {
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSave: (workspaceDirectory?: string) => void;
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
    <section className="settings-card">
      <h3>工作目录</h3>
      <SettingRow label="文件夹">
        <input
          value={props.workspaceDirectory}
          onChange={(event) => {
            const nextWorkspaceDirectory = event.target.value;
            props.setWorkspaceDirectory(nextWorkspaceDirectory);
            scheduleWorkspaceSave(nextWorkspaceDirectory);
          }}
        />
      </SettingRow>
      <p>这是助手可使用的本地上下文边界。模型仍按当前任务自主判断读取哪些授权材料。</p>
    </section>
  );
}
