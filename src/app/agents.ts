import {
  assertDirectionHandoffConverged,
  createApprovedDirectionHandoff,
  markCandidatesAccepted,
} from "../domain/agentarbor/direction-handoff.js";
import type {
  ArborMessageType,
  ConvergenceReview,
  Constraint,
  DirectionHandoff,
  ExperienceCandidate,
  ExplorationCandidateRef,
  FruitCandidate,
  GrowthPlan,
  PathBias,
  RunMemory,
  TaskSpec,
  VerificationReport,
  WorkflowIR,
  WorkflowIRNode,
} from "../domain/contracts.js";
import { createId, nowIso } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { assignTask, assertLayerCanCreateExplorationCandidate, enterPlanning } from "../kernel/state-machine/task-state-machine.js";
import type { MinimalRuntime } from "./runtime.js";

type DirectionOutput = {
  sourceCandidates: ExplorationCandidateRef[];
  convergenceReview: ConvergenceReview;
  directionHandoff: DirectionHandoff;
};

type PlanOutput = {
  growthPlan: GrowthPlan;
  workflow: WorkflowIR;
  task: TaskSpec;
};

export class UndergroundAnalyzer {
  readonly agentId = "underground-analyzer";

  analyze(goalId: string, goal: string, traceId: string, runtime: MinimalRuntime): DirectionOutput {
    const sourceCandidates: ExplorationCandidateRef[] = [
      {
        id: createId("candidate"),
        kind: "claim_candidate",
        producedByAgentId: this.agentId,
        clusterId: "underground-rootlet-minimal",
        sourceRefs: ["goal.received"],
        status: "candidate",
      },
    ];

    const convergenceReview: ConvergenceReview = {
      reviewId: createId("convergence"),
      reviewedByAgentIds: [this.agentId],
      leadAgentId: this.agentId,
      crossCheckedCandidateRefs: sourceCandidates.map((candidate) => candidate.id),
      deduplicatedCandidateRefs: sourceCandidates.map((candidate) => candidate.id),
      acceptedCandidateRefs: sourceCandidates.map((candidate) => candidate.id),
      rejectedCandidateRefs: [],
      conflictResolutionRefs: [],
      provenanceRefs: ["goal.received", "soil:minimal-constraints"],
    };

    const acceptedCandidates = markCandidatesAccepted(sourceCandidates, convergenceReview.acceptedCandidateRefs);
    const selectedOptionId = createId("direction-option");
    const directionHandoff = createApprovedDirectionHandoff(
      {
        id: createId("direction-handoff"),
        version: 1,
        sourceGoalId: goalId,
        rawUserInputRef: "goal.received",
        clarifiedGoal: goal,
        nonGoals: ["real_llm", "real_agentarbor_assets", "ui", "database", "external_adapters"],
        assumptions: ["The user-confirmed plan is sufficient for a deterministic first runtime loop."],
        missingInformation: [],
        soilRefs: ["soil:minimal-constraints"],
        evidenceRefs: [
          "docs/开发指南/06-工程实现/06-最小实现边界.md",
          "docs/开发指南/04-模型与契约/04-最小运行契约.md",
        ],
        constraintRefs: runtime.constraints.map((constraint) => ({
          constraintId: constraint.id,
          requiredLevel: constraint.level,
          enforcementGate: constraint.enforcementGate,
        })),
        candidateConstraintRefs: [],
        risks: ["First implementation proves deterministic loop only; external adapters remain out of scope."],
        options: [
          {
            optionId: selectedOptionId,
            directionSummary: "Run an in-memory deterministic minimal AgentArbor loop.",
            supportingEvidenceRefs: ["minimal-runtime-contract"],
            soilAssetFitRefs: ["soil:minimal-constraints"],
            constraintImpact: runtime.constraints.map((constraint) => constraint.id),
            riskProfile: ["limited_to_fake_agents"],
            costProfile: ["local_node_test_only"],
            unknowns: [],
            whyNot: [],
            recommendationScore: 1,
            doNotChooseWhen: ["A real adapter, UI, database, or model call is required."],
          },
        ],
        decisionRecord: {
          retainedOptionId: selectedOptionId,
          mergedOptionIds: [],
          rejectedOptionIds: [],
          userDecisionRequired: [],
          abovegroundReferenceOptionIds: [selectedOptionId],
          rationaleEvidenceRefs: ["user-confirmed-minimal-loop-plan"],
          rationaleConstraintRefs: runtime.constraints.map((constraint) => constraint.id),
          rationaleRiskRefs: ["limited_to_fake_agents"],
        },
        riskRegister: [
          {
            riskId: "risk-fake-agent-overreach",
            name: "Fake agents must not become product facts.",
            source: "AGENTS.md",
            impactScope: ["adapters", "governance", "soil"],
            blockingLevel: "watch",
            evidenceRefs: ["AGENTS.md"],
            mitigation: ["Keep fake agents in app demo layer and under deterministic tests."],
          },
        ],
        sourceCandidateRefs: acceptedCandidates,
        convergenceReviewRef: convergenceReview.reviewId,
        recommendedOptionId: selectedOptionId,
        growthEntry: {
          allowedRuntimeShapes: ["single_agent"],
          suggestedFirstWorkflowNodes: ["generate", "verify", "memory", "govern"],
          escalationRules: ["Request a NutrientRequest instead of aboveground direction exploration."],
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      convergenceReview
    );

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "underground_center" },
        to: { role: "aboveground_center" },
        type: "direction_handoff.completed",
        intent: "complete_direction_handoff",
        payload: { directionHandoff },
      })
    );

    return { sourceCandidates, convergenceReview, directionHandoff };
  }
}

