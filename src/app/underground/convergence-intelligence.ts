/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { Constraint } from "../../domain/contracts.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type {
  CandidatePool,
  GoalIntentProfile,
  RootletOutput,
} from "../../domain/underground/index.js";
import type { AgentTurnPolicy, AgentTurnRuntime } from "../../kernel/intelligence/index.js";
import { createId, nowIso } from "../../kernel/id.js";

export type ConvergenceAiAdvisory = {
  readonly advisoryId: string;
  readonly recommendedOptionId?: string;
  readonly candidateAnalyses: readonly CandidateAiAnalysis[];
  readonly conflictsNeedingUserInput: readonly string[];
  readonly constraintViolations: readonly string[];
  readonly overallDirectionSummary: string;
  readonly modelRequestId?: string;
  readonly modelResponseId?: string;
  readonly status: "completed" | "failed";
};

export type CandidateAiAnalysis = {
  readonly candidateId: string;
  readonly kind: string;
  readonly contentDifference: string;
  readonly whyPreferred: string;
  readonly conflictWith: readonly string[];
};

export type RequestConvergenceAiAdvisoryInput = {
  readonly agentTurnRuntime: AgentTurnRuntime;
  readonly turnPolicy: AgentTurnPolicy;
  readonly goalId: string;
  readonly goal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
};

export type RequestConvergenceAiAdvisoryForCandidatePoolInput = Omit<
  RequestConvergenceAiAdvisoryInput,
  "turnPolicy"
> & {
  readonly traceId: string;
};

export async function requestConvergenceAiAdvisoryForCandidatePool(
  input: RequestConvergenceAiAdvisoryForCandidatePoolInput
): Promise<ConvergenceAiAdvisory> {
  return requestConvergenceAiAdvisory({
    ...input,
    turnPolicy: createConvergenceAiAdvisoryTurnPolicy({
      callerAgentId: "underground-convergence-judge",
      traceId: input.traceId,
      goalId: input.goalId,
    }),
  });
}

export function createConvergenceAiAdvisoryTurnPolicy(input: {
  readonly callerAgentId: string;
  readonly traceId: string;
  readonly goalId: string;
}): AgentTurnPolicy {
  return {
    allowModel: true,
    allowedTools: [],
    maxModelRounds: 1,
    maxToolRounds: 0,
    fallback: "deterministic",
    callerAgentId: input.callerAgentId,
    traceId: input.traceId,
    goalId: input.goalId,
    purpose: "convergence_advisory",
    outputContract: {
      contractId: "convergence-advisory",
      outputKind: "explanation",
      format: "json_object",
      requiredFields: [
        "candidateAnalyses",
        "conflictsNeedingUserInput",
        "constraintViolations",
        "overallDirectionSummary",
      ],
      requiredStringFields: ["overallDirectionSummary"],
    },
    sensitivity: "internal",
    budget: { maxOutputTokens: 512, maxLatencyMs: 15_000 },
  };
}

export async function requestConvergenceAiAdvisory(
  input: RequestConvergenceAiAdvisoryInput
): Promise<ConvergenceAiAdvisory> {
  const advisoryId = createId("convergence-advisory");
  const messages = buildConvergenceAdvisoryMessages(input);

  try {
    const turn = await input.agentTurnRuntime.execute({
      policy: input.turnPolicy,
      requestId: advisoryId,
      callerRef: { kind: "convergence_review", id: "underground-convergence-judge", label: "convergence" },
      inputRefs: [
        { kind: "goal", id: input.goalId },
        { kind: "candidate_pool", id: input.candidatePool.poolId },
      ],
      sanitizedMessages: messages,
      constraintRefs: input.constraints.map((constraint) => ({
        constraintId: constraint.id,
        requiredLevel: constraint.level,
        enforcementGate: constraint.enforcementGate,
      })),
      requestedAt: nowIso(),
    });

    const response = turn.finalOutput;
    if (response === undefined || response.status !== "completed" || response.validation.status !== "passed") {
      return failedAdvisory(advisoryId);
    }

    const parsed = parseConvergenceAdvisory(response.structuredOutput, advisoryId);
    if (parsed === undefined) {
      return failedAdvisory(advisoryId);
    }
    return {
      ...parsed,
      modelRequestId: turn.modelRequestId,
      modelResponseId: turn.modelResponseId,
    };
  } catch {
    return failedAdvisory(advisoryId);
  }
}

