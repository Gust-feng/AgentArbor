import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
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

export type CandidateCollectorWorkspace = {
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
};

export type CandidateCollectorAction = AgentActionOutput & {
  readonly candidatePool: CandidatePool;
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

  reason(
    _ctx: AgentRunContext<CandidateCollectorWorkspace, CandidateCollectorCapabilities>,
    percept: CandidateCollectorPercept
  ): CandidateCollectorDecision {
    const candidateCount = percept.rootletOutputs.length;
    return {
      rationaleRefs: percept.rootletOutputs.map((o: RootletOutput) => o.outputId),
      aggregationRationale: `Aggregated ${candidateCount} rootlet outputs into candidate pool for goal ${percept.goalId}.`,
      candidateCount,
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
