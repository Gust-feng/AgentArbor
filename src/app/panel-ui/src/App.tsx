import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { isConversationWaitingForUser } from "./conversation-state";
import { ChatActive } from "./components/chat-active";
import { ChatEmpty } from "./components/chat-empty";
import { Sidebar, type Screen } from "./components/sidebar";
import { SettingsDialog, type McpServerForm, type ModelForm, type SettingsGroup, type ToolForm } from "./components/settings-dialog";
import { selectLocalContextAttachment, uniqueAttachments } from "./app-attachments";
import { applyAppBootstrap, loadAppBootstrap } from "./app-bootstrap";
import {
  normalizeVisibleAiMode,
  normalizeComposerToolConfirmationPolicy,
  visibleConfigBaseUrl,
  visibleConfigLabel,
  catalogRecordFromList,
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
import type { ModelCapabilities, ModelProviderModelCatalog } from "./contracts/config";
import type { ContextAttachment } from "./contracts/context";
import type { McpReferenceResponse, McpServerCatalogItem } from "./contracts/tools";
import { modelOptionSupportsReasoningEffort, modelOptionsFromConfig, selectedModelOptionId } from "./model-options";

export function App(): React.ReactElement {
  const [app, setApp] = useState(createInitialAppState);
  const [screen, setScreen] = useState<Screen>("chat-empty");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("models");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsedPreference);
  const [inputCloseSignal, setInputCloseSignal] = useState(0);
  const [goal, setGoal] = useState("");
  const [aiMode, setAiMode] = useState<VisibleAiMode>("openai-responses");
  const [modelForm, setModelForm] = useState<ModelForm>({
    profileId: "",
    label: "",
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
  const [mcpReferences, setMcpReferences] = useState<Readonly<Record<string, McpReferenceResponse>>>({});
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [toolForm, setToolForm] = useState<ToolForm>({
    provider: "tavily",
    tavilyApiKey: "",
    maxResults: "5",
  });
  const [mcpServerForm, setMcpServerForm] = useState<McpServerForm>({
    serverId: "",
    label: "",
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
  const [savingModelCapabilities, setSavingModelCapabilities] = useState(false);
  const [, setSavingWorkspace] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const mountedRef = useRef(true);
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const viewEpochRef = useRef(0);
  const conversationLoadAbortRef = useRef<AbortController | undefined>(undefined);
  const lastActiveProfileIdRef = useRef<string | undefined>(undefined);
  const modelSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
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
        provider: webSearch.provider ?? "tavily",
        tavilyApiKey: "",
        maxResults: String(webSearch.maxResults ?? 5),
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
    mcpToolSaveQueueRef,
    mcpToolUpdateVersionRef,
    mcpToolCatalogDraftRef,
    setSavingModel,
    setSavingModelCapabilities,
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
    saveCommandShell,
    saveToolConfirmationPolicy,
    saveModelCapabilities,
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

  const inputProps = {
    value: goal,
    onChange: setGoal,
    attachments,
    onSelectAttachment: () => void selectAttachment(),
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
      if (app.busy || modelResponding) {
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

  const isBootstrapping = app.config === undefined && app.conversations.length === 0 && app.error === undefined;

  return (
    <div className="app-root" data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}>
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
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
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
        onSaveCommandShell={(kind) => void saveCommandShell(kind)}
        savingModelCapabilities={savingModelCapabilities}
        onSaveModelCapabilities={(capabilities: Partial<ModelCapabilities>) => saveModelCapabilities(capabilities)}
        tools={app.tools}
        toolForm={toolForm}
        setToolForm={setToolForm}
        mcpServerForm={mcpServerForm}
        setMcpServerForm={setMcpServerForm}
        mcpReferences={mcpReferences}
        savingTools={savingTools}
        onSaveTools={() => void saveTools()}
        onSaveMcpServer={saveMcpServer}
        onLoadMcpReferences={(serverId) => loadMcpReferences(serverId).then((references) => {
          setMcpReferences((previous) => ({ ...previous, [serverId]: references }));
        })}
        onImportMcpConfig={(config) => void importMcpConfig(config)}
        onTestMcpServer={(serverId) => void testMcpServer(serverId)}
        onCheckMcpEnvironment={checkMcpEnvironment}
        onInstallMcpEnvironment={installMcpEnvironment}
        onDeleteMcpServer={(serverId) => void deleteMcpServer(serverId)}
        onUpdateMcpTool={(serverId, toolName, enabled, autoApproved) => void updateMcpTool(serverId, toolName, enabled, autoApproved)}
        onRefreshSkills={() => void refreshSkills()}
        onUpdateSkill={(skillId, enabled) => void updateSkill(skillId, enabled)}
      />
    </div>
  );
}

function WorkbenchHeader(props: {
  readonly collapsed: boolean;
  readonly onToggleSidebar: () => void;
}): React.ReactElement {
  const toggleLabel = props.collapsed ? "展开侧栏" : "收起侧栏";

  return (
    <header className="app-workbench-header">
      <div className="app-workbench-header-inner">
        <button
          type="button"
          className="app-workbench-sidebar-toggle"
          aria-label={toggleLabel}
          onClick={props.onToggleSidebar}
        >
          {props.collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </header>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
