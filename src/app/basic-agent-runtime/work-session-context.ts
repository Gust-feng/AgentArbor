import type {
  BasicAgentRun,
  ContextAttachment,
  ContextLedger,
  ContextLedgerEntry,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../../domain/tools/index.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { redactOrdinaryText } from "../safe-projection.js";

export type WorkViewTaskSoilCanvasLike = {
  readonly taskSoilId: string;
  readonly goalSummary?: string;
  readonly contextRefs: readonly {
    readonly ref: string;
    readonly kind: string;
    readonly summary?: string;
    readonly readonlyPreview?: {
      readonly title?: string;
      readonly text: string;
      readonly truncated: boolean;
    };
  }[];
  readonly permissionBoundaryRefs: readonly string[];
  readonly [key: string]: unknown;
};

export type WorkViewCanvasContextLike = {
  readonly kind: string;
  readonly taskSoil?: WorkViewTaskSoilCanvasLike;
  readonly agent?: {
    readonly context?: {
      readonly items?: readonly {
        readonly itemId: string;
        readonly sourceKind: string;
        readonly summary: string;
        readonly truncated: boolean;
      }[];
      readonly truncationReport?: ContextLedger["truncation"];
      readonly budget?: ContextLedger["budget"];
      readonly usageSummary?: string;
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
};

export type WorkViewContextProjectionInput = {
  readonly run: BasicAgentRun;
  readonly canvas?: WorkViewCanvasContextLike;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly toolDisplays?: readonly ToolDisplayProjection[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
};

/**
 * @deprecated Historical ordinary read-model name. New code should use
 * WorkViewTaskSoilCanvasLike.
 */
export type WorkSessionTaskSoilCanvasLike = WorkViewTaskSoilCanvasLike;

/**
 * @deprecated Historical ordinary read-model name. New code should use
 * WorkViewCanvasContextLike.
 */
export type WorkSessionCanvasContextLike = WorkViewCanvasContextLike;

/**
 * @deprecated Historical ordinary read-model name. New code should use
 * WorkViewContextProjectionInput.
 */
export type WorkSessionContextProjectionInput = WorkViewContextProjectionInput;

export function contextAttachmentsFor(input: WorkViewContextProjectionInput): readonly ContextAttachment[] {
  const fromCanvas = taskSoilContextAttachments(input.canvas);
  const fromInput = (input.taskSoilInput?.contextRefs ?? []).map((ref, index): ContextAttachment => ({
    attachmentId: `${input.run.runId}:context:${index}`,
    kind: ref.kind,
    ref: ref.ref,
    title: contextTitle(ref.kind, ref.ref),
    summary: redactOrdinaryText(ref.summary ?? ref.ref, 280),
    permissionRefs: (input.taskSoilInput?.permissionBoundaryRefs ?? []).map((permission) => redactOrdinaryText(permission, 220)),
    readonlyPreviewMeta: {
      available: true,
      title: ref.readonlyPreview?.title,
      truncated: ref.readonlyPreview?.text !== undefined ? ref.readonlyPreview.text.length > 0 : undefined,
    },
    status: contextRefDenied(ref.kind, ref.ref, input.taskSoilInput?.permissionBoundaryRefs ?? []) ? "blocked" : "ready",
    warning: contextRefDenied(ref.kind, ref.ref, input.taskSoilInput?.permissionBoundaryRefs ?? [])
      ? "该上下文引用被当前权限边界阻止。"
      : undefined,
  }));
  if (fromCanvas.length === 0) {
    return fromInput;
  }
  if (fromInput.length === 0) {
    return fromCanvas;
  }
  return mergeContextAttachments(fromCanvas, fromInput);
}

export function contextLedgerFor(
  input: WorkViewContextProjectionInput,
  attachments: readonly ContextAttachment[],
  toolEvidence: readonly ToolResultEnvelope[],
  toolDisplays: readonly ToolDisplayProjection[]
): ContextLedger {
  const context = input.canvas?.kind === "desktop_agent_canvas" ? input.canvas.agent?.context : undefined;
  const contextItems = context?.items ?? [];
  const entries: ContextLedgerEntry[] = [
    {
      entryId: `${input.run.runId}:ledger:goal`,
      kind: "goal",
      title: "当前任务",
      summary: input.run.goalSummary,
      refs: [{ kind: "goal", id: input.run.runId }],
      status: "used",
    },
    ...attachments.map((attachment): ContextLedgerEntry => ({
      entryId: `${input.run.runId}:ledger:attachment:${attachment.attachmentId}`,
      kind: "attachment",
      title: attachment.title,
      summary: attachment.summary,
      refs: [{ kind: attachment.kind === "file" ? "artifact" : "event", id: attachment.ref }],
      status: attachment.status === "blocked" ? "blocked" : attachment.readonlyPreviewMeta.truncated === true ? "truncated" : "used",
    })),
    ...contextItems
      .filter((item) =>
        item.sourceKind === "conversation" ||
        item.sourceKind === "conversation_summary" ||
        item.sourceKind === "conversation_recent_turn" ||
        item.sourceKind === "skill"
      )
      .slice(0, 8)
      .map((item): ContextLedgerEntry => ({
        entryId: `${input.run.runId}:ledger:context:${item.itemId}`,
        kind: item.sourceKind === "skill" ? "skill" : "history",
        title: item.sourceKind === "skill" ? "触发技能" : item.sourceKind === "conversation_summary" ? "历史摘要" : "历史对话",
        summary: item.sourceKind === "skill" ? skillLedgerSummary(item.summary) : item.summary,
        refs: [{ kind: "event", id: item.itemId }],
        status: item.truncated ? "truncated" : "used",
      })),
    ...toolEvidence.slice(0, 12).map((envelope, index): ContextLedgerEntry => ({
      entryId: `${input.run.runId}:ledger:tool-evidence:${envelope.diagnosticRef ?? index}`,
      kind: "tool_evidence",
      title: envelope.uiDisplay === undefined ? "工具证据" : toolLedgerTitle(envelope.uiDisplay),
      summary: redactOrdinaryText(envelope.agentSummary, 420),
      refs: observationRefs(envelope.evidenceRefs),
      status: envelope.truncated ? "truncated" : "used",
    })),
    ...(toolEvidence.length > 0 ? [] : toolDisplays.slice(0, 12).map((display, index): ContextLedgerEntry => ({
      entryId: `${input.run.runId}:ledger:tool:${index}`,
      kind: "tool_evidence",
      title: toolLedgerTitle(display),
      summary: toolLedgerSummary(display),
      refs: [],
      status: "truncated" in display && display.truncated === true ? "truncated" : "used",
    }))),
  ];
  const truncation = context?.truncationReport ?? {
    truncated: entries.some((entry) => entry.status === "truncated"),
    omittedItemCount: 0,
    truncatedItemIds: entries.filter((entry) => entry.status === "truncated").map((entry) => entry.entryId),
  };
  const budgetEntries = contextBudgetEntries(input.run.runId, context?.budget, truncation);
  const allEntries = [...entries, ...budgetEntries];
  return {
    runId: input.run.runId,
    summary: context?.usageSummary ?? contextLedgerSummary(allEntries),
    entries: allEntries,
    budget: context?.budget,
    truncation,
  };
}

export function envelopeSafeToolEvidence(envelopes: readonly ToolResultEnvelope[]): readonly ToolResultEnvelope[] {
  const selected: ToolResultEnvelope[] = [];
  const seen = new Set<string>();
  for (const envelope of envelopes) {
    const key = envelope.diagnosticRef ?? `${envelope.agentSummary}:${envelope.evidenceRefs.join("|")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push({
      agentSummary: redactOrdinaryText(envelope.agentSummary, 1_800),
      evidenceRefs: envelope.evidenceRefs.map((ref) => redactOrdinaryText(ref, 220)).filter((ref) => ref.length > 0).slice(0, 12),
      uiDisplay: envelope.uiDisplay,
      tokenEstimate: Number.isFinite(envelope.tokenEstimate)
        ? Math.max(1, Math.floor(envelope.tokenEstimate))
        : Math.max(1, Math.ceil(envelope.agentSummary.length / 4)),
      truncated: envelope.truncated,
      redacted: envelope.redacted !== false,
      diagnosticRef: envelope.diagnosticRef === undefined ? undefined : redactOrdinaryText(envelope.diagnosticRef, 220),
      rawRetention: envelope.rawRetention,
    });
  }
  return selected.slice(0, 24);
}

export function mergeToolDisplays(
  primary: readonly ToolDisplayProjection[],
  fallback: readonly ToolDisplayProjection[]
): readonly ToolDisplayProjection[] {
  const displays: ToolDisplayProjection[] = [];
  const seen = new Set<string>();
  for (const display of [...primary, ...fallback]) {
    const key = JSON.stringify(display);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    displays.push(display);
  }
  return displays;
}

export function isToolDisplay(value: ToolDisplayProjection | undefined): value is ToolDisplayProjection {
  return value !== undefined;
}

export function observationRefs(refs: readonly string[]): readonly ObservationRef[] {
  return refs.slice(0, 20).map((ref): ObservationRef => {
    const separator = ref.indexOf(":");
    if (separator > 0) {
      const kind = observationKind(ref.slice(0, separator));
      return {
        kind,
        id: redactOrdinaryText(ref.slice(separator + 1), 180),
      };
    }
    return { kind: "event", id: redactOrdinaryText(ref, 180) };
  });
}

function contextBudgetEntries(
  runId: string,
  budget: ContextLedger["budget"] | undefined,
  truncation: ContextLedger["truncation"]
): readonly ContextLedgerEntry[] {
  const entries: ContextLedgerEntry[] = [];
  if (budget !== undefined) {
    entries.push({
      entryId: `${runId}:ledger:budget`,
      kind: "budget",
      title: "上下文范围",
      summary: contextBudgetSummary(budget),
      refs: [],
      status: truncation.truncated ? "truncated" : "used",
    });
  }
  if (truncation.omittedItemCount > 0) {
    entries.push({
      entryId: `${runId}:ledger:omitted`,
      kind: "truncation",
      title: "暂未使用的上下文",
      summary: `${truncation.omittedItemCount} 项上下文暂未用于本轮处理。`,
      refs: [],
      status: "omitted",
    });
  }
  if (truncation.truncatedItemIds.length > 0) {
    entries.push({
      entryId: `${runId}:ledger:truncated`,
      kind: "truncation",
      title: "已截断上下文",
      summary: `部分上下文已压缩：${truncation.truncatedItemIds.length} 项。`,
      refs: [],
      status: "truncated",
    });
  }
  return entries;
}

function contextLedgerSummary(entries: readonly ContextLedgerEntry[]): string {
  const counts = new Map<ContextLedgerEntry["kind"], number>();
  for (const entry of entries) {
    if (entry.kind === "budget" || entry.kind === "truncation") {
      continue;
    }
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  const labels: Record<ContextLedgerEntry["kind"], string> = {
    goal: "任务",
    attachment: "上下文",
    history: "历史",
    skill: "技能",
    tool_evidence: "证据",
    budget: "范围",
    truncation: "压缩",
  };
  const parts = [...counts.entries()].map(([kind, count]) => `${labels[kind]} ${count}`);
  return parts.length === 0 ? "已按当前任务整理上下文。" : parts.join("；");
}

function skillLedgerSummary(summary: string): string {
  const lines = summary.split(/\r?\n/g).map((line) => line.trim()).filter((line) => line.length > 0);
  const name = lines.find((line) => line.startsWith("Triggered skill:")) ?? "Triggered skill: 技能";
  const reason = lines.find((line) => line.startsWith("Why:")) ?? "Why: 技能名称或描述匹配当前任务。";
  return redactOrdinaryText([name, reason].join("\n"), 420);
}

function contextBudgetSummary(budget: ContextLedger["budget"]): string {
  const parts = [
    budget?.usedChars !== undefined && budget.usedChars > 0 ? `已整理 ${budget.usedChars} 字符` : undefined,
    budget?.maxChars !== undefined && budget.maxChars > 0 ? `上限 ${budget.maxChars} 字符` : undefined,
    budget?.usedInputTokens !== undefined && budget.usedInputTokens > 0 ? `约 ${budget.usedInputTokens} tokens` : undefined,
  ].filter(isString);
  return parts.length === 0 ? "已按当前任务整理上下文。" : parts.join("；");
}

function toolLedgerTitle(display: ToolDisplayProjection): string {
  if (display.kind === "search_results") return "搜索证据";
  if (display.kind === "read_result") return "资料正文";
  if (display.kind === "browser_snapshot") return "网页摘要";
  if (display.kind === "file_change_summary") return "文件变更";
  if (display.kind === "file_diff_preview") return "差异预览";
  if (display.kind === "command_summary") return "命令摘要";
  return "工具摘要";
}

function toolLedgerSummary(display: ToolDisplayProjection): string {
  if (display.kind === "search_results") return redactOrdinaryText(display.query ?? `搜索结果 ${display.results.length} 条`, 240);
  if (display.kind === "read_result") return redactOrdinaryText(display.title ?? display.uri ?? display.url ?? "资料已读取。", 240);
  if (display.kind === "browser_snapshot") return redactOrdinaryText(display.title ?? display.url ?? "网页已读取。", 240);
  if (display.kind === "command_summary") return redactOrdinaryText(display.command ?? "命令已执行。", 240);
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return redactOrdinaryText(display.path ?? "文件变更摘要。", 240);
  return redactOrdinaryText(display.summary ?? display.action ?? "已处理。", 240);
}

function mergeContextAttachments(
  primary: readonly ContextAttachment[],
  fallback: readonly ContextAttachment[]
): readonly ContextAttachment[] {
  const merged: ContextAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of [...primary, ...fallback]) {
    const key = `${attachment.kind}:${attachment.ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function taskSoilContextAttachments(canvas: WorkViewCanvasContextLike | undefined): readonly ContextAttachment[] {
  const taskSoil = canvas?.kind === "desktop_agent_canvas" || canvas?.kind === "work_session_canvas" || canvas?.kind === "desktop_shell_canvas"
    ? canvas.taskSoil
    : undefined;
  if (taskSoil === undefined) {
    return [];
  }
  return taskSoil.contextRefs
    .filter((ref) => ref.kind !== "user_goal" && ref.kind !== "runtime")
    .map((ref, index): ContextAttachment => ({
      attachmentId: `${taskSoil.taskSoilId}:context:${index}`,
      kind: ref.kind === "file" || ref.kind === "project" || ref.kind === "web" ? ref.kind : "workspace",
      ref: redactOrdinaryText(ref.ref, 220),
      title: contextTitle(ref.kind, ref.ref),
      summary: redactOrdinaryText(ref.summary ?? ref.ref, 280),
      permissionRefs: taskSoil.permissionBoundaryRefs.filter((permission) => permission.startsWith("read:")).map((permission) => redactOrdinaryText(permission, 220)),
      readonlyPreviewMeta: {
        available: true,
        title: ref.readonlyPreview?.title,
        byteLength: ref.readonlyPreview?.text.length,
        truncated: ref.readonlyPreview?.truncated,
      },
      status: contextRefDenied(ref.kind, ref.ref, taskSoil.permissionBoundaryRefs) ? "blocked" : "ready",
      warning: contextRefDenied(ref.kind, ref.ref, taskSoil.permissionBoundaryRefs)
        ? "该上下文引用被当前权限边界阻止。"
        : undefined,
    }));
}

function contextRefDenied(kind: string, ref: string, permissionRefs: readonly string[]): boolean {
  const cleanRef = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  const denied = new Set([
    `deny:${ref}`,
    `deny:${kind}:${cleanRef}`,
    `deny:${kind}`,
  ].map((value) => value.toLowerCase()));
  return permissionRefs.some((permission) => denied.has(permission.toLowerCase()));
}

function contextTitle(kind: string, ref: string): string {
  const clean = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  if (kind === "web") return redactOrdinaryText(clean, 120);
  if (kind === "file") return redactOrdinaryText(clean.split(/[\\/]/).at(-1) || clean, 120);
  if (kind === "project") return redactOrdinaryText(clean || "项目", 120);
  return "当前工作区";
}

function observationKind(value: string): ObservationRef["kind"] {
  if (value === "trace") return "trace";
  if (value === "goal") return "goal";
  if (value === "tool" || value === "tool_call") return "tool_call";
  if (value === "model" || value === "model_call") return "model_call";
  if (value === "artifact") return "artifact";
  return "event";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
