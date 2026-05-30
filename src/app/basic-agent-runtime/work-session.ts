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
  TranscriptNode,
  TranscriptNodePhase,
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
  readonly transcriptNodes?: readonly TranscriptNode[];
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
  const transcriptNodes = input.transcriptNodes ?? transcriptNodesFromRunEvents(visibleEvents, pendingConfirmation);
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
    transcriptNodes,
    safetySummary: {
      summary: "普通视图展示上下文引用、工具摘要、证据和交付结果。",
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

function transcriptNodesFromRunEvents(
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined
): readonly TranscriptNode[] {
  const confirmationToolRefs = new Set(
    events
      .filter((event) => event.type === "confirmation.needed")
      .flatMap(toolCallRefsForRunEvent)
  );
  const confirmationRequestSequences = requestSequencesBeforeConfirmations(events);
  const requestedByCallId = new Map<string, number>();
  const nodes: TranscriptNode[] = [];
  let pendingReasoning: PendingRunReasoningNode | undefined;

  for (const event of events) {
    if (isReasoningRunEvent(event)) {
      pendingReasoning = updatePendingRunReasoning(pendingReasoning, event, nodes);
      continue;
    }
    pendingReasoning = flushPendingRunReasoning(pendingReasoning, nodes);
    const node = transcriptNodeFromRunEvent(event, {
      confirmationToolRefs,
      confirmationRequestSequences,
      requestedByCallId,
      pendingConfirmation,
    });
    if (node !== undefined) {
      nodes.push(node);
    }
  }
  flushPendingRunReasoning(pendingReasoning, nodes);

  return nodes;
}

type PendingRunReasoningNode = {
  readonly firstEvent: RunEvent;
  readonly events: readonly RunEvent[];
  readonly text: string;
  readonly completed: boolean;
};

function transcriptNodeFromRunEvent(
  event: RunEvent,
  context: {
    readonly confirmationToolRefs: ReadonlySet<string>;
    readonly confirmationRequestSequences: ReadonlySet<number>;
    readonly requestedByCallId: Map<string, number>;
    readonly pendingConfirmation: ConfirmationRequest | undefined;
  }
): TranscriptNode | undefined {
  if (event.visibility === "debug" || event.type === "run.started") {
    return undefined;
  }
  if (event.type === "model.output.delta" || event.type === "model.output.completed") {
    return undefined;
  }
  if (event.type === "agent.note.delta" || event.type === "agent.note.completed") {
    const summary = event.summary?.trim();
    if (summary === undefined || summary.length === 0 || isLowValueAgentNote(summary)) {
      return undefined;
    }
    return transcriptNode(event, {
      kind: "thinking",
      phase: event.type === "agent.note.delta" ? "noted" : "completed",
      title: event.type === "agent.note.delta" ? "判断" : "判断完成",
      summary,
    });
  }
  if (event.type === "tool.requested") {
    const callId = toolCallRefsForRunEvent(event)[0];
    const previousCount = callId === undefined ? 0 : context.requestedByCallId.get(callId) ?? 0;
    if (callId !== undefined) {
      context.requestedByCallId.set(callId, previousCount + 1);
    }
    const phase: TranscriptNodePhase =
      ((callId !== undefined && context.confirmationToolRefs.has(callId) && previousCount === 0) ||
        context.confirmationRequestSequences.has(event.sequence))
        ? "preparing"
        : "executing";
    return transcriptNode(event, {
      kind: "tool",
      phase,
      title: toolTranscriptTitleFromRunEvent(event, phase),
      summary: transcriptToolSummaryFromRunEvent(event),
      display: event.detail?.display,
    });
  }
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    const phase: TranscriptNodePhase = event.type === "tool.completed" ? "completed" : "failed";
    return transcriptNode(event, {
      kind: "tool",
      phase,
      title: toolTranscriptTitleFromRunEvent(event, phase),
      summary: transcriptToolSummaryFromRunEvent(event),
      display: event.detail?.display,
    });
  }
  if (event.type === "confirmation.needed") {
    const summary = userFacingConfirmationSummary(event.summary);
    return transcriptNode(event, {
      kind: "confirmation",
      phase: "waiting_approval",
      title: "待确认",
      summary,
      confirmation: context.pendingConfirmation ?? {
        confirmationId: `confirmation-${event.sequence}`,
        runId: event.runId,
        title: "需要确认",
        actionSummary: summary,
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: event.timestamp,
        sourceRefs: event.refs.map((ref) => `${ref.kind}:${ref.id}`),
      },
    });
  }
  if (event.type === "user_approval.received" || event.type === "user.guidance") {
    const phase = event.type === "user.guidance"
      ? "guidance"
      : event.summary?.includes("拒绝") || event.status === "blocked"
        ? "denied"
        : "approved";
    return transcriptNode(event, {
      kind: "user_decision",
      phase,
      title: phase === "approved" ? "已确认" : phase === "denied" ? "已拒绝" : "补充要求",
      summary: event.summary,
    });
  }
  if (event.type === "run.resumed") {
    return transcriptNode(event, {
      kind: "user_decision",
      phase: "approved",
      title: "继续执行",
      summary: event.summary,
    });
  }
  if (event.type === "final.result") {
    return transcriptNode(event, {
      kind: "answer",
      phase: "completed",
      title: "结果",
      summary: event.summary,
    });
  }
  if (event.type === "run.failed" || event.type === "run.blocked" || event.type === "run.cancelled") {
    return transcriptNode(event, {
      kind: "system",
      phase: event.type === "run.failed" ? "failed" : event.type === "run.cancelled" ? "cancelled" : "blocked",
      title: event.title,
      summary: event.summary,
    });
  }
  if (event.type === "context.compaction.completed" || event.type === "context.compaction.failed") {
    return transcriptNode(event, {
      kind: "system",
      phase: event.type === "context.compaction.completed" ? "completed" : "failed",
      title: event.title,
      summary: event.summary,
    });
  }
  if (event.type.startsWith("agent.")) {
    return transcriptNode(event, {
      kind: "system",
      phase: event.status === "failed" ? "failed" : event.status === "running" ? "executing" : "completed",
      title: event.title,
      summary: event.summary,
    });
  }
  return undefined;
}

