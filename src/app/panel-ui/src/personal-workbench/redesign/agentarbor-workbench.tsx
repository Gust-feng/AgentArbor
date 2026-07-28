import { Check, FileSearch, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CurrentRunProjection } from "../../app-run-projection";
import { projectChatActiveView } from "../../chat-active-view";
import { ChatTranscriptDisplay } from "../../components/chat-transcript-display";
import type { ChatInputProps } from "../../components/chat-empty";
import { WorkbenchSettingsDialog } from "../../components/workbench-settings-dialog";
import type { AppUpdateInfo } from "../../contracts/app-update";
import type { Conversation, ConversationSummary } from "../../contracts/conversation";
import type { PendingConfirmation, TranscriptNode } from "../../contracts/run";
import type { ConfirmationProjection } from "../../components/transcript-timeline";
import type { PersonalSpaceActions, PersonalSpaceProjection } from "../space";
import { BrainPage } from "./app/components/BrainPage";
import { ConversationPage, PrototypeConversationComposer, type LiveConversationState } from "./app/components/ConversationPage";
import { FocusMode } from "./app/components/FocusMode";
import { HomePage } from "./app/components/HomePage";
import { type View, Sidebar } from "./app/components/Sidebar";
import { SpacePage } from "./app/components/SpacePage";
import { TopBar } from "./app/components/TopBar";
import { SearchPage } from "./app/components/SearchPage";
import { resolveById } from "./app/components/brainStore";
import { applyPrefs, loadPrefs } from "./app/components/readingPrefs";
import { RunPanel, type RunStep } from "./app/components/RunPanel";

export type RedesignWorkbenchProps = {
  readonly isBootstrapping: boolean;
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
  readonly onOpenConversation: (conversationId: string) => void | Promise<void>;
  readonly spaces?: readonly PersonalSpaceProjection[];
  readonly onOpenSpace?: (spaceId: string) => void | Promise<void>;
  readonly onOpenSpaceItem?: (spaceId: string, itemId: string) => void | Promise<void>;
  readonly onCreateSpace?: (title: string) => void | Promise<void>;
  readonly spaceActions?: PersonalSpaceActions;
  readonly onOpenSettings: () => void;
  readonly settingsDialogProps?: React.ComponentProps<typeof WorkbenchSettingsDialog>;
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
  const [pendingRuntimePrompt, setPendingRuntimePrompt] = useState<string | undefined>();

  const activeConversation = props.conversation;
  const hasAttention = needsConversationAttention(props);

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
    if (target !== "space") setSpaceTargetId(null);
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
        onNavigate={navigate}
        onOpenSettings={props.onOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          view={view}
          onNavigate={navigate}
          onSearch={() => navigate("search")}
          sidebarCollapsed={props.sidebarCollapsed}
          onToggleSidebar={props.onToggleSidebar}
          brainFileTitle={brainSelectedId === null ? null : resolveById(brainSelectedId)?.title ?? null}
          onBrainRoot={() => setBrainSelectedId(null)}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden" key={view}>
            {props.isBootstrapping ? <PrototypeRuntimeLoading /> : renderView({
              view,
              props,
              activeConversation,
              conversationInput,
              brainSelectedId,
              spaceTargetId,
              onBrainSelect: setBrainSelectedId,
              navigate,
              onOpenInSpace: (id) => {
                setSpaceTargetId(id);
                setView("space");
              },
              startRuntime,
            })}
          </div>
        </main>
      </div>

      {props.settingsDialogProps !== undefined && <WorkbenchSettingsDialog {...props.settingsDialogProps} />}
    </div>
  );
}

function renderView(input: {
  readonly view: View;
  readonly props: RedesignWorkbenchProps;
  readonly activeConversation?: Conversation;
  readonly conversationInput: ChatInputProps;
  readonly brainSelectedId: string | null;
  readonly spaceTargetId: string | null;
  readonly onBrainSelect: (id: string | null) => void;
  readonly navigate: (view: View) => void;
  readonly onOpenInSpace: (id: string) => void;
  readonly startRuntime: (message: string) => void;
}) {
  if (input.view === "home") {
    return <HomePage
      onNavigate={input.navigate}
      onStartConversation={input.startRuntime}
    />;
  }
  if (input.view === "space") {
    return <SpacePage onNavigate={input.navigate} targetId={input.spaceTargetId} />;
  }
  if (input.view === "brain") {
    return <BrainPage selectedId={input.brainSelectedId} onSelect={input.onBrainSelect} />;
  }
  if (input.view === "search") {
    return <SearchPage
      onNavigate={input.navigate}
      onOpenInSpace={input.onOpenInSpace}
    />;
  }
  if (input.view === "focus") {
    return <ConversationSurface props={input.props} conversation={input.activeConversation} input={input.conversationInput} focus onExitFocus={() => input.navigate("conv-active")} />;
  }
  return <ConversationSurface props={input.props} conversation={input.activeConversation} input={input.conversationInput} onEnterFocus={() => input.navigate("focus")} />;
}

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
    <ChatTranscriptDisplay
      conversationId={props.conversation?.conversationId}
      projectedTurns={active.workline.turns}
      turns={props.conversation?.turns ?? []}
      currentRunId={active.currentRunId}
      currentRunNodes={active.currentRunProjection.nodes}
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
        composer: <PrototypeConversationComposer input={pageProps.input} />,
      }}
      onExit={props.onExitFocus ?? (() => undefined)}
    />;
  }
  return <ConversationPage live={{ ...pageProps, onFocus: props.onEnterFocus }} />;
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
