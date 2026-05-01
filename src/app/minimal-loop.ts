import type {
  ArborMessageType,
  Constraint,
  DirectionHandoff,
  DirectionHandoffPackage,
  ExperienceCandidate,
  FruitCandidate,
  GrowthPlan,
  PathBias,
  RunObservationSnapshot,
  RunMemory,
  TaskSpec,
  UndergroundExplorationReport,
  VerificationReport,
  WorkflowIR,
} from "../domain/contracts.js";
import { createRunObservationSnapshot } from "../domain/observation/index.js";
import type { ArtifactRecord } from "../kernel/artifacts/in-memory-artifact-store.js";
import { createId } from "../kernel/id.js";
import { createMessage } from "../kernel/messages/create-message.js";
import { AbovegroundPlanner, GovernanceReview, UndergroundAnalyzer, Verifier, WorkerAgent } from "./agents.js";
import { createMinimalRuntime, type MinimalRuntime } from "./runtime.js";

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
  directionHandoff: DirectionHandoff;
  directionHandoffPackage: DirectionHandoffPackage;
  loadedDirectionHandoffPackage: DirectionHandoffPackage;
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

export function runMinimalLoop(
  goal = "Build the first deterministic minimal AgentArbor runtime loop.",
  options: RunMinimalLoopOptions = {}
): MinimalLoopResult {
  const runtime = createMinimalRuntime();
  if (options.constraints !== undefined) {
    runtime.constraints = options.constraints;
  }

  const traceId = createId("trace");
  const goalId = createId("goal");
  runtime.bus.publish(
    createMessage({
      traceId,
      from: { id: "user", role: "user" },
      to: { role: "underground_center" },
      type: "goal.received",
      intent: "receive_user_goal",
      payload: { goalId, goal },
    })
  );

  const undergroundAnalyzer = new UndergroundAnalyzer();
  const abovegroundPlanner = new AbovegroundPlanner();
  const workerAgent = new WorkerAgent();
  const verifier = new Verifier();
  const governanceReview = new GovernanceReview();

  const { directionHandoff, directionHandoffPackage, undergroundReport } = undergroundAnalyzer.analyze(
    goalId,
    goal,
    traceId,
    runtime
  );
  const {
    directionHandoffPackage: loadedDirectionHandoffPackage,
    growthPlan,
    workflow,
    task,
  } = abovegroundPlanner.plan(directionHandoff.id, directionHandoff.version, traceId, runtime);
  const assignedAgent = runtime.router.route(task);
  const assignedTask = workerAgent.assignTask(task, growthPlan, runtime.constraints, traceId, runtime);
  if (assignedAgent.id !== workerAgent.agentId) {
    throw new Error(`Unexpected worker assignment: ${assignedAgent.id}`);
  }
  const artifact = workerAgent.produceArtifact(assignedTask, traceId, runtime);
  const verification = verifier.verify(assignedTask, [artifact.ref.id], traceId, runtime);
  const { fruit, runMemory, experienceCandidate, pathBias } = governanceReview.review(
    directionHandoff,
    growthPlan,
    assignedTask,
    [artifact.ref.id],
    verification,
    traceId,
    runtime,
    EXPECTED_DEMO_EVENTS
  );
  const observationSnapshot = createRunObservationSnapshot({
    traceId,
    goalId,
    eventEntries: runtime.eventLog.list(),
    undergroundReport,
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
    directionHandoff,
    directionHandoffPackage,
    loadedDirectionHandoffPackage,
    undergroundReport,
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