function requestSequencesBeforeConfirmations(events: readonly RunEvent[]): ReadonlySet<number> {
  const sequences = new Set<number>();
  let latestRequested: RunEvent | undefined;
  for (const event of events) {
    if (event.type === "tool.requested") {
      latestRequested = event;
      continue;
    }
    if (event.type === "confirmation.needed" && latestRequested !== undefined) {
      sequences.add(latestRequested.sequence);
      latestRequested = undefined;
      continue;
    }
    if (event.type === "tool.completed" || event.type === "tool.failed" || event.type === "final.result") {
      latestRequested = undefined;
    }
  }
  return sequences;
}

function isReasoningRunEvent(
  event: RunEvent
): event is RunEvent & { readonly type: "model.reasoning.delta" | "model.reasoning.completed" } {
  return event.type === "model.reasoning.delta" || event.type === "model.reasoning.completed";
}

function updatePendingRunReasoning(
  pending: PendingRunReasoningNode | undefined,
  event: RunEvent,
  nodes: TranscriptNode[]
): PendingRunReasoningNode | undefined {
  const text = event.delta ?? event.detail?.preview ?? event.summary;
  if (text === undefined || text.trim().length === 0) {
    return pending;
  }
  if (pending === undefined || !sameReasoningRefs(modelCallRefsForRunEvent(pending.firstEvent), modelCallRefsForRunEvent(event))) {
    flushPendingRunReasoning(pending, nodes);
    return {
      firstEvent: event,
      events: [event],
      text,
      completed: event.type === "model.reasoning.completed",
    };
  }
  return {
    firstEvent: pending.firstEvent,
    events: [...pending.events, event],
    text: appendReasoningFragment(pending.text, text),
    completed: pending.completed || event.type === "model.reasoning.completed",
  };
}

