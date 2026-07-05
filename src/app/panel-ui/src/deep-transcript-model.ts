import { splitConversationTurnsAroundRun } from "../../panel-ui-deep-transcript.js";
import type {
  DeepConversationView,
  DeepIntakeStatus,
  DeepIntakeTurn,
  DeepRunFollowUpTurn,
  DeepRunView,
} from "./contracts/deep.js";
import {
  childAgentSummaryItems,
  conclusionNeedsResynthesis,
  parentConclusionText,
  parentDecisionText,
  parentSynthesisText,
  runTranscriptWorkflowItems,
  runWorkflowStatus,
  type DeepRunChildSummaryViewModel,
  type DeepTaskPlanItemViewModel,
} from "./deep-view-model.js";

export type DeepChatItem =
  | {
      readonly kind: "user_goal";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "parent_message";
      readonly id: string;
      readonly label: string;
      readonly text: string;
      readonly tone: "current" | "complete" | "waiting" | "problem";
    }
  | {
      readonly kind: "system_notice";
      readonly id: string;
      readonly text: string;
      readonly tone: "waiting" | "problem" | "complete";
    };

export type DeepPlanConfirmationViewModel = {
  readonly intakeTurnId: string;
  readonly objective: string;
  readonly plan: string;
  readonly assistantMessage: string;
};

export type DeepRunTranscriptBlock =
  | {
      readonly kind: "user_goal";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "assistant_text";
      readonly id: string;
      readonly label: string;
      readonly text: string;
      readonly tone: "current" | "waiting" | "problem" | "complete";
    }
  | {
      readonly kind: "conclusion";
      readonly id: string;
      readonly label: string;
      readonly text: string;
      readonly stale: boolean;
      readonly staleMessage?: string;
    }
  | {
      readonly kind: "child_agent_list";
      readonly id: string;
      readonly children: readonly DeepRunChildSummaryViewModel[];
      readonly status: ReturnType<typeof runWorkflowStatus>;
    }
  | {
      readonly kind: "notice";
      readonly id: string;
      readonly text: string;
      readonly tone: "waiting" | "problem" | "complete";
    };

export type DeepRunTranscriptViewModel = {
  readonly status: ReturnType<typeof runWorkflowStatus>;
  readonly blocks: readonly DeepRunTranscriptBlock[];
  readonly planInsertIndex: number;
  readonly planConfirmation?: DeepPlanConfirmationViewModel;
  readonly workflowItems: readonly DeepTaskPlanItemViewModel[];
  readonly children: readonly DeepRunChildSummaryViewModel[];
};

export type DeepRuntimeHealthNoticeViewModel = {
  readonly state: "stalled" | "orphaned";
  readonly text: string;
  readonly canStop: boolean;
};

export function deepIntakeChatItems(
  turns: readonly DeepIntakeTurn[],
  intakeStatus: DeepIntakeStatus | undefined,
): readonly DeepChatItem[] {
  const items: DeepChatItem[] = [];
  for (const turn of turns) {
    items.push({
      kind: "user_goal",
      id: `intake-user:${turn.turnId}`,
      text: turn.userMessage,
    });
    const assistantTexts = [
      turn.assistantMessage,
      turn.action === "start_collaboration" && turn.plan !== undefined && intakeStatus !== "plan_ready"
        ? turn.plan
        : undefined,
    ].filter((text): text is string => text !== undefined && text.trim().length > 0);
    items.push({
      kind: "parent_message",
      id: `intake-assistant:${turn.turnId}`,
      label: "助手",
      text: assistantTexts.join("\n\n"),
      tone:
        turn.action === "ask_user"
          ? "waiting"
          : turn.action === "direct_answer"
            ? "complete"
            : intakeStatus === "running"
              ? "current"
              : "complete",
    });
  }
  return items;
}

export function deepPlanConfirmationViewModel(
  conversation: DeepConversationView,
  intakeStatus: DeepIntakeStatus | undefined,
): DeepPlanConfirmationViewModel | undefined {
  if (intakeStatus !== "plan_ready") {
    return undefined;
  }
  const turn = [...conversation.intakeTurns].reverse().find(
    (item) => item.action === "start_collaboration" && item.plan !== undefined,
  );
  if (turn === undefined || turn.plan === undefined) {
    return undefined;
  }
  return {
    intakeTurnId: turn.turnId,
    objective: turn.normalizedObjective ?? conversation.currentObjective ?? conversation.goal,
    plan: turn.plan,
    assistantMessage: turn.assistantMessage,
  };
}

