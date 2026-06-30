/**
 * DeepRuntime 核心契约（deep 一期，ADR-0025 契约事实源）。
 *
 * 本文件定义 deep 编排策略边界（DeepConversation / DeepRun / DeepRunExecutor /
 * Child Delegation / Parent Synthesis）的输入输出契约类型，为闭环2 各组件
 * （DeepConversation 会话隔离、DeepRunExecutor manager 决策循环、child 派生、
 * 父层综合、持久化、打断纠正）提供类型基础。
 *
 * 复用边界（FR-010，复用而非另起）：以下领域契约从 domain/underground 直接
 * import 复用，不在本文件重定义——
 *   - AgentRunTree / ChildAgentRun / ParentSynthesisResult / AgentSpec
 *     来自 {@link ../../domain/underground/agent-fabric.js}（run tree 持久化契约）
 *   - assertNoDirectChildOutputHandoff / AGENT_FABRIC_MVP_MAX_DEPTH
 *     来自同一文件（child output 不直通结论硬约束 + 一层 child 深度常量）
 *
 * DeepRuntime 是新建的正式边界，不是任何旧文件（cognitive-work-session-* /
 * underground/orchestrator* / underground-direction-session*）改名为正式主线。
 * cognitive-work-session-* 的 action loop 仅作为 manager 决策动作集的
 * 设计输入（design.md §4.1），实现由新建 DeepRunExecutor 承担（T2-3）。
 *
 * 命名红线（ADR-0025 决策三）：一期产物统一为 {@link SynthesizedConclusion}
 * （结论级）与 {@link DeepExplorationReport}（运行级），不出现
 * Plan / directionHandoffPackage / artifact / Fruits 产物字段。
 * `runMode: "deep"` 仅表示编排策略选择，通过 RuntimeRunRecord.runMode 复用
 * 现有枚举（{@link DEEP_RUN_MODE}），不在此引入新的 runMode 语义。
 */
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type { ModelRuntimeMode } from "../model-runtime/index.js";
import type {
  AgentRunTree,
  AgentSpec,
  ChildAgentRun,
  ChildAgentRunExecutionOutcome,
  ChildAgentRunFailureDetail,
  ChildAgentRunParentInstructionStatus,
  ChildAgentRunParentReview,
  ChildAgentRunPendingApproval,
  ParentSynthesisResult,
} from "../../domain/underground/agent-fabric.js";
import {
  AGENT_FABRIC_MVP_MAX_DEPTH,
  assertNoDirectChildOutputHandoff,
} from "../../domain/underground/agent-fabric.js";
import type { DesktopTaskSoilInput } from "../task-soil-workspace.js";

// ---------------------------------------------------------------------------
// 复用领域契约（不重定义）——通过 deep 模块统一入口暴露，方便 DeepRuntime 各
// 组件引用，同时明确"复用而非另起"的边界。这里 re-export 的是稳定领域抽象，
// 不包含 domain/underground/contracts.ts 中的 Plan/Handoff 语义（DirectionHandoff
// 等），避免 Plan 语义渗入 deep 契约。
// ---------------------------------------------------------------------------

export type { AgentRunTree, AgentSpec, ChildAgentRun, ParentSynthesisResult };
export type { ChildAgentRunFailureDetail, ChildAgentRunParentReview };
export { AGENT_FABRIC_MVP_MAX_DEPTH, assertNoDirectChildOutputHandoff };

// ---------------------------------------------------------------------------
// 会话隔离标记（FR-002）
// ---------------------------------------------------------------------------
//
// deep 会话与普通会话数据隔离：DeepConversation 独立 store，不读取/不污染普通
// 会话历史、确认记录、run 投影。isolation 标记在会话记录与 run 记录上冗余携带，
// 便于投影层快速识别 deep 数据来源，无需反查 conversation。
//
// 内部映射复用既有 run 体系：runKind="underground" + runMode="deep"
// （design.md §6.1，复用 run-mode-policy 门控）。

/** deep 会话内部映射的 runKind，复用既有 run 体系。 */
export const DEEP_RUN_KIND = "underground" as const;

/** deep 会话内部映射的 runMode，仅表示编排策略选择（ADR-0025 命名口径）。 */
export const DEEP_RUN_MODE = "deep" as const;

