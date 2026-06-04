import {
  assistantMessageOutput,
  type AssistantDeliverableLike,
} from "./panel-assistant-message-output.js";
import {
  projectAgentWorkTimelineView,
  type AgentWorkTimelineView,
} from "./panel-agent-work-timeline-view.js";
import {
  type ConfirmationIdentity,
} from "./panel-transcript-confirmation-projection.js";
import {
  type ProjectableTranscriptNode,
} from "./panel-transcript-node-projection.js";
import type { LiveAnswerTone } from "./panel-ui-live-transcript.js";

export type AssistantMessageAnswerView = {
  readonly text: string;
  readonly copyText: string;
  readonly showActions: boolean;
  readonly live: boolean;
  readonly animateOnMount: boolean;
  readonly tone: LiveAnswerTone;
};

export type AssistantMessageView<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity = ConfirmationIdentity,
> = {
  readonly timeline: AgentWorkTimelineView<TNode, TConfirmation>;
  readonly hasTimeline: boolean;
  readonly awaitingFirstVisibleOutput: boolean;
  readonly answer?: AssistantMessageAnswerView;
};

export function projectAssistantMessageView<
  TNode extends ProjectableTranscriptNode,
  TConfirmation extends ConfirmationIdentity = ConfirmationIdentity,
>(input: {
  readonly content: string;
  readonly deliverable?: AssistantDeliverableLike;
  readonly transcriptNodes?: readonly TNode[];
  readonly pending?: TConfirmation;
  readonly live?: boolean;
  readonly keepStreamMounted?: boolean;
  readonly animateOnMount?: boolean;
  readonly liveTone?: LiveAnswerTone;
}): AssistantMessageView<TNode, TConfirmation> {
  const output = assistantMessageOutput({ content: input.content, deliverable: input.deliverable });
  const timeline = projectAgentWorkTimelineView({
    nodes: input.transcriptNodes ?? [],
    pending: input.pending,
  });
  const live = input.live === true;
  const keepStreamMounted = live || input.keepStreamMounted === true;
  const animateAnswerOnMount = keepStreamMounted || input.animateOnMount === true;
  return {
    timeline,
    hasTimeline: timeline.hasContent,
    awaitingFirstVisibleOutput: !output.hasAnswer && !timeline.hasContent && keepStreamMounted,
    answer: output.hasAnswer
      ? {
          text: output.text,
          copyText: output.text,
          showActions: !keepStreamMounted,
          live: keepStreamMounted,
          animateOnMount: animateAnswerOnMount,
          tone: input.liveTone ?? "formal",
        }
      : undefined,
  };
}