export function runtimeHealthNoticeViewModel(
  view: DeepRunView,
): DeepRuntimeHealthNoticeViewModel | undefined {
  const health = view.run.runtimeHealth;
  if (health?.state !== "stalled" && health?.state !== "orphaned") {
    return undefined;
  }
  const lastActivity = formatRuntimeHealthLastActivity(health.lastActivityAt);
  return {
    state: health.state,
    text: health.state === "stalled"
      ? `这次运行一段时间没有新进展，最后活动 ${lastActivity}。`
      : `这次运行已失联，最后活动 ${lastActivity}。`,
    canStop: health.canStop,
  };
}

export function deepRunTranscriptViewModel(
  view: DeepRunView,
  conversation: DeepConversationView | undefined,
  intakeStatus: DeepIntakeStatus | undefined,
  pendingGoal: string | undefined,
): DeepRunTranscriptViewModel {
  const workflowItems = runTranscriptWorkflowItems(view);
  const children = childAgentSummaryItems(view);
  const effectiveConversation = conversation ?? view.conversation;
  const conversationBlocks = effectiveConversation === undefined
    ? {
        leadingBlocks: [],
        trailingBlocks: [],
      }
    : deepConversationTranscriptBlocks(effectiveConversation, view.run.runId, view.run.updatedAt, intakeStatus);
  const blocks = deepRunTranscriptBlocks(
    view,
    children,
    conversationBlocks.leadingBlocks,
    conversationBlocks.trailingBlocks,
    pendingGoal,
  );
  return {
    status: runWorkflowStatus(view),
    blocks,
    planInsertIndex: conversationBlocks.trailingBlocks.length > 0
      ? blocks.length
      : Math.min(conversationBlocks.leadingBlocks.length, blocks.length),
    planConfirmation: effectiveConversation === undefined
      ? undefined
      : deepPlanConfirmationViewModel(effectiveConversation, intakeStatus),
    workflowItems,
    children,
  };
}

