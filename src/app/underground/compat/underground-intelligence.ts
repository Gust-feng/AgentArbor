/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ② 确定性编排主线（线性函数式编排）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { AgentTurnPermissionPolicy, Constraint } from "../../../domain/contracts.js";
import type {
  ModelOutputValidationResult,
  ModelResponse,
} from "../../../domain/intelligence/index.js";
import type { ToolCallResult } from "../../../domain/tools/index.js";
import type {
  GoalIntentProfile,
  RootletClusterPlan,
  RootletOutput,
  UndergroundAgentInvocation,
} from "../../../domain/underground/index.js";
import { createId, nowIso } from "../../../kernel/id.js";
import type { AgentTurnPolicy, AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import { getUndergroundRootletCandidateAdviceContract } from "../intelligence-contracts.js";
import {
  formatUndergroundRootletCandidateAdviceSummary,
  parseUndergroundRootletCandidateAdviceOutput,
} from "../intelligence-output.js";
import { buildUndergroundRootletCandidateAdviceMessages, type SoilRefSummary } from "../intelligence-prompts.js";
import { createRootletOutputForInvocation } from "../primitives/underground-rootlets.js";

export type UndergroundRootletCandidateAdviceRequestResult = {
  readonly rootletOutputs: readonly RootletOutput[];
  readonly modelRequestId: string;
  readonly modelResponseId?: string;
  readonly status: "completed" | "failed" | "empty";
  readonly validationStatus: ModelOutputValidationResult["status"];
  readonly fallbackSourceRefs: readonly string[];
};

export function createUndergroundRootletAgentTurnPolicy(input: {
  readonly basePolicy: AgentTurnPermissionPolicy;
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
  readonly kind: RootletClusterPlan["kind"];
}): AgentTurnPolicy {
  const adviceContract = getUndergroundRootletCandidateAdviceContract(input.kind);
  return {
    allowModel: input.basePolicy.allowModel,
    allowedTools: input.basePolicy.allowedTools,
    maxModelRounds: input.basePolicy.maxModelRounds,
    maxToolRounds: input.basePolicy.maxToolRounds,
    fallback: input.basePolicy.fallback,
    callerAgentId: input.callerAgentId,
    traceId: input.traceId,
    goalId: input.goalId,
    purpose: "rootlet_candidate",
    outputContract: adviceContract.modelOutputContract,
    budget: {
      maxOutputTokens: 256,
      maxLatencyMs: 30_000,
    },
    sensitivity: "internal",
  };
}

export async function requestUndergroundRootletCandidateAdvice(input: {
  readonly agentTurnRuntime: AgentTurnRuntime;
  readonly turnPolicy: AgentTurnPolicy;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly goalIntentProfile: GoalIntentProfile;
  readonly cluster: RootletClusterPlan;
  readonly invocation: UndergroundAgentInvocation;
  readonly constraints: readonly Constraint[];
  readonly sourceRefs?: readonly string[];
  readonly soilRefs?: readonly SoilRefSummary[];
  readonly historicalPathBias?: string;
}): Promise<UndergroundRootletCandidateAdviceRequestResult> {
  const requestId = createId("model-request");
  const adviceContract = getUndergroundRootletCandidateAdviceContract(input.cluster.kind);
  const turn = await input.agentTurnRuntime.execute({
    policy: input.turnPolicy,
    requestId,
    callerRef: { kind: "rootlet", id: input.cluster.clusterId, label: input.cluster.kind },
    inputRefs: [
      { kind: "goal", id: input.goalId },
      { kind: "rootlet", id: input.cluster.clusterId, label: input.cluster.kind },
    ],
    sanitizedMessages: buildUndergroundRootletCandidateAdviceMessages({
      goal: input.goal,
      goalIntentProfile: input.goalIntentProfile,
      cluster: input.cluster,
      constraints: input.constraints,
      soilRefs: input.soilRefs,
      historicalPathBias: input.historicalPathBias,
    }),
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    requestedAt: nowIso(),
  });
  const response: ModelResponse | undefined = turn.finalOutput;
  const toolCalls = turn.toolCalls;

  if (
    response === undefined ||
    turn.status !== "completed"
  ) {
    return {
      rootletOutputs: [],
      modelRequestId: turn.modelRequestId ?? requestId,
      modelResponseId: turn.modelResponseId,
      status: "failed",
      validationStatus: response?.validation.status ?? "pending",
      fallbackSourceRefs: [
        ...modelFallbackSourceRefs({
          kind: input.cluster.kind,
          requestId: turn.modelRequestId ?? requestId,
          responseId: turn.modelResponseId,
          reason: turn.stoppedReason,
          terminalEvent: response === undefined ? undefined : response.status === "completed" ? "model.completed" : "model.failed",
        }),
        ...toolCallSourceRefs(toolCalls),
      ],
    };
  }

  if (response.status !== "completed" || response.validation.status !== "passed") {
    return {
      rootletOutputs: [],
      modelRequestId: response.requestId,
      modelResponseId: response.responseId,
      status: "failed",
      validationStatus: response.validation.status,
      fallbackSourceRefs: [
        ...modelFallbackSourceRefs({
          kind: input.cluster.kind,
          requestId: response.requestId,
          responseId: response.responseId,
          reason: response.failure?.kind ?? "output_validation",
          terminalEvent: "model.failed",
        }),
        ...toolCallSourceRefs(toolCalls),
      ],
    };
  }

  const parsed = parseUndergroundRootletCandidateAdviceOutput({
    kind: input.cluster.kind,
    output: response.structuredOutput,
    maxCandidates: input.cluster.budget.maxCandidateOutputs,
  });
  if (parsed.candidates.length === 0) {
    return {
      rootletOutputs: [],
      modelRequestId: response.requestId,
      modelResponseId: response.responseId,
      status: "empty",
      validationStatus: response.validation.status,
      fallbackSourceRefs: [
        ...modelFallbackSourceRefs({
          kind: input.cluster.kind,
          requestId: response.requestId,
          responseId: response.responseId,
          reason: parsed.issues.length > 0 ? "app_output_parse" : "empty_candidates",
          terminalEvent: "model.completed",
        }),
        ...toolCallSourceRefs(toolCalls),
      ],
    };
  }

  return {
    rootletOutputs: parsed.candidates.map((candidate) =>
      createRootletOutputForInvocation({
        goalId: input.goalId,
        cluster: input.cluster,
        invocation: input.invocation,
        constraints: [...input.constraints],
        goalIntentProfile: input.goalIntentProfile,
        summary: formatUndergroundRootletCandidateAdviceSummary(candidate),
        source: "ai",
        sourceRefs: [
          ...(input.sourceRefs ?? []),
          "model.requested",
          "model.completed",
          response.requestId,
          response.responseId,
          adviceContract.modelOutputContract.contractId,
          `model-candidate:${input.cluster.kind}:${candidate.sourceIndex + 1}`,
          ...toolCallSourceRefs(toolCalls),
          ...researchRefsFromToolCalls(toolCalls),
        ],
        evidenceRefs: [
          `model-call:${response.responseId}`,
          ...completedToolEvidenceRefs(toolCalls),
          ...researchRefsFromToolCalls(toolCalls),
        ],
      })
    ),
    modelRequestId: response.requestId,
    modelResponseId: response.responseId,
    status: "completed",
    validationStatus: response.validation.status,
    fallbackSourceRefs: [],
  };
}

function toolCallSourceRefs(toolCalls: readonly ToolCallResult[]): string[] {
  return toolCalls.flatMap((toolCall) => [
    `tool-call:${toolCall.callId}`,
    `tool:${toolCall.toolName}:${toolCall.status}`,
    toolCall.status === "completed" ? "tool.completed" : "tool.failed",
  ]);
}

function completedToolEvidenceRefs(toolCalls: readonly ToolCallResult[]): string[] {
  return toolCalls
    .filter((toolCall) => toolCall.status === "completed")
    .map((toolCall) => `tool-call:${toolCall.callId}`);
}

function researchRefsFromToolCalls(toolCalls: readonly ToolCallResult[]): string[] {
  const refs = new Set<string>();
  for (const toolCall of toolCalls) {
    if (toolCall.status !== "completed") {
      continue;
    }
    collectResearchRefs(toolCall.output, refs, 0);
  }
  return [...refs];
}

function collectResearchRefs(value: unknown, refs: Set<string>, depth: number): void {
  if (depth > 8 || value === undefined || value === null) {
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith("research:")) {
      refs.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectResearchRefs(item, refs, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  for (const [key, item] of Object.entries(value as Readonly<Record<string, unknown>>)) {
    if (key === "contentPreview" || key === "snippet" || key === "summary") {
      continue;
    }
    collectResearchRefs(item, refs, depth + 1);
  }
}

function modelFallbackSourceRefs(input: {
  readonly kind: RootletClusterPlan["kind"];
  readonly requestId: string;
  readonly responseId?: string;
  readonly reason: string;
  readonly terminalEvent?: "model.completed" | "model.failed";
}): string[] {
  return [
    `ai-fallback:${input.kind}`,
    `ai-fallback-reason:${input.reason}`,
    input.terminalEvent === undefined ? undefined : "model.requested",
    input.terminalEvent,
    input.requestId,
    input.responseId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}
