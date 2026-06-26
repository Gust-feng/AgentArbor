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
 * cognitive-work-session-* 的六动作 action loop 仅作为 manager 决策动作集的
 * 设计输入（design.md §4.1），实现由新建 DeepRunExecutor 承担（T2-3）。
 *
 * 命名红线（ADR-0025 决策三）：一期产物统一为 {@link SynthesizedConclusion}
 * （结论级）与 {@link DeepExplorationReport}（运行级），不出现
 * Plan / directionHandoffPackage / artifact / Fruits 产物字段。
 * `runMode: "deep"` 仅表示编排策略选择，通过 RuntimeRunRecord.runMode 复用
 * 现有枚举（{@link DEEP_RUN_MODE}），不在此引入新的 runMode 语义。
 */
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type {
  AgentRunTree,
  AgentSpec,
  ChildAgentRun,
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
  readonly goal: string;
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
  readonly goal: string;
  readonly status: DeepRunStatus;
  readonly isolation: DeepConversationIsolationMark;
  /** run 启动时冻结的能力快照（FR-003，保证运行中能力边界稳定）。 */
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

// ---------------------------------------------------------------------------
// manager 决策动作集（六动作，FR-003）
// ---------------------------------------------------------------------------
//
// 决策动作集吸收 cognitive-work-session-* 的 action loop 语义作为设计输入
// （design.md §4.1），但与本文件 import 复用的 domain DelegationDecision（八动作，
// 用于 AgentRunTree 持久化）语义不同——deep 一期 manager 决策固定为六动作，去掉
// ③ 的 use_tools / produce_artifact（工具调用并入 child 探索；产物统一为
// SynthesizedConclusion，不走 artifact 语义）。因此命名为 DeepDelegationDecision，
// 与 domain 的 DelegationDecision 区分，避免名称冲突与语义混淆。

/**
 * manager 决策六动作枚举（FR-003 / design.md §5.3）。
 *
 * - `direct_answer`：直接产出结论（简单任务，无需多角度探索）
 * - `spawn_children`：派生多个 child 探索（需多角度/多证据）
 * - `wait_children`：等待已派生 child（child 进行中）
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
 * （T2-4）由 Child Delegation 补全为完整 AgentSpec 后写入 AgentRunTree。
 */
export type DeepChildSpec = {
  readonly specId: string;
  readonly displayName: string;
  readonly role: string;
  readonly objective: string;
  readonly allowedTools: readonly string[];
  readonly inputRefs: readonly string[];
};

/**
 * DeepDelegationDecision —— manager 逐 step 决策结果（六动作）。
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
