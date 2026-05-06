import type { AgentTurnRuntime } from "../../../kernel/intelligence/index.js";
import type { Constraint } from "../../../domain/contracts.js";
import {
  createDirectionHandoffPackageRef,
  type DirectionHandoffPackage,
  type DirectionHandoffPackageRef,
  type DirectionHandoffPackageStore,
} from "../../../domain/agentarbor/direction-handoff-package.js";
import {
  type AgentActionOutput,
  type AgentDecision,
  type AgentLoop,
  type AgentPercept,
  type AgentProtocol,
  type AgentRunContext,
  type CandidatePool,
  type GoalIntentProfile,
  type UndergroundConvergenceReport,
  acceptGuardedAction,
  createGuardViolation,
  type GuardedActionOutput,
  rejectGuardedAction,
} from "../../../domain/underground/index.js";
import {
  createMinimalDirectionMaterial,
  createAwaitingUserDirectionMaterial,
  createStoppedDirectionMaterial,
} from "../../minimal-direction.js";

export type HandoffStewardWorkspace = {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly convergenceReport?: UndergroundConvergenceReport;
  readonly candidatePool?: CandidatePool;
  readonly constraints: readonly Constraint[];
};

export type HandoffStewardCapabilities = {
  readonly agentTurnRuntime?: AgentTurnRuntime;
  readonly directionHandoffPackageStore: DirectionHandoffPackageStore;
};

export type HandoffStewardPercept = AgentPercept & {
  readonly goalId: string;
  readonly rawGoal: string;
  readonly goalIntentProfile?: GoalIntentProfile;
  readonly convergenceReport: UndergroundConvergenceReport;
  readonly candidatePool: CandidatePool;
  readonly constraints: readonly Constraint[];
};

export type HandoffStewardDecision = AgentDecision & {
  readonly handoffStrategy: "ai_narrative" | "deterministic";
};

export type HandoffStewardAction = AgentActionOutput & {
  readonly directionHandoffPackage: DirectionHandoffPackage;
  readonly directionHandoffPackageRef: DirectionHandoffPackageRef;
  readonly terminalStatus: "approved_package_created" | "awaiting_user" | "stopped";
};

const HANDOFF_STEWARD_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "goalId", required: true },
    { source: "workspace", key: "convergenceReport", required: true },
    { source: "workspace", key: "candidatePool", required: true },
    { source: "workspace", key: "constraints", required: false },
  ],
  outputs: [{ type: "DirectionHandoffPackage", payloadSchema: "direction_handoff_package.v1" }],
};

