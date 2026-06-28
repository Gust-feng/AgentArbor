import React from "react";
import type { ChatInputProps } from "./chat-empty";
import { ChatInputBar } from "./chat-empty";
import { DeepChildInspector, DeepCollaborationIndex, DeepView } from "./deep-view";
import type {
  DeepConversationView,
  DeepIntakeStatus,
  DeepRunStatus,
  DeepRunSummary,
  DeepRunView,
} from "../contracts/deep";

type MultiAgentWorkspaceProps = {
  readonly view: DeepRunView | undefined;
  readonly conversation?: DeepConversationView;
  readonly intakeStatus?: DeepIntakeStatus;
  readonly busy: boolean;
  readonly pendingGoal?: string;
  readonly runs: readonly DeepRunSummary[];
  readonly activeRunId?: string;
  readonly error?: string;
  readonly inputProps: ChatInputProps;
  readonly childOperationBusyId?: string;
  readonly resynthesisBusy?: boolean;
  readonly onChildMessage?: (childRunId: string, message: string) => void | Promise<void>;
  readonly onChildConfirmation?: (
    childRunId: string,
    confirmationId: string,
    decision: "approve_once" | "deny" | "guidance",
    guidance?: string,
  ) => void | Promise<void>;
  readonly onResynthesize?: () => void | Promise<void>;
};

export function MultiAgentWorkspace(props: MultiAgentWorkspaceProps): React.ReactElement {
  const [selectedChildRunId, setSelectedChildRunId] = React.useState<string | undefined>(undefined);
  const activeSummary = selectedRun(props.runs, props.activeRunId);
  const status = props.view?.run.status ?? activeSummary?.status ?? (props.busy ? "running" : undefined);
  const updatedAt = props.view?.run.updatedAt ?? props.conversation?.updatedAt ?? activeSummary?.updatedAt;
  const collaborationChildren = props.view?.liveProjection.children ?? [];
  const selectedChildExists =
    selectedChildRunId !== undefined &&
    collaborationChildren.some((child) => child.childRunId === selectedChildRunId) === true;
  const hasSidePanel = props.view !== undefined && collaborationChildren.length > 0;
  React.useEffect(() => {
    if (selectedChildRunId === undefined) {
      return;
    }
    if (props.view === undefined || !props.view.liveProjection.children.some((child) => child.childRunId === selectedChildRunId)) {
      setSelectedChildRunId(undefined);
    }
  }, [props.view, selectedChildRunId]);
  return (
    <section className="multi-agent-workspace" aria-label="多 Agent 工作区">
      <div className={`multi-agent-body ${hasSidePanel ? "with-side-panel" : ""} ${selectedChildExists ? "with-child-inspector" : ""}`}>
        <div className="multi-agent-primary">
          <div className="multi-agent-reading-shell">
            <main className="multi-agent-stage" aria-label="多 Agent 当前运行">
              <DeepView
                view={props.view}
                conversation={props.conversation}
                intakeStatus={props.intakeStatus}
                busy={props.busy}
                pendingGoal={props.pendingGoal}
                selectedChildRunId={selectedChildRunId}
                onSelectChild={setSelectedChildRunId}
                childOperationBusyId={props.childOperationBusyId}
                resynthesisBusy={props.resynthesisBusy}
                onChildMessage={props.onChildMessage}
                onChildConfirmation={props.onChildConfirmation}
                onResynthesize={props.onResynthesize}
              />
            </main>
            {props.error && <div className="multi-agent-error system-error-line">{props.error}</div>}
            <div className="multi-agent-commandbar">
              <ChatInputBar {...props.inputProps} variant="floating" />
            </div>
          </div>
        </div>
        {props.view !== undefined && selectedChildExists ? (
          <DeepChildInspector
            view={props.view}
            selectedChildRunId={selectedChildRunId}
            busy={props.busy}
            childOperationBusyId={props.childOperationBusyId}
            onClose={() => setSelectedChildRunId(undefined)}
            onChildMessage={props.onChildMessage}
            onChildConfirmation={props.onChildConfirmation}
          />
        ) : props.view !== undefined && hasSidePanel ? (
          <DeepCollaborationIndex
            children={collaborationChildren}
            activeChildRunId={props.view.liveProjection.activeNodeId}
            selectedChildRunId={selectedChildRunId}
            runStatusLabel={statusLabel(status, props.busy, props.intakeStatus)}
            updatedLabel={updatedAt === undefined ? undefined : formatRelativeTime(updatedAt)}
            onSelectChild={setSelectedChildRunId}
          />
        ) : null}
      </div>
    </section>
  );
}

function selectedRun(
  runs: readonly DeepRunSummary[],
  activeRunId: string | undefined,
): DeepRunSummary | undefined {
  return activeRunId === undefined ? undefined : runs.find((run) => run.runId === activeRunId);
}

function statusLabel(
  status: DeepRunStatus | undefined,
  busy: boolean,
  intakeStatus: DeepIntakeStatus | undefined,
): string {
  if (busy && status === undefined) {
    return "理解中";
  }
  if (intakeStatus === "needs_input") {
    return "等待补充";
  }
  if (intakeStatus === "answered") {
    return "已回答";
  }
  if (busy && (status === undefined || status === "running" || status === "pending")) {
    return "协作中";
  }
  switch (status) {
    case "pending":
      return "待启动";
    case "running":
      return "运行中";
    case "interrupted":
      return "已打断";
    case "corrected":
      return "已修正";
    case "stopped":
      return "已停止";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未开始";
  }
}

function formatRelativeTime(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "未知";
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 60 * 60_000) {
    return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}
