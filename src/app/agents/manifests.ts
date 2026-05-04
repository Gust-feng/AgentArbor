import type { AgentManifest, AgentTurnPermissionPolicy } from "../../domain/contracts.js";
import { ROOTLET_CLUSTER_KINDS, type RootletClusterKind } from "../../domain/underground/index.js";

const DISABLED_TURN_POLICY: AgentTurnPermissionPolicy = {
  allowModel: false,
  allowedTools: [],
  maxModelRounds: 0,
  maxToolRounds: 0,
  fallback: "disabled",
};

const ROOTLET_SEARCH_TOOLS_BY_KIND: Readonly<Record<RootletClusterKind, readonly string[]>> = {
  option: ["web_search"],
  risk: [],
  asset_fit: [],
  evidence: ["web_search"],
  constraint: [],
  counterfactual: [],
};

export function createDemoAgentManifests(): AgentManifest[] {
  return [
    {
      id: "underground-analyzer",
      name: "Underground Analyzer",
      layer: "underground_center",
      description: "Shapes the raw user goal into converged direction handoff material.",
      lifecycle: {
        status: "active",
        createdReason: "Required for the first deterministic DirectionHandoff.",
        retirementCondition: "A governed underground analyzer replaces the fake deterministic implementation.",
      },
      capabilities: ["goal.shape", "risk.discovery", "option.mapping", "direction.handoff"],
      inputEvents: ["goal.received"],
      outputEvents: [
        "underground.exploration_planned",
        "rootlet_cluster.started",
        "exploration_candidate.produced",
        "candidate_pool.updated",
        "convergence_review.completed",
        "direction_handoff.completed",
      ],
      permissions: {
        read: ["soil_index"],
        write: ["direction_handoff"],
        execute: [],
      },
      turnPolicy: DISABLED_TURN_POLICY,
    },
    {
      id: "aboveground-planner",
      name: "Aboveground Planner",
      layer: "aboveground_center",
      description: "Turns an approved direction handoff into GrowthPlan, WorkflowIR, and TaskSpec.",
      lifecycle: {
        status: "active",
        createdReason: "Required for the first deterministic GrowthPlan.",
        retirementCondition: "A governed aboveground planner replaces the fake deterministic implementation.",
      },
      capabilities: ["growth.plan", "workflow.ir", "task.slice"],
      inputEvents: ["direction_handoff.completed"],
      outputEvents: ["growth_plan.completed", "workflow.created", "task.created"],
      permissions: {
        read: ["direction_handoff"],
        write: ["growth_plan", "workflow_ir", "task_spec"],
        execute: [],
      },
      turnPolicy: DISABLED_TURN_POLICY,
    },
    {
      id: "worker-agent",
      name: "Worker Agent",
      layer: "aboveground_growth",
      description: "Produces the minimal deterministic artifact.",
      lifecycle: {
        status: "active",
        createdReason: "Required to prove task assignment and artifact production.",
        retirementCondition: "A governed worker capability replaces the fake deterministic implementation.",
      },
      capabilities: ["artifact.produce", "minimal.agentapp.write"],
      inputEvents: ["task.assigned"],
      outputEvents: ["artifact.produced"],
      permissions: {
        read: ["task_spec"],
        write: ["artifact_store"],
        execute: [],
      },
      turnPolicy: DISABLED_TURN_POLICY,
    },
    {
      id: "verifier",
      name: "Verifier",
      layer: "verification",
      description: "Checks the deterministic artifact and emits a passed VerificationReport.",
      lifecycle: {
        status: "active",
        createdReason: "Required to prove the verification gate.",
        retirementCondition: "A governed verifier replaces the fake deterministic implementation.",
      },
      capabilities: ["artifact.verify", "constraint.review"],
      inputEvents: ["artifact.produced"],
      outputEvents: ["verification.completed"],
      permissions: {
        read: ["artifact_store", "task_spec"],
        write: ["verification_report"],
        execute: [],
      },
      turnPolicy: DISABLED_TURN_POLICY,
    },
    {
      id: "governance-review",
      name: "Governance Review",
      layer: "governance",
      description: "Turns verified output into fruit, run memory, experience candidate, and path bias.",
      lifecycle: {
        status: "active",
        createdReason: "Required to prove the Fruits -> Governance -> Soil feedback path.",
        retirementCondition: "A governed review system replaces the fake deterministic implementation.",
      },
      capabilities: ["fruit.review", "run_memory.capture", "experience.propose", "path_bias.suggest"],
      inputEvents: ["verification.completed"],
      outputEvents: [
        "fruit.proposed",
        "governance.review.completed",
        "run_memory.captured",
        "experience_candidate.proposed",
        "path_bias.suggested",
      ],
      permissions: {
        read: ["artifact_store", "verification_report"],
        write: ["fruit_candidate", "run_memory", "experience_candidate", "path_bias"],
        execute: [],
      },
      turnPolicy: DISABLED_TURN_POLICY,
    },
  ];
}

