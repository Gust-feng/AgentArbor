import type { AgentManifest } from "../../domain/contracts.js";

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
    },
  ];
}
