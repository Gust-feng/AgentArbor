import React from "react";
import type { BasicAgentRun } from "../types";
import { terminalStatuses } from "../ui-state";

export function Composer(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly runMode: "agent" | "deep";
  readonly onRunModeChange: (mode: "agent" | "deep") => void;
  readonly aiMode: "none" | "fake" | "openai-compatible";
  readonly onAiModeChange: (mode: "none" | "fake" | "openai-compatible") => void;
  readonly busy: boolean;
  readonly run?: BasicAgentRun;
  readonly onSubmit: (mode: "agent" | "deep") => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const running = props.run !== undefined && !terminalStatuses.has(props.run.status);
  return (
    <section className="composer" aria-label="任务输入">
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            props.onSubmit(props.runMode);
          }
        }}
        placeholder="问任何问题，或交给我一个任务"
        rows={2}
      />
      <div className="composer-controls">
        <select value={props.runMode} onChange={(event) => props.onRunModeChange(event.target.value === "deep" ? "deep" : "agent")}>
          <option value="agent">普通 Agent</option>
          <option value="deep">深入处理</option>
        </select>
        <select value={props.aiMode} onChange={(event) => props.onAiModeChange(event.target.value as "none" | "fake" | "openai-compatible")}>
          <option value="openai-compatible">真实模型</option>
          <option value="fake">测试模型</option>
          <option value="none">停用模型</option>
        </select>
        {running && <button type="button" onClick={props.onCancel}>取消</button>}
        <button type="button" className="primary" disabled={props.busy || props.value.trim().length === 0} onClick={() => props.onSubmit(props.runMode)}>
          发送
        </button>
      </div>
    </section>
  );
}
