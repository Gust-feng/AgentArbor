import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { isConversationWaitingForUser } from "./conversation-state";
import { ChatActive } from "./components/chat-active";
import { ChatEmpty } from "./components/chat-empty";
import { MultiAgentWorkspace } from "./components/multi-agent-workspace";
import { SettingsDialog } from "./components/settings-dialog";
import { Sidebar, type Screen } from "./components/sidebar";
import type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./components/settings-types";
import {
  StartupIntroOverlay,
  startupIntroTimingStyle,
  useStartupIntro,
} from "./app-startup-intro";
import { getStartupAnimationEnabled, subscribeMotionSettingsChanged } from "./app-motion";
import {
  getModelUsageDisplayEnabled,
  saveModelUsageDisplayEnabled,
  subscribeModelUsageDisplayChanged,
} from "./app-model-usage-display";
import {
  selectLocalContextAttachment,
  taskSoilInputFromAttachments,
  uniqueAttachments,
  uploadContextAttachmentFiles,
} from "./app-attachments";
import { selectTaskWorkspaceDirectory } from "./app-workspace-selection";
import { applyAppBootstrap, loadAppBootstrap } from "./app-bootstrap";
import {
  normalizeAgentMode,
  normalizeVisibleAiMode,
  normalizeComposerToolConfirmationPolicy,
  visibleConfigBaseUrl,
  visibleConfigLabel,
  catalogRecordFromList,
  type AgentMode,
  type ComposerReasoningEffort,
  type ComposerToolConfirmationPolicy,
  type VisibleAiMode,
} from "./app-config-projection";
import {
  type ConversationManagementResponse,
  isMissingConversationError,
  removeConversation,
  renameConversationTitle,
  updateConversationPinnedState,
  upsertConversationSummary,
} from "./app-conversation-management";
import {
  isMissingDeepConversationError,
  removeDeepConversation,
  renameDeepConversationTitle,
  updateDeepConversationPinnedState,
  upsertManagedDeepConversationSummary,
} from "./app-deep-conversation-management";
import { useConversationSummaryRefresh } from "./app-conversation-refresh";
import { createAppSettingsController } from "./app-settings-controller";
import {
  currentRunProjectionDeps,
  projectCurrentRun,
} from "./app-run-projection";
import {
  contextWindowUsageFrom,
  latestModelUsageFromEvents,
  latestModelUsageFromTranscript,
} from "../../panel-context-window-usage";
import { createAppRunController } from "./app-run-controller";
import {
  shouldKeepRefreshing,
  stopLiveUpdates,
} from "./app-runtime-controls";
import { createInitialAppState, type AppState } from "./app-state";
import { requestDeepIntake, requestStartConfirmedDeepRun } from "./app-deep-intake";
import { createDeepRunUpdateController } from "./app-deep-live-updates";
import {
  deepConversationSummaryFromView,
  deepRunSummaryFromView,
  getDeepConversation,
  isTerminalDeepRunStatus,
  latestRestorableDeepConversation,
  latestRestorableDeepRun,
  openDeepRun,
  shouldKeepDeepRunBusy,
  shouldPollDeepRun,
  upsertDeepConversationSummary,
  upsertDeepRunSummary,
} from "./app-deep-history";
import {
  decideDeepChildConfirmation,
  requestDeepChildMessage,
  requestDeepRunCorrection,
  requestDeepRunResynthesis,
  requestDeepRunStop,
} from "./app-deep-control";
import type { ModelProviderModelCatalog } from "./contracts/config";
import type { ContextAttachment } from "./contracts/context";
import type {
  DeepChildOperationResponse,
  DeepLivePhase,
  DeepRunStatus,
  DeepRunView,
} from "./contracts/deep";
import type { McpServerCatalogItem } from "./contracts/tools";
import type { AppUpdateInfo } from "./contracts/app-update";
import { modelOptionSupportsReasoningEffort, modelOptionsFromConfig, selectedModelOptionId } from "./model-options";

type StartupIntroRootStyle = React.CSSProperties & {
  "--startup-intro-target-width"?: string;
  "--startup-intro-target-height"?: string;
  "--startup-intro-empty-grid-top-padding"?: string;
};

type DesktopWindowState = {
  readonly maximized: boolean;
  readonly animating: boolean;
};

