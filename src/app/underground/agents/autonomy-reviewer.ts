import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { Constraint } from "../../../domain/contracts.js";
import type { ModelOutputContract } from "../../../domain/intelligence/index.js";
import {
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentProtocol,
  type AgentRunContext,
  type CandidatePool,
  type GoalIntentProfile,
  type RootletOutput,
  type UndergroundAutonomyDecision,
  type UndergroundExplorationCycle,
  acceptGuardedAction,
  createGuardViolation,
  type GuardedActionOutput,
  rejectGuardedAction,
} from "../../../domain/underground/index.js";
import { createId } from "../../../kernel/id.js";
import {
  fallbackReasoningTrace,
  reasonWithAgentTurn,
  reasoningTraceRefs,
  type UndergroundReasoningTraceEntry,
} from "./reasoning.js";
import {
  AUTONOMY_DECISION_CONTRACT,
  buildAutonomyDecisionMessages,
  failedAutonomyDecision,
  parseAutonomyDecisionAsReasoningResult,
  researchRefsFromValue,
} from "../autonomy-intelligence.js";

export type AutonomyReviewerWorkspace = {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool?: CandidatePool;
  readonly currentCycle?: UndergroundExplorationCycle;
  readonly autonomyCycles: readonly UndergroundExplorationCycle[];
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly maxAutonomyCycles: number;
};

export type AutonomyReviewerCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
};

export type AutonomyReviewerPercept = AgentPercept & {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool: CandidatePool;
  readonly currentCycle: UndergroundExplorationCycle;
  readonly autonomyCycles: readonly UndergroundExplorationCycle[];
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly maxAutonomyCycles: number;
};

export type AutonomyReviewerDecision = AgentDecision & {
  readonly decision: UndergroundAutonomyDecision;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

export type AutonomyReviewerAction = AgentActionOutput & {
  readonly decision: UndergroundAutonomyDecision;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTrace: readonly UndergroundReasoningTraceEntry[];
};

const AUTONOMY_REVIEWER_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "goalId", required: true },
    { source: "workspace", key: "candidatePool", required: true },
    { source: "workspace", key: "currentCycle", required: true },
    { source: "workspace", key: "autonomyCycles", required: false },
    { source: "workspace", key: "constraints", required: false },
  ],
  outputs: [{ type: "AutonomyDecision", payloadSchema: "autonomy_decision.v1" }],
};

