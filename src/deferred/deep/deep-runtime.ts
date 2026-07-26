/**
 * DeepRuntime —— deep 运行聚合层（deep 一期，T2-6/T2-7，ADR-0025 §5.3/§7）。
 *
 * 职责边界（design.md §3.1/§5/§7.1/§7.2）：
 *   - 聚合 {@link DeepRunExecutor}（manager 决策循环）+ {@link DeepConversation}（隔离），
 *     把一次 deep run 驱动成完整可观察、可持久化、可复盘的运行记录；
 *   - run 启动时冻结 {@link MultiAgentCapabilitySnapshot}（FR-003），据 activeModel 判定
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
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import type { ModelRuntimeMode } from "../../app/model-runtime/contracts.js";
import type { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { createId, nowIso, type IdFactory } from "../../kernel/id.js";
import { createMessage } from "../../kernel/messages/create-message.js";
import type {
  AgentRunTree,
  AgentSpec,
} from "../../domain/underground/agent-fabric.js";
import {
  createAgentRunTree,
  replaceChildRunInTree,
} from "../../domain/underground/agent-fabric.js";
import {
  createDeepEventPublisher,
  type DeepEventPublisher,
  type DeepRunStreamEvent,
} from "./deep-events.js";
import type {
  DeepConversation,
  DeepExplorationReport,
  DeepFollowUpContext,
  DeepIntakeContext,
  DeepLiveProjection,
  DeepRun,
  DeepRunContinuationFacts,
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
import type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";
import {
  appendDeepDecisionToRunTree,
  buildAndPublishRunTree,
  buildExplorationReport,
} from "./deep-run-tree.js";
import {
  continueDeepChildAgent,
  DeepChildExecutionAdmissionError,
} from "./deep-child-agent-runner.js";
import { DEEP_DECISION_CONTRACT_ID } from "./deep-model-io.js";
import { DeepChildScheduler } from "./deep-child-scheduler.js";
import type {
  DeepChildInstructionRecord,
  DeepChildInstructionQueueHandle,
  ExploreDeepChildFactory,
} from "./deep-child-scheduler-contracts.js";
import type { DeepChildMessageStore } from "./deep-child-messages.js";
import {
  loadDeepChildParentMessageContext,
  persistDeepChildInstructionRecord,
  persistDeepChildInstructionRecords,
  persistExecutedQueuedChildMessages,
} from "./deep-child-parent-messages.js";
import type { DeepChildLoopContextStore } from "./deep-child-loop-contexts.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import type { DeepChildPendingContinuationStore } from "./deep-child-continuations.js";
import {
  projectMultiAgentCapabilitySnapshot,
  type MultiAgentCapabilitySnapshot,
} from "./multi-agent-capability-snapshot.js";

// ---------------------------------------------------------------------------
// 常量：manager root spec（AgentRunTree root，FR-009 可复盘 root agent 元数据）
// ---------------------------------------------------------------------------

export {
  DEEP_RUN_RECORD_PARTITION,
  InMemoryDeepRunRecordStore,
  createFileSystemDeepRunRecordStore,
} from "./deep-run-record-store.js";
export type { DeepRunRecord, DeepRunRecordStore } from "./deep-run-record-store.js";

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
// DeepRuntime 配置与输入/输出
// ---------------------------------------------------------------------------

/**
 * DeepRuntime 配置。turnRuntime + bus + store（持久化端口）+ executor 可选项。
 */
export type DeepRuntimeConfig = {
  readonly turnRuntime: AgentTurnRuntime;
  readonly bus: InMemoryMessageBus;
  readonly store: DeepRunRecordStore;
  readonly stepLimit?: number;
  readonly maxChildren?: number;
  /** T2-1：per-run scheduler 并发上限（注入 scheduler 用，默认 executor 内部值）。 */
  readonly maxConcurrency?: number;
  /** Optional neutral child identity capability; defaults to the runtime UUID factory. */
  readonly childIdFactory?: IdFactory;
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
  readonly onChildMessageSidecarFailure?: (
    failure: DeepChildMessageSidecarFailure,
  ) => void | Promise<void>;
};

export type DeepChildMessageSidecarStage =
  | "persist_instruction_records"
  | "persist_executed_queued_messages";

export type DeepChildMessageSidecarFailure = {
  readonly runId: string;
  readonly stage: DeepChildMessageSidecarStage;
  readonly error: unknown;
};

/** The executor completed and produced a full final record, but its final commit failed. */
export class DeepRunFinalPersistenceError extends Error {
  readonly record: DeepRunRecord;

  constructor(record: DeepRunRecord, cause: unknown) {
    super(`Deep run final record persistence failed: ${deepRuntimeErrorMessage(cause)}`, { cause });
    this.name = "DeepRunFinalPersistenceError";
    this.record = record;
  }
}

