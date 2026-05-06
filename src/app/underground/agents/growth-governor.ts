import type { Constraint } from "../../../domain/contracts.js";
import type {
  AgentActionOutput,
  AgentDecision,
  AgentLoop,
  AgentPercept,
  AgentProtocol,
  AgentRunContext,
  GoalIntentProfile,
  GuardedActionOutput,
  RootletClusterKind,
  UndergroundAgentInvocation,
  UndergroundExplorationPlan,
  WorkspaceSnapshot,
} from "../../../domain/underground/index.js";
import {
  acceptGuardedAction,
  createGuardViolation,
  rejectGuardedAction,
} from "../../../domain/underground/index.js";
import {
  completeUndergroundAgentInvocation,
  startUndergroundAgentInvocation,
} from "../../underground-agent-cluster-runtime.js";
import { startRootletClusters } from "../../underground-rootlets.js";

type GrowthGovernorWorkspaceData = Readonly<{
  explorationPlan?: UndergroundExplorationPlan;
  goalId?: string;
  rawGoal?: string;
  goalIntentProfile?: GoalIntentProfile;
}>;

type GrowthGovernorWorkspaceSnapshot = WorkspaceSnapshot<GrowthGovernorWorkspaceData>;

type GrowthGovernorCapabilities = {
  readonly constraints: readonly Constraint[];
};

type GrowthGovernorPercept = AgentPercept & {
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly goalId: string;
  readonly rawGoal: string;
};

type GrowthGovernorDecision = AgentDecision & {
  readonly explorationPlan: UndergroundExplorationPlan;
  readonly goalId: string;
};

type GrowthGovernorActionOutput = AgentActionOutput & {
  readonly startedPlan: UndergroundExplorationPlan;
  readonly runningRootletInvocations: UndergroundAgentInvocation[];
  readonly centerInvocations: UndergroundAgentInvocation[];
};

const GROWTH_GOVERNOR_PROTOCOL: AgentProtocol = {
  inputs: [
    { source: "workspace", key: "explorationPlan", required: true },
    { source: "workspace", key: "goalId", required: true },
  ],
  outputs: [
    { type: "startedPlan", payloadSchema: "underground.growth_governor.started_plan.v1" },
    { type: "rootlet_invocations", payloadSchema: "underground.growth_governor.rootlet_invocations.v1" },
  ],
};

export class GrowthGovernorAgent
  implements
    AgentLoop<
      GrowthGovernorPercept,
      GrowthGovernorDecision,
      GrowthGovernorActionOutput,
      GrowthGovernorWorkspaceSnapshot,
      GrowthGovernorCapabilities
    >
{
  readonly agentId = "underground-growth-governor-loop";
  readonly protocol = GROWTH_GOVERNOR_PROTOCOL;

  observe(
    ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>
  ): GrowthGovernorPercept {
    const snapshot = ctx.workspace.snapshot();
    const explorationPlan = snapshot.data.explorationPlan;
    if (explorationPlan === undefined) {
      throw new Error("GrowthGovernorAgent requires an explorationPlan in the workspace.");
    }
    return {
      observedAt: new Date().toISOString(),
      inputRefs: [explorationPlan.planId],
      explorationPlan,
      goalId: snapshot.data.goalId ?? "",
      rawGoal: snapshot.data.rawGoal ?? "",
    };
  }

  reason(
    _ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>,
    percept: GrowthGovernorPercept
  ): GrowthGovernorDecision {
    return {
      decidedAt: new Date().toISOString(),
      rationaleRefs: [percept.explorationPlan.planId],
      explorationPlan: percept.explorationPlan,
      goalId: percept.goalId,
    };
  }

  act(
    _ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>,
    decision: GrowthGovernorDecision
  ): GrowthGovernorActionOutput {
    const startedPlan = startRootletClusters(decision.explorationPlan);
    const growthInvocation = startUndergroundAgentInvocation({
      agentId: this.agentId,
      role: "growth_governor",
      inputRefs: [decision.explorationPlan.planId],
    });
    const completedGrowthInvocation = completeUndergroundAgentInvocation(growthInvocation, [
      startedPlan.planId,
      ...startedPlan.rootletClusters.map((cluster) => cluster.clusterId),
    ]);
    const runningRootletInvocations = startedPlan.rootletClusters.map((cluster) =>
      startUndergroundAgentInvocation({
        agentId: rootletExplorerAgentId(cluster.kind),
        role: "rootlet_agent",
        inputRefs: [decision.goalId, startedPlan.planId, cluster.clusterId],
      })
    );
    return {
      outputRefs: [startedPlan.planId, ...startedPlan.rootletClusters.map((c) => c.clusterId)],
      startedPlan,
      runningRootletInvocations,
      centerInvocations: [completedGrowthInvocation],
    };
  }

  guard(
    _ctx: AgentRunContext<GrowthGovernorWorkspaceSnapshot, GrowthGovernorCapabilities>,
    output: GrowthGovernorActionOutput
  ): GuardedActionOutput<GrowthGovernorActionOutput> {
    const violations = [];
    if (output.startedPlan.rootletClusters.length === 0) {
      violations.push(
        createGuardViolation({
          code: "GROWTH_GOVERNOR_NO_ROOTLET_CLUSTERS",
          message: "Started plan must have at least one rootlet cluster.",
          severity: "error",
        })
      );
    }
    if (output.runningRootletInvocations.length !== output.startedPlan.rootletClusters.length) {
      violations.push(
        createGuardViolation({
          code: "GROWTH_GOVERNOR_INVOCATION_MISMATCH",
          message: "Running rootlet invocations must match rootlet cluster count.",
          severity: "error",
        })
      );
    }
    if (violations.length > 0) {
      return rejectGuardedAction({ output, violations });
    }
    return acceptGuardedAction(output);
  }
}

function rootletExplorerAgentId(kind: RootletClusterKind): string {
  return `rootlet-explorer-${kind.replace("_", "-")}`;
}
