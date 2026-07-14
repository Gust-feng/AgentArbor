import type {
  AgentDeliverable,
  BasicAgentRun,
  ConfirmationRequest,
  DesktopWorkViewAnswer,
  DesktopWorkViewReadModel,
  DesktopWorkViewStage,
  RunEvent,
  TranscriptNode,
} from "../../domain/basic-agent/index.js";
import type { ObservationRef, ToolDisplayProjection } from "../../domain/observation/index.js";
import type { SubAgentRunView } from "../../domain/sub-agents/contracts.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";
import { sanitizeAssistantVisibleText } from "../text-projection/visible-text-safety.js";
import {
  cleanConfirmationSummary,
  isGenericApprovalDecisionText,
} from "../text-projection/confirmation-copy.js";
import {
  isLowValueOrdinaryAgentNote,
  isOrdinaryTranscriptSuppressedEvent,
} from "../ordinary-transcript-event-policy.js";
import {
  contextAttachmentsFor,
  isToolDisplay,
  mergeToolDisplays,
  type WorkViewCanvasContextLike,
} from "./work-view-context.js";
import { transcriptNodesFromRunEvents } from "./work-view-transcript.js";

export type DesktopWorkViewCanvasLike = WorkViewCanvasContextLike;

export type CreateDesktopWorkViewReadModelInput = {
  readonly run: BasicAgentRun;
  readonly events: readonly RunEvent[];
  readonly canvas?: DesktopWorkViewCanvasLike;
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly toolDisplays?: readonly ToolDisplayProjection[];
  readonly toolResultCount?: number;
  readonly transcriptNodes?: readonly TranscriptNode[];
  readonly pendingConfirmation?: ConfirmationRequest;
  readonly answer?: DesktopWorkViewAnswer;
  readonly restoredResult?: {
    readonly title: string;
    readonly summary: string;
    readonly content?: string;
  };
  readonly subAgentRuns?: readonly SubAgentRunView[];
};

export function createDesktopWorkViewReadModel(
  input: CreateDesktopWorkViewReadModelInput
): DesktopWorkViewReadModel {
  const visibleEvents = visibleWorkViewEvents(input.events);
  const contextAttachments = contextAttachmentsFor(input);
  const toolDisplays = mergeToolDisplays([], input.toolDisplays ?? []);
  const toolResultCount = input.toolResultCount ?? toolDisplays.length;
  const pendingConfirmation = input.pendingConfirmation;
  const answer = answerFor(input);
  const transcriptNodes = input.transcriptNodes ?? transcriptNodesFromRunEvents(transcriptSourceEvents(input.events), pendingConfirmation);
  const deliverable: AgentDeliverable | undefined = undefined;
  const stage = stageFor(input.run, visibleEvents, pendingConfirmation, deliverable, answer);
  return {
    run: input.run,
    stage,
    headline: headlineFor(input.run, stage, deliverable, answer),
    currentAction: currentActionFor(input.run, stage, visibleEvents, pendingConfirmation),
    contextAttachments,
    pendingConfirmation,
    answer,
    deliverable,
    visibleEvents,
    transcriptNodes,
    subAgentRuns: input.subAgentRuns ?? [],
    workSummary: {
      summary: workSummaryText({
        pendingActionCount: pendingConfirmation === undefined ? 0 : 1,
        toolResultCount,
        contextAttachmentCount: contextAttachments.length,
      }),
      pendingActionCount: pendingConfirmation === undefined ? 0 : 1,
      toolResultCount,
      contextAttachmentCount: contextAttachments.length,
    },
  };
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

function answerFor(input: CreateDesktopWorkViewReadModelInput): DesktopWorkViewAnswer | undefined {
  if (input.answer !== undefined) {
    return {
      ...input.answer,
      content: sanitizeAssistantVisibleText(input.answer.content),
    };
  }
  if (input.run.status === "completed" && input.restoredResult?.content !== undefined) {
    return {
      title: input.restoredResult.title.length > 0 ? input.restoredResult.title : "已回答",
      content: sanitizeAssistantVisibleText(input.restoredResult.content),
      evidenceRefs: [],
      nextActions: [],
    };
  }
  return undefined;
}
