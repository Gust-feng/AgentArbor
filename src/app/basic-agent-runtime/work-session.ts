import type {
  AgentDeliverable,
  AgentDeliverableSection,
  BasicAgentRun,
  ConfirmationRequest,
  ContextLedger,
  ContextLedgerEntry,
  ContextAttachment,
  DesktopWorkSessionAnswer,
  DesktopWorkSessionReadModel,
  DesktopWorkSessionStage,
  RunEvent,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../../domain/tools/index.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { redactOrdinaryText } from "./safe-projection.js";

export type CreateDesktopWorkSessionReadModelInput = {
  readonly run: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly canvas?: PanelRunCanvasReadModel;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly toolDisplays?: readonly ToolDisplayProjection[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
  readonly pendingConfirmation?: ConfirmationRequest;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
};

export function createDesktopWorkSessionReadModel(
  input: CreateDesktopWorkSessionReadModelInput
): DesktopWorkSessionReadModel {
  const visibleEvents = visibleWorkSessionEvents(input.events);
  const contextAttachments = contextAttachmentsFor(input);
  const toolEvidence = envelopeSafeToolEvidence(input.toolEvidence ?? []);
  const toolDisplays = mergeToolDisplays(toolEvidence.map((envelope) => envelope.uiDisplay).filter(isToolDisplay), input.toolDisplays ?? []);
  const contextLedger = contextLedgerFor(input, contextAttachments, toolEvidence, toolDisplays);
  const pendingConfirmation = input.pendingConfirmation ?? pendingConfirmationFor(input.run, input.canvas);
  const answer = answerFor(input);
  const deliverable = deliverableFor({
    run: input.run,
    canvas: input.canvas,
    toolDisplays,
    restoredResult: input.restoredResult,
    answer,
  });
  const stage = stageFor(input.run, visibleEvents, pendingConfirmation, deliverable, answer);
  return {
    run: input.run,
    stage,
    headline: headlineFor(input.run, stage, deliverable, answer),
    currentAction: currentActionFor(input.run, stage, visibleEvents, pendingConfirmation),
    contextAttachments,
    contextLedger,
    pendingConfirmation,
    answer,
    deliverable,
    toolEvidence,
    visibleEvents,
    safetySummary: {
      summary: "普通视图只展示上下文引用、工具摘要、证据和交付结果的安全投影。",
      pendingActionCount: pendingConfirmation === undefined ? 0 : 1,
      toolResultCount: toolEvidence.length > 0 ? toolEvidence.length : toolDisplays.length,
      contextAttachmentCount: contextAttachments.length,
    },
  };
}

function visibleWorkSessionEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  const productEvents = events
    .filter((event) => event.visibility !== "debug")
    .filter(isProductWorkSessionEvent);
  if (productEvents.length > 0) {
    return productEvents.slice(-18);
  }
  return events.filter((event) => event.visibility !== "debug").slice(-18);
}

function isProductWorkSessionEvent(event: RunEvent): boolean {
  if (event.type === "model.output.delta" || event.type === "final.result") {
    return false;
  }
  return (
    event.type.startsWith("run.") ||
    event.type.startsWith("tool.") ||
    event.type.startsWith("agent.") ||
    event.type.startsWith("context.compaction.") ||
    event.type === "model.reasoning.delta" ||
    event.type === "model.reasoning.completed" ||
    event.type === "model.output.completed" ||
    event.type === "confirmation.needed" ||
    event.type === "user_approval.received" ||
    event.type === "user.guidance"
  );
}

function contextLedgerFor(
  input: CreateDesktopWorkSessionReadModelInput,
  attachments: readonly ContextAttachment[],
  toolEvidence: readonly ToolResultEnvelope[],
  toolDisplays: readonly ToolDisplayProjection[]
): ContextLedger {
  const context = input.canvas?.kind === "desktop_agent_canvas" ? input.canvas.agent.context : undefined;
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
        summary: item.summary,
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
    summary: context?.usageSummary ?? `上下文来源 ${allEntries.length} 项，普通视图只展示引用和安全摘要。`,
    entries: allEntries,
    budget: context?.budget,
    truncation,
  };
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
      title: "上下文预算",
      summary: [
        budget.maxInputTokens === undefined ? undefined : `maxInputTokens=${budget.maxInputTokens}`,
        budget.usedInputTokens === undefined ? undefined : `usedInputTokens=${budget.usedInputTokens}`,
        budget.tokenCountSource === undefined ? undefined : `tokenCountSource=${budget.tokenCountSource}`,
        budget.maxChars === undefined ? undefined : `maxChars=${budget.maxChars}`,
        budget.usedChars === undefined ? undefined : `usedChars=${budget.usedChars}`,
        budget.budgetSource === undefined ? undefined : `source=${budget.budgetSource}`,
      ].filter(isString).join("；") || "本轮没有记录上下文预算。",
      refs: [],
      status: truncation.truncated ? "truncated" : "used",
    });
  }
  if (truncation.omittedItemCount > 0) {
    entries.push({
      entryId: `${runId}:ledger:omitted`,
      kind: "truncation",
      title: "未进入模型的上下文",
      summary: `因上下文预算限制，${truncation.omittedItemCount} 项上下文未进入模型输入。`,
      refs: [],
      status: "omitted",
    });
  }
  if (truncation.truncatedItemIds.length > 0) {
    entries.push({
      entryId: `${runId}:ledger:truncated`,
      kind: "truncation",
      title: "已截断上下文",
      summary: `已截断上下文项：${truncation.truncatedItemIds.slice(0, 8).join("；")}`,
      refs: [],
      status: "truncated",
    });
  }
  return entries;
}

