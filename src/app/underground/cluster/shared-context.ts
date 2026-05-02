import type {
  DirectionHandoffPackage,
  DirectionHandoffPackageRef,
} from "../../../domain/agentarbor/direction-handoff-package.js";
import type { DirectionHandoff, UndergroundExplorationReport } from "../../../domain/contracts.js";
import type {
  CandidatePool,
  GoalIntentProfile,
  RootletClusterKind,
  RootletOutput,
  UndergroundAgentClusterPlan,
  UndergroundAgentClusterRun,
  UndergroundAgentInvocation,
  UndergroundConvergenceReport,
  UndergroundEvidenceLedger,
  UndergroundExplorationPlan,
} from "../../../domain/underground/index.js";

export class UndergroundSharedContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundSharedContextError";
  }
}

export type UndergroundSharedContextState = {
  traceId?: string;
  goalId?: string;
  rawGoal?: string;
  goalIntentProfile?: GoalIntentProfile;
  explorationPlan?: UndergroundExplorationPlan;
  agentClusterPlan?: UndergroundAgentClusterPlan;
  centerInvocations: readonly UndergroundAgentInvocation[];
  startedPlan?: UndergroundExplorationPlan;
  runningRootletInvocations?: readonly UndergroundAgentInvocation[];
  expectedRootletKinds?: readonly RootletClusterKind[];
  rootletOutputs: readonly RootletOutput[];
  completedRootletInvocations: readonly UndergroundAgentInvocation[];
  candidatePool?: CandidatePool;
  candidatePoolInvocation?: UndergroundAgentInvocation;
  convergenceReport?: UndergroundConvergenceReport;
  evidenceLedger?: UndergroundEvidenceLedger;
  agentClusterRun?: UndergroundAgentClusterRun;
  undergroundReport?: UndergroundExplorationReport;
  directionHandoff?: DirectionHandoff;
  directionHandoffPackage?: DirectionHandoffPackage;
  directionHandoffPackageRef?: DirectionHandoffPackageRef;
  loadedDirectionHandoffPackage?: DirectionHandoffPackage;
  terminalStatus?: "approved_package_created" | "awaiting_user" | "stopped";
};

type SharedContextField = keyof UndergroundSharedContextState;

const ROOTLET_AGENT_OWNER = "rootlet_agent";

const SHARED_CONTEXT_FIELD_OWNERS: Record<SharedContextField, readonly string[]> = {
  traceId: ["underground-intent-core"],
  goalId: ["underground-intent-core"],
  rawGoal: ["underground-intent-core"],
  goalIntentProfile: ["underground-intent-core"],
  explorationPlan: ["underground-intent-core"],
  agentClusterPlan: ["underground-intent-core"],
  centerInvocations: ["underground-intent-core", "underground-growth-governor"],
  startedPlan: ["underground-growth-governor"],
  runningRootletInvocations: ["underground-growth-governor"],
  expectedRootletKinds: ["underground-growth-governor"],
  rootletOutputs: [ROOTLET_AGENT_OWNER],
  completedRootletInvocations: [ROOTLET_AGENT_OWNER],
  candidatePool: ["underground-candidate-pool"],
  candidatePoolInvocation: ["underground-candidate-pool"],
  convergenceReport: ["underground-convergence-judge"],
  evidenceLedger: ["underground-convergence-judge"],
  agentClusterRun: ["underground-convergence-judge", "underground-handoff-steward"],
  undergroundReport: ["underground-convergence-judge", "underground-handoff-steward"],
  directionHandoff: ["underground-handoff-steward"],
  directionHandoffPackage: ["underground-handoff-steward"],
  directionHandoffPackageRef: ["underground-handoff-steward"],
  loadedDirectionHandoffPackage: ["underground-handoff-steward"],
  terminalStatus: ["underground-handoff-steward"],
};

export class UndergroundSharedContext {
  private readonly state: UndergroundSharedContextState = {
    centerInvocations: [],
    rootletOutputs: [],
    completedRootletInvocations: [],
  };

  write(agentId: string, patch: Partial<UndergroundSharedContextState>): void {
    for (const key of Object.keys(patch) as SharedContextField[]) {
      assertSharedContextWriteOwner(agentId, key);
      const value = patch[key];
      if (Array.isArray(value)) {
        (this.state as Record<SharedContextField, unknown>)[key] = [...value];
      } else {
        (this.state as Record<SharedContextField, unknown>)[key] = value;
      }
    }
  }

  snapshot(): UndergroundSharedContextState {
    return {
      ...this.state,
      centerInvocations: [...this.state.centerInvocations],
      runningRootletInvocations:
        this.state.runningRootletInvocations === undefined ? undefined : [...this.state.runningRootletInvocations],
      expectedRootletKinds:
        this.state.expectedRootletKinds === undefined ? undefined : [...this.state.expectedRootletKinds],
      rootletOutputs: [...this.state.rootletOutputs],
      completedRootletInvocations: [...this.state.completedRootletInvocations],
    };
  }

  require<K extends keyof UndergroundSharedContextState>(
    key: K,
    label = String(key)
  ): NonNullable<UndergroundSharedContextState[K]> {
    const value = this.state[key];
    if (value === undefined) {
      throw new UndergroundSharedContextError(`Underground shared context missing ${label}.`);
    }
    return value as NonNullable<UndergroundSharedContextState[K]>;
  }
}

export function assertSharedContextWriteOwner(agentId: string, field: SharedContextField): void {
  const owners = SHARED_CONTEXT_FIELD_OWNERS[field];
  if (owners.some((owner) => owner === agentId || (owner === ROOTLET_AGENT_OWNER && isRootletAgentId(agentId)))) {
    return;
  }
  throw new UndergroundSharedContextError(
    `${agentId} cannot write UndergroundSharedContext.${field}; owner is ${owners.join(" or ")}.`
  );
}

function isRootletAgentId(agentId: string): boolean {
  return agentId.startsWith("underground-rootlet-");
}
