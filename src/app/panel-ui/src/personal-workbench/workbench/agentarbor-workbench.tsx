import { AlertCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CurrentRunProjection } from "../../app-run-projection";
import type { ChatInputProps } from "../../contracts/composer";
import { WorkbenchSettingsDialog, type WorkbenchSettingsDialogProps } from "../../components/workbench-settings-dialog";
import { WorkbenchBootstrapLoading } from "../../components/workbench-bootstrap-loading";
import type { AppUpdateInfo } from "../../contracts/app-update";
import type { Conversation, ConversationSummary } from "../../contracts/conversation";
import type { PendingConfirmation } from "../../contracts/run";
import type { PersonalSpaceActions, PersonalSpaceProjection } from "../space";
import { DeferredSurfaceBoundary } from "./app/components/DeferredSurfaceBoundary";
import { type View, Sidebar } from "./app/components/Sidebar";
import { TopBar } from "./app/components/TopBar";
import { WorkbenchViewRouter } from "./app/components/WorkbenchViewRouter";
import { resolveById } from "./app/components/brainStore";
import { useWorkbenchNavigation } from "./workbench-navigation";
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
  readonly onStartNewConversation: () => Promise<boolean>;
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
 * The visual composition root for the personal workbench. It deliberately holds only
 * navigation and selection: conversations, runs, confirmations, and Spaces
 * remain owned by their existing feature facades.
 */
export function PersonalWorkbench(props: PersonalWorkbenchProps) {
  const navigation = useWorkbenchNavigation({
    currentRun: props.currentRun,
    pendingConfirmation: props.pendingConfirmation,
    conversation: props.conversation,
    inputProps: props.inputProps,
    onStartNewConversation: props.onStartNewConversation,
  });
  const {
    view,
    brainSelectedId,
    spaceTargetId,
    activeSpaceId,
    homeFocusRequest,
    homeInput,
    conversationInput,
    navigate,
    onBrainSelect,
    onActiveSpaceChange,
    onOpenInSpace,
  } = navigation;
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
  const surfaceTitle = view === "space"
    ? props.spaces?.find((space) => space.spaceId === activeSpaceId)?.title ?? "空间"
    : isConversationView(view)
      ? activeConversation?.title ?? "新的对话"
      : undefined;

  useEffect(() => {
    setPersonalKnowledgePersistenceEnabled(props.personalKnowledgePersistenceEnabled === true);
  }, [props.personalKnowledgePersistenceEnabled]);

  useEffect(() => {
    const spaces = props.spaces ?? [];
    const firstSpaceId = spaces[0]?.spaceId;
    const nextSpaceId = activeSpaceId !== null && spaces.some((space) => space.spaceId === activeSpaceId)
      ? activeSpaceId
      : firstSpaceId ?? null;
    if (nextSpaceId !== activeSpaceId) onActiveSpaceChange(nextSpaceId);
  }, [activeSpaceId, onActiveSpaceChange, props.spaces]);

  useEffect(() => {
    const firstSpaceId = props.spaces?.[0]?.spaceId;
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
    applyPrefs(loadPrefs());
  }, []);
  return (
    <div
      className="aa-workbench-root flex h-screen min-h-0 w-full overflow-hidden"
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
        .aa-workbench-root .view-enter { animation: viewFadeIn 140ms ease; }
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
        onActiveSpaceChange={onActiveSpaceChange}
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
          surfaceTitle={surfaceTitle}
          brainFileTitle={brainSelectedId === null ? null : resolveById(brainSelectedId)?.title ?? null}
          onBrainRoot={() => onBrainSelect(null)}
        />

        <main
          aria-label={viewLabel(view)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden" key={view}>
            {props.bootstrapState.status === "loading" || (
              isKnowledgeView(view) && (knowledgeLoadState.status === "loading" || knowledgeLoadState.status === "retrying")
            ) ? <WorkbenchBootstrapLoading /> : (
              <DeferredSurfaceBoundary resetKey={view} label="这个视图暂时无法打开">
                  <WorkbenchViewRouter
                    view={view}
                    props={props}
                    activeConversation={activeConversation}
                    homeInput={homeInput}
                    homeFocusRequest={homeFocusRequest}
                    conversationInput={conversationInput}
                    brainSelectedId={brainSelectedId}
                    spaceTargetId={spaceTargetId}
                    activeSpaceId={activeSpaceId}
                    onBrainSelect={onBrainSelect}
                    navigate={navigate}
                    onOpenInSpace={onOpenInSpace}
                  />
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
    case "conv-done": return "对话工作台";
  }
}

function isConversationView(view: View): boolean {
  return view === "conv-active" || view === "conv-done" || view === "focus";
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

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/** @deprecated Use PersonalWorkbench. Kept while the prototype import path is retired. */
export const RedesignWorkbench = PersonalWorkbench;
/** @deprecated Use PersonalWorkbenchProps. */
export type RedesignWorkbenchProps = PersonalWorkbenchProps;