function toolLedgerTitle(display: ToolDisplayProjection): string {
  if (display.kind === "search_results") return "搜索证据";
  if (display.kind === "browser_snapshot") return "网页摘要";
  if (display.kind === "file_change_summary") return "文件变更";
  if (display.kind === "file_diff_preview") return "差异预览";
  if (display.kind === "command_summary") return "命令摘要";
  return "工具摘要";
}

function toolLedgerSummary(display: ToolDisplayProjection): string {
  if (display.kind === "search_results") return redactOrdinaryText(display.query ?? `搜索结果 ${display.results.length} 条`, 240);
  if (display.kind === "browser_snapshot") return redactOrdinaryText(display.title ?? display.url ?? "网页已读取。", 240);
  if (display.kind === "command_summary") return redactOrdinaryText(display.command ?? "命令已执行。", 240);
  if (display.kind === "file_change_summary" || display.kind === "file_diff_preview") return redactOrdinaryText(display.path ?? "文件变更摘要。", 240);
  return redactOrdinaryText(display.summary ?? display.action ?? "动作已完成。", 240);
}

function stageFor(
  run: BasicAgentRun,
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined,
  deliverable: AgentDeliverable | undefined,
  answer: DesktopWorkSessionAnswer | undefined
): DesktopWorkSessionStage {
  if (run.status === "queued") return "queued";
  if (run.status === "approval_needed" || pendingConfirmation !== undefined) return "awaiting_approval";
  if (run.status === "blocked" || run.status === "needs_input") return "blocked";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "completed") return deliverable === undefined && answer === undefined ? "completed" : "completed";
  const latest = events.at(-1);
  if (latest?.type.startsWith("tool.")) return "using_tools";
  if (latest?.type === "model.reasoning.delta" || latest?.type === "model.reasoning.completed") return "understanding";
  if (latest?.type === "model.output.delta" || latest?.type === "model.output.completed") return "composing_result";
  if (events.some((event) => event.type.startsWith("tool."))) return "composing_result";
  if (events.length > 0) return "understanding";
  return "drafting";
}

function headlineFor(
  run: BasicAgentRun,
  stage: DesktopWorkSessionStage,
  deliverable: AgentDeliverable | undefined,
  answer: DesktopWorkSessionAnswer | undefined
): string {
  if (stage === "completed") return deliverable?.title ?? answer?.title ?? "任务已完成";
  if (stage === "awaiting_approval") return "需要你确认下一步";
  if (stage === "blocked") return "需要处理后再继续";
  if (stage === "failed") return "这次没有完成";
  if (stage === "cancelled") return "任务已取消";
  if (stage === "queued") return "已加入队列";
  if (stage === "using_tools") return "正在执行动作";
  if (stage === "gathering_context") return "正在整理上下文";
  if (stage === "composing_result") return "正在整理结果";
  return run.title || "正在理解任务";
}

function currentActionFor(
  run: BasicAgentRun,
  stage: DesktopWorkSessionStage,
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined
): string {
  if (pendingConfirmation !== undefined) {
    return pendingConfirmation.actionSummary;
  }
  const latest = [...events].reverse().find((event) =>
    event.type !== "model.reasoning.delta" &&
    event.type !== "model.reasoning.completed" &&
    event.summary !== undefined
  );
  if (latest?.summary !== undefined) {
    return latest.summary;
  }
  if (run.currentStep !== undefined) {
    return run.currentStep;
  }
  if (stage === "queued") return "等待前一个任务完成。";
  if (stage === "completed") return "结果已经整理好。";
  if (stage === "failed") return "查看失败摘要后可以补充材料或重新发起。";
  if (stage === "cancelled") return "运行已经停止。";
  return run.goalSummary;
}

