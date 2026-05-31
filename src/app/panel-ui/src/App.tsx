import React, { useEffect, useMemo, useRef, useState } from "react";
import { getJson, postJson } from "./api";
import { isConversationWaitingForUser } from "./conversation-state";
import { ChatActive } from "./components/chat-active";
import { ChatEmpty } from "./components/chat-empty";
import { Sidebar, type Screen } from "./components/sidebar";
import { TopBar } from "./components/topbar";
import { SettingsDialog, SkillsPage, ToolsPage, type SettingsGroup } from "./components/workspace-pages";
import { modelProviderDisplayName, resolveModelProviderIdentity } from "./model-provider-logos";
import {
  appendLiveRunEvent,
  appendLiveRunEvents,
  emptyLiveRun,
  isLiveAppendOnlyEvent,
  type LiveRunBuffer,
} from "../../panel-ui-live-run-buffer";
import {
  mergeEvents,
  openBasicRunStream,
  safeBasicEvents,
  safeBasicRun,
  safeConversation,
  safeDesktopDetail,
  safeWorkSession,
} from "./runtime";
import type {
  BasicAgentRun,
  ConfigResponse,
  Conversation,
  ConversationSummary,
  ContextAttachment,
  DesktopRunDetail,
  DesktopWorkSession,
  ModelProviderModelCatalog,
  TranscriptNode,
  RunEvent,
  SkillDefinition,
  ToolsResponse,
} from "./types";
import { modelOptionsFromConfig, parseModelOptionId, selectedModelOptionId } from "./model-options";
import { terminalStatuses } from "./ui-state";

type AppState = {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly skills: readonly SkillDefinition[];
  readonly conversations: readonly ConversationSummary[];
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly events: readonly RunEvent[];
  readonly live?: LiveRunBuffer;
  readonly detail?: DesktopRunDetail;
  readonly busy: boolean;
  readonly error?: string;
};

type CurrentRunProjection = {
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly detail?: DesktopRunDetail;
  readonly live?: LiveRunBuffer;
  readonly events: readonly RunEvent[];
  readonly transcriptNodes: readonly TranscriptNode[];
};

type ModelForm = {
  readonly profileId: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly protocolKind: string;
  readonly model: string;
  readonly apiKey: string;
  readonly apiKeyCleared: boolean;
};

type ComposerReasoningEffort = "" | "low" | "medium" | "high";

type ToolForm = {
  readonly provider: string;
  readonly tavilyApiKey: string;
  readonly maxResults: string;
};

type VisibleAiMode = "none" | "fake" | "openai-compatible" | "openai-responses";

