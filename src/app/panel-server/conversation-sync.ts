import type { SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { PanelRunCanvasReadModel } from "../panel-canvas-read-model.js";
import {
  type PanelConversationStore,
  type PanelConversationTurnModel,
  turnModelFromConfig,
} from "../panel-conversations.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStatus, PanelRunTranscript } from "../panel-run-read-model.js";
import {
  friendlyUserFacingFailureText,
  sanitizeAssistantVisibleText,
} from "../visible-text-safety.js";

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
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "这次没有完成",
      content: assistantFailureTextFromResponse(response),
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
      content: "运行已取消。",
      status: "failed",
      responseModel,
    });
    return;
  }
  if (response.status === "blocked") {
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要处理",
      content: sanitizeAssistantVisibleText(response.error?.message ?? "运行已中断，需要重新发起或继续处理。"),
      status: "completed",
      responseModel,
    });
    return;
  }
  if (response.status === "approval_needed") {
    const pendingTurn = assistantTurnFromResponse(response);
    conversations.updateAssistantPreview({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      title: "需要确认",
      content: sanitizeAssistantVisibleText(pendingTurn.content),
      status: "running",
    });
    return;
  }
  if (response.status === "needs_input") {
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要补充",
      content: sanitizeAssistantVisibleText("已收到补充指导，将作为后续消息继续处理。"),
      status: "completed",
      responseModel,
    });
    return;
  }
  const turn = assistantTurnFromResponse(response);
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
  const latestCallModel = latestPanelTranscriptModelCall(response.transcript.modelCalls)?.model;
  return {
    ...turnModelFromConfig(response.config),
    model: latestCallModel ?? response.config.model,
  };
}

function latestPanelTranscriptModelCall(
  calls: PanelRunTranscript["modelCalls"]
): PanelRunTranscript["modelCalls"][number] | undefined {
  return [...calls].reverse().find((call) => call.model !== undefined);
}

function assistantTurnFromResponse(
  response: PanelConversationSyncRunResponse
): { readonly title: string; readonly content: string } {
  const canvas = response.canvas;
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.answer !== undefined) {
    return {
      title: canvas.agent.pendingConfirmation === undefined ? "已完成" : "需要确认",
      content: sanitizeAssistantVisibleText(canvas.agent.answer.answer),
    };
  }
  if (canvas?.kind === "desktop_agent_canvas" && canvas.agent.pendingConfirmation !== undefined) {
    return {
      title: "需要确认",
      content: sanitizeAssistantVisibleText(
        joinDisplayText(canvas.agent.pendingConfirmation.question, canvas.agent.pendingConfirmation.consequence)
      ),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.directAnswer !== undefined) {
    return {
      title: "已回答",
      content: sanitizeAssistantVisibleText(canvas.workSession.directAnswer.answer),
    };
  }
  if (canvas?.kind === "work_session_canvas" && canvas.workSession.report !== undefined) {
    const report = canvas.workSession.report;
    const summary = report.decisionSummary.trim().length > 0 ? report.decisionSummary : `已生成：${report.title}`;
    const nextAction = report.nextActions[0];
    return {
      title: "结果已生成",
      content: sanitizeAssistantVisibleText(nextAction === undefined ? summary : `${summary}\n下一步：${nextAction}`),
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
  return {
    title: "结果已生成",
    content: "结果已经整理完成。",
  };
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

function conciseRunFailureText(error: { readonly code: string; readonly message: string } | undefined): string {
  if (error === undefined) {
    return "这次没有完成。";
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

function joinDisplayText(...parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0).join("\n");
}

function truncateFailureText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}
