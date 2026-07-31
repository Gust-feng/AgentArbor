import { AlertCircle, Check, FileSearch, RotateCcw, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CurrentRunProjection } from "../../app-run-projection";
import { projectChatActiveView } from "../../chat-active-view";
import type { ChatInputProps } from "../../components/chat-empty";
import { WorkbenchSettingsDialog, type WorkbenchSettingsDialogProps } from "../../components/workbench-settings-dialog";
import type { AppUpdateInfo } from "../../contracts/app-update";
import type { Conversation, ConversationSummary } from "../../contracts/conversation";
import type { PendingConfirmation, TranscriptNode } from "../../contracts/run";
import type { ConfirmationProjection } from "./app/components/ConfirmationCard";
import type { PersonalSpaceActions, PersonalSpaceProjection } from "../space";
import { ConversationPage, type LiveConversationState } from "./app/components/ConversationPage";
import { BrainPage } from "./app/components/BrainPage";
import { ConversationComposer } from "./app/components/ConversationComposer";
import { DeferredSurfaceBoundary } from "./app/components/DeferredSurfaceBoundary";
import { FocusMode } from "./app/components/FocusMode";
import { HomePage } from "./app/components/HomePage";
import { RedesignTranscript } from "./app/components/RedesignTranscript";
import { SearchPage } from "./app/components/SearchPage";
import { type View, Sidebar } from "./app/components/Sidebar";
import { SpacePage } from "./app/components/SpacePage";
import { TopBar } from "./app/components/TopBar";
import { resolveById } from "./app/components/brainStore";
import { applyPrefs, loadPrefs } from "./app/components/readingPrefs";
import { RunPanel, type RunStep } from "./app/components/RunPanel";
import {
  initializePersonalKnowledge,
  getPersonalKnowledgeError,
  getPersonalKnowledgeLoadState,
  refreshPersonalKnowledge,
  subscribePersonalKnowledge,
  setActivePersonalKnowledgeSpace,
  setPersonalKnowledgePersistenceEnabled,
} from "./app/components/personalKnowledgeClient";

export type RedesignWorkbenchProps = {
  readonly personalKnowledgePersistenceEnabled?: boolean;
  readonly bootstrapState: {
    readonly status: "loading" | "ready" | "retrying" | "error";
    readonly error?: string;
    readonly onRetry: () => void;
  };
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly conversation?: Conversation;
  readonly conversations: readonly ConversationSummary[];
  readonly currentRun: CurrentRunProjection;
  readonly inputProps: ChatInputProps;
  readonly showModelUsage: boolean;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<CurrentRunProjection["workView"]>["pendingConfirmation"];
  readonly confirmationBusy: boolean;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly onOpenConversation: (conversationId: string) => boolean | Promise<boolean>;
  readonly pendingConversationIds?: ReadonlySet<string>;
  readonly onRenameConversation: (conversationId: string, title: string) => void | Promise<void>;
  readonly onToggleConversationPinned: (conversationId: string, pinned: boolean) => void | Promise<void>;
  readonly onDeleteConversation: (conversationId: string) => void | Promise<void>;
  readonly spaces?: readonly PersonalSpaceProjection[];
  readonly spaceLoadState?: {
    readonly loading: boolean;
    readonly mutationPending?: boolean;
    readonly error?: string;
    readonly onRetry: () => void | Promise<void>;
  };
  readonly onOpenSpace?: (spaceId: string) => void | Promise<void>;
  readonly onOpenSpaceItem?: (spaceId: string, itemId: string) => void | Promise<void>;
  readonly onCreateSpace?: (title: string) => void | Promise<void>;
  readonly spaceActions?: PersonalSpaceActions;
  readonly onOpenSettings: () => void;
  readonly settingsDialogProps?: WorkbenchSettingsDialogProps;
  readonly appUpdate?: AppUpdateInfo;
  readonly onInstallAppUpdate: () => void;
};

/**
 * The visual composition root for the redesign. It deliberately holds only
 * navigation and selection: conversations, runs, confirmations, and Spaces
 * remain owned by their existing feature facades.
 */
