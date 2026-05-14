import React, { useState } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
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
  readonly onSubmit: (mode: "agent" | "deep") => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const running = props.run !== undefined && !terminalStatuses.has(props.run.status);
  const canAddAttachment = props.attachmentValue.trim().length > 0;
  return (
    <section className="chat-composer" aria-label="任务输入">
      <div className="chat-composer-inner">
        <div className={focused ? "chat-input-card focused" : "chat-input-card"}>
          {props.attachments.length > 0 && (
            <div className="grid grid-cols-1 gap-2 px-3 pt-3">
              {props.attachments.map((attachment) => (
                <article
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                    attachment.status === "blocked" ? "border-[#FDE68A] bg-[#FFFBEB]" : "border-[#E5E7EB] bg-[#F9FAFB]"
                  }`}
                  key={attachment.attachmentId}
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-xs text-[#374151]">{attachment.title}</strong>
                    <small className="block truncate text-xs text-[#9CA3AF]">{attachment.summary}</small>
                  </div>
                  <button
                    type="button"
                    className="h-6 px-2 rounded-md text-xs text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#374151] transition-colors"
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
                  props.onSubmit(props.runMode);
                }
              }}
              placeholder="随便问点什么…"
              rows={2}
              className="chat-input-text"
            />
          </div>
          <div className="flex items-end justify-between px-3 pb-2.5 gap-3">
            <div className="flex items-center gap-1 min-w-0">
              <details className="relative">
                <summary className="list-none w-7 h-7 rounded-lg flex items-center justify-center text-[#C4C4CE] hover:bg-[#F3F4F6] hover:text-[#9CA3AF] transition-colors cursor-pointer">
                  <Paperclip size={13} />
                </summary>
                <div className="absolute left-0 bottom-9 z-30 w-[min(560px,calc(100vw-96px))] rounded-xl border border-[#E5E7EB] bg-white shadow-xl p-3 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5" aria-label="上下文类型">
                    {ATTACHMENT_KINDS.map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        className={`h-7 px-3 rounded-lg text-xs transition-colors ${
                          props.attachmentKind === kind
                            ? "bg-[#111827] text-white"
                            : "border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F4F6]"
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
                      className="h-8 px-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-sm outline-none"
                    />
                    <button type="button" className="h-8 px-3 rounded-lg bg-[#111827] text-white text-xs disabled:opacity-40" disabled={!canAddAttachment || props.contextBusy} onClick={props.onAddAttachment}>{props.contextBusy ? "添加中…" : "添加"}</button>
                  </div>
                </div>
              </details>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {running && <button type="button" className="h-8 px-3 rounded-lg text-xs text-[#6B7280] hover:bg-[#F3F4F6]" onClick={props.onCancel}>取消</button>}
              <button type="button" className="w-8 h-8 rounded-xl bg-[#111827] text-white flex items-center justify-center hover:bg-[#1F2937] active:scale-95 transition-all shadow-sm disabled:opacity-40 disabled:active:scale-100" disabled={props.busy || props.value.trim().length === 0} onClick={() => props.onSubmit(props.runMode)} aria-label="发送">
                {props.busy ? "..." : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </div>
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
