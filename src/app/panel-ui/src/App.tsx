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
import { createInitialAppState } from "./app-state";
import { requestDeepIntake } from "./app-deep-intake";
import { createDeepRunUpdateController } from "./app-deep-live-updates";
import {
  deepRunSummaryFromView,
  isTerminalDeepRunStatus,
  latestActiveDeepRun,
  latestRestorableDeepRun,
  openDeepRun,
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
        const activeDeepRun = latestActiveDeepRun(bootstrap.deepRuns);
        if (activeDeepRun !== undefined) {
          setScreen("chat-active");
          setInputCloseSignal((value) => value + 1);
          void openAgentClusterRun(activeDeepRun.runId, { auto: true });
        }
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
  const chatScreen = app.agentMode === "deep"
    ? screen
    : screen === "chat-empty" && (app.conversation !== undefined || app.run !== undefined) ? "chat-active" : screen;
  const currentRun = useMemo(() => projectCurrentRun(app), currentRunProjectionDeps(app));
  const hasNormalConversationContext = app.agentMode === "normal" && (app.conversation !== undefined || currentRun.run !== undefined);
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
          currentRun.capabilityResolution?.capabilityPlan.modelCapabilities.contextWindowTokens,
        modelUsage: latestModelUsage,
        ledgerBudget: currentRun.workView?.contextLedger.budget,
      });
    },
    [
      currentRun.capabilityResolution?.capabilityPlan.modelCapabilities.contextWindowTokens,
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
    checkAppUpdate,
    refreshSkills,
    refreshSubAgents,
    updateSkill,
  } = settingsController;

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

  function changeToolConfirmationPolicy(nextPolicy: ComposerToolConfirmationPolicy): void {
    const previousPolicy = toolConfirmationPolicy;
    setToolConfirmationPolicy(nextPolicy);
    void saveToolConfirmationPolicy(nextPolicy)
      .catch(() => {
        if (!mountedRef.current) return;
        setToolConfirmationPolicy(previousPolicy);
      });
  }

  /**
   * 切换 agent 运行模式。
   * 这是模块切换，不是新建任务：普通 Agent 会话和多 Agent 当前任务各自保留。
   */
  function changeAgentMode(nextMode: AgentMode): void {
    const normalized = normalizeAgentMode(nextMode);
    setApp((previous) => {
      if (previous.agentMode === normalized) return previous;
      return { ...previous, agentMode: normalized, error: undefined };
    });
  }

  function selectAgentMode(nextMode: AgentMode): void {
    if (app.agentMode === nextMode) {
      return;
    }
    if (nextMode === "deep") {
      openAgentClusterEntry();
      return;
    }
    openNormalAgentEntry();
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
      const terminal = isTerminalDeepRunStatus(view.run.status);
      const summary = deepRunSummaryFromView(view);
      setSelectedWorkspaceDirectory(view.run.workspaceFolder?.path);
      setApp((previous) => ({
        ...previous,
        agentMode: "deep",
        deep: view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepActiveRunId: view.run.runId,
        deepSelectedRunId: view.run.runId,
        deepPendingGoal: undefined,
        deepConversation: view.conversation ?? previous.deepConversation,
        deepIntakeStatus: undefined,
        deepBusy: !terminal,
        error: undefined,
      }));
      if (!terminal) {
        deepRunUpdateController.startPolling(view.run.runId);
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
          options?.auto === true ? "恢复多 Agent 运行失败。" : "打开多 Agent 运行失败。",
        ),
      }));
    }
  }

  function openAgentClusterEntry(): void {
    setInputCloseSignal((value) => value + 1);
    setScreen("chat-empty");
    setGoal("");
    setAttachments([]);
    const existingRunId = app.deep?.run.runId ?? app.deepSelectedRunId;
    const restorableRunId = existingRunId ?? latestRestorableDeepRun(app.deepRuns)?.runId;
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

  function openCurrentModeTaskEntry(): void {
    if (app.agentMode !== "deep") {
      openNormalTaskEntry();
      return;
    }
    deepRunUpdateController.stopPolling();
    setInputCloseSignal((value) => value + 1);
    setScreen("chat-empty");
    setGoal("");
    setAttachments([]);
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
    try {
      const response = await updateConversationPinnedState(conversationId, pinned);
      if (!mountedRef.current) return;
      applyConversationManagementResponse(response);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "更新会话置顶失败。") }));
      }
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
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId ?? app.deepSelectedRunId;
    const activeDeepRunStatus = app.deep?.run.status ??
      app.deepRuns.find((run) => run.runId === activeDeepRunId)?.status;
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
      try {
        await requestDeepRunCorrection(activeDeepRunId, [trimmed]);
        if (!mountedRef.current) return;
        setApp((previous) => ({ ...previous, error: undefined }));
        deepRunUpdateController.startPolling(activeDeepRunId);
      } catch (error) {
        if (mountedRef.current) {
          setApp((previous) => ({ ...previous, error: errorText(error, "补充多 Agent 上下文失败。") }));
        }
      }
      return;
    }
    const terminalActiveRunId =
      activeDeepRunId !== undefined &&
      activeDeepRunStatus !== undefined &&
      isTerminalDeepRunStatus(activeDeepRunStatus)
        ? activeDeepRunId
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
      if (!mountedRef.current) return;
      if (response.status === "running") {
        setApp((previous) => ({
          ...previous,
          deep: undefined,
          deepConversation: response.conversation,
          deepIntakeStatus: response.status,
          deepBusy: true,
          deepPendingGoal: trimmed,
          deepActiveRunId: response.run.runId,
          deepSelectedRunId: response.run.runId,
          error: undefined,
        }));
        deepRunUpdateController.startPolling(response.run.runId);
        return;
      }
      setApp((previous) => ({
        ...previous,
        deep: undefined,
        deepConversation: response.conversation,
        deepIntakeStatus: response.status,
        deepBusy: false,
        deepPendingGoal: undefined,
        deepActiveRunId: undefined,
        deepSelectedRunId: undefined,
        error: undefined,
      }));
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({
          ...previous,
          deepBusy: false,
          deepPendingGoal: undefined,
          error: errorText(error, "多 Agent 理解失败。"),
        }));
      }
    }
  }

  async function stopDeepTask(): Promise<void> {
    const activeDeepRunId = app.deep?.run.runId ?? app.deepActiveRunId;
    if (activeDeepRunId === undefined || !app.deepBusy) {
      return;
    }
    try {
      await requestDeepRunStop(activeDeepRunId);
      if (!mountedRef.current) return;
      setApp((previous) => ({ ...previous, deepBusy: true, error: undefined }));
      deepRunUpdateController.startPolling(activeDeepRunId);
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, error: errorText(error, "停止多 Agent 运行失败。") }));
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
      const summary = deepRunSummaryFromView(view);
      setApp((previous) => ({
        ...previous,
        deep: view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepActiveRunId: view.run.runId,
        deepSelectedRunId: view.run.runId,
        deepBusy: response.status === "queued" || !isTerminalDeepRunStatus(view.run.status),
        error: undefined,
      }));
      deepRunUpdateController.startPolling(activeDeepRunId);
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
      const summary = deepRunSummaryFromView(response.view);
      setApp((previous) => ({
        ...previous,
        deep: response.view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepActiveRunId: response.view.run.runId,
        deepSelectedRunId: response.view.run.runId,
        deepBusy: !isTerminalDeepRunStatus(response.view.run.status),
        error: undefined,
      }));
      deepRunUpdateController.startPolling(activeDeepRunId);
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
      const summary = deepRunSummaryFromView(response.view);
      setApp((previous) => ({
        ...previous,
        deep: response.view,
        deepRuns: upsertDeepRunSummary(previous.deepRuns, summary),
        deepActiveRunId: response.view.run.runId,
        deepSelectedRunId: response.view.run.runId,
        deepBusy: !isTerminalDeepRunStatus(response.view.run.status),
        error: undefined,
      }));
      deepRunUpdateController.startPolling(activeDeepRunId);
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

  const inputProps = {
    value: goal,
    onChange: setGoal,
    agentMode: app.agentMode,
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
      if (app.agentMode === "deep") {
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
  const deepInputProps = {
    ...inputProps,
    busy: app.deepBusy && app.deep === undefined && app.deepActiveRunId === undefined,
    running: app.deepBusy && (app.deep !== undefined || app.deepActiveRunId !== undefined),
    queuedMessages: undefined,
    onRemoveQueuedMessage: undefined,
    onUpdateQueuedMessage: undefined,
    placeholder: deepInputPlaceholder(
      app.deep?.run.status,
      app.deep?.liveProjection.phase,
      app.deepBusy,
      app.deep !== undefined || app.deepActiveRunId !== undefined || app.deepSelectedRunId !== undefined,
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
  /** 多 Agent 模式进入专属工作区；是否已有 run 由工作区内部处理。 */
  const deepActive = app.agentMode === "deep";
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
        deepRuns={app.deepRuns}
        activeConversationId={app.agentMode === "deep" ? undefined : app.conversation?.conversationId}
        activeDeepRunId={app.deepSelectedRunId ?? app.deep?.run.runId ?? app.deepActiveRunId}
        pendingCount={pendingCount}
        collapsed={sidebarCollapsed}
        agentClusterActive={app.agentMode === "deep"}
        onNew={openCurrentModeTaskEntry}
        onOpenDeepRun={(runId) => void openAgentClusterRun(runId)}
        onOpen={openNormalConversation}
        onRename={(id, title) => void renameConversation(id, title)}
        onTogglePinned={(id, pinned) => void toggleConversationPinned(id, pinned)}
        onDelete={(id) => void deleteConversation(id)}
        onOpenSettings={() => openSettings("models")}
      />

      <div className="app-workbench">
        <WorkbenchHeader
          collapsed={sidebarCollapsed}
          agentMode={app.agentMode}
          disabled={isBootstrapping || app.busy}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          onModeChange={selectAgentMode}
        />
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
              runs={app.deepRuns}
              activeRunId={app.deepSelectedRunId ?? app.deep?.run.runId ?? app.deepActiveRunId}
              error={app.error}
              inputProps={deepInputProps}
              childOperationBusyId={deepChildOperationBusyId}
              resynthesisBusy={deepResynthesisBusy}
              onChildMessage={sendDeepChildMessage}
              onChildConfirmation={decideDeepChild}
              onResynthesize={resynthesizeDeepRun}
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

function WorkbenchHeader(props: {
  readonly collapsed: boolean;
  readonly agentMode: AgentMode;
  readonly disabled: boolean;
  readonly onToggleSidebar: () => void;
  readonly onModeChange: (mode: AgentMode) => void;
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
          <div className="app-mode-switch" role="tablist" aria-label="工作模式">
            <button
              type="button"
              className={`app-mode-switch-button ${props.agentMode === "normal" ? "active" : ""}`}
              aria-pressed={props.agentMode === "normal"}
              disabled={props.disabled}
              onClick={() => props.onModeChange("normal")}
            >
              桌面 Agent
            </button>
            <button
              type="button"
              className={`app-mode-switch-button ${props.agentMode === "deep" ? "active" : ""}`}
              aria-pressed={props.agentMode === "deep"}
              disabled={props.disabled}
              onClick={() => props.onModeChange("deep")}
            >
              多 Agent
            </button>
          </div>
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

function startupIntroEmptyGridTopPadding(targetHeight: number): number {
  return Math.round(Math.min(Math.max(targetHeight * 0.16, 112), 154));
}

function deepInputPlaceholder(
  status: DeepRunStatus | undefined,
  phase: DeepLivePhase | undefined,
  busy: boolean,
  hasActiveRun: boolean,
  intakeStatus: "needs_input" | "answered" | "running" | undefined,
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
