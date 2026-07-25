import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Paperclip,
  PencilLine,
  ShieldCheck,
  X,
} from "lucide-react";
import { compact } from "../text";
import type { AgentMode, ComposerToolConfirmationPolicy } from "../app-config-projection";
import type { ContextAttachment } from "../contracts/context";
import type { ModelCapabilities } from "../contracts/config";
import { modelCapabilitySummary } from "../model-capability-display";
import type { ModelProviderIdentity } from "../model-provider-logos";
import type { ContextWindowUsage } from "../context-window-usage";
import { DevelopmentDataNotice } from "./development-data-notice";

type ComposerChipFeedback = "model" | "reasoning" | "access";

const COMPOSER_CHIP_FEEDBACK_MS = 540;
const EMPTY_HEADING = "今天想处理什么？";
const MULTI_AGENT_EMPTY_HEADING = "Agent 集群";
const MULTI_AGENT_EMPTY_HINT = "适合方向不明确、需要比较多个可能方案的任务。";
const MULTI_AGENT_PLACEHOLDER = "输入需要比较或判断的目标...";

export type ChatModelOption = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly providerIdentity: ModelProviderIdentity;
  readonly profileId: string;
  readonly modelId: string;
  readonly capabilities?: ModelCapabilities;
  readonly iconSvg?: string;
};

export type QueuedChatMessage = {
  readonly id: string;
  readonly content: string;
};

type AttachmentInputProps = {
  readonly attachments: readonly ContextAttachment[];
  readonly selectedWorkspaceDirectory?: string;
  readonly onSelectWorkspaceDirectory?: () => void;
  readonly onSelectAttachment: () => void;
  readonly onUploadAttachmentFiles?: (files: readonly File[]) => void | Promise<void>;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly contextBusy?: boolean;
};

export type ChatInputProps = AttachmentInputProps & {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly busy: boolean;
  readonly allowInputWhileBusy?: boolean;
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly contextUsage?: ContextWindowUsage;
  readonly reasoningEffort: "" | "low" | "medium" | "high";
  readonly reasoningEffortEnabled: boolean;
  readonly onReasoningEffortChange: (value: "" | "low" | "medium" | "high") => void;
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly onToolConfirmationPolicyChange: (value: ComposerToolConfirmationPolicy) => void;
  readonly onModelSelect: (modelId: string) => void | Promise<void>;
  readonly onOpenSettings: () => void;
  readonly onSubmit: () => void;
  readonly onCancel?: () => void;
  readonly cancelLabel?: string;
  readonly autoFocus?: boolean;
  readonly running?: boolean;
  readonly agentMode?: AgentMode;
  readonly placeholder?: string;
  readonly variant?: "embedded" | "floating";
  readonly queuedMessages?: readonly QueuedChatMessage[];
  readonly onRemoveQueuedMessage?: (id: string) => void;
  readonly onUpdateQueuedMessage?: (id: string, content: string) => void;
  readonly closeSignal?: number;
};

export function ChatEmpty(props: ChatInputProps & {
  readonly error?: string;
}): React.ReactElement {
  const isDeep = props.agentMode === "deep";
  return (
    <div className="chat-empty-screen" data-agent-mode={props.agentMode ?? "normal"}>
      <main className="chat-empty-main">
        <div className="chat-empty-grid">
          <section className="chat-empty-copy" aria-label="任务输入">
            {isDeep && (
              <span className="chat-empty-mode-badge" data-mode="deep">Agent 集群</span>
            )}
            <h1 className="chat-empty-heading">
              <span className="chat-empty-heading-title" data-startup-title-anchor>
                {isDeep ? MULTI_AGENT_EMPTY_HEADING : EMPTY_HEADING}
              </span>
            </h1>
            {isDeep && (
              <p className="chat-empty-subheading">{MULTI_AGENT_EMPTY_HINT}</p>
            )}
            {props.error && <div className="system-error-line">{props.error}</div>}
            {!isDeep && <DevelopmentDataNotice dismissible />}
            {!isDeep && (
              <div className="chat-empty-composer">
                <ChatInputBar {...props} variant="embedded" placeholder="输入任务..." />
              </div>
            )}
          </section>
        </div>
      </main>
      {isDeep && <ChatInputBar {...props} variant="floating" placeholder={MULTI_AGENT_PLACEHOLDER} />}
    </div>
  );
}

