import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  BrainCircuit,
  SlidersHorizontal,
  Paperclip,
  X,
} from "lucide-react";
import { compact } from "../text";
import type { ContextAttachment } from "../contracts/context";
import type { ModelProviderIdentity } from "../model-provider-logos";

export type ChatModelOption = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly providerIdentity: ModelProviderIdentity;
  readonly profileId: string;
  readonly modelId: string;
  readonly iconSvg?: string;
};

type AttachmentInputProps = {
  readonly attachments: readonly ContextAttachment[];
  readonly attachmentKind: ContextAttachment["kind"];
  readonly attachmentValue: string;
  readonly onAttachmentKindChange: (kind: ContextAttachment["kind"]) => void;
  readonly onAttachmentValueChange: (value: string) => void;
  readonly onAddAttachment: () => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly contextBusy?: boolean;
};

export type ChatInputProps = AttachmentInputProps & {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly busy: boolean;
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly reasoningEffort: "" | "low" | "medium" | "high";
  readonly reasoningEffortEnabled: boolean;
  readonly onReasoningEffortChange: (value: "" | "low" | "medium" | "high") => void;
  readonly onModelSelect: (modelId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onSubmit: () => void;
  readonly onCancel?: () => void;
  readonly running?: boolean;
  readonly placeholder?: string;
  readonly variant?: "embedded" | "floating";
  readonly closeSignal?: number;
};

export function ChatEmpty(props: ChatInputProps & {
  readonly error?: string;
}): React.ReactElement {
  return (
    <div className="chat-empty-screen">
      <main className="chat-empty-main">
        <div className="chat-empty-grid">
          <section className="chat-empty-copy" aria-label="任务输入">
            <h1>今天要处理什么？</h1>
            {props.error && <div className="system-error-line">{props.error}</div>}
            <ChatInputBar
              {...props}
              variant="embedded"
              placeholder="输入任务..."
            />
          </section>
        </div>
      </main>
    </div>
  );
}

export function ChatInputBar(props: ChatInputProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId);
  const canSend = props.value.trim().length > 0 && !props.busy;
  const canAddAttachment = props.attachmentValue.trim().length > 0 && !props.contextBusy;
  const modelGroups = useMemo(() => groupModels(props.models), [props.models]);

  useEffect(() => {
    setModelMenuOpen(false);
    setOptionsOpen(false);
    setContextOpen(false);
  }, [props.closeSignal]);

  const inputCard = (
    <div className={`chat-input-card ${focused ? "focused" : ""}`}>
      {props.attachments.length > 0 && (
        <div className="attachment-row">
          {props.attachments.map((attachment) => (
            <span className={`attachment-pill ${attachment.status === "blocked" ? "blocked" : ""}`} key={attachment.attachmentId}>
              <span>
                <strong>{attachment.title}</strong>
                <small>{compact(attachment.summary, 48)}</small>
              </span>
              <button type="button" onClick={() => props.onRemoveAttachment(attachment.attachmentId)} aria-label={`移除${attachment.title}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            props.onSubmit();
          }
        }}
        rows={3}
        placeholder={props.placeholder ?? "输入任务..."}
        disabled={props.busy}
        className="chat-input-textarea"
      />
      <div className="chat-input-toolbar">
        <div className="chat-input-left">
          <button
            type="button"
            className="composer-tool-button"
            onClick={() => {
              setModelMenuOpen(false);
              setOptionsOpen(false);
              setContextOpen((value) => !value);
            }}
            aria-expanded={contextOpen}
          >
            <Paperclip size={14} />
            附件
          </button>
        </div>
        <div className="chat-input-right">
          <div className="composer-options-menu">
            <button
              type="button"
              className="composer-options-button"
              onClick={() => {
                setContextOpen(false);
                setModelMenuOpen(false);
                setOptionsOpen((value) => !value);
              }}
              aria-expanded={optionsOpen}
            >
              <SlidersHorizontal size={14} />
              <span>选项</span>
            </button>
            {optionsOpen && (
              <div className="composer-options-popover" aria-label="输入选项">
                {props.reasoningEffortEnabled && (
                  <label className="composer-reasoning-control">
                    <span>
                      <BrainCircuit size={14} />
                      思考强度
                    </span>
                    <select
                      aria-label="思考强度"
                      value={props.reasoningEffort}
                      onChange={(event) => props.onReasoningEffortChange(event.target.value as "" | "low" | "medium" | "high")}
                    >
                      <option value="">自动</option>
                      <option value="low">轻量</option>
                      <option value="medium">标准</option>
                      <option value="high">深入</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="composer-model-summary"
                  onClick={() => setModelMenuOpen((value) => !value)}
                  aria-expanded={modelMenuOpen}
                >
                  <span>模型</span>
                  <strong>{selectedModel?.name ?? "选择模型"}</strong>
                </button>
                {modelMenuOpen && (
                  <div className="model-menu-popover" role="listbox" aria-label="选择模型">
                    {modelGroups.length === 0 && (
                      <div className="model-menu-empty">
                        <span>未配置模型</span>
                        <button
                          type="button"
                          onClick={() => {
                            setModelMenuOpen(false);
                            setOptionsOpen(false);
                            props.onOpenSettings();
                          }}
                        >
                          配置模型
                        </button>
                      </div>
                    )}
                    {modelGroups.map((group) => (
                      <section key={group.label}>
                        <h3>{group.label}</h3>
                        {group.items.map((model) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={model.id === props.selectedModelId}
                            className={model.id === props.selectedModelId ? "selected" : ""}
                            key={model.id}
                            onClick={() => {
                              props.onModelSelect(model.id);
                              setModelMenuOpen(false);
                              setOptionsOpen(false);
                            }}
                          >
                            <span className="model-option-icon" aria-hidden="true">
                              {model.iconSvg === undefined ? <BrainCircuit size={14} /> : <span dangerouslySetInnerHTML={{ __html: model.iconSvg }} />}
                            </span>
                            <span className="model-option-copy">
                              <strong>{model.name}</strong>
                              <small>{model.providerLabel}</small>
                            </span>
                          </button>
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {props.running && (
            <button type="button" className="composer-cancel-button" onClick={props.onCancel}>
              取消
            </button>
          )}
          <button
            type="button"
            className="composer-send-button"
            onClick={props.onSubmit}
            disabled={!canSend}
            aria-label="发送"
          >
            {props.busy ? <span className="spinner" /> : <ArrowUp size={15} />}
          </button>
        </div>
      </div>
      {contextOpen && (
        <div className="context-popover">
          <div className="context-kind-row">
            {ATTACHMENT_KINDS.map((kind) => (
              <button
                type="button"
                className={props.attachmentKind === kind ? "selected" : ""}
                key={kind}
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
            <button type="button" onClick={props.onAddAttachment} disabled={!canAddAttachment}>
              {props.contextBusy ? "添加中" : "添加"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (props.variant === "embedded") {
    return inputCard;
  }

  return (
    <div className="chat-input-floating">
      <div className="chat-input-floating-inner">{inputCard}</div>
    </div>
  );
}

function groupModels(models: readonly ChatModelOption[]): readonly { readonly label: string; readonly items: readonly ChatModelOption[] }[] {
  const groups = new Map<string, ChatModelOption[]>();
  for (const model of models) {
    const label = model.providerLabel === model.name ? "模型服务" : model.providerLabel;
    groups.set(label, [...(groups.get(label) ?? []), model]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function attachmentPlaceholder(kind: ContextAttachment["kind"]): string {
  if (kind === "web") return "粘贴网页链接";
  if (kind === "workspace") return ".";
  if (kind === "project") return "相对当前工作区的文件夹路径";
  return "相对当前工作区的文件路径";
}

const ATTACHMENT_KIND_LABELS: Record<ContextAttachment["kind"], string> = {
  workspace: "工作区",
  file: "文件",
  project: "文件夹",
  web: "网页",
};

const ATTACHMENT_KINDS: readonly ContextAttachment["kind"][] = ["workspace", "file", "project", "web"];
