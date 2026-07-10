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
 *     parent_synthesis_completed / control），复用 underground/events 的投影语义；
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
 *   - 复用 underground/events（publishAgentDelegationPlanned / publishChildAgentRunStarted /
 *     publishChildAgentRunCompleted / publishParentSynthesisCompleted）；
 *   - 复用 child-delegation.DEEP_MANAGER_AGENT_ID（manager agent id 口径）。
 *   - 不 import cognitive-work-session-* / underground/orchestrator*（legacy，design.md §4.1）。
 *
 * 命名红线：消费 contracts.ts 的 SynthesizedConclusion / DeepExplorationReport；不引入
 * Plan / directionHandoffPackage / artifact / Fruits 产物字段。
 */
import path from "node:path";
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
  DelegationDecision,
  DelegationDecisionAction,
  ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import {
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  cloneAgentRunTree,
  cloneDelegationDecision,
  cloneParentSynthesisResult,
  completeAgentRunTree,
  createAgentRunTree,
  replaceChildRunInTree,
} from "../../domain/underground/agent-fabric.js";
import {
  createDeepEventPublisher,
  type DeepEventPublisher,
  type DeepRunStreamEvent,
} from "./deep-events.js";
import {
  createInMemoryRunSnapshotStore,
  type RunEnvelope,
  type RunSnapshotStore,
} from "../run-runtime-core/snapshot-store.js";
import { createFileSystemRunSnapshotStore } from "../../adapters/runtime-database/run-snapshot-store.js";
import type {
  DeepChildSummary,
  DeepConversation,
  DeepExplorationReport,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepLiveProjection,
  DeepResearchBrief,
  DeepRun,
  DeepRunStatus,
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
  type DeepRunStopReason,
  type StartDeepRunInput,
  DEEP_MANAGER_MAX_MODEL_ROUNDS,
  DEEP_MANAGER_MAX_TOOL_ROUNDS,
} from "./deep-run-executor.js";
import { DEEP_MANAGER_AGENT_ID, exploreDeepChild } from "./child-delegation.js";
import {
  createStartingLiveProjection,
  liveProjectionFromBoard,
  liveProjectionFromFinal,
  withChildDetailFromRun,
  withChildParentOperation,
} from "./deep-live-projection.js";
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
import type { DeepChildLoopContextStore } from "./deep-child-loop-contexts.js";
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
export interface DeepRunRecordStore extends RunSnapshotStore<DeepRunRecord> {}

/** 内存 DeepRunRecordStore（测试与开发态）。 */
export class InMemoryDeepRunRecordStore implements DeepRunRecordStore {
  private readonly store = createInMemoryRunSnapshotStore<DeepRunRecord>({
    getEnvelope: deepRunRecordEnvelope,
  });

  async upsert(record: DeepRunRecord): Promise<DeepRunRecord> {
    return this.store.upsert(record);
  }

  async get(runId: string): Promise<DeepRunRecord | undefined> {
    return this.store.get(runId);
  }

  async list(limit = 50): Promise<readonly DeepRunRecord[]> {
    return this.store.list(limit);
  }

  async delete(runId: string): Promise<void> {
    return this.store.delete(runId);
  }
}

function deepRunRecordEnvelope(record: DeepRunRecord): RunEnvelope {
  return {
    runId: record.run.runId,
    updatedAt: record.run.updatedAt,
    status: record.run.status,
    runKind: record.run.isolation.runKind,
    runMode: record.run.isolation.runMode,
    rootRunId: record.run.rootRunId,
    parentRunId: record.run.parentRunId,
    conversationId: record.run.conversationId,
  };
}

/**
 * 文件系统 DeepRunRecordStore（隔离 deep 分区，镜像 createFileSystemDeepConversationStore）。
 * 写入 `${runtimeHome}/deep-runs/<runId>/record.json`。
 */