export function RedesignWorkbench(props: RedesignWorkbenchProps) {
  const [view, setView] = useState<View>(() => initialView(props));
  const [previousView, setPreviousView] = useState<View>("home");
  const [brainSelectedId, setBrainSelectedId] = useState<string | null>(null);
  const [spaceTargetId, setSpaceTargetId] = useState<string | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [pendingRuntimePrompt, setPendingRuntimePrompt] = useState<string | undefined>();
  const observedViewRef = useRef(view);
  const knowledgeLoadState = useSyncExternalStore(
    subscribePersonalKnowledge,
    getPersonalKnowledgeLoadState,
    getPersonalKnowledgeLoadState,
  );
  const knowledgeError = useSyncExternalStore(
    subscribePersonalKnowledge,
    getPersonalKnowledgeError,
    getPersonalKnowledgeError,
  );

  const activeConversation = props.conversation;
  const hasAttention = needsConversationAttention(props);

  useEffect(() => {
    setPersonalKnowledgePersistenceEnabled(props.personalKnowledgePersistenceEnabled === true);
  }, [props.personalKnowledgePersistenceEnabled]);

  useEffect(() => {
    const spaces = props.spaces ?? [];
    const firstSpaceId = spaces[0]?.spaceId;
    setActiveSpaceId((current) => current !== null && spaces.some((space) => space.spaceId === current)
      ? current
      : firstSpaceId ?? null);
    if (props.personalKnowledgePersistenceEnabled && props.spaceLoadState?.loading !== true) {
      void initializePersonalKnowledge(firstSpaceId).catch(() => undefined);
    }
  }, [props.personalKnowledgePersistenceEnabled, props.spaceLoadState?.loading, props.spaces]);

  useEffect(() => {
    if (activeSpaceId !== null) setActivePersonalKnowledgeSpace(activeSpaceId);
  }, [activeSpaceId]);

  useEffect(() => {
    const viewChanged = observedViewRef.current !== view;
    observedViewRef.current = view;
    if (
      !viewChanged
      || !props.personalKnowledgePersistenceEnabled
      || !isKnowledgeView(view)
      || knowledgeLoadState.status !== "ready"
    ) return;
    void refreshPersonalKnowledge().catch(() => undefined);
  }, [knowledgeLoadState.status, props.personalKnowledgePersistenceEnabled, view]);

  useEffect(() => {
    if (hasAttention) setView("conv-active");
  }, [hasAttention]);

  useEffect(() => {
    applyPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPreviousView(view);
        setView("search");
      }
      if (event.key === "Escape" && view === "search") setView(previousView);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previousView, view]);

  useEffect(() => {
    if (pendingRuntimePrompt === undefined || props.inputProps.value !== pendingRuntimePrompt) return;
    setPendingRuntimePrompt(undefined);
    props.inputProps.onSubmit();
  }, [pendingRuntimePrompt, props.inputProps]);

  const startRuntime = (message: string): void => {
    props.inputProps.onChange(message);
    setPendingRuntimePrompt(message);
    setView("conv-active");
  };

  const navigate = (target: View): void => {
    if (target === "search") setPreviousView(view);
    if (target === "conv-new") props.inputProps.onChange("");
    // Only search navigation sets a target explicitly. Normal navigation must
    // clear it, otherwise a later Space switch can reuse an id from another Space.
    setSpaceTargetId(null);
    if (target !== "brain") setBrainSelectedId(null);
    setView(target);
  };

  const conversationInput = useMemo<ChatInputProps>(() => ({
    ...props.inputProps,
    autoFocus: true,
    placeholder: activeConversation === undefined ? "从一个想法开始" : "继续对话...",
  }), [activeConversation, props.inputProps]);
  return (
    <div
      className="aa-redesign-root flex h-screen min-h-0 w-full overflow-hidden"
      style={{
        background: "var(--aa-canvas)",
        color: "var(--aa-text-1)",
        fontFamily: '"Noto Sans SC", Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`
        @keyframes viewFadeIn {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .aa-redesign-root .view-enter { animation: viewFadeIn 140ms ease; }
      `}</style>
      <Sidebar
        view={view}
        collapsed={props.sidebarCollapsed}
        conversations={props.conversations}
        spaces={props.spaces ?? []}
        spaceLoadState={props.spaceLoadState}
        activeSpaceId={activeSpaceId}
        activeConversationId={props.conversation?.conversationId}
        onNavigate={navigate}
        onOpenConversation={props.onOpenConversation}
        pendingConversationIds={props.pendingConversationIds ?? EMPTY_ID_SET}
        onRenameConversation={props.onRenameConversation}
        onToggleConversationPinned={props.onToggleConversationPinned}
        onDeleteConversation={props.onDeleteConversation}
        onOpenSpace={props.onOpenSpace}
        onActiveSpaceChange={setActiveSpaceId}
        onCreateSpace={props.onCreateSpace}
        onRenameSpace={props.spaceActions?.rename === undefined
          ? undefined
          : (spaceId, title) => props.spaceActions?.rename?.({ kind: "space", id: spaceId }, title)}
        onOpenSettings={props.onOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          view={view}
          onNavigate={navigate}
          onSearch={() => navigate("search")}
          sidebarCollapsed={props.sidebarCollapsed}
          onToggleSidebar={props.onToggleSidebar}
          brainFileTitle={brainSelectedId === null ? null : resolveById(brainSelectedId, props.spaces ?? [])?.title ?? null}
          onBrainRoot={() => setBrainSelectedId(null)}
        />

        <main
          aria-label={viewLabel(view)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden" key={view}>
            {props.bootstrapState.status === "loading" || (
              isKnowledgeView(view) && (knowledgeLoadState.status === "loading" || knowledgeLoadState.status === "retrying")
            ) ? <PrototypeRuntimeLoading /> : (
              <DeferredSurfaceBoundary resetKey={view} label="这个视图暂时无法打开">
                  {renderView({
                    view,
                    props,
                    activeConversation,
                    conversationInput,
                    brainSelectedId,
                    spaceTargetId,
                    activeSpaceId,
                    onBrainSelect: setBrainSelectedId,
                    navigate,
                    onOpenInSpace: (spaceId, id) => {
                      setActiveSpaceId(spaceId);
                      setSpaceTargetId(id);
                      setView("space");
                    },
                    startRuntime,
                  })}
              </DeferredSurfaceBoundary>
            )}
          </div>
        </main>
      </div>

      {props.bootstrapState.status === "error" && (
        <WorkbenchStatusNotice
          message={props.bootstrapState.error ?? "工作台启动数据加载失败。"}
          onRetry={props.bootstrapState.onRetry}
          retrying={false}
        />
      )}

      {props.bootstrapState.status === "retrying" && (
        <WorkbenchStatusNotice message="正在重新连接工作台..." retrying />
      )}

      {props.bootstrapState.status === "ready" && knowledgeLoadState.status === "error" && (
        <WorkbenchStatusNotice
          message={knowledgeLoadState.message}
          onRetry={() => void initializePersonalKnowledge(activeSpaceId ?? undefined).catch(() => undefined)}
        />
      )}

      {props.bootstrapState.status === "ready" && knowledgeLoadState.status === "ready" && knowledgeError !== undefined && (
        <WorkbenchStatusNotice
          message={knowledgeError}
          onRetry={() => void refreshPersonalKnowledge().catch(() => undefined)}
        />
      )}

      {props.error !== undefined && !isConversationView(view) && props.bootstrapState.status === "ready" && knowledgeError === undefined && (
        <WorkbenchStatusNotice message={props.error} />
      )}

      {props.settingsDialogProps?.open === true && <WorkbenchSettingsDialog {...props.settingsDialogProps} />}
    </div>
  );
}

function viewLabel(view: View): string {
  switch (view) {
    case "home": return "个人首页";
    case "space": return "空间";
    case "brain": return "知识库";
    case "search": return "搜索";
    case "focus": return "专注模式";
    case "conv-active":
    case "conv-done":
    case "conv-new": return "对话工作台";
  }
}

function renderView(input: {
  readonly view: View;
  readonly props: RedesignWorkbenchProps;
  readonly activeConversation?: Conversation;
  readonly conversationInput: ChatInputProps;
  readonly brainSelectedId: string | null;
  readonly spaceTargetId: string | null;
  readonly activeSpaceId: string | null;
  readonly onBrainSelect: (id: string | null) => void;
  readonly navigate: (view: View) => void;
  readonly onOpenInSpace: (spaceId: string, id: string) => void;
  readonly startRuntime: (message: string) => void;
}) {
  if (input.view === "home") {
    return <HomePage
      onNavigate={input.navigate}
      onStartConversation={input.startRuntime}
      onOpenConversation={input.props.onOpenConversation}
      conversations={input.props.conversations}
      spaces={input.props.spaces ?? []}
    />;
  }
  if (input.view === "space") {
    const activeSpace = input.props.spaces?.find((space) => space.spaceId === input.activeSpaceId);
    return <SpacePage
      key={activeSpace?.spaceId ?? "space-empty"}
      onNavigate={input.navigate}
      targetId={input.spaceTargetId}
      space={activeSpace}
      actions={input.props.spaceActions}
      currentConversation={input.activeConversation === undefined ? undefined : {
        conversationId: input.activeConversation.conversationId,
        title: input.activeConversation.title,
      }}
      onOpenItem={input.props.onOpenSpaceItem}
      onOpenConversation={input.props.onOpenConversation}
    />;
  }
  if (input.view === "brain") {
    return <BrainPage
      selectedId={input.brainSelectedId}
      onSelect={input.onBrainSelect}
      spaces={input.props.spaces ?? []}
      onOpenSpaceReference={input.onOpenInSpace}
    />;
  }
  if (input.view === "search") {
    return <SearchPage
      onNavigate={input.navigate}
      onOpenInSpace={input.onOpenInSpace}
      onOpenConversation={input.props.onOpenConversation}
      spaces={input.props.spaces ?? []}
      conversations={input.props.conversations}
    />;
  }
  if (input.view === "focus") {
    return <ConversationSurface props={input.props} conversation={input.activeConversation} input={input.conversationInput} focus onExitFocus={() => input.navigate("conv-active")} />;
  }
  return <ConversationSurface props={input.props} conversation={input.activeConversation} input={input.conversationInput} onEnterFocus={() => input.navigate("focus")} />;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

function PrototypeRuntimeLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" style={{ color: "var(--aa-text-3)" }}>
      <span className="text-sm">正在准备工作台</span>
    </div>
  );
}

function ConversationSurface(props: {
  readonly props: RedesignWorkbenchProps;
  readonly conversation?: Conversation;
  readonly input: ChatInputProps;
  readonly focus?: boolean;
  readonly onEnterFocus?: () => void;
  readonly onExitFocus?: () => void;
}) {
  const active = projectChatActiveView({
    conversation: props.conversation,
    run: props.props.currentRun.run,
    workView: props.props.currentRun.workView,
    transcriptNodes: props.props.currentRun.transcriptNodes,
    detail: props.props.currentRun.detail,
    live: props.props.currentRun.live,
    error: props.props.error,
    pendingConfirmation: props.props.pendingConfirmation,
  });
  const composerInput = confirmationGuidanceInput(
    props.input,
    active.pending,
    props.props.confirmationBusy,
    props.props.onDecision,
  );
  const state: LiveConversationState = active.pending !== undefined
    ? "attention"
    : active.running
      ? "working"
      : props.props.error !== undefined || isFailedRun(props.props.currentRun.run?.status)
        ? "failed"
        : active.hasVisibleContent
          ? "completed"
          : "initial";
  const content = active.hasVisibleContent ? (
    <DeferredSurfaceBoundary resetKey={props.props.currentRun.run?.runId ?? props.conversation?.conversationId ?? "transcript"} label="对话内容暂时无法显示">
        <RedesignTranscript
      conversationId={props.conversation?.conversationId}
      projectedTurns={active.workline.turns}
      turns={props.conversation?.turns ?? []}
      currentRunId={active.currentRunId}
      currentRunNodes={active.currentRunProjection.nodes}
      currentRunToolResults={props.props.currentRun.detail?.toolResults ?? []}
      run={props.props.currentRun.run}
      live={props.props.currentRun.live}
      workView={props.props.currentRun.workView}
      pending={active.pending}
      showModelUsage={props.props.showModelUsage}
      standaloneRun={active.workline.standaloneRun !== true ? undefined : {
        currentRunId: active.currentRunId,
        runStatus: props.props.currentRun.run?.status,
        answer: active.answer,
        deliverable: active.deliverable,
        runProjection: active.currentRunProjection,
        pending: active.pending,
      }}
      models={props.input.models}
      selectedModelId={props.input.selectedModelId}
      onDecision={props.props.onDecision}
      confirmationBusy={props.props.confirmationBusy}
        />
    </DeferredSurfaceBoundary>
  ) : undefined;
  const activity = runActivity(props.props.currentRun, active.running, props.input.onCancel);

  const pageProps = {
    title: props.conversation?.title ?? "新的对话",
    state,
    hasContent: active.hasVisibleContent,
    content,
    activity,
    input: composerInput,
    error: props.props.error,
  };

  if (props.focus) {
    return <FocusMode
      live={{
        title: pageProps.title,
        state: pageProps.state,
        content: pageProps.content,
        activity: pageProps.activity,
        composer: <ConversationComposer input={pageProps.input} />,
      }}
      onExit={props.onExitFocus ?? (() => undefined)}
    />;
  }
  return <ConversationPage live={{ ...pageProps, onFocus: props.onEnterFocus }} />;
}

function isConversationView(view: View): boolean {
  return view === "conv-active" || view === "conv-done" || view === "conv-new" || view === "focus";
}

function isKnowledgeView(view: View): boolean {
  return view === "space" || view === "brain" || view === "search";
}

function WorkbenchStatusNotice(props: {
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retrying?: boolean;
}) {
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-2.5 rounded-md px-3 py-2.5 shadow-sm"
      style={{ background: "var(--aa-surface)", border: "1px solid var(--aa-border)", color: "var(--aa-text-2)" }}
      role="alert"
    >
      <AlertCircle className="mt-0.5 shrink-0" size={14} style={{ color: "var(--aa-status-error)" }} />
      <span className="min-w-0 flex-1 break-words text-xs leading-5">{props.message}</span>
      {props.onRetry !== undefined && (
        <button
          type="button"
          aria-label="重新加载工作台数据"
          title="重新加载工作台数据"
          onClick={props.onRetry}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-black/5 disabled:opacity-40"
          style={{ color: "var(--aa-text-3)" }}
          disabled={props.retrying}
        >
          <RotateCcw className={props.retrying ? "animate-spin" : undefined} size={12} />
        </button>
      )}
    </div>
  );
}

function runActivity(currentRun: CurrentRunProjection, running: boolean, onStop: ChatInputProps["onCancel"]) {
  const nodes = currentRun.transcriptNodes;
  if (nodes.length === 0 && currentRun.run?.currentStep === undefined) return undefined;
  const steps = nodes.slice(-6).map(toRunStep);
  if (steps.length === 0 && currentRun.run?.currentStep !== undefined) {
    steps.push({ id: "current", label: currentRun.run.currentStep, icon: <Wrench size={11} />, status: "active" });
  }
  const createdAt = Date.parse(currentRun.run?.createdAt ?? "");
  return <RunPanel
    steps={steps}
    running={running}
    finishedLabel={currentRun.run?.status === "cancelled" ? "已停止" : undefined}
    stopped={currentRun.run?.status === "cancelled"}
    elapsedMs={Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : 0}
    onStop={running ? onStop : undefined}
    defaultCollapsed={!running}
  />;
}

function toRunStep(node: TranscriptNode): RunStep {
  const active = node.phase === "preparing" || node.phase === "executing" || node.phase === "waiting_approval";
  return {
    id: node.nodeId,
    label: node.title,
    detail: node.summary,
    icon: node.kind === "tool" ? <Wrench size={11} /> : node.kind === "answer" ? <Check size={11} /> : <FileSearch size={11} />,
    status: active ? "active" : "done",
  };
}

function confirmationGuidanceInput(
  input: ChatInputProps,
  pending: ConfirmationProjection | undefined,
  confirmationBusy: boolean,
  onDecision: RedesignWorkbenchProps["onDecision"],
): ChatInputProps {
  if (pending === undefined || pending.resumeAvailability === "lost_after_restart") return input;
  return {
    ...input,
    placeholder: "补充要求...",
    onSubmit: () => {
      const guidance = input.value.trim();
      if (guidance.length === 0 || confirmationBusy) return;
      onDecision("guidance", guidance);
      input.onChange("");
    },
  };
}

function initialView(props: Pick<RedesignWorkbenchProps, "conversation" | "currentRun" | "pendingConfirmation">): View {
  return needsConversationAttention(props) ? "conv-active" : "home";
}

function needsConversationAttention(props: Pick<RedesignWorkbenchProps, "conversation" | "currentRun" | "pendingConfirmation">): boolean {
  return props.pendingConfirmation !== undefined
    || props.currentRun.run?.status === "running"
    || (props.conversation !== undefined && props.currentRun.transcriptNodes.length > 0);
}

function isFailedRun(status: string | undefined): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}
