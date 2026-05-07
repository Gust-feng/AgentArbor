import type {
  ArborMessageType,
  Constraint,
  DirectionHandoff,
  ExperienceCandidate,
  FruitCandidate,
  GrowthPlan,
  GlobalSoilView,
  PathBias,
  PlanPackage,
  RunObservationSnapshot,
  RunMemory,
  TaskSoil,
  TaskSpec,
  UndergroundExplorationReport,
  VerificationReport,
  WorkflowIR,
} from "../domain/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import { createGlobalSoilView, createTaskSoil } from "../domain/soil/index.js";
import type { ArtifactRecord } from "../kernel/artifacts/in-memory-artifact-store.js";
import { AbovegroundPlanner, GovernanceReview, Verifier, WorkerAgent } from "./agents.js";
import { createUndergroundAiRuntimeConfig } from "./intelligence-channel-factory.js";
import type { MinimalRuntime } from "./runtime.js";
import { runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";

export const EXPECTED_DEMO_EVENTS: ArborMessageType[] = [
  "goal.received",
  "underground.exploration_planned",
  "rootlet_cluster.started",
  "exploration_candidate.produced",
  "candidate_pool.updated",
  "convergence_review.completed",
  "direction_handoff.completed",
  "growth_plan.completed",
  "workflow.created",
  "task.created",
  "task.assigned",
  "artifact.produced",
  "verification.completed",
  "fruit.proposed",
  "governance.review.completed",
  "run_memory.captured",
  "experience_candidate.proposed",
  "path_bias.suggested",
];

export type MinimalLoopResult = {
  runtime: MinimalRuntime;
  taskSoil: TaskSoil;
  globalSoilView: GlobalSoilView;
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: PlanPackage;
  loadedDirectionHandoffPackage: PlanPackage;
  undergroundReport: UndergroundExplorationReport;
  growthPlan: GrowthPlan;
  workflow: WorkflowIR;
  task: TaskSpec;
  artifact: ArtifactRecord;
  verification: VerificationReport;
  fruit: FruitCandidate;
  runMemory: RunMemory;
  experienceCandidate: ExperienceCandidate;
  pathBias: PathBias;
  observationSnapshot: RunObservationSnapshot;
  eventTypes: ArborMessageType[];
};

export type RunMinimalLoopOptions = {
  constraints?: Constraint[];
};

export async function runMinimalLoop(
  goal = "Build the first local AI-driven AgentArbor desktop runtime loop.",
  options: RunMinimalLoopOptions = {}
): Promise<MinimalLoopResult> {
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI runtime config to be enabled for the minimal AgentArbor loop.");
  }

  const underground = await runUndergroundDirectionSessionWithIntelligence(goal, {
    constraints: options.constraints,
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter: aiConfig.createToolCenter,
  });
  const runtime = underground.runtime;
  const taskSoil = createTaskSoil({
    rawGoal: goal,
    goalId: underground.goalId,
    traceId: underground.traceId,
    contextRefs: [
      {
        ref: `workspace:${underground.goalId}`,
        kind: "workspace",
        summary: "Desktop Shell provided the current task workspace context as refs only.",
      },
    ],
    constraints: runtime.constraints,
    permissionBoundaryRefs: ["read:workspace:current-task", "write:memory://artifacts", "execute:fake-ai"],
    globalSoilRefs: [
      ...runtime.soilStore.listCapabilityAssetRefs().map((ref) => ref.id),
      ...runtime.soilStore.listPathBiasRefs().map((ref) => ref.id),
    ],
    runMaterialRefs: [underground.traceId],
    createdAt: new Date().toISOString(),
  });
  const globalSoilView = createGlobalSoilView(runtime.soilStore);
  const abovegroundPlanner = new AbovegroundPlanner();
  const workerAgent = new WorkerAgent();
  const verifier = new Verifier();
  const governanceReview = new GovernanceReview();

  if (underground.terminalStatus !== "approved_package_created" || underground.directionHandoff === undefined) {
    throw new Error(`Minimal AgentArbor loop requires an approved Plan Package; got ${underground.terminalStatus}.`);
  }
  const directionHandoff = underground.directionHandoff;
  const {
    directionHandoffPackage: loadedDirectionHandoffPackage,
    growthPlan,
    workflow,
    task,
  } = abovegroundPlanner.plan(directionHandoff.id, directionHandoff.version, underground.traceId, runtime);
  const assignedAgent = runtime.router.route(task);
  const assignedTask = workerAgent.assignTask(task, growthPlan, runtime.constraints, underground.traceId, runtime);
  if (assignedAgent.id !== workerAgent.agentId) {
    throw new Error(`Unexpected worker assignment: ${assignedAgent.id}`);
  }
  const artifact = workerAgent.produceArtifact(assignedTask, underground.traceId, runtime);
  const verification = verifier.verify(assignedTask, [artifact.ref.id], underground.traceId, runtime);
  const { fruit, runMemory, experienceCandidate, pathBias } = governanceReview.review(
    directionHandoff,
    growthPlan,
    assignedTask,
    [artifact.ref.id],
    verification,
    underground.traceId,
    runtime
  );
  const observationSnapshot = createRunObservationSnapshot({
    traceId: underground.traceId,
    goalId: underground.goalId,
    eventEntries: runtime.eventLog.list(),
    undergroundReport: underground.undergroundReport,
    directionHandoffPackage: loadedDirectionHandoffPackage,
    growthPlan,
    workflow,
    task: assignedTask,
    artifactRefs: [artifact.ref],
    verification,
    fruit,
    runMemory,
    experienceCandidate,
    pathBias,
  });

  return {
    runtime,
    taskSoil,
    globalSoilView,
    directionHandoff,
    directionHandoffPackage: underground.directionHandoffPackage,
    loadedDirectionHandoffPackage,
    undergroundReport: underground.undergroundReport,
    growthPlan,
    workflow,
    task: assignedTask,
    artifact,
    verification,
    fruit,
    runMemory,
    experienceCandidate,
    pathBias,
    observationSnapshot,
    eventTypes: runtime.eventLog.types(),
  };
}