export function App(): React.ReactElement {
  const [app, setApp] = useState(createInitialAppState);
  const [screen, setScreen] = useState<Screen>("chat-empty");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("models");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsedPreference);
  const [startupAnimationEnabled, setStartupAnimationEnabled] = useState(getStartupAnimationEnabled);
  const [modelUsageDisplayEnabled, setModelUsageDisplayEnabled] = useState(getModelUsageDisplayEnabled);
  const [agentClusterEnabled, setAgentClusterEnabled] = useState(loadAgentClusterEnabledPreference);
  const [pinningConversationIds, setPinningConversationIds] = useState<ReadonlySet<string>>(() => new Set());
  const [inputCloseSignal, setInputCloseSignal] = useState(0);
  const [goal, setGoal] = useState("");
  const [aiMode, setAiMode] = useState<VisibleAiMode>("openai-responses");
  const [modelForm, setModelForm] = useState<ModelForm>({
    profileId: "",
    label: "",
    logoDataUrl: "",
    logoCleared: false,
    baseUrl: "",
    protocolKind: "openai_compatible_chat_completions",
    model: "",
    apiKey: "",
    apiKeyCleared: false,
  });
  const [composerReasoningEffort, setComposerReasoningEffort] = useState<ComposerReasoningEffort>("");
  const [toolConfirmationPolicy, setToolConfirmationPolicy] = useState<ComposerToolConfirmationPolicy>("prompt");
  const [composerSelectedModelId, setComposerSelectedModelId] = useState<string | undefined>(undefined);
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, ModelProviderModelCatalog>>({});
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [desktopAgentSystemPrompt, setDesktopAgentSystemPrompt] = useState("");
  const [toolForm, setToolForm] = useState<ToolForm>({
    provider: "tavily",
    apiKey: "",
    maxResults: "5",
    googleEngineId: "",
  });
  const [mcpServerForm, setMcpServerForm] = useState<McpServerForm>({
    serverId: "",
    label: "",
    description: "",
    transport: "stdio",
    authMode: "none",
    authTouched: false,
    confirmationMode: "never",
    toolExposureMode: "none",
    enabledTools: [],
    autoApprovedTools: [],
    command: "",
    args: "",
    commandLine: "",
    url: "",
    envSecretRefs: "",
    headerSecretRefs: "",
    bearerTokenSecretRef: "",
    bearerTokenValue: "",
    apiKeySecretRef: "",
    apiKeyHeaderName: "Authorization",
    apiKeyValue: "",
    customHeaderName: "",
    customHeaderValue: "",
    enabled: true,
  });
  const [attachments, setAttachments] = useState<readonly ContextAttachment[]>([]);
  const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState<string | undefined>(undefined);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [deepChildOperationBusyId, setDeepChildOperationBusyId] = useState<string | undefined>(undefined);
  const [deepResynthesisBusy, setDeepResynthesisBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<readonly { readonly id: string; readonly content: string }[]>([]);
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
  const lastActiveProfileIdRef = useRef<string | undefined>(undefined);
  const modelSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const toolSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mcpToolSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mcpToolUpdateVersionRef = useRef(0);
  const mcpToolCatalogDraftRef = useRef<readonly McpServerCatalogItem[] | undefined>(undefined);

  useConversationSummaryRefresh({
    conversations: app.conversations,
    setApp,
    mountedRef,
  });

  useEffect(() => {
    mcpToolCatalogDraftRef.current = app.tools?.mcpCatalog;
  }, [app.tools?.mcpCatalog]);

  useEffect(() => {
    void loadAppBootstrap().then((bootstrap) => {
      if (mountedRef.current) {
        setApp((previous) => applyAppBootstrap(previous, bootstrap));
      }
    }).catch((error) => {
      if (mountedRef.current) {
        setApp((previous) => ({
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
  }, []);

  useEffect(() => {
    const activeProfileId = app.config?.config?.profileId;
    if (activeProfileId !== undefined && activeProfileId !== lastActiveProfileIdRef.current) {
      lastActiveProfileIdRef.current = activeProfileId;
      setAiMode(normalizeVisibleAiMode(app.config!.config!.defaultAiMode));
      setModelForm({
        profileId: activeProfileId,
        label: visibleConfigLabel(app.config!.config!),
        logoDataUrl: app.config!.config!.logoDataUrl ?? "",
        logoCleared: false,
        baseUrl: visibleConfigBaseUrl(app.config!.config!),
        protocolKind: app.config!.config!.protocolKind ?? "openai_compatible_chat_completions",
        model: app.config!.config!.model ?? "",
        apiKey: "",
        apiKeyCleared: false,
      });
    }
    if (app.config?.workspace !== undefined) {
      setWorkspaceDirectory(app.config.workspace.workspaceDirectory ?? "");
    }
    if (app.config?.desktopAgent?.systemPrompt !== undefined) {
      setDesktopAgentSystemPrompt(app.config.desktopAgent.systemPrompt);
    }
  }, [app.config]);

  useEffect(() => {
    if (app.config?.toolConfirmation?.policy !== undefined) {
      setToolConfirmationPolicy(normalizeComposerToolConfirmationPolicy(app.config.toolConfirmation.policy));
    }
  }, [app.config?.toolConfirmation?.policy]);

  useEffect(() => {
    const webSearch = app.tools?.tools?.webSearch;
    if (webSearch !== undefined) {
      setToolForm({
        provider: webSearch.provider === "none" ? "model_builtin" : (webSearch.provider ?? "tavily"),
        apiKey: "",
        maxResults: String(webSearch.maxResults ?? 5),
        googleEngineId: webSearch.engineId ?? "",
      });
    }
  }, [app.tools]);

  useEffect(() => {
    setMcpServerForm((previous) => {
      if (previous.serverId.length > 0) return previous;
      const firstServer = app.tools?.mcpCatalog?.[0];
      if (firstServer === undefined) return previous;
      return {
        ...previous,
        serverId: firstServer.serverId,
        label: firstServer.label,
        description: firstServer.description ?? "",
        transport: firstServer.transport,
        confirmationMode: firstServer.confirmationMode ?? "never",
        toolExposureMode: firstServer.toolExposureMode ?? "none",
        url: firstServer.url ?? "",
        headerSecretRefs: "",
        enabled: firstServer.enabled,
      };
    });
  }, [app.tools?.mcpCatalog]);

  useEffect(() => {
    if (app.config?.modelCatalogs !== undefined) {
      setModelCatalogs(catalogRecordFromList(app.config.modelCatalogs));
    }
  }, [app.config?.modelCatalogs]);

  const modelOptions = useMemo(() => modelOptionsFromConfig(app.config, modelCatalogs), [app.config, modelCatalogs]);
  const persistedSelectedModelId = useMemo(() => selectedModelOptionId(app.config, modelOptions), [app.config, modelOptions]);
  const selectedModelId = useMemo(() => {
    if (composerSelectedModelId !== undefined && modelOptions.some((model) => model.id === composerSelectedModelId)) {
      return composerSelectedModelId;
    }
    return persistedSelectedModelId;
  }, [composerSelectedModelId, modelOptions, persistedSelectedModelId]);
  const selectedModelSupportsReasoningEffort = useMemo(
    () => modelOptionSupportsReasoningEffort(app.config, selectedModelId),
    [app.config, selectedModelId]
  );
  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.id === selectedModelId),
    [modelOptions, selectedModelId]
  );
  const agentClusterActive = agentClusterEnabled && app.agentMode === "deep";
  const chatScreen = agentClusterActive
    ? screen
    : screen === "chat-empty" && (app.conversation !== undefined || app.run !== undefined) ? "chat-active" : screen;
  const currentRun = useMemo(() => projectCurrentRun(app), currentRunProjectionDeps(app));
  const hasNormalConversationContext = !agentClusterActive && (app.conversation !== undefined || currentRun.run !== undefined);
  const latestModelUsage = useMemo(
    () => latestModelUsageFromEvents(currentRun.events) ?? latestModelUsageFromTranscript(currentRun.transcriptNodes),
    [currentRun.events, currentRun.transcriptNodes]
  );
  const contextUsage = useMemo(
    () => {
      if (!hasNormalConversationContext) {
        return undefined;
      }
      return contextWindowUsageFrom({
        contextWindowTokens:
          selectedModel?.capabilities?.contextWindowTokens ??
          currentRun.capabilityResolution?.capabilityPlan?.modelCapabilities.contextWindowTokens,
        modelUsage: latestModelUsage,
        ledgerBudget: currentRun.workView?.contextLedger.budget,
      });
    },
    [
      currentRun.capabilityResolution?.capabilityPlan?.modelCapabilities.contextWindowTokens,
      currentRun.workView?.contextLedger.budget,
      hasNormalConversationContext,
      latestModelUsage,
      selectedModel?.capabilities?.contextWindowTokens,
    ]
  );
  const modelResponding = currentRun.run !== undefined && shouldKeepRefreshing(currentRun.run.status);
  const pendingConfirmation = currentRun.workView?.pendingConfirmation;
  const pendingConversationCount = app.conversations.filter(isConversationWaitingForUser).length;
  const pendingCount = Math.max(pendingConversationCount, pendingConfirmation === undefined ? 0 : 1);
  const runController = useMemo(() => createAppRunController({
    app,
    setApp,
    setScreen,
    setGoal,
    attachments,
    setAttachments,
    selectedWorkspaceDirectory,
    goal,
    aiMode,
    composerReasoningEffort,
    toolConfirmationPolicy,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    confirmationBusy,
    setConfirmationBusy,
    mountedRef,
    pollTimer,
    streamRef,
    activeRunIdRef,
    viewEpochRef,
    conversationLoadAbortRef,
  }), [
    app,
    attachments,
    selectedWorkspaceDirectory,
    goal,
    aiMode,
    composerReasoningEffort,
    toolConfirmationPolicy,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    confirmationBusy,
  ]);
  const {
    loadConversation,
    startTask,
    cancelRun,
    decideConfirmation,
    resetChat,
  } = runController;
  useEffect(() => {
    if (app.agentMode !== "normal" || app.conversation === undefined) return;
    setSelectedWorkspaceDirectory(app.conversation.workspaceFolder?.path);
  }, [app.agentMode, app.conversation?.conversationId, app.conversation?.workspaceFolder?.path]);
  useEffect(() => {
    if (app.agentMode !== "deep" || app.deep === undefined) return;
    setSelectedWorkspaceDirectory(app.deep.run.workspaceFolder?.path);
  }, [app.agentMode, app.deep?.run.runId, app.deep?.run.workspaceFolder?.path]);
  const deepRunUpdateController = useMemo(
    () => createDeepRunUpdateController({
      setApp,
      mountedRef,
      pollTimerRef: deepPollTimerRef,
      streamRef: deepStreamRef,
    }),
    [],
  );
  const settingsController = createAppSettingsController({
    app,
    setApp,
    aiMode,
    modelForm,
    setModelForm,
    setModelCatalogs,
    workspaceDirectory,
    setDesktopAgentSystemPrompt,
    toolForm,
    setToolForm,
    mcpServerForm,
    setMcpServerForm,
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
  });
  const {
    saveModelConfig,
    createCustomModelProfile,
    reorderModelProviders,
    deleteModelProvider,
    revealModelApiKey,
    selectComposerModel,
    fetchModelsForProfile,
    saveModelCatalog,
    saveModelCapabilities,
    saveWorkspace,
    selectWorkspace,
    saveCommandShell,
    saveToolConfirmationPolicy,
    saveDesktopAgentSystemPrompt,
    resetDesktopAgentSystemPrompt,
    saveSkillTriggerMode,
    saveTools,
    saveMcpServer,
    loadMcpReferences,
    importMcpConfig,
    testMcpServer,
    checkMcpEnvironment,
    installMcpEnvironment,
    deleteMcpServer,
    updateMcpTool,
    refreshAppUpdateStatus,
    checkAppUpdate,
    installAppUpdate,
    refreshSkills,
    refreshSubAgents,
    updateSkill,
  } = settingsController;
  const checkAppUpdateRef = useRef(checkAppUpdate);
  const refreshAppUpdateStatusRef = useRef(refreshAppUpdateStatus);
  const autoAppUpdateCheckRequestedRef = useRef(false);
  checkAppUpdateRef.current = checkAppUpdate;
  refreshAppUpdateStatusRef.current = refreshAppUpdateStatus;

  useEffect(() => {
    if (composerSelectedModelId !== undefined && !modelOptions.some((model) => model.id === composerSelectedModelId)) {
      setComposerSelectedModelId(undefined);
    }
  }, [composerSelectedModelId, modelOptions]);

  useEffect(() => {
    if (composerSelectedModelId !== undefined && composerSelectedModelId === persistedSelectedModelId) {
      setComposerSelectedModelId(undefined);
    }
  }, [composerSelectedModelId, persistedSelectedModelId]);

  useEffect(() => {
    if (!selectedModelSupportsReasoningEffort && composerReasoningEffort !== "") {
      setComposerReasoningEffort("");
    }
  }, [composerReasoningEffort, selectedModelId, selectedModelSupportsReasoningEffort]);

  useEffect(() => {
    persistSidebarCollapsedPreference(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => subscribeMotionSettingsChanged(() => {
    setStartupAnimationEnabled(getStartupAnimationEnabled());
  }), []);

  useEffect(() => subscribeModelUsageDisplayChanged(() => {
    setModelUsageDisplayEnabled(getModelUsageDisplayEnabled());
  }), []);

  useEffect(() => {
    const update = app.appUpdate;
    if (
      autoAppUpdateCheckRequestedRef.current ||
      update === undefined ||
      update.status !== "idle" ||
      update.canCheck !== true
    ) {
      return;
    }
    autoAppUpdateCheckRequestedRef.current = true;
    void checkAppUpdateRef.current();
  }, [app.appUpdate?.canCheck, app.appUpdate?.status]);

  useEffect(() => {
    const status = app.appUpdate?.status;
    if (status !== "checking" && status !== "available" && status !== "downloading" && status !== "installing") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshAppUpdateStatusRef.current();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [app.appUpdate?.status]);

  function selectInputModel(modelOptionId: string): void {
    const fallbackModelId = selectedModelId;
    setComposerSelectedModelId(modelOptionId);
    void selectComposerModel(modelOptionId).catch(() => {
      if (!mountedRef.current) return;
      setComposerSelectedModelId((current) => current === modelOptionId ? fallbackModelId || undefined : current);
    });
  }


  async function selectAttachment(): Promise<void> {
    if (contextBusy) return;
    setContextBusy(true);
    try {
      const attachment = await selectLocalContextAttachment();
      if (mountedRef.current && attachment !== undefined) {
        setAttachments((previous) => uniqueAttachments([...previous, attachment]));
        setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "添加附件失败。") }));
      }
    } finally {
      if (mountedRef.current) setContextBusy(false);
    }
  }

  async function selectTaskWorkspace(): Promise<void> {
    if (contextBusy) return;
    setContextBusy(true);
    try {
      const directory = await selectTaskWorkspaceDirectory();
      if (mountedRef.current && directory !== undefined) {
        setSelectedWorkspaceDirectory(directory);
        setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "选择工作区失败。") }));
      }
    } finally {
      if (mountedRef.current) setContextBusy(false);
    }
  }

  async function uploadAttachments(files: readonly File[]): Promise<void> {
    if (contextBusy || files.length === 0) return;
    setContextBusy(true);
    try {
      const uploaded = await uploadContextAttachmentFiles(files);
      if (mountedRef.current && uploaded.length > 0) {
        setAttachments((previous) => uniqueAttachments([...previous, ...uploaded]));
        setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "上传附件失败。") }));
      }
    } finally {
      if (mountedRef.current) setContextBusy(false);
    }
  }

  function removeAttachment(attachmentId: string): void {
    setAttachments((previous) => previous.filter((attachment) => attachment.attachmentId !== attachmentId));
  }

  function openSettings(group: SettingsGroup = "models"): void {
    setInputCloseSignal((value) => value + 1);
    setSettingsGroup(group);
    setSettingsOpen(true);
  }

  function changeModelUsageDisplay(enabled: boolean): void {
    setModelUsageDisplayEnabled(enabled);
    saveModelUsageDisplayEnabled(enabled);
  }

  function changeAgentClusterEnabled(enabled: boolean): void {
    setAgentClusterEnabled(enabled);
    persistAgentClusterEnabledPreference(enabled);
    if (!enabled && app.agentMode === "deep") {
      openNormalAgentEntry();
    }
  }

  function changeToolConfirmationPolicy(nextPolicy: ComposerToolConfirmationPolicy): void {
    const previousPolicy = toolConfirmationPolicy;
    setToolConfirmationPolicy(nextPolicy);
    void saveToolConfirmationPolicy(nextPolicy)
      .catch(() => {
        if (!mountedRef.current) return;
        setToolConfirmationPolicy(previousPolicy);
      });
  }

  function changeAgentMode(nextMode: AgentMode): void {
    const normalized = normalizeAgentMode(nextMode);
    setApp((previous) => {
      if (previous.agentMode === normalized) return previous;
      return { ...previous, agentMode: normalized, error: undefined };
    });
  }

  function openNormalAgentEntry(): void {
    deepRunUpdateController.stopPolling();
    setInputCloseSignal((value) => value + 1);
    setGoal("");
    setAttachments([]);
    setScreen(app.conversation !== undefined || app.run !== undefined ? "chat-active" : "chat-empty");
    changeAgentMode("normal");
  }

  function openNormalTaskEntry(): void {
    deepOpenEpochRef.current += 1;
    deepRunUpdateController.stopPolling();
    changeAgentMode("normal");
    setSelectedWorkspaceDirectory(undefined);
    resetChat();
  }

  function openNormalConversation(conversationId: string): void {
    changeAgentMode("normal");
    const summary = app.conversations.find((item) => item.conversationId === conversationId);
    setSelectedWorkspaceDirectory(summary?.workspaceFolder?.path);
    void loadConversation(conversationId);
  }

  async function openAgentClusterRun(
    runId: string,
    options?: { readonly auto?: boolean },
  ): Promise<void> {
    const epoch = deepOpenEpochRef.current + 1;
    deepOpenEpochRef.current = epoch;
    setScreen("chat-active");
    setGoal("");
    setAttachments([]);
    setApp((previous) => ({
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
      if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;
      const keepBusy = shouldKeepDeepRunBusy(view.run);
      const keepPolling = shouldPollDeepRun(view.run);
      const summary = deepRunSummaryFromView(view);
      const conversationSummary = view.conversation === undefined
        ? undefined
        : deepConversationSummaryFromView(view.conversation, summary);
      const intakeStatus = conversationSummary?.intakeStatus;
      setSelectedWorkspaceDirectory(view.run.workspaceFolder?.path);
      setApp((previous) => ({
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
        deepRunUpdateController.startPolling(view.run.runId);
      } else {
        deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;
      setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deepBusy: false,
        deepPendingGoal: undefined,
        error: errorText(
          error,
          options?.auto === true ? "恢复 Agent 集群运行失败。" : "打开 Agent 集群运行失败。",
        ),
      }));
    }
  }

  async function openAgentClusterConversation(conversationId: string): Promise<void> {
    const epoch = deepOpenEpochRef.current + 1;
    deepOpenEpochRef.current = epoch;
    const latestRunId = app.deepConversations.find(
      (conversation) => conversation.conversationId === conversationId,
    )?.latestRun?.runId;
    if (latestRunId !== undefined) {
      await openAgentClusterRun(latestRunId);
      return;
    }
    deepRunUpdateController.stopPolling();
    setScreen("chat-active");
    setGoal("");
    setAttachments([]);
    setApp((previous) => ({
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
      if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;
      const latestRun = response.runs[0];
      const summary = deepConversationSummaryFromView(response.conversation, latestRun);
      if (latestRun !== undefined) {
        setApp((previous) => ({
          ...previous,
          deepConversations: upsertDeepConversationSummary(previous.deepConversations, summary),
          deepRuns: upsertDeepRunSummary(previous.deepRuns, latestRun),
        }));
        await openAgentClusterRun(latestRun.runId);
        return;
      }
      setSelectedWorkspaceDirectory(
        response.conversation.birthWorkspaceDirectory,
      );
      setApp((previous) => ({
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
      if (!mountedRef.current) return;
      setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deepBusy: false,
        error: errorText(error, "打开 Agent 集群会话失败。"),
      }));
    }
  }

  function openAgentClusterEntry(): void {
    setInputCloseSignal((value) => value + 1);
    setScreen("chat-empty");
    setGoal("");
    setAttachments([]);
    const existingRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    if (existingRunId !== undefined) {
      void openAgentClusterRun(existingRunId);
      return;
    }
    const restorableConversationId = app.deepConversation?.conversationId ??
      latestRestorableDeepConversation(app.deepConversations)?.conversationId;
    if (restorableConversationId !== undefined) {
      void openAgentClusterConversation(restorableConversationId);
      return;
    }
    const restorableRunId = latestRestorableDeepRun(app.deepRuns)?.runId;
    if (restorableRunId !== undefined) {
      void openAgentClusterRun(restorableRunId);
      return;
    }
    setApp((previous) => ({
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

  async function renameConversation(conversationId: string, title: string): Promise<void> {
    try {
      const response = await renameConversationTitle(conversationId, title);
      if (!mountedRef.current) return;
      applyConversationManagementResponse(response);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "重命名会话失败。") }));
      }
    }
  }

  async function toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    if (pinningConversationIdsRef.current.has(conversationId)) return;
    const previousPinnedAt = conversationPinnedAt(app, conversationId);
    const optimisticPinnedAt = pinned ? new Date().toISOString() : undefined;
    setConversationPinning(conversationId, true);
    setApp((previous) => patchConversationPinnedAt(previous, conversationId, optimisticPinnedAt));
    try {
      const response = await updateConversationPinnedState(conversationId, pinned);
      if (!mountedRef.current) return;
      applyConversationManagementResponse(response);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({
          ...patchConversationPinnedAt(previous, conversationId, previousPinnedAt),
          error: errorText(error, "更新会话置顶失败。"),
        }));
      }
    } finally {
      if (!mountedRef.current) return;
      setConversationPinning(conversationId, false);
    }
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    try {
      const response = await removeConversation(conversationId);
      if (!mountedRef.current) return;
      setSelectedWorkspaceDirectory(undefined);
      resetChat();
      setApp((previous) => ({
        ...previous,
        conversations: (response.conversations ?? previous.conversations).filter((item) => item.conversationId !== conversationId),
        error: undefined,
      }));
    } catch (error) {
      if (mountedRef.current) {
        if (isMissingConversationError(error)) {
          setSelectedWorkspaceDirectory(undefined);
          resetChat();
          setApp((previous) => ({
            ...previous,
            conversations: previous.conversations.filter((item) => item.conversationId !== conversationId),
            error: undefined,
          }));
        } else {
          setApp((previous) => ({ ...previous, error: errorText(error, "删除会话失败。") }));
        }
      }
    }
  }

  async function renameDeepConversation(conversationId: string, title: string): Promise<void> {
    try {
      const response = await renameDeepConversationTitle(conversationId, title);
      if (!mountedRef.current) return;
      applyDeepConversationManagementResponse(response);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "重命名 Agent 集群会话失败。") }));
      }
    }
  }

  async function toggleDeepConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    if (pinningConversationIdsRef.current.has(conversationId)) return;
    const previousPinnedAt = deepConversationPinnedAt(app, conversationId);
    const optimisticPinnedAt = pinned ? new Date().toISOString() : undefined;
    setConversationPinning(conversationId, true);
    setApp((previous) => patchDeepConversationPinnedAt(previous, conversationId, optimisticPinnedAt));
    try {
      const response = await updateDeepConversationPinnedState(conversationId, pinned);
      if (!mountedRef.current) return;
      applyDeepConversationManagementResponse(response);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({
          ...patchDeepConversationPinnedAt(previous, conversationId, previousPinnedAt),
          error: errorText(error, "更新 Agent 集群会话置顶失败。"),
        }));
      }
    } finally {
      if (!mountedRef.current) return;
      setConversationPinning(conversationId, false);
    }
  }

  async function deleteDeepConversation(conversationId: string): Promise<void> {
    try {
      const response = await removeDeepConversation(conversationId);
      if (!mountedRef.current) return;
      deepRunUpdateController.stopPolling();
      setSelectedWorkspaceDirectory(undefined);
      setInputCloseSignal((value) => value + 1);
      setGoal("");
      setAttachments([]);
      setScreen("chat-empty");
      setApp((previous) => ({
        ...previous,
        deep: undefined,
        deepConversation: undefined,
        deepIntakeStatus: undefined,
        deepPendingGoal: undefined,
        deepActiveRunId: undefined,
        deepSelectedRunId: undefined,
        deepBusy: false,
        deepConversations: (response.conversations ?? previous.deepConversations)
          .filter((item) => item.conversationId !== conversationId),
        deepRuns: previous.deepRuns.filter((item) => item.conversationId !== conversationId),
        error: undefined,
      }));
    } catch (error) {
      if (mountedRef.current) {
        if (isMissingDeepConversationError(error)) {
          deepRunUpdateController.stopPolling();
          setSelectedWorkspaceDirectory(undefined);
          setInputCloseSignal((value) => value + 1);
          setGoal("");
          setAttachments([]);
          setScreen("chat-empty");
          setApp((previous) => ({
            ...previous,
            deep: undefined,
            deepConversation: undefined,
            deepIntakeStatus: undefined,
            deepPendingGoal: undefined,
            deepActiveRunId: undefined,
            deepSelectedRunId: undefined,
            deepBusy: false,
            deepConversations: previous.deepConversations.filter((item) => item.conversationId !== conversationId),
            deepRuns: previous.deepRuns.filter((item) => item.conversationId !== conversationId),
            error: undefined,
          }));
        } else {
          setApp((previous) => ({ ...previous, error: errorText(error, "删除 Agent 集群会话失败。") }));
        }
      }
    }
  }

  function applyConversationManagementResponse(response: ConversationManagementResponse): void {
    setApp((previous) => ({
      ...previous,
      conversations: response.conversations ?? upsertConversationSummary(previous.conversations, response.conversation),
      conversation:
        previous.conversation?.conversationId === response.conversation.conversationId
          ? response.conversation
          : previous.conversation,
      error: undefined,
    }));
  }

  function applyDeepConversationManagementResponse(response: {
    readonly conversation: AppState["deepConversation"];
    readonly conversations?: AppState["deepConversations"];
  }): void {
    const conversation = response.conversation;
    if (conversation === undefined) {
      return;
    }
    setApp((previous) => ({
      ...previous,
      deepConversations: response.conversations ??
        upsertManagedDeepConversationSummary(previous.deepConversations, conversation),
      deepConversation:
        previous.deepConversation?.conversationId === conversation.conversationId
          ? conversation
          : previous.deepConversation,
      deep:
        previous.deep?.conversation?.conversationId === conversation.conversationId
          ? {
            ...previous.deep,
            conversation,
          }
          : previous.deep,
      error: undefined,
    }));
  }

  function setConversationPinning(conversationId: string, pinning: boolean): void {
    const next = new Set(pinningConversationIdsRef.current);
    if (pinning) {
      next.add(conversationId);
    } else {
      next.delete(conversationId);
    }
    pinningConversationIdsRef.current = next;
    setPinningConversationIds(next);
  }

  const enqueueMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    setQueuedMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), content: trimmed },
    ]);
  }, []);

  const removeQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((previous) => previous.filter((message) => message.id !== id));
  }, []);

  const updateQueuedMessage = useCallback((id: string, content: string) => {
    setQueuedMessages((previous) =>
      previous.map((message) => message.id === id ? { ...message, content } : message),
    );
  }, []);

  const previousRunActivityRef = useRef<{ readonly runId?: string; readonly responding: boolean }>({ responding: false });
  const queueReadyAfterRunRef = useRef<string | undefined>(undefined);
  const dispatchedQueueAfterRunRef = useRef<string | undefined>(undefined);
  const pinningConversationIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const previousRunActivity = previousRunActivityRef.current;
    const activeRun = currentRun.run;
    previousRunActivityRef.current = {
      runId: activeRun?.runId,
      responding: modelResponding,
    };
    if (!previousRunActivity.responding || modelResponding) return;
    if (activeRun === undefined || activeRun.runId !== previousRunActivity.runId) return;
    queueReadyAfterRunRef.current = activeRun.status === "completed" ? activeRun.runId : undefined;
  }, [currentRun.run, modelResponding]);

  useEffect(() => {
    const readyRunId = queueReadyAfterRunRef.current;
    if (readyRunId === undefined || app.busy) return;
    if (currentRun.run?.runId !== readyRunId) return;
    if (dispatchedQueueAfterRunRef.current === readyRunId) return;
    if (queuedMessages.length === 0) return;
    const next = queuedMessages[0];
    if (next === undefined) return;
    dispatchedQueueAfterRunRef.current = readyRunId;
    queueReadyAfterRunRef.current = undefined;
    setQueuedMessages((previous) => previous.slice(1));
    setGoal(next.content);
    void startTask(next.content);
  }, [app.busy, currentRun.run, queuedMessages, startTask]);

  async function submitDeepInput(explicitGoal?: string): Promise<void> {
    const trimmed = (explicitGoal ?? goal).trim();
    if (trimmed.length === 0) return;
    const epoch = deepOpenEpochRef.current + 1;
    deepOpenEpochRef.current = epoch;
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    if (app.deepBusy) {
      if (activeDeepRunId === undefined) {
        setApp((previous) => ({
          ...previous,
          error: "正在理解你的补充，请稍后再发送。",
        }));
        return;
      }
      setGoal("");
      setAttachments([]);
      setApp((previous) => ({
        ...previous,
        deepPendingGoal: trimmed,
        error: undefined,
      }));
      try {
        await requestDeepRunCorrection(activeDeepRunId, [trimmed]);
        if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;
        setApp((previous) => ({ ...previous, error: undefined }));
        deepRunUpdateController.startPolling(activeDeepRunId);
      } catch (error) {
        if (mountedRef.current && deepOpenEpochRef.current === epoch) {
          setApp((previous) => ({
            ...previous,
            deepPendingGoal: undefined,
            error: errorText(error, "补充 Agent 集群上下文失败。"),
          }));
        }
      }
      return;
    }
    const terminalActiveRunId =
      app.deep !== undefined && isTerminalDeepRunStatus(app.deep.run.status)
        ? app.deep.run.runId
        : undefined;
    const deepConversationId =
      app.deepConversation?.conversationId ??
      app.deep?.conversation?.conversationId ??
      app.deep?.run.conversationId;
    setGoal("");
    setAttachments([]);
    setScreen("chat-active");
    setApp((previous) => ({
      ...previous,
      deepBusy: true,
      deepPendingGoal: trimmed,
      deepActiveRunId: undefined,
      deepSelectedRunId: terminalActiveRunId,
      deepIntakeStatus: undefined,
      error: undefined,
    }));
    try {
      const response = await requestDeepIntake({
        conversationId: deepConversationId,
        activeRunId: terminalActiveRunId,
        message: trimmed,
        aiMode,
        workspaceDirectory: selectedWorkspaceDirectory,
        taskSoilInput: taskSoilInputFromAttachments(attachments),
      });
      if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;
      const conversationSummary = deepConversationSummaryFromView(response.conversation);
      const preservedView = terminalActiveRunId !== undefined && app.deep?.run.runId === terminalActiveRunId
        ? app.deep
        : undefined;
      setApp((previous) => ({
        ...previous,
        deep: preservedView,
        deepConversation: response.conversation,
        deepConversations: upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepIntakeStatus: response.status,
        deepBusy: false,
        deepPendingGoal: undefined,
        deepActiveRunId: undefined,
        deepSelectedRunId: response.status === "plan_ready" ? terminalActiveRunId : undefined,
        error: undefined,
      }));
    } catch (error) {
      if (mountedRef.current && deepOpenEpochRef.current === epoch) {
        setApp((previous) => ({
          ...previous,
          deepBusy: false,
          deepPendingGoal: undefined,
          error: errorText(error, "Agent 集群理解失败。"),
        }));
      }
    }
  }

  async function startConfirmedDeepRun(input: {
    readonly intakeTurnId?: string;
    readonly confirmedObjective: string;
    readonly confirmedPlan: string;
  }): Promise<void> {
    const conversationId = app.deepConversation?.conversationId;
    if (conversationId === undefined || app.deepBusy) {
      return;
    }
    const objective = input.confirmedObjective.trim();
    const plan = input.confirmedPlan.trim();
    if (objective.length === 0 || plan.length === 0) {
      setApp((previous) => ({ ...previous, error: "开始深度研究前需要保留主题和计划。" }));
      return;
    }
    const epoch = deepOpenEpochRef.current + 1;
    deepOpenEpochRef.current = epoch;
    setApp((previous) => ({
      ...previous,
      deepBusy: true,
      deepPendingGoal: objective,
      deepActiveRunId: undefined,
      deepSelectedRunId: undefined,
      error: undefined,
    }));
    try {
      const parentRunStatus = app.deepSelectedRunId === undefined
        ? undefined
        : app.deep?.run.runId === app.deepSelectedRunId
          ? app.deep.run.status
          : app.deepRuns.find((run) => run.runId === app.deepSelectedRunId)?.status;
      const parentRunConversationId = app.deepSelectedRunId === undefined
        ? undefined
        : app.deep?.run.runId === app.deepSelectedRunId
          ? app.deep.run.conversationId
          : app.deepRuns.find((run) => run.runId === app.deepSelectedRunId)?.conversationId;
      const parentRunId =
        app.deepIntakeStatus === "plan_ready" &&
        app.deepSelectedRunId !== undefined &&
        parentRunStatus !== undefined &&
        isTerminalDeepRunStatus(parentRunStatus) &&
        parentRunConversationId === conversationId
          ? app.deepSelectedRunId
          : undefined;
      const response = await requestStartConfirmedDeepRun({
        conversationId,
        parentRunId,
        intakeTurnId: input.intakeTurnId,
        confirmedObjective: objective,
        confirmedPlan: plan,
        aiMode,
        workspaceDirectory: selectedWorkspaceDirectory,
      });
      if (!mountedRef.current || deepOpenEpochRef.current !== epoch) return;
      const conversationSummary = response.conversation === undefined
        ? undefined
        : {
            ...deepConversationSummaryFromView(response.conversation),
            intakeStatus: "running" as const,
          };
      setApp((previous) => ({
        ...previous,
        deep: undefined,
        deepConversation: response.conversation ?? previous.deepConversation,
        deepConversations: conversationSummary === undefined
          ? previous.deepConversations
          : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepIntakeStatus: "running",
        deepBusy: true,
        deepPendingGoal: objective,
        deepActiveRunId: response.run.runId,
        deepSelectedRunId: response.run.runId,
        error: undefined,
      }));
      deepRunUpdateController.startPolling(response.run.runId);
    } catch (error) {
      if (mountedRef.current && deepOpenEpochRef.current === epoch) {
        setApp((previous) => ({
          ...previous,
          deepBusy: false,
          deepPendingGoal: undefined,
          error: errorText(error, "启动深度研究失败。"),
        }));
      }
    }
  }

  async function stopDeepTask(): Promise<void> {
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    const canStop = app.deep?.run.runtimeHealth?.canStop === true || app.deepBusy;
    if (activeDeepRunId === undefined || !canStop) {
      return;
    }
    try {
      const response = await requestDeepRunStop(activeDeepRunId);
      if (!mountedRef.current) return;
      if (response.status === "stopped") {
        const view = response.view;
        const summary = deepRunSummaryFromView(view);
        const conversationSummary = view.conversation === undefined
          ? undefined
          : deepConversationSummaryFromView(view.conversation, summary);
        const intakeStatus = conversationSummary?.intakeStatus;
        setApp((previous) => ({
          ...previous,
          deep: view,
          deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
          deepConversations: conversationSummary === undefined
            ? previous.deepConversations
            : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
          deepConversation: view.conversation ?? previous.deepConversation,
          deepActiveRunId: undefined,
          deepSelectedRunId: view.run.runId,
          deepIntakeStatus: intakeStatus,
          deepPendingGoal: undefined,
          deepBusy: false,
          error: undefined,
        }));
        deepRunUpdateController.stopPolling();
        return;
      }
      setApp((previous) => ({ ...previous, deepBusy: true, error: undefined }));
      deepRunUpdateController.startPolling(activeDeepRunId);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "停止 Agent 集群运行失败。") }));
      }
    }
  }

  async function sendDeepChildMessage(childRunId: string, message: string): Promise<void> {
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    if (activeDeepRunId === undefined || deepChildOperationBusyId !== undefined) {
      return;
    }
    setDeepChildOperationBusyId(childRunId);
    try {
      const response = await requestDeepChildMessage(activeDeepRunId, childRunId, message);
      if (!mountedRef.current) return;
      const view = applyQueuedChildOperationProjection(response);
      const keepBusy = response.status === "queued" || shouldKeepDeepRunBusy(view.run);
      const keepPolling = shouldPollDeepRun(view.run);
      const summary = deepRunSummaryFromView(view);
      const conversationSummary = view.conversation === undefined
        ? undefined
        : deepConversationSummaryFromView(view.conversation, summary);
      const intakeStatus = conversationSummary?.intakeStatus;
      setApp((previous) => ({
        ...previous,
        deep: view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepConversations: conversationSummary === undefined
          ? previous.deepConversations
          : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepActiveRunId: view.run.runId,
        deepSelectedRunId: view.run.runId,
        deepIntakeStatus: intakeStatus,
        deepBusy: keepBusy,
        error: undefined,
      }));
      if (keepPolling) {
        deepRunUpdateController.startPolling(activeDeepRunId);
      } else {
        deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "继续协作项失败。") }));
      }
    } finally {
      if (mountedRef.current) {
        setDeepChildOperationBusyId(undefined);
      }
    }
  }

  async function decideDeepChild(
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ): Promise<void> {
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    if (activeDeepRunId === undefined || deepChildOperationBusyId !== undefined) {
      return;
    }
    setDeepChildOperationBusyId(childRunId);
    try {
      const response = await decideDeepChildConfirmation(
        activeDeepRunId,
        childRunId,
        confirmationId,
        decision,
        guidance,
      );
      if (!mountedRef.current) return;
      const keepBusy = shouldKeepDeepRunBusy(response.view.run);
      const keepPolling = shouldPollDeepRun(response.view.run);
      const summary = deepRunSummaryFromView(response.view);
      const conversationSummary = response.view.conversation === undefined
        ? undefined
        : deepConversationSummaryFromView(response.view.conversation, summary);
      const intakeStatus = conversationSummary?.intakeStatus;
      setApp((previous) => ({
        ...previous,
        deep: response.view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepConversations: conversationSummary === undefined
          ? previous.deepConversations
          : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepActiveRunId: response.view.run.runId,
        deepSelectedRunId: response.view.run.runId,
        deepIntakeStatus: intakeStatus,
        deepBusy: keepBusy,
        error: undefined,
      }));
      if (keepPolling) {
        deepRunUpdateController.startPolling(activeDeepRunId);
      } else {
        deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "处理协作项确认失败。") }));
      }
    } finally {
      if (mountedRef.current) {
        setDeepChildOperationBusyId(undefined);
      }
    }
  }

  async function resynthesizeDeepRun(): Promise<void> {
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    if (activeDeepRunId === undefined || deepResynthesisBusy || deepChildOperationBusyId !== undefined) {
      return;
    }
    setDeepResynthesisBusy(true);
    try {
      const response = await requestDeepRunResynthesis(activeDeepRunId);
      if (!mountedRef.current) return;
      const keepBusy = shouldKeepDeepRunBusy(response.view.run);
      const keepPolling = shouldPollDeepRun(response.view.run);
      const summary = deepRunSummaryFromView(response.view);
      const conversationSummary = response.view.conversation === undefined
        ? undefined
        : deepConversationSummaryFromView(response.view.conversation, summary);
      const intakeStatus = conversationSummary?.intakeStatus;
      setApp((previous) => ({
        ...previous,
        deep: response.view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepConversations: conversationSummary === undefined
          ? previous.deepConversations
          : upsertDeepConversationSummary(previous.deepConversations, conversationSummary),
        deepActiveRunId: response.view.run.runId,
        deepSelectedRunId: response.view.run.runId,
        deepIntakeStatus: intakeStatus,
        deepBusy: keepBusy,
        error: undefined,
      }));
      if (keepPolling) {
        deepRunUpdateController.startPolling(activeDeepRunId);
      } else {
        deepRunUpdateController.stopPolling();
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "重新综合失败。") }));
      }
    } finally {
      if (mountedRef.current) {
        setDeepResynthesisBusy(false);
      }
    }
  }

  const activeInputAgentMode: AgentMode = agentClusterActive ? "deep" : "normal";
  const inputProps = {
    value: goal,
    onChange: setGoal,
    agentMode: activeInputAgentMode,
    attachments,
    selectedWorkspaceDirectory,
    onSelectWorkspaceDirectory: () => void selectTaskWorkspace(),
    onSelectAttachment: () => void selectAttachment(),
    onUploadAttachmentFiles: (files: readonly File[]) => void uploadAttachments(files),
    onRemoveAttachment: removeAttachment,
    contextBusy,
    busy: app.busy,
    models: modelOptions,
    selectedModelId,
    contextUsage,
    reasoningEffort: composerReasoningEffort,
    reasoningEffortEnabled: selectedModelSupportsReasoningEffort,
    onReasoningEffortChange: setComposerReasoningEffort,
    toolConfirmationPolicy,
    onToolConfirmationPolicyChange: changeToolConfirmationPolicy,
    closeSignal: inputCloseSignal,
    onModelSelect: selectInputModel,
    onOpenSettings: () => openSettings("models"),
    onSubmit: () => {
      if (agentClusterActive) {
        void submitDeepInput();
      } else if (app.busy || modelResponding) {
        enqueueMessage(goal);
        setGoal("");
      } else {
        void startTask();
      }
    },
    allowInputWhileBusy: true,
    onCancel: () => {
      queueReadyAfterRunRef.current = undefined;
      setQueuedMessages([]);
      void cancelRun();
    },
  };
  const hasBusyDeepRun = shouldKeepDeepRunBusy(app.deep?.run);
  const hasPendingDeepRunBootstrap = app.deepActiveRunId !== undefined && app.deep === undefined;
  const hasActiveDeepRun = hasBusyDeepRun || hasPendingDeepRunBootstrap;
  const deepInputProps = {
    ...inputProps,
    busy: app.deepBusy && !hasActiveDeepRun,
    running: app.deepBusy && hasActiveDeepRun,
    queuedMessages: undefined,
    onRemoveQueuedMessage: undefined,
    onUpdateQueuedMessage: undefined,
    placeholder: deepInputPlaceholder(
      app.deep?.run.status,
      app.deep?.liveProjection.phase,
      app.deepBusy,
      hasActiveDeepRun,
      app.deepIntakeStatus,
    ),
    onSubmit: () => {
      void submitDeepInput();
    },
    onCancel: () => {
      void stopDeepTask();
    },
    cancelLabel: "停止",
  };

  const isBootstrapping = app.config === undefined && app.conversations.length === 0 && app.error === undefined;
  const deepActive = agentClusterActive;
  const startupIntro = useStartupIntro(isBootstrapping, { startupAnimationEnabled });
  const startupIntroStyle = useMemo(() => {
    const style = startupIntroTimingStyle(startupIntro.timing) as StartupIntroRootStyle;
    if (startupIntro.reveal !== undefined) {
      style["--startup-intro-target-width"] = `${startupIntro.reveal.targetWindow.width}px`;
      style["--startup-intro-target-height"] = `${startupIntro.reveal.targetWindow.height}px`;
      style["--startup-intro-empty-grid-top-padding"] = `${startupIntroEmptyGridTopPadding(startupIntro.reveal.targetWindow.height)}px`;
    }
    return style;
  }, [startupIntro.reveal?.targetWindow.height, startupIntro.reveal?.targetWindow.width, startupIntro.timing]);
  const startupIntroRootStyle = startupIntro.overlayPhase === undefined ? undefined : startupIntroStyle;
  const startupIntroActive = startupIntro.overlayPhase !== undefined && startupIntro.reveal !== undefined;

  return (
      <div
        className="app-root"
        data-startup-intro={startupIntro.overlayPhase}
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
        style={startupIntroRootStyle}
    >
      <Sidebar
        currentScreen={chatScreen}
        conversations={app.conversations}
        deepConversations={app.deepConversations}
        deepRuns={app.deepRuns}
        activeConversationId={agentClusterActive ? undefined : app.conversation?.conversationId}
        activeDeepConversationId={app.deepConversation?.conversationId ?? app.deep?.run.conversationId}
        activeDeepRunId={app.deep?.run.runId ?? app.deepActiveRunId}
        pendingCount={pendingCount}
        collapsed={sidebarCollapsed}
        agentClusterActive={agentClusterActive}
        agentClusterEnabled={agentClusterEnabled}
        pinningConversationIds={pinningConversationIds}
        onNew={openNormalTaskEntry}
        onOpenAgentCluster={openAgentClusterEntry}
        onOpenDeepConversation={(conversationId) => void openAgentClusterConversation(conversationId)}
        onOpenDeepRun={(runId) => void openAgentClusterRun(runId)}
        onOpen={openNormalConversation}
        onRename={(id, title) => void renameConversation(id, title)}
        onRenameDeep={(id, title) => void renameDeepConversation(id, title)}
        onTogglePinned={(id, pinned) => void toggleConversationPinned(id, pinned)}
        onToggleDeepPinned={(id, pinned) => void toggleDeepConversationPinned(id, pinned)}
        onDelete={(id) => void deleteConversation(id)}
        onDeleteDeep={(id) => void deleteDeepConversation(id)}
        onOpenSettings={() => openSettings("models")}
      />

      <div className="app-workbench">
        <WorkbenchHeader
          collapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
        {app.appUpdate?.status === "downloaded" && (
          <div className="app-update-ready-banner" role="status">
            <span>{appUpdateReadyText(app.appUpdate)}</span>
            <button type="button" onClick={() => void installAppUpdate()}>
              重启安装
            </button>
          </div>
        )}
        <main className="app-main">
          {isBootstrapping && (
            <div className="app-bootstrap-loading">
              <div className="app-bootstrap-spinner" />
              <p>正在初始化工作台</p>
            </div>
          )}
          {!isBootstrapping && deepActive && (
            <MultiAgentWorkspace
              view={app.deep}
              conversation={app.deepConversation}
              intakeStatus={app.deepIntakeStatus}
              busy={app.deepBusy || deepChildOperationBusyId !== undefined}
              pendingGoal={app.deepPendingGoal}
              error={app.error}
              inputProps={deepInputProps}
              childOperationBusyId={deepChildOperationBusyId}
              resynthesisBusy={deepResynthesisBusy}
              onStartConfirmedRun={startConfirmedDeepRun}
              onChildMessage={sendDeepChildMessage}
              onChildConfirmation={decideDeepChild}
              onResynthesize={resynthesizeDeepRun}
              onStopRun={stopDeepTask}
            />
          )}
          {!isBootstrapping && !deepActive && chatScreen === "chat-empty" && (
            <ChatEmpty
              {...inputProps}
              autoFocus={!startupIntroActive}
              error={app.error}
            />
          )}
          {!isBootstrapping && !deepActive && chatScreen === "chat-active" && (
            <ChatActive
              {...inputProps}
              conversation={app.conversation}
              run={currentRun.run}
              workView={currentRun.workView}
              transcriptNodes={currentRun.transcriptNodes}
              detail={currentRun.detail}
              live={currentRun.live}
              showModelUsage={modelUsageDisplayEnabled}
              error={app.error}
              pendingConfirmation={pendingConfirmation}
              onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}
              confirmationBusy={confirmationBusy}
              queuedMessages={queuedMessages}
              onRemoveQueuedMessage={removeQueuedMessage}
              onUpdateQueuedMessage={updateQueuedMessage}
            />
          )}
        </main>
      </div>

      {settingsOpen && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initialGroup={settingsGroup}
          config={app.config}
          appUpdate={app.appUpdate}
          modelForm={modelForm}
          setModelForm={setModelForm}
          workspaceDirectory={workspaceDirectory}
          setWorkspaceDirectory={setWorkspaceDirectory}
          desktopAgentSystemPrompt={desktopAgentSystemPrompt}
          setDesktopAgentSystemPrompt={setDesktopAgentSystemPrompt}
          modelUsageDisplayEnabled={modelUsageDisplayEnabled}
          onModelUsageDisplayChange={changeModelUsageDisplay}
          agentClusterEnabled={agentClusterEnabled}
          onAgentClusterEnabledChange={changeAgentClusterEnabled}
          savingModel={savingModel}
          savingWorkspace={savingWorkspace}
          savingDesktopAgent={savingDesktopAgent}
          onSaveModel={saveModelConfig}
          onCreateCustomProfile={createCustomModelProfile}
          onReorderModelProviders={reorderModelProviders}
          onDeleteModelProvider={deleteModelProvider}
          onFetchModels={fetchModelsForProfile}
          onSaveModelCatalog={saveModelCatalog}
          onSaveModelCapabilities={saveModelCapabilities}
          onRevealModelApiKey={revealModelApiKey}
          modelCatalogs={modelCatalogs}
          skills={app.skills}
          subAgents={app.subAgents}
          onSaveWorkspace={(nextWorkspaceDirectory) => void saveWorkspace(nextWorkspaceDirectory)}
          onSelectWorkspaceDirectory={() => void selectWorkspace()}
          onSaveCommandShell={saveCommandShell}
          onSaveDesktopAgentSystemPrompt={saveDesktopAgentSystemPrompt}
          onResetDesktopAgentSystemPrompt={resetDesktopAgentSystemPrompt}
          tools={app.tools}
          toolForm={toolForm}
          setToolForm={setToolForm}
          mcpServerForm={mcpServerForm}
          setMcpServerForm={setMcpServerForm}
          savingTools={savingTools}
          onSaveTools={(nextToolForm) => void saveTools(nextToolForm)}
          onSaveSkillTriggerMode={(mode) => void saveSkillTriggerMode(mode)}
          onSaveMcpServer={saveMcpServer}
          onLoadMcpReferences={loadMcpReferences}
          onImportMcpConfig={(config) => void importMcpConfig(config)}
          onTestMcpServer={(serverId) => void testMcpServer(serverId)}
          onCheckMcpEnvironment={checkMcpEnvironment}
          onInstallMcpEnvironment={installMcpEnvironment}
          onDeleteMcpServer={(serverId) => void deleteMcpServer(serverId)}
          onUpdateMcpTool={(serverId, toolName, enabled, autoApproved) => void updateMcpTool(serverId, toolName, enabled, autoApproved)}
          onCheckAppUpdate={() => void checkAppUpdate()}
          onInstallAppUpdate={() => void installAppUpdate()}
          onRefreshSkills={() => void refreshSkills()}
          onRefreshSubAgents={() => void refreshSubAgents()}
          onUpdateSkill={(skill, enabled) => void updateSkill(skill, enabled)}
        />
      )}
      {startupIntroActive && startupIntro.overlayPhase !== undefined && startupIntro.reveal !== undefined && (
        <StartupIntroOverlay
          phase={startupIntro.overlayPhase}
          timing={startupIntro.timing}
          sidebarCollapsed={sidebarCollapsed}
          reveal={startupIntro.reveal}
        />
      )}
    </div>
  );
}