function buildConvergenceAdvisoryMessages(
  input: RequestConvergenceAiAdvisoryInput
): readonly ModelMessage[] {
  const candidateSummaries = input.rootletOutputs.map((output) => {
    const candidateIds = input.candidatePool.candidates
      .filter((candidate) => candidate.sourceRefs.includes(output.outputId))
      .map((candidate) => candidate.id);
    return [
      `- [${output.kind}] outputId=${output.outputId}`,
      `  candidates: ${candidateIds.length > 0 ? candidateIds.join(", ") : "none"}`,
      `  summary: ${truncate(output.summary, 200)}`,
      `  evidenceRefs: ${output.evidenceRefs.length}`,
      `  constraintRefs: ${output.constraintRefs.map((ref) => ref.constraintId).join(", ") || "none"}`,
    ].join("\n");
  });

  return [
    {
      role: "system",
      content: [
        "You are the convergence advisory AI for AgentArbor's underground agent cluster.",
        "Your job is to analyze candidate outputs from multiple rootlets and provide advisory recommendations.",
        "Return JSON only. Your output is advisory for the current implementation; Convergence Judge must still write the final report through CandidatePool, hard-constraint, and package-validation guards.",
        "",
        "You must analyze:",
        "1. Which candidates represent truly different directions (not just rephrased versions of the same idea)",
        "2. Which candidates violate hard constraints",
        "3. Which candidate is the strongest recommendation as the primary direction, and why",
        "4. Which conflicts between candidates require user confirmation",
        "5. A one-paragraph overall direction summary synthesizing all candidate insights",
        "",
        "Output contract: { recommendedOptionId?: string, candidateAnalyses: [{candidateId, kind, contentDifference, whyPreferred, conflictWith}], conflictsNeedingUserInput: [string], constraintViolations: [string], overallDirectionSummary: string }",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal: ${input.goal}`,
        "",
        ...(input.goalIntentProfile !== undefined
          ? [
              "GoalIntentProfile:",
              `- goalStatement: ${input.goalIntentProfile.goalStatement}`,
              `- keyConcepts: ${input.goalIntentProfile.keyConcepts.join("; ") || "none"}`,
              `- nonGoals: ${input.goalIntentProfile.nonGoals.join("; ") || "none"}`,
              `- acceptanceCriteria: ${input.goalIntentProfile.acceptanceCriteria.join("; ") || "none"}`,
              "",
            ]
          : []),
        "Hard constraints:",
        ...input.constraints
          .filter((constraint) => constraint.level === "hard")
          .map((constraint) => `- ${constraint.id}: ${truncate(constraint.statement, 120)}`),
        ...(input.constraints.filter((constraint) => constraint.level === "hard").length === 0
          ? ["- none"]
          : []),
        "",
        "Rootlet outputs and their candidates:",
        ...candidateSummaries,
        "",
        "Analyze the candidates and return your advisory JSON.",
      ].join("\n"),
    },
  ];
}

function parseConvergenceAdvisory(
  structuredOutput: unknown,
  advisoryId: string
): Omit<ConvergenceAiAdvisory, "modelRequestId" | "modelResponseId"> | undefined {
  const record = asRecord(structuredOutput);
  if (
    !Array.isArray(record.candidateAnalyses) ||
    !Array.isArray(record.conflictsNeedingUserInput) ||
    !Array.isArray(record.constraintViolations) ||
    typeof record.overallDirectionSummary !== "string" ||
    record.overallDirectionSummary.trim().length === 0
  ) {
    return undefined;
  }
  const candidateAnalysesRaw = Array.isArray(record.candidateAnalyses) ? record.candidateAnalyses : [];
  const candidateAnalyses: CandidateAiAnalysis[] = candidateAnalysesRaw
    .map((item) => {
      const r = asRecord(item);
      return {
        candidateId: stringOrFallback(r.candidateId, ""),
        kind: stringOrFallback(r.kind, ""),
        contentDifference: stringOrFallback(r.contentDifference, ""),
        whyPreferred: stringOrFallback(r.whyPreferred, ""),
        conflictWith: Array.isArray(r.conflictWith) ? r.conflictWith.filter((v): v is string => typeof v === "string") : [],
      };
    })
    .filter((analysis) => analysis.candidateId.length > 0);

  return {
    advisoryId,
    recommendedOptionId: stringOrUndefined(record.recommendedOptionId),
    candidateAnalyses,
    conflictsNeedingUserInput: stringArray(record.conflictsNeedingUserInput),
    constraintViolations: stringArray(record.constraintViolations),
    overallDirectionSummary: stringOrFallback(record.overallDirectionSummary, ""),
    status: "completed",
  };
}

function failedAdvisory(advisoryId: string): ConvergenceAiAdvisory {
  return {
    advisoryId,
    candidateAnalyses: [],
    conflictsNeedingUserInput: [],
    constraintViolations: [],
    overallDirectionSummary: "",
    status: "failed",
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
