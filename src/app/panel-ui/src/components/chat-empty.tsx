import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Paperclip,
  ShieldCheck,
  X,
} from "lucide-react";
import { compact, relativeTime } from "../text";
import type { ContextAttachment } from "../contracts/context";
import type { ConversationSummary } from "../contracts/conversation";
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
  readonly conversations?: readonly ConversationSummary[];
  readonly workspaceDirectory?: string;
  readonly pendingCount?: number;
  readonly onOpenConversation?: (conversationId: string) => void;
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
            <EmptyWorkbenchOverview
              conversations={props.conversations ?? []}
              workspaceDirectory={props.workspaceDirectory}
              pendingCount={props.pendingCount ?? 0}
              onOpenConversation={props.onOpenConversation}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

function EmptyWorkbenchOverview(props: {
  readonly conversations: readonly ConversationSummary[];
  readonly workspaceDirectory?: string;
  readonly pendingCount: number;
  readonly onOpenConversation?: (conversationId: string) => void;
}): React.ReactElement {
  const recentConversations = props.conversations.slice(0, 4);
  return (
    <div className="chat-empty-overview" aria-label="工作台概览">
      <div className="chat-empty-status-row">
        <WorkbenchStatusItem
          icon={<FolderOpen size={14} />}
          label="工作区"
          value={workspaceLabel(props.workspaceDirectory)}
        />
        <WorkbenchStatusItem
          icon={<ShieldCheck size={14} />}
          label="待确认"
          value={props.pendingCount > 0 ? `${props.pendingCount} 项` : "无"}
          tone={props.pendingCount > 0 ? "warning" : "neutral"}
        />
        <WorkbenchStatusItem
          icon={<CheckCircle2 size={14} />}
          label="会话"
          value={props.conversations.length > 0 ? `${props.conversations.length} 个记录` : "新会话"}
        />
      </div>

      {recentConversations.length > 0 && (
        <section className="chat-empty-recent" aria-label="最近会话">
          <div className="chat-empty-recent-heading">
            <Clock3 size={13} />
            <span>最近会话</span>
          </div>
          <div className="chat-empty-recent-list">
            {recentConversations.map((conversation) => (
              <button
                type="button"
                key={conversation.conversationId}
                onClick={() => props.onOpenConversation?.(conversation.conversationId)}
                disabled={props.onOpenConversation === undefined}
              >
                <span>{compact(conversation.title, 38)}</span>
                <small>{conversationSummaryMeta(conversation)}</small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function WorkbenchStatusItem(props: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "warning";
}): React.ReactElement {
  return (
    <div className={`chat-empty-status-item ${props.tone ?? "neutral"}`}>
      <span aria-hidden="true">{props.icon}</span>
      <div>
        <small>{props.label}</small>
        <strong>{props.value}</strong>
      </div>
    </div>
  );
}

function workspaceLabel(workspaceDirectory: string | undefined): string {
  const trimmed = workspaceDirectory?.trim();
  if (trimmed === undefined || trimmed.length === 0) return "未设置";
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return compact(segments.at(-1) ?? trimmed, 24);
}

function conversationSummaryMeta(conversation: ConversationSummary): string {
  const time = relativeTime(conversation.updatedAt);
  const status = statusLabel(conversation.status);
  return [status, time].filter((item) => item.length > 0).join(" · ") || "最近更新";
}

function statusLabel(status: string | undefined): string {
  if (status === "completed") return "已完成";
  if (status === "running" || status === "planning" || status === "queued") return "进行中";
  if (status === "approval_needed" || status === "needs_input") return "待确认";
  if (status === "failed" || status === "blocked") return "未完成";
  if (status === "paused") return "已暂停";
  if (status === "cancelled") return "已取消";
  return "";
}

export function ChatInputBar(props: ChatInputProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId);
  const canSend = props.value.trim().length > 0 && !props.busy;
  const canAddAttachment = props.attachmentValue.trim().length > 0 && !props.contextBusy;
  const modelGroups = useMemo(() => groupModels(props.models), [props.models]);

  useEffect(() => {
    setModelMenuOpen(false);
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
        placeholder={props.placeholder ?? "输入任务、问题或下一步指令..."}
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
              setContextOpen((value) => !value);
            }}
            aria-expanded={contextOpen}
          >
            <Paperclip size={14} />
            附件
          </button>
        </div>
        <div className="chat-input-right">
          {props.reasoningEffortEnabled && (
            <label className="composer-reasoning-control">
              <BrainCircuit size={14} />
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
          <div className="model-menu">
            <button
              type="button"
              className="model-select-button"
              onClick={() => {
                setContextOpen(false);
                setModelMenuOpen((value) => !value);
              }}
              aria-expanded={modelMenuOpen}
            >
              <span>{selectedModel?.name ?? "选择模型"}</span>
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