export function createFileSystemDeepRunRecordStore(runtimeHome: string): DeepRunRecordStore {
  return createFileSystemRunSnapshotStore<DeepRunRecord>({
    rootDir: path.join(runtimeHome, DEEP_RUN_RECORD_PARTITION),
    getEnvelope: deepRunRecordEnvelope,
  });
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
  readonly childLoopContextStore?: DeepChildLoopContextStore;
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
  let liveProjection = createStartingLiveProjection(startedAt);
  let liveRun: DeepRun = run;
  let liveTree: AgentRunTree = initialTree;
  const writeLiveRecord = async (nextProjection: DeepLiveProjection): Promise<void> => {
    liveProjection = nextProjection;
    liveRun = { ...liveRun, updatedAt: liveProjection.updatedAt };
    await config.store.upsert({
      run: liveRun,
      agentRunTree: liveTree,
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
      runId: run.runId,
      goal: deepRuntimeGoal(input.conversation),
      permissionBoundaryRefs: input.permissionBoundaryRefs,
      turnRuntime: config.turnRuntime,
      traceId: input.traceId,
      goalId: input.goalId,
      confirmationPolicy: input.confirmationPolicy,
      capabilitySnapshot: input.capabilitySnapshot,
      childLoopContextStore: config.childLoopContextStore,
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
        runId: run.runId,
        goal: deepRuntimeGoal(input.conversation),
        permissionBoundaryRefs: input.permissionBoundaryRefs,
        turnRuntime: config.turnRuntime,
        traceId: input.traceId,
        goalId: input.goalId,
        confirmationPolicy: input.confirmationPolicy,
        capabilitySnapshot: input.capabilitySnapshot,
        childLoopContextStore: config.childLoopContextStore,
      }),
    maxConcurrency: config.maxConcurrency,
    maxChildren: config.maxChildren,
    callbacks: {
      // child pending→running：实时发布 deep.child.started + 从 board 派生投影 + 持久化。
      onChildStarted: async (_task, childRun) => {
        liveTree = replaceChildRunInTree(liveTree, childRun, nowIso());
        publisher.publishChildStarted({ childRun, agentRunTree: liveTree });
        await writeLiveRecord(
          withChildDetailFromRun(
            liveProjectionFromBoard(board.snapshot(), liveProjection),
            childRun,
          ),
        );
      },
      // child→终态（completed/blocked/interrupted/failed）：实时发布 child 事件 + 从 board 派生投影 + 持久化。
      onChildTerminal: async (task, _summary, completedRun, material) => {
        config.childContinuations?.remember(run.runId, material.pendingContinuation);
        liveTree = replaceChildRunInTree(liveTree, completedRun, nowIso());
        if (completedRun.status === "failed") {
          publisher.publishChildFailed({
            childRun: completedRun,
            failure: task.failure,
            agentRunTree: liveTree,
          });
        } else if (completedRun.status === "interrupted") {
          publisher.publishChildInterrupted({
            childRun: completedRun,
            reason: task.failure,
            agentRunTree: liveTree,
          });
        } else if (completedRun.status === "blocked") {
          publisher.publishChildBlocked({
            childRun: completedRun,
            reason: task.failure,
            agentRunTree: liveTree,
          });
        } else {
          publisher.publishChildCompleted({ childRun: completedRun, agentRunTree: liveTree });
        }
        await writeLiveRecord(
          withChildDetailFromRun(
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
          agentRunTree: liveTree,
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
        liveTree = appendDelegationDecisionUnique(
          liveTree,
          mapDeepDecisionToDomain(event.decision),
          event.recordedAt,
        );
        publisher.publishManagerDecided({
          decision: mapDeepDecisionToDomain(event.decision),
          childSpecs: event.decision.childSpecs.map((spec) => ({
            specId: spec.specId,
            displayName: spec.displayName,
          })),
          agentRunTree: liveTree,
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
    initialTree: liveTree,
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
  liveRun = finalRun;
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

// ---------------------------------------------------------------------------

function appendDelegationDecisionUnique(
  tree: AgentRunTree,
  decision: DelegationDecision,
  updatedAt: string,
): AgentRunTree {
  const existing = tree.delegationDecisions.some((item) => item.decisionId === decision.decisionId);
  if (!existing) {
    return appendDelegationDecisionToTree(tree, decision, updatedAt);
  }
  const cloned = cloneAgentRunTree(tree);
  return {
    ...cloned,
    delegationDecisions: cloned.delegationDecisions.map((item) =>
      item.decisionId === decision.decisionId ? cloneDelegationDecision(decision) : item
    ),
    updatedAt,
  };
}

function appendParentSynthesisUnique(
  tree: AgentRunTree,
  synthesis: ParentSynthesisResult,
  updatedAt: string,
): AgentRunTree {
  const existing = tree.parentSyntheses.some((item) => item.synthesisId === synthesis.synthesisId);
  if (!existing) {
    return appendParentSynthesisToTree(tree, synthesis, updatedAt);
  }
  const cloned = cloneAgentRunTree(tree);
  return {
    ...cloned,
    parentSyntheses: cloned.parentSyntheses.map((item) =>
      item.synthesisId === synthesis.synthesisId ? cloneParentSynthesisResult(synthesis) : item
    ),
    updatedAt,
  };
}

function removeDelegationDecisionById(
  tree: AgentRunTree,
  decisionId: string,
  updatedAt: string,
): AgentRunTree {
  if (!tree.delegationDecisions.some((decision) => decision.decisionId === decisionId)) {
    return tree;
  }
  const cloned = cloneAgentRunTree(tree);
  return {
    ...cloned,
    delegationDecisions: cloned.delegationDecisions.filter((decision) => decision.decisionId !== decisionId),
    updatedAt,
  };
}

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
      tree = removeDelegationDecisionById(tree, domainDecision.decisionId, nowIso());
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
    tree = appendDelegationDecisionUnique(tree, domainDecision, nowIso());

    // T2-1：append child runs 进 tree（deep.child.started/completed/blocked/failed 已由 scheduler
    // 回调在真实状态变化时实时发布，此处只做结构构建，不事后重建事件）。
    for (const childRun of stepChildRuns) {
      tree = replaceChildRunInTree(tree, childRun, nowIso());
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
      tree = appendParentSynthesisUnique(tree, result.synthesisRecord, nowIso());
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
    tree = appendParentSynthesisUnique(tree, result.synthesisRecord, nowIso());
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
    tree = appendDelegationDecisionUnique(
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

function deepRuntimeGoal(conversation: DeepConversation): string {
  return conversation.currentObjective ?? conversation.goal;
}