function formatRuntimeHealthLastActivity(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "时间未知";
  }
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 60 * 60_000) {
    return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deepRunTranscriptBlocks(
  view: DeepRunView,
  children: readonly DeepRunChildSummaryViewModel[],
  leadingConversationBlocks: readonly DeepRunTranscriptBlock[],
  trailingConversationBlocks: readonly DeepRunTranscriptBlock[],
  pendingGoal: string | undefined,
): readonly DeepRunTranscriptBlock[] {
  const blocks: DeepRunTranscriptBlock[] = [...leadingConversationBlocks];
  if (blocks.length === 0) {
    blocks.push({
      kind: "user_goal",
      id: `goal:${view.run.runId}`,
      text: view.conversation?.currentObjective ?? view.run.goal,
    });
  }

  const childAgentListBlock: DeepRunTranscriptBlock | undefined = children.length === 0
    ? undefined
    : {
        kind: "child_agent_list",
        id: `workflow:${view.run.runId}`,
        children,
        status: runWorkflowStatus(view),
      };
  const decisionText = parentDecisionText(view);
  const decisionBlock: DeepRunTranscriptBlock | undefined = decisionText === undefined
    ? undefined
    : {
        kind: "assistant_text",
        id: `decision:${view.liveProjection.decision?.decisionId ?? view.run.runId}`,
        label: "助手",
        text: decisionText,
        tone: view.liveProjection.phase === "needs_input" ? "waiting" : "current",
      };
  const decisionComesBeforeChildren = managerDecisionComesBeforeChildren(view);
  if (decisionComesBeforeChildren && decisionBlock !== undefined) {
    blocks.push(decisionBlock);
  }
  if (childAgentListBlock !== undefined) {
    blocks.push(childAgentListBlock);
  }
  if (!decisionComesBeforeChildren && decisionBlock !== undefined) {
    blocks.push(decisionBlock);
  }

  const synthesisText = parentSynthesisText(view);
  const conclusionText = parentConclusionText(view.report?.conclusion, view.liveProjection.conclusion);
  const staleConclusion = conclusionNeedsResynthesis(view, conclusionText);
  if (synthesisText !== undefined && conclusionText === undefined) {
    blocks.push({
      kind: "assistant_text",
      id: `synthesis:${view.liveProjection.synthesis?.synthesisId ?? view.report?.reportId ?? view.run.runId}`,
      label: "助手",
      text: synthesisText,
      tone: view.liveProjection.synthesis?.status === "pending" ? "waiting" : "current",
    });
  }

  if (conclusionText !== undefined) {
    blocks.push({
      kind: "conclusion",
      id: `conclusion:${view.report?.conclusion.conclusionId ?? view.liveProjection.conclusion?.conclusionId ?? view.run.runId}`,
      label: "助手",
      text: conclusionText,
      stale: staleConclusion,
      staleMessage: staleConclusion ? "协作材料已更新，当前结论待重新综合。" : undefined,
    });
  }

  const notice = parentNotice(view);
  if (notice !== undefined) {
    blocks.push({
      kind: "notice",
      id: notice.id,
      text: notice.text,
      tone: notice.tone,
    });
  }

  blocks.push(...trailingConversationBlocks);

  const pending = pendingGoal?.trim();
  if (
    pending !== undefined &&
    pending.length > 0 &&
    !trailingConversationBlocks.some((block) => block.kind === "user_goal" && block.text.trim() === pending)
  ) {
    blocks.push({
      kind: "user_goal",
      id: `pending-goal:${view.run.runId}`,
      text: pending,
    });
  }

  return blocks;
}

function parentNotice(
  view: DeepRunView,
): Extract<DeepChatItem, { readonly kind: "system_notice" }> | undefined {
  if (view.liveProjection.phase === "needs_input") {
    return {
      kind: "system_notice",
      id: `needs-input:${view.run.runId}`,
      text: "等待你补充要求或范围。",
      tone: "waiting",
    };
  }
  if (view.run.status === "stopped") {
    return {
      kind: "system_notice",
      id: `stopped:${view.run.runId}`,
      text: "已停止，已有材料已保留。",
      tone: "complete",
    };
  }
  if (view.run.status === "failed") {
    return {
      kind: "system_notice",
      id: `failed:${view.run.runId}`,
      text: "运行失败，已记录可用过程。",
      tone: "problem",
    };
  }
  return undefined;
}

function managerDecisionComesBeforeChildren(view: DeepRunView): boolean {
  if (view.liveProjection.children.length === 0) {
    return true;
  }
  const decisionId = view.liveProjection.decision?.decisionId;
  if (decisionId !== undefined) {
    const decisionEvent = view.eventSequence.find((event) =>
      event.type === "deep.manager.decided" &&
      event.refs.some((ref) => ref.kind === "delegation_decision" && ref.refId === decisionId)
    );
    const firstChildEvent = view.eventSequence.find((event) => isChildLifecycleEvent(event.type));
    if (decisionEvent !== undefined && firstChildEvent !== undefined) {
      return decisionEvent.sequence < firstChildEvent.sequence;
    }
  }
  return view.liveProjection.decision?.action === "spawn_children";
}

function isChildLifecycleEvent(type: DeepRunView["eventSequence"][number]["type"]): boolean {
  return type.startsWith("deep.child.");
}

function deepConversationTranscriptBlocks(
  conversation: DeepConversationView,
  activeRunId: string,
  runUpdatedAt: string,
  intakeStatus: DeepIntakeStatus | undefined,
): {
  readonly leadingBlocks: readonly DeepRunTranscriptBlock[];
  readonly trailingBlocks: readonly DeepRunTranscriptBlock[];
} {
  const { leadingTurns, trailingTurns } = splitConversationTurnsAroundRun(conversation.intakeTurns, runUpdatedAt);
  return {
    leadingBlocks: deepConversationTurnTranscriptBlocks(leadingTurns, activeRunId, intakeStatus),
    trailingBlocks: [
      ...deepConversationTurnTranscriptBlocks(trailingTurns, activeRunId, intakeStatus),
      ...deepRunFollowUpTranscriptBlocks(conversation.followUpTurns ?? [], activeRunId),
    ],
  };
}

function deepConversationTurnTranscriptBlocks(
  turns: readonly DeepIntakeTurn[],
  activeRunId: string,
  intakeStatus: DeepIntakeStatus | undefined,
): readonly DeepRunTranscriptBlock[] {
  const blocks: DeepRunTranscriptBlock[] = [];
  for (const item of deepIntakeChatItems(turns, intakeStatus)) {
    if (item.kind === "user_goal") {
      blocks.push({
        kind: "user_goal",
        id: `conversation:${activeRunId}:${item.id}`,
        text: item.text,
      });
      continue;
    }
    if (item.kind === "system_notice") {
      blocks.push({
        kind: "notice",
        id: `conversation:${activeRunId}:${item.id}`,
        text: item.text,
        tone: item.tone,
      });
      continue;
    }
    blocks.push({
      kind: "assistant_text",
      id: `conversation:${activeRunId}:${item.id}`,
      label: item.label,
      text: item.text,
      tone: item.tone,
    });
  }
  return blocks;
}

function deepRunFollowUpTranscriptBlocks(
  turns: readonly DeepRunFollowUpTurn[],
  activeRunId: string,
): readonly DeepRunTranscriptBlock[] {
  return turns
    .filter((turn) => turn.runId === activeRunId)
    .map((turn) => ({
      kind: "user_goal" as const,
      id: `follow-up:${activeRunId}:${turn.turnId}`,
      text: turn.userMessage,
    }));
}