export function App(): React.ReactElement {
  const [app, setApp] = useState<AppState>({
    skills: [],
    conversations: [],
    transcriptNodes: [],
    events: [],
    busy: false,
  });
  const [screen, setScreen] = useState<Screen>("chat-empty");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("general");
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
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [toolForm, setToolForm] = useState<ToolForm>({
    provider: "tavily",
    tavilyApiKey: "",
    maxResults: "5",
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
  const currentRunId = app.run?.runId;

  useEffect(() => {
    void refreshBootstrap();
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
    if (app.config?.modelCatalogs !== undefined) {
      setModelCatalogs(catalogRecordFromList(app.config.modelCatalogs));
    }
  }, [app.config?.modelCatalogs]);

  const modelOptions = useMemo(() => modelOptionsFromConfig(app.config, modelCatalogs), [app.config, modelCatalogs]);
  const selectedModelId = useMemo(() => selectedModelOptionId(app.config, modelOptions), [app.config, modelOptions]);
  const selectedModelSupportsReasoningEffort = app.config?.capabilities?.modelCapabilities?.supportsReasoningEffort === true;
  const chatScreen = screen === "chat-empty" && (app.conversation !== undefined || app.run !== undefined) ? "chat-active" : screen;
  const currentRun = projectCurrentRun(app);
  const pendingConfirmation = currentRun.workSession?.pendingConfirmation ?? currentRun.detail?.canvas?.agent?.pendingConfirmation;
  const pendingConversationCount = app.conversations.filter(isConversationWaitingForUser).length;
  const pendingCount = Math.max(pendingConversationCount, pendingConfirmation === undefined ? 0 : 1);

  useEffect(() => {
    if (!selectedModelSupportsReasoningEffort && composerReasoningEffort !== "") {
      setComposerReasoningEffort("");
    }
  }, [composerReasoningEffort, selectedModelId, selectedModelSupportsReasoningEffort]);

  async function refreshBootstrap(): Promise<void> {
    const [config, tools, skills, conversations] = await Promise.all([
      getJson<ConfigResponse>("/api/config"),
      getJson<ToolsResponse>("/api/config/tools"),
      getJson<{ readonly skills: readonly SkillDefinition[] }>("/api/skills"),
      getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations"),
    ]);
    setApp((previous) => ({
      ...previous,
      config,
      tools,
      skills: skills.skills ?? [],
      conversations: conversations.conversations ?? [],
    }));
  }

  async function loadConversation(conversationId: string): Promise<void> {
    const epoch = viewEpochRef.current + 1;
    viewEpochRef.current = epoch;
    stopPolling(pollTimer);
    stopStream(streamRef);
    setScreen("chat-active");
    setAttachments([]);
    const response = await getJson<{ readonly conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`);
    const latestRunId = response.conversation.activeRunId ?? response.conversation.latestRunId;
    activeRunIdRef.current = latestRunId;
    const detail = latestRunId === undefined ? undefined : await safeDesktopDetail(latestRunId);
    const run = latestRunId === undefined ? undefined : await safeBasicRun(latestRunId);
    const replay = latestRunId === undefined ? undefined : await safeBasicEvents(latestRunId, 0);
    const workSession = latestRunId === undefined ? undefined : await safeWorkSession(latestRunId);
    if (!mountedRef.current || viewEpochRef.current !== epoch) return;
    setApp((previous) => ({
      ...previous,
      conversation: response.conversation,
      run,
      workSession,
      detail,
      transcriptNodes: transcriptNodesFrom(workSession, detail),
      events: replay?.events ?? [],
      live: undefined,
      error: undefined,
    }));
    if (run !== undefined && shouldKeepRefreshing(run.status)) {
      startLiveUpdates(run.runId, run.eventCursor.lastSequence);
    }
  }

  async function startTask(explicitGoal?: string): Promise<void> {
    const trimmed = (explicitGoal ?? goal).trim();
    if (trimmed.length === 0 || app.busy) return;
    const epoch = viewEpochRef.current + 1;
    viewEpochRef.current = epoch;
    stopPolling(pollTimer);
    stopStream(streamRef);
    activeRunIdRef.current = undefined;
    setScreen("chat-active");
    setApp((previous) => ({
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
        app.conversation?.conversationId === undefined
          ? "/api/conversations"
          : `/api/conversations/${encodeURIComponent(app.conversation.conversationId)}/messages`;
      const response = await postJson<{
        readonly conversation: Conversation;
        readonly run: { readonly runId: string };
      }>(path, {
        goal: trimmed,
        runMode: "agent",
        aiMode,
        taskSoilInput: taskSoilInputFromAttachments(attachments),
        ...runReasoningSettings(composerReasoningEffort, selectedModelSupportsReasoningEffort),
      });
      setGoal("");
      setAttachments([]);
      const run = await safeBasicRun(response.run.runId);
      const workSession = await safeWorkSession(response.run.runId);
      if (!mountedRef.current || viewEpochRef.current !== epoch) return;
      activeRunIdRef.current = response.run.runId;
      setApp((previous) => ({
        ...previous,
        busy: false,
        conversation: response.conversation,
        run,
        workSession,
        transcriptNodes: transcriptNodesFrom(workSession, undefined),
        events: [],
        live: emptyLiveRun(response.run.runId),
        detail: undefined,
      }));
      startLiveUpdates(response.run.runId, 0);
      void refreshConversations();
    } catch (error) {
      if (!mountedRef.current || viewEpochRef.current !== epoch) return;
      setApp((previous) => ({
        ...previous,
        busy: false,
        error: `系统错误：${error instanceof Error ? error.message : "任务启动失败。"}`,
      }));
    }
  }

  async function refreshConversations(): Promise<void> {
    const response = await getJson<{ readonly conversations: readonly ConversationSummary[] }>("/api/conversations");
    setApp((previous) => ({ ...previous, conversations: response.conversations ?? [] }));
  }

  function startPolling(runId: string, cursor: number): void {
    stopPolling(pollTimer);
    stopStream(streamRef);
    let lastSequence = cursor;
    const tick = async (): Promise<void> => {
      if (activeRunIdRef.current !== runId) return;
      try {
        const [runResponse, eventsResponse, workSessionResponse] = await Promise.all([
          getJson<{ readonly run: BasicAgentRun }>(`/api/basic-agent/runs/${encodeURIComponent(runId)}`),
          getJson<{
            readonly events: readonly RunEvent[];
            readonly cursor: { readonly lastSequence: number };
          }>(`/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=${lastSequence}`),
          safeWorkSession(runId),
        ]);
        lastSequence = eventsResponse.cursor.lastSequence;
        if (mountedRef.current && activeRunIdRef.current === runId) {
          setApp((previous) => ({
            ...previous,
            run: runResponse.run,
            workSession: nextWorkSessionForRun(runId, workSessionResponse, previous.workSession),
            live: appendLiveRunEvents(runId, previous.live, eventsResponse.events),
            transcriptNodes: transcriptNodesFrom(
              nextWorkSessionForRun(runId, workSessionResponse, previous.workSession),
              detailForRun(runId, previous.detail)
            ),
            events: mergeEvents(previous.events, eventsResponse.events),
          }));
        }
        if (terminalStatuses.has(runResponse.run.status) || runResponse.run.status === "approval_needed" || runResponse.run.status === "needs_input") {
          const [detail, conversation] = await Promise.all([
            safeDesktopDetail(runId),
            runResponse.run.conversationId === undefined ? undefined : safeConversation(runResponse.run.conversationId),
          ]);
          mountedRef.current && activeRunIdRef.current === runId && setApp((previous) => ({
            ...previous,
            detail,
            conversation: conversation ?? previous.conversation,
            live: undefined,
            workSession: nextWorkSessionForRun(runId, workSessionResponse, previous.workSession),
            transcriptNodes: transcriptNodesFrom(nextWorkSessionForRun(runId, workSessionResponse, previous.workSession), detail),
          }));
          if (!shouldKeepRefreshing(runResponse.run.status)) {
            stopPolling(pollTimer);
            void refreshConversations();
          }
        }
      } catch (error) {
        mountedRef.current && activeRunIdRef.current === runId && setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "刷新运行状态失败。"}`,
        }));
      }
    };
    void tick();
    pollTimer.current = window.setInterval(() => void tick(), 1_200);
  }

  function startLiveUpdates(runId: string, cursor: number): void {
    stopLiveUpdates(pollTimer, streamRef);
    activeRunIdRef.current = runId;
    let lastSequence = cursor;
    const refreshAfterEvent = async (event: RunEvent): Promise<void> => {
      if (activeRunIdRef.current !== runId) return;
      lastSequence = Math.max(lastSequence, event.sequence);
      if (isLiveAppendOnlyEvent(event)) {
        if (mountedRef.current && activeRunIdRef.current === runId) {
          setApp((previous) => ({
            ...previous,
            live: appendLiveRunEvent(runId, previous.live, event),
            events: mergeEvents(previous.events, [event]),
          }));
        }
        return;
      }
      const [run, workSession] = await Promise.all([
        safeBasicRun(runId),
        safeWorkSession(runId),
      ]);
      if (mountedRef.current && activeRunIdRef.current === runId) {
        setApp((previous) => ({
          ...previous,
          run: run ?? previous.run,
          live: appendLiveRunEvent(runId, previous.live, event),
          workSession: nextWorkSessionForRun(runId, workSession, previous.workSession),
          transcriptNodes: transcriptNodesFrom(
            nextWorkSessionForRun(runId, workSession, previous.workSession),
            detailForRun(runId, previous.detail)
          ),
          events: mergeEvents(previous.events, [event]),
        }));
      }
      if (run !== undefined && !shouldKeepRefreshing(run.status)) {
        stopStream(streamRef);
        const [detail, conversation] = await Promise.all([
          safeDesktopDetail(runId),
          run.conversationId === undefined ? undefined : safeConversation(run.conversationId),
        ]);
        mountedRef.current && activeRunIdRef.current === runId && setApp((previous) => ({
          ...previous,
          detail,
          conversation: conversation ?? previous.conversation,
          live: undefined,
          workSession: nextWorkSessionForRun(runId, workSession, previous.workSession),
          transcriptNodes: transcriptNodesFrom(nextWorkSessionForRun(runId, workSession, previous.workSession), detail),
        }));
        void refreshConversations();
      }
    };
    const fallback = (): void => {
      if (pollTimer.current === undefined) {
        startPolling(runId, lastSequence);
      }
    };
    const stream = openBasicRunStream({
      runId,
      cursor,
      onEvent: (event) => void refreshAfterEvent(event),
      onError: fallback,
    });
    if (stream === undefined) {
      startPolling(runId, cursor);
      return;
    }
    streamRef.current = stream;
  }

  async function cancelRun(): Promise<void> {
    if (currentRunId === undefined) return;
    const response = await postJson<{ readonly run: BasicAgentRun }>(`/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/cancel`, {});
    const workSession = await safeWorkSession(currentRunId);
    stopLiveUpdates(pollTimer, streamRef);
    activeRunIdRef.current = currentRunId;
    setApp((previous) => ({
      ...previous,
      run: response.run,
      live: undefined,
      workSession: nextWorkSessionForRun(currentRunId, workSession, previous.workSession),
      transcriptNodes: transcriptNodesFrom(nextWorkSessionForRun(currentRunId, workSession, previous.workSession), detailForRun(currentRunId, previous.detail)),
    }));
    void refreshConversations();
  }

  async function decideConfirmation(decision: "approve_once" | "deny" | "guidance", guidance?: string): Promise<void> {
    const active = projectCurrentRun(app);
    const confirmation = active.workSession?.pendingConfirmation ?? active.detail?.canvas?.agent?.pendingConfirmation;
    if (currentRunId === undefined || confirmation === undefined || confirmationBusy) return;
    if (decision === "approve_once" && confirmation.resumeAvailability === "lost_after_restart") {
      setApp((previous) => ({
        ...previous,
        error: "系统错误：应用重启后无法继续原危险操作。请补充指导或重新发起后续任务。",
      }));
      return;
    }
    if (decision === "guidance" && (guidance ?? "").trim().length === 0) {
      setApp((previous) => ({ ...previous, error: "系统错误：请先输入补充指导，再提交。" }));
      return;
    }
    setConfirmationBusy(true);
    setApp((previous) => ({ ...previous, error: undefined }));

    try {
      const response = await postJson<{ readonly run: BasicAgentRun }>(
        `/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/confirmations/${encodeURIComponent(confirmation.confirmationId)}/decision`,
        { decision, guidance: guidance?.trim() }
      );
      const [workSession, detail] = await Promise.all([
        safeWorkSession(currentRunId),
        safeDesktopDetail(currentRunId),
      ]);
      setApp((previous) => ({
        ...previous,
        run: response.run,
        workSession,
        detail,
        live: decision === "approve_once" ? emptyLiveRun(currentRunId) : previous.live,
        transcriptNodes: transcriptNodesFrom(workSession, detail),
        error: decision === "approve_once" ? "已提交确认，正在继续处理。" : undefined,
      }));
      if (decision === "approve_once") {
        startLiveUpdates(currentRunId, response.run.eventCursor.lastSequence);
      }
    } catch (error) {
      setApp((previous) => ({
        ...previous,
        error: `系统错误：${error instanceof Error ? error.message : "提交确认失败，请重试。"}`,
      }));
    } finally {
      setConfirmationBusy(false);
    }
  }

  async function saveModelConfig(nextModelForm: ModelForm = modelForm): Promise<void> {
    const save = modelSaveQueueRef.current
      .catch(() => undefined)
      .then(() => persistModelConfig(nextModelForm));
    modelSaveQueueRef.current = save.catch(() => undefined);
    await save;
  }

  async function persistModelConfig(nextModelForm: ModelForm): Promise<void> {
    setSavingModel(true);
    try {
      const existingProfile = app.config?.profiles?.some((profile) => profile.profileId === nextModelForm.profileId) === true;
      const preset = existingProfile
        ? undefined
        : app.config?.modelProviderMarket?.presets?.find((item) => item.presetId === nextModelForm.profileId);
      if (preset !== undefined) {
        const created = await postJson<ConfigResponse>("/api/config/model-profiles", {
          profileId: preset.presetId,
          label: nextModelForm.label.trim() || preset.label,
          providerKind: preset.providerKind,
          protocolKind: nextModelForm.protocolKind || preset.protocolKind,
          baseUrl: nextModelForm.baseUrl || preset.baseUrl,
          model: nextModelForm.model,
          clearModel: nextModelForm.model.trim().length === 0,
          apiKey: nextModelForm.apiKeyCleared ? undefined : nextModelForm.apiKey,
          defaultAiMode: aiMode,
        });
        const activated = mergeConfigResponse(
          created,
          await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(preset.presetId)}/activate`, {})
        );
        if (mountedRef.current) {
          setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, activated) }));
          setModelForm((previous) => ({
            ...previous,
            apiKey: nextModelForm.apiKeyCleared ? "" : previous.apiKey,
            apiKeyCleared: false,
          }));
        }
        return;
      }
      const updated = await postJson<ConfigResponse>("/api/config/model-provider", {
        profileId: nextModelForm.profileId,
        label: nextModelForm.label,
        baseUrl: nextModelForm.baseUrl,
        protocolKind: nextModelForm.protocolKind,
        model: nextModelForm.model,
        clearModel: nextModelForm.model.trim().length === 0,
        apiKey: nextModelForm.apiKeyCleared ? undefined : nextModelForm.apiKey,
        clearApiKey: nextModelForm.apiKeyCleared,
        defaultAiMode: aiMode,
      });
      const response =
        nextModelForm.profileId.length > 0 && app.config?.config?.profileId !== nextModelForm.profileId
          ? mergeConfigResponse(
              updated,
              await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(nextModelForm.profileId)}/activate`, {})
            )
          : updated;
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, response) }));
        setModelForm((previous) => ({
          ...previous,
          apiKey: nextModelForm.apiKeyCleared ? "" : previous.apiKey,
          apiKeyCleared: false,
        }));
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "模型服务保存失败。"}`,
        }));
      }
      throw error;
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function createCustomModelProfile(): Promise<void> {
    const label = modelForm.label.trim() || "自定义厂商";
    setSavingModel(true);
    try {
      const created = await postJson<ConfigResponse>("/api/config/model-profiles", {
        profileId: label,
        label,
        providerKind: "openai_compatible",
        protocolKind: modelForm.protocolKind || "openai_compatible_chat_completions",
        baseUrl: modelForm.baseUrl,
        model: modelForm.model,
        clearModel: modelForm.model.trim().length === 0,
        defaultAiMode: aiMode,
        apiKey: modelForm.apiKey,
      });
      const profileId = created.profile?.profileId ?? created.config?.profileId ?? label;
      const activatedOnly = await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(profileId)}/activate`, {});
      const activated = mergeConfigResponse(created, activatedOnly);
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, activated) }));
        setModelForm((previous) => ({ ...previous, apiKey: "", apiKeyCleared: false }));
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function revealModelApiKey(profileId: string): Promise<string | undefined> {
    try {
      const response = await getJson<{ readonly apiKey?: string }>(
        `/api/config/model-profiles/${encodeURIComponent(profileId)}/api-key`
      );
      return typeof response.apiKey === "string" ? response.apiKey : undefined;
    } catch (error) {
      setApp((previous) => ({
        ...previous,
        error: `系统错误：${error instanceof Error ? error.message : "API Key 读取失败。"}`,
      }));
      throw error;
    }
  }

  async function selectComposerModel(modelOptionId: string): Promise<void> {
    const parsed = parseModelOptionId(modelOptionId);
    if (parsed === undefined) return;
    const profile = app.config?.profiles?.find((item) => item.profileId === parsed.profileId);
    if (profile === undefined) return;
    setSavingModel(true);
    try {
      const updated = await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(parsed.profileId)}`, {
        model: parsed.modelId,
        defaultAiMode: aiMode,
      });
      const activated =
        app.config?.config?.profileId === parsed.profileId
          ? updated
          : mergeConfigResponse(updated, await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(parsed.profileId)}/activate`, {}));
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, activated) }));
        setModelForm({
          profileId: parsed.profileId,
          label: profile.label ?? parsed.profileId,
          baseUrl: profile.baseUrl ?? "",
          protocolKind: profile.protocolKind ?? "openai_compatible_chat_completions",
          model: parsed.modelId,
          apiKey: "",
          apiKeyCleared: false,
        });
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function fetchModelsForProfile(profileId = app.config?.config?.profileId): Promise<ModelProviderModelCatalog | undefined> {
    if (profileId === undefined) return undefined;
    setSavingModel(true);
    try {
      const response = await getJson<{
        readonly catalog: ModelProviderModelCatalog;
        readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
      }>(
        `/api/config/model-profiles/${encodeURIComponent(profileId)}/models`
      );
      if (mountedRef.current) {
        const catalogs = response.modelCatalogs ?? app.config?.modelCatalogs;
        if (catalogs !== undefined) {
          setModelCatalogs(catalogRecordFromList(catalogs));
          setApp((previous) => ({
            ...previous,
            config: mergeConfigResponse(previous.config, { modelCatalogs: catalogs }),
          }));
        }
      }
      return response.catalog;
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "模型列表获取失败。"}`,
        }));
      }
      return undefined;
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function saveModelCatalog(profileId: string, catalog: ModelProviderModelCatalog): Promise<void> {
    setSavingModel(true);
    try {
      const response = await postJson<{
        readonly catalog: ModelProviderModelCatalog;
        readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
      }>(`/api/config/model-profiles/${encodeURIComponent(profileId)}/model-catalog`, {
        label: catalog.label,
        baseUrl: catalog.baseUrl,
        modelsPath: catalog.modelsPath,
        fetchedAt: catalog.fetchedAt,
        models: catalog.models,
      });
      if (mountedRef.current) {
        const catalogs = response.modelCatalogs ?? [response.catalog];
        setModelCatalogs(catalogRecordFromList(catalogs));
        setApp((previous) => ({
          ...previous,
          config: mergeConfigResponse(previous.config, { modelCatalogs: catalogs }),
        }));
      }
    } catch (error) {
      if (mountedRef.current) {
        setApp((previous) => ({
          ...previous,
          error: `系统错误：${error instanceof Error ? error.message : "模型保存失败。"}`,
        }));
      }
      throw error;
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function saveWorkspace(nextWorkspaceDirectory: string = workspaceDirectory): Promise<void> {
    setSavingWorkspace(true);
    try {
      const response = await postJson<{ readonly workspace: { readonly workspaceDirectory?: string } }>("/api/config/workspace", {
        workspaceDirectory: nextWorkspaceDirectory,
      });
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: { ...previous.config, workspace: response.workspace } }));
      }
    } finally {
      if (mountedRef.current) setSavingWorkspace(false);
    }
  }

  async function saveTools(): Promise<void> {
    setSavingTools(true);
    try {
      const response = await postJson<ToolsResponse>("/api/config/tools/web-search", {
        provider: toolForm.provider,
        tavilyApiKey: toolForm.tavilyApiKey,
        maxResults: Number(toolForm.maxResults),
      });
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, tools: response }));
        setToolForm((previous) => ({ ...previous, tavilyApiKey: "" }));
      }
    } finally {
      if (mountedRef.current) setSavingTools(false);
    }
  }

  async function updateTool(toolName: string, enabled: boolean): Promise<void> {
    setSavingTools(true);
    try {
      const response = await postJson<ToolsResponse>(`/api/config/tools/${encodeURIComponent(toolName)}/state`, {
        enabled,
      });
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, tools: response }));
      }
    } finally {
      if (mountedRef.current) setSavingTools(false);
    }
  }

  async function updateSkill(skillId: string, enabled: boolean): Promise<void> {
    const response = await postJson<{ readonly skills: readonly SkillDefinition[] }>(`/api/skills/${encodeURIComponent(skillId)}/state`, {
      enabled,
    });
    setApp((previous) => ({ ...previous, skills: response.skills }));
  }

  async function addAttachment(): Promise<void> {
    if (contextBusy) return;
    setContextBusy(true);
    try {
      const response = await postJson<{ readonly attachment: ContextAttachment }>("/api/context/attachments/preview", {
        kind: attachmentKind,
        value: attachmentValue,
      });
      if (mountedRef.current) {
        setAttachments((previous) => uniqueAttachments([...previous, response.attachment]));
        setAttachmentValue(attachmentKind === "workspace" ? "." : "");
        setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "上下文暂时不可用。";
      const blocked: ContextAttachment = {
        attachmentId: `blocked:${attachmentKind}:${attachmentValue}:${Date.now()}`,
        kind: attachmentKind,
        ref: attachmentValue,
        title: attachmentKind === "web" ? "网页不可用" : "上下文不可用",
        summary: `系统错误：${message}`,
        permissionRefs: [],
        readonlyPreviewMeta: { available: false },
        status: "blocked",
        warning: message,
      };
      if (mountedRef.current) {
        setAttachments((previous) => uniqueAttachments([...previous, blocked]));
        setApp((previous) => ({ ...previous, error: `系统错误：${message}` }));
      }
    } finally {
      if (mountedRef.current) setContextBusy(false);
    }
  }

  function removeAttachment(attachmentId: string): void {
    setAttachments((previous) => previous.filter((attachment) => attachment.attachmentId !== attachmentId));
  }

  function resetChat(): void {
    viewEpochRef.current += 1;
    stopLiveUpdates(pollTimer, streamRef);
    activeRunIdRef.current = undefined;
    setScreen("chat-empty");
    setGoal("");
    setAttachments([]);
    setApp((previous) => ({
      ...previous,
      conversation: undefined,
      run: undefined,
      workSession: undefined,
      transcriptNodes: [],
      events: [],
      live: undefined,
      detail: undefined,
      error: undefined,
    }));
  }

  function openSettings(group: SettingsGroup = "general"): void {
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
        collapsed={sidebarCollapsed}
        currentScreen={chatScreen}
        conversations={app.conversations}
        activeConversationId={app.conversation?.conversationId}
        pendingCount={pendingCount}
        onNew={resetChat}
        onOpen={(id) => void loadConversation(id)}
        onNavigate={(target) => setScreen(target)}
        onOpenSettings={() => openSettings("general")}
      />

      <div className="app-workbench">
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          run={app.run}
          config={app.config}
          pendingCount={pendingCount}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        />

        <main className="app-main">
          {chatScreen === "chat-empty" && (
            <ChatEmpty
              {...inputProps}
              conversations={app.conversations}
              workspaceDirectory={app.config?.workspace?.workspaceDirectory}
              pendingCount={pendingCount}
              onOpenConversation={(id) => void loadConversation(id)}
              error={app.error}
            />
          )}
          {chatScreen === "chat-active" && (
            <ChatActive
              {...inputProps}
              conversation={app.conversation}
              run={currentRun.run}
              workSession={currentRun.workSession}
              transcriptNodes={currentRun.transcriptNodes}
              detail={currentRun.detail}
              live={currentRun.live}
              error={app.error}
              pendingConfirmation={currentRun.workSession?.pendingConfirmation ?? currentRun.detail?.canvas?.agent?.pendingConfirmation}
              onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}
              confirmationBusy={confirmationBusy}
            />
          )}
          {chatScreen === "skills" && (
            <SkillsPage
              skills={app.skills}
              onUpdateSkill={(id, enabled) => void updateSkill(id, enabled)}
              onStartSkill={(skill) => startSkillChat(skill, setScreen, setGoal)}
            />
          )}
          {chatScreen === "tools" && (
            <ToolsPage
              tools={app.tools}
              toolForm={toolForm}
              setToolForm={setToolForm}
              saving={savingTools}
              onSaveTools={() => void saveTools()}
              onUpdateTool={(name, enabled) => void updateTool(name, enabled)}
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
        onSaveWorkspace={(nextWorkspaceDirectory) => void saveWorkspace(nextWorkspaceDirectory)}
      />
    </div>
  );
}

function stopPolling(ref: React.MutableRefObject<number | undefined>): void {
  if (ref.current !== undefined) {
    window.clearInterval(ref.current);
    ref.current = undefined;
  }
}

function stopStream(ref: React.MutableRefObject<EventSource | undefined>): void {
  ref.current?.close();
  ref.current = undefined;
}

function stopLiveUpdates(
  pollRef: React.MutableRefObject<number | undefined>,
  streamRef: React.MutableRefObject<EventSource | undefined>
): void {
  stopPolling(pollRef);
  stopStream(streamRef);
}

function shouldKeepRefreshing(status: BasicAgentRun["status"]): boolean {
  return status === "queued" || status === "planning" || status === "running";
}

function taskSoilInputFromAttachments(attachments: readonly ContextAttachment[]): {
  readonly contextRefs?: readonly {
    readonly ref: string;
    readonly kind: ContextAttachment["kind"];
    readonly summary?: string;
  }[];
  readonly permissionBoundaryRefs?: readonly string[];
} | undefined {
  const ready = attachments.filter((attachment) => attachment.status === "ready");
  if (ready.length === 0) {
    return undefined;
  }
  return {
    contextRefs: ready.map((attachment) => ({
      ref: attachment.ref,
      kind: attachment.kind,
      summary: attachment.summary,
    })),
    permissionBoundaryRefs: Array.from(new Set(ready.flatMap((attachment) => attachment.permissionRefs))),
  };
}

function uniqueAttachments(attachments: readonly ContextAttachment[]): readonly ContextAttachment[] {
  const seen = new Set<string>();
  const result: ContextAttachment[] = [];
  for (const attachment of attachments) {
    const key = `${attachment.kind}:${attachment.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attachment);
  }
  return result;
}