export class AbovegroundPlanner {
  readonly agentId = "aboveground-planner";

  plan(directionHandoff: DirectionHandoff, traceId: string, runtime: MinimalRuntime): PlanOutput {
    enterPlanning(directionHandoff);

    const growthPlanId = createId("growth-plan");
    const workflowId = createId("workflow");
    const taskId = createId("task");
    const createdAt = nowIso();
    const task: TaskSpec = {
      id: taskId,
      goalId: directionHandoff.sourceGoalId,
      growthPlanId,
      title: "Produce minimal deterministic AgentApp artifact",
      description: "Produce an in-memory artifact proving the first AgentArbor runtime loop.",
      requiredCapabilities: ["artifact.produce", "minimal.agentapp.write"],
      acceptanceCriteria: [
        "Artifact exists in InMemoryArtifactStore.",
        "VerificationReport status is passed.",
        "Governance produces fruit, run memory, experience candidate, and path bias.",
      ],
      constraintRefs: directionHandoff.constraintRefs.filter((ref) => ref.enforcementGate === "task_assignment"),
      status: "Draft",
      createdAt,
    };

    const workflowNode = (id: string, type: WorkflowIRNode["type"], dependsOn: string[]): WorkflowIRNode => ({
      id,
      type,
      taskId: type === "generate" || type === "verify" ? taskId : undefined,
      dependsOn,
      inputs: type === "generate" ? [directionHandoff.id] : [],
      outputs: type === "generate" ? ["artifact"] : [type],
      executionCondition: "approved_direction_handoff",
      requiredPermissions: [],
      constraintRefs: directionHandoff.constraintRefs,
      verificationGate: type === "verify" ? "minimal-verification" : undefined,
      failureHandling: type === "verify" ? "request_nutrient" : "block",
      pausePoints: [],
      resumeHints: [],
      pathBiasRefs: [],
      nutrientRequestTriggers: ["verification_failed", "nutrient_gap"],
      harvestOutputs: type === "memory" ? ["run_memory", "experience_candidate", "path_bias"] : [],
    });

    const workflow: WorkflowIR = {
      id: workflowId,
      goalId: directionHandoff.sourceGoalId,
      directionHandoffId: directionHandoff.id,
      directionHandoffVersion: directionHandoff.version,
      growthPlanId,
      growthPlanVersion: 1,
      nodes: [
        workflowNode("node-generate", "generate", []),
        workflowNode("node-verify", "verify", ["node-generate"]),
        workflowNode("node-memory", "memory", ["node-verify"]),
        workflowNode("node-govern", "govern", ["node-memory"]),
      ],
      dependencies: [
        { fromNodeId: "node-generate", toNodeId: "node-verify" },
        { fromNodeId: "node-verify", toNodeId: "node-memory" },
        { fromNodeId: "node-memory", toNodeId: "node-govern" },
      ],
      inputs: [directionHandoff.id],
      outputs: ["artifact", "verification_report", "fruit_candidate", "run_memory", "experience_candidate", "path_bias"],
      executionConditions: ["DirectionHandoff.status == approved"],
      permissions: {
        canRead: ["direction_handoff", "task_spec"],
        canWrite: ["artifact_store", "verification_report", "fruit_candidate", "run_memory", "experience_candidate", "path_bias"],
        canExecute: [],
      },
      constraintRefs: directionHandoff.constraintRefs,
      verificationGates: ["minimal-verification"],
      failureHandling: ["verification_failed -> nutrient_request.requested"],
      pausePoints: [],
      pathBiasInputs: [],
      nutrientRequestTriggers: ["verification_failed", "nutrient_gap"],
      harvestOutputs: ["run_memory", "experience_candidate", "path_bias"],
      createdAt,
    };

    const growthPlan: GrowthPlan = {
      id: growthPlanId,
      version: 1,
      goalId: directionHandoff.sourceGoalId,
      directionHandoffId: directionHandoff.id,
      directionHandoffVersion: directionHandoff.version,
      selectedOptionId: directionHandoff.recommendedOptionId ?? directionHandoff.options[0]?.optionId ?? "unknown-option",
      pathBiasDecision: "none",
      pathBiasRationale: "No prior PathBias is required for the first deterministic loop.",
      workflowId,
      runtimeShape: "single_agent",
      tasks: [task],
      reuseStrategy: ["Reuse the deterministic kernel contracts before adding adapters."],
      sedimentationStrategy: ["Capture run memory and propose experience candidate after verification."],
      constraintRefs: directionHandoff.constraintRefs,
      constraintDistribution: [{ taskId, constraintRefs: task.constraintRefs }],
      verificationGates: ["minimal-verification"],
      nutrientRequestTriggers: ["verification_failed", "nutrient_gap"],
      createdAt,
    };

    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "aboveground_center" },
        to: { group: "runtime" },
        type: "growth_plan.completed",
        intent: "complete_growth_plan",
        payload: { growthPlan },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "aboveground_center" },
        to: { group: "runtime" },
        type: "workflow.created",
        intent: "create_workflow_ir",
        payload: { workflow },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId,
        from: { id: this.agentId, role: "aboveground_center" },
        to: { role: "aboveground_growth" },
        type: "task.created",
        intent: "create_task",
        payload: { task },
        requiredCapabilities: task.requiredCapabilities,
      })
    );

    return { growthPlan, workflow, task };
  }

  createExplorationCandidate(): ExplorationCandidateRef {
    assertLayerCanCreateExplorationCandidate("aboveground_center");
    throw new Error("unreachable");
  }
}