/**
 * deep 会话隔离标记。携带此标记的记录属于 deep 分区，与普通会话 store 物理隔离。
 */
export type DeepConversationIsolationMark = {
  readonly kind: "deep_conversation";
  readonly runKind: typeof DEEP_RUN_KIND;
  readonly runMode: typeof DEEP_RUN_MODE;
};

export type DeepIntakeDecisionAction = "ask_user" | "direct_answer" | "start_collaboration";

export type DeepIntakeStatus = "needs_input" | "answered" | "plan_ready" | "running";

export type DeepIntakeTurn = {
  readonly turnId: string;
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly action: DeepIntakeDecisionAction;
  readonly normalizedObjective?: string;
  readonly plan?: string;
  readonly uncertainty?: string;
  readonly confidence?: number;
  readonly createdAt: string;
};

/** 运行中追加给当前 deep run 的用户补充；用于会话恢复，不改变 intake 状态语义。 */
export type DeepRunFollowUpTurn = {
  readonly turnId: string;
  readonly runId: string;
  readonly userMessage: string;
  readonly createdAt: string;
};

export type DeepIntakeContext = {
  readonly normalizedObjective?: string;
  readonly plan?: string;
  readonly assistantMessage: string;
  readonly uncertainty?: string;
  readonly confidence?: number;
};

/**
 * DeepConversation —— 一次 deep 会话的生命周期与隔离边界记录。
 *
 * 创建独立会话、装配 Task Soil（目标 + 用户显式选择的 workspace 上下文 + 权限
 * 边界，沿用 Desktop Shell 系统选择器授权口径）、隔离普通会话历史。会话级元数据，
 * 不承载 run tree（run tree 由 {@link DeepRun} 与 DeepExplorationReport 承载）。
 */
