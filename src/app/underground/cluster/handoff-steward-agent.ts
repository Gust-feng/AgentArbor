import type { ArborMessage } from "../../../domain/common.js";
import type { Constraint, UndergroundExplorationReport } from "../../../domain/contracts.js";
import { createDirectionHandoffPackageRef } from "../../../domain/agentarbor/direction-handoff-package.js";
import { createMessage } from "../../../kernel/messages/create-message.js";
import {
  completeUndergroundAgentInvocation,
  finalizeUndergroundAgentClusterRun,
  startUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import { createUndergroundExplorationReport } from "../../underground-report.js";
import {
  createAwaitingUserDirectionMaterial,
  createMinimalDirectionMaterial,
  createStoppedDirectionMaterial,
} from "../../minimal-direction.js";
import type { UndergroundAgent, UndergroundAgentContext } from "./agent-context.js";
import {
  ensureMessageFromAgent,
  ensurePayloadRecordStringEquals,
  ensurePayloadStringEquals,
  readPayloadRecord,
  requireValue,
} from "./agent-context.js";

export class HandoffStewardAgent implements UndergroundAgent {
  readonly agentId = "underground-handoff-steward";
  private subscriptions: Array<() => void> = [];

  start(ctx: UndergroundAgentContext): void {
    this.subscriptions.push(
      ctx.subscribe(this.agentId, "convergence_review.completed", (message) =>
        this.handleConvergenceReviewCompleted(ctx, message)
      )
    );
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  private handleConvergenceReviewCompleted(ctx: UndergroundAgentContext, message: ArborMessage): void {
    const state = ctx.shared.snapshot();
    const goalId = requireValue(state.goalId, "goalId");
    const rawGoal = requireValue(state.rawGoal, "rawGoal");
    const convergenceReport = requireValue(state.convergenceReport, "convergenceReport");
    const pendingAgentClusterRun = requireValue(state.agentClusterRun, "agentClusterRun");
    const pendingUndergroundReport = requireValue(state.undergroundReport, "undergroundReport");
    const candidatePool = pendingUndergroundReport.candidatePool;
    const completedPlan = pendingUndergroundReport.plan;
    const payload = readPayloadRecord(message);
    ensureMessageFromAgent(message, "underground-convergence-judge");
    ensurePayloadStringEquals(payload, "goalId", goalId, message.type);
    ensurePayloadRecordStringEquals(
      payload,
      "convergenceReport",
      "reviewId",
      convergenceReport.reviewId,
      message.type
    );

    const handoffInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "handoff_steward",
      inputRefs: [goalId, convergenceReport.reviewId, message.id],
    });
    const materialInput = {
      goalId,
      goal: rawGoal,
      producedByAgentId: this.agentId,
      constraints: ctx.runtime.constraints as Constraint[],
      goalIntentProfile: state.goalIntentProfile,
      candidatePool,
      convergenceReport,
    };
    const material =
      convergenceReport.outcome === "approved"
        ? createMinimalDirectionMaterial(materialInput)
        : convergenceReport.outcome === "awaiting_user"
          ? createAwaitingUserDirectionMaterial(materialInput)
          : createStoppedDirectionMaterial(materialInput);
    const directionHandoffPackage = ctx.runtime.directionHandoffPackageStore.save(material.directionHandoffPackage);
    const loadedDirectionHandoffPackage = ctx.runtime.directionHandoffPackageStore.load(
      directionHandoffPackage.manifest.directionId,
      directionHandoffPackage.manifest.directionVersion
    );
    const directionHandoffPackageRef = createDirectionHandoffPackageRef(loadedDirectionHandoffPackage);
    const completedHandoffInvocation = completeUndergroundAgentInvocation(handoffInvocation, [
      directionHandoffPackageRef.packageId,
    ]);
    const terminalStatus = terminalStatusForConvergence(convergenceReport.outcome);
    const agentClusterRun = finalizeUndergroundAgentClusterRun({
      run: {
        ...pendingAgentClusterRun,
        invocations: [...pendingAgentClusterRun.invocations, completedHandoffInvocation],
      },
      terminalStatus,
      candidateRefs: convergenceReport.handoffCandidateRefs,
      packageRef: directionHandoffPackageRef,
      stopReason: convergenceReport.stopReason,
    });
    const undergroundReport = createUndergroundExplorationReport({
      plan: completedPlan,
      agentClusterRun,
      goalIntentProfile: state.goalIntentProfile,
      evidenceLedger: state.evidenceLedger,
      rootletOutputs: [...state.rootletOutputs],
      candidatePool,
      convergenceReport,
    });

    ctx.shared.write(this.agentId, {
      agentClusterRun,
      undergroundReport,
      directionHandoff: material.directionHandoff,
      directionHandoffPackage,
      directionHandoffPackageRef,
      loadedDirectionHandoffPackage,
      terminalStatus,
    });

    this.publishTerminalMessage({
      ctx,
      message,
      goalId,
      material,
      convergenceReport,
      directionHandoffPackageRef,
      agentClusterRun,
      terminalStatus,
    });
  }

  private publishTerminalMessage(input: {
    readonly ctx: UndergroundAgentContext;
    readonly message: ArborMessage;
    readonly goalId: string;
    readonly material: ReturnType<typeof createMinimalDirectionMaterial> | ReturnType<typeof createAwaitingUserDirectionMaterial> | ReturnType<typeof createStoppedDirectionMaterial>;
    readonly convergenceReport: UndergroundExplorationReport["convergenceReport"];
    readonly directionHandoffPackageRef: ReturnType<typeof createDirectionHandoffPackageRef>;
    readonly agentClusterRun: NonNullable<UndergroundExplorationReport["agentClusterRun"]>;
    readonly terminalStatus: "approved_package_created" | "awaiting_user" | "stopped";
  }): void {
    if (input.terminalStatus === "approved_package_created") {
      input.ctx.runtime.bus.publish(
        createMessage({
          traceId: input.message.traceId,
          from: { id: this.agentId, role: "underground_center" },
          to: { role: "aboveground_center" },
          type: "direction_handoff.completed",
          intent: "complete_direction_handoff",
          payload: {
            goalId: input.goalId,
            directionHandoff: input.material.directionHandoff,
            directionPackage: input.directionHandoffPackageRef,
            agentCluster: {
              plan: input.agentClusterRun.plan,
              run: input.agentClusterRun,
              invocation: input.agentClusterRun.invocations.find((invocation) => invocation.role === "handoff_steward"),
              invocations: input.agentClusterRun.invocations,
            },
          },
        })
      );
    } else if (input.terminalStatus === "awaiting_user" && "clarificationRequest" in input.material) {
      input.ctx.runtime.bus.publish(
        createMessage({
          traceId: input.message.traceId,
          from: { id: this.agentId, role: "underground_center" },
          to: { role: "user" },
          type: "user_approval.requested",
          intent: "request_user_clarification",
          payload: {
            goalId: input.goalId,
            clarificationRequest: input.material.clarificationRequest,
            directionPackage: input.directionHandoffPackageRef,
            convergenceReport: {
              reviewId: input.convergenceReport.reviewId,
              outcome: input.convergenceReport.outcome,
            },
            agentCluster: {
              plan: input.agentClusterRun.plan,
              run: input.agentClusterRun,
              invocation: input.agentClusterRun.invocations.find((invocation) => invocation.role === "handoff_steward"),
              invocations: input.agentClusterRun.invocations,
            },
          },
        })
      );
    }
  }
}

function terminalStatusForConvergence(
  outcome: UndergroundExplorationReport["convergenceReport"]["outcome"]
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