export function createUndergroundAgentClusterManifests(): AgentManifest[] {
  return [
    undergroundClusterManifest({
      id: "underground-intent-core",
      name: "Underground Intent Core",
      description: "Creates the deterministic goal intent profile that drives underground scheduling.",
      capabilities: ["goal.intent_profile", "constraint.extract"],
      inputEvents: ["goal.received"],
      outputEvents: ["underground.exploration_planned"],
    }),
    undergroundClusterManifest({
      id: "underground-growth-governor",
      name: "Underground Growth Governor",
      description: "Bounds radial exploration budget and rootlet startup.",
      capabilities: ["growth.budget", "rootlet.schedule"],
      inputEvents: ["underground.exploration_planned"],
      outputEvents: ["rootlet_cluster.started"],
    }),
    ...ROOTLET_CLUSTER_KINDS.map(createUndergroundRootletAgentManifest),
    undergroundClusterManifest({
      id: "underground-candidate-pool",
      name: "Underground Candidate Pool",
      description: "Builds the formal candidate pool after rootlet outputs arrive.",
      capabilities: ["candidate.pool", "rootlet.output.collect"],
      inputEvents: ["exploration_candidate.produced"],
      outputEvents: ["candidate_pool.updated"],
    }),
    undergroundClusterManifest({
      id: "underground-convergence-judge",
      name: "Underground Convergence Judge",
      description: "Judges candidate pool outputs before handoff material can be approved.",
      capabilities: ["candidate.compare", "convergence.judge"],
      inputEvents: ["candidate_pool.updated"],
      outputEvents: ["convergence_review.completed"],
    }),
    undergroundClusterManifest({
      id: "underground-handoff-steward",
      name: "Underground Handoff Steward",
      description: "Packages approved or awaiting underground direction material at the handoff boundary.",
      capabilities: ["direction.handoff", "package.reference"],
      inputEvents: ["convergence_review.completed"],
      outputEvents: ["direction_handoff.completed", "user_approval.requested"],
    }),
  ];
}

function createUndergroundRootletAgentManifest(kind: RootletClusterKind): AgentManifest {
  const allowedTools = ROOTLET_SEARCH_TOOLS_BY_KIND[kind];
  return undergroundClusterManifest({
    id: undergroundRootletAgentId(kind),
    name: `Underground Rootlet ${kind}`,
    description: `Produces bounded ${kind} rootlet output for the current underground run.`,
    capabilities: [`rootlet.${kind}`, "rootlet.output"],
    inputEvents: ["rootlet_cluster.started"],
    outputEvents: ["exploration_candidate.produced"],
    execute: allowedTools,
    turnPolicy: {
      allowModel: true,
      allowedTools,
      maxModelRounds: 3,
      maxToolRounds: 2,
      fallback: "deterministic",
    },
  });
}

export function undergroundRootletAgentId(kind: RootletClusterKind): string {
  return `underground-rootlet-${kind.replace("_", "-")}`;
}

function undergroundClusterManifest(input: {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  inputEvents: AgentManifest["inputEvents"];
  outputEvents: AgentManifest["outputEvents"];
  execute?: readonly string[];
  turnPolicy?: AgentTurnPermissionPolicy;
}): AgentManifest {
  return {
    id: input.id,
    name: input.name,
    layer: "underground_center",
    description: input.description,
    lifecycle: {
      status: "active",
      createdReason: "Runtime-only underground agent cluster scheduling proof.",
      retirementCondition: "A governed underground capability asset replaces this deterministic runtime manifest.",
    },
    capabilities: input.capabilities,
    inputEvents: input.inputEvents,
    outputEvents: input.outputEvents,
    permissions: {
      read: ["soil_index", "direction_handoff_context"],
      write: ["underground_candidate_pool", "direction_handoff"],
      execute: [...(input.execute ?? [])],
    },
    turnPolicy: input.turnPolicy ?? DISABLED_TURN_POLICY,
  };
}
