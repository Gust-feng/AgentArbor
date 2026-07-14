import type { ObservationRef } from "../../domain/observation/index.js";
import type { SkillSelectionDecisionFacts, SkillSelectionDecisionReason } from "../../domain/basic-agent/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { AgentDefinition } from "../agent-prompts/contracts.js";
import type {
  DesktopAgentConversationMessage,
  DesktopAgentInterruptedRunContext,
  DesktopAgentPriorToolCallContext,
  DesktopAgentSkillContext,
} from "../desktop-agent/desktop-agent-contracts.js";
import type { BasicAgentContextItem, BasicAgentContextSkillFacts } from "./contracts.js";
import type { BasicAgentConversationSummary } from "./conversation-compaction.js";
import {
  safeContextText as safeText,
  safeConversationContextText as safeConversationText,
  safePlainContextText as safePlain,
  safeUnboundedContextText as safeUnboundedText,
} from "./context-ledger-safe-text.js";

export type BasicAgentContextAgentDefinition = Pick<AgentDefinition, "agentId" | "prompt">;

export type BuildContextLedgerDraftInput = {
  readonly agentDefinition: BasicAgentContextAgentDefinition;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly conversationHistory: readonly DesktopAgentConversationMessage[];
  readonly conversationSummary?: BasicAgentConversationSummary;
  readonly interruptedRunContexts?: readonly DesktopAgentInterruptedRunContext[];
  readonly priorToolCallContexts?: readonly DesktopAgentPriorToolCallContext[];
  readonly skillContexts?: readonly DesktopAgentSkillContext[];
};

const RECENT_HISTORY_PAIR_COUNT = 4;
const MAX_SKILL_REASON_CHARS = 240;
const MAX_SKILL_SELECTION_ID_CHARS = 160;
const MAX_SKILL_SELECTION_REF_CHARS = 180;
const MAX_SKILL_SELECTION_METHOD_CHARS = 80;
const MAX_SKILL_SELECTION_REASON_CHARS = 320;
const MAX_SKILL_SELECTION_REASONS = 12;
const MAX_SKILL_SELECTION_IDS = 24;
const MAX_SKILL_RESOURCE_ITEMS = 12;
const MAX_SKILL_RESOURCE_PATH_CHARS = 220;
const MAX_SKILL_RESOURCE_NAME_CHARS = 120;
const MAX_SKILL_RESOURCE_NOTE_CHARS = 1_200;
const MAX_REF_SUMMARY_CHARS = 240;
const MAX_PREVIEW_CHARS = 700;
const MAX_INTERRUPTED_RUN_CONTEXT_CHARS = 1_600;

type RuntimeSkillResourceType = "script" | "reference" | "asset";

export function buildContextLedgerDraftItems(input: BuildContextLedgerDraftInput): readonly BasicAgentContextItem[] {
  return [
    systemContextItem(input.agentDefinition),
    ...skillContextItems(input.skillContexts ?? []),
    ...historyContextItems(input.conversationHistory, input.conversationSummary),
    ...priorToolCallContextItems(input.priorToolCallContexts ?? []),
    ...interruptedRunContextItems(input.interruptedRunContexts ?? []),
    ...taskSoilRefItems(input.taskSoil),
    currentUserMessageItem(input.goal, input.taskSoil),
  ];
}

function priorToolCallContextItems(
  contexts: readonly DesktopAgentPriorToolCallContext[]
): readonly BasicAgentContextItem[] {
  return contexts.slice(-24).map((context) => {
    const content = safeUnboundedText(priorToolCallContextModelText(context));
    return {
      itemId: `context:run-tool:${context.runId}:${context.callId}`,
      sourceKind: "run_tool_fact",
      summary: content.text,
      refs: priorToolCallRefs(context),
      visibility: "model" as const,
      truncated: context.factTruncation !== undefined,
    };
  });
}

