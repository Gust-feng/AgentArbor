import type React from "react";
import { getJson, postJson } from "./api";
import { decideRunConfirmation } from "./app-confirmation-decisions";
import { type ComposerReasoningEffort, type ComposerToolConfirmationPolicy, type VisibleAiMode } from "./app-config-projection";
import { createRunReadModelPatch } from "./app-run-projection";
import { createLiveRunUpdateController, type LiveRunSubscription } from "./app-live-run-updates";
import { loadObservedRunReadModel } from "./app-observed-run-read-model";
import { stopLiveUpdates } from "./app-runtime-controls";
import { loadConversationSession, resetConversationSession } from "./app-conversation-session";
import { submitPanelTask } from "./app-task-submission";
import { nextRunCapabilityState } from "../../panel-ui-run-capability-state";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";
import type { ConversationSummary } from "./contracts/conversation";
import type { BasicAgentRun } from "./contracts/run";

export type AppRunController = {
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly loadConversation: (conversationId: string) => Promise<void>;
  readonly startTask: (explicitGoal?: string) => Promise<void>;
  readonly refreshConversations: () => Promise<void>;
  readonly startLiveUpdates: (input: LiveRunSubscription) => void;
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
  readonly selectedWorkspaceDirectory?: string;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly composerReasoningEffort: ComposerReasoningEffort;
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly selectedModelId: string;
  readonly selectedModelSupportsReasoningEffort: boolean;
  readonly confirmationBusy: boolean;
  readonly setConfirmationBusy: React.Dispatch<React.SetStateAction<boolean>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly pollTimer: React.MutableRefObject<number | undefined>;
  readonly streamRef: React.MutableRefObject<EventSource | undefined>;
  readonly activeRunIdRef: React.MutableRefObject<string | undefined>;
  readonly viewEpochRef: React.MutableRefObject<number>;
  readonly conversationLoadAbortRef: React.MutableRefObject<AbortController | undefined>;
};

export function createAppRunController(options: AppRunControllerOptions): AppRunController {
  const currentRunId = options.app.run?.runId;
  const liveUpdates = createLiveRunUpdateController({
    setApp: options.setApp,
    mountedRef: options.mountedRef,
    pollTimer: options.pollTimer,
    streamRef: options.streamRef,
    activeRunIdRef: options.activeRunIdRef,
    viewEpochRef: options.viewEpochRef,
    refreshConversations,
  });

  async function loadConversation(conversationId: string): Promise<void> {
    await loadConversationSession({
      ...options,
      refreshConversations,
      startLiveUpdates: liveUpdates.startLiveUpdates,
    }, conversationId);
  }

  async function startTask(explicitGoal?: string): Promise<void> {
    await submitPanelTask({
      ...options,
      refreshConversations,
      startLiveUpdates: liveUpdates.startLiveUpdates,
    }, explicitGoal);
  }

  async function refreshConversations(): Promise<void> {
    const response = await getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations");
    options.setApp((previous) => ({ ...previous, conversations: response.conversations ?? [] }));
  }

  async function cancelRun(): Promise<void> {
    if (currentRunId === undefined) return;
    const response = await postJson<{ readonly run: BasicAgentRun }>(`/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/cancel`, {});
    const observed = await loadObservedRunReadModel({
      runId: currentRunId,
      conversationId: response.run.conversationId,
      preferredConversation: options.app.conversation,
      requireFreshRunView: true,
    });
    const observedRun = observed.run ?? response.run;
    stopLiveUpdates(options.pollTimer, options.streamRef);
    options.activeRunIdRef.current = currentRunId;
    options.setApp((previous) => {
      const readModel = createRunReadModelPatch(previous, {
        runId: currentRunId,
        workView: observed.workView,
        detail: observed.detail,
        reusePreviousWorkView: false,
      });
      const capabilityState = nextRunCapabilityState(previous, {
        runId: currentRunId,
        capabilityResolution: observed.capabilityResolution,
      });
      return {
        ...previous,
        ...capabilityState,
        conversation: observed.conversation ?? previous.conversation,
        run: observedRun,
        busy: false,
        live: undefined,
        ...readModel,
      };
    });
    void refreshConversations();
  }

  async function decideConfirmation(decision: "approve_once" | "deny" | "guidance", guidance?: string): Promise<void> {
    await decideRunConfirmation({
      app: options.app,
      currentRunId,
      decision,
      guidance,
      confirmationBusy: options.confirmationBusy,
      setConfirmationBusy: options.setConfirmationBusy,
      setApp: options.setApp,
      mountedRef: options.mountedRef,
      viewEpochRef: options.viewEpochRef,
      refreshConversations,
      startLiveUpdates: liveUpdates.startLiveUpdates,
    });
  }

  function resetChat(): void {
    resetConversationSession({
      ...options,
      refreshConversations,
      startLiveUpdates: liveUpdates.startLiveUpdates,
    });
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
