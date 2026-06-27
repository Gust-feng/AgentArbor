/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ① fake 骨架（确定性假实现）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
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
import { createGlobalSoilView } from "../domain/soil/index.js";
import type { ArtifactRecord } from "../kernel/artifacts/in-memory-artifact-store.js";
import { AbovegroundPlanner, GovernanceReview, Verifier, WorkerAgent } from "./agents.js";
import {
  createUndergroundAiDisabledConfigurationError,
  createUndergroundAiRuntimeConfig,
  type UndergroundAiEnvironment,
  type UndergroundAiMode,
  type UndergroundAiProviderFetch,
} from "./underground-ai-runtime.js";
import type { MinimalRuntime } from "./runtime.js";
import { runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";
import type { ModelOutputDelta } from "../domain/intelligence/index.js";
import type { ToolExecutionBroker } from "../domain/tools/index.js";
import type { UndergroundDirectionSessionRuntimeContext } from "./underground-direction-session.js";
import { createTaskSoilFromDesktopInput, type DesktopTaskSoilInput } from "./task-soil-workspace.js";

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
  aiMode?: UndergroundAiMode;
  aiEnvironment?: UndergroundAiEnvironment;
  providerFetch?: UndergroundAiProviderFetch;
  taskSoilInput?: DesktopTaskSoilInput;
  createToolCenter?: (runtime: MinimalRuntime) => ToolExecutionBroker;
  onRuntimeReady?: (context: UndergroundDirectionSessionRuntimeContext) => void;
  onModelOutputDelta?: (delta: ModelOutputDelta) => void;
};

export async function runMinimalLoop(
  goal = "Build the first local AI-driven AgentArbor desktop runtime loop.",
  options: RunMinimalLoopOptions = {}
): Promise<MinimalLoopResult> {
  const aiMode = options.aiMode ?? "fake";
  const aiConfig = createUndergroundAiRuntimeConfig({
    mode: aiMode,
    env: options.aiEnvironment,
    fetch: options.providerFetch,
    onModelOutputDelta: options.onModelOutputDelta,
  });
  if (!aiConfig.enabled) {
    throw createUndergroundAiDisabledConfigurationError(aiConfig.summaryInput);
  }

  const underground = await runUndergroundDirectionSessionWithIntelligence(goal, {
    constraints: options.constraints,
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
    createToolCenter: options.createToolCenter ?? aiConfig.createToolCenter,
    onRuntimeReady: options.onRuntimeReady,
  });
  const runtime = underground.runtime;
  const taskSoil = createTaskSoilFromDesktopInput({
    goal,
    goalId: underground.goalId,
    traceId: underground.traceId,
    aiMode,
    constraints: runtime.constraints,
    soilStore: runtime.soilStore,
    taskSoilInput: options.taskSoilInput,
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