export class AutonomyReviewerAgent
  implements
    AgentLoop<
      AutonomyReviewerPercept,
      AutonomyReviewerDecision,
      AutonomyReviewerAction,
      AutonomyReviewerWorkspace,
      AutonomyReviewerCapabilities
    >
{
  readonly agentId = "underground-autonomy-reviewer";
  readonly protocol = AUTONOMY_REVIEWER_PROTOCOL;

  observe(
    ctx: AgentRunContext<AutonomyReviewerWorkspace, AutonomyReviewerCapabilities>
  ): AutonomyReviewerPercept {
    const snapshot = ctx.workspace.snapshot();
    const candidatePool = snapshot.candidatePool;
    const currentCycle = snapshot.currentCycle;
    if (candidatePool === undefined) {
      throw new Error("AutonomyReviewerAgent requires a CandidatePool in the workspace.");
    }
    if (currentCycle === undefined) {
      throw new Error("AutonomyReviewerAgent requires a currentCycle in the workspace.");
    }
    return {
      inputRefs: [snapshot.goalId, candidatePool.poolId, currentCycle.explorationCycleId],
      goalId: snapshot.goalId,
      rawGoal: snapshot.rawGoal,
      goalIntentProfile: snapshot.goalIntentProfile,
      candidatePool,
      currentCycle,
      autonomyCycles: snapshot.autonomyCycles,
      rootletOutputs: snapshot.rootletOutputs,
      constraints: snapshot.constraints,
      maxAutonomyCycles: snapshot.maxAutonomyCycles,
    };
  }

  async reason(
    ctx: AgentRunContext<AutonomyReviewerWorkspace, AutonomyReviewerCapabilities>,
    percept: AutonomyReviewerPercept
  ): Promise<AutonomyReviewerDecision> {
    const decisionId = createId("autonomy-decision");
    const cycles = percept.autonomyCycles.length === 0 ? [percept.currentCycle] : percept.autonomyCycles;

    const fallbackReason = ctx.capabilities?.agentTurnRuntime === undefined
      ? "ai_required_for_autonomy" as const
      : "autonomy_decision_failed" as const;
    const fallbackDecision = failedAutonomyDecision({
      decisionId,
      cycleId: percept.currentCycle.explorationCycleId,
      candidatePoolId: percept.candidatePool.poolId,
      reason: fallbackReason,
      rationale: ctx.capabilities?.agentTurnRuntime === undefined
        ? "Autonomy review is AI-required and no AgentTurnRuntime was provided."
        : "Autonomy model call failed or did not pass output validation.",
    });

    const ai = await reasonWithAgentTurn({
      agentId: this.agentId,
      agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
      traceId: percept.inputRefs[0],
      goalId: percept.goalId,
      purpose: "autonomy_decision",
      outputContract: AUTONOMY_DECISION_CONTRACT as ModelOutputContract,
      callerRef: { kind: "convergence_review", id: this.agentId, label: "autonomy_review" },
      inputRefs: [
        { kind: "goal", id: percept.goalId },
        { kind: "candidate_pool", id: percept.candidatePool.poolId },
      ],
      inputRefIds: percept.inputRefs,
      messages: buildAutonomyDecisionMessages({
        agentTurnRuntime: ctx.capabilities?.agentTurnRuntime,
        traceId: percept.inputRefs[0],
        goalId: percept.goalId,
        goal: percept.rawGoal,
        goalIntentProfile: percept.goalIntentProfile,
        candidatePool: percept.candidatePool,
        rootletOutputs: percept.rootletOutputs,
        constraints: percept.constraints,
        cycle: percept.currentCycle,
        cycles,
        maxCycles: percept.maxAutonomyCycles,
      }),
      constraints: percept.constraints,
      allowedTools: ["search", "read"],
      maxModelRounds: 3,
      maxToolRounds: 2,
      fallback: "disabled",
      parse: (output, response) => parseAutonomyDecisionAsReasoningResult(output, {
        decisionId,
        cycleId: percept.currentCycle.explorationCycleId,
        candidatePool: percept.candidatePool,
        modelCallRefs: [{
          requestId: response.requestId,
          responseId: response.responseId,
          providerId: response.providerId,
          model: response.model,
          outputKind: response.outputKind,
          eventRefs: ["model.requested", response.status === "completed" ? "model.completed" : "model.failed"],
          validationStatus: response.validation.status,
        }],
        toolSourceRefs: [],
      }),
    });

    const decision = ai.value ?? fallbackDecision;
    // Merge tool call refs and research refs from tool outputs into the decision's sourceRefs
    const researchRefs = ai.toolCallOutputs
      .filter((output): output is unknown => output !== null && output !== undefined)
      .flatMap((output) => researchRefsFromValue(output));
    const extraRefs = [...ai.toolCallRefs, ...researchRefs];
    const mergedDecision = extraRefs.length > 0 && decision.status === "completed"
      ? { ...decision, sourceRefs: [...new Set([...decision.sourceRefs, ...extraRefs])] }
      : decision;
    const reasoningTrace =
      ai.reasoningTrace.length > 0
        ? ai.reasoningTrace
        : fallbackReasoningTrace({
            agentId: this.agentId,
            decisionSummary: `Autonomy review used deterministic fallback: ${decision.stopReason ?? "ai_required_for_autonomy"}.`,
            inputRefs: percept.inputRefs,
            fallbackRefs: ["deterministic_fallback"],
            uncertainty: "Autonomy review requires AgentTurnRuntime for AI judgment.",
            confidence: 0.18,
          });

    return {
      rationaleRefs: [mergedDecision.decisionId, ...mergedDecision.sourceRefs, ...reasoningTraceRefs(reasoningTrace)],
      decision: mergedDecision,
      source: ai.source,
      confidence: ai.confidence,
      reasoningTrace,
    };
  }

  act(
    _ctx: AgentRunContext<AutonomyReviewerWorkspace, AutonomyReviewerCapabilities>,
    decision: AutonomyReviewerDecision
  ): AutonomyReviewerAction {
    return {
      outputRefs: [decision.decision.decisionId],
      decision: decision.decision,
      source: decision.source,
      confidence: decision.confidence,
      reasoningTrace: decision.reasoningTrace,
    };
  }

  guard(
    _ctx: AgentRunContext<AutonomyReviewerWorkspace, AutonomyReviewerCapabilities>,
    output: AutonomyReviewerAction
  ): GuardedActionOutput<AutonomyReviewerAction> {
    const violations = [];
    const decision = output.decision;

    if (decision.status === "failed" && decision.action !== "stop") {
      violations.push(
        createGuardViolation({
          code: "AUTONOMY_FAILED_NON_STOP",
          message: `Autonomy decision ${decision.decisionId} has status failed but action ${decision.action} is not stop.`,
          severity: "error",
        })
      );
    }

    const validActions: readonly string[] = [
      "continue_exploration",
      "request_convergence",
      "request_user_clarification",
      "stop",
    ];
    if (!validActions.includes(decision.action)) {
      violations.push(
        createGuardViolation({
          code: "AUTONOMY_INVALID_ACTION",
          message: `Autonomy decision ${decision.decisionId} has invalid action ${decision.action}.`,
          severity: "error",
        })
      );
    }

    if (decision.action === "continue_exploration" && decision.spawnRequests.length === 0) {
      violations.push(
        createGuardViolation({
          code: "AUTONOMY_CONTINUE_NO_SPAWN",
          message: `Autonomy decision ${decision.decisionId} requests continue_exploration but has no spawn requests.`,
          severity: "error",
        })
      );
    }

    const validRootletKinds = ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"];
    for (const request of decision.spawnRequests) {
      if (!validRootletKinds.includes(request.rootletKind)) {
        violations.push(
          createGuardViolation({
            code: "AUTONOMY_INVALID_ROOTLET_KIND",
            message: `Spawn request ${request.requestId} has invalid rootletKind ${request.rootletKind}.`,
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
