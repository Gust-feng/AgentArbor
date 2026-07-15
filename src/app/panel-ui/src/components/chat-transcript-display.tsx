import React, { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ConversationTurn } from "../contracts/conversation";
import type {
  AgentDeliverable,
  BasicAgentRun,
  DesktopWorkView,
  TranscriptNode,
} from "../contracts/run";
import type { LiveRunBuffer } from "../../../panel-read-model/run/panel-run-live-buffer";
import type { WorklineProjectedTurn } from "../../../panel-read-model/assistant/panel-assistant-workline";
import type { LiveRunTranscriptProjection } from "../../../panel-read-model/transcript/panel-live-transcript";
import { projectConversationDisplayList } from "../../../panel-conversation/panel-conversation-display-list";
import { createConversationWorkflowDisplayState } from "../../../panel-conversation/panel-conversation-workflow-display";
import { shouldCollapseStandaloneTimeline } from "../../../panel-read-model/assistant/panel-assistant-timeline-collapse";
import {
  getTranscriptNodesCache,
  subscribeTranscriptNodesCache,
  transcriptNodesCacheForConversation,
} from "../panel-ui-transcript-store";
import type { ChatModelOption } from "./chat-empty";
import { TranscriptChain } from "./chat-transcript-chain";
import type { ConfirmationProjection } from "./transcript-timeline";

export function ChatTranscriptDisplay(props: {
  readonly conversationId?: string;
  readonly projectedTurns: readonly WorklineProjectedTurn<ConversationTurn>[];
  readonly turns: readonly ConversationTurn[];
  readonly currentRunId?: string;
  readonly currentRunNodes: readonly TranscriptNode[];
  readonly run?: BasicAgentRun;
  readonly live?: LiveRunBuffer;
  readonly workView?: DesktopWorkView;
  readonly pending?: ConfirmationProjection;
  readonly showModelUsage: boolean;
  readonly standaloneRun?: {
    readonly currentRunId?: string;
    readonly runStatus?: string;
    readonly answer?: string;
    readonly deliverable?: AgentDeliverable;
    readonly runProjection: LiveRunTranscriptProjection & {
      readonly nodes: readonly TranscriptNode[];
    };
    readonly pending?: ConfirmationProjection;
  };
  readonly models: readonly ChatModelOption[];
  readonly selectedModelId: string;
  readonly onDecision: (decision: "approve_once" | "deny" | "guidance", guidance?: string) => void;
  readonly confirmationBusy: boolean;
  readonly hiddenEarlierTurnCount?: number;
  readonly onShowEarlierTurns?: () => void;
}): React.ReactElement | null {
  const conversationDisplayStateRef = useRef(
    createConversationWorkflowDisplayState<ConversationTurn, TranscriptNode, AgentDeliverable, ConfirmationProjection>(),
  );
  const cachedHistoricalSnapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeTranscriptNodesCache(props.conversationId, listener),
      [props.conversationId],
    ),
    getTranscriptNodesCache,
    getTranscriptNodesCache,
  );
  const cachedHistoricalNodes = transcriptNodesCacheForConversation(
    cachedHistoricalSnapshot,
    props.conversationId,
  );
  const conversationDisplay = useMemo(() => {
    const collapseTimeline = shouldCollapseStandaloneTimeline({
      runStatus: props.standaloneRun?.runStatus,
      hasPendingConfirmation: props.standaloneRun?.pending !== undefined,
    });
    return projectConversationDisplayList({
      previous: conversationDisplayStateRef.current,
      conversationId: props.conversationId,
      projectedTurns: props.projectedTurns,
      turns: props.turns,
      cachedNodesByRunId: cachedHistoricalNodes,
      currentRunId: props.currentRunId,
      currentRunNodes: props.currentRunNodes,
      run: props.run,
      live: props.live,
      workView: props.workView,
      pending: props.pending,
      standaloneRun: props.standaloneRun === undefined
        ? undefined
        : {
            ...props.standaloneRun,
            collapseTimeline,
          },
    });
  }, [
    cachedHistoricalNodes,
    props.conversationId,
    props.projectedTurns,
    props.turns,
    props.currentRunId,
    props.currentRunNodes,
    props.run,
    props.live,
    props.workView,
    props.pending,
    props.standaloneRun,
  ]);

  useLayoutEffect(() => {
    conversationDisplayStateRef.current = conversationDisplay.state;
  }, [conversationDisplay.state]);

  return (
    <TranscriptChain
      items={conversationDisplay.items}
      models={props.models}
      selectedModelId={props.selectedModelId}
      showModelUsage={props.showModelUsage}
      onDecision={props.onDecision}
      confirmationBusy={props.confirmationBusy}
      hiddenEarlierTurnCount={props.hiddenEarlierTurnCount}
      onShowEarlierTurns={props.onShowEarlierTurns}
    />
  );
}
