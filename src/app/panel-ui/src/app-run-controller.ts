import type React from "react";
import { getJson, postJson } from "./api";
import { taskSoilInputFromAttachments } from "./app-attachments";
import { runReasoningSettings, type ComposerReasoningEffort, type VisibleAiMode } from "./app-config-projection";
import {
  createRunReadModelPatch,
  detailForRun,
  loadConversationTranscriptNodesByRunId,
  transcriptNodesFrom,
} from "./app-run-projection";
import { createLiveRunUpdateController } from "./app-live-run-updates";
import { shouldKeepRefreshing, stopLiveUpdates, stopPolling, stopStream } from "./app-runtime-controls";
import type { AppState } from "./app-state";
import {
  emptyLiveRun,
} from "../../panel-ui-live-run-buffer";
import {
  mergeTranscriptNodesByRunId,
} from "../../panel-ui-transcript-cache";
import {
  safeBasicEvents,
  safeBasicRun,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime";
import type { ContextAttachment } from "./contracts/context";
import type { Conversation, ConversationSummary } from "./contracts/conversation";
import type { BasicAgentRun } from "./contracts/run";

export type AppRunController = {
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly loadConversation: (conversationId: string) => Promise<void>;
  readonly startTask: (explicitGoal?: string) => Promise<void>;
  readonly refreshConversations: () => Promise<void>;
  readonly startLiveUpdates: (runId: string, cursor: number) => void;
  readonly cancelRun: () => Promise<void>;
  readonly decideConfirmation: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => Promise<void>;
  readonly resetChat: () => void;
};

export type AppRunControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: (screen: "chat-empty" | "chat-active") => void;
  readonly setGoal: (goal: string) => void;
  readonly attachments: readonly ContextAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly composerReasoningEffort: ComposerReasoningEffort;
  readonly selectedModelSupportsReasoningEffort: boolean;
  readonly confirmationBusy: boolean;
  readonly setConfirmationBusy: React.Dispatch<React.SetStateAction<boolean>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
};

