import type { Constraint } from "../../domain/contracts.js";
import type { ModelCallRef, ModelMessage } from "../../domain/intelligence/index.js";
import {
  isUndergroundAutonomyAction,
  ROOTLET_CLUSTER_KINDS,
  type CandidatePool,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundAutonomyDecision,
  type UndergroundAutonomySpawnRequest,
  type UndergroundAutonomyStopReason,
  type UndergroundExplorationCycle,
  type RootletClusterKind,
} from "../../domain/underground/index.js";
import { createId, nowIso } from "../../kernel/id.js";
import type { AgentTurnPolicy, AgentTurnRuntime, AgentTurnRuntimeResult } from "../../kernel/intelligence/index.js";

const MAX_AUTONOMY_TEXT_LENGTH = 600;
const MAX_AUTONOMY_ARRAY_ITEMS = 8;

export type RequestUndergroundAutonomyDecisionInput = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly goal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly cycle: UndergroundExplorationCycle;
  readonly cycles: readonly UndergroundExplorationCycle[];
  readonly maxCycles: number;
};

export type AutonomyDecisionParseInput = {
  readonly decisionId: string;
  readonly cycleId: string;
  readonly candidatePool: CandidatePool;
  readonly modelCallRefs: readonly ModelCallRef[];
  readonly toolSourceRefs: readonly string[];
};

export function createUndergroundAutonomyTurnPolicy(input: {
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
}): AgentTurnPolicy {
  return {
    allowModel: true,
    allowedTools: ["search", "read"],
    maxModelRounds: 3,
    maxToolRounds: 2,
    fallback: "disabled",
    callerAgentId: input.callerAgentId,
    traceId: input.traceId,
    goalId: input.goalId,
    purpose: "autonomy_decision",
    outputContract: {
      contractId: "underground.autonomy_decision.v1",
      outputKind: "explanation",
      format: "json_object",
      requiredFields: ["action", "completionAssessment", "informationGaps", "spawnRequests", "rationale"],
      requiredStringFields: ["action", "completionAssessment", "rationale"],
      visibleOutput: {
        fields: ["action", "completionAssessment", "rationale"],
        fieldTypes: {
          action: "string",
          completionAssessment: "string",
          rationale: "string",
        },
        maxFieldLength: 240,
      },
    },
    sensitivity: "internal",
    budget: { maxOutputTokens: 512, maxLatencyMs: 15_000 },
  };
}

export const AUTONOMY_DECISION_CONTRACT = createUndergroundAutonomyTurnPolicy({
  callerAgentId: "underground-autonomy-reviewer",
  traceId: "placeholder",
  goalId: "placeholder",
}).outputContract!;

export function parseAutonomyDecisionAsReasoningResult(
  output: unknown,
  input: AutonomyDecisionParseInput,
): import("./agents/reasoning.js").UndergroundReasoningParseResult<UndergroundAutonomyDecision> {
  const parsed = parseAutonomyDecisionOutput({
    decisionId: input.decisionId,
    cycleId: input.cycleId,
    output,
    candidatePool: input.candidatePool,
    modelCallRefs: input.modelCallRefs,
    toolSourceRefs: input.toolSourceRefs,
  });
  if (parsed.status === "failed") {
    return {
      ok: false,
      reason: parsed.stopReason ?? "autonomy_decision_failed",
      decisionSummary: parsed.rationale,
      uncertainty: parsed.rationale,
      confidence: 0.18,
    };
  }
  return {
    ok: true,
    value: parsed,
    decisionSummary: parsed.rationale,
    uncertainty: parsed.informationGaps.join("; ") || "Autonomy review completed.",
    confidence: parsed.status === "completed" ? 0.72 : 0.18,
  };
}

