/**
 * DeepRuntime —— deep 运行聚合层（deep 一期，T2-6/T2-7，ADR-0025 §5.3/§7）。
 *
 * 职责边界（design.md §3.1/§5/§7.1/§7.2）：
 *   - 聚合 {@link DeepRunExecutor}（manager 决策循环）+ {@link DeepConversation}（隔离），
 *     把一次 deep run 驱动成完整可观察、可持久化、可复盘的运行记录；
 *   - run 启动时冻结 {@link BasicAgentCapabilitySnapshot}（FR-003），据 activeModel 判定
 *     modelAvailable（AI-first 边界，无模型拒绝运行）；
 *   - 从 executor 结果**增量构建 domain {@link AgentRunTree}**（root manager + child runs +
 *     delegation decisions + parent syntheses），复用 agent-fabric 的 tree 操作；
 *   - 按 step 顺序发布事件序列（delegation_planned / child_started / child_completed /
 *     parent_synthesis_completed / control），复用 underground-events 的投影语义；
 *   - 持久化 deep 产物（run + agentRunTree + report + controlEvents）到**隔离 deep 分区**
 *     （DeepRunRecordStore，镜像 DeepConversationStore 口径）；
 *   - 产出 {@link DeepExplorationReport}（结论如何形成的可追溯证据链，FR-009）。
 *
 * T2-7 打断/纠正/停止（FR-008）：每次 run 创建独立 {@link DeepRunControlHandle}，传入
 * executor 注入 control point；handle 随结果暴露，供 API 层转发用户 interrupt/correct/stop。
 *
 * 复用边界：
 *   - 复用 deep-run-executor.startDeepRun（manager 决策循环 + control point）；
 *   - 复用 agent-fabric（createAgentRunTree / appendChildRunToTree /
 *     appendDelegationDecisionToTree / appendParentSynthesisToTree / completeAgentRunTree）；
 *   - 复用 underground-events（publishAgentDelegationPlanned / publishChildAgentRunStarted /
 *     publishChildAgentRunCompleted / publishParentSynthesisCompleted）；
 *   - 复用 child-delegation.DEEP_MANAGER_AGENT_ID（manager agent id 口径）。
 *   - 不 import cognitive-work-session-* / underground/orchestrator*（legacy，design.md §4.1）。
 *
 * 命名红线：消费 contracts.ts 的 SynthesizedConclusion / DeepExplorationReport；不引入
 * Plan / directionHandoffPackage / artifact / Fruits 产物字段。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type { MinimalRuntime } from "../runtime.js";
import { createId, nowIso } from "../../kernel/id.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import type {
  AgentRunTree,
  AgentSpec,
  ChildAgentRun,
  ChildAgentRunParentInstruction,
  DelegationDecision,
  DelegationDecisionAction,
  ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import {
  appendChildRunToTree,
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  completeAgentRunTree,
  createAgentRunTree,
  replaceChildRunInTree,
} from "../../domain/underground/agent-fabric.js";
import {
  createDeepEventPublisher,
  type DeepEventPublisher,
  type DeepRunStreamEvent,
} from "./deep-events.js";
import type {
  DeepChildStatus,
  DeepChildSummary,
  DeepChildTask,
  DeepConversation,
  DeepExplorationReport,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepLiveChildExecutionProjection,
  DeepLiveChildParentOperationProjection,
  DeepLiveChildParentInstructionProjection,
  DeepLiveChildProjection,
  DeepLiveChildWorkflowItem,
  DeepLivePhase,
  DeepLiveProjection,
  DeepResearchBrief,
  DeepRun,
  DeepRunStatus,
  DeepTaskBoardPhase,
  DeepTaskBoardSnapshot,
  DeepDelegationDecision,
  SynthesizedConclusion,
} from "./contracts.js";
import { DEEP_RUN_KIND, DEEP_RUN_MODE } from "./contracts.js";
import {
  createDeepRunControlHandle,
  startDeepRun,
  type DeepRunControlEvent,
  type DeepRunControlHandle,
  type DeepRunExecutorConfig,
  type DeepRunExecutorResult,
  type DeepRunProgressEvent,
  type DeepRunStopReason,
  type StartDeepRunInput,
  DEEP_MANAGER_MAX_MODEL_ROUNDS,
  DEEP_MANAGER_MAX_TOOL_ROUNDS,
} from "./deep-run-executor.js";
import { DEEP_MANAGER_AGENT_ID, exploreDeepChild } from "./child-delegation.js";
import {
  continueDeepChildAgent,
  type DeepChildParentMessageContext,
} from "./deep-child-agent-runner.js";
import { DEEP_DECISION_CONTRACT_ID } from "./deep-model-io.js";
import {
  DeepChildScheduler,
  type DeepChildExecutedQueuedInstruction,
  type DeepChildInstructionRecord,
  type DeepChildInstructionQueueHandle,
  type ExploreDeepChildFactory,
} from "./deep-child-scheduler.js";
import {
  createDeepChildMessageRecord,
  type DeepChildMessageStore,
} from "./deep-child-messages.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import type { DeepChildPendingContinuationStore } from "./deep-child-continuations.js";

// ---------------------------------------------------------------------------
// 常量：manager root spec（AgentRunTree root，FR-009 可复盘 root agent 元数据）
// ---------------------------------------------------------------------------

/** deep run 的运行级分区名（隔离 deep 产物，镜像 deep-conversations 口径）。 */
export const DEEP_RUN_RECORD_PARTITION = "deep-runs";

/**
 * 构造 manager root AgentSpec（AgentRunTree.rootSpec）。manager 是纯推理决策者
 * （allowedTools=[]，工具调用并入 child 探索），outputContract 指向 deep_decision。
 */