function conversationPinnedAt(app: AppState, conversationId: string): string | undefined {
  return app.conversation?.conversationId === conversationId
    ? app.conversation.pinnedAt
    : app.conversations.find((conversation) => conversation.conversationId === conversationId)?.pinnedAt;
}

function patchConversationPinnedAt(
  app: AppState,
  conversationId: string,
  pinnedAt: string | undefined
): AppState {
  return {
    ...app,
    conversations: app.conversations.map((conversation) =>
      conversation.conversationId === conversationId
        ? { ...conversation, pinnedAt }
        : conversation
    ),
    conversation: app.conversation?.conversationId === conversationId
      ? { ...app.conversation, pinnedAt }
      : app.conversation,
  };
}

function deepConversationPinnedAt(app: AppState, conversationId: string): string | undefined {
  return app.deepConversation?.conversationId === conversationId
    ? app.deepConversation.pinnedAt
    : app.deepConversations.find((conversation) => conversation.conversationId === conversationId)?.pinnedAt;
}

function patchDeepConversationPinnedAt(
  app: AppState,
  conversationId: string,
  pinnedAt: string | undefined,
): AppState {
  return {
    ...app,
    deepConversations: app.deepConversations.map((conversation) =>
      conversation.conversationId === conversationId
        ? { ...conversation, pinnedAt }
        : conversation
    ),
    deepConversation: app.deepConversation?.conversationId === conversationId
      ? { ...app.deepConversation, pinnedAt }
      : app.deepConversation,
    deep:
      app.deep?.conversation?.conversationId === conversationId
        ? {
          ...app.deep,
          conversation: {
            ...app.deep.conversation,
            pinnedAt,
          },
        }
        : app.deep,
  };
}

