import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationSummaryRefresh } from "./app-conversation-refresh";
import { createAppRunController } from "./app-run-controller";
import {
  currentRunProjectionDeps,
  projectCurrentRun,
  type CurrentRunProjection,
} from "./app-run-projection";

import { createAppSidebarConversationController } from "./app-sidebar-conversation-controller";
import { createAppSettingsController, type AppSettingsController } from "./app-settings-controller";
import { createAppComposerController } from "./app-composer-controller";
import { applyAppBootstrap, loadAppBootstrap } from "./app-bootstrap";
import { shouldKeepRefreshing, stopLiveUpdates } from "./app-runtime-controls";
import { resetTranscriptCache } from "./panel-ui-transcript-store";
import {
  contextWindowUsageFrom,
  contextWindowTokensForActiveRun,
  latestModelUsageFromEvents,
  latestModelUsageForRunFromTranscript,
  type ContextWindowUsage,
} from "./context-window-usage";
import { isConversationWaitingForUser } from "./conversation-state";
import type { AppState } from "./app-state";
import type {
  ComposerReasoningEffort,
  ComposerToolConfirmationPolicy,
  VisibleAiMode,
} from "./app-config-projection";
import type { LegacyConversationScreen } from "./app-screen";
import type { McpServerForm, ModelForm, ToolForm } from "./components/settings-types";
import type { ModelProviderModelCatalog } from "./contracts/config";
import type { ContextAttachment } from "./contracts/context";
import type { DesktopWorkView } from "./contracts/run";
import type { McpServerCatalogItem } from "./contracts/tools";

export type AppWorkbenchRuntimeOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setLegacyConversationScreen: React.Dispatch<React.SetStateAction<LegacyConversationScreen>>;
  readonly setGoal: React.Dispatch<React.SetStateAction<string>>;
  readonly goal: string;
  readonly aiMode: VisibleAiMode;
  readonly composerReasoningEffort: ComposerReasoningEffort;
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly setToolConfirmationPolicy: React.Dispatch<React.SetStateAction<ComposerToolConfirmationPolicy>>;
  readonly setComposerSelectedModelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly modelForm: ModelForm;
  readonly setModelForm: React.Dispatch<React.SetStateAction<ModelForm>>;
  readonly setModelCatalogs: React.Dispatch<React.SetStateAction<Record<string, ModelProviderModelCatalog>>>;
  readonly workspaceDirectory: string;
  readonly setDesktopAgentSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  readonly toolForm: ToolForm;
  readonly setToolForm: React.Dispatch<React.SetStateAction<ToolForm>>;
  readonly mcpServerForm: McpServerForm;
  readonly setMcpServerForm: React.Dispatch<React.SetStateAction<McpServerForm>>;
  readonly attachments: readonly ContextAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly selectedWorkspaceDirectory?: string;
  readonly setSelectedWorkspaceDirectory: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly selectedModelId: string;
  readonly selectedModelSupportsReasoningEffort: boolean;
  readonly selectedModelContextWindowTokens?: number;
  readonly agentClusterActive: boolean;
  readonly setInputCloseSignal: React.Dispatch<React.SetStateAction<number>>;
};

export type AppWorkbenchRuntime = {
  readonly bootstrap: AppBootstrapLoadState;
  readonly retryBootstrap: () => void;
  readonly currentRun: CurrentRunProjection;
  readonly contextUsage?: ContextWindowUsage;
  readonly modelResponding: boolean;
  readonly pendingConfirmation?: DesktopWorkView["pendingConfirmation"];
  readonly pendingCount: number;
  readonly confirmationBusy: boolean;
  readonly contextBusy: boolean;
  readonly pendingConversationIds: ReadonlySet<string>;

  readonly savingModel: boolean;
  readonly savingWorkspace: boolean;
  readonly savingDesktopAgent: boolean;
  readonly savingTools: boolean;
  readonly runActions: Pick<
    ReturnType<typeof createAppRunController>,
    "loadConversation" | "startTask" | "startNewConversation" | "cancelRun" | "decideConfirmation" | "resetChat"
  >;
  readonly deepEntryActions: {
    openNormalAgentEntry: () => void;
    openNormalTaskEntry: () => void;
    openNormalConversation: (conversationId: string) => Promise<boolean>;
    openAgentClusterRun: (runId: string) => void;
    openAgentClusterConversation: (conversationId: string) => void;
    openAgentClusterEntry: () => void;
  };
  readonly deepTaskActions: {
    submitDeepInput: () => void;
    startConfirmedDeepRun: () => void;
    stopDeepTask: () => void;
    sendDeepChildMessage: (message: string) => void;
    decideDeepChild: (decision: string) => void;
    resynthesizeDeepRun: () => void;
  };
  readonly sidebarActions: Pick<
    ReturnType<typeof createAppSidebarConversationController>,
    "renameConversation" | "toggleConversationPinned" | "deleteConversation"
  >;
  readonly settingsController: AppSettingsController;
  readonly composerActions: Pick<
    ReturnType<typeof createAppComposerController>,
    "selectInputModel" | "selectAttachment" | "selectTaskWorkspace" | "uploadAttachments" | "removeAttachment" | "changeToolConfirmationPolicy"
  >;
};

