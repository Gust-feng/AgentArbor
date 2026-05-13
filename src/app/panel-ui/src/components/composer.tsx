import React from "react";
import { TASK_EXAMPLES } from "../text";
import type { BasicAgentRun, ContextAttachment } from "../types";
import { terminalStatuses } from "../ui-state";

const ATTACHMENT_KIND_LABELS: Record<ContextAttachment["kind"], string> = {
  workspace: "工作区",
  file: "文件",
  project: "文件夹",
  web: "网页",
};

const ATTACHMENT_KINDS: readonly ContextAttachment["kind"][] = ["workspace", "file", "project", "web"];

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
  const canAddAttachment = props.attachmentValue.trim().length > 0;
  return (
    <section className="composer" aria-label="任务输入">
      <div className="command-composer-header">
        <div>
          <span className="eyebrow">任务与上下文</span>
          <strong>先告诉我目标，再指出可以参考的材料。</strong>
        </div>
        <span className="composer-mode-note">{props.runMode === "deep" ? "深入处理" : "普通任务"}</span>
      </div>
      <div className="context-dock" aria-label="上下文入口">
        <div className="context-kind-switch" aria-label="上下文类型">
          {ATTACHMENT_KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={props.attachmentKind === kind ? "selected" : ""}
              onClick={() => props.onAttachmentKindChange(kind)}
            >
              {ATTACHMENT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <div className="context-add-row">
          <input
            value={props.attachmentValue}
            onChange={(event) => props.onAttachmentValueChange(event.target.value)}
            placeholder={attachmentPlaceholder(props.attachmentKind)}
          />
          <button type="button" disabled={!canAddAttachment} onClick={props.onAddAttachment}>添加上下文</button>
        </div>
        {props.attachments.length > 0 && (
          <div className="attachment-list compact">
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
      </div>
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
        rows={3}
      />
      <div className="task-examples" aria-label="常见任务示例">
        {TASK_EXAMPLES.map((example) => (
          <button type="button" key={example} onClick={() => props.onChange(example)}>
            {example}
          </button>
        ))}
      </div>
      <div className="composer-controls">
        {running && <button type="button" onClick={props.onCancel}>取消</button>}
        <button type="button" className="primary" disabled={props.busy || props.value.trim().length === 0} onClick={() => props.onSubmit(props.runMode)}>
          {props.busy ? "启动中" : "开始任务"}
        </button>
      </div>
      <details className="advanced-panel">
        <summary>高级设置</summary>
        <div className="advanced-form">
          <label>
            <span>处理方式</span>
            <select value={props.runMode} onChange={(event) => props.onRunModeChange(event.target.value === "deep" ? "deep" : "agent")}>
              <option value="agent">普通任务</option>
              <option value="deep">深入处理</option>
            </select>
          </label>
          <label>
            <span>模型模式</span>
            <select value={props.aiMode} onChange={(event) => props.onAiModeChange(event.target.value as "none" | "fake" | "openai-compatible")}>
              <option value="openai-compatible">真实模型</option>
              <option value="fake">测试模型</option>
              <option value="none">停用模型</option>
            </select>
          </label>
          <p className="mode-hint">
            普通任务适合问答、阅读上下文和轻量工具任务；深入处理只在你明确需要多步分析时使用。
          </p>
        </div>
      </details>
    </section>
  );
}

function attachmentPlaceholder(kind: ContextAttachment["kind"]): string {
  if (kind === "web") return "https://example.com/page";
  if (kind === "workspace") return ".";
  if (kind === "project") return "相对当前工作区的文件夹路径";
  return "相对当前工作区的文件路径";
}
