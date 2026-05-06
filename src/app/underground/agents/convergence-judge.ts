import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { Constraint } from "../../../domain/contracts.js";
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
  type UndergroundConvergenceAiAdvisory,
  type UndergroundConvergenceReport,
  type UndergroundEvidenceLedger,
  type UndergroundExplorationPlan,
  acceptGuardedAction,
  createGuardViolation,
  type GuardedActionOutput,
  rejectGuardedAction,
  sanitizeUndergroundConvergenceAiAdvisoryText,
} from "../../../domain/underground/index.js";
import {
  convergeMinimalCandidatePool,
  convergeAutonomyTerminalCandidatePool,
} from "../../underground-convergence.js";
import {
  requestConvergenceAiAdvisoryForCandidatePool,
} from "../convergence-intelligence.js";

export type ConvergenceJudgeWorkspace = {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool?: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly startedPlan?: UndergroundExplorationPlan;
  readonly evidenceLedger?: UndergroundEvidenceLedger;
  readonly autonomyDecision?: UndergroundAutonomyDecision;
};

export type ConvergenceJudgeCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
};

export type ConvergenceJudgePercept = AgentPercept & {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly candidatePool: CandidatePool;
  readonly rootletOutputs: readonly RootletOutput[];
  readonly constraints: readonly Constraint[];
  readonly startedPlan: UndergroundExplorationPlan;
  readonly evidenceLedger?: UndergroundEvidenceLedger;
  readonly autonomyDecision?: UndergroundAutonomyDecision;
};

export type ConvergenceJudgeDecision = AgentDecision & {
  readonly convergenceStrategy: "ai_advisory" | "deterministic" | "terminal_autonomy";
  readonly aiAdvisory?: UndergroundConvergenceAiAdvisory;
};

export type ConvergenceJudgeAction = AgentActionOutput & {
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly evidenceLedger: UndergroundEvidenceLedger;
  readonly candidatePool: CandidatePool;
};

const CONVERGENCE_JUDGE_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "goalId", required: true },
    { source: "workspace", key: "candidatePool", required: true },
    { source: "workspace", key: "rootletOutputs", required: true },
    { source: "workspace", key: "constraints", required: false },
    { source: "workspace", key: "startedPlan", required: true },
    { source: "workspace", key: "evidenceLedger", required: false },
    { source: "workspace", key: "autonomyDecision", required: false },
  ],
  outputs: [{ type: "ConvergenceReport", payloadSchema: "convergence_report.v1" }],
};

