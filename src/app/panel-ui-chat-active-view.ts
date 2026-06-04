import {
  projectChatActive,
  type ChatActiveConversation,
  type ChatActiveProjection,
  type ChatActiveRun,
  type ChatActiveStatusNotice,
  type ChatActiveTranscriptNode,
} from "./panel-ui-chat-active-projection.js";
import type { LiveRunBuffer } from "./panel-ui-live-run-buffer.js";
import { firstNonEmptyText } from "./panel-assistant-output.js";
import {
  visibleDeliverable,
  type AssistantDeliverableLike,
} from "./panel-assistant-message-output.js";
import {
  visibleResultText,
  visibleRunProblem,
  type AssistantRunDetailLike,
  type AssistantWorkSessionProblemLike,
} from "./panel-assistant-run-output.js";
import { workflowVisibleNodes } from "./panel-transcript-node-projection.js";
import type { ConfirmationIdentity } from "./panel-transcript-confirmation-projection.js";

export type ChatActiveWorkSessionLike<
  TDeliverable extends AssistantDeliverableLike,
  TPending extends ConfirmationIdentity,
  TNode extends ChatActiveTranscriptNode,
> = AssistantWorkSessionProblemLike & {
  readonly run: {
    readonly runId: string;
  };
  readonly answer?: {
    readonly content?: string;
  };
  readonly deliverable?: TDeliverable;
  readonly pendingConfirmation?: TPending;
  readonly transcriptNodes?: readonly TNode[];
};

export type ChatActiveDetailLike<TNode extends ChatActiveTranscriptNode> = AssistantRunDetailLike & {
  readonly runId?: string;
  readonly transcript?: {
    readonly transcriptNodes?: readonly TNode[];
  };
};

export type ChatActiveViewInput<
  TDeliverable extends AssistantDeliverableLike,
  TPending extends ConfirmationIdentity,
  TNode extends ChatActiveTranscriptNode,
> = {
  readonly conversation?: ChatActiveConversation;
  readonly run?: ChatActiveRun;
  readonly workSession?: ChatActiveWorkSessionLike<TDeliverable, TPending, TNode>;
  readonly transcriptNodes: readonly TNode[];
  readonly detail?: ChatActiveDetailLike<TNode>;
  readonly live?: LiveRunBuffer;
  readonly error?: string;
  readonly pendingConfirmation?: TPending;
};

export type ChatActiveViewProjection<
  TDeliverable extends AssistantDeliverableLike,
  TPending extends ConfirmationIdentity,
> = ChatActiveProjection<TDeliverable, TPending>;

export type { ChatActiveStatusNotice as ChatStatusNotice };

export function projectChatActiveView<
  TDeliverable extends AssistantDeliverableLike,
  TPending extends ConfirmationIdentity,
  TNode extends ChatActiveTranscriptNode,
>(input: ChatActiveViewInput<TDeliverable, TPending, TNode>): ChatActiveViewProjection<TDeliverable, TPending> {
  const transcriptNodes = workflowVisibleNodes(input.transcriptNodes);
  const currentRunId = input.run?.runId ?? input.conversation?.activeRunId ?? input.conversation?.latestRunId ?? input.live?.runId;
  const currentRunAssistantTurn = currentRunId === undefined
    ? undefined
    : [...(input.conversation?.turns ?? [])].reverse().find((turn) => (
        turn.role === "assistant" &&
        turn.runId === currentRunId &&
        turn.content.trim().length > 0
      ));
  const detailAnswer = input.detail?.runId === undefined || currentRunId === undefined || input.detail.runId === currentRunId
    ? visibleResultText(input.detail)
    : undefined;
  const workSessionAnswer = input.workSession?.answer?.content;
  const answer = firstNonEmptyText([
    workSessionAnswer,
    detailAnswer,
    currentRunAssistantTurn?.content,
  ]);
  const pending = input.workSession?.pendingConfirmation ?? input.pendingConfirmation;
  return projectChatActive({
    conversation: input.conversation,
    run: input.run,
    transcriptNodes,
    live: input.live,
    workSessionAnswer,
    detailAnswer,
    pending,
    deliverable: visibleDeliverable(input.workSession?.deliverable, answer, currentRunAssistantTurn?.content),
    problem: visibleRunProblem(input.run, input.workSession, input.detail, input.error),
    appError: input.error,
  });
}
