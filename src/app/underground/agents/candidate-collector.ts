import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { ModelMessage, ModelOutputContract } from "../../../domain/intelligence/index.js";
import {
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentProtocol,
  type AgentRunContext,
  type CandidatePool,
  type RootletOutput,
  type UndergroundAgentInvocation,
  acceptGuardedAction,
  createGuardViolation,
  type GuardedActionOutput,
  rejectGuardedAction,
} from "../../../domain/underground/index.js";
import { createMinimalCandidatePool } from "../../underground-candidates.js";
import {
  fallbackReasoningTrace,
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";

export type CandidateCollectorWorkspace = {
  readonly traceId: string;
  readonly goalId: string;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly completedRootletInvocations: readonly UndergroundAgentInvocation[];
  readonly centerInvocations: readonly UndergroundAgentInvocation[];
};

export type CandidateCollectorCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
};

export type CandidateCollectorPercept = AgentPercept & {
  readonly goalId: string;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly completedRootletInvocations: readonly UndergroundAgentInvocation[];
  readonly centerInvocations: readonly UndergroundAgentInvocation[];
};

export type CandidateCollectorDecision = AgentDecision & {
  readonly aggregationRationale: string;
  readonly candidateCount: number;
  readonly deduplicationNotes: readonly string[];
  readonly implicitRelations: readonly string[];
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

export type CandidateCollectorAction = AgentActionOutput & {
  readonly candidatePool: CandidatePool;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

const CANDIDATE_COLLECTOR_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "goalId", required: true },
    { source: "workspace", key: "rootletOutputs", required: true },
    { source: "workspace", key: "completedRootletInvocations", required: true },
    { source: "workspace", key: "centerInvocations", required: true },
  ],
  outputs: [{ type: "CandidatePool", payloadSchema: "candidate_pool.v1" }],
};

export class CandidateCollectorAgent
  implements
    AgentLoop<
      CandidateCollectorPercept,
      CandidateCollectorDecision,
      CandidateCollectorAction,
      CandidateCollectorWorkspace,
      CandidateCollectorCapabilities
    >
{
  readonly agentId = "underground-candidate-collector";
  readonly protocol = CANDIDATE_COLLECTOR_PROTOCOL;

  observe(
    ctx: AgentRunContext<CandidateCollectorWorkspace, CandidateCollectorCapabilities>
  ): CandidateCollectorPercept {
    const snapshot = ctx.workspace.snapshot();
    return {
      inputRefs: [snapshot.goalId, ...snapshot.rootletOutputs.map((o: RootletOutput) => o.outputId)],
      goalId: snapshot.goalId,
      rootletOutputs: snapshot.rootletOutputs,
      completedRootletInvocations: snapshot.completedRootletInvocations,
      centerInvocations: snapshot.centerInvocations,
    };
  }

  async reason(
    ctx: AgentRunContext<CandidateCollectorWorkspace, CandidateCollectorCapabilities>,
    percept: CandidateCollectorPercept
  ): Promise<CandidateCollectorDecision> {
    const candidateCount = percept.rootletOutputs.length;
    const fallbackRationale = `Aggregated ${candidateCount} rootlet outputs into candidate pool for goal ${percept.goalId}.`;

    const ai = await reasonWithAgentTurn<CandidateAggregationParsed>({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: ctx.workspace.snapshot().traceId,
      goalId: percept.goalId,
      purpose: "candidate_aggregation",
      outputContract: CANDIDATE_AGGREGATION_CONTRACT,
      callerRef: { kind: "candidate_pool", id: this.agentId, label: "candidate_aggregation" },
      inputRefs: [{ kind: "goal", id: percept.goalId }],
      inputRefIds: percept.inputRefs,
      messages: buildCandidateAggregationMessages(percept),
      constraints: [],
      parse: (output) => parseCandidateAggregationOutput(output, candidateCount),
    });

    const rationale = ai.value?.aggregationRationale ?? fallbackRationale;
    const deduplicationNotes = ai.value?.deduplicationNotes ?? [];
    const implicitRelations = ai.value?.implicitRelations ?? [];
    const reasoningTrace =
      ai.reasoningTrace.length > 0
        ? ai.reasoningTrace
        : fallbackReasoningTrace({
            agentId: this.agentId,
            decisionSummary: fallbackRationale,
            inputRefs: percept.inputRefs,
            fallbackRefs: ["deterministic_fallback"],
          });

    return {
      rationaleRefs: [...percept.rootletOutputs.map((o: RootletOutput) => o.outputId), ...reasoningTraceRefs(reasoningTrace)],
      aggregationRationale: rationale,
      candidateCount,
      deduplicationNotes,
      implicitRelations,
      source: ai.source,
      confidence: ai.confidence,
      reasoningTrace,
    };
  }

  act(
    ctx: AgentRunContext<CandidateCollectorWorkspace, CandidateCollectorCapabilities>,
    _decision: CandidateCollectorDecision
  ): CandidateCollectorAction {
    const snapshot = ctx.workspace.snapshot();
    const candidatePool = createMinimalCandidatePool({
      goalId: snapshot.goalId,
      rootletOutputs: snapshot.rootletOutputs,
      agentInvocations: [...snapshot.centerInvocations, ...snapshot.completedRootletInvocations],
    });
    return {
      outputRefs: [candidatePool.poolId],
      candidatePool,
      source: _decision.source,
      confidence: _decision.confidence,
      reasoningTrace: _decision.reasoningTrace,
    };
  }

  guard(
    ctx: AgentRunContext<CandidateCollectorWorkspace, CandidateCollectorCapabilities>,
    output: CandidateCollectorAction
  ): GuardedActionOutput<CandidateCollectorAction> {
    const violations = [];
    const pool = output.candidatePool;
    const snapshot = ctx.workspace.snapshot();

    if (pool.goalId !== snapshot.goalId) {
      violations.push(
        createGuardViolation({
          code: "CANDIDATE_POOL_GOAL_MISMATCH",
          message: `CandidatePool goalId ${pool.goalId} does not match workspace goalId ${snapshot.goalId}.`,
          severity: "error",
        })
      );
    }

    const completedInvocationIds = new Set(
      snapshot.completedRootletInvocations.map((inv: UndergroundAgentInvocation) => inv.invocationId)
    );
    for (const outputRef of pool.sourceRootletOutputRefs) {
      const matchingRootlet = snapshot.rootletOutputs.find((ro: RootletOutput) => ro.outputId === outputRef);
      if (matchingRootlet !== undefined && !completedInvocationIds.has(matchingRootlet.invocationId)) {
        violations.push(
          createGuardViolation({
            code: "ROOTLET_OUTPUT_FROM_INCOMPLETE_INVOCATION",
            message: `Rootlet output ${outputRef} references invocation ${matchingRootlet.invocationId} that has not completed.`,
            severity: "error",
          })
        );
      }
    }

    const rootletAgentInvocations = snapshot.completedRootletInvocations.filter(
      (inv: UndergroundAgentInvocation) => inv.role === "rootlet_agent"
    );
    const rootletAgentIds = new Set(rootletAgentInvocations.map((inv: UndergroundAgentInvocation) => inv.agentId));
    for (const candidate of pool.candidates) {
      if (!rootletAgentIds.has(candidate.producedByAgentId)) {
        violations.push(
          createGuardViolation({
            code: "CANDIDATE_FROM_ILLEGAL_SOURCE",
            message: `Candidate ${candidate.id} producedByAgentId ${candidate.producedByAgentId} is not a completed rootlet agent.`,
            severity: "error",
          })
        );
      }
    }

    if (violations.length > 0) {
      return rejectGuardedAction({ output, violations });
    }

    return acceptGuardedAction(output);
  }
}

