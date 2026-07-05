import type React from "react";
import { normalizeAgentMode, type AgentMode } from "./app-config-projection";
import {
  deepConversationSummaryFromView,
  deepRunSummaryFromView,
  getDeepConversation,
  latestRestorableDeepConversation,
  latestRestorableDeepRun,
  openDeepRun,
  shouldKeepDeepRunBusy,
  shouldPollDeepRun,
  upsertDeepConversationSummary,
  upsertDeepRunSummary,
} from "./app-deep-history";
import type { DeepRunUpdateController } from "./app-deep-live-updates";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";

export type AppDeepEntryController = {
  readonly openNormalAgentEntry: () => void;
  readonly openNormalTaskEntry: () => void;
  readonly openNormalConversation: (conversationId: string) => void;
  readonly openAgentClusterRun: (
    runId: string,
    options?: { readonly auto?: boolean },
  ) => Promise<void>;
  readonly openAgentClusterConversation: (conversationId: string) => Promise<void>;
  readonly openAgentClusterEntry: () => void;
};

export type AppDeepEntryControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: React.Dispatch<React.SetStateAction<"chat-empty" | "chat-active">>;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly setSelectedWorkspaceDirectory: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly setInputCloseSignal: React.Dispatch<React.SetStateAction<number>>;
  readonly loadConversation: (conversationId: string) => Promise<void>;
  readonly resetChat: () => void;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly deepOpenEpochRef: React.MutableRefObject<number>;
  readonly deepRunUpdateController: DeepRunUpdateController;
};