export function buildDeepManagerSpec(createdAt: string): AgentSpec {
  return {
    specId: "deep-manager",
    agentId: DEEP_MANAGER_AGENT_ID,
    displayName: "Deep Manager",
    agentKind: "manager",
    role: "deep_manager",
    protocol: {
      inputs: [{ source: "workspace", key: "task_soil_goal", required: true }],
      outputs: [{ type: "decision", payloadSchema: DEEP_DECISION_CONTRACT_ID }],
    },
    promptRef: "prompt:deep.manager.v1",
    outputContractRef: DEEP_DECISION_CONTRACT_ID,
    permissions: {
      allowModel: true,
      allowedTools: [],
      maxModelRounds: DEEP_MANAGER_MAX_MODEL_ROUNDS,
      maxToolRounds: DEEP_MANAGER_MAX_TOOL_ROUNDS,
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: DEEP_MANAGER_MAX_MODEL_ROUNDS,
      maxToolRounds: DEEP_MANAGER_MAX_TOOL_ROUNDS,
      maxOutputRefs: 16,
    },
    inputRefs: [],
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// 持久化端口：DeepRunRecordStore（隔离 deep 分区）
// ---------------------------------------------------------------------------

/**
 * 一次 deep run 的持久化记录。承载完整可复盘证据链（FR-009）：
 *   - run：run 级元数据 + 冻结的 capabilitySnapshot；
 *   - agentRunTree：root manager + child runs + delegation decisions + parent syntheses
 *     （事件序列的结构化投影，replay 可重建"manager 决策 → child 探索 → 父层综合 → 结论"路径）；
 *   - report：DeepExplorationReport（结论如何形成，含 childSummaries + synthesisRecords）；
 *   - controlEvents：T2-7 打断/纠正/停止事件（FR-008）。
 */
export type DeepRunRecord = {
  readonly run: DeepRun;
  readonly agentRunTree: AgentRunTree;
  readonly report?: DeepExplorationReport;
  readonly controlEvents: readonly DeepRunControlEvent[];
  readonly eventSequence: readonly DeepRunStreamEvent[];
  readonly liveProjection?: DeepLiveProjection;
  /** T2-1：首次 spawn 后装配的研究简报（FR-BRIEF-01/02），供 Panel 消费。 */
  readonly brief?: DeepResearchBrief;
  readonly updatedAt: string;
};

/**
 * DeepRunRecord 持久化端口。隔离 deep 分区（与 deep-conversations 同级），
 * 语义镜像 DeepConversationStore。InMemory 实现用于测试，FileSystem 实现用于真实运行。
 */
export interface DeepRunRecordStore {
  upsert(record: DeepRunRecord): Promise<DeepRunRecord>;
  get(runId: string): Promise<DeepRunRecord | undefined>;
  list(limit?: number): Promise<readonly DeepRunRecord[]>;
}

/** 内存 DeepRunRecordStore（测试与开发态）。 */
export class InMemoryDeepRunRecordStore implements DeepRunRecordStore {
  private readonly records = new Map<string, DeepRunRecord>();

  async upsert(record: DeepRunRecord): Promise<DeepRunRecord> {
    this.records.set(record.run.runId, record);
    return record;
  }

  async get(runId: string): Promise<DeepRunRecord | undefined> {
    return this.records.get(runId);
  }

  async list(limit = 50): Promise<readonly DeepRunRecord[]> {
    const all = [...this.records.values()].sort(compareDeepRunRecordByRecency);
    return all.slice(0, limit);
  }
}

function compareDeepRunRecordByRecency(left: DeepRunRecord, right: DeepRunRecord): number {
  return right.run.updatedAt.localeCompare(left.run.updatedAt);
}

/**
 * 文件系统 DeepRunRecordStore（隔离 deep 分区，镜像 createFileSystemDeepConversationStore）。
 * 写入 `${runtimeHome}/deep-runs/<runId>/record.json`。
 */
export function createFileSystemDeepRunRecordStore(runtimeHome: string): DeepRunRecordStore {
  const root = path.join(runtimeHome, DEEP_RUN_RECORD_PARTITION);
  return {
    async upsert(record: DeepRunRecord): Promise<DeepRunRecord> {
      const dir = path.join(root, record.run.runId);
      await fs.mkdir(dir, { recursive: true });
      await writeJsonFile(path.join(dir, "record.json"), record);
      return record;
    },
    async get(runId: string): Promise<DeepRunRecord | undefined> {
      return readJsonFile<DeepRunRecord>(path.join(root, runId, "record.json"));
    },
    async list(limit = 50): Promise<readonly DeepRunRecord[]> {
      const entries: readonly Dirent[] = await fs.readdir(root, { withFileTypes: true }).catch(
        (error: unknown) => {
          if (isNodeError(error, "ENOENT")) return [];
          throw error;
        },
      );
      const records: DeepRunRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const record = await readJsonFile<DeepRunRecord>(
          path.join(root, entry.name, "record.json"),
        );
        if (record) records.push(record);
      }
      return records.sort(compareDeepRunRecordByRecency).slice(0, limit);
    },
  };
}

// ---------------------------------------------------------------------------
// DeepRuntime 配置与输入/输出
// ---------------------------------------------------------------------------

/**
 * DeepRuntime 配置。turnRuntime + runtime（事件 bus）+ store（持久化端口）+ executor 可选项。
 * runtime.bus 用于发布事件序列；store 用于持久化 deep 产物到隔离分区。
 */
export type DeepRuntimeConfig = {
  readonly turnRuntime: AgentTurnRuntime;
  readonly runtime: MinimalRuntime;
  readonly store: DeepRunRecordStore;
  readonly stepLimit?: number;
  readonly maxChildren?: number;
  /** T2-1：per-run scheduler 并发上限（注入 scheduler 用，默认 executor 内部值）。 */
  readonly maxConcurrency?: number;
  readonly managerMaxModelRounds?: number;
  readonly managerMaxToolRounds?: number;
  /**
   * 可选外部注入的 control handle（T2-7，FR-008）。
   * - 未提供时内部创建独立 handle（默认批次运行口径）；
   * - 提供时复用之，使 API 层（T3-3）可在 run 生命周期内转发用户
   *   interrupt/correct/stop，也使运行侧 control 行为可被测试脚本化注入。
   */
  readonly controlHandle?: DeepRunControlHandle;
  readonly childContinuations?: DeepChildPendingContinuationStore;
  readonly childInstructionQueues?: DeepChildInstructionQueueRegistry;
  readonly childMessageStore?: DeepChildMessageStore;
};

export type DeepChildInstructionQueueRegistry = {
  readonly register: (runId: string, handle: DeepChildInstructionQueueHandle) => void;
  readonly unregister: (runId: string, handle: DeepChildInstructionQueueHandle) => void;
};

/**
 * 启动一次 deep run 的输入（DeepRuntime 层）。`modelAvailable` 由调用方据冻结的
 * capabilitySnapshot.activeModel 判定（AI-first 边界）。
 */
export type StartDeepRuntimeInput = {
  readonly conversation: DeepConversation;
  readonly taskSoil: TaskSoil;
  readonly permissionBoundaryRefs: readonly string[];
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  readonly aiMode?: ModelRuntimeMode;
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly modelAvailable: boolean;
  readonly traceId: string;
  readonly goalId: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
  readonly followUpContext?: DeepFollowUpContext;
  readonly intakeContext?: DeepIntakeContext;
  /**
   * 可选预指派 runId（T3-1/EP4）。API 层需在启动 run 前就知道 runId 以注册
   * controlHandle 注册表与返回给客户端；未提供时内部生成（测试 / 直接调用口径）。
   */
  readonly runId?: string;
};

/**
 * DeepRuntime 一次 run 的结果。暴露 agentRunTree（可复盘证据链）、report（结论如何形成）、
 * controlHandle（T2-7，供 API 层转发 interrupt/correct/stop）。
 */
export type DeepRuntimeRunResult = {
  readonly run: DeepRun;
  readonly agentRunTree: AgentRunTree;
  readonly report?: DeepExplorationReport;
  readonly controlEvents: readonly DeepRunControlEvent[];
  readonly eventSequence: readonly DeepRunStreamEvent[];
  readonly controlHandle: DeepRunControlHandle;
  readonly stopReason: DeepRunStopReason;
  readonly failure?: string;
};

// ---------------------------------------------------------------------------
// 主入口：executeDeepRun
// ---------------------------------------------------------------------------

/**
 * 驱动一次完整 deep run：聚合 executor + AgentRunTree 构建 + 事件序列 + 持久化 + report。
 *
 * 流程（T2-6/T2-7）：
 *   1. 创建 DeepRun（running）+ 冻结 capabilitySnapshot（FR-003）；
 *   2. 创建独立 DeepRunControlHandle（T2-7，FR-008）；
 *   3. 委托 startDeepRun 驱动 manager 决策循环（control point 已注入）；
 *   4. 从结果增量构建 AgentRunTree + 发布事件序列（delegation/child/synthesis/control）；
 *   5. 产出 DeepExplorationReport（结论存在时）；
 *   6. 持久化到隔离 deep 分区（DeepRunRecordStore）；
 *   7. 返回结果（含 controlHandle 供 API 层转发）。
 */
export async function executeDeepRun(
  input: StartDeepRuntimeInput,
  config: DeepRuntimeConfig,
): Promise<DeepRuntimeRunResult> {
  const startedAt = nowIso();
  // T2-7：复用外部注入的 handle（API 层转发 / 测试脚本化），否则内部创建独立 handle。
  const controlHandle = config.controlHandle ?? createDeepRunControlHandle();
  const runId = input.runId ?? createId("deep-run");
  const run: DeepRun = {
    runId,
    conversationId: input.conversation.conversationId,
    parentRunId: input.parentRunId,
    rootRunId: input.rootRunId ?? runId,
    turnOrdinal: input.turnOrdinal ?? 1,
    goal: deepRuntimeGoal(input.conversation),
    status: "running",
    isolation: {
      kind: "deep_conversation",
      runKind: DEEP_RUN_KIND,
      runMode: DEEP_RUN_MODE,
    },
    aiMode: input.aiMode,
    capabilitySnapshot: input.capabilitySnapshot,
    startedAt,
    updatedAt: startedAt,
  };
  const initialTree = createAgentRunTree({
    treeId: createId("deep-run-tree"),
    rootRunId: run.runId,
    rootAgentId: DEEP_MANAGER_AGENT_ID,
    rootSpec: buildDeepManagerSpec(startedAt),
    createdAt: startedAt,
  });

  const executorInput: StartDeepRunInput = {
    run,
    conversation: input.conversation,
    taskSoil: input.taskSoil,
    permissionBoundaryRefs: input.permissionBoundaryRefs,
    confirmationPolicy: input.confirmationPolicy,
    capabilitySnapshot: input.capabilitySnapshot,
    modelAvailable: input.modelAvailable,
    traceId: input.traceId,
    goalId: input.goalId,
    followUpContext: input.followUpContext,
    intakeContext: input.intakeContext,
    control: controlHandle,
  };

  // 创建 deep 事件发布器（EP2/EP3）：发布 deep.* 到 bus + 累积安全投影 eventSequence。
  const publisher = createDeepEventPublisher({
    runtime: config.runtime,
    traceId: input.traceId,
    runId: run.runId,
  });
  publisher.publishGoalReceived({ goal: run.goal, conversationId: run.conversationId });
  let liveProjection = createStartingLiveProjection(run, startedAt);
  const writeLiveRecord = async (nextProjection: DeepLiveProjection): Promise<void> => {
    liveProjection = nextProjection;
    await config.store.upsert({
      run,
      agentRunTree: initialTree,
      report: undefined,
      controlEvents: [],
      eventSequence: publisher.events,
      liveProjection,
      updatedAt: liveProjection.updatedAt,
    });
  };
  await writeLiveRecord(liveProjection);

  // T2-1（FR-PROJ-01/02）：装配 per-run board + scheduler（注入 board + child Agent run 工厂 +
  // 并发配置 + 生命周期回调）。scheduler 回调在 child 真实状态变化时实时发布 deep.* 事件 +
  // 从 board.snapshot() 派生 liveProjection + store.upsert，使投影/事件/持久化在同一事实源上对齐。
  const board = new DeepTaskBoard({ runId: run.runId });
  const recordedChildInstructions: DeepChildInstructionRecord[] = [];
  const exploreFactory: ExploreDeepChildFactory = (childRun, childSpec) =>
    exploreDeepChild({
      childRun,
      childSpec,
      goal: deepRuntimeGoal(input.conversation),
      permissionBoundaryRefs: input.permissionBoundaryRefs,
      turnRuntime: config.turnRuntime,
      traceId: input.traceId,
      goalId: input.goalId,
      confirmationPolicy: input.confirmationPolicy,
      capabilitySnapshot: input.capabilitySnapshot,
    });
  const scheduler = new DeepChildScheduler({
    board,
    exploreFactory,
    continueFactory: async (childRun, childSpec, parentInstruction, previousSummary, parentOperation) =>
      continueDeepChildAgent({
        childRun,
        childSpec,
        previousSummary,
        parentInstruction,
        currentParentInstructionRef: parentOperation.messageRef,
        currentParentReview: parentOperation.review,
        parentMessageHistory: await loadDeepChildParentMessageContext(
          config.childMessageStore,
          run.runId,
          childRun.childRunId,
          recordedChildInstructions,
        ),
        goal: deepRuntimeGoal(input.conversation),
        permissionBoundaryRefs: input.permissionBoundaryRefs,
        turnRuntime: config.turnRuntime,
        traceId: input.traceId,
        goalId: input.goalId,
        confirmationPolicy: input.confirmationPolicy,
        capabilitySnapshot: input.capabilitySnapshot,
      }),
    maxConcurrency: config.maxConcurrency,
    maxChildren: config.maxChildren,
    callbacks: {
      // child pending→running：实时发布 deep.child.started + 从 board 派生投影 + 持久化。
      onChildStarted: async (_task, childRun) => {
        publisher.publishChildStarted({ childRun, agentRunTree: initialTree });
        await writeLiveRecord(
          withChildParentOperationFromRun(
            liveProjectionFromBoard(board.snapshot(), liveProjection),
            childRun,
          ),
        );
      },
      // child→终态（completed/blocked/interrupted/failed）：实时发布 child 事件 + 从 board 派生投影 + 持久化。
      onChildTerminal: async (task, _summary, completedRun, material) => {
        config.childContinuations?.remember(run.runId, material.pendingContinuation);
        if (completedRun.status === "failed") {
          publisher.publishChildFailed({
            childRun: completedRun,
            failure: task.failure,
            agentRunTree: initialTree,
          });
        } else if (completedRun.status === "interrupted") {
          publisher.publishChildInterrupted({
            childRun: completedRun,
            reason: task.failure,
            agentRunTree: initialTree,
          });
        } else if (completedRun.status === "blocked") {
          publisher.publishChildBlocked({
            childRun: completedRun,
            reason: task.failure,
            agentRunTree: initialTree,
          });
        } else {
          publisher.publishChildCompleted({ childRun: completedRun, agentRunTree: initialTree });
        }
        await writeLiveRecord(
          withChildParentOperationFromRun(
            liveProjectionFromBoard(board.snapshot(), liveProjection),
            completedRun,
          ),
        );
      },
      // 父层追加消息已被 scheduler 接收并排队：发布安全队列事实，不包含 raw 指令正文。
      onChildInstructionQueued: async (task, queued) => {
        publisher.publishChildInstructionQueued({
          childRunId: queued.childRunId,
          displayName: task.spec.displayName,
          role: task.spec.role,
          instructionId: queued.instructionId,
          messageRef: queued.messageRef,
          queuedCount: queued.queuedCount,
          agentRunTree: initialTree,
        });
        await writeLiveRecord(
          withChildParentOperation(
            liveProjectionFromBoard(board.snapshot(), liveProjection),
            queued.childRunId,
            {
              status: "queued",
              messageRef: queued.messageRef,
              queuedCount: queued.queuedCount,
              updatedAt: queued.queuedAt,
            },
          ),
        );
      },
      onChildInstructionRecorded: (instruction) => {
        recordedChildInstructions.push(cloneDeepChildInstructionRecord(instruction));
      },
    },
  });
  const instructionQueueHandle = scheduler.getInstructionQueueHandle();
  config.childInstructionQueues?.register(run.runId, instructionQueueHandle);

  const executorConfig: DeepRunExecutorConfig = {
    turnRuntime: config.turnRuntime,
    stepLimit: config.stepLimit,
    maxChildren: config.maxChildren,
    managerMaxModelRounds: config.managerMaxModelRounds,
    managerMaxToolRounds: config.managerMaxToolRounds,
    scheduler,
    // T2-1：onProgress 仅承载 decision/synthesis 相位（child 事件由 scheduler 回调实时发布）。
    // manager.decided 实时发布 deep.manager.decided（保证事件序列顺序 manager.decided→child→synthesis）。
    onProgress: async (event) => {
      if (event.kind === "manager.decided") {
        publisher.publishManagerDecided({
          decision: mapDeepDecisionToDomain(event.decision),
          childSpecs: event.decision.childSpecs.map((spec) => ({
            specId: spec.specId,
            displayName: spec.displayName,
          })),
          agentRunTree: initialTree,
        });
      }
      await writeLiveRecord(liveProjectionFromBoard(board.snapshot(), liveProjection, event));
    },
  };

  let executorResult: DeepRunExecutorResult;
  try {
    // 委托 executor 驱动 manager 决策循环（含 control point，T2-7）。
    executorResult = await startDeepRun(executorInput, executorConfig);
  } finally {
    config.childInstructionQueues?.unregister(run.runId, instructionQueueHandle);
  }
  await persistDeepChildInstructionRecords(
    config.childMessageStore,
    run.runId,
    recordedChildInstructions,
  );
  await persistExecutedQueuedChildMessages(
    config.childMessageStore,
    run.runId,
    executorResult.executedQueuedChildInstructions,
  );

  // T2-1：从结果增量构建 AgentRunTree（结构构建；child/manager 事件已由 scheduler 回调 /
  // onProgress 在运行中实时发布）。board.terminalSnapshot() 供终态对齐（FR-PROJ-03）。
  const tree = await buildAndPublishRunTree({
    runtime: config.runtime,
    traceId: input.traceId,
    runId: run.runId,
    startedAt,
    initialTree,
    executorResult,
    publisher,
    board,
  });

  // 产出 DeepExplorationReport（结论存在时；FR-009 可复盘证据链）。
  const report = buildExplorationReport({
    run,
    conversation: input.conversation,
    agentRunTree: tree,
    childSummaries: executorResult.childSummaries,
    synthesisRecord: executorResult.synthesisRecord,
    conclusion: executorResult.conclusion,
  });

  // 持久化到隔离 deep 分区（eventSequence 为 SSE 轮询源 + replay，EP3 安全投影）。
  const finalRun = executorResult.run;
  const updatedAt = nowIso();
  const finalLiveProjection = liveProjectionFromFinal({
    previous: liveProjection,
    run: finalRun,
    terminalSnapshot: board.terminalSnapshot(),
    synthesisRecord: executorResult.synthesisRecord,
    conclusion: executorResult.conclusion,
    updatedAt,
  });
  const record: DeepRunRecord = {
    run: finalRun,
    agentRunTree: tree,
    report,
    controlEvents: executorResult.controlEvents,
    eventSequence: publisher.events,
    liveProjection: finalLiveProjection,
    brief: executorResult.brief,
    updatedAt,
  };
  await config.store.upsert(record);

  return {
    run: finalRun,
    agentRunTree: tree,
    report,
    controlEvents: executorResult.controlEvents,
    eventSequence: publisher.events,
    controlHandle,
    stopReason: executorResult.stopReason,
    failure: executorResult.failure,
  };
}

async function persistDeepChildInstructionRecord(
  store: DeepChildMessageStore | undefined,
  runId: string,
  instruction: DeepChildInstructionRecord,
): Promise<void> {
  if (store === undefined) {
    return;
  }
  await store.upsert(createDeepChildMessageRecord({
    runId,
    childRunId: instruction.childRunId,
    instructionId: instruction.instructionId,
    messageRef: instruction.messageRef,
    source: instruction.source,
    status: instruction.status,
    content: instruction.instruction,
    requestedAt: instruction.requestedAt,
    queuedAt: instruction.queuedAt,
    executedAt: instruction.executedAt,
    cancelledAt: instruction.cancelledAt,
  }));
}

async function persistDeepChildInstructionRecords(
  store: DeepChildMessageStore | undefined,
  runId: string,
  instructions: readonly DeepChildInstructionRecord[],
): Promise<void> {
  for (const instruction of instructions) {
    await persistDeepChildInstructionRecord(store, runId, instruction);
  }
}

async function loadDeepChildParentMessageContext(
  store: DeepChildMessageStore | undefined,
  runId: string,
  childRunId: string,
  recordedInstructions: readonly DeepChildInstructionRecord[] = [],
): Promise<readonly DeepChildParentMessageContext[]> {
  const contexts = new Map<string, DeepChildParentMessageContext>();
  if (store === undefined) {
    return parentMessageContextsFromRecordedInstructions(childRunId, recordedInstructions);
  }
  const records = await store.listForChild(runId, childRunId);
  for (const record of records) {
    if (record.status !== "executed") {
      continue;
    }
    contexts.set(record.messageRef, {
      messageRef: record.messageRef,
      source: record.source,
      status: record.status,
      content: record.content,
      updatedAt: record.updatedAt,
    });
  }
  for (const context of parentMessageContextsFromRecordedInstructions(childRunId, recordedInstructions)) {
    contexts.set(context.messageRef, context);
  }
  return [...contexts.values()].sort(compareParentMessageContexts);
}

function parentMessageContextsFromRecordedInstructions(
  childRunId: string,
  instructions: readonly DeepChildInstructionRecord[],
): readonly DeepChildParentMessageContext[] {
  return instructions
    .filter((instruction) =>
      instruction.childRunId === childRunId && instruction.status === "executed"
    )
    .map((instruction) => ({
      messageRef: instruction.messageRef,
      source: instruction.source,
      status: instruction.status,
      content: instruction.instruction,
      updatedAt: instruction.executedAt ?? instruction.queuedAt ?? instruction.requestedAt,
    }))
    .sort(compareParentMessageContexts);
}

function compareParentMessageContexts(
  left: DeepChildParentMessageContext,
  right: DeepChildParentMessageContext,
): number {
  const byTime = left.updatedAt.localeCompare(right.updatedAt);
  return byTime === 0 ? left.messageRef.localeCompare(right.messageRef) : byTime;
}

function cloneDeepChildInstructionRecord(
  instruction: DeepChildInstructionRecord,
): DeepChildInstructionRecord {
  return { ...instruction };
}

async function persistExecutedQueuedChildMessages(
  store: DeepChildMessageStore | undefined,
  runId: string,
  instructions: readonly DeepChildExecutedQueuedInstruction[],
): Promise<void> {
  if (store === undefined || instructions.length === 0) {
    return;
  }
  await Promise.all(instructions.map((instruction) =>
    store.upsert(createDeepChildMessageRecord({
      runId,
      childRunId: instruction.childRunId,
      instructionId: instruction.instructionId,
      messageRef: instruction.messageRef,
      source: instruction.source,
      status: "executed",
      content: instruction.instruction,
      requestedAt: instruction.queuedAt,
      queuedAt: instruction.queuedAt,
      executedAt: instruction.executedAt,
    }))
  ));
}

function createStartingLiveProjection(run: DeepRun, updatedAt: string): DeepLiveProjection {
  return {
    phase: "starting",
    activeNodeId: "goal",
    children: [],
    updatedAt,
  };
}

/**
 * T2-1（FR-PROJ-01/02）：从 DeepTaskBoard.snapshot() 派生 liveProjection。
 *
 * board 是运行中单一事实源（design.md §6 风险3）：children 从 snapshot.tasks 派生
 * （status 经 DeepChildStatus → ChildAgentRun["status"] 映射），phase 从 snapshot.phase
 * 经 DeepTaskBoardPhase → DeepLivePhase 映射。可选的 event 用于叠加 decision/synthesis/
 * conclusion 字段（board 不承载这些投影字段），child 事件不经此参数（由 scheduler 回调
 * 直接调本函数，不传 event）。
 */
function liveProjectionFromBoard(
  snapshot: DeepTaskBoardSnapshot,
  previous: DeepLiveProjection,
  event?: DeepRunProgressEvent,
): DeepLiveProjection {
  // children 从 board 单一事实源派生（DeepChildStatus 七态映射为展示状态），
  // 父层操作短投影由 scheduler 回调叠加并在后续 board 投影中按 childRunId 保留。
  const previousChildren = new Map(previous.children.map((child) => [child.childRunId, child]));
  const children = snapshot.tasks.map((task) =>
    mapTaskToLiveChild(task, previousChildren.get(task.childRunId))
  );
  let activeNodeId = previous.activeNodeId;
  let decision = previous.decision;
  let synthesis = previous.synthesis;
  let conclusion = previous.conclusion;

  // event 叠加 decision/synthesis/conclusion 投影字段（board 不承载这些）。
  if (event) {
    switch (event.kind) {
      case "decision.started":
        activeNodeId = "decision";
        break;
      case "manager.decided":
        decision = {
          decisionId: event.decision.decisionId,
          action: event.decision.action,
          summary: event.decision.decisionSummary,
          confidence: event.decision.confidence,
          updatedAt: event.recordedAt,
        };
        activeNodeId = activeNodeForDecision(event.decision.action);
        break;
      case "synthesis.started":
        activeNodeId = "synthesis";
        synthesis = {
          ...(previous.synthesis ?? { status: "running" as const }),
          status: "running",
          updatedAt: event.recordedAt,
        };
        break;
      case "synthesis.completed":
        activeNodeId = "conclusion";
        synthesis = {
          synthesisId: event.synthesisRecord.synthesisId,
          status: "completed",
          summary: event.synthesisRecord.decisionSummary,
          confidence: event.synthesisRecord.confidence,
          updatedAt: event.recordedAt,
        };
        conclusion = {
          conclusionId: event.conclusion.conclusionId,
          oneLineRationale: event.conclusion.oneLineRationale,
          confidence: event.conclusion.confidence,
          updatedAt: event.recordedAt,
        };
        break;
      // child.started/child.completed 不经 onProgress（由 scheduler 回调直接调本函数）。
      default:
        break;
    }
  }

  return {
    ...previous,
    phase: mapBoardPhaseToLivePhase(snapshot.phase),
    activeNodeId,
    children,
    decision,
    synthesis,
    conclusion,
    updatedAt: event?.recordedAt ?? snapshot.updatedAt,
  };
}

/**
 * DeepTaskBoardPhase（调度相位）→ DeepLivePhase（展示相位）映射。
 * planning/waiting 等调度相位映射为用户可理解的展示相位（design.md §3.4.3）。
 */
function mapBoardPhaseToLivePhase(phase: DeepTaskBoardPhase): DeepLivePhase {
  switch (phase) {
    case "planning":
    case "deciding":
      return "deciding";
    case "exploring":
    case "waiting":
      return "exploring";
    case "synthesizing":
      return "synthesizing";
    case "completed":
      return "completed";
    case "needs_input":
      return "needs_input";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    default:
      return "deciding";
  }
}

/**
 * DeepChildStatus（任务板七态）→ ChildAgentRun["status"]（展示态）映射。
 * pending → planned（未启动），blocked/interrupted 保留 child 自身状态，cancelled → interrupted（被取消视同打断）。
 */
function mapBoardChildStatusToLiveStatus(status: DeepChildStatus): ChildAgentRun["status"] {
  switch (status) {
    case "pending":
      return "planned";
    case "blocked":
      return "blocked";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "cancelled":
      return "interrupted";
    default:
      return "planned";
  }
}

/** DeepChildTask → DeepLiveChildProjection（从 board 任务派生展示节点）。 */
function mapTaskToLiveChild(
  task: DeepChildTask,
  previous?: DeepLiveChildProjection,
): DeepLiveChildProjection {
  const status = mapBoardChildStatusToLiveStatus(task.status);
  const workflowItems = liveChildWorkflowItemsFromTask(task, previous);
  return {
    childRunId: task.childRunId,
    displayName: task.spec.displayName,
    objective: task.spec.objective,
    role: task.spec.role,
    status,
    updatedAt: task.updatedAt,
    summary: task.summary?.summary,
    latestResult: latestResultForLiveChild(status, task.summary?.summary, task.failure),
    confidence: task.summary?.confidence,
    uncertainty: task.summary?.uncertainty,
    workflowItems,
    execution: previous?.execution,
    parentInstructions: previous?.parentInstructions,
    pendingApproval: task.pendingApproval,
    parentOperation: previous?.parentOperation,
  };
}

function withChildParentOperationFromRun(
  projection: DeepLiveProjection,
  childRun: ChildAgentRun,
): DeepLiveProjection {
  return withChildDetailFromRun(projection, childRun);
}

function withChildParentOperation(
  projection: DeepLiveProjection,
  childRunId: string,
  operation: DeepLiveChildParentOperationProjection,
): DeepLiveProjection {
  let found = false;
  const children = projection.children.map((child) => {
    if (child.childRunId !== childRunId) {
      return child;
    }
    found = true;
    return {
      ...child,
      parentOperation: operation,
      workflowItems: mergeLiveChildWorkflowItems([
        ...(child.workflowItems ?? []),
        workflowItemForParentOperation(childRunId, operation),
      ]),
      updatedAt: operation.updatedAt,
    };
  });
  if (!found) {
    return projection;
  }
  return {
    ...projection,
    activeNodeId: childRunId,
    children,
    updatedAt: operation.updatedAt,
  };
}

function withChildDetailFromRun(
  projection: DeepLiveProjection,
  childRun: ChildAgentRun,
): DeepLiveProjection {
  let found = false;
  const children = projection.children.map((child) => {
    if (child.childRunId !== childRun.childRunId) {
      return child;
    }
    found = true;
    const operation = liveParentOperationFromInstruction(childRun.parentInstructions?.at(-1));
    const execution = liveChildExecutionFromRun(childRun);
    const parentInstructions = liveChildParentInstructionsFromRun(childRun);
    const workflowItems = liveChildWorkflowItemsFromRun(childRun, child);
    const updatedAt = childRun.completedAt ?? operation?.updatedAt ?? child.updatedAt;
    return {
      ...child,
      status: childRun.status,
      updatedAt,
      latestResult: latestResultForLiveChild(
        childRun.status,
        child.summary,
        childRun.failureReason,
      ),
      execution,
      parentInstructions,
      workflowItems,
      pendingApproval: childRun.pendingApproval ?? child.pendingApproval,
      parentOperation: operation ?? child.parentOperation,
    };
  });
  if (!found) {
    return projection;
  }
  return {
    ...projection,
    activeNodeId: childRun.childRunId,
    children,
    updatedAt: childRun.completedAt ?? projection.updatedAt,
  };
}

function liveChildWorkflowItemsFromTask(
  task: DeepChildTask,
  previous?: DeepLiveChildProjection,
): readonly DeepLiveChildWorkflowItem[] {
  return mergeLiveChildWorkflowItems([
    {
      itemId: `objective:${task.childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: task.spec.objective,
      status: "completed",
      timestamp: task.startedAt ?? task.updatedAt,
    },
    ...preservedLiveChildWorkflowItems(previous),
    ...workflowItemsForTaskState(task),
  ]);
}

function preservedLiveChildWorkflowItems(
  previous: DeepLiveChildProjection | undefined,
): readonly DeepLiveChildWorkflowItem[] {
  if (previous?.workflowItems === undefined) {
    return [];
  }
  return previous.workflowItems.filter((item) =>
    item.kind !== "objective_set" &&
    item.kind !== "running" &&
    item.itemId !== `status:${previous.childRunId}:${previous.status}`
  );
}

function workflowItemsForTaskState(task: DeepChildTask): readonly DeepLiveChildWorkflowItem[] {
  const items: DeepLiveChildWorkflowItem[] = [];
  if (task.pendingApproval !== undefined) {
    items.push({
      itemId: `tool-waiting:${task.childRunId}:${task.pendingApproval.confirmationId}`,
      kind: "tool_waiting",
      title: "等待确认",
      detail: `${task.pendingApproval.toolName}：${task.pendingApproval.actionSummary}`,
      status: "blocked",
      timestamp: task.pendingApproval.requestedAt,
    });
  }
  switch (task.status) {
    case "pending":
      items.push({
        itemId: `status:${task.childRunId}:pending`,
        kind: "running",
        title: "等待启动",
        status: "pending",
        timestamp: task.updatedAt,
      });
      break;
    case "running":
      items.push({
        itemId: `status:${task.childRunId}:running`,
        kind: "running",
        title: "正在探索",
        detail: task.summary?.summary,
        status: "running",
        timestamp: task.updatedAt,
      });
      break;
    case "completed":
      items.push({
        itemId: `status:${task.childRunId}:completed`,
        kind: "completed",
        title: "结果已返回",
        detail: task.summary?.summary,
        status: "completed",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    case "blocked":
      items.push({
        itemId: `status:${task.childRunId}:blocked`,
        kind: "blocked",
        title: "等待处理",
        detail: task.failure ?? task.summary?.summary,
        status: "blocked",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    case "failed":
      items.push({
        itemId: `status:${task.childRunId}:failed`,
        kind: "failed",
        title: "未完成",
        detail: task.failure ?? task.summary?.summary,
        status: "failed",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    case "interrupted":
    case "cancelled":
      items.push({
        itemId: `status:${task.childRunId}:${task.status}`,
        kind: "interrupted",
        title: task.status === "cancelled" ? "已取消" : "已中断",
        detail: task.failure ?? task.summary?.summary,
        status: task.status === "cancelled" ? "cancelled" : "interrupted",
        timestamp: task.completedAt ?? task.updatedAt,
      });
      break;
    default:
      break;
  }
  return items;
}

function liveChildWorkflowItemsFromRun(
  childRun: ChildAgentRun,
  previous: DeepLiveChildProjection,
): readonly DeepLiveChildWorkflowItem[] {
  const items: DeepLiveChildWorkflowItem[] = [
    {
      itemId: `objective:${childRun.childRunId}`,
      kind: "objective_set",
      title: "目标已明确",
      detail: childRun.spec.instructions?.objective ?? previous.objective,
      status: "completed",
      timestamp: childRun.startedAt,
    },
  ];
  for (const instruction of childRun.parentInstructions ?? []) {
    items.push(workflowItemForParentInstruction(childRun.childRunId, instruction));
  }
  for (const [index, segment] of (childRun.executionHistory ?? []).entries()) {
    for (const [callIndex, call] of segment.toolCalls.entries()) {
      items.push({
        itemId: `tool:${childRun.childRunId}:${index}:${call.callId || callIndex}`,
        kind: call.status === "approval_required" ? "tool_waiting" : "tool_completed",
        title: call.status === "approval_required" ? "等待工具确认" : "工具调用完成",
        detail: `${call.toolName}：${toolCallStatusLabel(call.status)}`,
        status: liveWorkflowStatusForToolCall(call.status),
        timestamp: segment.recordedAt,
      });
    }
    items.push({
      itemId: `segment:${childRun.childRunId}:${index}`,
      kind: workflowKindForExecutionOutcome(segment.outcome),
      title: executionOutcomeTitle(segment.outcome),
      detail: `模型 ${segment.modelRounds} 轮，工具 ${segment.toolRounds} 轮`,
      status: segment.outcome,
      timestamp: segment.recordedAt,
    });
  }
  if ((childRun.executionHistory?.length ?? 0) === 0 && childRun.execution !== undefined) {
    items.push({
      itemId: `execution:${childRun.childRunId}`,
      kind: childRun.status === "running" || childRun.status === "resumed" ? "running" : "completed",
      title: childRun.status === "running" || childRun.status === "resumed" ? "正在探索" : "已产生执行结果",
      detail: `模型 ${childRun.execution.modelRounds} 轮，工具 ${childRun.execution.toolRounds} 轮`,
      status: childRun.status === "running" || childRun.status === "resumed" ? "running" : "completed",
      timestamp: childRun.completedAt ?? previous.updatedAt,
    });
  }
  if (childRun.pendingApproval !== undefined) {
    items.push({
      itemId: `tool-waiting:${childRun.childRunId}:${childRun.pendingApproval.confirmationId}`,
      kind: "tool_waiting",
      title: "等待确认",
      detail: `${childRun.pendingApproval.toolName}：${childRun.pendingApproval.actionSummary}`,
      status: "blocked",
      timestamp: childRun.pendingApproval.requestedAt,
    });
  }
  items.push(workflowItemForRunStatus(childRun, previous));
  return mergeLiveChildWorkflowItems(items);
}

function workflowItemForRunStatus(
  childRun: ChildAgentRun,
  previous: DeepLiveChildProjection,
): DeepLiveChildWorkflowItem {
  const timestamp = childRun.completedAt ?? previous.updatedAt;
  switch (childRun.status) {
    case "completed":
      return {
        itemId: `status:${childRun.childRunId}:completed`,
        kind: "completed",
        title: "结果已返回",
        detail: previous.summary,
        status: "completed",
        timestamp,
      };
    case "blocked":
      return {
        itemId: `status:${childRun.childRunId}:blocked`,
        kind: "blocked",
        title: "等待处理",
        detail: childRun.failureReason ?? previous.summary,
        status: "blocked",
        timestamp,
      };
    case "failed":
      return {
        itemId: `status:${childRun.childRunId}:failed`,
        kind: "failed",
        title: "未完成",
        detail: childRun.failureReason ?? previous.summary,
        status: "failed",
        timestamp,
      };
    case "interrupted":
      return {
        itemId: `status:${childRun.childRunId}:interrupted`,
        kind: "interrupted",
        title: "已中断",
        detail: childRun.failureReason ?? previous.summary,
        status: "interrupted",
        timestamp,
      };
    default:
      return {
        itemId: `status:${childRun.childRunId}:running`,
        kind: "running",
        title: "正在探索",
        detail: previous.summary,
        status: "running",
        timestamp,
      };
  }
}

function workflowItemForParentOperation(
  childRunId: string,
  operation: DeepLiveChildParentOperationProjection,
): DeepLiveChildWorkflowItem {
  return {
    itemId: `parent-operation:${childRunId}:${operation.messageRef ?? operation.updatedAt}`,
    kind: operation.status === "queued" ? "parent_message_queued" : "parent_message_applied",
    title: operation.status === "queued" ? "已追加要求" : operation.status === "cancelled" ? "跟进已取消" : "已跟进",
    detail: operation.queuedCount !== undefined && operation.queuedCount > 1
      ? `排队 ${operation.queuedCount} 条`
      : undefined,
    status: operation.status === "queued" ? "pending" : operation.status === "cancelled" ? "cancelled" : "completed",
    timestamp: operation.updatedAt,
  };
}

function workflowItemForParentInstruction(
  childRunId: string,
  instruction: ChildAgentRunParentInstruction,
): DeepLiveChildWorkflowItem {
  const timestamp = instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt;
  return {
    itemId: `parent-instruction:${childRunId}:${instruction.instructionId}`,
    kind: instruction.status === "queued" ? "parent_message_queued" : "parent_message_applied",
    title: instruction.status === "queued" ? "已追加要求" : instruction.status === "cancelled" ? "跟进已取消" : "已跟进",
    detail: instruction.instructionSummary,
    status: instruction.status === "queued" ? "pending" : instruction.status === "cancelled" ? "cancelled" : "completed",
    timestamp,
  };
}

function mergeLiveChildWorkflowItems(
  items: readonly DeepLiveChildWorkflowItem[],
): readonly DeepLiveChildWorkflowItem[] {
  const byId = new Map<string, DeepLiveChildWorkflowItem>();
  for (const item of items) {
    byId.set(item.itemId, item);
  }
  return [...byId.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  );
}

function liveChildExecutionFromRun(
  childRun: ChildAgentRun,
): DeepLiveChildExecutionProjection | undefined {
  const history = childRun.executionHistory ?? [];
  const latest = history.at(-1);
  const execution = latest ?? childRun.execution;
  if (execution === undefined) {
    return undefined;
  }
  return {
    modelRounds: execution.modelRounds,
    toolRounds: execution.toolRounds,
    segmentCount: history.length === 0 ? 1 : history.length,
    latestOutcome: latest?.outcome,
  };
}

function liveChildParentInstructionsFromRun(
  childRun: ChildAgentRun,
): readonly DeepLiveChildParentInstructionProjection[] | undefined {
  if (childRun.parentInstructions === undefined || childRun.parentInstructions.length === 0) {
    return undefined;
  }
  return childRun.parentInstructions.map((instruction) => ({
    instructionId: instruction.instructionId,
    status: instruction.status,
    instructionSummary: instruction.instructionSummary,
    requestedAt: instruction.requestedAt,
    review: instruction.review === undefined
      ? undefined
      : {
          decision: instruction.review.decision,
          reason: instruction.review.reason,
          confidence: instruction.review.confidence,
        },
  }));
}

function latestResultForLiveChild(
  status: ChildAgentRun["status"],
  summary: string | undefined,
  failure: string | undefined,
): string | undefined {
  if (summary !== undefined && summary.length > 0) {
    return summary;
  }
  if (failure !== undefined && failure.length > 0) {
    return failure;
  }
  switch (status) {
    case "planned":
      return "等待启动";
    case "running":
    case "resumed":
      return "进行中";
    case "blocked":
      return "等待处理";
    case "interrupted":
      return "已中断";
    case "failed":
      return "未完成";
    default:
      return undefined;
  }
}

function toolCallStatusLabel(
  status: NonNullable<ChildAgentRun["execution"]>["toolCalls"][number]["status"],
): string {
  switch (status) {
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "approval_required":
      return "等待确认";
    case "cancelled":
      return "取消";
    default:
      return status;
  }
}

function liveWorkflowStatusForToolCall(
  status: NonNullable<ChildAgentRun["execution"]>["toolCalls"][number]["status"],
): DeepLiveChildWorkflowItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "approval_required":
      return "blocked";
    case "cancelled":
      return "cancelled";
    default:
      return "completed";
  }
}

function workflowKindForExecutionOutcome(
  outcome: NonNullable<DeepLiveChildExecutionProjection["latestOutcome"]>,
): DeepLiveChildWorkflowItem["kind"] {
  switch (outcome) {
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "completed":
    default:
      return "completed";
  }
}

function executionOutcomeTitle(
  outcome: NonNullable<DeepLiveChildExecutionProjection["latestOutcome"]>,
): string {
  switch (outcome) {
    case "blocked":
      return "等待处理";
    case "failed":
      return "执行未完成";
    case "interrupted":
      return "执行已中断";
    case "completed":
    default:
      return "阶段结果已返回";
  }
}

function liveParentOperationFromInstruction(
  instruction: ChildAgentRunParentInstruction | undefined,
): DeepLiveChildParentOperationProjection | undefined {
  if (instruction === undefined) {
    return undefined;
  }
  return {
    status: instruction.status,
    messageRef: instruction.messageRef,
    updatedAt: instruction.executedAt ?? instruction.cancelledAt ?? instruction.queuedAt ?? instruction.requestedAt,
  };
}

/**
 * T2-1（FR-PROJ-03）：终态投影从 board.terminalSnapshot() 派生 children（单一事实源）。
 * 不再依赖 previous.children 或 childSummaries 事后重建——终态 children 直接从 board
 * 终态快照映射，保证 AgentRunTree/liveProjection/eventSequence 三者在同一事实源上对齐。
 */
function liveProjectionFromFinal(input: {
  readonly previous: DeepLiveProjection;
  readonly run: DeepRun;
  readonly terminalSnapshot: DeepTaskBoardSnapshot;
  readonly synthesisRecord?: ParentSynthesisResult;
  readonly conclusion?: SynthesizedConclusion;
  readonly updatedAt: string;
}): DeepLiveProjection {
  // T2-1：children 从 board terminalSnapshot 单一事实源派生；父层操作短投影
  // 是 scheduler 已发布的安全附加事实，按 childRunId 保留到终态流程图。
  const previousChildren = new Map(input.previous.children.map((child) => [child.childRunId, child]));
  const children = input.terminalSnapshot.tasks.map((task) =>
    mapTaskToLiveChild(task, previousChildren.get(task.childRunId))
  );
  const conclusion =
    input.conclusion === undefined
      ? input.previous.conclusion
      : {
          conclusionId: input.conclusion.conclusionId,
          oneLineRationale: input.conclusion.oneLineRationale,
          confidence: input.conclusion.confidence,
          updatedAt: input.updatedAt,
        };
  const synthesis =
    input.synthesisRecord === undefined
      ? input.previous.synthesis
      : {
          synthesisId: input.synthesisRecord.synthesisId,
          status: "completed" as const,
          summary: input.synthesisRecord.decisionSummary,
          confidence: input.synthesisRecord.confidence,
          updatedAt: input.updatedAt,
        };
  const phase = livePhaseForRunStatus(input.run.status);
  return {
    ...input.previous,
    phase,
    activeNodeId: liveActiveNodeForFinal(phase, conclusion !== undefined),
    children,
    synthesis,
    conclusion,
    updatedAt: input.updatedAt,
  };
}

function activeNodeForDecision(action: DeepDelegationDecision["action"]): string {
  switch (action) {
    case "spawn_children":
    case "wait_children":
    case "continue_child":
      return "children";
    case "direct_answer":
    case "synthesize":
      return "synthesis";
    case "ask_user":
      return "decision";
    case "stop":
      return "synthesis";
    default:
      return "decision";
  }
}

function livePhaseForRunStatus(status: DeepRunStatus): DeepLiveProjection["phase"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
    case "corrected":
      return "needs_input";
    case "stopped":
      return "stopped";
    default:
      return "deciding";
  }
}

function liveActiveNodeForFinal(
  phase: DeepLiveProjection["phase"],
  hasConclusion: boolean,
): string {
  if (hasConclusion) {
    return "conclusion";
  }
  if (phase === "failed" || phase === "needs_input") {
    return "decision";
  }
  return "synthesis";
}

// ---------------------------------------------------------------------------
// AgentRunTree 增量构建 + 事件序列发布（复用 agent-fabric + underground-events）
// ---------------------------------------------------------------------------

type BuildAndPublishRunTreeInput = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly initialTree: AgentRunTree;
  readonly executorResult: DeepRunExecutorResult;
  readonly publisher: DeepEventPublisher;
  /** T2-1：per-run board（供终态对齐参考，事件已由 scheduler 回调/onProgress 实时发布）。 */
  readonly board: DeepTaskBoard;
};

/**
 * T2-1：从 executor 结果**按 step 顺序**增量构建 AgentRunTree（结构构建）。
 *
 * 事件发布重构（design.md §3.4 / §6 风险3）：
 *   - deep.manager.decided：已由 onProgress 在 manager 决策时**实时发布**（不再事后重建）；
 *   - deep.child.started/completed/blocked/failed：已由 scheduler 回调在 child 真实状态变化时
 *     **实时发布**（不再事后重建 started→waiting→completed 序列）；
 *   - 本函数仅保留：append decisions/children/syntheses 进 tree（结构构建）+
 *     publishParentSynthesisCompleted（需 childRuns 引用）+ control/conclusion 事件。
 *
 * tree 结构承载完整可复盘证据链（FR-009），事件序列由实时发布 + 本函数收口事件共同构成。
 */
async function buildAndPublishRunTree(
  input: BuildAndPublishRunTreeInput,
): Promise<AgentRunTree> {
  const { executorResult, publisher } = input;
  const result = executorResult;
  let tree = input.initialTree;

  // child runs 按 step 派生顺序消费（childRunId 关联 step.childrenAdded）。
  const childRunById = new Map<string, ChildAgentRun>();
  for (const childRun of result.childRuns) {
    childRunById.set(childRun.childRunId, childRun);
  }
  let controlApiResumeDecisionsAppended = false;

  for (const step of result.steps) {
    const decisionChildRunIds =
      step.dispatchedAction === "continue_child"
        ? step.operatedChildRunIds ?? []
        : step.spawnedChildRunIds ?? [];
    const domainDecision = mapDeepDecisionToDomain(
      step.decision,
      decisionChildRunIds,
    );
    const isConclusionStep =
      step.dispatchedAction === "synthesize" || step.dispatchedAction === "direct_answer";
    if (isConclusionStep && result.synthesisRecord && !controlApiResumeDecisionsAppended) {
      tree = appendControlApiResumeDecisions({
        tree,
        childRunById,
        instructions: result.executedQueuedChildInstructions,
      });
      controlApiResumeDecisionsAppended = true;
    }
    // 该 step 派生的 child runs（仅 spawn_children 非空），用于 append 进 tree。
    const stepChildRuns: ChildAgentRun[] =
      step.childrenAdded?.flatMap((summary) => {
        const childRun = childRunById.get(summary.childRunId);
        return childRun ? [childRun] : [];
      }) ?? [];

    // T2-1：append decision 进 tree（deep.manager.decided 已由 onProgress 实时发布）。
    tree = appendDelegationDecisionToTree(tree, domainDecision, nowIso());

    // T2-1：append child runs 进 tree（deep.child.started/completed/blocked/failed 已由 scheduler
    // 回调在真实状态变化时实时发布，此处只做结构构建，不事后重建事件）。
    for (const childRun of stepChildRuns) {
      tree = appendChildRunToTree(tree, childRun, nowIso());
    }
    if (step.dispatchedAction === "continue_child") {
      for (const childRunId of step.operatedChildRunIds ?? []) {
        const childRun = childRunById.get(childRunId);
        if (childRun !== undefined) {
          tree = replaceChildRunInTree(tree, childRun, nowIso());
        }
      }
    }
    // 结论收口 step：synthesize（多 child 父层综合）或 direct_answer（单源收口）。
    // 两者都产出结论级 synthesisRecord，append 进 tree 的 parentSyntheses（FR-009
    // 可复盘：tree 承载"结论如何形成"；一次 run 仅一个收口 step，不重复 append）。
    if (isConclusionStep && result.synthesisRecord) {
      tree = appendParentSynthesisToTree(tree, result.synthesisRecord, nowIso());
      publisher.publishParentSynthesisCompleted({
        parentSynthesis: result.synthesisRecord,
        childRuns: result.childRuns,
        agentRunTree: tree,
      });
    }
  }

  if (!controlApiResumeDecisionsAppended) {
    tree = appendControlApiResumeDecisions({
      tree,
      childRunById,
      instructions: result.executedQueuedChildInstructions,
    });
  }

  const synthesisAlreadyAppended =
    result.synthesisRecord === undefined
      ? true
      : tree.parentSyntheses.some(
          (synthesis) => synthesis.synthesisId === result.synthesisRecord?.synthesisId,
        );
  if (result.synthesisRecord !== undefined && !synthesisAlreadyAppended) {
    tree = appendParentSynthesisToTree(tree, result.synthesisRecord, nowIso());
    publisher.publishParentSynthesisCompleted({
      parentSynthesis: result.synthesisRecord,
      childRuns: result.childRuns,
      agentRunTree: tree,
    });
  }

  // 发布 T2-7 control 事件（interrupt/correct/stop），承载可观察打断/纠正/停止记录。
  for (const controlEvent of result.controlEvents) {
    publisher.publishControlEvent(controlEvent, tree);
  }

  // 结论存在时发布 deep.conclusion.produced（结论产出，FR-009 证据链收口）。
  if (result.conclusion) {
    publisher.publishConclusionProduced({ conclusion: result.conclusion });
  }
  if (result.run.status === "failed") {
    publisher.publishFailed({
      summary: result.failure ?? "多 Agent 运行失败。",
      agentRunTree: tree,
    });
  }

  // 收口 tree 状态（终态映射 deep run status → tree status）。
  const treeStatus = mapRunStatusToTreeStatus(result.run.status);
  return completeAgentRunTree(tree, treeStatus, nowIso());
}

function appendControlApiResumeDecisions(input: {
  readonly tree: AgentRunTree;
  readonly childRunById: ReadonlyMap<string, ChildAgentRun>;
  readonly instructions: readonly DeepChildExecutedQueuedInstruction[];
}): AgentRunTree {
  let tree = input.tree;
  for (const instruction of input.instructions) {
    if (instruction.source !== "control_api") {
      continue;
    }
    const childRun = input.childRunById.get(instruction.childRunId);
    const updatedAt = instruction.executedAt;
    tree = appendDelegationDecisionToTree(
      tree,
      {
        decisionId: createId("deep-decision"),
        parentAgentId: childRun?.parentAgentId ?? DEEP_MANAGER_AGENT_ID,
        action: "resume_child",
        childSpecIds: childRun === undefined ? [] : [childRun.spec.specId],
        childRunIds: [instruction.childRunId],
        inputRefs: [
          `child_run:${instruction.childRunId}`,
          instruction.messageRef,
        ],
        rationale: "父层追加消息要求同一个子 Agent 继续工作。",
        uncertainty: "该操作来自运行中控制消息；不包含 raw 指令正文。",
        source: "control_api",
        confidence: childRun?.confidence ?? 0.5,
        reasoningTraceRefs: [instruction.messageRef],
        createdAt: instruction.queuedAt,
      },
      updatedAt,
    );
    if (childRun !== undefined) {
      tree = replaceChildRunInTree(tree, childRun, updatedAt);
    }
  }
  return tree;
}

/**
 * deep manager 动作 → domain DelegationDecisionAction 映射（AgentRunTree 持久化用 domain 动作）。
 * 命名映射保持语义一致（manager 决策语义不变，仅落到 domain 持久化口径）。
 */
function mapDeepDecisionToDomain(
  decision: DeepDelegationDecision,
  childRunIds: readonly string[] = [],
): DelegationDecision {
  return {
    decisionId: decision.decisionId,
    parentAgentId: decision.parentAgentId,
    action: mapDeepActionToDomainAction(decision.action),
    childSpecIds: decision.childSpecs.map((spec) => spec.specId),
    childRunIds,
    inputRefs: [...decision.reasoningRefs],
    rationale: decision.rationale,
    uncertainty: decision.uncertainty,
    source: decision.source,
    confidence: decision.confidence,
    reasoningTraceRefs: [...decision.reasoningRefs],
    createdAt: decision.createdAt,
  };
}

function mapDeepActionToDomainAction(action: DeepDelegationDecision["action"]): DelegationDecisionAction {
  switch (action) {
    case "spawn_children":
      return "spawn_children";
    case "wait_children":
      return "wait_for_children";
    case "continue_child":
      return "resume_child";
    case "synthesize":
      return "request_parent_synthesis";
    case "ask_user":
      return "request_user_clarification";
    case "stop":
      return "stop";
    case "direct_answer":
      // direct_answer 视为 manager 直接收口（单源综合），映射到 request_convergence。
      return "request_convergence";
    default:
      return "stop";
  }
}

function mapRunStatusToTreeStatus(status: DeepRunStatus): "running" | "completed" | "failed" | "stopped" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    // interrupted/corrected 作为运行中止态，tree 记为 stopped（材料保留，运行已停）。
    case "interrupted":
    case "corrected":
      return "stopped";
    default:
      return "running";
  }
}

// ---------------------------------------------------------------------------
// DeepExplorationReport 构建（FR-009 可复盘证据链）
// ---------------------------------------------------------------------------

type BuildExplorationReportInput = {
  readonly run: DeepRun;
  readonly conversation: DeepConversation;
  readonly agentRunTree: AgentRunTree;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly synthesisRecord?: ParentSynthesisResult;
  readonly conclusion?: SynthesizedConclusion;
};

/**
 * 构建 DeepExplorationReport。仅在有 conclusion 时产出（direct_answer/synthesize/
 * stop-partial）；无 conclusion（ask_user/interrupt/no_model/failed）时返回 undefined。
 * report 复用 domain AgentRunTree + ParentSynthesisResult，承载结论如何形成的证据链。
 */
function buildExplorationReport(
  input: BuildExplorationReportInput,
): DeepExplorationReport | undefined {
  if (input.conclusion === undefined) {
    return undefined;
  }
  const synthesisRecords: ParentSynthesisResult[] = input.synthesisRecord
    ? [input.synthesisRecord]
    : [];
  return {
    reportId: createId("deep-report"),
    runId: input.run.runId,
    conversationId: input.conversation.conversationId,
    goal: input.run.goal,
    agentRunTree: input.agentRunTree,
    childSummaries: input.childSummaries,
    synthesisRecords,
    conclusion: input.conclusion,
    createdAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// 文件系统辅助（镜像 deep-conversation.ts 的 writeJsonFile/readJsonFile）
// ---------------------------------------------------------------------------

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, undefined, 2), "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
  if (content === undefined) return undefined;
  return JSON.parse(content) as T;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === code;
}

function deepRuntimeGoal(conversation: DeepConversation): string {
  return conversation.currentObjective ?? conversation.goal;
}
