import React, { useEffect, useMemo, useRef, useState } from "react";
import { useConversationSummaryRefresh } from "./app-conversation-refresh";
import { createAppRunController } from "./app-run-controller";
import {
  currentRunProjectionDeps,
  projectCurrentRun,
  type CurrentRunProjection,
} from "./app-run-projection";
import { createDeepRunUpdateController } from "./app-deep-live-updates";
import { createAppDeepEntryController } from "./app-deep-entry";
import { createAppDeepTaskController } from "./app-deep-task-controller";
import { createAppSidebarConversationController } from "./app-sidebar-conversation-controller";
import { createAppSettingsController, type AppSettingsController } from "./app-settings-controller";
import { createAppComposerController } from "./app-composer-controller";
import { applyAppBootstrap, loadAppBootstrap } from "./app-bootstrap";
import { shouldKeepRefreshing, stopLiveUpdates } from "./app-runtime-controls";
import {
  contextWindowUsageFrom,
  latestModelUsageFromEvents,
  latestModelUsageFromTranscript,
  type ContextWindowUsage,
} from "../../panel-context-window-usage";
import { isConversationWaitingForUser } from "./conversation-state";
import type { AppState } from "./app-state";
import type {
  ComposerReasoningEffort,
  ComposerToolConfirmationPolicy,
  VisibleAiMode,
} from "./app-config-projection";
import type { Screen } from "./components/sidebar";
import type { McpServerForm, ModelForm, ToolForm } from "./components/settings-types";
import type { ModelProviderModelCatalog } from "./contracts/config";
import type { ContextAttachment } from "./contracts/context";
import type { DesktopWorkView } from "./contracts/run";
import type { McpServerCatalogItem } from "./contracts/tools";

export type AppWorkbenchRuntimeOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly setScreen: React.Dispatch<React.SetStateAction<Screen>>;
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
  readonly setPinningConversationIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
};

export type AppWorkbenchRuntime = {
  readonly currentRun: CurrentRunProjection;
  readonly contextUsage?: ContextWindowUsage;
  readonly modelResponding: boolean;
  readonly pendingConfirmation?: DesktopWorkView["pendingConfirmation"];
  readonly pendingCount: number;
  readonly confirmationBusy: boolean;
  readonly contextBusy: boolean;
  readonly deepChildOperationBusyId?: string;
  readonly deepResynthesisBusy: boolean;
  readonly savingModel: boolean;
  readonly savingWorkspace: boolean;
  readonly savingDesktopAgent: boolean;
  readonly savingTools: boolean;
  readonly runActions: Pick<
    ReturnType<typeof createAppRunController>,
    "loadConversation" | "startTask" | "cancelRun" | "decideConfirmation" | "resetChat"
  >;
  readonly deepEntryActions: Pick<
    ReturnType<typeof createAppDeepEntryController>,
    "openNormalAgentEntry" | "openNormalTaskEntry" | "openNormalConversation" | "openAgentClusterRun" | "openAgentClusterConversation" | "openAgentClusterEntry"
  >;
  readonly deepTaskActions: Pick<
    ReturnType<typeof createAppDeepTaskController>,
    "submitDeepInput" | "startConfirmedDeepRun" | "stopDeepTask" | "sendDeepChildMessage" | "decideDeepChild" | "resynthesizeDeepRun"
  >;
  readonly sidebarActions: Pick<
    ReturnType<typeof createAppSidebarConversationController>,
    "renameConversation" | "toggleConversationPinned" | "deleteConversation" | "renameDeepConversation" | "toggleDeepConversationPinned" | "deleteDeepConversation"
  >;
  readonly settingsController: AppSettingsController;
  readonly composerActions: Pick<
    ReturnType<typeof createAppComposerController>,
    "selectInputModel" | "selectAttachment" | "selectTaskWorkspace" | "uploadAttachments" | "removeAttachment" | "changeToolConfirmationPolicy"
  >;
};