export class WorkerAgent {
  readonly agentId = "worker-agent";

  assignTask(task: TaskSpec, growthPlan: GrowthPlan, constraints: Constraint[], traceId: string, runtime: MinimalRuntime): TaskSpec {
    const assignedTask = assignTask(task, growthPlan, constraints);
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: "simple-router", role: "aboveground_center" },
        to: { role: "aboveground_growth" },
        type: "task.assigned",
        intent: "assign_task",
        payload: { task: assignedTask, assignedAgentId: this.agentId },
        requiredCapabilities: task.requiredCapabilities,
      })
    );
    return assignedTask;
  }

  produceArtifact(task: TaskSpec, traceId: string, runtime: MinimalRuntime) {
    const artifact = runtime.artifactStore.save({
      taskId: task.id,
      producedBy: this.agentId,
      type: "document",
      uri: `memory://artifacts/${task.id}`,
      content: "Minimal AgentApp artifact produced by deterministic WorkerAgent.",
      summary: "Minimal deterministic AgentApp artifact.",
    });
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: this.agentId, role: "aboveground_growth" },
        to: { role: "verification" },
        type: "artifact.produced",
        intent: "produce_artifact",
        payload: { artifact: artifact.ref, summary: artifact.summary },
        artifacts: [artifact.ref],
      })
    );
    return artifact;
  }
}

export class Verifier {
  readonly agentId = "verifier";

  verify(task: TaskSpec, artifactIds: string[], traceId: string, runtime: MinimalRuntime): VerificationReport {
    const verification: VerificationReport = {
      id: createId("verification"),
      taskId: task.id,
      artifactIds,
      status: "passed",
      checks: [
        { name: "artifact_exists", status: artifactIds.length > 0 ? "passed" : "failed" },
        { name: "hard_constraints_active", status: "passed" },
        { name: "soft_constraints_recorded", status: "passed" },
        { name: "preference_did_not_override_hard_constraint", status: "passed" },
      ],
      createdAt: nowIso(),
    };
    runtime.bus.publish(
      createMessage({
        traceId,
        taskId: task.id,
        from: { id: this.agentId, role: "verification" },
        to: { role: "governance" },
        type: "verification.completed",
        intent: "complete_verification",
        payload: { verification },
      })
    );
    return verification;
  }
}

type GovernanceOutput = {
  fruit: FruitCandidate;
  runMemory: RunMemory;
  experienceCandidate: ExperienceCandidate;
  pathBias: PathBias;
};