function startSkillChat(
  skill: SkillDefinition,
  setScreen: (screen: Screen) => void,
  setGoal: (goal: string) => void
): void {
  const trigger = skill.triggers?.[0]?.trim();
  setScreen("chat-empty");
  setGoal(trigger === undefined || trigger.length === 0
    ? `按「${skill.name}」处理当前任务：`
    : `按「${skill.name}」处理当前任务：${trigger}`);
}

function mergeConfigResponse(previous: ConfigResponse | undefined, incoming: ConfigResponse): ConfigResponse {
  return {
    ...previous,
    ...incoming,
    config: incoming.config ?? incoming.profile ?? previous?.config,
    profiles: incoming.profiles ?? previous?.profiles,
    modelProviderMarket: incoming.modelProviderMarket ?? previous?.modelProviderMarket,
    modelCatalogs: incoming.modelCatalogs ?? previous?.modelCatalogs,
    workspace: incoming.workspace ?? previous?.workspace,
    capabilities: incoming.capabilities ?? previous?.capabilities,
  };
}

function normalizeVisibleAiMode(mode: VisibleAiMode | undefined): VisibleAiMode {
  return mode === "none" ||
    mode === "fake" ||
    mode === "openai-compatible" ||
    mode === "openai-responses"
    ? mode
    : "openai-compatible";
}

