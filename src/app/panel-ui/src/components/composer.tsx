import React, { useState } from "react";
import { motion } from "motion/react";
import { ArrowUp, ChevronDown, Paperclip } from "lucide-react";
import type { BasicAgentRun, ContextAttachment } from "../types";
import { terminalStatuses } from "../ui-state";

const GRASS_MAX_INPUT_LENGTH = 80;
const GRASS_IDLE_REVEAL = 0.2;
const GRASS_FOCUS_REVEAL = 0.4;
const GRASS_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const GRASS_TRANSITION = { duration: 0.56, ease: GRASS_EASE };

const GRASS_ASSETS = {
  ground: new URL("../../../../../images/素材图/ChatGPT Image 2026年5月14日 22_07_50 (2).png", import.meta.url)
    .href,
  blades: new URL("../../../../../images/素材图/ChatGPT Image 2026年5月14日 22_07_50 (3).png", import.meta.url)
    .href,
  flowers: new URL("../../../../../images/素材图/ChatGPT Image 2026年5月14日 22_07_51 (4).png", import.meta.url)
    .href,
  canopy: new URL("../../../../../images/素材图/ChatGPT Image 2026年5月14日 22_07_52 (6).png", import.meta.url)
    .href,
} as const;

const GRASS_LAYERS: readonly {
  readonly src: string;
  readonly className: string;
  readonly start: number;
  readonly end: number;
  readonly maxOpacity: number;
  readonly rise: number;
  readonly drift: number;
}[] = [
  { src: GRASS_ASSETS.ground, className: "chat-input-grass-image ground", start: 0, end: 0.22, maxOpacity: 1, rise: 5, drift: 0 },
  { src: GRASS_ASSETS.blades, className: "chat-input-grass-image blades", start: 0.18, end: 0.55, maxOpacity: 0.9, rise: 14, drift: -7 },
  { src: GRASS_ASSETS.flowers, className: "chat-input-grass-image flowers", start: 0.36, end: 0.78, maxOpacity: 0.72, rise: 18, drift: 6 },
  { src: GRASS_ASSETS.canopy, className: "chat-input-grass-image canopy", start: 0.56, end: 1, maxOpacity: 0.62, rise: 16, drift: 0 },
];

const ATTACHMENT_KIND_LABELS: Record<ContextAttachment["kind"], string> = {
  workspace: "工作区",
  file: "文件",
  project: "文件夹",
  web: "网页",
};

const ATTACHMENT_KINDS: readonly ContextAttachment["kind"][] = ["workspace", "file", "project", "web"];

type InputPhase = "idle" | "focused" | "sending";

function clamp01(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function grassRevealRatio(value: string, active: boolean): number {
  const baseReveal = active ? GRASS_FOCUS_REVEAL : GRASS_IDLE_REVEAL;
  const progress = Math.min(value.length / GRASS_MAX_INPUT_LENGTH, 1);
  if (value.length === 0) return baseReveal;
  return baseReveal + progress * (1 - baseReveal);
}

function grassLayerReveal(revealRatio: number, start: number, end: number): number {
  return clamp01((revealRatio - start) / (end - start));
}

function GrassReveal(props: { readonly value: string; readonly active: boolean }): React.ReactElement {
  const revealRatio = grassRevealRatio(props.value, props.active);

  return (
    <div aria-hidden="true" className="chat-input-grass-stage">
      {GRASS_LAYERS.map((layer, index) => {
        const layerReveal = grassLayerReveal(revealRatio, layer.start, layer.end);
        const hiddenFromTop = `${(1 - layerReveal) * 100}%`;

        return (
          <motion.div
            className="chat-input-grass-layer"
            initial={false}
            animate={{
              clipPath: `inset(${hiddenFromTop} 0 0 0)`,
            }}
            transition={GRASS_TRANSITION}
            style={{
              transformOrigin: "bottom center",
              zIndex: index + 1,
            }}
            key={layer.src}
          >
            <motion.img
              src={layer.src}
              alt=""
              draggable={false}
              className={layer.className}
              initial={false}
              animate={{
                opacity: layerReveal * layer.maxOpacity,
                x: (1 - layerReveal) * layer.drift,
                y: (1 - layerReveal) * layer.rise,
                scaleY: 0.82 + layerReveal * 0.18,
              }}
              transition={GRASS_TRANSITION}
              style={{ transformOrigin: "bottom center" }}
            />
          </motion.div>
        );
      })}
    </div>
  );
}

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
  phase?: InputPhase;
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
        <div
          className={`relative overflow-visible bg-[var(--surface)] rounded-[20px] border transition-[border-color,box-shadow] duration-[var(--motion-panel-duration)] ease-[var(--motion-ease-standard)] ${
            active
              ? "border-[var(--accent-border)] shadow-[0_10px_32px_rgba(17,24,39,0.08)]"
              : "border-[var(--border)] shadow-[0_2px_14px_rgba(17,24,39,0.04)]"
          }`}
        >
          <GrassReveal value={value} active={active} />
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
        </div>
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
  const phase: InputPhase = props.busy ? "sending" : focused ? "focused" : "idle";

  return (
    <section className="chat-composer" aria-label="任务输入">
      <div className="chat-composer-inner">
        <div className={focused ? "chat-input-card focused" : "chat-input-card"}>
          <GrassReveal value={props.value} active={phase !== "idle"} />
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
              <button className="flex items-center gap-2 h-8 px-3.5 rounded-xl border border-[var(--border)] text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] transition-[background-color,border-color,color] duration-[var(--motion-fast-duration)] ease-[var(--motion-ease-standard)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0" />
                <span>{props.runMode === "deep" ? "深入处理" : "普通任务"}</span>
                <ChevronDown size={10} />
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
                onClick={() => props.onSubmit(props.runMode)}
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
