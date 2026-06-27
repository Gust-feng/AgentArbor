import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { isConversationWaitingForUser } from "./conversation-state";
import { ChatActive } from "./components/chat-active";
import { ChatEmpty } from "./components/chat-empty";
import { SettingsDialog } from "./components/settings-dialog";
import { Sidebar, type Screen } from "./components/sidebar";
import type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./components/settings-types";
import {
  StartupIntroOverlay,
  startupIntroTimingStyle,
  useStartupIntro,
} from "./app-startup-intro";
import { getStartupAnimationEnabled, subscribeMotionSettingsChanged } from "./app-motion";
import { selectLocalContextAttachment, uniqueAttachments, uploadContextAttachmentFiles } from "./app-attachments";
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
import { createAppRunController } from "./app-run-controller";
import {
  shouldKeepRefreshing,
  stopLiveUpdates,
} from "./app-runtime-controls";
import { createInitialAppState } from "./app-state";
import { submitDeepTask } from "./app-deep-task-submission";
import type { ModelProviderModelCatalog } from "./contracts/config";
import type { ContextAttachment } from "./contracts/context";
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
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<readonly { readonly id: string; readonly content: string }[]>([]);
  const [savingModel, setSavingModel] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const mountedRef = useRef(true);
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const viewEpochRef = useRef(0);
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
  const chatScreen = screen === "chat-empty" && (app.conversation !== undefined || app.run !== undefined) ? "chat-active" : screen;
  const currentRun = useMemo(() => projectCurrentRun(app), currentRunProjectionDeps(app));
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
  const settingsController = createAppSettingsController({
    app,
    setApp,
    aiMode,
    modelForm,
    setModelForm,
    setModelCatalogs,
    workspaceDirectory,
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
    saveWorkspace,
    selectWorkspace,
    saveCommandShell,
    saveToolConfirmationPolicy,
    saveTools,
    saveMcpServer,
    loadMcpReferences,
    importMcpConfig,
    testMcpServer,
    checkMcpEnvironment,
    installMcpEnvironment,
    deleteMcpServer,
    updateMcpTool,
    refreshSkills,
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
   * 切换 agent 运行模式（普通 Agent / Deep）。
   * - 切换到普通 Agent 时清空 deep 运行视图投影与异步状态，避免残留投影干扰普通视图；
   * - 切换到 Deep 时保留普通运行状态，便于用户回切后继续会话。
   * 当前仅做模式状态切换，deep 提交路径与视图由 T3-4c/T3-4d 接入。
   */
  function changeAgentMode(nextMode: AgentMode): void {
    const normalized = normalizeAgentMode(nextMode);
    setApp((previous) => {
      if (previous.agentMode === normalized) return previous;
      if (normalized === "normal") {
        return { ...previous, agentMode: normalized, deep: undefined, deepBusy: false, error: undefined };
      }
      return { ...previous, agentMode: normalized, error: undefined };
    });
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
      resetChat();
      setApp((previous) => ({
        ...previous,
        conversations: (response.conversations ?? previous.conversations).filter((item) => item.conversationId !== conversationId),
        error: undefined,
      }));
    } catch (error) {
      if (mountedRef.current) {
        if (isMissingConversationError(error)) {
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

  /**
   * Deep 任务提交入口：当 agentMode === "deep" 时由 onSubmit 路由调用。
   * 创建独立 deep 会话并启动后台 deep run（FR-001 入口分流）。返回的运行引用
   * 供 T3-4e /view 轮询接入；当前阶段提交后 deepBusy 保持 true，视图区与轮询待 T3-4d/T3-4e。
   */
  async function startDeepTask(explicitGoal?: string): Promise<void> {
    const result = await submitDeepTask(
      {
        app,
        setApp,
        setGoal,
        setScreen,
        setAttachments,
        attachments,
        goal,
        aiMode,
        mountedRef,
      },
      explicitGoal,
    );
    if (result !== undefined) {
      // TODO(T3-4e): 使用 result.runId / result.conversationId 启动 /api/deep/runs/:runId/view 轮询。
    }
  }

  const inputProps = {
    value: goal,
    onChange: setGoal,
    attachments,
    onSelectAttachment: () => void selectAttachment(),
    onUploadAttachmentFiles: (files: readonly File[]) => void uploadAttachments(files),
    onRemoveAttachment: removeAttachment,
    contextBusy,
    busy: app.busy,
    models: modelOptions,
    selectedModelId,
    reasoningEffort: composerReasoningEffort,
    reasoningEffortEnabled: selectedModelSupportsReasoningEffort,
    onReasoningEffortChange: setComposerReasoningEffort,
    toolConfirmationPolicy,
    onToolConfirmationPolicyChange: changeToolConfirmationPolicy,
    closeSignal: inputCloseSignal,
    onModelSelect: selectInputModel,
    onOpenSettings: () => openSettings("models"),
    onSubmit: () => {
      if (app.busy || modelResponding || app.deepBusy) {
        enqueueMessage(goal);
        setGoal("");
      } else if (app.agentMode === "deep") {
        void startDeepTask();
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

  const isBootstrapping = app.config === undefined && app.conversations.length === 0 && app.error === undefined;
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
        activeConversationId={app.conversation?.conversationId}
        pendingCount={pendingCount}
        collapsed={sidebarCollapsed}
        onNew={resetChat}
        onOpen={(id) => void loadConversation(id)}
        onRename={(id, title) => void renameConversation(id, title)}
        onTogglePinned={(id, pinned) => void toggleConversationPinned(id, pinned)}
        onDelete={(id) => void deleteConversation(id)}
        onOpenSettings={() => openSettings("models")}
      />

      <div className="app-workbench">
        <WorkbenchHeader
          collapsed={sidebarCollapsed}
          agentMode={app.agentMode}
          modeDisabled={app.busy || app.deepBusy}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          onChangeAgentMode={changeAgentMode}
        />
        <main className="app-main">
          {isBootstrapping && (
            <div className="app-bootstrap-loading">
              <div className="app-bootstrap-spinner" />
              <p>正在初始化工作台</p>
            </div>
          )}
          {!isBootstrapping && chatScreen === "chat-empty" && (
            <ChatEmpty
              {...inputProps}
              autoFocus={!startupIntroActive}
              error={app.error}
            />
          )}
          {!isBootstrapping && chatScreen === "chat-active" && (
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
          modelForm={modelForm}
          setModelForm={setModelForm}
          workspaceDirectory={workspaceDirectory}
          setWorkspaceDirectory={setWorkspaceDirectory}
          savingModel={savingModel}
          savingWorkspace={savingWorkspace}
          onSaveModel={saveModelConfig}
          onCreateCustomProfile={createCustomModelProfile}
          onReorderModelProviders={reorderModelProviders}
          onDeleteModelProvider={deleteModelProvider}
          onFetchModels={fetchModelsForProfile}
          onSaveModelCatalog={saveModelCatalog}
          onRevealModelApiKey={revealModelApiKey}
          modelCatalogs={modelCatalogs}
          skills={app.skills}
          onSaveWorkspace={(nextWorkspaceDirectory) => void saveWorkspace(nextWorkspaceDirectory)}
          onSelectWorkspaceDirectory={() => void selectWorkspace()}
          onSaveCommandShell={saveCommandShell}
          tools={app.tools}
          toolForm={toolForm}
          setToolForm={setToolForm}
          mcpServerForm={mcpServerForm}
          setMcpServerForm={setMcpServerForm}
          savingTools={savingTools}
          onSaveTools={(nextToolForm) => void saveTools(nextToolForm)}
          onSaveMcpServer={saveMcpServer}
          onLoadMcpReferences={loadMcpReferences}
          onImportMcpConfig={(config) => void importMcpConfig(config)}
          onTestMcpServer={(serverId) => void testMcpServer(serverId)}
          onCheckMcpEnvironment={checkMcpEnvironment}
          onInstallMcpEnvironment={installMcpEnvironment}
          onDeleteMcpServer={(serverId) => void deleteMcpServer(serverId)}
          onUpdateMcpTool={(serverId, toolName, enabled, autoApproved) => void updateMcpTool(serverId, toolName, enabled, autoApproved)}
          onRefreshSkills={() => void refreshSkills()}
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
  readonly modeDisabled: boolean;
  readonly onToggleSidebar: () => void;
  readonly onChangeAgentMode: (nextMode: AgentMode) => void;
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
            title={toggleLabel}
            onClick={props.onToggleSidebar}
          >
            {props.collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="app-workbench-brand" aria-label="AgentArbor">
            <span className="app-workbench-brand-mark" aria-hidden="true">
              <img src="/favicon.svg" alt="" />
            </span>
            <strong>AgentArbor</strong>
          </div>
        </div>
        <div
          className="app-workbench-mode"
          role="group"
          aria-label="运行模式"
          data-agent-mode={props.agentMode}
        >
          <button
            type="button"
            className="app-workbench-mode-option"
            aria-pressed={props.agentMode === "normal"}
            disabled={props.modeDisabled}
            title="普通 Agent：默认连续会话与模型工具主循环"
            onClick={() => props.onChangeAgentMode("normal")}
          >
            普通
          </button>
          <button
            type="button"
            className="app-workbench-mode-option"
            aria-pressed={props.agentMode === "deep"}
            disabled={props.modeDisabled}
            title="Deep：地下认知运行时，目标成形、多路探索与父层综合"
            onClick={() => props.onChangeAgentMode("deep")}
          >
            Deep
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
        title="最小化"
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
        title={maximizeLabel}
        onClick={() => window.agentarborDesktop?.toggleMaximizeWindow()}
      >
        <MaximizeIcon size={14} />
      </button>
      <button
        type="button"
        className="app-window-control app-window-control-close"
        aria-label="关闭窗口"
        title="关闭"
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