const CANDIDATE_AGGREGATION_CONTRACT: ModelOutputContract = {
  contractId: "underground.candidate_aggregation.v1",
  outputKind: "explanation",
  format: "json_object",
  requiredFields: ["aggregationRationale", "deduplicationNotes", "implicitRelations", "decisionSummary", "uncertainty", "confidence"],
  requiredStringFields: ["aggregationRationale", "decisionSummary", "uncertainty"],
  visibleOutput: {
    fields: ["aggregationRationale", "decisionSummary", "uncertainty"],
    fieldTypes: {
      aggregationRationale: "string",
      decisionSummary: "string",
      uncertainty: "string",
    },
    maxFieldLength: 240,
  },
};

function buildCandidateAggregationMessages(percept: CandidateCollectorPercept): readonly ModelMessage[] {
  const outputLines = percept.rootletOutputs.map((output) =>
    `- [${output.kind}] outputId=${output.outputId} summary=${truncate(output.summary, 180)} evidenceRefs=${output.evidenceRefs.length} source=${output.source}`
  );
  return [
    {
      role: "system",
      content: [
        "You are AgentArbor Underground Candidate Collector.",
        "Analyze the rootlet outputs and provide aggregation insights: deduplication notes, implicit relations between candidates, and confidence annotations.",
        "Return JSON only. Do not include chain-of-thought. Use decisionSummary for a short displayable decision summary and uncertainty for open concerns.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Goal id: ${percept.goalId}`,
        `Rootlet outputs (${percept.rootletOutputs.length}):`,
        ...outputLines,
        "",
        "Return fields: aggregationRationale, deduplicationNotes [string[]], implicitRelations [string[]], decisionSummary, uncertainty, confidence.",
      ].join("\n"),
    },
  ];
}

type CandidateAggregationParsed = {
  readonly aggregationRationale: string;
  readonly deduplicationNotes: readonly string[];
  readonly implicitRelations: readonly string[];
};

function parseCandidateAggregationOutput(
  output: unknown,
  candidateCount: number,
): import("./reasoning.js").UndergroundReasoningParseResult<CandidateAggregationParsed> {
  const record = asRecord(output);
  const aggregationRationale = stringOrUndefined(record.aggregationRationale)
    ?? `Aggregated ${candidateCount} rootlet outputs into candidate pool.`;
  return {
    ok: true,
    value: {
      aggregationRationale,
      deduplicationNotes: stringArray(record.deduplicationNotes),
      implicitRelations: stringArray(record.implicitRelations),
    },
    decisionSummary: stringOrUndefined(record.decisionSummary) ?? aggregationRationale,
    uncertainty: stringOrUndefined(record.uncertainty),
    confidence: numberOrUndefined(record.confidence),
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  )];
}