export function createAppRunController(options: AppRunControllerOptions): AppRunController {
  const currentRunId = options.app.run?.runId;
  const liveUpdates = createLiveRunUpdateController({
    setApp: options.setApp,
    mountedRef: options.mountedRef,
    pollTimer: options.pollTimer,
    streamRef: options.streamRef,
    activeRunIdRef: options.activeRunIdRef,
    refreshConversations,
  });

  async function loadConversation(conversationId: string): Promise<void> {
    const epoch = options.viewEpochRef.current + 1;
    options.viewEpochRef.current = epoch;
    stopPolling(options.pollTimer);
    stopStream(options.streamRef);
    options.setScreen("chat-active");
    options.setAttachments([]);
    const response = await getJson<{ readonly conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`);
    const latestRunId = response.conversation.activeRunId ?? response.conversation.latestRunId;
    options.activeRunIdRef.current = latestRunId;
    const detail = latestRunId === undefined ? undefined : await safeDesktopDetail(latestRunId);
    const run = latestRunId === undefined ? undefined : await safeBasicRun(latestRunId);
    const replay = latestRunId === undefined ? undefined : await safeBasicEvents(latestRunId, 0);
    const workSession = latestRunId === undefined ? undefined : await safeWorkSession(latestRunId);
    const transcriptNodes = transcriptNodesFrom(workSession, detail);
    const historicalTranscriptNodesByRunId = await loadConversationTranscriptNodesByRunId(response.conversation, latestRunId);
    if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
    options.setApp((previous) => ({
      ...previous,
      conversation: response.conversation,
      run,
      workSession,
      detail,
      transcriptNodes,
      transcriptNodesByRunId: mergeTranscriptNodesByRunId(historicalTranscriptNodesByRunId, latestRunId, transcriptNodes),
      events: replay?.events ?? [],
      live: undefined,
      error: undefined,
    }));
    if (run !== undefined && shouldKeepRefreshing(run.status)) {
      liveUpdates.startLiveUpdates(run.runId, run.eventCursor.lastSequence);
    }
  }

  async function startTask(explicitGoal?: string): Promise<void> {
    const trimmed = (explicitGoal ?? options.goal).trim();
    if (trimmed.length === 0 || options.app.busy) return;
    const epoch = options.viewEpochRef.current + 1;
    options.viewEpochRef.current = epoch;
    stopPolling(options.pollTimer);
    stopStream(options.streamRef);
    options.activeRunIdRef.current = undefined;
    options.setScreen("chat-active");
    options.setApp((previous) => ({
      ...previous,
      busy: true,
      error: undefined,
      run: undefined,
      events: [],
      transcriptNodes: [],
      live: undefined,
      detail: undefined,
      workSession: undefined,
    }));
    try {
      const path =
        options.app.conversation?.conversationId === undefined
          ? "/api/conversations"
          : `/api/conversations/${encodeURIComponent(options.app.conversation.conversationId)}/messages`;
      const response = await postJson<{
        readonly conversation: Conversation;
        readonly run: { readonly runId: string };
      }>(path, {
        goal: trimmed,
        runMode: "agent",
        aiMode: options.aiMode,
        taskSoilInput: taskSoilInputFromAttachments(options.attachments),
        ...runReasoningSettings(options.composerReasoningEffort, options.selectedModelSupportsReasoningEffort),
      });
      options.setGoal("");
      options.setAttachments([]);
      const run = await safeBasicRun(response.run.runId);
      const workSession = await safeWorkSession(response.run.runId);
      if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
      options.activeRunIdRef.current = response.run.runId;
      options.setApp((previous) => ({
        ...previous,
        busy: false,
        conversation: response.conversation,
        run,
        events: [],
        live: emptyLiveRun(response.run.runId),
        ...createRunReadModelPatch(previous, {
          runId: response.run.runId,
          workSession,
          detail: undefined,
        }),
      }));
      liveUpdates.startLiveUpdates(response.run.runId, 0);
      void refreshConversations();
    } catch (error) {
      if (!options.mountedRef.current || options.viewEpochRef.current !== epoch) return;
      options.setApp((previous) => ({
        ...previous,
        busy: false,
        error: `系统错误：${error instanceof Error ? error.message : "任务启动失败。"}`,
      }));
    }
  }

  async function refreshConversations(): Promise<void> {
    const response = await getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations");
    options.setApp((previous) => ({ ...previous, conversations: response.conversations ?? [] }));
  }

  async function cancelRun(): Promise<void> {
    if (currentRunId === undefined) return;
    const response = await postJson<{ readonly run: BasicAgentRun }>(`/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/cancel`, {});
    const workSession = await safeWorkSession(currentRunId);
    stopLiveUpdates(options.pollTimer, options.streamRef);
    options.activeRunIdRef.current = currentRunId;
    options.setApp((previous) => {
      const readModel = createRunReadModelPatch(previous, {
        runId: currentRunId,
        workSession,
        detail: detailForRun(currentRunId, previous.detail),
      });
      return {
        ...previous,
        run: response.run,
        live: undefined,
        ...readModel,
      };
    });
    void refreshConversations();
  }

  async function decideConfirmation(decision: "approve_once" | "deny" | "guidance", guidance?: string): Promise<void> {
    const confirmation = options.app.workSession?.pendingConfirmation ?? options.app.detail?.canvas?.agent?.pendingConfirmation;
    if (currentRunId === undefined || confirmation === undefined || options.confirmationBusy) return;
    if (decision === "approve_once" && confirmation.resumeAvailability === "lost_after_restart") {
      options.setApp((previous) => ({
        ...previous,
        error: "系统错误：应用重启后无法继续原危险操作。请补充指导或重新发起后续任务。",
      }));
      return;
    }
    if (decision === "guidance" && (guidance ?? "").trim().length === 0) {
      options.setApp((previous) => ({ ...previous, error: "系统错误：请先输入补充指导，再提交。" }));
      return;
    }
    options.setConfirmationBusy(true);
    options.setApp((previous) => ({ ...previous, error: undefined }));

    try {
      const response = await postJson<{ readonly run: BasicAgentRun }>(
        `/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/confirmations/${encodeURIComponent(confirmation.confirmationId)}/decision`,
        { decision, guidance: guidance?.trim() }
      );
      const [workSession, detail] = await Promise.all([
        safeWorkSession(currentRunId),
        safeDesktopDetail(currentRunId),
      ]);
      options.setApp((previous) => {
        const readModel = createRunReadModelPatch(previous, { runId: currentRunId, workSession, detail });
        return {
          ...previous,
          run: response.run,
          live: decision === "approve_once" ? emptyLiveRun(currentRunId) : previous.live,
          error: decision === "approve_once" ? "已提交确认，正在继续处理。" : undefined,
          ...readModel,
        };
      });
      if (decision === "approve_once") {
        liveUpdates.startLiveUpdates(currentRunId, response.run.eventCursor.lastSequence);
      }
    } catch (error) {
      options.setApp((previous) => ({
        ...previous,
        error: `系统错误：${error instanceof Error ? error.message : "提交确认失败，请重试。"}`,
      }));
    } finally {
      options.setConfirmationBusy(false);
    }
  }

  function resetChat(): void {
    options.viewEpochRef.current += 1;
    stopLiveUpdates(options.pollTimer, options.streamRef);
    options.activeRunIdRef.current = undefined;
    options.setScreen("chat-empty");
    options.setGoal("");
    options.setAttachments([]);
    options.setApp((previous) => ({
      ...previous,
      conversation: undefined,
      run: undefined,
      workSession: undefined,
      transcriptNodes: [],
      transcriptNodesByRunId: {},
      events: [],
      live: undefined,
      detail: undefined,
      error: undefined,
    }));
  }

  return {
    activeRunIdRef: options.activeRunIdRef,
    viewEpochRef: options.viewEpochRef,
    loadConversation,
    startTask,
    refreshConversations,
    startLiveUpdates: liveUpdates.startLiveUpdates,
    cancelRun,
    decideConfirmation,
    resetChat,
  };
}