export type DeepChildInstructionQueueRegistry = {
  readonly register: (runId: string, handle: DeepChildInstructionQueueHandle) => void;
  /** Stop new lookups before returning, then resolve after already-admitted commands finish. */
  readonly unregister: (
    runId: string,
    handle: DeepChildInstructionQueueHandle,
  ) => void | Promise<void>;
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
  readonly continuationFacts: DeepRunContinuationFacts;
  readonly aiMode?: ModelRuntimeMode;
  readonly capabilitySnapshot?: MultiAgentCapabilitySnapshot;
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
  const capabilitySnapshot = input.capabilitySnapshot === undefined
    ? undefined
    : projectMultiAgentCapabilitySnapshot(input.capabilitySnapshot);
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
    capabilitySnapshot,
    continuationFacts: input.continuationFacts,
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
    capabilitySnapshot,
    modelAvailable: input.modelAvailable,
    traceId: input.traceId,
    goalId: input.goalId,
    followUpContext: input.followUpContext,
    intakeContext: input.intakeContext,
    control: controlHandle,
  };

  // 创建 deep 事件发布器（EP2/EP3）：发布 deep.* 到 bus + 累积安全投影 eventSequence。
  const publisher = createDeepEventPublisher({
    bus: config.bus,
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
      capabilitySnapshot,
      childLoopContextStore: config.childLoopContextStore,
    });
  const scheduler = new DeepChildScheduler({
    board,
    exploreFactory,
    childIdFactory: config.childIdFactory,
    continueFactory: async (childRun, childSpec, parentInstruction, previousSummary, parentOperation) =>
      continueDeepChildAgent({
        childRun,
        childSpec,
        previousSummary,
        parentInstruction,
        beforeExecution: () => persistDeepChildInstructionRecord(
          config.childMessageStore,
          run.runId,
          {
            instructionId: parentOperation.instructionId,
            messageRef: parentOperation.messageRef,
            childRunId: childRun.childRunId,
            source: parentOperation.source,
            status: "queued",
            instruction: parentInstruction,
            review: parentOperation.review,
            requestedAt: parentOperation.requestedAt,
            queuedAt: parentOperation.requestedAt,
          },
        ),
        currentParentInstructionRef: parentOperation.messageRef,
        currentParentReview: parentOperation.review,
        parentMessageHistory: await loadDeepChildParentMessageContext(
          config.childMessageStore,
          run.runId,
          childRun.childRunId,
          recordedChildInstructions,
        ).catch((error: unknown) => {
          // Context preparation is part of execution admission: the child
          // model/tool loop has not started and the instruction is cancellable.
          throw new DeepChildExecutionAdmissionError(error);
        }),
        runId: run.runId,
        goal: deepRuntimeGoal(input.conversation),
        permissionBoundaryRefs: input.permissionBoundaryRefs,
        turnRuntime: config.turnRuntime,
        traceId: input.traceId,
        goalId: input.goalId,
        confirmationPolicy: input.confirmationPolicy,
        capabilitySnapshot,
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
        recordedChildInstructions.push({ ...instruction });
      },
    },
  });
  const instructionQueueHandle = scheduler.getInstructionQueueHandle();
  config.childInstructionQueues?.register(run.runId, instructionQueueHandle);
  let closeInstructionQueuePromise: Promise<void> | undefined;
  const closeInstructionQueue = (): Promise<void> => {
    closeInstructionQueuePromise ??= Promise.resolve().then(() =>
      config.childInstructionQueues?.unregister(run.runId, instructionQueueHandle)
    );
    return closeInstructionQueuePromise;
  };

  const executorConfig: DeepRunExecutorConfig = {
    turnRuntime: config.turnRuntime,
    stepLimit: config.stepLimit,
    maxChildren: config.maxChildren,
    managerMaxModelRounds: config.managerMaxModelRounds,
    managerMaxToolRounds: config.managerMaxToolRounds,
    scheduler,
    sealChildControl: closeInstructionQueue,
    // T2-1：onProgress 仅承载 decision/synthesis 相位（child 事件由 scheduler 回调实时发布）。
    // manager.decided 实时发布 deep.manager.decided（保证事件序列顺序 manager.decided→child→synthesis）。
    onProgress: async (event) => {
      if (event.kind === "manager.decided") {
        const treeUpdate = appendDeepDecisionToRunTree({
          tree: liveTree,
          decision: event.decision,
          updatedAt: event.recordedAt,
        });
        liveTree = treeUpdate.tree;
        publisher.publishManagerDecided({
          decision: treeUpdate.decision,
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
    // Stop new live child commands and drain commands already admitted through
    // the queue before building the terminal record. Otherwise a continuation
    // that started just before unregister could persist a stale live record
    // after the terminal snapshot.
    await closeInstructionQueue();
  }
  await persistChildMessageSidecar({
    runId: run.runId,
    stage: "persist_instruction_records",
    persist: () => persistDeepChildInstructionRecords(
      config.childMessageStore,
      run.runId,
      recordedChildInstructions,
    ),
    onFailure: config.onChildMessageSidecarFailure,
  });
  await persistChildMessageSidecar({
    runId: run.runId,
    stage: "persist_executed_queued_messages",
    persist: () => persistExecutedQueuedChildMessages(
      config.childMessageStore,
      run.runId,
      executorResult.executedQueuedChildInstructions,
    ),
    onFailure: config.onChildMessageSidecarFailure,
  });

  // T2-1：从结果增量构建 AgentRunTree；child/manager 事件已由 scheduler 回调和
  // onProgress 实时发布，树构建只收口可复盘证据。
  const tree = await buildAndPublishRunTree({
    initialTree: liveTree,
    executorResult,
    publisher,
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

  // 持久化到隔离 deep 分区（eventSequence 为 feature event replay 事实，EP3 安全投影）。
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
  try {
    await config.store.upsert(record);
  } catch (error) {
    throw new DeepRunFinalPersistenceError(record, error);
  }

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

async function persistChildMessageSidecar(input: {
  readonly runId: string;
  readonly stage: DeepChildMessageSidecarStage;
  readonly persist: () => Promise<void>;
  readonly onFailure?: DeepRuntimeConfig["onChildMessageSidecarFailure"];
}): Promise<void> {
  try {
    await input.persist();
  } catch (error) {
    try {
      await input.onFailure?.({
        runId: input.runId,
        stage: input.stage,
        error,
      });
    } catch {
      // Sidecar diagnostics cannot replace the executor result or final run record.
    }
  }
}

function deepRuntimeGoal(conversation: DeepConversation): string {
  return conversation.currentObjective ?? conversation.goal;
}

function deepRuntimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
