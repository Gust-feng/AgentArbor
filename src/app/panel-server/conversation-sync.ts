import type { SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { PanelRunCanvasReadModel } from "../panel-read-model/canvas/panel-canvas-read-model.js";
import {
  type PanelConversationStore,
  type PanelConversationTurnModel,
} from "../panel-conversation/panel-conversations.js";
import { turnModelFromConfigAndModelCall } from "../panel-conversation/panel-conversation-response-model.js";
import type { PanelRunJob } from "./run-jobs.js";
import type { PanelRunStatus, PanelRunTranscript } from "../panel-run-read-model.js";
import {
  friendlyUserFacingFailureText,
  sanitizeAssistantVisibleText,
} from "../text-projection/visible-text-safety.js";
import { ORDINARY_RUN_BLOCKED_FALLBACK } from "../run-read-model/restored-run-projection.js";
import {
  appendTextStreamAssembly,
  emptyTextStreamAssembly,
  textStreamFragmentSourceFromEventId,
} from "../readable-text-fragments.js";
import { confirmationActionSummaryText } from "../text-projection/confirmation-copy.js";

export type PanelConversationSyncRunResponse = {
  readonly status: PanelRunStatus;
  readonly config: SanitizedModelProviderConfig;
  readonly transcript: Pick<PanelRunTranscript, "events" | "modelCalls">;
  readonly canvas?: PanelRunCanvasReadModel;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
};

export function syncConversationTurnForJob(input: {
  readonly conversations: PanelConversationStore;
  readonly job: PanelRunJob;
  readonly response: PanelConversationSyncRunResponse;
}): void {
  const { conversations, job, response } = input;
  if (job.conversationId === undefined || job.assistantTurnId === undefined) {
    return;
  }
  const responseModel = turnModelFromRunResponse(response);
  if (response.status === "failed") {
    const previousContent = assistantContentBeforeFailure(
      assistantTurnContent(conversations, job.conversationId, job.assistantTurnId),
      response
    );
    const failureText = assistantFailureTextFromResponse(response);
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "未完成",
      content: appendAssistantFailureContent(previousContent, failureText),
      status: "failed",
      responseModel,
    });
    return;
  }
  if (response.status === "cancelled") {
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "已取消",
      content: "已取消。",
      status: "failed",
      responseModel,
    });
    return;
  }
  if (response.status === "blocked") {
    const previousContent = assistantContentBeforeFailure(
      assistantTurnContent(conversations, job.conversationId, job.assistantTurnId),
      response
    );
    const blockedText = sanitizeAssistantVisibleText(response.error?.message ?? ORDINARY_RUN_BLOCKED_FALLBACK);
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要处理",
      content: appendAssistantBlockedContent(previousContent, blockedText),
      status: "blocked",
      responseModel,
    });
    return;
  }
  if (response.status === "approval_needed") {
    const pendingTurn = assistantTurnFromResponse(response);
    if (pendingTurn === undefined) {
      return;
    }
    conversations.updateAssistantPreview({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      title: "待处理",
      content: sanitizeAssistantVisibleText(pendingTurn.content),
      status: "running",
      pendingActionKind: "approval",
    });
    return;
  }
  if (response.status === "needs_input") {
    const previousContent = assistantContentBeforeFailure(
      assistantTurnContent(conversations, job.conversationId, job.assistantTurnId),
      response
    );
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要补充",
      content: previousContent,
      status: "needs_input",
      responseModel,
    });
    return;
  }
  if (response.status === "pending" || response.status === "running") {
    const pendingTurn = runningAssistantTurnFromResponse(response);
    if (pendingTurn.shouldUpdate) {
      conversations.updateAssistantPreview({
        conversationId: job.conversationId,
        assistantTurnId: job.assistantTurnId,
        title: pendingTurn.title,
        content: pendingTurn.content,
        status: response.status === "pending" ? "pending" : "running",
      });
    }
    return;
  }
  const turn = assistantTurnFromResponse(response);
  if (turn === undefined) {
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "",
      content: "",
      status: "failed",
      responseModel,
    });
    return;
  }
  conversations.completeAssistantTurn({
    conversationId: job.conversationId,
    assistantTurnId: job.assistantTurnId,
    runId: job.runId,
    title: turn.title,
    content: turn.content,
    status: "completed",
    responseModel,
  });
}

function turnModelFromRunResponse(response: PanelConversationSyncRunResponse): PanelConversationTurnModel {
  return turnModelFromConfigAndModelCall(
    response.config,
    latestPanelTranscriptModelCall(response.transcript.modelCalls)
  );
}

function latestPanelTranscriptModelCall(
  calls: PanelRunTranscript["modelCalls"]
): PanelRunTranscript["modelCalls"][number] | undefined {
  return [...calls].reverse().find((call) => call.model !== undefined);
}

function assistantTurnFromResponse(
  response: PanelConversationSyncRunResponse
): { readonly title: string; readonly content: string } | undefined {
  const canvas = response.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    return {
      title: canvas.agent.pendingConfirmation === undefined ? "已完成" : "待处理",
      content: sanitizeAssistantVisibleText(canvas.agent.answer.answer),
    };
  }
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.pendingConfirmation !== undefined) {
    return {
      title: "待处理",
      content: sanitizeAssistantVisibleText(
        confirmationActionSummaryText({
          question: canvas.agent.pendingConfirmation.question,
          consequence: canvas.agent.pendingConfirmation.consequence,
        })
      ),
    };
  }
  if (canvas?.kind === "underground_deep_canvas") {
    const summary = canvas.underground.recommendedDirection.reason.trim().length > 0
      ? canvas.underground.recommendedDirection.reason
      : canvas.underground.convergenceSummary;
    const uncertainty = canvas.underground.uncertainty[0];
    return {
      title: canvas.underground.status === "approved_package_created" ? "方向已形成" : "深度模式已停止",
      content: sanitizeAssistantVisibleText(uncertainty === undefined ? summary : `${summary}\n不确定性：${uncertainty}`),
    };
  }
  return undefined;
}