function priorToolCallContextModelText(context: DesktopAgentPriorToolCallContext): string {
  return [
    "Tool execution fact from the immediately preceding ordinary agent run. Treat it as observed context; call tools again when freshness or omitted data matters.",
    `run_id=${safePlain(context.runId, 180)}`,
    `call_id=${safePlain(context.callId, 180)}`,
    `tool=${safePlain(context.toolName, 180)}`,
    `status=${context.status}`,
    context.input === undefined ? undefined : `input:\n${JSON.stringify(context.input, null, 2)}`,
    context.output === undefined ? undefined : `output:\n${JSON.stringify(context.output, null, 2)}`,
    context.error === undefined ? undefined : `error:\n${context.error}`,
    context.errorDomain === undefined ? undefined : `error_domain=${safePlain(context.errorDomain, 120)}`,
    context.errorFacts === undefined ? undefined : `error_facts:\n${JSON.stringify(context.errorFacts, null, 2)}`,
    context.factTruncation === undefined
      ? undefined
      : `fact_truncation=${JSON.stringify(context.factTruncation)}`,
    context.refs.length === 0
      ? undefined
      : `refs=${context.refs.map((ref) => safePlain(ref, 220)).filter((ref) => ref.length > 0).join("; ")}`,
  ].filter(isString).join("\n");
}

function priorToolCallRefs(context: DesktopAgentPriorToolCallContext): readonly ObservationRef[] {
  return [...new Set([`run:${context.runId}`, ...context.refs])]
    .slice(0, 10)
    .map((id): ObservationRef => ({ kind: "event", id }));
}

function interruptedRunContextItems(
  contexts: readonly DesktopAgentInterruptedRunContext[]
): readonly BasicAgentContextItem[] {
  return contexts.slice(-6).map((context, index) => {
    const modelText = interruptedRunContextModelText(context);
    const summary = safeText(modelText.text, MAX_INTERRUPTED_RUN_CONTEXT_CHARS);
    return {
      itemId: `context:run-interruption:${context.runId}:${index}`,
      sourceKind: "run_interruption",
      summary: summary.text,
      refs: interruptedRunRefs(context),
      visibility: "model" as const,
      truncated: summary.truncated || modelText.truncated,
    };
  });
}

function interruptedRunContextModelText(context: DesktopAgentInterruptedRunContext): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const message = context.message === undefined ? undefined : safeText(context.message, 520);
  const partialOutput = context.partialOutput === undefined ? undefined : safeText(context.partialOutput, 900);
  const parts = [
    "Previous ordinary agent run did not complete. Treat this as runtime continuity context, not as a completed assistant answer.",
    `run_id=${safePlain(context.runId, 180)}`,
    `assistant_turn_status=${context.turnStatus}`,
    context.stopReason === undefined ? undefined : `stop_reason=${safePlain(context.stopReason, 180)}`,
    context.continuationAvailability === undefined
      ? undefined
      : `continuation_availability=${context.continuationAvailability}`,
    message === undefined || message.text.trim().length === 0
      ? undefined
      : `message:\n${message.text}`,
    partialOutput === undefined || partialOutput.text.trim().length === 0
      ? undefined
      : `partial_output:\n${partialOutput.text}`,
    context.refs.length === 0
      ? undefined
      : `refs=${context.refs.slice(0, 8).map((ref) => safePlain(ref, 220)).filter((ref) => ref.length > 0).join("; ")}`,
  ].filter(isString);
  return {
    text: parts.join("\n"),
    truncated: message?.truncated === true || partialOutput?.truncated === true,
  };
}

function interruptedRunRefs(context: DesktopAgentInterruptedRunContext): readonly ObservationRef[] {
  const refs = [`run:${context.runId}`, ...context.refs]
    .map((ref) => safePlain(ref, 220))
    .filter((ref) => ref.length > 0);
  return [...new Set(refs)].slice(0, 10).map((id): ObservationRef => ({ kind: "event", id }));
}

function systemContextItem(agentDefinition: BasicAgentContextAgentDefinition): BasicAgentContextItem {
  return {
    itemId: `context:system:${agentDefinition.agentId}`,
    sourceKind: "system",
    summary: agentDefinition.prompt.systemPrompt,
    refs: [{ kind: "event", id: agentDefinition.prompt.promptRef }],
    visibility: "model",
    truncated: false,
  };
}