export async function requestUndergroundAutonomyDecision(
  input: RequestUndergroundAutonomyDecisionInput
): Promise<UndergroundAutonomyDecision> {
  const decisionId = createId("autonomy-decision");
  if (input.agentTurnRuntime === undefined) {
    return failedAutonomyDecision({
      decisionId,
      cycleId: input.cycle.explorationCycleId,
      candidatePoolId: input.candidatePool.poolId,
      reason: "ai_required_for_autonomy",
      rationale: "Autonomy review is AI-required and no AgentTurnRuntime was provided.",
    });
  }

  const turn = await input.agentTurnRuntime.execute({
    policy: createUndergroundAutonomyTurnPolicy({
      callerAgentId: "underground-autonomy-core",
      traceId: input.traceId,
      goalId: input.goalId,
    }),
    requestId: decisionId,
    callerRef: {
      kind: "convergence_review",
      id: "underground-autonomy-core",
      label: "autonomy_review",
    },
    inputRefs: [
      { kind: "goal", id: input.goalId },
      { kind: "candidate_pool", id: input.candidatePool.poolId },
    ],
    sanitizedMessages: buildAutonomyDecisionMessages(input),
    constraintRefs: input.constraints.map((constraint) => ({
      constraintId: constraint.id,
      requiredLevel: constraint.level,
      enforcementGate: constraint.enforcementGate,
    })),
    requestedAt: nowIso(),
  });

  if (turn.status !== "completed" || turn.finalOutput?.status !== "completed" || turn.finalOutput.validation.status !== "passed") {
    return failedAutonomyDecision({
      decisionId,
      cycleId: input.cycle.explorationCycleId,
      candidatePoolId: input.candidatePool.poolId,
      reason: "autonomy_decision_failed",
      rationale: "Autonomy model call failed or did not pass output validation.",
      modelCallRefs: [modelCallRefFromTurn(turn)],
      sourceRefs: toolSourceRefsFromTurn(turn),
    });
  }

  const toolSourceRefs = toolSourceRefsFromTurn(turn);
  const parsed = parseAutonomyDecisionOutput({
    decisionId,
    cycleId: input.cycle.explorationCycleId,
    output: turn.finalOutput.structuredOutput,
    candidatePool: input.candidatePool,
    modelCallRefs: [modelCallRefFromTurn(turn)],
    toolSourceRefs,
  });

  if (parsed.status === "failed") {
    return parsed;
  }

  if (parsed.action === "continue_exploration" && input.cycles.length >= input.maxCycles) {
    return failedAutonomyDecision({
      decisionId,
      cycleId: input.cycle.explorationCycleId,
      candidatePoolId: input.candidatePool.poolId,
      reason: "autonomy_cycle_guard_exceeded",
      rationale: "Autonomy requested more exploration after the run-scoped cycle guard was reached.",
      modelCallRefs: [modelCallRefFromTurn(turn)],
      sourceRefs: toolSourceRefs,
    });
  }

  return parsed;
}

export function buildAutonomyDecisionMessages(input: RequestUndergroundAutonomyDecisionInput): readonly ModelMessage[] {
  const candidateLines = input.candidatePool.candidates.map((candidate) =>
    [
      `- candidateId=${candidate.id}`,
      `  status=${candidate.status}`,
      `  kind=${candidate.kind}`,
      `  clusterId=${candidate.clusterId}`,
      `  summary=${truncate(candidate.summary ?? "", 180)}`,
    ].join("\n")
  );
  const rootletLines = input.rootletOutputs.map((output) =>
    `- ${output.kind} outputId=${output.outputId} evidenceRefs=${output.evidenceRefs.length} summary=${truncate(output.summary, 180)}`
  );

  return [
    {
      role: "system",
      content: [
        "You are the underground autonomy core for AgentArbor.",
        "Review the current CandidatePool after a rootlet exploration cycle.",
        "Choose exactly one action: continue_exploration, request_convergence, request_user_clarification, or stop.",
        "You cannot approve a Plan. Convergence Judge and Plan Steward remain the only promotion path.",
        "If continuing exploration, provide runtime-only spawnRequests mapped to existing rootletKind values.",
        "Return JSON only with action, completionAssessment, informationGaps, spawnRequests, rationale, and optional sourceRefs.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal: ${input.goal}`,
        `Cycle: ${input.cycle.explorationCycleId} index=${input.cycle.cycleIndex}`,
        `Completed cycles: ${input.cycles.length}/${input.maxCycles}`,
        "",
        ...(input.goalIntentProfile === undefined
          ? []
          : [
              "GoalIntentProfile:",
              `- goalStatement: ${input.goalIntentProfile.goalStatement}`,
              `- unknowns: ${input.goalIntentProfile.unknowns.join("; ") || "none"}`,
              `- acceptanceCriteria: ${input.goalIntentProfile.acceptanceCriteria.join("; ") || "none"}`,
              "",
            ]),
        "CandidatePool:",
        ...candidateLines,
        "",
        "Rootlet outputs:",
        ...rootletLines,
        "",
        "Hard constraints:",
        ...input.constraints
          .filter((constraint) => constraint.level === "hard")
          .map((constraint) => `- ${constraint.id}: ${truncate(constraint.statement, 140)}`),
        ...(input.constraints.filter((constraint) => constraint.level === "hard").length === 0 ? ["- none"] : []),
      ].join("\n"),
    },
  ];
}