export function createAppDeepEntryController(
  options: AppDeepEntryControllerOptions,
): AppDeepEntryController {
  function changeAgentMode(nextMode: AgentMode): void {
    const normalized = normalizeAgentMode(nextMode);
    options.setApp((previous) => {
      if (previous.agentMode === normalized) return previous;
      return { ...previous, agentMode: normalized, error: undefined };
    });
  }

  function openNormalAgentEntry(): void {
    options.deepRunUpdateController.stopPolling();
    options.setInputCloseSignal((value) => value + 1);
    options.setGoal("");
    options.setAttachments([]);
    options.setScreen(options.app.conversation !== undefined || options.app.run !== undefined ? "chat-active" : "chat-empty");
    changeAgentMode("normal");
  }

  function openNormalTaskEntry(): void {
    options.deepOpenEpochRef.current += 1;
    options.deepRunUpdateController.stopPolling();
    changeAgentMode("normal");
    options.setSelectedWorkspaceDirectory(undefined);
    options.resetChat();
  }

  function openNormalConversation(conversationId: string): void {
    changeAgentMode("normal");
    const summary = options.app.conversations.find((item) => item.conversationId === conversationId);
    options.setSelectedWorkspaceDirectory(summary?.workspaceFolder?.path);
    void options.loadConversation(conversationId);
  }

  async function openAgentClusterRun(
    runId: string,
    openOptions?: { readonly auto?: boolean },
  ): Promise<void> {
    const epoch = options.deepOpenEpochRef.current + 1;
    options.deepOpenEpochRef.current = epoch;
    options.setScreen("chat-active");
    options.setGoal("");
    options.setAttachments([]);
    options.setApp((previous) => ({
      ...previous,
      agentMode: "deep",
      deepSelectedRunId: runId,
      deepActiveRunId: runId,
      deepBusy: previous.deep?.run.runId === runId ? previous.deepBusy : true,
      deepPendingGoal: previous.deep?.run.runId === runId ? previous.deepPendingGoal : undefined,
      deepConversation: undefined,
      deepIntakeStatus: undefined,
      error: undefined,
    }));
    try {
      const view = await openDeepRun(runId);
      if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;
      const keepBusy = shouldKeepDeepRunBusy(view.run);
      const keepPolling = shouldPollDeepRun(view.run);
      const summary = deepRunSummaryFromView(view);
      const conversationSummary = view.conversation === undefined
        ? undefined
        : deepConversationSummaryFromView(view.conversation, summary);
      const intakeStatus = conversationSummary?.intakeStatus;
      options.setSelectedWorkspaceDirectory(view.run.workspaceFolder?.path);
      options.setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deep: view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepConversations: conversationSummary === undefined
          ? previous.deepConversations
          : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepActiveRunId: view.run.runId,
        deepSelectedRunId: view.run.runId,
        deepPendingGoal: undefined,
        deepConversation: view.conversation ?? previous.deepConversation,
        deepIntakeStatus: intakeStatus,
        deepBusy: keepBusy,
        error: undefined,
      }));
      if (keepPolling) {
        options.deepRunUpdateController.startPolling(view.run.runId);
      } else {
        options.deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;
      options.setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deepBusy: false,
        deepPendingGoal: undefined,
        error:
          error instanceof Error
            ? error.message
            : openOptions?.auto === true
              ? "恢复 Agent 集群运行失败。"
              : "打开 Agent 集群运行失败。",
      }));
    }
  }

  async function openAgentClusterConversation(conversationId: string): Promise<void> {
    const epoch = options.deepOpenEpochRef.current + 1;
    options.deepOpenEpochRef.current = epoch;
    const latestRunId = options.app.deepConversations.find(
      (conversation) => conversation.conversationId === conversationId,
    )?.latestRun?.runId;
    if (latestRunId !== undefined) {
      await openAgentClusterRun(latestRunId);
      return;
    }
    options.deepRunUpdateController.stopPolling();
    options.setScreen("chat-active");
    options.setGoal("");
    options.setAttachments([]);
    options.setApp((previous) => ({
      ...previous,
      agentMode: "deep",
      deep: undefined,
      deepConversation: undefined,
      deepIntakeStatus: undefined,
      deepBusy: true,
      deepPendingGoal: undefined,
      deepActiveRunId: undefined,
      deepSelectedRunId: undefined,
      error: undefined,
    }));
    try {
      const response = await getDeepConversation(conversationId);
      if (!options.mountedRef.current || options.deepOpenEpochRef.current !== epoch) return;
      const latestRun = response.runs[0];
      const summary = deepConversationSummaryFromView(response.conversation, latestRun);
      if (latestRun !== undefined) {
        options.setApp((previous) => ({
          ...previous,
          deepConversations: upsertDeepConversationSummary(previous.deepConversations, summary),
          deepRuns: upsertDeepRunSummary(previous.deepRuns, latestRun),
        }));
        await openAgentClusterRun(latestRun.runId);
        return;
      }
      options.setSelectedWorkspaceDirectory(response.conversation.birthWorkspaceDirectory);
      options.setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deep: undefined,
        deepConversation: response.conversation,
        deepConversations: upsertDeepConversationSummary(previous.deepConversations, summary),
        deepRuns: previous.deepRuns,
        deepIntakeStatus: summary.intakeStatus,
        deepBusy: false,
        deepPendingGoal: undefined,
        deepActiveRunId: undefined,
        deepSelectedRunId: undefined,
        error: undefined,
      }));
    } catch (error) {
      if (!options.mountedRef.current) return;
      options.setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deepBusy: false,
        error: error instanceof Error ? error.message : "打开 Agent 集群会话失败。",
      }));
    }
  }

  function openAgentClusterEntry(): void {
    options.setInputCloseSignal((value) => value + 1);
    options.setScreen("chat-empty");
    options.setGoal("");
    options.setAttachments([]);
    const existingRunId = options.app.deep?.run.runId ?? options.app.deepActiveRunId;
    if (existingRunId !== undefined) {
      void openAgentClusterRun(existingRunId);
      return;
    }
    const restorableConversationId = options.app.deepConversation?.conversationId ??
      latestRestorableDeepConversation(options.app.deepConversations)?.conversationId;
    if (restorableConversationId !== undefined) {
      void openAgentClusterConversation(restorableConversationId);
      return;
    }
    const restorableRunId = latestRestorableDeepRun(options.app.deepRuns)?.runId;
    if (restorableRunId !== undefined) {
      void openAgentClusterRun(restorableRunId);
      return;
    }
    options.setApp((previous) => ({
      ...previous,
      agentMode: "deep",
      deep: undefined,
      deepPendingGoal: undefined,
      deepActiveRunId: undefined,
      deepSelectedRunId: undefined,
      deepConversation: undefined,
      deepIntakeStatus: undefined,
      deepBusy: false,
      error: undefined,
    }));
  }

  return {
    openNormalAgentEntry,
    openNormalTaskEntry,
    openNormalConversation,
    openAgentClusterRun,
    openAgentClusterConversation,
    openAgentClusterEntry,
  };
}
