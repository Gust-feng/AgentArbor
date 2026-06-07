import type {
  AgentDeliverable,
  AgentDeliverableSection,
  BasicAgentRun,
  ConfirmationRequest,
  DesktopWorkViewAnswer,
  DesktopWorkViewReadModel,
  DesktopWorkViewStage,
  RunEvent,
  TranscriptNode,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef } from "../../domain/observation/index.js";
import type { ToolDisplayProjection, ToolResultEnvelope } from "../../domain/tools/index.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { redactOrdinaryText } from "../safe-projection.js";
import { cleanConfirmationSummary } from "../confirmation-copy.js";
import {
  contextAttachmentsFor,
  contextLedgerFor,
  envelopeSafeToolEvidence,
  isToolDisplay,
  mergeToolDisplays,
  observationRefs,
  type WorkViewCanvasContextLike,
} from "./work-session-context.js";
import { transcriptNodesFromRunEvents } from "./work-session-transcript.js";

export type DesktopWorkViewCanvasLike = WorkViewCanvasContextLike & {
  readonly agent?: WorkViewCanvasContextLike["agent"] & {
    readonly answer?: {
      readonly answer: string;
      readonly evidenceRefs: readonly string[];
      readonly [key: string]: unknown;
    };
    readonly pendingConfirmation?: {
      readonly confirmationId: string;
      readonly title: string;
      readonly question: string;
      readonly consequence: string;
      readonly riskLevel: string;
      readonly sourceRefs: readonly string[];
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
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
  };
};

export function createDesktopWorkViewReadModel(
  input: CreateDesktopWorkViewReadModelInput
): DesktopWorkViewReadModel {
  const visibleEvents = visibleWorkViewEvents(input.events);
  const contextAttachments = contextAttachmentsFor(input);
  const toolEvidence = envelopeSafeToolEvidence(input.toolEvidence ?? []);
  const toolDisplays = mergeToolDisplays(toolEvidence.map((envelope) => envelope.uiDisplay).filter(isToolDisplay), input.toolDisplays ?? []);
  const contextLedger = contextLedgerFor(input, contextAttachments, toolEvidence, toolDisplays);
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

/**
 * @deprecated Compatibility name for older panel code. New backend read-model
 * composition should use createDesktopWorkViewReadModel.
 */
export const createDesktopWorkSessionReadModel = createDesktopWorkViewReadModel;

/**
 * @deprecated Compatibility input name for older panel code. New backend
 * read-model composition should use CreateDesktopWorkViewReadModelInput.
 */
export type CreateDesktopWorkSessionReadModelInput = CreateDesktopWorkViewReadModelInput;

/**
 * @deprecated Compatibility canvas name for older panel code. New backend
 * read-model composition should use DesktopWorkViewCanvasLike.
 */
export type DesktopWorkSessionCanvasLike = DesktopWorkViewCanvasLike;

function transcriptSourceEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  return events.filter((event) => event.visibility !== "debug");
}

function visibleWorkViewEvents(events: readonly RunEvent[]): readonly RunEvent[] {
  const productEvents = events
    .filter((event) => event.visibility !== "debug")
    .filter(isProductWorkViewEvent);
  const selected = productEvents.length > 0
    ? productEvents.slice(-18)
    : events.filter((event) => event.visibility !== "debug").slice(-18);
  return selected.map(projectVisibleWorkViewEvent);
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
    return fallback.length > 0 ? fallback : "待确认";
  }
  return cleaned.length > 0 ? cleaned : fallback.length > 0 ? fallback : "待确认";
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
  if (stage === "completed") return deliverable?.title ?? answer?.title ?? "任务已完成";
  if (stage === "awaiting_approval") return "需要你确认下一步";
  if (stage === "blocked") return "需要处理后再继续";
  if (stage === "failed") return "运行失败";
  if (stage === "cancelled") return "任务已取消";
  if (stage === "queued") return "已加入队列";
  if (stage === "using_tools") return "正在执行动作";
  if (stage === "gathering_context") return "正在整理上下文";
  if (stage === "composing_result") return "正在整理结果";
  return run.title || "正在理解任务";
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
  readonly canvas?: DesktopWorkViewCanvasLike;
  readonly toolDisplays: readonly ToolDisplayProjection[];
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
  };
  readonly answer?: DesktopWorkViewAnswer;
}): AgentDeliverable | undefined {
  const canvas = input.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent?.answer !== undefined) {
    return undefined;
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession?.report !== undefined) {
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
  if (canvas?.kind === "work_session_canvas" && canvas.workSession?.directAnswer !== undefined) {
    return undefined;
  }
  if (input.restoredResult !== undefined && input.run.status === "completed") {
    return undefined;
  }
  return undefined;
}

function answerFor(input: CreateDesktopWorkViewReadModelInput): DesktopWorkViewAnswer | undefined {
  const canvas = input.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent?.answer !== undefined) {
    return {
      title: "已回答",
      content: redactOrdinaryText(canvas.agent.answer.answer, 8_000),
      evidenceRefs: observationRefs(canvas.agent.answer.evidenceRefs),
      nextActions: [],
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession?.directAnswer !== undefined) {
    return {
      title: "已回答",
      content: redactOrdinaryText(canvas.workSession.directAnswer.answer, 8_000),
      evidenceRefs: observationRefs(canvas.workSession.directAnswer.evidenceRefs),
      nextActions: canvas.workSession.directAnswer.followUpSuggestions
        .map((item) => redactOrdinaryText(item, 220))
        .filter((item) => item.length > 0)
        .slice(0, 5),
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
  if (canvas?.kind !== "desktop_agent_canvas" || canvas.agent?.pendingConfirmation === undefined) {
    return undefined;
  }
  const pending = canvas.agent.pendingConfirmation;
  return {
    confirmationId: pending.confirmationId,
    runId: run.runId,
    conversationId: run.conversationId,
    title: redactOrdinaryText(pending.title, 120),
    actionSummary: redactOrdinaryText(cleanConfirmationSummary(`${pending.question}\n${pending.consequence}`), 600),
    affectedResources: pending.sourceRefs.map((ref) => redactOrdinaryText(ref, 180)),
    riskLevel: pending.riskLevel === "low" || pending.riskLevel === "medium" || pending.riskLevel === "high" ? pending.riskLevel : "medium",
    resumeAvailability: "live",
    requestedAt: run.updatedAt,
    sourceRefs: pending.sourceRefs,
  };
}