function transcriptNodesFrom(
  workSession: DesktopWorkSession | undefined,
  detail: DesktopRunDetail | undefined
): readonly TranscriptNode[] {
  return workSession?.transcriptNodes ?? detail?.transcript?.transcriptNodes ?? [];
}

function nextWorkSessionForRun(
  runId: string,
  incoming: DesktopWorkSession | undefined,
  previous: DesktopWorkSession | undefined
): DesktopWorkSession | undefined {
  if (incoming?.run.runId === runId) return incoming;
  if (previous?.run.runId === runId) return previous;
  return undefined;
}

function detailForRun(runId: string, detail: DesktopRunDetail | undefined): DesktopRunDetail | undefined {
  return detail?.runId === runId ? detail : undefined;
}

function projectCurrentRun(app: AppState): CurrentRunProjection {
  const runId = app.run?.runId;
  if (runId === undefined) {
    return { events: [], transcriptNodes: [] };
  }
  const workSession = app.workSession?.run.runId === runId ? app.workSession : undefined;
  const detail = app.detail?.runId === runId ? app.detail : undefined;
  const live = app.live?.runId === runId ? app.live : undefined;
  const events = app.events.filter((event) => event.runId === runId);
  const transcriptNodes = transcriptNodesFrom(workSession, detail).filter((node) => node.runId === runId);
  return {
    run: app.run,
    workSession,
    detail,
    live,
    events,
    transcriptNodes,
  };
}