export function ChatInputBar(props: ChatInputProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const didAutoFocusRef = useRef(false);
  const previousBusyRef = useRef(props.busy);
  const chipFeedbackTimerRef = useRef<number | undefined>(undefined);
  const previousChipValuesRef = useRef({
    modelId: props.selectedModelId,
    reasoningEffort: props.reasoningEffort,
    toolConfirmationPolicy: props.toolConfirmationPolicy,
  });
  const [focused, setFocused] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [confirmedChip, setConfirmedChip] = useState<ComposerChipFeedback | undefined>();
  const [fileDragOver, setFileDragOver] = useState(false);
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId);
  const canSend = props.value.trim().length > 0 && (!props.busy || props.allowInputWhileBusy === true);
  const modelGroups = useMemo(() => groupModels(props.models), [props.models]);
  const canUploadAttachments = props.onUploadAttachmentFiles !== undefined && props.contextBusy !== true;
  const hasTaskWorkspace = props.selectedWorkspaceDirectory !== undefined;

  function showChipFeedback(target: ComposerChipFeedback): void {
    if (chipFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(chipFeedbackTimerRef.current);
    }
    setConfirmedChip(target);
    chipFeedbackTimerRef.current = window.setTimeout(() => {
      setConfirmedChip(undefined);
      chipFeedbackTimerRef.current = undefined;
    }, COMPOSER_CHIP_FEEDBACK_MS);
  }

  useEffect(() => {
    const previous = previousChipValuesRef.current;
    if (previous.modelId !== props.selectedModelId) {
      showChipFeedback("model");
    } else if (previous.reasoningEffort !== props.reasoningEffort) {
      showChipFeedback("reasoning");
    } else if (previous.toolConfirmationPolicy !== props.toolConfirmationPolicy) {
      showChipFeedback("access");
    }
    previousChipValuesRef.current = {
      modelId: props.selectedModelId,
      reasoningEffort: props.reasoningEffort,
      toolConfirmationPolicy: props.toolConfirmationPolicy,
    };
  }, [props.selectedModelId, props.reasoningEffort, props.toolConfirmationPolicy]);

  useEffect(() => {
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);
    setAccessMenuOpen(false);
  }, [props.closeSignal]);

  useEffect(() => {
    return () => {
      if (chipFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(chipFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!modelMenuOpen && !reasoningMenuOpen && !accessMenuOpen) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent): void {
      const root = composerRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        closeComposerPanels();
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeComposerPanels();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelMenuOpen, reasoningMenuOpen, accessMenuOpen]);

  useEffect(() => {
    if (props.autoFocus === false) {
      return;
    }
    if (props.busy) {
      previousBusyRef.current = true;
      return;
    }
    const shouldFocus = !didAutoFocusRef.current || previousBusyRef.current;
    if (!shouldFocus || modelMenuOpen || reasoningMenuOpen || accessMenuOpen) return;
    const node = textareaRef.current;
    if (node === null || node.disabled) return;
    const focusFrame = window.requestAnimationFrame(() => node.focus());
    didAutoFocusRef.current = true;
    previousBusyRef.current = false;
    return () => window.cancelAnimationFrame(focusFrame);
  }, [props.autoFocus, props.busy, modelMenuOpen, reasoningMenuOpen, accessMenuOpen]);

  function closeComposerPanels(): void {
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);
    setAccessMenuOpen(false);
  }

  function uploadFiles(files: readonly File[]): void {
    if (files.length === 0 || props.onUploadAttachmentFiles === undefined || props.contextBusy === true) {
      return;
    }
    Promise.resolve(props.onUploadAttachmentFiles(files)).catch(() => {
      // The app controller projects the failure into the shared error line.
    });
  }

  function handleFileDrag(event: React.DragEvent<HTMLDivElement>): void {
    if (!dragHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = canUploadAttachments ? "copy" : "none";
    setFileDragOver(true);
  }

  function handleFileDragLeave(event: React.DragEvent<HTMLDivElement>): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setFileDragOver(false);
  }

  function handleFileDrop(event: React.DragEvent<HTMLDivElement>): void {
    if (!dragHasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setFileDragOver(false);
    uploadFiles(filesFromFileList(event.dataTransfer.files));
  }

  function handleTextPaste(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const files = filesFromClipboard(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    uploadFiles(files);
  }

  function selectModel(modelId: string): void {
    if (modelId === props.selectedModelId) {
      setModelMenuOpen(false);
      return;
    }
    setModelMenuOpen(false);
    Promise.resolve(props.onModelSelect(modelId)).catch(() => {
      // The app controller projects the failure into the shared error line.
    });
  }

  const inputCard = (
    <div
      className={`chat-input-card ${focused ? "focused" : ""} ${fileDragOver ? "drag-over" : ""}`}
      onDragEnter={handleFileDrag}
      onDragOver={handleFileDrag}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {props.attachments.length > 0 && (
        <div className="attachment-row">
          {props.attachments.map((attachment) => {
            const mediaPreview = attachmentMediaPreview(attachment);
            if (mediaPreview !== undefined) {
              return (
                <span
                  className={`attachment-pill attachment-image-card ${attachment.status === "blocked" ? "blocked" : ""}`}
                  key={attachment.attachmentId}
                >
                  <span className="attachment-image-thumbnail">
                    <img
                      src={mediaPreview.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                  <span className="attachment-image-copy">
                    <strong>{attachment.title}</strong>
                    <small>{compact(attachmentImageSummary(attachment), 56)}</small>
                  </span>
                  <button type="button" onClick={() => props.onRemoveAttachment(attachment.attachmentId)} aria-label={`移除${attachment.title}`}>
                    <X size={12} />
                  </button>
                </span>
              );
            }
            return (
              <span className={`attachment-pill ${attachment.status === "blocked" ? "blocked" : ""}`} key={attachment.attachmentId}>
                <span>
                  <strong>{attachment.title}</strong>
                  <small>{compact(attachment.summary, 48)}</small>
                </span>
                <button type="button" onClick={() => props.onRemoveAttachment(attachment.attachmentId)} aria-label={`移除${attachment.title}`}>
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={props.value}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(event) => props.onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={handleTextPaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            props.onSubmit();
          }
        }}
        rows={2}
        placeholder={props.placeholder ?? "输入任务..."}
        disabled={props.busy && props.allowInputWhileBusy !== true}
        className="chat-input-textarea"
      />
      <div className="chat-input-toolbar">
        <div className="chat-input-left">
          <div className="composer-options-menu">
            <button
              type="button"
              className={`composer-options-button composer-model-chip ${confirmedChip === "model" ? "is-confirmed" : ""}`}
              onClick={() => {
                setModelMenuOpen((value) => !value);
                setReasoningMenuOpen(false);
                setAccessMenuOpen(false);
              }}
              aria-expanded={modelMenuOpen}
            >
              <span>{selectedModel?.name ?? "选择模型"}</span>
            </button>
            {modelMenuOpen && (
              <div className="composer-options-popover composer-model-popover" aria-label="选择模型">
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
                      {group.items.map((model) => {
                        const capabilitySummary = modelCapabilitySummary(model.capabilities);
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={model.id === props.selectedModelId}
                            className={model.id === props.selectedModelId ? "selected" : ""}
                            key={model.id}
                            onClick={() => void selectModel(model.id)}
                          >
                            <span className="model-option-icon" aria-hidden="true">
                              {model.iconSvg === undefined ? (
                                <span className="model-option-initial">{modelOptionInitial(model)}</span>
                              ) : (
                                <span dangerouslySetInnerHTML={{ __html: model.iconSvg }} />
                              )}
                            </span>
                            <span className="model-option-copy">
                              <strong>{model.name}</strong>
                              {capabilitySummary !== undefined && <small>{capabilitySummary}</small>}
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  ))}
                </div>
              </div>
            )}
          </div>
          {props.reasoningEffortEnabled && (
            <div className="composer-options-menu">
              <button
                type="button"
                className={`composer-options-button composer-reasoning-chip ${confirmedChip === "reasoning" ? "is-confirmed" : ""}`}
                onClick={() => {
                  setModelMenuOpen(false);
                  setReasoningMenuOpen((value) => !value);
                  setAccessMenuOpen(false);
                }}
                aria-expanded={reasoningMenuOpen}
                aria-label="思考强度"
              >
                <span className="composer-reasoning-prefix">思考</span>
                <span>{reasoningEffortLabel(props.reasoningEffort)}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {reasoningMenuOpen && (
                <div className="composer-options-popover composer-reasoning-popover" role="menu" aria-label="思考强度">
                  {REASONING_EFFORT_OPTIONS.map((option) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={props.reasoningEffort === option.value}
                      className={props.reasoningEffort === option.value ? "selected" : ""}
                      key={option.value}
                      onClick={() => {
                        props.onReasoningEffortChange(option.value);
                        setReasoningMenuOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      <small>{option.description}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="composer-options-menu">
            <button
              type="button"
              className={`composer-options-button composer-access-chip ${props.toolConfirmationPolicy === "full_access" ? "full-access" : ""} ${confirmedChip === "access" ? "is-confirmed" : ""}`}
              onClick={() => {
                setModelMenuOpen(false);
                setReasoningMenuOpen(false);
                setAccessMenuOpen((value) => !value);
              }}
              aria-expanded={accessMenuOpen}
              aria-label="访问模式"
            >
              <ShieldCheck size={13} aria-hidden="true" />
              <span>{toolAccessPolicyLabel(props.toolConfirmationPolicy)}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {accessMenuOpen && (
              <div className="composer-options-popover composer-access-popover" role="menu" aria-label="访问模式">
                {TOOL_ACCESS_OPTIONS.map((option) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={props.toolConfirmationPolicy === option.value}
                    className={props.toolConfirmationPolicy === option.value ? "selected" : ""}
                    key={option.value}
                    onClick={() => {
                      props.onToolConfirmationPolicyChange(option.value);
                      setAccessMenuOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          {props.contextUsage !== undefined && (
            <span
              className="composer-context-usage"
              data-source={props.contextUsage.source}
              data-tone={props.contextUsage.tone}
              role="img"
              aria-label={props.contextUsage.label}
            >
              <svg className="composer-context-usage-svg" viewBox="0 0 20 20" aria-hidden="true">
                <circle className="composer-context-usage-track" cx="10" cy="10" r="7" />
                <circle
                  className="composer-context-usage-meter"
                  cx="10"
                  cy="10"
                  r="7"
                  pathLength={100}
                  strokeDasharray={contextUsageDashArray(props.contextUsage)}
                />
              </svg>
              <span className="composer-context-usage-tooltip" role="tooltip">
                {props.contextUsage.label}
              </span>
            </span>
          )}
        </div>
        <div className="chat-input-right">
          {props.onSelectWorkspaceDirectory !== undefined && (
            <button
              type="button"
              className="composer-tool-button composer-workspace-button"
              onClick={() => {
                closeComposerPanels();
                props.onSelectWorkspaceDirectory?.();
              }}
              disabled={props.contextBusy === true}
              aria-label={hasTaskWorkspace ? "更换当前工作空间" : "选择工作空间"}
            >
              <FolderOpen size={18} aria-hidden="true" />
              <span className="composer-workspace-label">
                {hasTaskWorkspace ? workspaceDirectoryLabel(props.selectedWorkspaceDirectory) : "选择工作空间"}
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="composer-tool-button composer-icon-button"
            onClick={() => {
              closeComposerPanels();
              props.onSelectAttachment();
            }}
            disabled={props.contextBusy === true}
            aria-label="添加附件"
          >
            <Paperclip size={18} />
          </button>
          {props.running && (
            <button type="button" className="composer-cancel-button" onClick={props.onCancel}>
              {props.cancelLabel ?? "取消"}
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
    </div>
  );

  const variant = props.variant ?? "embedded";
  const hasQueuedMessages = props.queuedMessages !== undefined && props.queuedMessages.length > 0;
  const composer = (
    <div ref={composerRef} className={`chat-composer-shell chat-composer-${variant}${hasQueuedMessages ? " has-message-queue" : ""}`}>
      {hasQueuedMessages && (
        <MessageQueue
          messages={props.queuedMessages ?? []}
          onRemove={props.onRemoveQueuedMessage ?? (() => {})}
          onUpdate={props.onUpdateQueuedMessage ?? (() => {})}
        />
      )}
      {inputCard}
    </div>
  );

  if (variant === "embedded") {
    return composer;
  }

  return (
    <div className="chat-input-floating">
      <div className="chat-input-floating-inner">{composer}</div>
    </div>
  );
}

function MessageQueue(props: {
  readonly messages: readonly QueuedChatMessage[];
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (id: string, content: string) => void;
}): React.ReactElement {
  return (
    <div className="message-queue" role="list" aria-label="待发送消息队列">
      <div className="message-queue-header">
        <span>待发送</span>
        <span className="message-queue-count">{props.messages.length}</span>
      </div>
      <div className="message-queue-items">
        {props.messages.map((message) => (
          <MessageQueueItem
            key={message.id}
            message={message}
            onRemove={props.onRemove}
            onUpdate={props.onUpdate}
          />
        ))}
      </div>
    </div>
  );
}

function MessageQueueItem(props: {
  readonly message: QueuedChatMessage;
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (id: string, content: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(props.message.content);
  const cancellingRef = useRef(false);

  function startEdit(): void {
    setEditValue(props.message.content);
    setEditing(true);
  }

  function commitEdit(): void {
    if (cancellingRef.current) {
      cancellingRef.current = false;
      return;
    }
    const trimmed = editValue.trim();
    if (trimmed.length > 0 && trimmed !== props.message.content) {
      props.onUpdate(props.message.id, trimmed);
    }
    setEditing(false);
  }

  function cancelEdit(): void {
    cancellingRef.current = true;
    setEditValue(props.message.content);
    setEditing(false);
  }

  return (
    <div className="message-queue-item" role="listitem">
      {editing ? (
        <div className="message-queue-edit">
          <textarea
            value={editValue}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitEdit();
              }
              if (event.key === "Escape") {
                cancelEdit();
              }
            }}
            onBlur={commitEdit}
            rows={2}
            autoFocus
          />
        </div>
      ) : (
        <>
          <p className="message-queue-content">{props.message.content}</p>
          <div className="message-queue-actions">
            <button type="button" className="message-queue-action" onClick={startEdit} aria-label="编辑消息">
              <PencilLine size={13} />
            </button>
            <button type="button" className="message-queue-action" onClick={() => props.onRemove(props.message.id)} aria-label="撤回消息">
              <X size={13} />
            </button>
          </div>
        </>
      )}
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

function attachmentMediaPreview(attachment: ContextAttachment): NonNullable<ContextAttachment["mediaPreview"]> | undefined {
  return attachment.mediaPreview?.kind === "image" ? attachment.mediaPreview : undefined;
}

function workspaceDirectoryLabel(directory: string | undefined): string {
  const normalized = (directory ?? "").trim().replace(/[\\/]+$/u, "");
  if (normalized.length === 0) {
    return "工作区";
  }
  const parts = normalized.split(/[\\/]+/u);
  return parts[parts.length - 1] || normalized;
}

function attachmentImageSummary(attachment: ContextAttachment): string {
  const mimeType = attachment.mediaPreview?.mimeType ?? attachment.readonlyPreviewMeta.mimeType;
  const byteLength = attachment.mediaPreview?.byteLength ?? attachment.readonlyPreviewMeta.byteLength;
  const parts = [mimeType, byteSizeLabel(byteLength)].filter((value): value is string => value !== undefined);
  return parts.length === 0 ? attachment.summary : parts.join(" · ");
}

function byteSizeLabel(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} bytes`;
}

const REASONING_EFFORT_OPTIONS: readonly {
  readonly value: "" | "low" | "medium" | "high";
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "", label: "自动", description: "自适应" },
  { value: "low", label: "轻量", description: "低强度" },
  { value: "medium", label: "标准", description: "中强度" },
  { value: "high", label: "深入", description: "高强度" },
];

const TOOL_ACCESS_OPTIONS: readonly {
  readonly value: ComposerToolConfirmationPolicy;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "prompt", label: "标准访问", description: "命令确认" },
  { value: "full_access", label: "完全访问", description: "跳过确认" },
];

function reasoningEffortLabel(value: "" | "low" | "medium" | "high"): string {
  return REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? "自动";
}

function toolAccessPolicyLabel(value: ComposerToolConfirmationPolicy): string {
  return TOOL_ACCESS_OPTIONS.find((option) => option.value === value)?.label ?? "标准访问";
}

function modelOptionInitial(model: ChatModelOption): string {
  return (model.providerLabel.trim() || model.name.trim() || "M").slice(0, 1).toUpperCase();
}

function contextUsageDashArray(usage: ContextWindowUsage): string {
  return `${usage.ringPercent} 100`;
}

function dragHasFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

function filesFromFileList(files: FileList | null | undefined): readonly File[] {
  return Array.from(files ?? []).filter(isUsableFile);
}

function filesFromClipboard(dataTransfer: DataTransfer): readonly File[] {
  const directFiles = filesFromFileList(dataTransfer.files);
  if (directFiles.length > 0) {
    return directFiles;
  }
  return Array.from(dataTransfer.items)
    .map((item) => item.kind === "file" ? item.getAsFile() : undefined)
    .filter((file): file is File => file !== undefined && file !== null)
    .filter(isUsableFile);
}

function isUsableFile(file: File): boolean {
  return file.name.length > 0 || file.size > 0 || file.type.length > 0;
}