function flushPendingRunReasoning(
  pending: PendingRunReasoningNode | undefined,
  nodes: TranscriptNode[]
): undefined {
  if (pending === undefined) return undefined;
  const text = pending.text.trim();
  if (text.length === 0) return undefined;
  nodes.push({
    ...transcriptNode(pending.firstEvent, {
      kind: "thinking",
      phase: pending.completed ? "completed" : "noted",
      title: "思考",
      summary: compactSafeLine(text, 180),
      text,
    }),
    nodeId: `${pending.firstEvent.id}:reasoning-node`,
    eventType: pending.completed ? "model.reasoning.completed" : "model.reasoning.delta",
    refs: uniqueObservationRefs(pending.events.flatMap((event) => event.refs)),
  });
  return undefined;
}

function transcriptNode(
  event: RunEvent,
  input: {
    readonly kind: TranscriptNode["kind"];
    readonly phase: TranscriptNode["phase"];
    readonly title: string;
    readonly summary?: string;
    readonly text?: string;
    readonly display?: ToolDisplayProjection;
    readonly confirmation?: ConfirmationRequest;
  }
): TranscriptNode {
  return {
    nodeId: `${event.id}:node`,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.type,
    kind: input.kind,
    phase: input.phase,
    title: input.title,
    summary: input.summary,
    text: input.text,
    timestamp: event.timestamp,
    display: input.display,
    confirmation: input.confirmation,
    refs: event.refs,
  };
}

function toolCallRefsForRunEvent(event: RunEvent): readonly string[] {
  return event.refs.filter((ref) => ref.kind === "tool_call").map((ref) => ref.id);
}

function modelCallRefsForRunEvent(event: RunEvent): readonly string[] {
  return event.refs.filter((ref) => ref.kind === "model_call").map((ref) => ref.id);
}

function sameReasoningRefs(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length;
  }
  return left.some((id) => right.includes(id));
}