function deliverableFor(input: {
  readonly run: BasicAgentRun;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
  readonly answer?: DesktopWorkSessionAnswer;
}): AgentDeliverable | undefined {
  const canvas = input.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    return undefined;
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.report !== undefined) {
    const report = canvas.workSession.report;
    return deliverable({
      run: input.run,
      title: report.title,
      summary: report.decisionSummary,
      sections: [
        section(`${input.run.runId}:findings`, "关键发现", report.keyFindings.join("\n"), report.evidenceRefs),
        section(`${input.run.runId}:recommendations`, "建议", report.recommendations.join("\n"), report.evidenceRefs),
      ],
      evidenceRefs: observationRefs(report.evidenceRefs),
      toolDisplays: input.toolDisplays,
      nextActions: report.nextActions,
    });
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    return undefined;
  }
  if (input.restoredResult !== undefined && input.run.status === "completed") {
    return undefined;
  }
  return undefined;
}

function answerFor(input: CreateDesktopWorkSessionReadModelInput): DesktopWorkSessionAnswer | undefined {
  const canvas = input.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    return {
      title: "已回答",
      content: redactOrdinaryText(canvas.agent.answer.answer, 2_000),
      evidenceRefs: observationRefs(canvas.agent.answer.evidenceRefs),
      nextActions: [],
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    return {
      title: "已回答",
      content: redactOrdinaryText(canvas.workSession.directAnswer.answer, 2_000),
      evidenceRefs: observationRefs(canvas.workSession.directAnswer.evidenceRefs),
      nextActions: canvas.workSession.directAnswer.followUpSuggestions
        .map((item) => redactOrdinaryText(item, 220))
        .filter((item) => item.length > 0)
        .slice(0, 5),
    };
  }
  return undefined;
}

function envelopeSafeToolEvidence(envelopes: readonly ToolResultEnvelope[]): readonly ToolResultEnvelope[] {
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

function mergeToolDisplays(
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

function isToolDisplay(value: ToolDisplayProjection | undefined): value is ToolDisplayProjection {
  return value !== undefined;
}

function deliverable(input: {
  readonly run: BasicAgentRun;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly AgentDeliverableSection[];
  readonly evidenceRefs: readonly ObservationRef[];
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly nextActions?: readonly string[];
}): AgentDeliverable {
  return {
    deliverableId: `${input.run.runId}:deliverable`,
    runId: input.run.runId,
    title: redactOrdinaryText(input.title, 140),
    summary: redactOrdinaryText(input.summary, 1_000),
    sections: input.sections,
    evidenceRefs: input.evidenceRefs,
    toolDisplays: input.toolDisplays,
    fileChanges: input.toolDisplays.filter((display) => display.kind === "file_change_summary" || display.kind === "file_diff_preview"),
    commands: input.toolDisplays.filter((display) => display.kind === "command_summary"),
    nextActions: (input.nextActions ?? []).map((item) => redactOrdinaryText(item, 220)).filter((item) => item.length > 0).slice(0, 5),
    createdAt: input.run.updatedAt,
  };
}

function section(
  sectionId: string,
  title: string,
  content: string,
  refs: readonly string[]
): AgentDeliverableSection {
  return {
    sectionId,
    title: redactOrdinaryText(title, 120),
    content: redactOrdinaryText(content, 900),
    evidenceRefs: observationRefs(refs),
  };
}

function pendingConfirmationFor(
  run: BasicAgentRun,
  canvas: PanelRunCanvasReadModel | undefined
): ConfirmationRequest | undefined {
  if (canvas?.kind !== "desktop_agent_canvas" || canvas.agent.pendingConfirmation === undefined) {
    return undefined;
  }
  const pending = canvas.agent.pendingConfirmation;
  return {
    confirmationId: pending.confirmationId,
    runId: run.runId,
    conversationId: run.conversationId,
    title: redactOrdinaryText(pending.title, 120),
    actionSummary: redactOrdinaryText(`${pending.question}\n${pending.consequence}`, 600),
    affectedResources: pending.sourceRefs.map((ref) => redactOrdinaryText(ref, 180)),
    riskLevel: pending.riskLevel === "low" || pending.riskLevel === "medium" || pending.riskLevel === "high" ? pending.riskLevel : "medium",
    resumeAvailability: "live",
    requestedAt: run.updatedAt,
    sourceRefs: pending.sourceRefs,
  };
}

function contextAttachmentsFor(input: CreateDesktopWorkSessionReadModelInput): readonly ContextAttachment[] {
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

function taskSoilContextAttachments(canvas: PanelRunCanvasReadModel | undefined): readonly ContextAttachment[] {
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

function observationRefs(refs: readonly string[]): readonly ObservationRef[] {
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