function WorkbenchHeader(props: {
  readonly collapsed: boolean;
  readonly onToggleSidebar: () => void;
}): React.ReactElement {
  const toggleLabel = props.collapsed ? "展开侧栏" : "收起侧栏";
  const hasDesktopWindowControls = typeof window !== "undefined" && window.agentarborDesktop !== undefined;

  return (
    <header className="app-workbench-header">
      <div className="app-workbench-header-inner">
        <div className="app-workbench-header-main">
          <button
            type="button"
            className="app-workbench-sidebar-toggle"
            aria-label={toggleLabel}
            onClick={props.onToggleSidebar}
          >
            {props.collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {hasDesktopWindowControls && <DesktopWindowControls />}
      </div>
    </header>
  );
}

function DesktopWindowControls(): React.ReactElement {
  const [windowState, setWindowState] = useState<DesktopWindowState>({
    maximized: false,
    animating: false,
  });

  useEffect(() => {
    const desktop = window.agentarborDesktop;
    if (desktop === undefined) return;
    let mounted = true;
    void desktop.getWindowState().then((nextState) => {
      if (mounted) {
        setWindowState(nextState);
      }
    }).catch(() => undefined);
    const unsubscribe = desktop.onWindowStateChanged((nextState) => {
      setWindowState(nextState);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const maximizeLabel = windowState.maximized ? "还原窗口" : "最大化窗口";
  const MaximizeIcon = windowState.maximized ? Minimize2 : Maximize2;

  return (
    <div className="app-window-controls" aria-label="窗口控制">
      <button
        type="button"
        className="app-window-control"
        aria-label="最小化窗口"
        onClick={() => window.agentarborDesktop?.minimizeWindow()}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="app-window-control"
        aria-label={maximizeLabel}
        aria-pressed={windowState.maximized}
        data-window-state={windowState.maximized ? "maximized" : "normal"}
        data-window-animating={windowState.animating ? "true" : "false"}
        onClick={() => window.agentarborDesktop?.toggleMaximizeWindow()}
      >
        <MaximizeIcon size={14} />
      </button>
      <button
        type="button"
        className="app-window-control app-window-control-close"
        aria-label="关闭窗口"
        onClick={() => window.agentarborDesktop?.closeWindow()}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function appUpdateReadyText(update: AppUpdateInfo): string {
  const version = update.latest?.version;
  return version === undefined || version === "unknown"
    ? "新版本已下载"
    : `新版本 ${version} 已下载`;
}

function startupIntroEmptyGridTopPadding(targetHeight: number): number {
  return Math.round(Math.min(Math.max(targetHeight * 0.16, 112), 154));
}

function deepInputPlaceholder(
  status: DeepRunStatus | undefined,
  phase: DeepLivePhase | undefined,
  busy: boolean,
  hasActiveRun: boolean,
  intakeStatus: "needs_input" | "answered" | "plan_ready" | "running" | undefined,
): string {
  if (busy && !hasActiveRun) {
    return "正在理解...";
  }
  if (intakeStatus === "needs_input") {
    return "补充要求或范围...";
  }
  if (intakeStatus === "answered" && !hasActiveRun) {
    return "继续围绕当前主题补充...";
  }
  if (intakeStatus === "plan_ready" && !hasActiveRun) {
    return "继续调整计划或确认开始...";
  }
  if (!hasActiveRun) {
    return "描述要协作处理的目标...";
  }
  if (busy || status === "running" || status === "pending" || phase === "needs_input") {
    return "补充要求...";
  }
  if (status !== undefined && isTerminalDeepRunStatus(status)) {
    return "继续围绕当前主题补充...";
  }
  return "描述要协作处理的目标...";
}

function applyQueuedChildOperationProjection(response: DeepChildOperationResponse): DeepRunView {
  if (
    response.status !== "queued" ||
    response.childRunId === undefined ||
    response.messageRef === undefined ||
    response.queuedAt === undefined
  ) {
    return response.view;
  }
  const childRunId = response.childRunId;
  const messageRef = response.messageRef;
  const queuedAt = response.queuedAt;
  const queuedCount = response.queuedCount;
  const children = response.view.liveProjection.children.map((child) =>
    child.childRunId === childRunId
      ? {
          ...child,
          parentOperation: {
            status: "queued" as const,
            messageRef,
            queuedCount,
            updatedAt: queuedAt,
          },
          updatedAt: queuedAt,
        }
      : child
  );
  return {
    ...response.view,
    liveProjection: {
      ...response.view.liveProjection,
      activeNodeId: childRunId,
      children,
      updatedAt: queuedAt,
    },
  };
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "agentarbor.panel.sidebar.collapsed";
const AGENT_CLUSTER_ENABLED_STORAGE_KEY = "agentarbor.panel.agent_cluster.enabled";

function loadSidebarCollapsedPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function loadAgentClusterEnabledPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(AGENT_CLUSTER_ENABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistAgentClusterEnabledPreference(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(AGENT_CLUSTER_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Local preference persistence is best-effort only.
  }
}

function persistSidebarCollapsedPreference(collapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Local preference persistence is best-effort only.
  }
}