export function useAppWorkbenchRuntime(options: AppWorkbenchRuntimeOptions): AppWorkbenchRuntime {
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [deepChildOperationBusyId, setDeepChildOperationBusyId] = useState<string | undefined>(undefined);
  const [deepResynthesisBusy, setDeepResynthesisBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingDesktopAgent, setSavingDesktopAgent] = useState(false);
  const [savingTools, setSavingTools] = useState(false);

  const mountedRef = useRef(true);
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const viewEpochRef = useRef(0);
  const deepPollTimerRef = useRef<number | undefined>(undefined);
  const deepStreamRef = useRef<EventSource | undefined>(undefined);
  const deepOpenEpochRef = useRef(0);
  const conversationLoadAbortRef = useRef<AbortController | undefined>(undefined);
  const pinningConversationIdsRef = useRef<Set<string>>(new Set());
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

  useEffect(() => {
    void loadAppBootstrap().then((bootstrap) => {
      if (mountedRef.current) {
        options.setApp((previous) => applyAppBootstrap(previous, bootstrap));
      }
    }).catch((error) => {
      if (mountedRef.current) {
        options.setApp((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "工作台启动数据加载失败。",
        }));
      }
    });
    return () => {
      mountedRef.current = false;
      conversationLoadAbortRef.current?.abort();
      conversationLoadAbortRef.current = undefined;
      stopLiveUpdates(pollTimer, streamRef);
      if (deepPollTimerRef.current !== undefined) {
        window.clearInterval(deepPollTimerRef.current);
        deepPollTimerRef.current = undefined;
      }
      if (deepStreamRef.current !== undefined) {
        deepStreamRef.current.close();
        deepStreamRef.current = undefined;
      }
    };
  }, [options.setApp]);

  const currentRun = useMemo(() => projectCurrentRun(options.app), currentRunProjectionDeps(options.app));
  const hasNormalConversationContext =
    !options.agentClusterActive && (options.app.conversation !== undefined || currentRun.run !== undefined);
  const latestModelUsage = useMemo(
    () => latestModelUsageFromEvents(currentRun.events) ?? latestModelUsageFromTranscript(currentRun.transcriptNodes),
    [currentRun.events, currentRun.transcriptNodes],
  );
  const contextUsage = useMemo(() => {
    if (!hasNormalConversationContext) {
      return undefined;
    }
    return contextWindowUsageFrom({
      contextWindowTokens:
        options.selectedModelContextWindowTokens ??
        currentRun.capabilityResolution?.capabilityPlan?.modelCapabilities.contextWindowTokens,
      modelUsage: latestModelUsage,
      ledgerBudget: currentRun.workView?.contextLedger.budget,
    });
  }, [
    currentRun.capabilityResolution?.capabilityPlan?.modelCapabilities.contextWindowTokens,
    currentRun.workView?.contextLedger.budget,
    hasNormalConversationContext,
    latestModelUsage,
    options.selectedModelContextWindowTokens,
  ]);
  const modelResponding = currentRun.run !== undefined && shouldKeepRefreshing(currentRun.run.status);
  const pendingConfirmation = currentRun.workView?.pendingConfirmation;
  const pendingConversationCount = options.app.conversations.filter(isConversationWaitingForUser).length;
  const pendingCount = Math.max(pendingConversationCount, pendingConfirmation === undefined ? 0 : 1);

  const runController = useMemo(() => createAppRunController({
    app: options.app,
    setApp: options.setApp,
    setScreen: options.setScreen,
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
    activeRunIdRef,
    viewEpochRef,
    conversationLoadAbortRef,
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
    options.setScreen,
    options.toolConfirmationPolicy,
  ]);

  const deepRunUpdateController = useMemo(() => createDeepRunUpdateController({
    setApp: options.setApp,
    mountedRef,
    pollTimerRef: deepPollTimerRef,
    streamRef: deepStreamRef,
  }), [options.setApp]);

  const deepEntryController = useMemo(() => createAppDeepEntryController({
    app: options.app,
    setApp: options.setApp,
    setScreen: options.setScreen,
    setGoal: options.setGoal,
    setAttachments: options.setAttachments,
    setSelectedWorkspaceDirectory: options.setSelectedWorkspaceDirectory,
    setInputCloseSignal: options.setInputCloseSignal,
    loadConversation: runController.loadConversation,
    resetChat: runController.resetChat,
    mountedRef,
    deepOpenEpochRef,
    deepRunUpdateController,
  }), [
    deepRunUpdateController,
    options.app,
    options.setApp,
    options.setAttachments,
    options.setGoal,
    options.setInputCloseSignal,
    options.setScreen,
    options.setSelectedWorkspaceDirectory,
    runController.loadConversation,
    runController.resetChat,
  ]);

  const deepTaskController = useMemo(() => createAppDeepTaskController({
    app: options.app,
    setApp: options.setApp,
    setScreen: options.setScreen,
    setGoal: options.setGoal,
    setAttachments: options.setAttachments,
    attachments: options.attachments,
    selectedWorkspaceDirectory: options.selectedWorkspaceDirectory,
    goal: options.goal,
    aiMode: options.aiMode,
    mountedRef,
    deepOpenEpochRef,
    deepRunUpdateController,
    deepChildOperationBusyId,
    setDeepChildOperationBusyId,
    deepResynthesisBusy,
    setDeepResynthesisBusy,
  }), [
    deepChildOperationBusyId,
    deepResynthesisBusy,
    deepRunUpdateController,
    options.aiMode,
    options.app,
    options.attachments,
    options.goal,
    options.selectedWorkspaceDirectory,
    options.setApp,
    options.setAttachments,
    options.setGoal,
    options.setScreen,
  ]);

  const sidebarConversationController = useMemo(() => createAppSidebarConversationController({
    app: options.app,
    setApp: options.setApp,
    mountedRef,
    pinningConversationIdsRef,
    setPinningConversationIds: options.setPinningConversationIds,
    resetChat: runController.resetChat,
    setSelectedWorkspaceDirectory: options.setSelectedWorkspaceDirectory,
    setInputCloseSignal: options.setInputCloseSignal,
    setGoal: options.setGoal,
    setAttachments: options.setAttachments,
    setScreen: options.setScreen,
    deepRunUpdateController,
  }), [
    deepRunUpdateController,
    options.app,
    options.setApp,
    options.setAttachments,
    options.setGoal,
    options.setInputCloseSignal,
    options.setPinningConversationIds,
    options.setScreen,
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
    setAttachments: options.setAttachments,
    setSelectedWorkspaceDirectory: options.setSelectedWorkspaceDirectory,
    selectedModelId: options.selectedModelId,
    setComposerSelectedModelId: options.setComposerSelectedModelId,
    selectComposerModel: settingsController.selectComposerModel,
    toolConfirmationPolicy: options.toolConfirmationPolicy,
    setToolConfirmationPolicy: options.setToolConfirmationPolicy,
    saveToolConfirmationPolicy: settingsController.saveToolConfirmationPolicy,
  }), [
    contextBusy,
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
    currentRun,
    contextUsage,
    modelResponding,
    pendingConfirmation,
    pendingCount,
    confirmationBusy,
    contextBusy,
    deepChildOperationBusyId,
    deepResynthesisBusy,
    savingModel,
    savingWorkspace,
    savingDesktopAgent,
    savingTools,
    runActions: {
      loadConversation: runController.loadConversation,
      startTask: runController.startTask,
      cancelRun: runController.cancelRun,
      decideConfirmation: runController.decideConfirmation,
      resetChat: runController.resetChat,
    },
    deepEntryActions: {
      openNormalAgentEntry: deepEntryController.openNormalAgentEntry,
      openNormalTaskEntry: deepEntryController.openNormalTaskEntry,
      openNormalConversation: deepEntryController.openNormalConversation,
      openAgentClusterRun: deepEntryController.openAgentClusterRun,
      openAgentClusterConversation: deepEntryController.openAgentClusterConversation,
      openAgentClusterEntry: deepEntryController.openAgentClusterEntry,
    },
    deepTaskActions: {
      submitDeepInput: deepTaskController.submitDeepInput,
      startConfirmedDeepRun: deepTaskController.startConfirmedDeepRun,
      stopDeepTask: deepTaskController.stopDeepTask,
      sendDeepChildMessage: deepTaskController.sendDeepChildMessage,
      decideDeepChild: deepTaskController.decideDeepChild,
      resynthesizeDeepRun: deepTaskController.resynthesizeDeepRun,
    },
    sidebarActions: {
      renameConversation: sidebarConversationController.renameConversation,
      toggleConversationPinned: sidebarConversationController.toggleConversationPinned,
      deleteConversation: sidebarConversationController.deleteConversation,
      renameDeepConversation: sidebarConversationController.renameDeepConversation,
      toggleDeepConversationPinned: sidebarConversationController.toggleDeepConversationPinned,
      deleteDeepConversation: sidebarConversationController.deleteDeepConversation,
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
