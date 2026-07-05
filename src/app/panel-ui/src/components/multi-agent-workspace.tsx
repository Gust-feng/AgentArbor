import React from "react";
import type { ChatInputProps } from "./chat-empty";
import { ChatInputBar } from "./chat-empty";
import { selectedComposerModel } from "./chat-session-projection";
import {
  deepRunWorkItemExists,
  type DeepSelectedWorkItem,
} from "../deep-view-model";
import {
  DeepView,
  DeepWorkItemDetailPanel,
} from "./deep-view";
import type {
  DeepConversationView,
  DeepIntakeStatus,
  DeepRunView,
} from "../contracts/deep";

type MultiAgentWorkspaceProps = {
  readonly view: DeepRunView | undefined;
  readonly conversation?: DeepConversationView;
  readonly intakeStatus?: DeepIntakeStatus;
  readonly busy: boolean;
  readonly pendingGoal?: string;
  readonly error?: string;
  readonly inputProps: ChatInputProps;
  readonly childOperationBusyId?: string;
  readonly resynthesisBusy?: boolean;
  readonly onStartConfirmedRun?: (input: {
    readonly intakeTurnId?: string;
    readonly confirmedObjective: string;
    readonly confirmedPlan: string;
  }) => void | Promise<void>;
  readonly onChildMessage?: (childRunId: string, message: string) => void | Promise<void>;
  readonly onChildConfirmation?: (
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ) => void | Promise<void>;
  readonly onResynthesize?: () => void | Promise<void>;
  readonly onStopRun?: () => void | Promise<void>;
};

export function MultiAgentWorkspace(props: MultiAgentWorkspaceProps): React.ReactElement {
  const [selectedWorkItem, setSelectedWorkItem] = React.useState<DeepSelectedWorkItem | undefined>(undefined);
  const assistantModel = React.useMemo(
    () => selectedComposerModel(props.inputProps.models, props.inputProps.selectedModelId),
    [props.inputProps.models, props.inputProps.selectedModelId],
  );
  const hasDetailPanel = props.view !== undefined && selectedWorkItem !== undefined;
  React.useEffect(() => {
    if (props.view === undefined || selectedWorkItem === undefined) {
      return;
    }
    if (!deepRunWorkItemExists(props.view, selectedWorkItem)) {
      setSelectedWorkItem(undefined);
    }
  }, [props.view, selectedWorkItem]);
  return (
    <section className="multi-agent-workspace" aria-label="Agent 集群工作区">
      <div className={`multi-agent-body ${hasDetailPanel ? "with-work-detail" : ""}`}>
        <div className="multi-agent-primary">
          <div className="multi-agent-reading-shell">
            <main className="multi-agent-stage" aria-label="Agent 集群当前运行">
              <DeepView
                view={props.view}
                conversation={props.conversation}
                intakeStatus={props.intakeStatus}
                busy={props.busy}
                pendingGoal={props.pendingGoal}
                assistantModel={assistantModel}
                resynthesisBusy={props.resynthesisBusy || props.childOperationBusyId !== undefined}
                selectedWorkItem={selectedWorkItem}
                onSelectWorkItem={setSelectedWorkItem}
                onStartConfirmedRun={props.onStartConfirmedRun}
                onResynthesize={props.onResynthesize}
                onStopRun={props.onStopRun}
              />
            </main>
            {props.error && <div className="multi-agent-error system-error-line">{props.error}</div>}
            <div className="multi-agent-commandbar">
              <ChatInputBar {...props.inputProps} variant="floating" />
            </div>
          </div>
        </div>
        {props.view !== undefined && selectedWorkItem !== undefined ? (
          <DeepWorkItemDetailPanel
            view={props.view}
            selectedWorkItem={selectedWorkItem}
            busy={props.busy}
            childOperationBusyId={props.childOperationBusyId}
            onClose={() => setSelectedWorkItem(undefined)}
            onChildMessage={props.onChildMessage}
            onChildConfirmation={props.onChildConfirmation}
          />
        ) : null}
      </div>
    </section>
  );
}