function visibleConfigLabel(config: NonNullable<ConfigResponse["config"]>): string {
  const identity = resolveModelProviderIdentity({
    title: config.label,
    profileId: config.profileId,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return identity === "unknown" ? config.label ?? "" : modelProviderDisplayName(identity);
}

function visibleConfigBaseUrl(config: NonNullable<ConfigResponse["config"]>): string {
  const baseUrl = config.baseUrl ?? "";
  if (config.profileId === "default" && (baseUrl.length === 0 || baseUrl === "https://api.openai.com")) {
    return "https://api.openai.com/v1";
  }
  return baseUrl;
}

function runReasoningSettings(
  reasoningEffort: ComposerReasoningEffort,
  supportsReasoningEffort: boolean
): { readonly reasoningEffort?: Exclude<ComposerReasoningEffort, ""> } {
  if (!supportsReasoningEffort || reasoningEffort.length === 0) {
    return {};
  }
  return { reasoningEffort: reasoningEffort as Exclude<ComposerReasoningEffort, ""> };
}

function catalogRecordFromList(catalogs: readonly ModelProviderModelCatalog[]): Record<string, ModelProviderModelCatalog> {
  const record: Record<string, ModelProviderModelCatalog> = {};
  for (const catalog of catalogs) {
    if (catalog.profileId.trim().length > 0) {
      record[catalog.profileId] = catalog;
    }
  }
  return record;
}
