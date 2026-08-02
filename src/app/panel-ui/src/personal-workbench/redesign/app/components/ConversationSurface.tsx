import type { CurrentRunProjection } from "../../../../app-run-projection";
import { projectChatActiveView } from "../../../../chat-active-view";
import type { ChatInputProps } from "../../../../contracts/composer";
import type { Conversation } from "../../../../contracts/conversation";
import type { PendingConfirmation } from "../../../../contracts/run";
import type { ConfirmationProjection } from "./ConfirmationCard";
import type { PersonalWorkbenchProps } from "../../agentarbor-workbench";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationPage, type LiveConversationState } from "./ConversationPage";
import { DeferredSurfaceBoundary } from "./DeferredSurfaceBoundary";
import { FocusMode } from "./FocusMode";
import { RedesignTranscript } from "./RedesignTranscript";

export function ConversationSurface(props: {
  readonly props: PersonalWorkbenchProps;
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
  const pageProps = {
    title: props.conversation?.title ?? "新的对话",
    state,
    scrollKey: `${props.conversation?.conversationId ?? "new-conversation"}:${active.currentRunId ?? "idle"}`,
    content,
    input: composerInput,
  };

  if (props.focus) {
    return <FocusMode
      title={pageProps.title}
      state={pageProps.state}
      scrollKey={pageProps.scrollKey}
      content={pageProps.content}
      composer={<ConversationComposer input={pageProps.input} />}
      onExit={props.onExitFocus ?? (() => undefined)}
    />;
  }
  return <ConversationPage {...pageProps} onFocus={props.onEnterFocus} />;
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

function isFailedRun(status: string | undefined): boolean {
  return status === "failed" || status === "blocked" || status === "cancelled";
}