function skillContextItems(skills: readonly DesktopAgentSkillContext[]): readonly BasicAgentContextItem[] {
  return skills.slice(0, 4).map((context) => {
    const name = safeText(context.skill.name, 120);
    const skillId = safeText(context.skill.id, 160);
    const summary = safeText(skillSafeSummary(context), 420);
    const skillFacts = skillFactsForContext(context, summary.text);
    if ((context.loadStatus ?? "loaded") === "failed") {
      return {
        itemId: `context:skill:${context.skill.id}`,
        sourceKind: "skill",
        summary: summary.text,
        refs: [{ kind: "event", id: `skill:${context.skill.id}` }],
        visibility: "diagnostic" as const,
        truncated: summary.truncated,
        skill: {
          ...skillFacts,
          truncated: summary.truncated,
          omitted: false,
        },
      };
    }
    const body = safeUnboundedText(context.body);
    const reason = safeText(context.triggerReason, MAX_SKILL_REASON_CHARS);
    const resources = skillResourceIndexPrompt(context);
    const modelContent = [
      `Triggered skill: ${name.text}`,
      `Why: ${reason.text}`,
      "Use these skill instructions when relevant. Do not mention internal skill loading unless the user asks.",
      body.text,
      resources,
    ].join("\n");
    return {
      itemId: `context:skill:${context.skill.id}`,
      sourceKind: "skill",
      summary: summary.text,
      modelContent,
      refs: [{ kind: "event", id: `skill:${context.skill.id}` }],
      visibility: "model" as const,
      truncated: body.truncated || reason.truncated || summary.truncated || context.truncated === true,
      skill: {
        ...skillFacts,
        truncated: body.truncated || reason.truncated || summary.truncated || context.truncated === true,
        omitted: false,
      },
    };
  });
}

function skillResourceIndexPrompt(context: DesktopAgentSkillContext): string | undefined {
  const resources = skillResourcePromptItems(context);
  if (resources.length === 0) {
    return undefined;
  }
  const lines = [
    "Skill resources available through read_skill_resource (contents are not preloaded):",
    ...resources.map((resource) =>
      `- type=${resource.type} path=${resource.relativePath}` +
      (resource.name === undefined ? "" : ` name=${resource.name}`) +
      (resource.byteLength === undefined ? "" : ` bytes=${resource.byteLength}`)
    ),
  ];
  const note = safeText(lines.join("\n"), MAX_SKILL_RESOURCE_NOTE_CHARS);
  return note.text;
}

