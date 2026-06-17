import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Paperclip,
  ShieldCheck,
  X,
} from "lucide-react";
import { compact } from "../text";
import type { ComposerToolConfirmationPolicy } from "../app-config-projection";
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
  readonly onSelectAttachment: () => void;
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
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly onToolConfirmationPolicyChange: (value: ComposerToolConfirmationPolicy) => void;
  readonly onModelSelect: (modelId: string) => void | Promise<void>;
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
            <h1 className="chat-empty-heading">新任务</h1>
            {props.error && <div className="system-error-line">{props.error}</div>}
          </section>
        </div>
      </main>
      <ChatInputBar
        {...props}
        variant="floating"
        placeholder="输入任务..."
      />
    </div>
  );
}

export function ChatInputBar(props: ChatInputProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const didAutoFocusRef = useRef(false);
  const previousBusyRef = useRef(props.busy);
  const [focused, setFocused] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId);
  const canSend = props.value.trim().length > 0 && !props.busy;
  const modelGroups = useMemo(() => groupModels(props.models), [props.models]);

  useEffect(() => {
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);
    setAccessMenuOpen(false);
  }, [props.closeSignal]);

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
  }, [props.busy, modelMenuOpen, reasoningMenuOpen, accessMenuOpen]);

  function closeComposerPanels(): void {
    setModelMenuOpen(false);
    setReasoningMenuOpen(false);
    setAccessMenuOpen(false);
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
        ref={textareaRef}
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
        rows={2}
        placeholder={props.placeholder ?? "输入任务..."}
        disabled={props.busy}
        className="chat-input-textarea"
      />
      <div className="chat-input-toolbar">
        <div className="chat-input-left">
          <div className="composer-options-menu">
            <button
              type="button"
              className="composer-options-button composer-model-chip"
              onClick={() => {
                setModelMenuOpen((value) => !value);
                setReasoningMenuOpen(false);
                setAccessMenuOpen(false);
              }}
              aria-expanded={modelMenuOpen}
            >
              <span className="composer-model-dot" aria-hidden="true" />
              <span>{selectedModel?.name ?? "选择模型"}</span>
              <ChevronDown size={13} aria-hidden="true" />
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
                      {group.items.map((model) => (
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
                            <small>{model.providerLabel}</small>
                          </span>
                        </button>
                      ))}
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
                className="composer-options-button composer-reasoning-chip"
                onClick={() => {
                  setModelMenuOpen(false);
                  setReasoningMenuOpen((value) => !value);
                  setAccessMenuOpen(false);
                }}
                aria-expanded={reasoningMenuOpen}
                aria-label="思考强度"
                title="思考强度"
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
              className={`composer-options-button composer-access-chip ${props.toolConfirmationPolicy === "full_access" ? "full-access" : ""}`}
              onClick={() => {
                setModelMenuOpen(false);
                setReasoningMenuOpen(false);
                setAccessMenuOpen((value) => !value);
              }}
              aria-expanded={accessMenuOpen}
              aria-label="访问模式"
              title="访问模式"
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
        </div>
        <div className="chat-input-right">
          <button
            type="button"
            className="composer-tool-button composer-icon-button"
            onClick={() => {
              closeComposerPanels();
              props.onSelectAttachment();
            }}
            disabled={props.contextBusy === true}
            aria-label="添加附件"
            title="添加附件"
          >
            <Paperclip size={18} />
          </button>
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
    </div>
  );

  const variant = props.variant ?? "embedded";
  const composer = (
    <div ref={composerRef} className={`chat-composer-shell chat-composer-${variant}`}>
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

function groupModels(models: readonly ChatModelOption[]): readonly { readonly label: string; readonly items: readonly ChatModelOption[] }[] {
  const groups = new Map<string, ChatModelOption[]>();
  for (const model of models) {
    const label = model.providerLabel === model.name ? "模型服务" : model.providerLabel;
    groups.set(label, [...(groups.get(label) ?? []), model]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
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
