import { resolveModelIconSvg } from "../model-icons";
import { modelProviderDisplayName, resolveModelProviderIdentity, type ModelProviderIdentity } from "../model-provider-logos";
import type { ConversationTurn } from "../contracts/conversation";
import type {
  AgentDeliverable,
  BasicAgentRun,
  DesktopRunDetail,
  DesktopWorkSession,
  TranscriptNode,
} from "../contracts/run";
import { terminalStatuses } from "../ui-state";
import type { LiveAnswerProjection } from "../../../panel-ui-live-transcript";
import type { ChatModelOption } from "./chat-empty";
import { normalizeComparableText } from "./chat-visible-text";
import { nodesForRun } from "./transcript-node-visibility";

export type AssistantModelBadge = {
  readonly modelName: string;
  readonly providerLabel: string;
  readonly providerIdentity: ModelProviderIdentity;
  readonly iconSvg?: string;
};

export function showStandaloneRun(input: {
  readonly turns: readonly ConversationTurn[];
  readonly run?: BasicAgentRun;
  readonly transcriptNodes: readonly TranscriptNode[];
  readonly answer?: string;
  readonly liveAnswer?: LiveAnswerProjection;
  readonly pending?: unknown;
  readonly deliverable?: AgentDeliverable;
  readonly statusNotice?: { readonly title: string; readonly message: string; readonly tone: "warning" | "error" };
}): boolean {
  const runId = input.run?.runId;
  if (runId === undefined) return false;
  const hasAssistantTurnForRun = input.turns.some((turn) => turn.role === "assistant" && turn.runId === runId);
  if (hasAssistantTurnForRun) return false;
  return nodesForRun(input.transcriptNodes, runId).length > 0 ||
    input.liveAnswer !== undefined ||
    input.pending !== undefined ||
    input.deliverable !== undefined ||
    input.answer !== undefined ||
    (input.run !== undefined && !terminalStatuses.has(input.run.status) && input.statusNotice === undefined);
}

export function visibleTurns(turns: readonly ConversationTurn[], activeRunId: string | undefined): readonly ConversationTurn[] {
  return turns.filter((turn) =>
    turn.role === "user" ||
    hasRunId(turn.runId) ||
    turn.content.trim().length > 0 ||
    (activeRunId !== undefined && turn.role === "assistant" && turn.runId === activeRunId)
  );
}

export function assistantModelForTurn(
  turn: ConversationTurn,
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  if (turn.responseModel !== undefined) {
    if (isSyntheticResponseModel(turn)) {
      return undefined;
    }
    const matched = models.find(
      (model) =>
        model.profileId === turn.responseModel?.profileId &&
        model.modelId === turn.responseModel?.model
    );
    if (matched !== undefined) {
      return modelBadgeFromOption(matched);
    }
    const identity = resolveModelProviderIdentity({
      title: turn.responseModel.label,
      profileId: turn.responseModel.profileId,
      baseUrl: turn.responseModel.baseUrl,
      model: turn.responseModel.model,
    });
    return {
      modelName: turn.responseModel.model ?? turn.responseModel.label ?? "模型",
      providerLabel: identity === "unknown" ? turn.responseModel.label ?? "模型" : modelProviderDisplayName(identity),
      providerIdentity: identity,
      iconSvg: identity === "unknown" ? undefined : resolveModelIconSvg(identity),
    };
  }
  return selectedComposerModel(models, selectedModelId);
}

export function selectedComposerModel(
  models: readonly ChatModelOption[],
  selectedModelId: string
): AssistantModelBadge | undefined {
  const selected = models.find((model) => model.id === selectedModelId);
  return selected === undefined ? undefined : modelBadgeFromOption(selected);
}

export function visibleDeliverable(
  deliverable: AgentDeliverable | undefined,
  answer: string | undefined,
  latestAssistantContent: string | undefined
): AgentDeliverable | undefined {
  if (deliverable === undefined) return undefined;
  if (isDuplicateAnswerDeliverable(deliverable, answer) || isDuplicateAnswerDeliverable(deliverable, latestAssistantContent)) {
    return undefined;
  }
  return deliverable;
}

export function visibleRunProblem(
  run: BasicAgentRun | undefined,
  workSession: DesktopWorkSession | undefined,
  detail: DesktopRunDetail | undefined,
  error: string | undefined
): { readonly title: string; readonly message: string; readonly tone: "warning" | "error" } | undefined {
  if (error !== undefined) {
    return { title: "系统错误", message: error, tone: "error" };
  }
  if (run?.status === "blocked" || run?.status === "paused") {
    return {
      title: workSession?.headline ?? "任务没有完成",
      message: visibleBlockedMessage(detail?.error?.code, detail?.error?.message) ?? workSession?.currentAction ?? "任务暂停了。你可以继续发送消息让我接着处理。",
      tone: "warning",
    };
  }
  if (run?.status === "failed") {
    return {
      title: "这次没有完成",
      message: detail?.error?.message ?? workSession?.currentAction ?? "模型没有返回可用结果。你可以补充材料或重新发起。",
      tone: "error",
    };
  }
  return undefined;
}

export function visibleResultText(detail: DesktopRunDetail | undefined): string | undefined {
  return (
    detail?.canvas?.agent?.answer?.answer ??
    detail?.canvas?.workSession?.directAnswer?.answer ??
    detail?.canvas?.workSession?.report?.decisionSummary ??
    detail?.restoredResult?.summary
  );
}

function hasRunId(runId: string | undefined): boolean {
  return runId !== undefined && runId.trim().length > 0;
}

function isSyntheticResponseModel(turn: ConversationTurn): boolean {
  const profileId = turn.responseModel?.profileId?.trim().toLowerCase() ?? "";
  const model = turn.responseModel?.model?.trim().toLowerCase() ?? "";
  const providerKind = turn.responseModel?.providerKind?.trim().toLowerCase() ?? "";
  return profileId === "default" && model.length === 0 ||
    profileId === "fake" ||
    profileId === "none" ||
    model === "fake" ||
    model === "none" ||
    providerKind === "fake" ||
    providerKind === "none";
}

function modelBadgeFromOption(model: ChatModelOption): AssistantModelBadge {
  return {
    modelName: model.name,
    providerLabel: model.providerLabel,
    providerIdentity: model.providerIdentity,
    iconSvg: model.iconSvg,
  };
}

function isDuplicateAnswerDeliverable(deliverable: AgentDeliverable, answer: string | undefined): boolean {
  if (answer === undefined || answer.trim().length === 0) return false;
  const normalizedAnswer = normalizeComparableText(answer);
  if (normalizeComparableText(deliverable.summary) === normalizedAnswer) return true;
  return deliverable.sections.some((section) => normalizeComparableText(section.content) === normalizedAnswer);
}

function visibleBlockedMessage(code: string | undefined, message: string | undefined): string | undefined {
  if (code === "out_of_fuel") {
    return "这轮调用次数已到上限，任务没有完成。你可以继续发送消息让我接着处理。";
  }
  return message;
}
