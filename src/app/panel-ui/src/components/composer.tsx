import React, { useState } from "react";
import { ArrowUp, ChevronDown, Paperclip } from "lucide-react";
import { ProceduralGrassInput, type ProceduralGrassInputPhase } from "./ProceduralGrassInput";
import type { BasicAgentRun, ContextAttachment } from "../types";
import { terminalStatuses } from "../ui-state";

const ATTACHMENT_KIND_LABELS: Record<ContextAttachment["kind"], string> = {
  workspace: "工作区",
  file: "文件",
  project: "文件夹",
  web: "网页",
};

const ATTACHMENT_KINDS: readonly ContextAttachment["kind"][] = ["workspace", "file", "project", "web"];

export function ChatInputBar({
  phase = "idle",
  value,
  onChange,
  onSend,
  onFocus,
  onBlur,
  disabled,
  placeholder = "随便问点什么…",
}: {
  phase?: ProceduralGrassInputPhase;
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const active = phase === "focused" || focused;

  return (
    <div className="px-8 pb-7 shrink-0 bg-[var(--surface)]">
      <div className="max-w-[920px] mx-auto">
        <ProceduralGrassInput value={value} active={active} phase={phase}>
          <div className="px-5 pt-5 pb-3 min-h-[72px]">
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              rows={2}
              placeholder={placeholder}
              onFocus={() => {
                setFocused(true);
                onFocus?.();
              }}
              onBlur={() => {
                setFocused(false);
                onBlur?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend?.();
                }
              }}
              disabled={disabled || phase === "sending"}
              className="w-full text-sm text-[var(--fg)] placeholder:text-[var(--placeholder)] bg-transparent outline-none resize-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between px-4 pb-4">
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 h-8 px-3.5 rounded-xl border border-[var(--border)] text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] transition-[background-color,border-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />
                <span>模型占位</span>
                <ChevronDown size={10} />
              </button>
              <button
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface-subtle)] transition-[background-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]"
                aria-label="添加附件"
              >
                <Paperclip size={14} />
              </button>
            </div>

            <button
              onClick={() => onSend?.()}
              disabled={disabled || phase === "sending" || value.trim().length === 0}
              className="w-9 h-9 rounded-xl bg-[var(--accent-strong)] text-white flex items-center justify-center hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-[background-color,opacity,box-shadow] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] shadow-sm disabled:opacity-40"
              aria-label="发送"
            >
              {phase === "sending" ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <ArrowUp size={15} />
              )}
            </button>
          </div>
        </ProceduralGrassInput>
        <p className="text-center text-[11px] text-[var(--placeholder)] mt-2.5 select-none">
          内容由 AI 生成，仅供参考，请注意核实
        </p>
      </div>
    </div>
  );
}

export function Composer(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly attachments: readonly ContextAttachment[];
  readonly attachmentKind: ContextAttachment["kind"];
  readonly attachmentValue: string;
  readonly onAttachmentKindChange: (kind: ContextAttachment["kind"]) => void;
  readonly onAttachmentValueChange: (value: string) => void;
  readonly onAddAttachment: () => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly busy: boolean;
  readonly contextBusy?: boolean;
  readonly run?: BasicAgentRun;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const running = props.run !== undefined && !terminalStatuses.has(props.run.status);
  const canAddAttachment = props.attachmentValue.trim().length > 0;
  const phase: ProceduralGrassInputPhase = props.busy ? "sending" : focused ? "focused" : "idle";

  return (
    <section className="chat-composer" aria-label="任务输入">
      <div className="chat-composer-inner">
        <ProceduralGrassInput value={props.value} active={phase !== "idle"} phase={phase}>
          {props.attachments.length > 0 && (
            <div className="grid grid-cols-1 gap-2 px-3 pt-3">
              {props.attachments.map((attachment) => (
                <article
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                    attachment.status === "blocked" ? "border-[var(--amber-soft)] bg-[var(--amber-soft)]" : "border-[var(--border)] bg-[var(--surface-subtle)]"
                  }`}
                  key={attachment.attachmentId}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-xs text-[var(--fg)]">{attachment.title}</strong>
                    <small className="block truncate text-xs text-[var(--muted)]">{attachment.summary}</small>
                  </div>
                  <button
                    type="button"
                    className="h-6 px-2 rounded-md text-xs text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)] transition-[background-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]"
                    aria-label={`移除 ${attachment.title}`}
                    onClick={() => props.onRemoveAttachment(attachment.attachmentId)}
                  >
                    移除
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="px-4 pt-3.5 pb-2">
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
              placeholder="随便问点什么…"
              rows={2}
              className="chat-input-text"
            />
          </div>
          <div className="flex items-end justify-between px-3 pb-2.5 gap-3">
            <div className="flex items-center gap-1 min-w-0">
              <button className="flex items-center gap-2 h-8 px-3.5 rounded-xl border border-[var(--border)] text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] transition-[background-color,border-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />
                <span>普通任务</span>
              </button>
              <details className="relative">
                <summary className="list-none w-8 h-8 rounded-xl flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface-subtle)] transition-[background-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] cursor-pointer">
                  <Paperclip size={14} />
                </summary>
                <div className="absolute left-0 bottom-9 z-30 w-[min(560px,calc(100vw-96px))] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl p-3 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5" aria-label="上下文类型">
                    {ATTACHMENT_KINDS.map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        className={`h-7 px-3 rounded-lg text-xs transition-[background-color,color,border-color,box-shadow] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] ${
                          props.attachmentKind === kind
                            ? "bg-[var(--accent-strong)] text-white shadow-sm"
                            : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
                        }`}
                        onClick={() => props.onAttachmentKindChange(kind)}
                      >
                        {ATTACHMENT_KIND_LABELS[kind]}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <input
                      value={props.attachmentValue}
                      onChange={(event) => props.onAttachmentValueChange(event.target.value)}
                      placeholder={attachmentPlaceholder(props.attachmentKind)}
                      className="h-8 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-sm outline-none"
                    />
                    <button type="button" className="h-8 px-3 rounded-lg bg-[var(--accent-strong)] text-white text-xs disabled:opacity-40 transition-[background-color,opacity] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]" disabled={!canAddAttachment || props.contextBusy} onClick={props.onAddAttachment}>{props.contextBusy ? "添加中…" : "添加"}</button>
                  </div>
                </div>
              </details>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {running && <button type="button" className="h-8 px-3 rounded-lg text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] transition-[background-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]" onClick={props.onCancel}>取消</button>}
              <button
                type="button"
                onClick={() => props.onSubmit()}
                disabled={props.busy || props.value.trim().length === 0}
                className="w-9 h-9 rounded-xl bg-[var(--accent-strong)] text-white flex items-center justify-center hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-[background-color,opacity,box-shadow] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)] shadow-sm disabled:opacity-40"
                aria-label="发送"
              >
                {props.busy ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <ArrowUp size={15} />
                )}
              </button>
            </div>
          </div>
        </ProceduralGrassInput>
      </div>
    </section>
  );
}

function attachmentPlaceholder(kind: ContextAttachment["kind"]): string {
  if (kind === "web") return "粘贴网页链接";
  if (kind === "workspace") return ".";
  if (kind === "project") return "相对当前工作区的文件夹路径";
  return "相对当前工作区的文件路径";
}
