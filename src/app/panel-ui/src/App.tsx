import React, { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "./api";
import { Composer } from "./components/composer";
import { ConversationView } from "./components/conversation";
import { RightInspector } from "./components/right-inspector";
import { Sidebar } from "./components/sidebar";
import { TopBar } from "./components/topbar";
import { SettingsPage, SkillsPage, ToolsPage } from "./components/workspace-pages";
import {
  mergeEvents,
  openBasicRunStream,
  safeBasicEvents,
  safeBasicRun,
  safeConversation,
  safeDesktopDetail,
  typedToolDisplays,
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
  ModelProviderPreset,
  RunEvent,
  SkillDefinition,
  ToolsResponse,
} from "./types";
import { terminalStatuses } from "./ui-state";

type PanelScreen = "chat" | "skills" | "tools" | "settings";

type AppState = {
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly skills: readonly SkillDefinition[];
  readonly conversations: readonly ConversationSummary[];
  readonly conversation?: Conversation;
  readonly run?: BasicAgentRun;
  readonly workSession?: DesktopWorkSession;
  readonly events: readonly RunEvent[];
  readonly detail?: DesktopRunDetail;
  readonly busy: boolean;
  readonly error?: string;
};

export function App(): React.ReactElement {
  const [app, setApp] = useState<AppState>({
    skills: [],
    conversations: [],
    events: [],
    busy: false,
  });
  const [screen, setScreen] = useState<PanelScreen>("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [goal, setGoal] = useState("");
  const [aiMode, setAiMode] = useState<"none" | "fake" | "openai-compatible">("openai-compatible");
  const [modelForm, setModelForm] = useState({ profileId: "", label: "", baseUrl: "", model: "", apiKey: "" });
  const [modelCatalog, setModelCatalog] = useState<ModelProviderModelCatalog | undefined>(undefined);
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [toolForm, setToolForm] = useState({ provider: "tavily", tavilyApiKey: "", maxResults: "5" });
  const [attachments, setAttachments] = useState<readonly ContextAttachment[]>([]);
  const [attachmentKind, setAttachmentKind] = useState<ContextAttachment["kind"]>("workspace");
  const [attachmentValue, setAttachmentValue] = useState(".");
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const mountedRef = useRef(true);
  const pollTimer = useRef<number | undefined>(undefined);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const currentRunId = app.run?.runId;

  useEffect(() => {
    void refreshBootstrap();
    return () => {
      mountedRef.current = false;
      stopLiveUpdates(pollTimer, streamRef);
    };
  }, []);

  useEffect(() => {
    if (app.config?.config !== undefined) {
      setAiMode(normalizeVisibleAiMode(app.config.config.defaultAiMode));
      setModelForm({
        profileId: app.config.config.profileId ?? "",
        label: app.config.config.label ?? "",
        baseUrl: app.config.config.baseUrl ?? "",
        model: app.config.config.model ?? "",
        apiKey: "",
      });
      setModelCatalog(undefined);
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
    stopPolling(pollTimer);
    stopStream(streamRef);
    setAttachments([]);
    const response = await getJson<{ readonly conversation: Conversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`);
    const latestRunId = response.conversation.latestRunId ?? response.conversation.activeRunId;
    const detail = latestRunId === undefined ? undefined : await safeDesktopDetail(latestRunId);
    const run = latestRunId === undefined ? undefined : await safeBasicRun(latestRunId);
    const replay = latestRunId === undefined ? undefined : await safeBasicEvents(latestRunId, 0);
    const workSession = latestRunId === undefined ? undefined : await safeWorkSession(latestRunId);
    setApp((previous) => ({
      ...previous,
      conversation: response.conversation,
      run,
      workSession,
      detail,
      events: replay?.events ?? [],
      error: undefined,
    }));
    if (run !== undefined && shouldKeepRefreshing(run.status)) {
      startLiveUpdates(run.runId, run.eventCursor.lastSequence);
    }
  }

  async function startTask(explicitGoal?: string): Promise<void> {
    const trimmed = (explicitGoal ?? goal).trim();
    if (trimmed.length === 0 || app.busy) return;
    stopPolling(pollTimer);
    stopStream(streamRef);
    setApp((previous) => ({ ...previous, busy: true, error: undefined, events: [], detail: undefined, workSession: undefined }));
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
      });
      setGoal("");
      setAttachments([]);
      const run = await safeBasicRun(response.run.runId);
      const workSession = await safeWorkSession(response.run.runId);
      setApp((previous) => ({
        ...previous,
        busy: false,
        conversation: response.conversation,
        run,
        workSession,
        events: [],
        detail: undefined,
      }));
      startLiveUpdates(response.run.runId, 0);
      void refreshConversations();
    } catch (error) {
      setApp((previous) => ({ ...previous, busy: false, error: error instanceof Error ? error.message : "任务启动失败。" }));
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
        if (mountedRef.current) {
          setApp((previous) => ({
            ...previous,
            run: runResponse.run,
            workSession: workSessionResponse ?? previous.workSession,
            events: mergeEvents(previous.events, eventsResponse.events),
          }));
        }
        if (terminalStatuses.has(runResponse.run.status) || runResponse.run.status === "approval_needed" || runResponse.run.status === "needs_input") {
          const [detail, conversation] = await Promise.all([
            safeDesktopDetail(runId),
            runResponse.run.conversationId === undefined ? undefined : safeConversation(runResponse.run.conversationId),
          ]);
            mountedRef.current && setApp((previous) => ({
              ...previous,
              detail,
              conversation: conversation ?? previous.conversation,
              workSession: workSessionResponse ?? previous.workSession,
            }));
          if (!shouldKeepRefreshing(runResponse.run.status)) {
            stopPolling(pollTimer);
            void refreshConversations();
          }
        }
      } catch (error) {
        mountedRef.current && setApp((previous) => ({ ...previous, error: error instanceof Error ? error.message : "刷新运行状态失败。" }));
      }
    };
    void tick();
    pollTimer.current = window.setInterval(() => void tick(), 1_200);
  }

  function startLiveUpdates(runId: string, cursor: number): void {
    stopLiveUpdates(pollTimer, streamRef);
    let lastSequence = cursor;
    const refreshAfterEvent = async (event: RunEvent): Promise<void> => {
      lastSequence = Math.max(lastSequence, event.sequence);
      const [run, workSession] = await Promise.all([
        safeBasicRun(runId),
        safeWorkSession(runId),
      ]);
      if (mountedRef.current) {
        setApp((previous) => ({
          ...previous,
          run: run ?? previous.run,
          workSession: workSession ?? previous.workSession,
          events: mergeEvents(previous.events, [event]),
        }));
      }
      if (run !== undefined && !shouldKeepRefreshing(run.status)) {
        stopStream(streamRef);
        const [detail, conversation] = await Promise.all([
          safeDesktopDetail(runId),
          run.conversationId === undefined ? undefined : safeConversation(run.conversationId),
        ]);
        mountedRef.current && setApp((previous) => ({
          ...previous,
          detail,
          conversation: conversation ?? previous.conversation,
          workSession: workSession ?? previous.workSession,
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
    setApp((previous) => ({ ...previous, run: response.run, workSession: workSession ?? previous.workSession }));
    void refreshConversations();
  }

  async function decideConfirmation(decision: "approve_once" | "deny" | "guidance", guidance?: string): Promise<void> {
    const confirmation = app.workSession?.pendingConfirmation ?? app.detail?.canvas?.agent?.pendingConfirmation;
    if (currentRunId === undefined || confirmation === undefined || confirmationBusy) return;
    if (decision === "approve_once" && confirmation.resumeAvailability === "lost_after_restart") {
      setApp((previous) => ({
        ...previous,
        error: "应用重启后无法继续原危险操作。请补充指导或重新发起后续任务。",
      }));
      return;
    }
    if (decision === "guidance" && (guidance ?? "").trim().length === 0) {
      setApp((previous) => ({ ...previous, error: "请先输入补充指导，再提交。" }));
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
        error: decision === "approve_once" ? "已提交确认，正在继续处理。" : undefined,
      }));
      if (decision === "approve_once") {
        startLiveUpdates(currentRunId, response.run.eventCursor.lastSequence);
      }
    } catch (error) {
      setApp((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "提交确认失败，请重试。",
      }));
    } finally {
      setConfirmationBusy(false);
    }
  }

  async function saveModelConfig(): Promise<void> {
    setSavingModel(true);
    try {
      const response = await postJson<ConfigResponse>("/api/config/model-provider", {
        profileId: modelForm.profileId,
        label: modelForm.label,
        baseUrl: modelForm.baseUrl,
        model: modelForm.model,
        apiKey: modelForm.apiKey,
        defaultAiMode: aiMode,
      });
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: response }));
        setModelForm((previous) => ({ ...previous, apiKey: "" }));
        setModelCatalog(undefined);
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function createPresetModelProfile(preset: ModelProviderPreset): Promise<void> {
    setSavingModel(true);
    try {
      const response = await postJson<ConfigResponse>("/api/config/model-profiles", {
        profileId: preset.presetId,
        label: preset.label,
        providerKind: preset.providerKind,
        protocolKind: preset.protocolKind,
        baseUrl: preset.baseUrl,
        model: preset.defaultModel,
        defaultAiMode: aiMode,
      }).catch(async () => {
        const activated = await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(preset.presetId)}/activate`, {});
        return { ...activated, profiles: app.config?.profiles, modelProviderMarket: app.config?.modelProviderMarket };
      });
      const activatedOnly =
        response.config?.profileId === preset.presetId
          ? response
          : await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(preset.presetId)}/activate`, {});
      const activated = mergeConfigResponse(response, activatedOnly);
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, activated) }));
        setModelCatalog(undefined);
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function createCustomModelProfile(): Promise<void> {
    const label = modelForm.label.trim() || "自定义模型";
    setSavingModel(true);
    try {
      const created = await postJson<ConfigResponse>("/api/config/model-profiles", {
        profileId: label,
        label,
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: modelForm.baseUrl,
        model: modelForm.model,
        defaultAiMode: aiMode,
        apiKey: modelForm.apiKey,
      });
      const profileId = created.profile?.profileId ?? created.config?.profileId ?? label;
      const activatedOnly = await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(profileId)}/activate`, {});
      const activated = mergeConfigResponse(created, activatedOnly);
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, activated) }));
        setModelForm((previous) => ({ ...previous, apiKey: "" }));
        setModelCatalog(undefined);
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function activateModelProfile(profileId: string): Promise<void> {
    setSavingModel(true);
    try {
      const response = await postJson<ConfigResponse>(`/api/config/model-profiles/${encodeURIComponent(profileId)}/activate`, {});
      if (mountedRef.current) {
        setApp((previous) => ({ ...previous, config: mergeConfigResponse(previous.config, response) }));
        setModelCatalog(undefined);
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function fetchModelsForActiveProfile(): Promise<void> {
    const profileId = app.config?.config?.profileId;
    if (profileId === undefined) return;
    setSavingModel(true);
    try {
      const response = await getJson<{ readonly catalog: ModelProviderModelCatalog }>(
        `/api/config/model-profiles/${encodeURIComponent(profileId)}/models`
      );
      if (mountedRef.current) {
        setModelCatalog(response.catalog);
      }
    } finally {
      if (mountedRef.current) setSavingModel(false);
    }
  }

  async function saveWorkspace(): Promise<void> {
    setSavingWorkspace(true);
    try {
      const response = await postJson<{ readonly workspace: { readonly workspaceDirectory?: string } }>("/api/config/workspace", {
        workspaceDirectory,
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
        summary: message,
        permissionRefs: [],
        readonlyPreviewMeta: { available: false },
        status: "blocked",
        warning: message,
      };
      if (mountedRef.current) {
        setAttachments((previous) => uniqueAttachments([...previous, blocked]));
        setApp((previous) => ({ ...previous, error: message }));
      }
    } finally {
      if (mountedRef.current) setContextBusy(false);
    }
  }

  function removeAttachment(attachmentId: string): void {
    setAttachments((previous) => previous.filter((attachment) => attachment.attachmentId !== attachmentId));
  }

  const pendingConfirmation = app.detail?.canvas?.agent?.pendingConfirmation;

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        conversations={app.conversations}
        activeConversationId={app.conversation?.conversationId}
        onNew={() => {
          stopLiveUpdates(pollTimer, streamRef);
          setGoal("");
          setAttachments([]);
          setApp((previous) => ({ ...previous, conversation: undefined, run: undefined, workSession: undefined, events: [], detail: undefined, error: undefined }));
        }}
        onOpen={(id) => void loadConversation(id)}
        activeScreen={screen}
        onNavigate={setScreen}
      />
      <div className="workbench">
        <TopBar
          run={app.run}
          config={app.config}
          screen={screen}
          sidebarCollapsed={sidebarCollapsed}
          inspectorOpen={false}
          inspectorAvailable={false}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          onToggleInspector={() => {}}
          onOpenSettings={() => setScreen("settings")}
        />
        <main className="workbench-main">
          {screen === "chat" && (
            <div className="flex flex-row h-full min-h-0">
              <section className="session-surface" aria-label="工作会话">
                <ConversationView
                  conversation={app.conversation}
                  run={app.run}
                  workSession={app.workSession}
                  events={app.events}
                  detail={app.detail}
                  error={app.error}
                  pendingConfirmation={pendingConfirmation}
                  attachments={attachments}
                  onSelectSuggestion={setGoal}
                  onReset={() => setApp((previous) => ({ ...previous, error: undefined }))}
                  onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}
                  confirmationBusy={confirmationBusy}
                />
                <Composer
                  value={goal}
                  onChange={setGoal}
                  attachments={attachments}
                  attachmentKind={attachmentKind}
                  attachmentValue={attachmentValue}
                  onAttachmentKindChange={(kind) => {
                    setAttachmentKind(kind);
                    setAttachmentValue(kind === "workspace" ? "." : "");
                  }}
                  onAttachmentValueChange={setAttachmentValue}
                  onAddAttachment={() => void addAttachment()}
                  onRemoveAttachment={removeAttachment}
                  busy={app.busy}
                  contextBusy={contextBusy}
                  run={app.run}
                  onSubmit={() => void startTask()}
                  onCancel={() => void cancelRun()}
                />
              </section>
              <RightInspector
                run={app.run}
                workSession={app.workSession}
                events={app.events}
                detail={app.detail}
                toolDisplays={typedToolDisplays(app.detail)}
              />
            </div>
          )}
          {screen === "skills" && <SkillsPage skills={app.skills} onUpdateSkill={(id, enabled) => void updateSkill(id, enabled)} onStartSkill={(skill) => startSkillChat(skill, setScreen, setGoal)} />}
          {screen === "tools" && (
            <ToolsPage
              tools={app.tools}
              toolForm={toolForm}
              setToolForm={setToolForm}
              saving={savingTools}
              onSaveTools={() => void saveTools()}
              onUpdateTool={(name, enabled) => void updateTool(name, enabled)}
            />
          )}
          {screen === "settings" && (
            <SettingsPage
              config={app.config}
              modelForm={modelForm}
              setModelForm={setModelForm}
              aiMode={normalizeVisibleAiMode(aiMode)}
              setAiMode={(mode) => setAiMode(mode)}
              workspaceDirectory={workspaceDirectory}
              setWorkspaceDirectory={setWorkspaceDirectory}
              savingModel={savingModel}
              savingWorkspace={savingWorkspace}
              onSaveModel={() => void saveModelConfig()}
              onCreatePresetProfile={(preset) => void createPresetModelProfile(preset)}
              onCreateCustomProfile={() => void createCustomModelProfile()}
              onActivateProfile={(profileId) => void activateModelProfile(profileId)}
              onFetchModels={() => void fetchModelsForActiveProfile()}
              modelCatalog={modelCatalog}
              onSaveWorkspace={() => void saveWorkspace()}
            />
          )}
        </main>
      </div>
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
  setScreen: (screen: PanelScreen) => void,
  setGoal: (goal: string) => void
): void {
  const trigger = skill.triggers?.[0]?.trim();
  setScreen("chat");
  setGoal(trigger === undefined || trigger.length === 0
    ? `使用「${skill.name}」处理当前任务：`
    : `使用「${skill.name}」处理当前任务：${trigger}`);
}

function mergeConfigResponse(previous: ConfigResponse | undefined, incoming: ConfigResponse): ConfigResponse {
  return {
    ...previous,
    ...incoming,
    config: incoming.config ?? incoming.profile ?? previous?.config,
    profiles: incoming.profiles ?? previous?.profiles,
    modelProviderMarket: incoming.modelProviderMarket ?? previous?.modelProviderMarket,
    workspace: incoming.workspace ?? previous?.workspace,
    capabilities: incoming.capabilities ?? previous?.capabilities,
  };
}

function normalizeVisibleAiMode(mode: "none" | "fake" | "openai-compatible" | undefined): "none" | "openai-compatible" {
  return mode === "none" ? "none" : "openai-compatible";
}
