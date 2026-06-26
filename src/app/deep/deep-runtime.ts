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
  appendChildRunToTree,
  appendDelegationDecisionToTree,
  appendParentSynthesisToTree,
  completeAgentRunTree,
  createAgentRunTree,
} from "../../domain/underground/agent-fabric.js";
import {
  createDeepEventPublisher,
  type DeepEventPublisher,
  type DeepRunStreamEvent,
} from "./deep-events.js";
import type {
  DeepChildSummary,
  DeepConversation,
  DeepExplorationReport,
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
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";
import { DEEP_DECISION_CONTRACT_ID } from "./deep-model-io.js";

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
  readonly managerMaxModelRounds?: number;
  readonly managerMaxToolRounds?: number;
  /**
   * 可选外部注入的 control handle（T2-7，FR-008）。
   * - 未提供时内部创建独立 handle（默认批次运行口径）；
   * - 提供时复用之，使 API 层（T3-3）可在 run 生命周期内转发用户
   *   interrupt/correct/stop，也使运行侧 control 行为可被测试脚本化注入。
   */
  readonly controlHandle?: DeepRunControlHandle;
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
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly modelAvailable: boolean;
  readonly traceId: string;
  readonly goalId: string;
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
  const run: DeepRun = {
    runId: input.runId ?? createId("deep-run"),
    conversationId: input.conversation.conversationId,
    goal: input.conversation.goal,
    status: "running",
    isolation: {
      kind: "deep_conversation",
      runKind: DEEP_RUN_KIND,
      runMode: DEEP_RUN_MODE,
    },
    capabilitySnapshot: input.capabilitySnapshot,
    startedAt,
    updatedAt: startedAt,
  };

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
    control: controlHandle,
  };
  const executorConfig: DeepRunExecutorConfig = {
    turnRuntime: config.turnRuntime,
    stepLimit: config.stepLimit,
    maxChildren: config.maxChildren,
    managerMaxModelRounds: config.managerMaxModelRounds,
    managerMaxToolRounds: config.managerMaxToolRounds,
  };

  // 创建 deep 事件发布器（EP2/EP3）：发布 deep.* 到 bus + 累积安全投影 eventSequence。
  const publisher = createDeepEventPublisher({
    runtime: config.runtime,
    traceId: input.traceId,
    runId: run.runId,
  });
  publisher.publishGoalReceived({ goal: run.goal, conversationId: run.conversationId });

  // 委托 executor 驱动 manager 决策循环（含 control point，T2-7）。
  const executorResult = await startDeepRun(executorInput, executorConfig);

  // 从结果增量构建 AgentRunTree + 发布 deep.* 事件序列 + 累积安全投影。
  const tree = await buildAndPublishRunTree({
    runtime: config.runtime,
    traceId: input.traceId,
    runId: run.runId,
    startedAt,
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

  // 持久化到隔离 deep 分区（eventSequence 为 SSE 轮询源 + replay，EP3 安全投影）。
  const finalRun = executorResult.run;
  const record: DeepRunRecord = {
    run: finalRun,
    agentRunTree: tree,
    report,
    controlEvents: executorResult.controlEvents,
    eventSequence: publisher.events,
    updatedAt: nowIso(),
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

// ---------------------------------------------------------------------------
// AgentRunTree 增量构建 + 事件序列发布（复用 agent-fabric + underground-events）
// ---------------------------------------------------------------------------

type BuildAndPublishRunTreeInput = {
  readonly runtime: MinimalRuntime;
  readonly traceId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly executorResult: DeepRunExecutorResult;
  readonly publisher: DeepEventPublisher;
};

/**
 * 从 executor 结果**按 step 顺序**增量构建 AgentRunTree，并在每个关键节点发布对应事件。
 *
 * 事件序列（design.md §7.2）：
 *   - 每个 manager decision → delegation_planned（携带该 step 派生的 childSpecs）；
 *   - spawn_children step 的每个 child → child_started + child_completed；
 *   - synthesize step → parent_synthesis_completed；
 *   - control events（interrupt/correct/stop）→ deep.control 事件。
 *
 * tree 在每个事件发布时携带当前状态，事件 payload 的 agentRunTree 引用即该时刻快照
 * （复用 underground-events 的 safeAgentRunTreeRef 投影语义）。
 */
async function buildAndPublishRunTree(
  input: BuildAndPublishRunTreeInput,
): Promise<AgentRunTree> {
  const { executorResult, publisher } = input;
  const result = executorResult;
  let tree = createAgentRunTree({
    treeId: createId("deep-run-tree"),
    rootRunId: input.runId,
    rootAgentId: DEEP_MANAGER_AGENT_ID,
    rootSpec: buildDeepManagerSpec(input.startedAt),
    createdAt: input.startedAt,
  });

  // child runs 按 step 派生顺序消费（childRunId 关联 step.childrenAdded）。
  const childRunById = new Map<string, ChildAgentRun>();
  for (const childRun of result.childRuns) {
    childRunById.set(childRun.childRunId, childRun);
  }

  for (const step of result.steps) {
    const domainDecision = mapDeepDecisionToDomain(step.decision);
    // 该 step 派生的 child specs（仅 spawn_children 非空）；publisher 投影仅需 specId/displayName。
    const stepChildRuns: ChildAgentRun[] =
      step.childrenAdded?.flatMap((summary) => {
        const childRun = childRunById.get(summary.childRunId);
        return childRun ? [childRun] : [];
      }) ?? [];
    const childSpecProjection = stepChildRuns.map((childRun) => ({
      specId: childRun.spec.specId,
      displayName: childRun.spec.displayName,
    }));

    // manager.decided：append decision + 发布 deep.manager.decided（携带当前 tree 安全投影）。
    tree = appendDelegationDecisionToTree(tree, domainDecision, nowIso());
    publisher.publishManagerDecided({
      decision: domainDecision,
      childSpecs: childSpecProjection,
      agentRunTree: tree,
    });

    // spawn_children：每个 child append + started → waiting → completed（完整生命周期可观察）。
    for (const childRun of stepChildRuns) {
      tree = appendChildRunToTree(tree, childRun, nowIso());
      publisher.publishChildStarted({ childRun, agentRunTree: tree });
      publisher.publishChildWaiting({ childRun, agentRunTree: tree });
      publisher.publishChildCompleted({ childRun, agentRunTree: tree });
    }
    // 结论收口 step：synthesize（多 child 父层综合）或 direct_answer（单源收口）。
    // 两者都产出结论级 synthesisRecord，append 进 tree 的 parentSyntheses（FR-009
    // 可复盘：tree 承载"结论如何形成"；一次 run 仅一个收口 step，不重复 append）。
    const isConclusionStep =
      step.dispatchedAction === "synthesize" || step.dispatchedAction === "direct_answer";
    if (isConclusionStep && result.synthesisRecord) {
      tree = appendParentSynthesisToTree(tree, result.synthesisRecord, nowIso());
      publisher.publishParentSynthesisCompleted({
        parentSynthesis: result.synthesisRecord,
        childRuns: result.childRuns,
        agentRunTree: tree,
      });
    }
  }

  // 发布 T2-7 control 事件（interrupt/correct/stop），承载可观察打断/纠正/停止记录。
  for (const controlEvent of result.controlEvents) {
    publisher.publishControlEvent(controlEvent, tree);
  }

  // 结论存在时发布 deep.conclusion.produced（结论产出，FR-009 证据链收口）。
  if (result.conclusion) {
    publisher.publishConclusionProduced({ conclusion: result.conclusion });
  }

  // 收口 tree 状态（终态映射 deep run status → tree status）。
  const treeStatus = mapRunStatusToTreeStatus(result.run.status);
  return completeAgentRunTree(tree, treeStatus, nowIso());
}

/**
 * deep 六动作 → domain DelegationDecisionAction 映射（AgentRunTree 持久化用 domain 八动作）。
 * 命名映射保持语义一致（manager 决策语义不变，仅落到 domain 持久化口径）。
 */
function mapDeepDecisionToDomain(decision: DeepDelegationDecision): DelegationDecision {
  const childRunIds = decision.childSpecs.map((spec) => `derived:${spec.specId}`);
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
    goal: input.conversation.goal,
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
