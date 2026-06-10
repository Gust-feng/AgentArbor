import React, { useEffect, useMemo, useRef, useState } from "react";
import { isConversationWaitingForUser } from "./conversation-state";
import { ChatActive } from "./components/chat-active";
import { ChatEmpty } from "./components/chat-empty";
import { Sidebar, type Screen } from "./components/sidebar";
import { SettingsDialog, type McpServerForm, type ModelForm, type SettingsGroup, type ToolForm } from "./components/settings-dialog";
import { blockedContextAttachment, previewContextAttachment, uniqueAttachments } from "./app-attachments";
import { applyAppBootstrap, loadAppBootstrap } from "./app-bootstrap";
import {
  normalizeVisibleAiMode,
  visibleConfigBaseUrl,
  visibleConfigLabel,
  catalogRecordFromList,
  type ComposerReasoningEffort,
  type VisibleAiMode,
} from "./app-config-projection";
import { useConversationSummaryRefresh } from "./app-conversation-refresh";
import { createAppSettingsController } from "./app-settings-controller";
import {
  projectCurrentRun,
} from "./app-run-projection";
import { createAppRunController } from "./app-run-controller";
import {
  stopLiveUpdates,
} from "./app-runtime-controls";
import { createInitialAppState } from "./app-state";
import type { ModelProviderModelCatalog } from "./contracts/config";
import type { ContextAttachment } from "./contracts/context";
import type { McpReferenceResponse } from "./contracts/tools";
import { modelOptionsFromConfig, selectedModelOptionId } from "./model-options";

export function App(): React.ReactElement {
  const [app, setApp] = useState(createInitialAppState);
  const [screen, setScreen] = useState<Screen>("chat-empty");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("models");
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
    confirmationMode: "unsafe_only",
    toolExposureMode: "none",
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
  const [attachmentKind, setAttachmentKind] = useState<ContextAttachment["kind"]>("workspace");
  const [attachmentValue, setAttachmentValue] = useState(".");
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [, setSavingWorkspace] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const mountedRef = useRef(true);
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const viewEpochRef = useRef(0);
  const lastActiveProfileIdRef = useRef<string | undefined>(undefined);
  const modelSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useConversationSummaryRefresh({
    conversations: app.conversations,
    setApp,
    mountedRef,
  });

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
        confirmationMode: firstServer.confirmationMode ?? "unsafe_only",
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
  const selectedModelId = useMemo(() => selectedModelOptionId(app.config, modelOptions), [app.config, modelOptions]);
  const selectedModelSupportsReasoningEffort = app.config?.capabilities?.modelCapabilities?.supportsReasoningEffort === true;
  const chatScreen = screen === "chat-empty" && (app.conversation !== undefined || app.run !== undefined) ? "chat-active" : screen;
  const currentRun = projectCurrentRun(app);
  const pendingConfirmation = currentRun.workView?.pendingConfirmation;
  const pendingConversationCount = app.conversations.filter(isConversationWaitingForUser).length;
  const pendingCount = Math.max(pendingConversationCount, pendingConfirmation === undefined ? 0 : 1);
  const runController = createAppRunController({
    app,
    setApp,
    setScreen: (nextScreen) => setScreen(nextScreen),
    setGoal,
    attachments,
    setAttachments,
    goal,
    aiMode,
    composerReasoningEffort,
    selectedModelSupportsReasoningEffort,
    confirmationBusy,
    setConfirmationBusy,
    mountedRef,
    pollTimer,
    streamRef,
    activeRunIdRef,
    viewEpochRef,
  });
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
    setSavingModel,
    setSavingWorkspace,
    setSavingTools,
  });
  const {
    saveModelConfig,
    createCustomModelProfile,
    revealModelApiKey,
    selectComposerModel,
    fetchModelsForProfile,
    saveModelCatalog,
    saveWorkspace,
    saveTools,
    saveMcpServer,
    loadMcpReferences,
    importMcpConfig,
    testMcpServer,
    deleteMcpServer,
    updateMcpTool,
    updateTool,
    updateSkill,
  } = settingsController;

  useEffect(() => {
    if (!selectedModelSupportsReasoningEffort && composerReasoningEffort !== "") {
      setComposerReasoningEffort("");
    }
  }, [composerReasoningEffort, selectedModelId, selectedModelSupportsReasoningEffort]);

  async function addAttachment(): Promise<void> {
    if (contextBusy) return;
    setContextBusy(true);
    try {
      const attachment = await previewContextAttachment({
        kind: attachmentKind,
        value: attachmentValue,
      });
      if (mountedRef.current) {
        setAttachments((previous) => uniqueAttachments([...previous, attachment]));
        setAttachmentValue(attachmentKind === "workspace" ? "." : "");
        setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      const blocked = blockedContextAttachment({
        kind: attachmentKind,
        value: attachmentValue,
        error,
      });
      if (mountedRef.current) {
        setAttachments((previous) => uniqueAttachments([...previous, blocked]));
        setApp((previous) => ({ ...previous, error: blocked.summary }));
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

  const inputProps = {
    value: goal,
    onChange: setGoal,
    attachments,
    attachmentKind,
    attachmentValue,
    onAttachmentKindChange: (kind: ContextAttachment["kind"]) => {
      setAttachmentKind(kind);
      setAttachmentValue(kind === "workspace" ? "." : "");
    },
    onAttachmentValueChange: setAttachmentValue,
    onAddAttachment: () => void addAttachment(),
    onRemoveAttachment: removeAttachment,
    contextBusy,
    busy: app.busy,
    models: modelOptions,
    selectedModelId,
    reasoningEffort: composerReasoningEffort,
    reasoningEffortEnabled: selectedModelSupportsReasoningEffort,
    onReasoningEffortChange: setComposerReasoningEffort,
    closeSignal: inputCloseSignal,
    onModelSelect: (modelId: string) => void selectComposerModel(modelId),
    onOpenSettings: () => openSettings("models"),
    onSubmit: () => void startTask(),
    onCancel: () => void cancelRun(),
  };

  return (
    <div className="app-root">
      <Sidebar
        currentScreen={chatScreen}
        conversations={app.conversations}
        activeConversationId={app.conversation?.conversationId}
        pendingCount={pendingCount}
        onNew={resetChat}
        onOpen={(id) => void loadConversation(id)}
        onOpenSettings={() => openSettings("models")}
      />

      <div className="app-workbench">
        <main className="app-main">
          {chatScreen === "chat-empty" && (
            <ChatEmpty
              {...inputProps}
              error={app.error}
            />
          )}
          {chatScreen === "chat-active" && (
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
        onCreateCustomProfile={() => void createCustomModelProfile()}
        onFetchModels={fetchModelsForProfile}
        onSaveModelCatalog={saveModelCatalog}
        onRevealModelApiKey={revealModelApiKey}
        modelCatalogs={modelCatalogs}
        skills={app.skills}
        onSaveWorkspace={(nextWorkspaceDirectory) => void saveWorkspace(nextWorkspaceDirectory)}
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
        onDeleteMcpServer={(serverId) => void deleteMcpServer(serverId)}
        onUpdateMcpTool={(serverId, toolName, enabled) => void updateMcpTool(serverId, toolName, enabled)}
        onUpdateTool={(toolName, enabled) => void updateTool(toolName, enabled)}
        onUpdateSkill={(skillId, enabled) => void updateSkill(skillId, enabled)}
      />
    </div>
  );
}
