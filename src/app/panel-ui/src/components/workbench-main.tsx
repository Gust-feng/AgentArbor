import React from "react";
import type { CurrentRunProjection } from "../app-run-projection";
import { ChatActive } from "./chat-active";
import { ChatEmpty, type ChatInputProps } from "./chat-empty";
import { MultiAgentWorkspace } from "./multi-agent-workspace";
import { WorkbenchBootstrapLoading } from "./workbench-bootstrap-loading";

type WorkbenchMainProps = {
  readonly isBootstrapping: boolean;
  readonly deepActive: boolean;
  readonly chatScreen: "chat-empty" | "chat-active";
  readonly startupIntroActive: boolean;
  readonly error?: string;
  readonly inputProps: ChatInputProps;
  readonly deepInputProps: ChatInputProps;
  readonly conversation: React.ComponentProps<typeof ChatActive>["conversation"];
  readonly currentRun: CurrentRunProjection;
  readonly showModelUsage: boolean;
  readonly pendingConfirmation: React.ComponentProps<typeof ChatActive>["pendingConfirmation"];
  readonly onDecision: React.ComponentProps<typeof ChatActive>["onDecision"];
  readonly confirmationBusy: boolean;
  readonly queuedMessages: React.ComponentProps<typeof ChatActive>["queuedMessages"];
  readonly onRemoveQueuedMessage: React.ComponentProps<typeof ChatActive>["onRemoveQueuedMessage"];
  readonly onUpdateQueuedMessage: React.ComponentProps<typeof ChatActive>["onUpdateQueuedMessage"];
  readonly deepView: React.ComponentProps<typeof MultiAgentWorkspace>["view"];
  readonly deepConversation: React.ComponentProps<typeof MultiAgentWorkspace>["conversation"];
  readonly deepIntakeStatus: React.ComponentProps<typeof MultiAgentWorkspace>["intakeStatus"];
  readonly deepBusy: boolean;
  readonly deepPendingGoal: React.ComponentProps<typeof MultiAgentWorkspace>["pendingGoal"];
  readonly deepChildOperationBusyId: React.ComponentProps<typeof MultiAgentWorkspace>["childOperationBusyId"];
  readonly deepResynthesisBusy: React.ComponentProps<typeof MultiAgentWorkspace>["resynthesisBusy"];
  readonly onStartConfirmedRun: React.ComponentProps<typeof MultiAgentWorkspace>["onStartConfirmedRun"];
  readonly onChildMessage: React.ComponentProps<typeof MultiAgentWorkspace>["onChildMessage"];
  readonly onChildConfirmation: React.ComponentProps<typeof MultiAgentWorkspace>["onChildConfirmation"];
  readonly onResynthesize: React.ComponentProps<typeof MultiAgentWorkspace>["onResynthesize"];
  readonly onStopRun: React.ComponentProps<typeof MultiAgentWorkspace>["onStopRun"];
};

export function WorkbenchMain(props: WorkbenchMainProps): React.ReactElement {
  if (props.isBootstrapping) {
    return <WorkbenchBootstrapLoading />;
  }

  if (props.deepActive) {
    return (
      <MultiAgentWorkspace
        view={props.deepView}
        conversation={props.deepConversation}
        intakeStatus={props.deepIntakeStatus}
        busy={props.deepBusy}
        pendingGoal={props.deepPendingGoal}
        error={props.error}
        inputProps={props.deepInputProps}
        childOperationBusyId={props.deepChildOperationBusyId}
        resynthesisBusy={props.deepResynthesisBusy}
        onStartConfirmedRun={props.onStartConfirmedRun}
        onChildMessage={props.onChildMessage}
        onChildConfirmation={props.onChildConfirmation}
        onResynthesize={props.onResynthesize}
        onStopRun={props.onStopRun}
      />
    );
  }

  if (props.chatScreen === "chat-empty") {
    return (
      <ChatEmpty
        {...props.inputProps}
        autoFocus={!props.startupIntroActive}
        error={props.error}
      />
    );
  }

  return (
    <ChatActive
      {...props.inputProps}
      conversation={props.conversation}
      run={props.currentRun.run}
      workView={props.currentRun.workView}
      transcriptNodes={props.currentRun.transcriptNodes}
      detail={props.currentRun.detail}
      live={props.currentRun.live}
      showModelUsage={props.showModelUsage}
      error={props.error}
      pendingConfirmation={props.pendingConfirmation}
      onDecision={props.onDecision}
      confirmationBusy={props.confirmationBusy}
      queuedMessages={props.queuedMessages}
      onRemoveQueuedMessage={props.onRemoveQueuedMessage}
      onUpdateQueuedMessage={props.onUpdateQueuedMessage}
    />
  );
}
