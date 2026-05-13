import React, { useEffect, useMemo, useRef, useState } from "react";
import { getJson, postJson } from "./api";
import { Composer } from "./components/composer";
import { ConversationView } from "./components/conversation";
import { RightInspector } from "./components/right-inspector";
import { SettingsPanel } from "./components/settings-panel";
import { Sidebar } from "./components/sidebar";
import { TopBar } from "./components/topbar";
import {
  mergeEvents,
  safeBasicEvents,
  safeBasicRun,
  safeConversation,
  safeDesktopDetail,
  safeWorkSession,
  typedToolDisplays,
} from "./runtime";
import type {
  BasicAgentRun,
  ConfigResponse,
  Conversation,
  ConversationSummary,
  ContextAttachment,
  DesktopRunDetail,
  DesktopWorkSession,
  RunEvent,
  SkillDefinition,
  ToolsResponse,
} from "./types";
import { terminalStatuses, type SettingsTab } from "./ui-state";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("model");
  const [goal, setGoal] = useState("");
  const [runMode, setRunMode] = useState<"agent" | "deep">("agent");
  const [aiMode, setAiMode] = useState<"none" | "fake" | "openai-compatible">("openai-compatible");
  const [modelForm, setModelForm] = useState({ baseUrl: "", model: "", apiKey: "" });
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [toolForm, setToolForm] = useState({ provider: "tavily", tavilyApiKey: "", maxResults: "5" });
  const [attachments, setAttachments] = useState<readonly ContextAttachment[]>([]);
  const [attachmentKind, setAttachmentKind] = useState<ContextAttachment["kind"]>("workspace");
  const [attachmentValue, setAttachmentValue] = useState(".");
  const pollTimer = useRef<number | undefined>(undefined);
  const currentRunId = app.run?.runId;

  useEffect(() => {
    void refreshBootstrap();
    return () => stopPolling(pollTimer);
  }, []);

  useEffect(() => {
    if (app.config?.config !== undefined) {
      setAiMode(app.config.config.defaultAiMode ?? "openai-compatible");
      setModelForm({
        baseUrl: app.config.config.baseUrl ?? "",
        model: app.config.config.model ?? "",
        apiKey: "",
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
    if (run !== undefined && !terminalStatuses.has(run.status)) {
      startPolling(run.runId, run.eventCursor.lastSequence);
    }
  }

  async function startTask(selectedMode: "agent" | "deep"): Promise<void> {
    const trimmed = goal.trim();
    if (trimmed.length === 0 || app.busy) return;
    stopPolling(pollTimer);
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
        runMode: selectedMode,
        aiMode,
        taskSoilInput: taskSoilInputFromAttachments(attachments),
      });
      setGoal("");
      setRunMode("agent");
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
      startPolling(response.run.runId, 0);
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
        setApp((previous) => ({
          ...previous,
          run: runResponse.run,
          workSession: workSessionResponse ?? previous.workSession,
          events: mergeEvents(previous.events, eventsResponse.events),
        }));
        if (terminalStatuses.has(runResponse.run.status) || runResponse.run.status === "approval_needed" || runResponse.run.status === "needs_input") {
          const [detail, conversation] = await Promise.all([
            safeDesktopDetail(runId),
            runResponse.run.conversationId === undefined ? undefined : safeConversation(runResponse.run.conversationId),
          ]);
          setApp((previous) => ({
            ...previous,
            detail,
            conversation: conversation ?? previous.conversation,
            workSession: workSessionResponse ?? previous.workSession,
          }));
          if (terminalStatuses.has(runResponse.run.status)) {
            stopPolling(pollTimer);
            void refreshConversations();
          }
        }
      } catch (error) {
        setApp((previous) => ({ ...previous, error: error instanceof Error ? error.message : "刷新运行状态失败。" }));
      }
    };
    void tick();
    pollTimer.current = window.setInterval(() => void tick(), 1_200);
  }

  async function cancelRun(): Promise<void> {
    if (currentRunId === undefined) return;
    const response = await postJson<{ readonly run: BasicAgentRun }>(`/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/cancel`, {});
    const workSession = await safeWorkSession(currentRunId);
    stopPolling(pollTimer);
    setApp((previous) => ({ ...previous, run: response.run, workSession: workSession ?? previous.workSession }));
    void refreshConversations();
  }

  async function decideConfirmation(decision: "approve_once" | "deny" | "guidance", guidance?: string): Promise<void> {
    const confirmation = app.workSession?.pendingConfirmation ?? app.detail?.canvas?.agent?.pendingConfirmation;
    if (currentRunId === undefined || confirmation === undefined) return;
    const response = await postJson<{ readonly run: BasicAgentRun }>(
      `/api/basic-agent/runs/${encodeURIComponent(currentRunId)}/confirmations/${encodeURIComponent(confirmation.confirmationId)}/decision`,
      { decision, guidance }
    );
    const workSession = await safeWorkSession(currentRunId);
    setApp((previous) => ({ ...previous, run: response.run, workSession: workSession ?? previous.workSession }));
    if (decision === "approve_once") {
      startPolling(currentRunId, response.run.eventCursor.lastSequence);
    } else {
      const detail = await safeDesktopDetail(currentRunId);
      setApp((previous) => ({ ...previous, detail }));
    }
  }

  async function saveModelConfig(): Promise<void> {
    const response = await postJson<ConfigResponse>("/api/config/model-provider", {
      baseUrl: modelForm.baseUrl,
      model: modelForm.model,
      apiKey: modelForm.apiKey,
      defaultAiMode: aiMode,
    });
    setApp((previous) => ({ ...previous, config: response }));
    setModelForm((previous) => ({ ...previous, apiKey: "" }));
  }

  async function saveWorkspace(): Promise<void> {
    const response = await postJson<{ readonly workspace: { readonly workspaceDirectory?: string } }>("/api/config/workspace", {
      workspaceDirectory,
    });
    setApp((previous) => ({ ...previous, config: { ...previous.config, workspace: response.workspace } }));
  }

  async function saveTools(): Promise<void> {
    const response = await postJson<ToolsResponse>("/api/config/tools/web-search", {
      provider: toolForm.provider,
      tavilyApiKey: toolForm.tavilyApiKey,
      maxResults: Number(toolForm.maxResults),
    });
    setApp((previous) => ({ ...previous, tools: response }));
    setToolForm((previous) => ({ ...previous, tavilyApiKey: "" }));
  }

  async function updateSkill(skillId: string, enabled: boolean): Promise<void> {
    const response = await postJson<{ readonly skills: readonly SkillDefinition[] }>(`/api/skills/${encodeURIComponent(skillId)}/state`, {
      enabled,
    });
    setApp((previous) => ({ ...previous, skills: response.skills }));
  }

  async function addAttachment(): Promise<void> {
    const response = await postJson<{ readonly attachment: ContextAttachment }>("/api/context/attachments/preview", {
      kind: attachmentKind,
      value: attachmentValue,
    });
    if (response.attachment.status !== "ready") {
      setApp((previous) => ({ ...previous, error: response.attachment.warning ?? "上下文暂时不可用。" }));
      return;
    }
    setAttachments((previous) => uniqueAttachments([...previous, response.attachment]));
    setAttachmentValue(attachmentKind === "workspace" ? "." : "");
  }

  function removeAttachment(attachmentId: string): void {
    setAttachments((previous) => previous.filter((attachment) => attachment.attachmentId !== attachmentId));
  }

  const pendingConfirmation = app.detail?.canvas?.agent?.pendingConfirmation;
  const visibleToolDisplays = useMemo(() => typedToolDisplays(app.detail), [app.detail]);

  return (
    <div className="app-shell">
      <Sidebar
        conversations={app.conversations}
        activeConversationId={app.conversation?.conversationId}
        onNew={() => {
          stopPolling(pollTimer);
          setAttachments([]);
          setApp((previous) => ({ ...previous, conversation: undefined, run: undefined, workSession: undefined, events: [], detail: undefined, error: undefined }));
        }}
        onOpen={(id) => void loadConversation(id)}
        onSettings={(tab) => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
      />
      <main className="workbench">
        <TopBar
          run={app.run}
          config={app.config}
          onOpenSettings={() => {
            setSettingsTab("model");
            setSettingsOpen(true);
          }}
        />
        <section className="session-surface" aria-label="工作会话">
          <ConversationView
            conversation={app.conversation}
            run={app.run}
            workSession={app.workSession}
            events={app.events}
            detail={app.detail}
            error={app.error}
            pendingConfirmation={pendingConfirmation}
            onDecision={(decision, guidance) => void decideConfirmation(decision, guidance)}
          />
          <Composer
            value={goal}
            onChange={setGoal}
            runMode={runMode}
            onRunModeChange={setRunMode}
            aiMode={aiMode}
            onAiModeChange={setAiMode}
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
            run={app.run}
            onSubmit={(mode) => void startTask(mode)}
            onCancel={() => void cancelRun()}
          />
        </section>
      </main>
      <RightInspector run={app.run} workSession={app.workSession} events={app.events} detail={app.detail} toolDisplays={visibleToolDisplays} />
      {settingsOpen && (
        <SettingsPanel
          tab={settingsTab}
          setTab={setSettingsTab}
          config={app.config}
          tools={app.tools}
          skills={app.skills}
          modelForm={modelForm}
          setModelForm={setModelForm}
          aiMode={aiMode}
          setAiMode={setAiMode}
          workspaceDirectory={workspaceDirectory}
          setWorkspaceDirectory={setWorkspaceDirectory}
          toolForm={toolForm}
          setToolForm={setToolForm}
          onClose={() => setSettingsOpen(false)}
          onSaveModel={() => void saveModelConfig()}
          onSaveWorkspace={() => void saveWorkspace()}
          onSaveTools={() => void saveTools()}
          onUpdateSkill={(id, enabled) => void updateSkill(id, enabled)}
        />
      )}
    </div>
  );
}

function stopPolling(ref: React.MutableRefObject<number | undefined>): void {
  if (ref.current !== undefined) {
    window.clearInterval(ref.current);
    ref.current = undefined;
  }
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
    permissionBoundaryRefs: [...new Set(ready.flatMap((attachment) => attachment.permissionRefs))],
  };
}

function uniqueAttachments(attachments: readonly ContextAttachment[]): readonly ContextAttachment[] {
  const byRef = new Map<string, ContextAttachment>();
  for (const attachment of attachments) {
    byRef.set(`${attachment.kind}:${attachment.ref}`, attachment);
  }
  return [...byRef.values()];
}