function skillResourcePromptItems(context: DesktopAgentSkillContext): readonly {
  readonly type: RuntimeSkillResourceType;
  readonly relativePath: string;
  readonly name?: string;
  readonly byteLength?: number;
}[] {
  const discovered = (context.skill.resourceIndex ?? [])
    .filter((resource): resource is typeof resource & { readonly type: RuntimeSkillResourceType } =>
      isRuntimeSkillResourceType(resource.type)
    )
    .filter((resource) => resource.exists)
    .map((resource) => ({
      type: resource.type,
      relativePath: safeResourcePath(resource.relativePath),
      byteLength: resource.byteLength,
    }));
  const frozen = (context.skill.resources ?? [])
    .filter((resource) => resource.loadError === undefined)
    .map((resource) => ({
      type: resource.kind,
      relativePath: safeResourcePath(resource.relativePath ?? resource.name),
      name: safePlain(resource.name, MAX_SKILL_RESOURCE_NAME_CHARS),
      byteLength: resource.byteLength,
    }));
  const selected: {
    type: RuntimeSkillResourceType;
    relativePath: string;
    name?: string;
    byteLength?: number;
  }[] = [];
  const seen = new Set<string>();
  for (const resource of [...discovered, ...frozen]) {
    if (resource.relativePath.length === 0) {
      continue;
    }
    const key = `${resource.type}:${resource.relativePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(resource);
    if (selected.length >= MAX_SKILL_RESOURCE_ITEMS) {
      break;
    }
  }
  return selected;
}

function isRuntimeSkillResourceType(value: string): value is RuntimeSkillResourceType {
  return value === "script" || value === "reference" || value === "asset";
}

function safeResourcePath(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.length === 0 || normalized.startsWith("/") || normalized.includes("../")) {
    return "";
  }
  return safePlain(normalized, MAX_SKILL_RESOURCE_PATH_CHARS);
}

function skillFactsForContext(context: DesktopAgentSkillContext, fallbackSummary: string): BasicAgentContextSkillFacts {
  const selection = skillSelectionFactsForContext(context.selection);
  return {
    skillId: context.skill.id,
    name: context.skill.name,
    triggerReason: context.triggerReason,
    summary: context.summary ?? fallbackSummary,
    sourceRef: `skill:${context.skill.id}`,
    selectedAt: context.selectedAt,
    loadedAt: context.loadedAt,
    bodyHash: context.bodyHash,
    contentHash: context.contentHash,
    bodyCharCount: context.bodyCharCount ?? context.body.length,
    loadStatus: context.loadStatus ?? "loaded",
    markUsedStatus: context.markUsedStatus,
    truncated: context.truncated === true,
    omitted: context.omitted === true,
    error: context.error,
    warning: context.warning,
    ...(selection === undefined ? {} : { selection }),
  };
}

function skillSafeSummary(context: DesktopAgentSkillContext): string {
  const parts = [
    `技能：${context.skill.name}`,
    `触发原因：${safeText(context.triggerReason, MAX_SKILL_REASON_CHARS).text}`,
    context.loadStatus === "failed"
      ? `加载状态：失败${context.error === undefined ? "" : `（${safeText(context.error, 160).text}）`}`
      : "加载状态：已加载",
    context.loadedAt === undefined ? undefined : `加载时间：${context.loadedAt}`,
    context.contentHash ?? context.bodyHash,
    context.bodyCharCount === undefined ? undefined : `正文字符数：${context.bodyCharCount}`,
    context.truncated === true ? "正文已截断。" : undefined,
    context.warning,
  ].filter(isString);
  return parts.join("\n");
}

function historyContextItems(
  history: readonly DesktopAgentConversationMessage[],
  conversationSummary: BasicAgentConversationSummary | undefined
): readonly BasicAgentContextItem[] {
  const safeHistory = history
    .map((message, index) => {
      const safe = safeConversationText(message.content);
      return {
        message,
        index,
        safe,
      };
    })
    .filter((entry) => entry.safe.text.length > 0);
  const recentMessageCount = RECENT_HISTORY_PAIR_COUNT * 2;
  const earlier = safeHistory.slice(0, Math.max(0, safeHistory.length - recentMessageCount));
  const recent = safeHistory.slice(Math.max(0, safeHistory.length - recentMessageCount));
  const earlierItems = conversationSummary === undefined
    ? earlier.map((entry): BasicAgentContextItem => ({
        itemId: entry.message.ref ?? `context:conversation:${entry.index}`,
        sourceKind: "conversation",
        role: entry.message.role,
        summary: entry.safe.text,
        refs: [{ kind: "event" as const, id: entry.message.ref ?? `conversation:history:${entry.index}` }],
        visibility: "model" as const,
        truncated: entry.safe.truncated,
      }))
    : [];
  const summaryItem = conversationSummary === undefined
    ? undefined
    : aiConversationSummaryItem(conversationSummary, earlier);
  const recentItems = recent.map((entry): BasicAgentContextItem => ({
    itemId: entry.message.ref ?? `context:conversation:${entry.index}`,
    sourceKind: "conversation_recent_turn",
    role: entry.message.role,
    summary: entry.safe.text,
    refs: [{ kind: "event" as const, id: entry.message.ref ?? `conversation:history:${entry.index}` }],
    visibility: "model" as const,
    truncated: entry.safe.truncated,
  }));
  return summaryItem === undefined ? [...earlierItems, ...recentItems] : [summaryItem, ...recentItems];
}

function aiConversationSummaryItem(
  summary: BasicAgentConversationSummary,
  fallbackEntries: readonly {
    readonly message: DesktopAgentConversationMessage;
    readonly index: number;
    readonly safe: { readonly text: string; readonly truncated: boolean };
  }[]
): BasicAgentContextItem | undefined {
  const safeSummary = safeUnboundedText(
    [
      "Earlier conversation summary (model-compacted; use only as background):",
      summary.summary,
    ].join("\n")
  );
  if (safeSummary.text.length === 0) {
    return undefined;
  }
  return {
    itemId: summary.summaryId,
    sourceKind: "conversation_summary",
    summary: safeSummary.text,
    refs: summary.coveredRefs.length > 0
      ? summary.coveredRefs.map((id): ObservationRef => ({ kind: "event", id }))
      : fallbackEntries.slice(0, 12).map((entry): ObservationRef => ({
          kind: "event",
          id: entry.message.ref ?? `conversation:history:${entry.index}`,
        })),
    visibility: "model",
    truncated: safeSummary.truncated,
  };
}

function currentUserMessageItem(goal: string, taskSoil: TaskSoil): BasicAgentContextItem {
  const safe = safeUnboundedText(goal);
  return {
    itemId: `context:goal:${taskSoil.goalId}`,
    sourceKind: "user_message",
    summary: safe.text,
    refs: [{ kind: "goal", id: taskSoil.goalId ?? taskSoil.taskSoilId }],
    visibility: "model",
    truncated: safe.truncated,
  };
}

function taskSoilRefItems(taskSoil: TaskSoil): readonly BasicAgentContextItem[] {
  return taskSoil.contextRefs.map((ref, index) => {
    const itemId = `context:task-soil:${index}`;
    const summary = safeText(contextRefPromptLine(ref), MAX_REF_SUMMARY_CHARS + MAX_PREVIEW_CHARS);
    const modelContent = safeText(contextRefModelLine(ref, itemId), MAX_REF_SUMMARY_CHARS + 360);
    const modelVisible = isModelVisibleContextRef(ref, taskSoil);
    return {
      itemId,
      sourceKind: "task_soil_ref",
      summary: summary.text,
      modelContent: modelVisible ? modelContent.text : undefined,
      refs: [{ kind: "goal", id: taskSoil.goalId ?? taskSoil.taskSoilId }],
      visibility: modelVisible ? "model" as const : "diagnostic" as const,
      truncated: summary.truncated || (modelVisible && modelContent.truncated),
    };
  });
}

function isModelVisibleContextRef(ref: TaskSoil["contextRefs"][number], taskSoil: TaskSoil): boolean {
  if (ref.kind === "user_goal" || ref.kind === "runtime") {
    return false;
  }
  if (ref.kind === "workspace" && (ref.ref === `workspace:${taskSoil.goalId}` || ref.ref.startsWith("workspace:goal-"))) {
    return false;
  }
  return ref.kind === "workspace" || ref.kind === "file" || ref.kind === "project" || ref.kind === "web";
}

function contextRefPromptLine(ref: TaskSoil["contextRefs"][number]): string {
  if (ref.kind === "user_goal") {
    return `- user message summary=${safeText(ref.summary ?? "none", MAX_REF_SUMMARY_CHARS).text}`;
  }
  if (ref.ref.startsWith("workspace:goal-")) {
    return `- workspace:current-task summary=${safeText(ref.summary ?? "current task context refs only", MAX_REF_SUMMARY_CHARS).text}`;
  }
  const preview = ref.readonlyPreview;
  const previewText =
    preview === undefined
      ? ""
      : ` preview=${safeText([preview.title, preview.text].filter(Boolean).join(": "), MAX_PREVIEW_CHARS).text}`;
  return `- ${ref.kind}:${safePlain(ref.ref, 220)}${contextRefMetadataText(ref)} summary=${safeText(ref.summary ?? "none", MAX_REF_SUMMARY_CHARS).text}${previewText}`;
}

function contextRefModelLine(ref: TaskSoil["contextRefs"][number], fallbackAttachmentId: string): string {
  const safeRef = modelSafeContextRef(ref.ref);
  return [
    "User-provided context attachment is authorized for this run.",
    `attachment_id=${safePlain(ref.attachmentId ?? safeRef ?? fallbackAttachmentId, 220)}`,
    `kind=${ref.kind}`,
    safeRef === undefined ? undefined : `ref=${safePlain(safeRef, 220)}`,
    ref.title === undefined ? undefined : `title=${safeText(ref.title, 120).text}`,
    ref.summary === undefined ? undefined : `summary=${safeText(ref.summary, MAX_REF_SUMMARY_CHARS).text}`,
    ref.metadata?.mimeType === undefined ? undefined : `mime=${safePlain(ref.metadata.mimeType, 120)}`,
    ref.metadata?.byteLength === undefined ? undefined : `bytes=${ref.metadata.byteLength}`,
    ref.metadata?.truncated === true ? "preview_truncated=true" : undefined,
    "Inspect it with available attachment tools, or directly if the runtime already attached file or image input to the current request. Do not assume unread attachment content.",
  ].filter(isString).join(" ");
}

function modelSafeContextRef(ref: string): string | undefined {
  const normalized = ref.toLowerCase();
  if (normalized.startsWith("local-file:") || normalized.startsWith("local-project:")) {
    return undefined;
  }
  return ref;
}

function contextRefMetadataText(ref: TaskSoil["contextRefs"][number]): string {
  const parts = [
    ref.attachmentId === undefined ? undefined : ` attachment_id=${safePlain(ref.attachmentId, 220)}`,
    ref.title === undefined ? undefined : ` title=${safeText(ref.title, 120).text}`,
    ref.metadata?.mimeType === undefined ? undefined : ` mime=${safePlain(ref.metadata.mimeType, 120)}`,
    ref.metadata?.byteLength === undefined ? undefined : ` bytes=${ref.metadata.byteLength}`,
  ].filter(isString);
  return parts.join("");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function skillSelectionFactsForContext(
  selection: SkillSelectionDecisionFacts | undefined
): SkillSelectionDecisionFacts | undefined {
  if (selection === undefined) {
    return undefined;
  }
  const method = safePlain(selection.selectionMethod, MAX_SKILL_SELECTION_METHOD_CHARS);
  const modelCallRef = selection.modelCallRef === undefined
    ? undefined
    : safePlain(selection.modelCallRef, MAX_SKILL_SELECTION_REF_CHARS);
  const omittedReasons = skillSelectionReasons(selection.omittedReasons);
  const rejectedReasons = skillSelectionReasons(selection.rejectedReasons);
  const confidence = normalizedConfidence(selection.confidence);
  const reasonSummary = selection.reasonSummary === undefined
    ? undefined
    : safeText(selection.reasonSummary, MAX_SKILL_SELECTION_REASON_CHARS).text;
  return {
    selectionMethod: method.length === 0 ? "unknown" : method,
    candidateSkillIds: uniqueSafeStrings(selection.candidateSkillIds, MAX_SKILL_SELECTION_IDS, MAX_SKILL_SELECTION_ID_CHARS),
    selectedSkillIds: uniqueSafeStrings(selection.selectedSkillIds, MAX_SKILL_SELECTION_IDS, MAX_SKILL_SELECTION_ID_CHARS),
    ...(modelCallRef === undefined || modelCallRef.length === 0 ? {} : { modelCallRef }),
    ...(omittedReasons === undefined ? {} : { omittedReasons }),
    ...(rejectedReasons === undefined ? {} : { rejectedReasons }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(reasonSummary === undefined || reasonSummary.length === 0 ? {} : { reasonSummary }),
  };
}

function skillSelectionReasons(
  reasons: readonly SkillSelectionDecisionReason[] | undefined
): readonly SkillSelectionDecisionReason[] | undefined {
  const safeReasons = (reasons ?? [])
    .slice(0, MAX_SKILL_SELECTION_REASONS)
    .map((reason): SkillSelectionDecisionReason | undefined => {
      const code = safePlain(reason.code, MAX_SKILL_SELECTION_METHOD_CHARS);
      const summary = safeText(reason.summary, MAX_SKILL_SELECTION_REASON_CHARS).text;
      const skillId = reason.skillId === undefined ? undefined : safePlain(reason.skillId, MAX_SKILL_SELECTION_ID_CHARS);
      const skillName = reason.skillName === undefined ? undefined : safePlain(reason.skillName, 120);
      const confidence = normalizedConfidence(reason.confidence);
      if (code.length === 0 || summary.length === 0) {
        return undefined;
      }
      return {
        code,
        summary,
        ...(skillId === undefined || skillId.length === 0 ? {} : { skillId }),
        ...(skillName === undefined || skillName.length === 0 ? {} : { skillName }),
        ...(confidence === undefined ? {} : { confidence }),
      };
    })
    .filter((reason): reason is SkillSelectionDecisionReason => reason !== undefined);
  return safeReasons.length === 0 ? undefined : safeReasons;
}

function uniqueSafeStrings(values: readonly string[], limit: number, maxChars: number): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const safe = safePlain(value, maxChars);
    if (safe.length === 0 || seen.has(safe)) {
      continue;
    }
    seen.add(safe);
    selected.push(safe);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

function normalizedConfidence(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}