function parseAutonomyDecisionOutput(input: {
  readonly decisionId: string;
  readonly cycleId: string;
  readonly output: unknown;
  readonly candidatePool: CandidatePool;
  readonly modelCallRefs: readonly ModelCallRef[];
  readonly toolSourceRefs: readonly string[];
}): UndergroundAutonomyDecision {
  const record = asRecord(input.output);
  const action = stringOrUndefined(record.action);
  if (action === undefined || !isUndergroundAutonomyAction(action)) {
    return failedAutonomyDecision({
      decisionId: input.decisionId,
      cycleId: input.cycleId,
      candidatePoolId: input.candidatePool.poolId,
      reason: "autonomy_decision_failed",
      rationale: "Autonomy model returned an invalid action.",
      modelCallRefs: input.modelCallRefs,
      sourceRefs: input.toolSourceRefs,
    });
  }

  const candidateIds = new Set(input.candidatePool.candidates.map((candidate) => candidate.id));
  const sourceRefs = stringArray(record.sourceRefs).map(sanitizeText).filter((value) => value.length > 0);
  if (sourceRefs.some((ref) => ref.startsWith("candidate-") && !candidateIds.has(ref))) {
    return failedAutonomyDecision({
      decisionId: input.decisionId,
      cycleId: input.cycleId,
      candidatePoolId: input.candidatePool.poolId,
      reason: "autonomy_decision_failed",
      rationale: "Autonomy model referenced an unknown candidate id.",
      modelCallRefs: input.modelCallRefs,
      sourceRefs: input.toolSourceRefs,
    });
  }

  const spawnRequests = parseSpawnRequests(record.spawnRequests);
  if (spawnRequests === undefined || (action === "continue_exploration" && spawnRequests.length === 0)) {
    return failedAutonomyDecision({
      decisionId: input.decisionId,
      cycleId: input.cycleId,
      candidatePoolId: input.candidatePool.poolId,
      reason: "autonomy_decision_failed",
      rationale: "Autonomy model returned invalid or missing rootlet spawn requests.",
      modelCallRefs: input.modelCallRefs,
      sourceRefs: input.toolSourceRefs,
    });
  }

  return {
    decisionId: input.decisionId,
    cycleId: input.cycleId,
    action,
    completionAssessment: sanitizeText(stringOrUndefined(record.completionAssessment) ?? ""),
    informationGaps: limitedStringArray(record.informationGaps),
    spawnRequests,
    rationale: sanitizeText(stringOrUndefined(record.rationale) ?? ""),
    sourceRefs: unique([input.candidatePool.poolId, ...sourceRefs, ...input.toolSourceRefs]),
    modelCallRefs: input.modelCallRefs.map(cloneModelCallRef),
    status: "completed",
    stopReason: action === "stop" ? "autonomy_stopped" : undefined,
  };
}