export type AppBootstrapLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "retrying" }
  | { readonly status: "error"; readonly message: string };

export function useAppWorkbenchRuntime(options: AppWorkbenchRuntimeOptions): AppWorkbenchRuntime {
  const [bootstrap, setBootstrap] = useState<AppBootstrapLoadState>({ status: "loading" });
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingDesktopAgent, setSavingDesktopAgent] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | undefined>(undefined);
  const [pendingConversationIds, setPendingConversationIds] = useState<ReadonlySet<string>>(() => new Set());

  const mountedRef = useRef(true);
  const appRef = useRef(options.app);
  appRef.current = options.app;
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const fallbackPollRef = useRef<AbortController | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const viewEpochRef = useRef(0);
  const submissionAttemptRef = useRef<{ readonly key: string; readonly id: string } | undefined>(undefined);
  const attachmentUploadAttemptRef = useRef<{ readonly key: string; readonly id: string } | undefined>(undefined);

  const conversationLoadAbortRef = useRef<AbortController | undefined>(undefined);
  const bootstrapAbortRef = useRef<AbortController | undefined>(undefined);
  const bootstrapEpochRef = useRef(0);
  const mutationConversationIdsRef = useRef<Set<string>>(new Set());
  const modelSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const toolSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mcpToolSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mcpToolUpdateVersionRef = useRef(0);
  const mcpToolCatalogDraftRef = useRef<readonly McpServerCatalogItem[] | undefined>(undefined);

  useConversationSummaryRefresh({
    conversations: options.app.conversations,
    setApp: options.setApp,
    mountedRef,
  });

  useEffect(() => {
    mcpToolCatalogDraftRef.current = options.app.tools?.mcpCatalog;
  }, [options.app.tools?.mcpCatalog]);

  const loadBootstrap = useCallback((retry: boolean): void => {
    const epoch = ++bootstrapEpochRef.current;
    bootstrapAbortRef.current?.abort();
    const abortController = new AbortController();
    bootstrapAbortRef.current = abortController;
    setBootstrap({ status: retry ? "retrying" : "loading" });
    void loadAppBootstrap(abortController.signal).then((loaded) => {
      if (!mountedRef.current || bootstrapEpochRef.current !== epoch) return;
      options.setApp((previous) => applyAppBootstrap(previous, loaded));
      setBootstrap({ status: "ready" });
    }).catch((error: unknown) => {
      if (!mountedRef.current || bootstrapEpochRef.current !== epoch || abortController.signal.aborted) return;
      setBootstrap({
        status: "error",
        message: error instanceof Error ? error.message : "工作台启动数据加载失败。",
      });
    }).finally(() => {
      if (bootstrapAbortRef.current === abortController) bootstrapAbortRef.current = undefined;
    });
  }, [options.setApp]);

  const retryBootstrap = useCallback((): void => loadBootstrap(true), [loadBootstrap]);

  useEffect(() => {
    mountedRef.current = true;
    loadBootstrap(false);
    return () => {
      mountedRef.current = false;
      bootstrapAbortRef.current?.abort();
      bootstrapAbortRef.current = undefined;
      conversationLoadAbortRef.current?.abort();
      conversationLoadAbortRef.current = undefined;
      stopLiveUpdates(pollTimer, streamRef, fallbackPollRef);
      resetTranscriptCache();

    };
  }, [loadBootstrap]);

  const currentRun = useMemo(() => projectCurrentRun(options.app), currentRunProjectionDeps(options.app));
  const hasNormalConversationContext =
    !options.agentClusterActive && (options.app.conversation !== undefined || currentRun.run !== undefined);
  const latestModelUsage = useMemo(
    () => latestModelUsageFromEvents(currentRun.events) ?? (currentRun.run === undefined
      ? undefined
      : latestModelUsageForRunFromTranscript(currentRun.run.runId, currentRun.transcriptNodes)),
    [currentRun.events, currentRun.run, currentRun.transcriptNodes],
  );
  const contextUsage = useMemo(() => {
    if (!hasNormalConversationContext) {
      return undefined;
    }
    const runContextWindowTokens =
      currentRun.capabilityResolution?.capabilityPlan?.modelCapabilities.contextWindowTokens;
    return contextWindowUsageFrom({
      contextWindowTokens: contextWindowTokensForActiveRun({
        runContextWindowTokens,
        selectedModelContextWindowTokens: options.selectedModelContextWindowTokens,
      }),
      modelUsage: latestModelUsage,
    });
  }, [
    currentRun.capabilityResolution?.capabilityPlan?.modelCapabilities.contextWindowTokens,
    currentRun.run,
    hasNormalConversationContext,
    latestModelUsage,
    options.selectedModelContextWindowTokens,
  ]);
  const modelResponding = currentRun.run !== undefined &&
    currentRun.run.runId !== cancellingRunId &&
    shouldKeepRefreshing(currentRun.run.status);
  const pendingConfirmation = currentRun.workView?.pendingConfirmation;
  const pendingConversationCount = options.app.conversations.filter(isConversationWaitingForUser).length;
  const pendingCount = Math.max(pendingConversationCount, pendingConfirmation === undefined ? 0 : 1);

  const runController = useMemo(() => createAppRunController({
    app: options.app,
    setApp: options.setApp,
    setLegacyConversationScreen: options.setLegacyConversationScreen,
    setGoal: options.setGoal,
    attachments: options.attachments,
    setAttachments: options.setAttachments,
    selectedWorkspaceDirectory: options.selectedWorkspaceDirectory,
    goal: options.goal,
    aiMode: options.aiMode,
    composerReasoningEffort: options.composerReasoningEffort,
    toolConfirmationPolicy: options.toolConfirmationPolicy,
    selectedModelId: options.selectedModelId,
    selectedModelSupportsReasoningEffort: options.selectedModelSupportsReasoningEffort,
    confirmationBusy,
    setConfirmationBusy,
    mountedRef,
    pollTimer,
    streamRef,
    fallbackPollRef,
    activeRunIdRef,
    viewEpochRef,
    submissionAttemptRef,
    conversationLoadAbortRef,
    setCancellingRunId,
  }), [
    confirmationBusy,
    options.aiMode,
    options.app,
    options.attachments,
    options.composerReasoningEffort,
    options.goal,
    options.selectedModelId,
    options.selectedModelSupportsReasoningEffort,
    options.selectedWorkspaceDirectory,
    options.setApp,
    options.setAttachments,
    options.setGoal,
    options.setLegacyConversationScreen,
    options.toolConfirmationPolicy,
  ]);

  // Deep/Multi-Agent 已从运行时剥离（后端返回 410），保留空操作桩维持接口稳定。
  const noop = () => undefined;
  const deepEntryActions = {
    openNormalAgentEntry: () => { runController.resetChat(); options.setLegacyConversationScreen("chat-empty"); },
    openNormalTaskEntry: noop,
    openNormalConversation: runController.loadConversation,
    openAgentClusterRun: noop,
    openAgentClusterConversation: noop,
    openAgentClusterEntry: noop,
  };
  const deepTaskActions = {
    submitDeepInput: noop,
    startConfirmedDeepRun: noop,
    stopDeepTask: noop,
    sendDeepChildMessage: noop,
    decideDeepChild: noop,
    resynthesizeDeepRun: noop,
  };

  const sidebarConversationController = useMemo(() => createAppSidebarConversationController({
    app: options.app,
    appRef,
    setApp: options.setApp,
    mountedRef,
    mutationConversationIdsRef,
    setMutationConversationIds: setPendingConversationIds,
    resetChat: runController.resetChat,
    setSelectedWorkspaceDirectory: options.setSelectedWorkspaceDirectory,
    setInputCloseSignal: options.setInputCloseSignal,
    setGoal: options.setGoal,
    setAttachments: options.setAttachments,
    setLegacyConversationScreen: options.setLegacyConversationScreen,
  }), [
    options.app,
    options.setApp,
    options.setAttachments,
    options.setGoal,
    options.setInputCloseSignal,
    options.setLegacyConversationScreen,
    options.setSelectedWorkspaceDirectory,
    runController.resetChat,
  ]);

  const settingsController = useMemo(() => createAppSettingsController({
    app: options.app,
    setApp: options.setApp,
    aiMode: options.aiMode,
    modelForm: options.modelForm,
    setModelForm: options.setModelForm,
    setModelCatalogs: options.setModelCatalogs,
    workspaceDirectory: options.workspaceDirectory,
    setDesktopAgentSystemPrompt: options.setDesktopAgentSystemPrompt,
    toolForm: options.toolForm,
    setToolForm: options.setToolForm,
    mcpServerForm: options.mcpServerForm,
    setMcpServerForm: options.setMcpServerForm,
    mountedRef,
    modelSaveQueueRef,
    toolSaveQueueRef,
    mcpToolSaveQueueRef,
    mcpToolUpdateVersionRef,
    mcpToolCatalogDraftRef,
    setSavingModel,
    setSavingWorkspace,
    setSavingDesktopAgent,
    setSavingTools,
  }), [
    options.aiMode,
    options.app,
    options.mcpServerForm,
    options.modelForm,
    options.setApp,
    options.setDesktopAgentSystemPrompt,
    options.setMcpServerForm,
    options.setModelCatalogs,
    options.setModelForm,
    options.setToolForm,
    options.toolForm,
    options.workspaceDirectory,
  ]);

  const composerController = useMemo(() => createAppComposerController({
    setApp: options.setApp,
    mountedRef,
    contextBusy,
    setContextBusy,
    attachmentUploadAttemptRef,
    setAttachments: options.setAttachments,
    attachments: options.attachments,
    setSelectedWorkspaceDirectory: options.setSelectedWorkspaceDirectory,
    selectedModelId: options.selectedModelId,
    setComposerSelectedModelId: options.setComposerSelectedModelId,
    selectComposerModel: settingsController.selectComposerModel,
    toolConfirmationPolicy: options.toolConfirmationPolicy,
    setToolConfirmationPolicy: options.setToolConfirmationPolicy,
    saveToolConfirmationPolicy: settingsController.saveToolConfirmationPolicy,
  }), [
    contextBusy,
    options.attachments,
    options.selectedModelId,
    options.setApp,
    options.setAttachments,
    options.setComposerSelectedModelId,
    options.setSelectedWorkspaceDirectory,
    options.setToolConfirmationPolicy,
    options.toolConfirmationPolicy,
    settingsController.saveToolConfirmationPolicy,
    settingsController.selectComposerModel,
  ]);

  return {
    bootstrap,
    retryBootstrap,
    currentRun,
    contextUsage,
    modelResponding,
    pendingConfirmation,
    pendingCount,
    confirmationBusy,
    contextBusy,
    pendingConversationIds,

    savingModel,
    savingWorkspace,
    savingDesktopAgent,
    savingTools,
    runActions: {
      loadConversation: runController.loadConversation,
      startTask: runController.startTask,
      startNewConversation: runController.startNewConversation,
      cancelRun: runController.cancelRun,
      decideConfirmation: runController.decideConfirmation,
      resetChat: runController.resetChat,
    },
    deepEntryActions,
    deepTaskActions,
    sidebarActions: {
      renameConversation: sidebarConversationController.renameConversation,
      toggleConversationPinned: sidebarConversationController.toggleConversationPinned,
      deleteConversation: sidebarConversationController.deleteConversation,
    },
    settingsController,
    composerActions: {
      selectInputModel: composerController.selectInputModel,
      selectAttachment: composerController.selectAttachment,
      selectTaskWorkspace: composerController.selectTaskWorkspace,
      uploadAttachments: composerController.uploadAttachments,
      removeAttachment: composerController.removeAttachment,
      changeToolConfirmationPolicy: composerController.changeToolConfirmationPolicy,
    },
  };
}
