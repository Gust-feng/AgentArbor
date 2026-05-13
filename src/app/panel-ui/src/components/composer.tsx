import React from "react";
import type { BasicAgentRun, ContextAttachment } from "../types";
import { terminalStatuses } from "../ui-state";

const TASK_EXAMPLES = [
  "总结这个文件，并列出需要我确认的风险",
  "检查当前项目结构，告诉我下一步应该先做什么",
  "搜索资料后整理成一份简短报告",
  "根据上下文起草一个可执行的工作清单",
] as const;

export function Composer(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly runMode: "agent" | "deep";
  readonly onRunModeChange: (mode: "agent" | "deep") => void;
  readonly aiMode: "none" | "fake" | "openai-compatible";
  readonly onAiModeChange: (mode: "none" | "fake" | "openai-compatible") => void;
  readonly attachments: readonly ContextAttachment[];
  readonly attachmentKind: ContextAttachment["kind"];
  readonly attachmentValue: string;
  readonly onAttachmentKindChange: (kind: ContextAttachment["kind"]) => void;
  readonly onAttachmentValueChange: (value: string) => void;
  readonly onAddAttachment: () => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
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
      <div className="task-examples" aria-label="常见任务示例">
        {TASK_EXAMPLES.map((example) => (
          <button type="button" key={example} onClick={() => props.onChange(example)}>
            {example}
          </button>
        ))}
      </div>
      <div className="composer-controls">
        <label>
          <span>处理方式</span>
          <select value={props.runMode} onChange={(event) => props.onRunModeChange(event.target.value === "deep" ? "deep" : "agent")}>
            <option value="agent">普通 Agent</option>
            <option value="deep">深入处理</option>
          </select>
        </label>
        {running && <button type="button" onClick={props.onCancel}>取消</button>}
        <button type="button" className="primary" disabled={props.busy || props.value.trim().length === 0} onClick={() => props.onSubmit(props.runMode)}>
          发送
        </button>
      </div>
      <details className="advanced-panel">
        <summary>高级</summary>
        <div className="advanced-form">
          <label>
            <span>模型模式</span>
            <select value={props.aiMode} onChange={(event) => props.onAiModeChange(event.target.value as "none" | "fake" | "openai-compatible")}>
              <option value="openai-compatible">真实模型</option>
              <option value="fake">测试模型</option>
              <option value="none">停用模型</option>
            </select>
          </label>
          <p className="mode-hint">
            普通 Agent 适合问答、阅读上下文和轻量工具任务；深入处理会进入更重的分析流程。
          </p>
        </div>
      </details>
      <details className="attachment-panel">
        <summary>附件与上下文{props.attachments.length > 0 ? ` · ${props.attachments.length}` : ""}</summary>
        <div className="attachment-form">
          <select value={props.attachmentKind} onChange={(event) => props.onAttachmentKindChange(event.target.value as ContextAttachment["kind"])}>
            <option value="workspace">当前工作区</option>
            <option value="file">文件</option>
            <option value="project">文件夹</option>
            <option value="web">网页</option>
          </select>
          <input
            value={props.attachmentValue}
            onChange={(event) => props.onAttachmentValueChange(event.target.value)}
            placeholder={props.attachmentKind === "web" ? "https://example.com/page" : props.attachmentKind === "workspace" ? "." : "相对当前工作区的路径"}
          />
          <button type="button" onClick={props.onAddAttachment}>添加</button>
        </div>
        {props.attachments.length > 0 && (
          <div className="attachment-list">
            {props.attachments.map((attachment) => (
              <article className={`attachment-chip ${attachment.status}`} key={attachment.attachmentId}>
                <div>
                  <strong>{attachment.title}</strong>
                  <small>{attachment.summary}</small>
                </div>
                <button type="button" aria-label={`移除 ${attachment.title}`} onClick={() => props.onRemoveAttachment(attachment.attachmentId)}>移除</button>
              </article>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