function appendReasoningFragment(current: string, next: string): string {
  if (current.length === 0) return next;
  if (/\s$/.test(current) || /^\s/.test(next)) return `${current}${next}`;
  if (/^[,.;:!?，。；：！？)\]}”’]/.test(next)) return `${current}${next}`;
  if (/[(\[{“‘]$/.test(current)) return `${current}${next}`;
  if (endsWithCjk(current) && startsWithCjk(next)) return `${current}${next}`;
  return `${current} ${next}`;
}

function startsWithCjk(value: string): boolean {
  return /^[\u3400-\u9fff\u3040-\u30ff]/u.test(value);
}

function endsWithCjk(value: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff]$/u.test(value);
}

function uniqueObservationRefs(refs: readonly ObservationRef[]): readonly ObservationRef[] {
  return refs.filter((ref, index, values) =>
    values.findIndex((candidate) => candidate.kind === ref.kind && candidate.id === ref.id) === index
  );
}

function transcriptToolSummaryFromRunEvent(event: RunEvent): string | undefined {
  const display = event.detail?.display;
  if (display?.kind === "command_summary") {
    const command = [display.command, ...(display.args ?? [])]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ");
    const exit = typeof display.exitCode === "number" ? `exit ${display.exitCode}` : undefined;
    return [command, exit, display.outputSummary, display.errorSummary]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join(" · ");
  }
  if (display?.kind === "search_results") {
    return [display.query, `${display.results.length} 条结果`]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join(" · ");
  }
  if (display?.kind === "browser_snapshot") {
    return display.title ?? display.url ?? event.detail?.preview ?? event.summary;
  }
  if (display?.kind === "file_change_summary" || display?.kind === "file_diff_preview") {
    return fileDisplaySummary(display) ?? event.detail?.preview ?? event.summary;
  }
  if (display?.kind === "generic_tool_summary") {
    return display.summary ?? display.items?.slice(0, 6).join("\n") ?? event.detail?.preview ?? event.summary;
  }
  return event.detail?.preview ?? event.summary;
}

function toolTranscriptTitleFromRunEvent(event: RunEvent, phase: TranscriptNodePhase): string {
  const title = toolTranscriptTitleSetFromRunEvent(event);
  if (phase === "preparing") return `准备${title.action}`;
  if (phase === "executing") return title.action;
  if (phase === "completed") return title.completed;
  if (phase === "failed") return title.failed;
  return title.action;
}

function toolTranscriptTitleSetFromRunEvent(event: RunEvent): {
  readonly action: string;
  readonly completed: string;
  readonly failed: string;
} {
  const display = event.detail?.display;
  const toolName = eventToolName(event)?.trim().toLowerCase() ?? "";
  if (display?.kind === "command_summary" || toolName === "run_command") {
    return { action: "运行命令", completed: "命令完成", failed: "命令未完成" };
  }
  if (toolName === "shell_command" || toolName.includes("terminal") || toolName.includes("powershell") || toolName.includes("cmd")) {
    return { action: "执行 Shell", completed: "Shell 完成", failed: "Shell 未完成" };
  }
  if (display?.kind === "search_results" || toolName === "search" || toolName === "web_search") {
    return { action: "搜索资料", completed: "资料搜索完成", failed: "资料搜索未完成" };
  }
  if (display?.kind === "browser_snapshot" || toolName === "browser_snapshot" || toolName.includes("browser")) {
    return { action: "读取网页", completed: "网页读取完成", failed: "网页读取未完成" };
  }
  if (display?.kind === "file_diff_preview" || toolName === "edit_file" || toolName.includes("patch") || toolName.includes("replace")) {
    return { action: "编辑文件", completed: "编辑完成", failed: "编辑未完成" };
  }
  if (display?.kind === "file_change_summary") {
    if (toolName === "create_file" || toolName.includes("create")) return { action: "创建文件", completed: "创建完成", failed: "创建未完成" };
    if (toolName === "delete_file" || toolName.includes("delete") || toolName.includes("remove")) return { action: "删除文件", completed: "删除完成", failed: "删除未完成" };
    return { action: "写入文件", completed: "写入完成", failed: "写入未完成" };
  }
  if (toolName === "grep_files" || toolName.includes("grep")) {
    return { action: "搜索文件", completed: "搜索完成", failed: "搜索未完成" };
  }
  if (toolName === "list_dir" || toolName === "list_files" || toolName.includes("list") || toolName.includes("dir")) {
    return { action: "浏览目录", completed: "目录浏览完成", failed: "目录浏览未完成" };
  }
  if (toolName === "read") {
    return { action: "读取资料", completed: "资料读取完成", failed: "资料读取未完成" };
  }
  if (toolName === "read_file" || toolName.startsWith("read_") || toolName.includes("file")) {
    return { action: "读取文件", completed: "读取完成", failed: "读取未完成" };
  }
  const action = event.detail?.action ??
    (event.detail?.display?.kind === "generic_tool_summary" ? event.detail.display.action : undefined) ??
    event.title;
  return { action, completed: `${action}完成`, failed: `${action}未完成` };
}

function eventToolName(event: RunEvent): string | undefined {
  const candidate = (event as RunEvent & { readonly toolName?: unknown }).toolName;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function fileDisplaySummary(display: Extract<ToolDisplayProjection, { readonly kind: "file_change_summary" | "file_diff_preview" }>): string | undefined {
  const changes =
    display.kind === "file_diff_preview"
      ? [
          display.replacements === undefined ? undefined : `${display.replacements} 处修改`,
          display.previousLength === undefined || display.nextLength === undefined
            ? undefined
            : `${display.previousLength} -> ${display.nextLength} chars`,
        ]
      : [
          display.bytes === undefined ? undefined : `${display.bytes} bytes`,
          display.append === true ? "append" : undefined,
        ];
  return [display.path, ...changes]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" · ") || undefined;
}

function compactSafeLine(value: string, maxLength: number): string {
  const normalized = redactOrdinaryText(value, maxLength).replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isLowValueAgentNote(value: string): boolean {
  const text = value.trim();
  return text === "等待模型输出。" ||
    text === "助手已选择使用工具，工具结果会作为安全摘要进入后续处理。" ||
    text === "Intelligence Channel requested model output." ||
    text === "Intelligence Channel completed model output validation.";
}

function userFacingConfirmationSummary(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (text.length === 0 || /^User approval was requested\.?$/i.test(text)) {
    return "继续前需要确认。";
  }
  return text;
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
    summary: context?.usageSummary ?? `上下文来源 ${allEntries.length} 项，普通视图只展示引用和内容摘要。`,
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