export class GovernanceReview {
  readonly agentId = "governance-review";

  review(
    directionHandoff: DirectionHandoff,
    growthPlan: GrowthPlan,
    task: TaskSpec,
    artifactIds: string[],
    verification: VerificationReport,
    traceId: string,
    runtime: MinimalRuntime,
    finalEventTypes?: ArborMessageType[]
  ): GovernanceOutput {
    assertDirectionHandoffConverged(directionHandoff, {
      reviewId: directionHandoff.convergenceReviewRef,
      reviewedByAgentIds: ["underground-analyzer"],
      leadAgentId: "underground-analyzer",
      crossCheckedCandidateRefs: directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
      deduplicatedCandidateRefs: directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
      acceptedCandidateRefs: directionHandoff.sourceCandidateRefs.map((candidate) => candidate.id),
      rejectedCandidateRefs: [],
      conflictResolutionRefs: [],
      provenanceRefs: directionHandoff.evidenceRefs,
    });

    const fruit: FruitCandidate = {
      id: createId("fruit"),
      sourceGoalId: directionHandoff.sourceGoalId,
      artifactIds,
      verificationIds: [verification.id],
      proposedBy: this.agentId,
      governanceStatus: "proposed",
      createdAt: nowIso(),
    };
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "fruit.proposed",
        intent: "propose_fruit",
        payload: { fruit },
      })
    );
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "governance.review.completed",
        intent: "complete_governance_review",
        payload: {
          fruitId: fruit.id,
          decision: "approved_for_soil_review",
          checks: ["permissions", "lineage", "version", "applicability", "retirement_path"],
        },
      })
    );

    const runMemory: RunMemory = {
      id: createId("run-memory"),
      sourceGoalId: directionHandoff.sourceGoalId,
      directionHandoffId: directionHandoff.id,
      directionHandoffVersion: directionHandoff.version,
      growthPlanId: growthPlan.id,
      nutrientRequestIds: [],
      nutrientPatchIds: [],
      growthPlanRevisionIds: [],
      sourceTaskIds: [task.id],
      sourceAgentIds: ["underground-analyzer", "aboveground-planner", "worker-agent", "verifier", this.agentId],
      artifactIds,
      verificationIds: [verification.id],
      actualPath: finalEventTypes ?? runtime.eventLog.types(),
      deviations: [],
      successPatterns: ["approved_direction_to_verified_artifact_to_governed_memory"],
      failurePatterns: [],
      reusableSignals: ["minimal_loop_event_order", "task_assignment_requires_growth_plan"],
      riskNotes: ["Fake agents are demo-only and not governed Capability Assets."],
      createdAt: nowIso(),
    };
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "run_memory.captured",
        intent: "capture_run_memory",
        payload: { runMemory },
      })
    );

    const experienceCandidate: ExperienceCandidate = {
      id: createId("experience-candidate"),
      sourceRunMemoryId: runMemory.id,
      appliesToGoalTypes: ["minimal-runtime-kernel"],
      reusablePattern: "Use deterministic in-memory contracts to prove loop integrity before adding adapters.",
      preconditions: ["approved DirectionHandoff", "GrowthPlan", "explicit verification gate"],
      requiredVerificationGates: growthPlan.verificationGates,
      doNotApplyWhen: ["real model calls or persistent assets are in scope"],
      confidence: "high",
      governanceStatus: "captured",
    };
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "experience_candidate.proposed",
        intent: "propose_experience_candidate",
        payload: { experienceCandidate },
      })
    );

    const pathBias: PathBias = {
      id: createId("path-bias"),
      sourceExperienceCandidateId: experienceCandidate.id,
      appliesToGoalTypes: ["minimal-runtime-kernel"],
      preconditions: experienceCandidate.preconditions,
      preferredNodes: ["generate", "verify", "memory", "govern"],
      preferredCapabilities: ["artifact.produce", "artifact.verify", "fruit.review"],
      requiredVerificationGates: growthPlan.verificationGates,
      knownFailureModes: ["hard_constraint_violation", "unapproved_direction_handoff"],
      doNotApplyWhen: experienceCandidate.doNotApplyWhen,
      confidence: "high",
    };
    runtime.bus.publish(
      createMessage({
        traceId,
        from: { id: this.agentId, role: "governance" },
        to: { group: "soil-feedback" },
        type: "path_bias.suggested",
        intent: "suggest_path_bias",
        payload: { pathBias },
      })
    );

    return { fruit, runMemory, experienceCandidate, pathBias };
  }
}