export class HandoffStewardAgent
  implements
    AgentLoop<
      HandoffStewardPercept,
      HandoffStewardDecision,
      HandoffStewardAction,
      HandoffStewardWorkspace,
      HandoffStewardCapabilities
    >
{
  readonly agentId = "underground-handoff-steward-loop";
  readonly protocol = HANDOFF_STEWARD_PROTOCOL;

  observe(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>
  ): HandoffStewardPercept {
    const snapshot = ctx.workspace.snapshot();
    const convergenceReport = snapshot.convergenceReport;
    const candidatePool = snapshot.candidatePool;
    if (convergenceReport === undefined) {
      throw new Error("HandoffStewardAgent requires a ConvergenceReport in the workspace.");
    }
    if (candidatePool === undefined) {
      throw new Error("HandoffStewardAgent requires a CandidatePool in the workspace.");
    }
    return {
      inputRefs: [snapshot.goalId, convergenceReport.reviewId],
      goalId: snapshot.goalId,
      rawGoal: snapshot.rawGoal,
      goalIntentProfile: snapshot.goalIntentProfile,
      convergenceReport,
      candidatePool,
      constraints: snapshot.constraints,
    };
  }

  reason(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>,
    percept: HandoffStewardPercept
  ): HandoffStewardDecision {
    if (ctx.capabilities?.agentTurnRuntime !== undefined) {
      return {
        rationaleRefs: [percept.convergenceReport.reviewId],
        handoffStrategy: "ai_narrative",
      };
    }
    return {
      rationaleRefs: [percept.convergenceReport.reviewId],
      handoffStrategy: "deterministic",
    };
  }

  act(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>,
    _decision: HandoffStewardDecision
  ): HandoffStewardAction {
    const percept = this.observe(ctx);
    const store = ctx.capabilities?.directionHandoffPackageStore;
    if (store === undefined) {
      throw new Error("HandoffStewardAgent requires a directionHandoffPackageStore in capabilities.");
    }
    const materialInput = {
      goalId: percept.goalId,
      goal: percept.rawGoal,
      producedByAgentId: this.agentId,
      constraints: [...percept.constraints],
      goalIntentProfile: percept.goalIntentProfile,
      candidatePool: percept.candidatePool,
      convergenceReport: percept.convergenceReport,
    };

    const material =
      percept.convergenceReport.outcome === "approved"
        ? createMinimalDirectionMaterial(materialInput)
        : percept.convergenceReport.outcome === "awaiting_user"
          ? createAwaitingUserDirectionMaterial(materialInput)
          : createStoppedDirectionMaterial(materialInput);

    const directionHandoffPackage = store.save(material.directionHandoffPackage);
    const loadedDirectionHandoffPackage = store.load(
      directionHandoffPackage.manifest.directionId,
      directionHandoffPackage.manifest.directionVersion
    );
    const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedDirectionHandoffPackage);
    const terminalStatus = terminalStatusForConvergence(percept.convergenceReport.outcome);

    return {
      outputRefs: [directionHandoffPackageRef.packageId],
      directionHandoffPackage,
      directionHandoffPackageRef,
      terminalStatus,
    };
  }

  guard(
    ctx: AgentRunContext<HandoffStewardWorkspace, HandoffStewardCapabilities>,
    output: HandoffStewardAction
  ): GuardedActionOutput<HandoffStewardAction> {
    const violations = [];
    const pkg = output.directionHandoffPackage;
    const snapshot = ctx.workspace.snapshot();
    const convergenceReport = snapshot.convergenceReport;

    if (convergenceReport === undefined) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_NO_CONVERGENCE_REPORT",
          message: "HandoffSteward guard requires a ConvergenceReport in the workspace.",
          severity: "error",
        })
      );
      return rejectGuardedAction({ output, violations });
    }

    if (!pkg.validation.passed) {
      const expectedFailureCodes = new Set([
        "DIRECTION_HANDOFF_NOT_APPROVED",
        "MISSING_SOURCE_CANDIDATE_REFS",
        "MISSING_CONVERGENCE_REVIEW_REF",
        "UNCONVERGED_SOURCE_CANDIDATES",
      ]);
      for (const error of pkg.validation.errors) {
        if (output.terminalStatus === "approved_package_created" || !expectedFailureCodes.has(error.code)) {
          violations.push(
            createGuardViolation({
              code: `HANDOFF_PACKAGE_${error.code}`,
              message: error.message,
              severity: "error",
            })
          );
        }
      }
    }

    if (output.terminalStatus === "approved_package_created") {
      const originalHardConstraints = snapshot.constraints.filter((c: Constraint) => c.level === "hard");
      const handoffConstraintRefs = pkg.directionHandoff.constraintRefs.map((r: { constraintId: string }) => r.constraintId);
      for (const hardConstraint of originalHardConstraints) {
        if (!handoffConstraintRefs.includes(hardConstraint.id)) {
          violations.push(
            createGuardViolation({
              code: "HANDOFF_CONSTRAINT_WEAKENED",
              message: `Hard constraint ${hardConstraint.id} is missing from the handoff package; constraints must not be weakened.`,
              severity: "error",
            })
          );
        }
      }
    }

    for (const candidate of pkg.directionHandoff.sourceCandidateRefs) {
      if (candidate.sourceRefs.length === 0) {
        violations.push(
          createGuardViolation({
            code: "HANDOFF_CANDIDATE_NO_EVIDENCE_REFS",
            message: `Source candidate ${candidate.id} in handoff package has no evidence sourceRefs.`,
            severity: "error",
          })
        );
      }
    }

    if (pkg.manifest.directionId !== pkg.directionHandoff.id) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_PACKAGE_STRUCTURE_ILLEGAL",
          message: "DirectionHandoffPackage manifest directionId does not match handoff id.",
          severity: "error",
        })
      );
    }

    if (pkg.convergenceReview.reviewId !== convergenceReport.reviewId) {
      violations.push(
        createGuardViolation({
          code: "HANDOFF_CONVERGENCE_REF_MISMATCH",
          message: "DirectionHandoffPackage convergence review does not match workspace convergence report.",
          severity: "error",
        })
      );
    }

    if (violations.some((v) => v.severity === "error")) {
      return rejectGuardedAction({ output, violations });
    }

    return acceptGuardedAction(output);
  }
}

function terminalStatusForConvergence(
  outcome: UndergroundConvergenceReport["outcome"]
): "approved_package_created" | "awaiting_user" | "stopped" {
  switch (outcome) {
    case "approved":
      return "approved_package_created";
    case "awaiting_user":
      return "awaiting_user";
    case "stopped":
      return "stopped";
  }
}
