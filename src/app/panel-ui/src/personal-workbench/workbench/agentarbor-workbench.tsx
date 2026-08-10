import { AlertCircle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { CurrentRunProjection } from "../../app-run-projection";
import { projectChatActiveView } from "../../chat-active-view";
import type { ChatInputProps } from "../../contracts/composer";
import { WorkbenchSettingsDialog, type WorkbenchSettingsDialogProps } from "../../components/workbench-settings-dialog";
import { WorkbenchBootstrapLoading } from "../../components/workbench-bootstrap-loading";
import type { AppUpdateInfo } from "../../contracts/app-update";
import type { Conversation, ConversationSummary } from "../../contracts/conversation";
import type { PendingConfirmation } from "../../contracts/run";
import type { ConfirmationProjection } from "./app/components/ConfirmationCard";
import type { PersonalSpaceActions, PersonalSpaceProjection } from "../space";
import { useWorkspaceProjection } from "../../app-workspace-state";
import { ConversationPage } from "./app/components/ConversationPage";
import { BrainPage } from "./app/components/BrainPage";
import { DeferredSurfaceBoundary } from "./app/components/DeferredSurfaceBoundary";
import { HomePage } from "./app/components/HomePage";
import { MemoryPage } from "./app/components/MemoryPage";
import { ConversationTranscript } from "./app/components/ConversationTranscript";
import { SearchPage } from "./app/components/SearchPage";
import { type View, Sidebar } from "./app/components/Sidebar";
import { SpacePage } from "./app/components/SpacePage";
import { TopBar } from "./app/components/TopBar";
import type { LiveConversationState } from "./app/components/conversation-surface-state";
import { runFocusModeTransition, type FocusModeTransitionHandle } from "./app/components/focus-mode-transition";
import { resolveById } from "./app/components/brainStore";
import { warmStartupReferencePreviews } from "./app/components/space-reference-preview-warmup";
import { applyPrefs, loadPrefs } from "../../reading-preferences";
import {
  initializePersonalKnowledge,
  getPersonalKnowledgeError,
  getPersonalKnowledgeLoadState,
  refreshPersonalKnowledge,
  subscribePersonalKnowledge,
  setActivePersonalKnowledgeSpace,
  setPersonalKnowledgePersistenceEnabled,
} from "./app/components/personalKnowledgeClient";

export type PersonalWorkbenchProps = {
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
  readonly developerModeEnabled: boolean;
  readonly error?: string;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<CurrentRunProjection["workView"]>["pendingConfirmation"];
  readonly confirmationBusy: boolean;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly onStartNewConversation: (owner?: { readonly kind: "space" | "workspace"; readonly id: string }) => Promise<boolean>;
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

type ConversationMode = "normal" | "focus";

/**
 * The visual composition root for the redesign. It deliberately holds only
 * navigation and selection: conversations, runs, confirmations, and Spaces
 * remain owned by their existing feature facades.
 */
export function PersonalWorkbench(props: PersonalWorkbenchProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => initialView(props));
  const [conversationMode, setConversationModeState] = useState<ConversationMode>("normal");
  const [previousView, setPreviousView] = useState<View>("home");
  const [brainSelectedId, setBrainSelectedId] = useState<string | null>(null);
  const [spaceTargetId, setSpaceTargetId] = useState<string | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [homeOwnerSelection, setHomeOwnerSelection] = useState<{ readonly kind: "space" | "workspace"; readonly id: string } | null>(null);
  const [homeFocusRequest, setHomeFocusRequest] = useState(0);
  const observedViewRef = useRef(view);
  const navigationIntentRef = useRef(view);
  const focusTransitionRef = useRef<FocusModeTransitionHandle | null>(null);
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
  const conversationProjection = projectConversationSurface(props, activeConversation);
  const conversationState = projectLiveConversationState(conversationProjection, props);
  const workspaceProjection = useWorkspaceProjection(true);
  const surfaceTitle = view === "space"
    ? props.spaces?.find((space) => space.spaceId === activeSpaceId)?.title ?? "空间"
    : isConversationView(view)
      ? activeConversation?.title ?? "新的对话"
      : undefined;
  const surfaceOwner = isConversationView(view) && activeConversation?.owner !== undefined
    ? (activeConversation.owner.kind === "space"
        ? `空间 · ${props.spaces?.find((space) => space.spaceId === activeConversation.owner?.id)?.title ?? "空间"}`
        : `工作区 · ${workspaceProjection.workspaces.find((workspace) => workspace.workspaceId === activeConversation.owner?.id)?.title ?? "工作区"}`)
    : undefined;

  useEffect(() => {
    setPersonalKnowledgePersistenceEnabled(props.personalKnowledgePersistenceEnabled === true);
  }, [props.personalKnowledgePersistenceEnabled]);

  useEffect(() => {
    const spaces = props.spaces ?? [];
    const firstSpaceId = spaces[0]?.spaceId;
    setActiveSpaceId((current) => current !== null && spaces.some((space) => space.spaceId === current)
      ? current
      : firstSpaceId ?? null);
    setHomeOwnerSelection((current) => {
      if (current !== null && (
        (current.kind === "space" && spaces.some((space) => space.spaceId === current.id)) ||
        (current.kind === "workspace" && workspaceProjection.workspaces.some((workspace) => workspace.workspaceId === current.id))
      )) return current;
      return firstSpaceId === undefined ? null : { kind: "space", id: firstSpaceId };
    });
    if (props.personalKnowledgePersistenceEnabled && props.spaceLoadState?.loading !== true) {
      void initializePersonalKnowledge(firstSpaceId).catch(() => undefined);
    }
  }, [props.personalKnowledgePersistenceEnabled, props.spaceLoadState?.loading, props.spaces, workspaceProjection.workspaces]);

  useEffect(() => {
    if (props.spaceLoadState?.loading === true) return undefined;
    return warmStartupReferencePreviews(props.spaces ?? []);
  }, [props.spaceLoadState?.loading, props.spaces]);

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

  useEffect(() => () => {
    focusTransitionRef.current?.cancel();
    focusTransitionRef.current = null;
  }, []);

  useEffect(() => {
    applyPrefs(loadPrefs());
  }, []);

  const setConversationMode = (next: ConversationMode, after?: () => void): void => {
    if (next === conversationMode) {
      after?.();
      return;
    }
    focusTransitionRef.current?.cancel();
    focusTransitionRef.current = runFocusModeTransition({
      root: rootRef.current,
      direction: next === "focus" ? "enter" : "exit",
      update: () => flushSync(() => {
        setConversationModeState(next);
        after?.();
      }),
    });
  };

  const navigate = (target: View): void => {
    // Record explicit intent synchronously so an already-resolving home
    // submission cannot navigate back after the user chose another surface.
    navigationIntentRef.current = target;
    const updateNavigation = (): void => {
      if (target === "search") setPreviousView(view);
      // Only search navigation sets a target explicitly. Normal navigation must
      // clear it, otherwise a later Space switch can reuse an id from another Space.
      setSpaceTargetId(null);
      if (target !== "brain") setBrainSelectedId(null);
      setView(target);
    };
    if (conversationMode === "focus") {
      setConversationMode("normal", updateNavigation);
      return;
    }
    updateNavigation();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("search");
      }
      if (event.key === "Escape" && view === "search") navigate(previousView);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationMode, previousView, view]);

  const homeInput = useMemo<ChatInputProps>(() => ({
    ...props.inputProps,
    autoFocus: true,
    placeholder: "想从哪里开始？",
    onSubmit: () => {
      if (props.inputProps.value.trim().length === 0) return;
      void props.onStartNewConversation(homeOwnerSelection ?? undefined).then((started) => {
        if (navigationIntentRef.current !== "home") return;
        if (started) {
          navigationIntentRef.current = "conv-active";
          setView("conv-active");
        } else {
          setHomeFocusRequest((current) => current + 1);
        }
      });
    },
  }), [homeOwnerSelection, props.inputProps, props.onStartNewConversation]);

  const conversationInput = useMemo<ChatInputProps>(() => ({
    ...props.inputProps,
    autoFocus: true,
    placeholder: activeConversation === undefined ? "从一个想法开始" : "继续对话...",
  }), [activeConversation, props.inputProps]);
  const showLoadingFallback = (
    props.bootstrapState.status === "loading" && view !== "home"
  ) || (
    isKnowledgeView(view) && (knowledgeLoadState.status === "loading" || knowledgeLoadState.status === "retrying")
  );
  return (
    <div
      ref={rootRef}
      className="aa-workbench-root flex h-screen min-h-0 w-full overflow-hidden"
      style={{
        background: "var(--aa-canvas)",
        color: "var(--aa-text-1)",
        fontFamily: '"Noto Sans SC", Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`
        @keyframes viewFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .aa-workbench-root .view-enter { animation: viewFadeIn 140ms ease; }
      `}</style>
      <Sidebar
        view={view}
        collapsed={props.sidebarCollapsed}
        conversations={props.conversations}
        spaces={props.spaces ?? []}
        spaceLoadState={props.spaceLoadState}
        workspaces={workspaceProjection.workspaces}
        workspaceLoadState={{
          loading: workspaceProjection.loading,
          mutationPending: workspaceProjection.mutationPending,
          error: workspaceProjection.error,
          onRetry: workspaceProjection.refresh,
        }}
        onAddWorkspace={workspaceProjection.addWorkspace}
        onDeleteWorkspace={workspaceProjection.deleteWorkspace}
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
        onDeleteSpace={props.spaceActions?.deleteSpace}
        onOpenSettings={props.onOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          view={view}
          onNavigate={navigate}
          onSearch={() => navigate("search")}
          sidebarCollapsed={props.sidebarCollapsed}
          onToggleSidebar={props.onToggleSidebar}
          surfaceTitle={surfaceTitle}
          surfaceOwner={surfaceOwner}
          conversationState={conversationState}
          onEnterFocus={isConversationView(view) && conversationMode === "normal"
            ? () => setConversationMode("focus")
            : undefined}
          brainFileTitle={brainSelectedId === null ? null : resolveById(brainSelectedId)?.title ?? null}
          onBrainRoot={() => setBrainSelectedId(null)}
        />

        <main
          aria-label={viewLabel(view)}
          className="aa-workbench-main flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div
            className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden"
            key={isConversationView(view) ? "conversation" : view}
          >
            {showLoadingFallback ? <WorkbenchBootstrapLoading /> : (
              <DeferredSurfaceBoundary resetKey={view} label="这个视图暂时无法打开">
                  {renderView({
                    view,
                    props,
                    activeConversation,
                    conversationProjection,
                    conversationState,
                    homeInput,
                    homeFocusRequest,
                    workspaceProjection,
                    homeOwnerSelection,
                    onHomeOwnerChange: setHomeOwnerSelection,
                    conversationInput,
                    brainSelectedId,
                    spaceTargetId,
                    activeSpaceId,
                    onActiveSpaceChange: setActiveSpaceId,
                    conversationMode,
                    onBrainSelect: setBrainSelectedId,
                    navigate,
                    onExitFocus: () => setConversationMode("normal"),
                    onOpenInSpace: (spaceId, id) => {
                      setActiveSpaceId(spaceId);
                      setSpaceTargetId(id);
                      navigate("space");
                    },
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
    case "memory": return "记忆";
    case "search": return "搜索";
    case "conv-active":
    case "conv-done": return "对话工作台";
  }
}

function renderView(input: {
  readonly view: View;
  readonly props: PersonalWorkbenchProps;
  readonly activeConversation?: Conversation;
  readonly conversationProjection: ConversationSurfaceProjection;
  readonly conversationState: LiveConversationState;
  readonly homeInput: ChatInputProps;
  readonly homeFocusRequest: number;
  readonly workspaceProjection: ReturnType<typeof useWorkspaceProjection>;
  readonly homeOwnerSelection: { readonly kind: "space" | "workspace"; readonly id: string } | null;
  readonly onHomeOwnerChange: (owner: { readonly kind: "space" | "workspace"; readonly id: string } | null) => void;
  readonly conversationInput: ChatInputProps;
  readonly brainSelectedId: string | null;
  readonly spaceTargetId: string | null;
  readonly activeSpaceId: string | null;
  readonly onActiveSpaceChange: (spaceId: string | null) => void;
  readonly conversationMode: ConversationMode;
  readonly onBrainSelect: (id: string | null) => void;
  readonly navigate: (view: View) => void;
  readonly onExitFocus: () => void;
  readonly onOpenInSpace: (spaceId: string, id: string) => void;
}) {
  if (input.view === "home") {
    return <HomePage
      spaces={input.props.spaces ?? []}
      workspaces={input.workspaceProjection.workspaces}
      ownerSelection={input.homeOwnerSelection}
      onOwnerChange={input.onHomeOwnerChange}
      input={input.homeInput}
      focusRequest={input.homeFocusRequest}
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
      onOpenItem={input.props.onOpenSpaceItem}
      onOpenConversation={input.props.onOpenConversation}
      activeConversationId={input.activeConversation?.conversationId}
      conversationContent={
        <ConversationSurface
          props={input.props}
          conversation={input.activeConversation}
          projection={input.conversationProjection}
          state={input.conversationState}
          input={input.conversationInput}
        />
      }
      onRenameConversation={input.props.onRenameConversation}
      onToggleConversationPinned={input.props.onToggleConversationPinned}
      onDeleteConversation={input.props.onDeleteConversation}
    />;
  }
  if (input.view === "brain") {
    return <BrainPage
      selectedId={input.brainSelectedId}
      onSelect={input.onBrainSelect}
    />;
  }
  if (input.view === "memory") {
    return <MemoryPage />;
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
  return <ConversationSurface
    props={input.props}
    conversation={input.activeConversation}
    projection={input.conversationProjection}
    state={input.conversationState}
    input={input.conversationInput}
    focus={input.conversationMode === "focus"}
    onExitFocus={input.onExitFocus}
  />;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

function ConversationSurface(props: {
  readonly props: PersonalWorkbenchProps;
  readonly conversation?: Conversation;
  readonly projection: ConversationSurfaceProjection;
  readonly state: LiveConversationState;
  readonly input: ChatInputProps;
  readonly focus?: boolean;
  readonly onExitFocus?: () => void;
}) {
  const active = props.projection;
  const composerInput = confirmationGuidanceInput(
    props.input,
    active.pending,
    props.props.confirmationBusy,
    props.props.onDecision,
  );
  const content = active.hasVisibleContent ? (
    <DeferredSurfaceBoundary resetKey={props.props.currentRun.run?.runId ?? props.conversation?.conversationId ?? "transcript"} label="对话内容暂时无法显示">
        <ConversationTranscript
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
      developerModeEnabled={props.props.developerModeEnabled}
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
  const title = props.conversation?.title ?? "新的对话";
  const scrollKey = `${props.conversation?.conversationId ?? "new-conversation"}:${active.currentRunId ?? "idle"}`;

  return <ConversationPage
    scrollKey={scrollKey}
    content={content}
    input={composerInput}
    focus={props.focus ? {
      title,
      state: props.state,
      onExit: props.onExitFocus ?? (() => undefined),
    } : undefined}
  />;
}

function projectConversationSurface(
  props: PersonalWorkbenchProps,
  conversation: Conversation | undefined,
) {
  return projectChatActiveView({
    conversation,
    run: props.currentRun.run,
    workView: props.currentRun.workView,
    transcriptNodes: props.currentRun.transcriptNodes,
    detail: props.currentRun.detail,
    live: props.currentRun.live,
    error: props.error,
    pendingConfirmation: props.pendingConfirmation,
  });
}

type ConversationSurfaceProjection = ReturnType<typeof projectConversationSurface>;

function projectLiveConversationState(
  active: ConversationSurfaceProjection,
  props: PersonalWorkbenchProps,
): LiveConversationState {
  if (active.pending !== undefined) return "attention";
  if (active.running) return "working";
  if (props.error !== undefined || isFailedRun(props.currentRun.run?.status)) return "failed";
  return active.hasVisibleContent ? "completed" : "initial";
}

function isConversationView(view: View): boolean {
  return view === "conv-active" || view === "conv-done";
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

function confirmationGuidanceInput(
  input: ChatInputProps,
  pending: ConfirmationProjection | undefined,
  confirmationBusy: boolean,
  onDecision: PersonalWorkbenchProps["onDecision"],
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

/**
 * 初始视图选择（仅启动挂载，此时尚无用户导航意图）：
 * 有运行中的 run 或待确认时直接恢复对话视图；否则进入首页空态。
 * 用户显式导航（首页/知识库/搜索/空间）后不再强制跳回对话页——
 * 运行与待确认状态由 TopBar 全局徽标提醒，不劫持用户选择。
 */
function initialView(props: Pick<PersonalWorkbenchProps, "currentRun" | "pendingConfirmation">): View {
  return requiresImmediateConversationView(props) ? "conv-active" : "home";
}

function requiresImmediateConversationView(props: Pick<PersonalWorkbenchProps, "currentRun" | "pendingConfirmation">): boolean {
  return props.pendingConfirmation !== undefined
    || props.currentRun.run?.status === "running";
}

function isFailedRun(status: string | undefined): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}

/** @deprecated Use PersonalWorkbench. Kept while the prototype import path is retired. */
export const RedesignWorkbench = PersonalWorkbench;
/** @deprecated Use PersonalWorkbenchProps. */
export type RedesignWorkbenchProps = PersonalWorkbenchProps;