export class ConvergenceJudgeAgent
  implements
    AgentLoop<
      ConvergenceJudgePercept,
      ConvergenceJudgeDecision,
      ConvergenceJudgeAction,
      ConvergenceJudgeWorkspace,
      ConvergenceJudgeCapabilities
    >
{
  readonly agentId = "underground-convergence-judge-loop";
  readonly protocol = CONVERGENCE_JUDGE_PROTOCOL;

  observe(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>
  ): ConvergenceJudgePercept {
    const snapshot = ctx.workspace.snapshot();
    const candidatePool = snapshot.candidatePool;
    const startedPlan = snapshot.startedPlan;
    if (candidatePool === undefined) {
      throw new Error("ConvergenceJudgeAgent requires a CandidatePool in the workspace.");
    }
    if (startedPlan === undefined) {
      throw new Error("ConvergenceJudgeAgent requires a startedPlan in the workspace.");
    }
    return {
      inputRefs: [snapshot.goalId, candidatePool.poolId],
      goalId: snapshot.goalId,
      rawGoal: snapshot.rawGoal,
      goalIntentProfile: snapshot.goalIntentProfile,
      candidatePool,
      rootletOutputs: snapshot.rootletOutputs,
      constraints: snapshot.constraints,
      startedPlan,
      evidenceLedger: snapshot.evidenceLedger,
      autonomyDecision: snapshot.autonomyDecision,
    };
  }

  async reason(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>,
    percept: ConvergenceJudgePercept
  ): Promise<ConvergenceJudgeDecision> {
    const autonomyDecision = percept.autonomyDecision;
    const isTerminal =
      autonomyDecision !== undefined &&
      (autonomyDecision.status !== "completed" || autonomyDecision.action !== "request_convergence");

    if (isTerminal) {
      return {
        rationaleRefs: [autonomyDecision.decisionId],
        convergenceStrategy: "terminal_autonomy",
      };
    }

    if (ctx.capabilities?.agentTurnRuntime !== undefined) {
      const aiAdvisory = await requestConvergenceAiAdvisoryForCandidatePool({
        agentTurnRuntime: ctx.capabilities.agentTurnRuntime,
        traceId: percept.inputRefs[0],
        goalId: percept.goalId,
        goal: percept.rawGoal,
        goalIntentProfile: percept.goalIntentProfile,
        candidatePool: percept.candidatePool,
        rootletOutputs: percept.rootletOutputs,
        constraints: percept.constraints,
      });
      return {
        rationaleRefs: [percept.candidatePool.poolId, aiAdvisory.advisoryId],
        convergenceStrategy: "ai_advisory",
        aiAdvisory,
      };
    }

    return {
      rationaleRefs: [percept.candidatePool.poolId],
      convergenceStrategy: "deterministic",
    };
  }

  act(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>,
    decision: ConvergenceJudgeDecision
  ): ConvergenceJudgeAction {
    const percept = this.observe(ctx);
    const leadAgentId = this.agentId;

    if (decision.convergenceStrategy === "terminal_autonomy" && percept.autonomyDecision !== undefined) {
      const result = convergeAutonomyTerminalCandidatePool({
        pool: percept.candidatePool,
        plan: percept.startedPlan,
        leadAgentId,
        rootletOutputs: percept.rootletOutputs,
        goalIntentProfile: percept.goalIntentProfile,
        constraints: percept.constraints,
        evidenceLedger: percept.evidenceLedger,
        autonomyDecision: percept.autonomyDecision,
      });
      return {
        outputRefs: [result.convergenceReport.reviewId],
        convergenceReport: result.convergenceReport,
        evidenceLedger: result.evidenceLedger,
        candidatePool: result.candidatePool,
      };
    }

    const result = convergeMinimalCandidatePool({
      pool: percept.candidatePool,
      plan: percept.startedPlan,
      leadAgentId,
      rootletOutputs: percept.rootletOutputs,
      goalIntentProfile: percept.goalIntentProfile,
      constraints: percept.constraints,
      evidenceLedger: percept.evidenceLedger,
      aiAdvisory: decision.aiAdvisory,
    });
    return {
      outputRefs: [result.convergenceReport.reviewId],
      convergenceReport: result.convergenceReport,
      evidenceLedger: result.evidenceLedger,
      candidatePool: result.candidatePool,
    };
  }

  guard(
    ctx: AgentRunContext<ConvergenceJudgeWorkspace, ConvergenceJudgeCapabilities>,
    output: ConvergenceJudgeAction
  ): GuardedActionOutput<ConvergenceJudgeAction> {
    const violations = [];
    const report = output.convergenceReport;
    const snapshot = ctx.workspace.snapshot();

    if (report.outcome === "approved") {
      const hardConstraints = snapshot.constraints.filter((c: Constraint) => c.level === "hard");
      for (const hardConstraint of hardConstraints) {
        const violatedInDecisions = report.decisions.some(
          (d) =>
            d.status === "accepted" &&
            d.provenanceRefs.some((ref: string) => ref.includes(hardConstraint.id)) &&
            d.evidenceRefs.length === 0
        );
        if (violatedInDecisions) {
          violations.push(
            createGuardViolation({
              code: "HARD_CONSTRAINT_VIOLATION_NOT_BLOCKED",
              message: `Accepted candidate references hard constraint ${hardConstraint.id} without blocking evidence.`,
              severity: "error",
            })
          );
        }
      }
    }

    if (report.summary.trim().length === 0) {
      violations.push(
        createGuardViolation({
          code: "CONVERGENCE_EMPTY_SUMMARY",
          message: "ConvergenceReport summary must not be empty.",
          severity: "error",
        })
      );
    }

    if (report.decisions.length === 0) {
      violations.push(
        createGuardViolation({
          code: "CONVERGENCE_NO_DECISIONS",
          message: "ConvergenceReport must contain at least one decision.",
          severity: "error",
        })
      );
    }

    for (const decision of report.decisions) {
      if (decision.evidenceRefs.length === 0) {
        violations.push(
          createGuardViolation({
            code: "CONVERGENCE_DECISION_NO_EVIDENCE",
            message: `Convergence decision ${decision.decisionId} must include evidence refs.`,
            severity: "warning",
          })
        );
      }
    }

    if (report.aiAdvisory !== undefined && report.aiAdvisory.status === "completed") {
      for (const analysis of report.aiAdvisory.candidateAnalyses) {
        const sanitized = sanitizeUndergroundConvergenceAiAdvisoryText(analysis.contentDifference);
        if (sanitized.length === 0 && analysis.contentDifference.trim().length > 0) {
          violations.push(
            createGuardViolation({
              code: "CONVERGENCE_AI_ADVISORY_DESENSITIZATION_EMPTY",
              message: `AI advisory analysis for candidate ${analysis.candidateId} was fully redacted by desensitization.`,
              severity: "warning",
            })
          );
        }
      }
    }

    if (violations.some((v) => v.severity === "error")) {
      return rejectGuardedAction({ output, violations });
    }

    return acceptGuardedAction(output);
  }
}