function runningAssistantTurnFromResponse(
  response: PanelConversationSyncRunResponse
): { readonly title: string; readonly content: string; readonly shouldUpdate: boolean } {
  const outputText = runningOutputTextFromEvents(response.transcript.events);
  if (outputText.length > 0) {
    return {
      title: "",
      content: sanitizeAssistantVisibleText(outputText),
      shouldUpdate: true,
    };
  }
  return {
    title: "",
    content: "",
    shouldUpdate: response.status === "pending" || latestModelOutputBoundarySequence(response.transcript.events) > 0,
  };
}

function runningOutputTextFromEvents(events: PanelRunTranscript["events"]): string {
  const latestModelOutputBoundary = latestModelOutputBoundarySequence(events);
  const outputEvents = events
    .filter((event) => event.type === "model.output.delta" && event.sequence > latestModelOutputBoundary)
    .sort((left, right) => left.sequence - right.sequence);
  const latestModelCallRef = [...outputEvents].reverse().flatMap((event) => event.modelCallRefs)[0];
  const visibleEvents = latestModelCallRef === undefined
    ? outputEvents
    : outputEvents.filter((event) => event.modelCallRefs.includes(latestModelCallRef));
  return visibleEvents.reduce(
    (current, event) => {
      const source = textStreamFragmentSourceFromEventId(event.eventId);
      return appendTextStreamAssembly(
        current,
        event.delta ?? event.detail?.preview ?? event.summary ?? "",
        source,
        source === "replay" && current.liveSourceObserved ? { boundary: "readable" } : undefined
      );
    },
    emptyTextStreamAssembly()
  ).text;
}

function latestModelOutputBoundarySequence(events: PanelRunTranscript["events"]): number {
  return events.reduce(
    (latest, event) => isModelOutputBoundaryEvent(event) ? Math.max(latest, event.sequence) : latest,
    0
  );
}

function isModelOutputBoundaryEvent(event: PanelRunTranscript["events"][number]): boolean {
  return event.type === "tool.requested" ||
    event.type === "confirmation.needed" ||
    event.type === "user_approval.received" ||
    event.type === "run.resumed" ||
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.cancelled" ||
    event.type === "user.guidance" ||
    event.type === "context.compaction.requested" ||
    event.type === "context.compaction.completed" ||
    event.type === "context.compaction.failed";
}

function assistantFailureTextFromResponse(response: PanelConversationSyncRunResponse): string {
  const eventError = response.transcript.events
    .map((event) => event.detail?.error)
    .filter((error): error is string => typeof error === "string" && error.trim().length > 0)
    .find((error) => /\bHTTP\s+\d{3}\b/i.test(error)) ??
    [...response.transcript.events]
      .reverse()
      .map((event) => event.detail?.error)
      .find((error): error is string => typeof error === "string" && error.trim().length > 0);
  if (eventError !== undefined) {
    return truncateFailureText(friendlyUserFacingFailureText(eventError), 1_000);
  }
  return conciseRunFailureText(response.error);
}

function assistantTurnContent(
  conversations: PanelConversationStore,
  conversationId: string,
  assistantTurnId: string
): string {
  return conversations
    .get(conversationId)
    ?.turns.find((turn) => turn.turnId === assistantTurnId && turn.role === "assistant")
    ?.content
    .trim() ?? "";
}

function assistantContentBeforeFailure(
  previousContent: string,
  response: PanelConversationSyncRunResponse
): string {
  const outputText = sanitizeAssistantVisibleText(runningOutputTextFromEvents(response.transcript.events)).trim();
  const previous = previousContent.trim();
  if (outputText.length === 0) {
    return previous;
  }
  if (previous.length === 0 || outputText.startsWith(previous)) {
    return outputText;
  }
  if (previous.startsWith(outputText)) {
    return previous;
  }
  return `${previous}\n\n${outputText}`;
}

function appendAssistantFailureContent(previousContent: string, failureText: string): string {
  const errorLine = `错误信息：${failureText.trim()}`;
  if (previousContent.trim().length === 0) {
    return errorLine;
  }
  if (previousContent.includes("错误信息：") && previousContent.includes(failureText.trim())) {
    return previousContent;
  }
  return `${previousContent.trim()}\n\n${errorLine}`;
}

function appendAssistantBlockedContent(previousContent: string, blockedText: string): string {
  const blockedLine = `停止原因：${blockedText.trim()}`;
  if (previousContent.trim().length === 0) {
    return blockedText;
  }
  if (previousContent.includes("停止原因：") && previousContent.includes(blockedText.trim())) {
    return previousContent;
  }
  return `${previousContent.trim()}\n\n${blockedLine}`;
}

function conciseRunFailureText(error: { readonly code: string; readonly message: string } | undefined): string {
  if (error === undefined) {
    return "未完成，但没有返回错误详情。";
  }
  switch (error.code) {
    case "missing_api_key":
      return "模型密钥未配置。";
    case "missing_model_name":
      return "模型未配置。";
    case "ai_disabled":
      return "AI 已禁用。";
    default:
      return truncateFailureText(friendlyUserFacingFailureText(error.message), 1_000);
  }
}

function truncateFailureText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}
