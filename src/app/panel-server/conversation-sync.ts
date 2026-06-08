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
import {
  appendTextStreamAssembly,
  emptyTextStreamAssembly,
  textStreamFragmentSourceFromEventId,
} from "../readable-text-fragments.js";
import { confirmationActionSummaryText } from "../confirmation-copy.js";
import type { ToolDisplayProjection } from "../../domain/tools/index.js";
import { cleanOrdinaryToolText } from "../ordinary-tool-copy.js";

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
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要处理",
      content: sanitizeAssistantVisibleText(response.error?.message ?? "无法继续原操作。请重新发起或继续处理。"),
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
    });
    return;
  }
  if (response.status === "needs_input") {
    conversations.completeAssistantTurn({
      conversationId: job.conversationId,
      assistantTurnId: job.assistantTurnId,
      runId: job.runId,
      title: "需要补充",
      content: sanitizeAssistantVisibleText("需要补充材料或说明。"),
      status: "needs_input",
      responseModel,
    });
    return;
  }
  if (response.status === "pending" || response.status === "running") {
    const pendingTurn = runningAssistantTurnFromResponse(response);
    if (pendingTurn.content.length > 0 || response.status === "pending") {
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

export function syncConversationPreviewsForRunningJobs(input: {
  readonly conversations: PanelConversationStore;
  readonly jobs: readonly PanelRunJob[];
  readonly createResponse: (job: PanelRunJob) => PanelConversationSyncRunResponse;
}): void {
  for (const job of input.jobs) {
    if (job.status !== "running" && job.status !== "approval_needed" && job.status !== "needs_input") {
      continue;
    }
    syncConversationTurnForJob({
      conversations: input.conversations,
      job,
      response: input.createResponse(job),
    });
  }
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
      title: "已完成",
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
  return undefined;
}

function runningAssistantTurnFromResponse(
  response: PanelConversationSyncRunResponse
): { readonly title: string; readonly content: string } {
  const outputText = runningOutputTextFromEvents(response.transcript.events);
  if (outputText.length > 0) {
    return {
      title: "正在回复",
      content: sanitizeAssistantVisibleText(outputText),
    };
  }
  const latest = latestRunningPreviewEvent(response.transcript.events);
  if (latest === undefined) {
    return {
      title: response.status === "pending" ? "等待回复" : "正在处理",
      content: response.status === "pending" ? "等待前一个任务完成。" : "",
    };
  }
  const text = sanitizeAssistantVisibleText(runningPreviewText(latest));
  return {
    title: runningPreviewTitle(latest),
    content: text,
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

function latestRunningPreviewEvent(events: PanelRunTranscript["events"]): PanelRunTranscript["events"][number] | undefined {
  const latestModelOutputBoundary = latestModelOutputBoundarySequence(events);
  const candidates = [...events].reverse().filter((event) => {
    if (event.status === "failed" || event.status === "cancelled" || event.status === "blocked") {
      return false;
    }
    if (event.type === "model.output.delta" && event.sequence <= latestModelOutputBoundary) {
      return false;
    }
    return (
      event.type === "confirmation.needed" ||
      event.type === "tool.requested" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "user_approval.received" ||
      event.type === "run.resumed" ||
      event.type === "user.guidance" ||
      event.type === "model.output.delta" ||
      event.type === "model.reasoning.delta" ||
      event.type === "model.side.completed" ||
      event.type === "agent.note.delta" ||
      event.type === "agent.note.completed" ||
      event.type === "context.compaction.completed" ||
      event.type === "context.compaction.failed"
    );
  });
  return candidates.find((event) =>
    runningPreviewText(event).trim().length > 0
  );
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
    event.type === "user.guidance" ||
    event.type === "context.compaction.completed" ||
    event.type === "context.compaction.failed";
}

function runningPreviewTitle(event: PanelRunTranscript["events"][number]): string {
  if (event.type === "confirmation.needed") return "待处理";
  if (event.type === "tool.requested") return "正在使用工具";
  if (event.type === "tool.completed") return "工具已完成";
  if (event.type === "tool.failed") return "未完成";
  if (event.type === "user_approval.received" || event.type === "run.resumed") return "继续处理";
  if (event.type === "user.guidance") return "补充要求";
  if (event.type === "model.reasoning.delta" || event.type === "model.side.completed") return "正在回复";
  if (event.type === "model.output.delta") return "正在回复";
  if (event.type === "context.compaction.completed" || event.type === "context.compaction.failed") return "正在回复";
  return "正在回复";
}

function runningPreviewText(event: PanelRunTranscript["events"][number]): string {
  if (event.type === "tool.requested" || event.type === "tool.completed" || event.type === "tool.failed") {
    return toolPreviewText(event.detail?.display) ??
      cleanOrdinaryToolText(event.detail?.preview) ??
      cleanOrdinaryToolText(event.summary) ??
      "";
  }
  if (event.type === "context.compaction.completed" || event.type === "context.compaction.failed") {
    return "";
  }
  return event.detail?.preview ?? event.delta ?? event.summary ?? "";
}

function toolPreviewText(display: ToolDisplayProjection | undefined): string | undefined {
  if (display?.kind === "command_summary") {
    const command = [display.command, ...(display.args ?? [])]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    const error = cleanOrdinaryToolText(display.errorSummary);
    const output = cleanOrdinaryToolText(display.outputSummary);
    return [command, output, error].filter(isString).join(" · ") || undefined;
  }
  if (display?.kind === "search_results") {
    return [display.query, `${display.results.length} 条结果`].filter(isString).join(" · ") || undefined;
  }
  if (display?.kind === "browser_snapshot") {
    return display.title ?? display.url;
  }
  if (display?.kind === "file_diff_preview") {
    return [display.path, display.replacements === undefined ? undefined : `${display.replacements} 处修改`].filter(isString).join(" · ") || undefined;
  }
  if (display?.kind === "file_change_summary") {
    return [display.path, display.append === true ? "追加写入" : undefined].filter(isString).join(" · ") || undefined;
  }
  if (display?.kind === "generic_tool_summary") {
    const items = display.items?.slice(0, 6).map(cleanOrdinaryToolText).filter(isString) ?? [];
    return cleanOrdinaryToolText(display.summary) ?? (items.length > 0 ? items.join("\n") : undefined);
  }
  return undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
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