function parseSpawnRequests(value: unknown): UndergroundAutonomySpawnRequest[] | undefined {
  if (!Array.isArray(value)) {
    return [];
  }
  const requests: UndergroundAutonomySpawnRequest[] = [];
  for (const item of value.slice(0, MAX_AUTONOMY_ARRAY_ITEMS)) {
    const record = asRecord(item);
    const rootletKind = stringOrUndefined(record.rootletKind);
    if (!isRootletClusterKind(rootletKind)) {
      return undefined;
    }
    requests.push({
      requestId: stringOrUndefined(record.requestId) ?? createId("autonomy-spawn"),
      rootletKind,
      specialistLabel: optionalSanitizedString(record.specialistLabel),
      objective: sanitizeText(stringOrUndefined(record.objective) ?? `Explore ${rootletKind} gap from autonomy review.`),
      informationNeeds: limitedStringArray(record.informationNeeds),
      sourceHints: limitedStringArray(record.sourceHints),
      expectedEvidence: limitedStringArray(record.expectedEvidence),
      rationale: sanitizeText(stringOrUndefined(record.rationale) ?? ""),
    });
  }
  return requests;
}

export function failedAutonomyDecision(input: {
  readonly decisionId: string;
  readonly cycleId: string;
  readonly candidatePoolId: string;
  readonly reason: UndergroundAutonomyStopReason;
  readonly rationale: string;
  readonly modelCallRefs?: readonly ModelCallRef[];
  readonly sourceRefs?: readonly string[];
}): UndergroundAutonomyDecision {
  return {
    decisionId: input.decisionId,
    cycleId: input.cycleId,
    action: "stop",
    completionAssessment: "Autonomy review did not complete.",
    informationGaps: [],
    spawnRequests: [],
    rationale: sanitizeText(input.rationale),
    sourceRefs: unique([input.candidatePoolId, input.reason, ...(input.sourceRefs ?? [])]),
    modelCallRefs: (input.modelCallRefs ?? []).map(cloneModelCallRef),
    status: "failed",
    stopReason: input.reason,
  };
}

function modelCallRefFromTurn(turn: AgentTurnRuntimeResult): ModelCallRef {
  const response = turn.finalOutput;
  return {
    requestId: turn.modelRequestId ?? "unknown-autonomy-model-request",
    responseId: turn.modelResponseId,
    providerId: response?.providerId,
    model: response?.model,
    outputKind: response?.outputKind ?? "explanation",
    eventRefs: [
      "model.requested",
      response?.status === "completed" ? "model.completed" : "model.failed",
    ].filter((value): value is string => value !== undefined),
    validationStatus: response?.validation.status ?? "pending",
  };
}

function toolSourceRefsFromTurn(turn: AgentTurnRuntimeResult): string[] {
  return unique(
    turn.toolCalls.flatMap((toolCall) => [
      `tool-call:${toolCall.callId}`,
      ...researchRefsFromValue(toolCall.output),
    ])
  );
}

export function researchRefsFromValue(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string") {
    return value.startsWith("research:") ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => researchRefsFromValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      researchRefsFromValue(item, depth + 1)
    );
  }
  return [];
}

function cloneModelCallRef(ref: ModelCallRef): ModelCallRef {
  return {
    ...ref,
    eventRefs: [...ref.eventRefs],
  };
}

function limitedStringArray(value: unknown): string[] {
  return stringArray(value).slice(0, MAX_AUTONOMY_ARRAY_ITEMS).map(sanitizeText).filter((item) => item.length > 0);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function optionalSanitizedString(value: unknown): string | undefined {
  const parsed = stringOrUndefined(value);
  return parsed === undefined ? undefined : sanitizeText(parsed);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function isRootletClusterKind(value: string | undefined): value is RootletClusterKind {
  return value !== undefined && (ROOTLET_CLUSTER_KINDS as readonly string[]).includes(value);
}

function sanitizeText(value: string): string {
  return truncate(value.trim(), MAX_AUTONOMY_TEXT_LENGTH);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
