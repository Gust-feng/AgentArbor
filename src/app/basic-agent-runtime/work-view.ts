import type {
  ContextLedger,
  ContextLedgerSkillFacts,
  AgentDeliverable,
  AgentDeliverableSection,
  BasicAgentRun,
  ConfirmationRequest,
  DesktopWorkViewAnswer,
  DesktopWorkViewReadModel,
  DesktopWorkViewStage,
  RunEvent,
  SkillSelectionDecisionFacts,
  SkillSelectionDecisionReason,
  TranscriptNode,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../../domain/tools/index.js";
import type { SubAgentRunView } from "../../domain/sub-agents/contracts.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { redactOrdinaryText } from "../safe-projection.js";
import {
  cleanConfirmationSummary,
  confirmationActionSummaryText,
  isGenericApprovalDecisionText,
} from "../confirmation-copy.js";
import {
  isLowValueOrdinaryAgentNote,
  isOrdinaryTranscriptSuppressedEvent,
} from "../ordinary-transcript-event-policy.js";
import {
  contextAttachmentsFor,
  contextLedgerFor,
  envelopeSafeToolEvidence,
  isToolDisplay,
  mergeToolDisplays,
  observationRefs,
  type WorkViewCanvasContextLike,
} from "./work-view-context.js";
import { transcriptNodesFromRunEvents } from "./work-view-transcript.js";
import type { BasicAgentContextSkillFacts } from "./contracts.js";

const DESKTOP_WORK_VIEW_ANSWER_MAX_CHARS = 128_000;

type DesktopAgentWorkViewCanvasLike = WorkViewCanvasContextLike & {
  readonly kind: "desktop_agent_canvas";
  readonly agent?: WorkViewCanvasContextLike["agent"] & {
    readonly answer?: {
      readonly answer: string;
      readonly evidenceRefs: readonly string[];
      readonly [key: string]: unknown;
    };
    readonly finalAnswer?: string;
    readonly pendingConfirmation?: {
      readonly confirmationId: string;
      readonly title: string;
      readonly question: string;
      readonly consequence: string;
      readonly affectedResources?: readonly string[];
      readonly riskLevel: string;
      readonly resumeAvailability?: "live" | "lost_after_restart";
      readonly requestedAt?: string;
      readonly expiresAt?: string;
      readonly sourceRefs: readonly string[];
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
};

type LegacyWorkSessionCanvasLike = WorkViewCanvasContextLike & {
  readonly kind: "work_session_canvas";
  readonly workSession?: {
    readonly directAnswer?: {
      readonly answer: string;
      readonly evidenceRefs: readonly string[];
      readonly followUpSuggestions: readonly string[];
      readonly [key: string]: unknown;
    };
    readonly report?: {
      readonly title: string;
      readonly keyFindings: readonly string[];
      readonly recommendations: readonly string[];
      readonly evidenceRefs: readonly string[];
      readonly nextActions: readonly string[];
      readonly decisionSummary: string;
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
};

export type DesktopWorkViewCanvasLike = WorkViewCanvasContextLike | DesktopAgentWorkViewCanvasLike | LegacyWorkSessionCanvasLike;

export type CreateDesktopWorkViewReadModelInput = {
  readonly run: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly canvas?: DesktopWorkViewCanvasLike;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly toolDisplays?: readonly ToolDisplayProjection[];
  readonly toolEvidence?: readonly ToolResultEnvelope[];
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly pendingConfirmation?: ConfirmationRequest;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
    readonly content?: string;
  };
  readonly restoredContextLedger?: ContextLedger;
  readonly subAgentRuns?: readonly SubAgentRunView[];
};

export function createDesktopWorkViewReadModel(
  input: CreateDesktopWorkViewReadModelInput
): DesktopWorkViewReadModel {
  const visibleEvents = visibleWorkViewEvents(input.events);
  const contextAttachments = contextAttachmentsFor(input);
  const toolEvidence = envelopeSafeToolEvidence(input.toolEvidence ?? []);
  const toolDisplays = mergeToolDisplays(toolEvidence.map((envelope) => envelope.uiDisplay).filter(isToolDisplay), input.toolDisplays ?? []);
  const contextLedger = input.restoredContextLedger ?? contextLedgerFor(input, contextAttachments, toolEvidence, toolDisplays);
  const triggeredSkills = triggeredSkillsFor(input);
  const pendingConfirmation = input.pendingConfirmation ?? pendingConfirmationFor(input.run, input.canvas);
  const answer = answerFor(input);
  const transcriptNodes = input.transcriptNodes ?? transcriptNodesFromRunEvents(transcriptSourceEvents(input.events), pendingConfirmation);
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
    triggeredSkills,
    pendingConfirmation,
    answer,
    deliverable,
    toolEvidence,
    visibleEvents,
    transcriptNodes,
    subAgentRuns: input.subAgentRuns ?? [],
    workSummary: {
      summary: workSummaryText({
        pendingActionCount: pendingConfirmation === undefined ? 0 : 1,
        toolResultCount: toolEvidence.length > 0 ? toolEvidence.length : toolDisplays.length,
        contextAttachmentCount: contextAttachments.length,
      }),
      pendingActionCount: pendingConfirmation === undefined ? 0 : 1,
      toolResultCount: toolEvidence.length > 0 ? toolEvidence.length : toolDisplays.length,
      contextAttachmentCount: contextAttachments.length,
    },
  };
}

function triggeredSkillsFor(input: CreateDesktopWorkViewReadModelInput): DesktopWorkViewReadModel["triggeredSkills"] {
  if (input.restoredContextLedger !== undefined) {
    return input.restoredContextLedger.entries
      .filter((entry) => entry.kind === "skill")
      .map((entry) => {
        if (entry.skill !== undefined) {
          return triggeredSkillFromFacts(entry.skill);
        }
        const parsed = parseSkillContextSummary(entry.entryId, entry.summary);
        return {
          skillId: parsed.skillId,
          name: parsed.name,
          triggerReason: parsed.triggerReason,
          summary: parsed.summary,
          sourceRef: `skill:${parsed.skillId}`,
          truncated: entry.status === "truncated",
        };
      });
  }
  const context = desktopAgentCanvasFor(input.canvas)?.agent?.context;
  const items = context?.items ?? [];
  return items
    .filter((item) => item.sourceKind === "skill")
    .map((item) => {
      if (item.skill !== undefined) {
        return triggeredSkillFromFacts(item.skill);
      }
      const parsed = parseSkillContextSummary(item.itemId, item.summary);
      return {
        skillId: parsed.skillId,
        name: parsed.name,
        triggerReason: parsed.triggerReason,
        summary: parsed.summary,
        sourceRef: `skill:${parsed.skillId}`,
        truncated: item.truncated,
      };
    });
}

type SkillFactsLike = ContextLedgerSkillFacts | BasicAgentContextSkillFacts;

function triggeredSkillFromFacts(facts: SkillFactsLike): DesktopWorkViewReadModel["triggeredSkills"][number] {
  const injectionStatus = "injectionStatus" in facts
    ? facts.injectionStatus
    : facts.loadStatus === "failed"
      ? "failed"
      : "injected";
  return {
    skillId: redactOrdinaryText(facts.skillId, 160),
    name: redactOrdinaryText(facts.name, 120),
    triggerReason: redactOrdinaryText(facts.triggerReason, 240),
    summary: redactOrdinaryText(facts.summary, 360),
    sourceRef: redactOrdinaryText(facts.sourceRef, 180),
    truncated: facts.truncated,
    loadedAt: facts.loadedAt,
    bodyHash: facts.bodyHash,
    contentHash: facts.contentHash,
    bodyCharCount: facts.bodyCharCount,
    loadStatus: facts.loadStatus,
    injectionStatus,
    markUsedStatus: facts.markUsedStatus,
    omitted: facts.omitted,
    error: facts.error === undefined ? undefined : redactOrdinaryText(facts.error, 240),
    warning: facts.warning === undefined ? undefined : redactOrdinaryText(facts.warning, 240),
    ...(facts.selection === undefined ? {} : { selection: skillSelectionFactsForReadModel(facts.selection) }),
  };
}

function skillSelectionFactsForReadModel(selection: SkillSelectionDecisionFacts): SkillSelectionDecisionFacts {
  const modelCallRef = selection.modelCallRef === undefined ? undefined : redactOrdinaryText(selection.modelCallRef, 180);
  const omittedReasons = skillSelectionReasonsForReadModel(selection.omittedReasons);
  const rejectedReasons = skillSelectionReasonsForReadModel(selection.rejectedReasons);
  const confidence = normalizedConfidence(selection.confidence);
  const reasonSummary = selection.reasonSummary === undefined ? undefined : redactOrdinaryText(selection.reasonSummary, 320);
  const selectionMethod = redactOrdinaryText(selection.selectionMethod, 80);
  return {
    selectionMethod: selectionMethod.length === 0 ? "unknown" : selectionMethod,
    candidateSkillIds: uniqueRedactedStrings(selection.candidateSkillIds, 24, 160),
    selectedSkillIds: uniqueRedactedStrings(selection.selectedSkillIds, 24, 160),
    ...(modelCallRef === undefined || modelCallRef.length === 0 ? {} : { modelCallRef }),
    ...(omittedReasons === undefined ? {} : { omittedReasons }),
    ...(rejectedReasons === undefined ? {} : { rejectedReasons }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(reasonSummary === undefined || reasonSummary.length === 0 ? {} : { reasonSummary }),
  };
}

function skillSelectionReasonsForReadModel(
  reasons: readonly SkillSelectionDecisionReason[] | undefined
): readonly SkillSelectionDecisionReason[] | undefined {
  const safeReasons = (reasons ?? [])
    .slice(0, 12)
    .map((reason): SkillSelectionDecisionReason | undefined => {
      const code = redactOrdinaryText(reason.code, 80);
      const summary = redactOrdinaryText(reason.summary, 320);
      const skillId = reason.skillId === undefined ? undefined : redactOrdinaryText(reason.skillId, 160);
      const skillName = reason.skillName === undefined ? undefined : redactOrdinaryText(reason.skillName, 120);
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

function uniqueRedactedStrings(values: readonly string[], limit: number, maxChars: number): readonly string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const safe = redactOrdinaryText(value, maxChars);
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

function parseSkillContextSummary(
  itemId: string,
  summary: string
): Pick<DesktopWorkViewReadModel["triggeredSkills"][number], "skillId" | "name" | "triggerReason" | "summary"> {
  const skillMarker = "context:skill:";
  const markerIndex = itemId.indexOf(skillMarker);
  const skillId = markerIndex >= 0 ? itemId.slice(markerIndex + skillMarker.length) : itemId;
  const lines = summary.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const name =
    stripLabel(lines.find((line) => line.startsWith("Triggered skill:")), "Triggered skill:") ??
    stripLabel(lines.find((line) => line.startsWith("技能：")), "技能：") ??
    skillId;
  const triggerReason =
    stripLabel(lines.find((line) => line.startsWith("Why:")), "Why:") ??
    stripLabel(lines.find((line) => line.startsWith("触发原因：")), "触发原因：") ??
    "技能名称或描述匹配当前任务。";
  return {
    skillId: redactOrdinaryText(skillId, 160),
    name: redactOrdinaryText(name, 120),
    triggerReason: redactOrdinaryText(triggerReason, 240),
    summary: redactOrdinaryText(`${name}：${triggerReason}`, 360),
  };
}

function stripLabel(value: string | undefined, label: string): string | undefined {
  if (value === undefined || !value.startsWith(label)) {
    return undefined;
  }
  const stripped = value.slice(label.length).trim();
  return stripped.length === 0 ? undefined : stripped;
}

function workSummaryText(input: {
  readonly pendingActionCount: number;
  readonly toolResultCount: number;
  readonly contextAttachmentCount: number;
}): string {
  const parts = [
    input.contextAttachmentCount > 0 ? `上下文 ${input.contextAttachmentCount}` : undefined,
    input.toolResultCount > 0 ? `证据 ${input.toolResultCount}` : undefined,
    input.pendingActionCount > 0 ? `待处理 ${input.pendingActionCount}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "本轮没有额外上下文。" : parts.join("；");
}

function transcriptSourceEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  return events.filter((event) => event.visibility !== "debug");
}

function visibleWorkViewEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  const productEvents = events
    .filter((event) => !isSuppressedOrdinaryWorkViewEvent(event))
    .filter(isProductWorkViewEvent);
  const selected = productEvents.length > 0
    ? productEvents.slice(-18)
    : events.filter((event) => !isSuppressedOrdinaryWorkViewEvent(event)).slice(-18);
  return selected.map(projectVisibleWorkViewEvent);
}

function isSuppressedOrdinaryWorkViewEvent(event: RunEvent): boolean {
  if (isOrdinaryTranscriptSuppressedEvent(event)) {
    return true;
  }
  if (event.type === "run.resumed") {
    return true;
  }
  if (event.type === "user_approval.received" && isGenericApprovalDecisionText(event.summary ?? event.detail?.preview ?? event.title)) {
    return true;
  }
  if ((event.type === "agent.note.completed" || event.type === "agent.note.delta") && isLowValueOrdinaryAgentNote(event.summary ?? event.delta)) {
    return true;
  }
  return false;
}

function projectVisibleWorkViewEvent(event: RunEvent): RunEvent {
  if (event.type !== "confirmation.needed") {
    return event;
  }
  const cleanSummary = cleanConfirmationSummary(event.summary ?? "");
  const cleanTitle = cleanConfirmationTitle(event.title, cleanSummary);
  return {
    ...event,
    title: cleanTitle,
    summary: cleanSummary.length > 0 ? cleanSummary : undefined,
  };
}

function isProductWorkViewEvent(event: RunEvent): boolean {
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

function cleanConfirmationTitle(title: string, fallback: string): string {
  const cleaned = cleanConfirmationSummary(title);
  if (/^(?:需要确认|待确认|确认继续|确认执行命令)$/i.test(cleaned.trim())) {
    return fallback.length > 0 ? fallback : "待处理";
  }
  return cleaned.length > 0 ? cleaned : fallback.length > 0 ? fallback : "待处理";
}

function stageFor(
  run: BasicAgentRun,
  events: readonly RunEvent[],
  pendingConfirmation: ConfirmationRequest | undefined,
  deliverable: AgentDeliverable | undefined,
  answer: DesktopWorkViewAnswer | undefined
): DesktopWorkViewStage {
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
  stage: DesktopWorkViewStage,
  deliverable: AgentDeliverable | undefined,
  answer: DesktopWorkViewAnswer | undefined
): string {
  void run;
  if (stage === "completed") return deliverable?.title ?? answer?.title ?? "";
  if (stage === "awaiting_approval") return "待处理";
  if (stage === "blocked") return "需要处理";
  if (stage === "failed") return "未完成";
  if (stage === "cancelled") return "已取消";
  return "";
}

function currentActionFor(
  run: BasicAgentRun,
  stage: DesktopWorkViewStage,
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
  if (run.currentStep !== undefined && !isGenericApprovalDecisionText(run.currentStep)) {
    return run.currentStep;
  }
  void stage;
  return "";
}

function deliverableFor(input: {
  readonly run: BasicAgentRun;
  readonly canvas?: DesktopWorkViewCanvasLike;
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
  readonly answer?: DesktopWorkViewAnswer;
}): AgentDeliverable | undefined {
  const canvas = input.canvas;
  const desktopCanvas = desktopAgentCanvasFor(canvas);
  const legacyCanvas = legacyWorkSessionCanvasFor(canvas);
  if (desktopCanvas?.agent?.answer !== undefined) {
    return undefined;
  }
  if (legacyCanvas?.workSession?.report !== undefined) {
    const report = legacyCanvas.workSession.report;
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
  if (legacyCanvas?.workSession?.directAnswer !== undefined) {
    return undefined;
  }
  if (input.restoredResult !== undefined && input.run.status === "completed") {
    return undefined;
  }
  return undefined;
}

function answerFor(input: CreateDesktopWorkViewReadModelInput): DesktopWorkViewAnswer | undefined {
  const canvas = input.canvas;
  const desktopCanvas = desktopAgentCanvasFor(canvas);
  const legacyCanvas = legacyWorkSessionCanvasFor(canvas);
  if (desktopCanvas?.agent?.answer !== undefined) {
    return {
      title: "已回答",
      content: redactOrdinaryText(desktopCanvas.agent.answer.answer, DESKTOP_WORK_VIEW_ANSWER_MAX_CHARS),
      evidenceRefs: observationRefs(desktopCanvas.agent.answer.evidenceRefs),
      nextActions: [],
    };
  }
  if (typeof desktopCanvas?.agent?.finalAnswer === "string" && desktopCanvas.agent.finalAnswer.trim().length > 0) {
    return {
      title: "已回答",
      content: redactOrdinaryText(desktopCanvas.agent.finalAnswer, DESKTOP_WORK_VIEW_ANSWER_MAX_CHARS),
      evidenceRefs: [],
      nextActions: [],
    };
  }
  if (legacyCanvas?.workSession?.directAnswer !== undefined) {
    return {
      title: "已回答",
      content: redactOrdinaryText(legacyCanvas.workSession.directAnswer.answer, DESKTOP_WORK_VIEW_ANSWER_MAX_CHARS),
      evidenceRefs: observationRefs(legacyCanvas.workSession.directAnswer.evidenceRefs),
      nextActions: legacyCanvas.workSession.directAnswer.followUpSuggestions
        .map((item) => redactOrdinaryText(item, 220))
        .filter((item) => item.length > 0)
        .slice(0, 5),
    };
  }
  if (input.run.status === "completed" && input.restoredResult?.content !== undefined) {
    return {
      title: input.restoredResult.title.length > 0 ? input.restoredResult.title : "已回答",
      content: redactOrdinaryText(input.restoredResult.content, DESKTOP_WORK_VIEW_ANSWER_MAX_CHARS),
      evidenceRefs: [],
      nextActions: [],
    };
  }
  return undefined;
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
  canvas: DesktopWorkViewCanvasLike | undefined
): ConfirmationRequest | undefined {
  const desktopCanvas = desktopAgentCanvasFor(canvas);
  if (run.status !== "approval_needed") {
    return undefined;
  }
  if (desktopCanvas?.agent?.pendingConfirmation === undefined) {
    return undefined;
  }
  const pending = desktopCanvas.agent.pendingConfirmation;
  return {
    confirmationId: pending.confirmationId,
    runId: run.runId,
    conversationId: run.conversationId,
    title: redactOrdinaryText(pending.title, 120),
    actionSummary: redactOrdinaryText(
      confirmationActionSummaryText({
        question: pending.question,
        consequence: pending.consequence,
      }),
      600
    ),
    riskLevel: pending.riskLevel === "low" || pending.riskLevel === "medium" || pending.riskLevel === "high" ? pending.riskLevel : "medium",
    affectedResources: (pending.affectedResources ?? pending.sourceRefs).map((ref) => redactOrdinaryText(ref, 240)),
    resumeAvailability: pending.resumeAvailability ?? "live",
    requestedAt: pending.requestedAt ?? run.updatedAt,
    expiresAt: pending.expiresAt,
    sourceRefs: pending.sourceRefs,
  };
}

function desktopAgentCanvasFor(canvas: DesktopWorkViewCanvasLike | undefined): DesktopAgentWorkViewCanvasLike | undefined {
  return canvas?.kind === "desktop_agent_canvas" ? canvas as DesktopAgentWorkViewCanvasLike : undefined;
}

function legacyWorkSessionCanvasFor(canvas: DesktopWorkViewCanvasLike | undefined): LegacyWorkSessionCanvasLike | undefined {
  return canvas?.kind === "work_session_canvas" ? canvas as LegacyWorkSessionCanvasLike : undefined;
}