export type DeepConversation = {
  readonly conversationId: string;
  readonly title: string;
  readonly titleEditedAt?: string;
  readonly goal: string;
  /** Intake 对话轮次：协作 run 启动前的理解、澄清、直接回答或计划。 */
  readonly intakeTurns?: readonly DeepIntakeTurn[];
  /** 运行中的补充要求：仅用于恢复/投影当前 run 的用户追问，不重写 intake 决策语义。 */
  readonly followUpTurns?: readonly DeepRunFollowUpTurn[];
  /** 当前已明确的协作目标；只有 intake 判定可启动协作时才写入。 */
  readonly currentObjective?: string;
  readonly birthWorkspaceDirectory?: string;
  readonly pinnedAt?: string;
  readonly isolation: DeepConversationIsolationMark;
  /**
   * 用户显式选择的 workspace 上下文 + 权限边界输入快照。沿用 Desktop Shell 系统
   * 选择器授权口径（design.md §3.1），用于后续 DeepRunExecutor 启动 run 时按需
   * 装配 TaskSoil（复用 createTaskSoilFromDesktopInput，单一装配来源）。
   */
  readonly taskSoilInput?: DesktopTaskSoilInput;
  readonly permissionBoundaryRefs: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// DeepRun —— 一次 deep run（一棵 run tree 的执行实例）
// ---------------------------------------------------------------------------

/**
 * DeepRun 状态机。`interrupted` / `corrected` / `stopped` 对应 T2-7 打断/纠正/
 * 停止支持；B-1 仅定义状态枚举，行为由 T2-7 在 manager step 循环间注入打断点
 * 实现。
 */
export type DeepRunStatus =
  | "pending"
  | "running"
  | "interrupted"
  | "corrected"
  | "stopped"
  | "completed"
  | "failed";

/**
 * DeepRun —— 一次 deep 运行的执行记录。对应一棵 AgentRunTree，由 DeepRunExecutor
 * 驱动 manager 决策循环产出。run 级元数据；run tree 持久化形态由
 * {@link DeepExplorationReport}.agentRunTree 承载（T2-6）。
 */
export type DeepRun = {
  readonly runId: string;
  readonly conversationId: string;
  /** 上一轮多 Agent run；首轮为空。follow-up 会创建新 run，而不是复活旧 run。 */
  readonly parentRunId?: string;
  /** 同一多 Agent 任务链的根 run。首轮等于自身 runId。 */
  readonly rootRunId?: string;
  /** 同一任务链内的轮次序号，首轮为 1。 */
  readonly turnOrdinal?: number;
  readonly goal: string;
  readonly status: DeepRunStatus;
  readonly isolation: DeepConversationIsolationMark;
  /** run 启动时使用的模型运行模式；用于跨进程恢复同一 deep run 的子 Agent loop。 */
  readonly aiMode?: ModelRuntimeMode;
  /** run 启动时冻结的能力快照（FR-003，保证运行中能力边界稳定）。 */
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type DeepFollowUpChildSummary = {
  readonly childRunId: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: DeepChildStatus | "planned" | "resumed";
  readonly summary: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly confidence?: number;
  readonly uncertainty?: string;
};

/**
 * 续聊上下文：只保存上一轮安全结构化产物，供新一轮 manager 决策使用。
 * 不包含 raw prompt / raw response / raw tool output。
 */
export type DeepFollowUpContext = {
  readonly message: string;
  readonly previousRunId: string;
  readonly previousGoal: string;
  readonly previousStatus: DeepRunStatus;
  readonly previousConclusion?: string;
  readonly previousOneLineRationale?: string;
  readonly childSummaries: readonly DeepFollowUpChildSummary[];
  readonly synthesisSummary?: string;
};

// ---------------------------------------------------------------------------
// manager 决策动作集（FR-003）
// ---------------------------------------------------------------------------
//
// 决策动作集吸收 cognitive-work-session-* 的 action loop 语义作为设计输入
// （design.md §4.1），但与本文件 import 复用的 domain DelegationDecision（八动作，
// 用于 AgentRunTree 持久化）语义不同——deep 一期 manager 决策去掉
// ③ 的 use_tools / produce_artifact（工具调用并入 child 探索；产物统一为
// SynthesizedConclusion，不走 artifact 语义）。因此命名为 DeepDelegationDecision，
// 与 domain 的 DelegationDecision 区分，避免名称冲突与语义混淆。

/**
 * manager 决策动作枚举（FR-003 / design.md §5.3）。
 *
 * - `direct_answer`：直接产出结论（简单任务，无需多角度探索）
 * - `spawn_children`：派生多个 child 探索（需多角度/多证据）
 * - `wait_children`：等待已派生 child（child 进行中）
 * - `continue_child`：父层审查已有 child 后，给同一个 child run 追加指令继续标准 Agent loop
 * - `synthesize`：父层综合（child 材料已足够）
 * - `ask_user`：询问用户澄清（证据/方向不足；AI-first 边界，不伪装完成）
 * - `stop`：停止（预算耗尽或用户要求）
 *
 * 全部动作由模型语义推理产出，非确定性模板。
 */
export const DEEP_DELEGATION_ACTIONS = [
  "direct_answer",
  "spawn_children",
  "wait_children",
  "continue_child",
  "synthesize",
  "ask_user",
  "stop",
] as const;

export type DeepDelegationAction = (typeof DEEP_DELEGATION_ACTIONS)[number];

/**
 * manager 决策产出的 child 派生请求项（spawn_children 时由模型给出）。
 *
 * 与 domain AgentSpec 区分：DeepChildSpec 是 manager 决策语义层的轻量派生请求，
 * 不携带 protocol/permissions/budget 等完整 AgentSpec 字段；child 实际派生时
 * （T2-4）由 Child Delegation 补全为完整 AgentSpec，并把父层生成的 objective
 * 冻结到 AgentSpec.instructions 后写入 AgentRunTree，供恢复、失败降级和复盘使用。
 */
export type DeepChildSpec = {
  readonly specId: string;
  readonly displayName: string;
  readonly role: string;
  readonly objective: string;
  readonly allowedTools: readonly string[];
  readonly inputRefs: readonly string[];
  /** Optional parent-assigned child Agent model loop budget. Runtime defaults/clamps this to the child maximum. */
  readonly maxModelRounds?: number;
  /** Optional parent-assigned child Agent tool loop budget. Runtime defaults/clamps this to the child maximum. */
  readonly maxToolRounds?: number;
};

/**
 * 父层对已有 child run 的操作请求。
 *
 * 当前只支持 continue：父 Agent 审查 child 的材料/阻塞/失败状态后，给同一个
 * childRunId 追加指令，让它复用标准 AgentTurnRuntime autonomous loop 继续工作。
 * 不创建新 child、不直连用户、不引入 child 互聊。
 */
export type DeepChildOperation = {
  readonly childRunId: string;
  /** Parent Agent's safe review of the child material/status that led to this operation. */
  readonly review?: ChildAgentRunParentReview;
  readonly instruction: string;
};

/**
 * DeepDelegationDecision —— manager 逐 step 决策结果。
 *
 * 决策由模型语义推理产出（source: "ai"）；确定性逻辑只守边界，不替代语义判断
 * （ADR-0025 决策一 AI-first 边界）。`source: "deterministic_fallback"` 仅在
 * schema 校验失败等守卫场景出现，且不得伪装成已完成判断（无可用模型时拒绝运行）。
 */
export type DeepDelegationDecision = {
  readonly decisionId: string;
  readonly parentAgentId: string;
  readonly action: DeepDelegationAction;
  /** spawn_children 动作时由模型给出的 child 派生请求；其他动作为空。 */
  readonly childSpecs: readonly DeepChildSpec[];
  /** continue_child 动作时由模型给出的已有 child 操作请求；其他动作为空。 */
  readonly childOperations: readonly DeepChildOperation[];
  readonly decisionSummary: string;
  readonly rationale: string;
  readonly uncertainty: string;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningRefs: readonly string[];
  readonly createdAt: string;
};

// ---------------------------------------------------------------------------
// SynthesizedConclusion —— 结论级产物（FR-005/FR-006，五要素）
// ---------------------------------------------------------------------------
//
// child 产出不得直通结论（FR-005）：综合结论的 outputRefs 与 child outputRefs
// 由 {@link assertNoDirectChildOutputHandoff} 断言校验，直通交接被拒绝。父层综合
// 由模型完成（T2-5），可对冲突材料做对比/反驳/合并/降权/追问/停止。

/**
 * 候选取舍记录：为什么选 A / 为什么不选 B（FR-006 可解释结论）。
 */
export type CandidateDisposition = {
  readonly candidateId: string;
  readonly label: string;
  /** 是否被采纳为最终结论的方向。 */
  readonly selected: boolean;
  /** 采纳或拒绝的理由（选中说明为什么选 A；未选中说明为什么不选 B）。 */
  readonly reason: string;
};

/**
 * SynthesizedConclusion —— 单次父层综合产出的结论级产物，五要素：
 *
 * 1. {@link conclusion} —— 结论
 * 2. {@link oneLineRationale} —— 一句话理由
 * 3. {@link keyEvidenceRefs} —— 关键证据引用
 * 4. {@link candidateDispositions} —— 候选取舍（为什么选 A / 为什么不选 B）
 * 5. {@link mainUncertainty} —— 主要不确定性
 *
 * 命名红线：不叫 Plan，不走 directionHandoffPackage（②' orchestrator 强耦合），
 * 不走 artifactStore / Fruits（③ 终端产出语义）。
 */
export type SynthesizedConclusion = {
  readonly conclusionId: string;
  readonly conclusion: string;
  readonly oneLineRationale: string;
  readonly keyEvidenceRefs: readonly string[];
  readonly candidateDispositions: readonly CandidateDisposition[];
  readonly mainUncertainty: string;
  /**
   * 综合产出引用。不可直接等于 child outputRefs——由
   * {@link assertNoDirectChildOutputHandoff} 在写入前断言校验（FR-005 硬约束）。
   */
  readonly outputRefs: readonly string[];
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly createdAt: string;
};

// ---------------------------------------------------------------------------
// DeepExplorationReport —— 运行级产物（FR-009，可复盘）
// ---------------------------------------------------------------------------

/**
 * DeepChildSummary —— 单个 child 探索的安全摘要投影（用于运行级报告与 Panel 投影）。
 *
 * child 状态复用 {@link ChildAgentRun}["status"]（domain 契约）。
 * 摘要只是对外展示字段；模型工作所需的完整 child 材料不被摘要替代
 * （ADR-0025 安全摘要与能力优先边界）。
 */
export type DeepChildSummary = {
  readonly childRunId: string;
  readonly spec: DeepChildSpec;
  readonly status: ChildAgentRun["status"];
  readonly summary: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly confidence?: number;
  readonly uncertainty?: string;
  readonly failureDetail?: ChildAgentRunFailureDetail;
  readonly continuationContextRef?: string;
};

// ---------------------------------------------------------------------------
// DeepLiveProjection —— 运行中实时流程投影（Panel 默认可视化）
// ---------------------------------------------------------------------------

/**
 * 多 Agent 显式入口的实时阶段投影。
 *
 * 该字段只服务 Panel 默认流程图，不替代 DeepExplorationReport 和 AgentRunTree 的
 * 复盘契约；字段均为安全结构化摘要，不包含 raw prompt / raw response / 工具原始输出。
 */
export type DeepLivePhase =
  | "starting"
  | "deciding"
  | "exploring"
  | "synthesizing"
  | "completed"
  | "needs_input"
  | "stopped"
  | "failed";

/** 实时流程图中的真实 child 节点投影。 */
export type DeepLiveChildParentOperationProjection = {
  readonly status: ChildAgentRunParentInstructionStatus;
  readonly messageRef?: string;
  readonly queuedCount?: number;
  readonly updatedAt: string;
};

export type DeepLiveChildWorkflowItemKind =
  | "objective_set"
  | "model_message"
  | "running"
  | "tool_waiting"
  | "tool_completed"
  | "parent_message_queued"
  | "parent_message_applied"
  | "blocked"
  | "interrupted"
  | "completed"
  | "failed";

export type DeepLiveChildWorkflowItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "interrupted"
  | "cancelled";

export type DeepLiveChildWorkflowItem = {
  readonly itemId: string;
  readonly kind: DeepLiveChildWorkflowItemKind;
  readonly title: string;
  readonly detail?: string;
  readonly status: DeepLiveChildWorkflowItemStatus;
  readonly timestamp: string;
};

export type DeepLiveChildExecutionProjection = {
  readonly modelRounds: number;
  readonly toolRounds: number;
  readonly segmentCount: number;
  readonly latestOutcome?: ChildAgentRunExecutionOutcome;
};

export type DeepLiveChildParentReviewProjection = {
  readonly decision: ChildAgentRunParentReview["decision"];
  readonly reason: string;
  readonly confidence?: number;
};

export type DeepLiveChildParentInstructionProjection = {
  readonly instructionId: string;
  readonly status: ChildAgentRunParentInstructionStatus;
  readonly instructionSummary: string;
  readonly requestedAt: string;
  readonly review?: DeepLiveChildParentReviewProjection;
};

export type DeepLiveChildProjection = {
  readonly childRunId: string;
  readonly displayName: string;
  readonly objective: string;
  readonly role: string;
  readonly status: ChildAgentRun["status"];
  readonly updatedAt: string;
  readonly summary?: string;
  readonly latestResult?: string;
  readonly confidence?: number;
  readonly uncertainty?: string;
  readonly failureDetail?: ChildAgentRunFailureDetail;
  readonly continuationContextRef?: string;
  readonly workflowItems?: readonly DeepLiveChildWorkflowItem[];
  readonly execution?: DeepLiveChildExecutionProjection;
  readonly parentInstructions?: readonly DeepLiveChildParentInstructionProjection[];
  readonly pendingApproval?: ChildAgentRunPendingApproval;
  readonly parentOperation?: DeepLiveChildParentOperationProjection;
};

/** manager 最新方向判断的轻量投影。 */
export type DeepLiveDecisionProjection = {
  readonly decisionId: string;
  readonly action: DeepDelegationAction;
  readonly summary: string;
  readonly confidence: number;
  readonly updatedAt: string;
};

/** 父层综合的轻量投影。 */
export type DeepLiveSynthesisProjection = {
  readonly synthesisId?: string;
  readonly status: "pending" | "running" | "completed";
  readonly summary?: string;
  readonly confidence?: number;
  readonly updatedAt: string;
};

/** 最终结论的轻量投影。 */
export type DeepLiveConclusionProjection = {
  readonly conclusionId: string;
  readonly oneLineRationale: string;
  readonly confidence: number;
  readonly updatedAt: string;
};

export type DeepLiveProjection = {
  readonly phase: DeepLivePhase;
  readonly activeNodeId: string;
  readonly children: readonly DeepLiveChildProjection[];
  readonly decision?: DeepLiveDecisionProjection;
  readonly synthesis?: DeepLiveSynthesisProjection;
  readonly conclusion?: DeepLiveConclusionProjection;
  readonly updatedAt: string;
};

/**
 * DeepExplorationReport —— 一次 deep run 产出的运行级报告。
 *
 * 承载"结论如何形成"的可追溯证据链（FR-009 复盘）：通过 agentRunTree +
 * synthesisRecords + 事件序列可重建"manager 决策 → child 探索 → 父层综合 → 结论"
 * 的完整推理路径。命名红线：不叫 Plan Package / DirectionHandoff。
 */
export type DeepExplorationReport = {
  readonly reportId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly goal: string;
  /** 复用 domain AgentRunTree（root manager + 子各 ChildAgentRun + delegation decisions + 父层 syntheses + 事件序列）。 */
  readonly agentRunTree: AgentRunTree;
  readonly childSummaries: readonly DeepChildSummary[];
  /** 复用 domain ParentSynthesisResult（父层综合记录）。 */
  readonly synthesisRecords: readonly ParentSynthesisResult[];
  readonly conclusion: SynthesizedConclusion;
  readonly createdAt: string;
};

// ---------------------------------------------------------------------------
// Task Board 契约（T1-1，闭环1 并发任务闭环类型前置）
// ---------------------------------------------------------------------------
//
// 以下类型为 DeepTaskBoard（运行中权威状态）与 DeepChildScheduler（并发调度）提供
// 输入输出契约基础（design.md §3.1/§3.2/§3.5）。命名红线（ADR-0025 决策三）依旧：
// 不出现 Plan / directionHandoffPackage / artifact / Fruits 产物字段；DeepChildTask
// 只记安全结构化字段，不保存 raw prompt / raw response / 工具原始输出（FR-TB-01）。
//
// 字段复用来源（不重定义，FR-010）：DeepChildTask.spec 复用 {@link DeepChildSpec}；
// DeepChildTask.summary 复用 {@link DeepChildSummary}（其 status 复用
// ChildAgentRun["status"]）。DeepChildStatus 是任务板专用的七态任务状态，与
// DeepChildSummary.status（child run 级状态）语义层次不同，T2-1 投影派生时做枚举映射。

/**
 * DeepChildStatus —— 任务板内单个 child 任务的状态（七态，FR-TB-01）。
 *
 * 与 {@link DeepChildSummary}["status"]（复用 ChildAgentRun["status"]，child run 级
 * 状态）区分：DeepChildStatus 是任务板级的调度状态，多了 `pending`（已入板未启动）、
 * `cancelled`（被取消，不再启动 / stop 后保留）、`blocked`（需要确认/预算/上下文等外部条件）、
 * `interrupted`（child 自身中断，父层仍可审查后继续同一 childRunId），覆盖 scheduler 调度生命周期。
 *
 * 合法迁移（由 DeepTaskBoard 守卫）：pending → running → completed/failed/interrupted；
 * pending → cancelled（stop 取消未启动任务）；running → cancelled（保留，本轮 scheduler
 * 不对 running 直接 cancel，running 自然完成进保留材料）；终态（completed/failed/
 * cancelled）不可逆。running → blocked 表示 child Agent 自主 loop 因确认等待、显式
 * 轮次预算、上下文溢出等标准 Agent 结果暂停，父层可把 blocked 材料纳入审查；
 * running → interrupted 表示 child 自身中断或异常停止，父层仍可继续同一 child。
 */
export const DEEP_CHILD_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "blocked",
] as const;

export type DeepChildStatus = (typeof DEEP_CHILD_STATUSES)[number];

/**
 * DeepChildTaskSeed —— scheduler 派生 child 后向 board 入板的最小种子。
 *
 * board 据此生成任务板内稳定 taskId 并记录 pending 任务；childRunId 与
 * {@link ChildAgentRun}.childRunId 对齐，作为 AgentRunTree/材料的关联键。
 */
export type DeepChildTaskSeed = {
  readonly childRunId: string;
  readonly spec: DeepChildSpec;
};

/**
 * DeepChildTask —— 任务板内单个 child 任务的安全结构化记录（FR-TB-01）。
 *
 * 只记安全字段，**不保存** raw prompt / raw response / 工具原始输出；child 完整材料仍由
 * {@link DeepChildSummary}、{@link ChildAgentRun}、event refs、DeepExplorationReport 承载。
 * 字段含义见 design.md §3.1。
 */
export type DeepChildTask = {
  /** 任务板内稳定 id（board 生成，与 childRunId 解耦）。 */
  readonly taskId: string;
  /** 对应 ChildAgentRun.childRunId（与 AgentRunTree/材料关联键）。 */
  readonly childRunId: string;
  /** manager 派生请求（复用 DeepChildSpec）。 */
  readonly spec: DeepChildSpec;
  /** 任务板级调度状态（七态）。 */
  readonly status: DeepChildStatus;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  /** 完成时回填的安全摘要（复用 DeepChildSummary）。 */
  readonly summary?: DeepChildSummary;
  /** 失败/阻塞原因（failed/cancelled/blocked 时回填）。 */
  readonly failure?: string;
  /** child 标准 Agent loop 等待工具确认时的安全投影；不含 raw prompt / response / tool output。 */
  readonly pendingApproval?: ChildAgentRunPendingApproval;
};

/**
 * DeepTaskBoardPhase —— 任务板当前相位（manager 决策循环的运行中投影）。
 *
 * 由 executor 在 step 边界 `setPhase` 置位（design.md §3.1）。与 {@link DeepLivePhase}
 * （Panel 面向用户的展示相位）区分：board.phase 含 `planning`/`waiting` 等调度相位，
 * T2-1 投影派生时映射为 DeepLivePhase（保持对外展示相位字段稳定）。
 */
export const DEEP_TASK_BOARD_PHASES = [
  "planning",
  "deciding",
  "exploring",
  "waiting",
  "synthesizing",
  "completed",
  "needs_input",
  "stopped",
  "failed",
] as const;

export type DeepTaskBoardPhase = (typeof DEEP_TASK_BOARD_PHASES)[number];

/**
 * DeepTaskBoardSnapshot —— 任务板的不可变快照（FR-TB-02 运行中事实源对外投影）。
 *
 * `tasks` 为深拷贝，外部修改不影响 board 内部状态。liveProjection 与 eventSequence 的
 * child 状态在 T2-1 后均从此快照派生（单一事实源链，design.md §6 风险3）。
 */
export type DeepTaskBoardSnapshot = {
  readonly runId: string;
  readonly phase: DeepTaskBoardPhase;
  readonly tasks: readonly DeepChildTask[];
  readonly updatedAt: string;
};

/**
 * DeepResearchBrief —— 低心智计划投影契约（FR-BRIEF-01）。
 *
 * 承载简短计划投影，不直接把 manager 的长 rationale 暴露给用户。由 executor 在首次
 * spawn_children 决策后从 childSpecs 摘要装配（FR-BRIEF-02/03），写入 DeepRunRecord
 * 供 Panel 消费（T2-1 写入侧 / T3-1 前端消费侧）。
 *
 * 命名红线：不叫 Plan / PlanPackage（OOS-07），是 deep 一期的简短研究简报投影。
 */
export type DeepResearchBrief = {
  readonly briefId: string;
  readonly goal: string;
  readonly scopeSummary: string;
  readonly sourcePolicySummary: string;
  readonly plannedAngles: readonly string[];
  /** 本轮固定 false（不强制"用户批准计划"流程，FR-BRIEF-02）。 */
  readonly needsUserApproval: boolean;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// DeepChildStatus → 投影展示状态映射类型位（FR-PROJ 派生口径预留）
// ---------------------------------------------------------------------------
//
// 引入 DeepChildStatus（七态任务状态）后，DeepLiveChildProjection.status 仍复用
// ChildAgentRun["status"]（对外投影字段稳定，design.md §3.4.3）。T2-1 的
// liveProjectionFromBoard 提供实际映射函数把任务状态映射为展示状态；此处只预留类型位，
// 避免后续派生口径调整时再回到 contracts.ts 补类型（映射实现归 T2-1 runtime 派生）。

/**
 * DeepChildStatus → 展示状态映射的类型位（映射实现归 T2-1 runtime 派生）。
 *
 * 目标类型沿用 {@link DeepChildSummary}["status"]（= ChildAgentRun["status"]），
 * 保持对外投影字段稳定；pending/cancelled 等任务板专用态由 T2-1 映射为最接近的
 * 展示状态，blocked/interrupted 则作为真实 child run 暂停/中断态保留。
 */
export type DeepChildStatusProjectionMap = Readonly<
  Record<DeepChildStatus, DeepChildSummary["status"]>
>;
