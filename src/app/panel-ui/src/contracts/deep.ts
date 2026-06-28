/**
 * Deep 前端契约（T3-4a）。
 *
 * 镜像后端 `/api/deep/*` 的 JSON 响应形状，对齐以下后端事实源——
 *   - [`projectDeepConversation`](src/app/panel-server/deep-routes.ts:597)
 *   - [`projectDeepRunSummary`](src/app/panel-server/deep-routes.ts:608)
 *   - [`projectDeepRunView`](src/app/panel-server/deep-routes.ts:632)
 *   - [`DeepRunStreamEvent`](src/app/deep/deep-events.ts:68)（SSE 安全投影）
 *   - [`DeepExplorationReport`](src/app/deep/contracts.ts:285)（report 完整领域形状）
 *   - [`safeAgentRunTreeRef`](src/app/underground-events.ts:374)（view.agentRunTree 计数投影）
 *
 * 设计原则：
 *   - 纯类型镜像，自包含（不 import `src/app` 或 `src/domain`，避免前后端编译耦合）。
 *   - 安全投影口径（FR-007）：不含 raw prompt / response / output；仅承载可观察字段。
 *   - `DeepRunView.agentRunTree` 是 [`DeepAgentRunTreeRef`](#deepagentruntreeref)（计数投影）；
 *     `DeepRunView.report.agentRunTree` 是 [`DeepAgentRunTreeView`](#deepagentruntreeview)
 *     （完整领域树，结构化复盘，FR-009）。
 *   - `report` 在 run 未完成或失败前未产出时为 `undefined`。
 */

import type { WorkspaceFolderSummary } from "./common";

// ---------------------------------------------------------------------------
// 隔离标记与状态枚举（镜像 DEEP_RUN_KIND / DEEP_RUN_MODE / DeepRunStatus）
// ---------------------------------------------------------------------------

/** deep 会话内部映射的 runKind，复用既有 run 体系（`DEEP_RUN_KIND = "underground"`）。 */
export type DeepRunKind = "underground";

/** deep 会话内部映射的 runMode，仅表示编排策略选择（`DEEP_RUN_MODE = "deep"`）。 */
export type DeepRunMode = "deep";

/** deep 会话隔离标记。携带此标记的记录属于 deep 分区，与普通会话 store 物理隔离。 */
export type DeepConversationIsolationMark = {
  readonly kind: "deep_conversation";
  readonly runKind: DeepRunKind;
  readonly runMode: DeepRunMode;
};

/**
 * DeepRun 状态机。`interrupted` / `corrected` / `stopped` 对应打断/纠正/停止支持。
 * 镜像 [`DeepRunStatus`](src/app/deep/contracts.ts:108)。
 */
export type DeepRunStatus =
  | "pending"
  | "running"
  | "interrupted"
  | "corrected"
  | "stopped"
  | "completed"
  | "failed";

export type DeepIntakeStatus = "needs_input" | "answered" | "running";

export type DeepIntakeDecisionAction = "ask_user" | "direct_answer" | "start_collaboration";

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

/** AgentRunTree 级状态（4 值）。镜像 [`AgentRunTree.status`](src/domain/underground/agent-fabric.ts:123)。 */
export type DeepAgentRunTreeStatus = "running" | "completed" | "failed" | "stopped";

/** ChildAgentRun 状态枚举。镜像 [`ChildAgentRunStatus`](src/domain/underground/agent-fabric.ts:34)。 */
export type DeepChildRunStatus =
  | "planned"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "interrupted"
  | "resumed";

// ---------------------------------------------------------------------------
// HTTP 响应形状（镜像 deep-routes.ts 各 handler 的 writeJson 载荷）
// ---------------------------------------------------------------------------

/** 镜像 [`projectDeepConversation`](src/app/panel-server/deep-routes.ts:597)。 */
export type DeepConversationView = {
  readonly conversationId: string;
  readonly title: string;
  readonly goal: string;
  readonly intakeTurns: readonly DeepIntakeTurn[];
  readonly currentObjective?: string;
  readonly birthWorkspaceDirectory?: string;
  readonly isolation: DeepConversationIsolationMark;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** 镜像 [`projectDeepRunSummary`](src/app/panel-server/deep-routes.ts:608)。 */
export type DeepRunSummary = {
  readonly runId: string;
  readonly conversationId: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
  readonly goal: string;
  readonly status: DeepRunStatus;
  readonly runKind: DeepRunKind;
  readonly runMode: DeepRunMode;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly hasConclusion: boolean;
  readonly childCount: number;
  readonly eventCount: number;
  readonly workspaceFolder?: WorkspaceFolderSummary;
  readonly brief?: DeepResearchBriefView;
};

/** run 级摘要（projectDeepRunView 的 `run` 字段，也用于 start run 响应）。 */
export type DeepRunRecord = {
  readonly runId: string;
  readonly conversationId: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly turnOrdinal?: number;
  readonly goal: string;
  readonly status: DeepRunStatus;
  readonly runKind: DeepRunKind;
  readonly runMode: DeepRunMode;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly workspaceFolder?: WorkspaceFolderSummary;
};

// ---------------------------------------------------------------------------
// AgentRunTree 安全计数投影（view.agentRunTree = safeAgentRunTreeRef）
// ---------------------------------------------------------------------------

/**
 * AgentRunTree 的安全计数投影（不含 raw 材料）。
 *
 * 镜像 [`safeAgentRunTreeRef`](src/app/underground-events.ts:374)：
 * 仅暴露 treeId / root 标识 / 状态 / 三类子记录计数，供前端快速判断 run 结构规模。
 * 完整 run tree（含 childRuns / delegationDecisions / parentSyntheses 详情）在
 * [`DeepRunView.report.agentRunTree`](#deeprunview) 中。
 */
export type DeepAgentRunTreeRef = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly status: DeepAgentRunTreeStatus;
  readonly childRunCount: number;
  readonly delegationDecisionCount: number;
  readonly parentSynthesisCount: number;
};

// ---------------------------------------------------------------------------
// SSE 流式事件（镜像 DeepRunStreamEvent / DeepEventType）
// ---------------------------------------------------------------------------

/** deep 运行 SSE 流式事件类型全集。镜像 [`DeepEventType`](src/app/deep/deep-events.ts:37)。 */
export type DeepEventType =
  | "deep.goal_received"
  | "deep.manager.decided"
  | "deep.child.started"
  | "deep.child.waiting"
  | "deep.child.instruction_queued"
  | "deep.child.completed"
  | "deep.child.blocked"
  | "deep.child.interrupted"
  | "deep.child.failed"
  | "deep.parent_synthesis.completed"
  | "deep.failed"
  | "deep.interrupted"
  | "deep.corrected"
  | "deep.stopped"
  | "deep.conclusion.produced";

/** 流式事件的安全引用（指向 record 内的结构化对象，不含 raw 材料）。镜像 [`DeepRunStreamEventRef`](src/app/deep/deep-events.ts:50)。 */
export type DeepStreamEventRef = {
  readonly kind:
    | "conversation"
    | "delegation_decision"
    | "child_run"
    | "child_instruction"
    | "parent_synthesis"
    | "control"
    | "conclusion"
    | "agent_run_tree";
  readonly refId: string;
};

/**
 * deep 运行流式事件安全投影（SSE 轮询源 + replay）。
 *
 * 镜像 [`DeepRunStreamEvent`](src/app/deep/deep-events.ts:68)。安全口径（FR-007）：
 * 不含 raw prompt / response / output；仅承载可观察的标题/摘要/状态/引用。
 */
export type DeepStreamEvent = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: DeepEventType;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly timestamp: string;
  readonly refs: readonly DeepStreamEventRef[];
  readonly visibility: "public";
};

// ---------------------------------------------------------------------------
// 结论区（镜像 SynthesizedConclusion / CandidateDisposition）
// ---------------------------------------------------------------------------

/** 候选取舍记录：为什么选 A / 为什么不选 B（FR-006 可解释结论）。镜像 [`CandidateDisposition`](src/app/deep/contracts.ts:218)。 */
export type DeepCandidateDisposition = {
  readonly candidateId: string;
  readonly label: string;
  /** 是否被采纳为最终结论的方向。 */
  readonly selected: boolean;
  /** 采纳或拒绝的理由（选中说明为什么选 A；未选中说明为什么不选 B）。 */
  readonly reason: string;
};

/**
 * 综合结论视图（五要素：结论 / 一句话理由 / 关键证据引用 / 候选取舍 / 主要不确定性）。
 *
 * 镜像 [`SynthesizedConclusion`](src/app/deep/contracts.ts:239)。FR-005 硬约束：
 * outputRefs 不可直接等于 child outputRefs（父层综合，不直通交接）。
 */
export type DeepConclusionView = {
  readonly conclusionId: string;
  readonly conclusion: string;
  readonly oneLineRationale: string;
  readonly keyEvidenceRefs: readonly string[];
  readonly candidateDispositions: readonly DeepCandidateDisposition[];
  readonly mainUncertainty: string;
  readonly outputRefs: readonly string[];
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly createdAt: string;
};

// ---------------------------------------------------------------------------
// Child 摘要（镜像 DeepChildSpec / DeepChildSummary）
// ---------------------------------------------------------------------------

/**
 * manager 决策产出的 child 派生请求项。镜像 [`DeepChildSpec`](src/app/deep/contracts.ts:176)。
 * 是决策语义层的轻量派生请求，不携带完整 AgentSpec 字段。
 */
export type DeepChildSpec = {
  readonly specId: string;
  readonly displayName: string;
  readonly role: string;
  readonly objective: string;
  readonly allowedTools: readonly string[];
  readonly inputRefs: readonly string[];
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
};

/**
 * 单个 child 探索的安全摘要投影。镜像 [`DeepChildSummary`](src/app/deep/contracts.ts:267)。
 * 摘要只是对外展示字段；模型工作所需的完整 child 材料不被摘要替代。
 */
export type DeepChildSummaryView = {
  readonly childRunId: string;
  readonly spec: DeepChildSpec;
  readonly status: DeepChildRunStatus;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly confidence?: number;
  readonly uncertainty?: string;
};

// ---------------------------------------------------------------------------
// 实时流程投影（view.liveProjection）
// ---------------------------------------------------------------------------

export type DeepLivePhase =
  | "starting"
  | "deciding"
  | "exploring"
  | "synthesizing"
  | "completed"
  | "needs_input"
  | "stopped"
  | "failed";

export type DeepLiveChildParentOperationProjection = {
  readonly status: "queued" | "executed" | "cancelled";
  readonly messageRef?: string;
  readonly queuedCount?: number;
  readonly updatedAt: string;
};

export type DeepLiveChildWorkflowItemKind =
  | "objective_set"
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
  readonly latestOutcome?: "completed" | "blocked" | "failed" | "interrupted";
};

export type DeepLiveChildParentReviewProjection = {
  readonly decision: "accepted" | "rejected" | "needs_followup";
  readonly reason: string;
  readonly confidence?: number;
};

export type DeepLiveChildParentInstructionProjection = {
  readonly instructionId: string;
  readonly status: "queued" | "executed" | "cancelled";
  readonly instructionSummary: string;
  readonly requestedAt: string;
  readonly review?: DeepLiveChildParentReviewProjection;
};

export type DeepLiveChildProjection = {
  readonly childRunId: string;
  readonly displayName: string;
  readonly objective: string;
  readonly role: string;
  readonly status: DeepChildRunStatus;
  readonly updatedAt: string;
  readonly summary?: string;
  readonly latestResult?: string;
  readonly confidence?: number;
  readonly uncertainty?: string;
  readonly workflowItems?: readonly DeepLiveChildWorkflowItem[];
  readonly execution?: DeepLiveChildExecutionProjection;
  readonly parentInstructions?: readonly DeepLiveChildParentInstructionProjection[];
  readonly pendingApproval?: DeepChildAgentRunPendingApprovalView;
  readonly parentOperation?: DeepLiveChildParentOperationProjection;
};

export type DeepLiveDecisionAction =
  | "direct_answer"
  | "spawn_children"
  | "wait_children"
  | "continue_child"
  | "synthesize"
  | "ask_user"
  | "stop";

export type DeepLiveDecisionProjection = {
  readonly decisionId: string;
  readonly action: DeepLiveDecisionAction;
  readonly summary: string;
  readonly confidence: number;
  readonly updatedAt: string;
};

export type DeepLiveSynthesisProjection = {
  readonly synthesisId?: string;
  readonly status: "pending" | "running" | "completed";
  readonly summary?: string;
  readonly confidence?: number;
  readonly updatedAt: string;
};

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

// ---------------------------------------------------------------------------
// 研究 brief（T3-1，FR-BRIEF-01 前端消费侧）
// ---------------------------------------------------------------------------
//
// 镜像后端 DeepRunRecord.brief（T2-1 写入侧：executor 首次 spawn_children 后从 childSpecs
// 摘要装配）。brief 是低心智计划投影，不直接把 manager 的长 rationale 暴露给用户——
// Panel 计划阶段只消费 brief 的安全字段。与后端 DeepResearchBrief（src/app/deep/contracts.ts）
// 字段一一对齐，纯安全投影子集，不含 raw 字段。

/**
 * 多 Agent 研究简报（低心智计划投影）。
 *
 * 镜像 [`DeepResearchBrief`](src/app/deep/contracts.ts:486)。承载简短计划投影：目标、范围摘要、
 * 来源策略摘要、计划探索角度。`needsUserApproval` 本轮固定 false（目标明确自动进入探索，
 * 不强制"用户批准计划"流程，FR-BRIEF-02）。run 未进入 spawn 阶段时为 `undefined`。
 */
export type DeepResearchBriefView = {
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
// 完整领域 AgentRunTree（report.agentRunTree，结构化复盘 FR-009）
// ---------------------------------------------------------------------------

/** AgentSpec 的 protocol 子结构。镜像 [`AgentProtocol`](src/domain/underground/agent-loop.ts:34)。 */
export type DeepAgentProtocol = {
  readonly inputs: readonly {
    readonly source: "workspace" | "mailbox" | "event_log";
    readonly key: string;
    readonly required: boolean;
  }[];
  readonly outputs: readonly { readonly type: string; readonly payloadSchema: string }[];
};

/** AgentSpec 的 budget 子结构。镜像 [`AgentSpecBudget`](src/domain/underground/agent-fabric.ts:44)。 */
export type DeepAgentSpecBudget = {
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly maxChildRuns?: number;
  readonly maxOutputRefs?: number;
};

/** AgentSpec 的 permissions 子结构。镜像 [`AgentTurnPermissionPolicy`](src/domain/common.ts:36)。 */
export type DeepAgentPermissionPolicy = {
  readonly allowModel: boolean;
  readonly allowedTools: readonly string[];
  readonly maxModelRounds?: number;
  readonly maxToolRounds?: number;
  readonly fallback: "deterministic" | "disabled";
};

/**
 * AgentSpec 的 instructions 子结构。child run 会把父 Agent 派生的 objective 冻结在这里，
 * 作为恢复、复盘和 UI 详情展示的出生事实；systemPromptRef 只暴露稳定 prompt 引用，不含 raw prompt。
 */
export type DeepAgentSpecInstructionsView = {
  readonly objective?: string;
  readonly systemPromptRef?: string;
};

/**
 * AgentSpec 前端镜像。镜像 [`AgentSpec`](src/domain/underground/agent-fabric.ts:51)。
 * root manager 与 child run 的 spec 都用此结构。
 */
export type DeepAgentSpecView = {
  readonly specId: string;
  readonly agentId: string;
  readonly displayName: string;
  readonly agentKind: "manager" | "core" | "rootlet" | "child";
  readonly role: string;
  readonly rootletKind?: string;
  readonly instructions?: DeepAgentSpecInstructionsView;
  readonly protocol: DeepAgentProtocol;
  readonly promptRef: string;
  readonly outputContractRef: string;
  readonly permissions: DeepAgentPermissionPolicy;
  readonly budget: DeepAgentSpecBudget;
  readonly inputRefs: readonly string[];
  readonly createdAt: string;
};

export type DeepChildAgentRunToolCallTraceView = {
  readonly callId: string;
  readonly toolName: string;
  readonly status: "completed" | "failed" | "approval_required" | "cancelled";
};

/**
 * ChildAgentRun 的安全执行事实投影。只含轮次、模型请求/响应引用和工具调用状态，
 * 不含 raw prompt / raw response / 工具原始输出。
 */
export type DeepChildAgentRunExecutionView = {
  readonly modelRounds: number;
  readonly toolRounds: number;
  readonly modelRequestId?: string;
  readonly modelResponseId?: string;
  readonly toolCalls: readonly DeepChildAgentRunToolCallTraceView[];
};

export type DeepChildAgentRunExecutionSegmentView = DeepChildAgentRunExecutionView & {
  readonly outcome: "completed" | "blocked" | "failed" | "interrupted";
  readonly recordedAt: string;
};

export type DeepChildAgentRunPendingApprovalView = {
  readonly confirmationId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type DeepChildAgentRunParentInstructionView = {
  readonly instructionId: string;
  readonly messageRef?: string;
  readonly source: "manager" | "control_api";
  readonly status: "queued" | "executed" | "cancelled";
  readonly instructionSummary: string;
  readonly review?: DeepChildAgentRunParentReviewView;
  readonly requestedAt: string;
  readonly queuedAt?: string;
  readonly executedAt?: string;
  readonly cancelledAt?: string;
};

export type DeepChildAgentRunParentReviewView = {
  readonly decision: "accepted" | "rejected" | "needs_followup";
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly confidence?: number;
};

/**
 * ChildAgentRun 前端镜像。镜像 [`ChildAgentRun`](src/domain/underground/agent-fabric.ts:82)。
 * report.agentRunTree.childRuns 的元素类型。
 */
export type DeepChildAgentRunView = {
  readonly childRunId: string;
  readonly parentAgentId: string;
  readonly spec: DeepAgentSpecView;
  readonly status: DeepChildRunStatus;
  readonly inputRefs: readonly string[];
  readonly outputRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly failureReason?: string;
  readonly uncertainty?: string;
  readonly confidence?: number;
  readonly execution?: DeepChildAgentRunExecutionView;
  readonly executionHistory?: readonly DeepChildAgentRunExecutionSegmentView[];
  readonly parentInstructions?: readonly DeepChildAgentRunParentInstructionView[];
  readonly pendingApproval?: DeepChildAgentRunPendingApprovalView;
  readonly startedAt: string;
  readonly completedAt?: string;
};

/** 领域委托决策动作枚举（8 值）。镜像 [`DelegationDecisionAction`](src/domain/underground/agent-fabric.ts:24)。 */
export type DeepDelegationAction =
  | "spawn_children"
  | "wait_for_children"
  | "interrupt_child"
  | "resume_child"
  | "request_parent_synthesis"
  | "request_user_clarification"
  | "request_convergence"
  | "stop";

/**
 * 领域委托决策记录前端镜像。镜像 [`DelegationDecision`](src/domain/underground/agent-fabric.ts:67)。
 * report.agentRunTree.delegationDecisions 的元素类型（manager 逐 step 决策映射为领域记录）。
 */
export type DeepDelegationDecisionView = {
  readonly decisionId: string;
  readonly parentAgentId: string;
  readonly action: DeepDelegationAction;
  readonly childSpecIds: readonly string[];
  readonly childRunIds: readonly string[];
  readonly inputRefs: readonly string[];
  readonly rationale: string;
  readonly uncertainty: string;
  readonly source: "ai" | "deterministic_fallback" | "control_api";
  readonly confidence: number;
  readonly reasoningTraceRefs: readonly string[];
  readonly createdAt: string;
};

/** 父层综合的 next action 枚举。镜像 [`ParentSynthesisNextAction`](src/domain/underground/agent-fabric.ts:42)。 */
export type DeepParentSynthesisNextAction =
  | "continue_exploration"
  | "request_convergence"
  | "request_user_clarification"
  | "stop";

export type DeepParentSynthesisChildReviewDecision =
  | "accepted"
  | "rejected"
  | "needs_followup";

export type DeepParentSynthesisChildReviewView = {
  readonly childRunId: string;
  readonly decision: DeepParentSynthesisChildReviewDecision;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly sourceCandidateId?: string;
  readonly confidence?: number;
};

/**
 * 父层综合记录前端镜像。镜像 [`ParentSynthesisResult`](src/domain/underground/agent-fabric.ts:97)。
 * report.agentRunTree.parentSyntheses 与 report.synthesisRecords 共用此结构。
 */
export type DeepParentSynthesisView = {
  readonly synthesisId: string;
  readonly parentAgentId: string;
  readonly childRunIds: readonly string[];
  readonly inputRefs: readonly string[];
  readonly retainedMaterialRefs: readonly string[];
  readonly rejectedMaterialRefs: readonly string[];
  readonly conflictRefs: readonly string[];
  readonly childReviews?: readonly DeepParentSynthesisChildReviewView[];
  readonly outputRefs: readonly string[];
  readonly nextAction: DeepParentSynthesisNextAction;
  readonly decisionSummary: string;
  readonly uncertainty: string;
  readonly source: "ai" | "deterministic_fallback";
  readonly confidence: number;
  readonly reasoningTraceRefs: readonly string[];
  readonly createdAt: string;
};

/**
 * 完整 AgentRunTree 前端镜像（扁平结构，非嵌套）。
 *
 * 镜像 [`AgentRunTree`](src/domain/underground/agent-fabric.ts:115)。承载"结论如何形成"
 * 的可追溯证据链（FR-009 复盘）：root manager + childRuns + delegationDecisions +
 * parentSyntheses 可重建"manager 决策 → child 探索 → 父层综合 → 结论"推理路径。
 */
export type DeepAgentRunTreeView = {
  readonly treeId: string;
  readonly rootRunId: string;
  readonly rootAgentId: string;
  readonly rootSpec: DeepAgentSpecView;
  readonly childRuns: readonly DeepChildAgentRunView[];
  readonly delegationDecisions: readonly DeepDelegationDecisionView[];
  readonly parentSyntheses: readonly DeepParentSynthesisView[];
  readonly status: DeepAgentRunTreeStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// 运行级报告（镜像 DeepExplorationReport）
// ---------------------------------------------------------------------------

/**
 * 一次 deep run 产出的运行级报告前端镜像。
 *
 * 镜像 [`DeepExplorationReport`](src/app/deep/contracts.ts:285)。承载完整可复盘证据链：
 * agentRunTree + childSummaries + synthesisRecords + conclusion。run 未完成时为 `undefined`。
 */
export type DeepExplorationReportView = {
  readonly reportId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly goal: string;
  readonly agentRunTree: DeepAgentRunTreeView;
  readonly childSummaries: readonly DeepChildSummaryView[];
  readonly synthesisRecords: readonly DeepParentSynthesisView[];
  readonly conclusion: DeepConclusionView;
  readonly createdAt: string;
};

// ---------------------------------------------------------------------------
// DeepRunView（projectDeepRunView 的完整响应）
// ---------------------------------------------------------------------------

/**
 * GET /api/deep/runs/:runId/view 的 `view` 载荷。
 *
 * 镜像 [`projectDeepRunView`](src/app/panel-server/deep-routes.ts:632)。包含：
 *   - `run`：run 摘要 + isolation（runKind/runMode）
 *   - `agentRunTree`：安全计数投影（[`DeepAgentRunTreeRef`](#deepagentruntreeref)）
 *   - `report`：完整运行级报告（结论 + childSummaries + synthesisRecords + 完整 tree），run 未完成时为 `undefined`
 *   - `eventSequence`：安全 SSE 事件序列（replay 源）
 */
export type DeepRunView = {
  readonly run: DeepRunRecord;
  readonly conversation?: DeepConversationView;
  readonly agentRunTree: DeepAgentRunTreeRef;
  readonly report: DeepExplorationReportView | undefined;
  readonly eventSequence: readonly DeepStreamEvent[];
  readonly liveProjection: DeepLiveProjection;
  /**
   * 研究 brief（T3-1，FR-BRIEF-01 前端消费侧）。
   *
   * 首次 spawn_children 后由后端装配（T2-1 写入 record.brief），run 未进入 spawn 阶段时为
   * `undefined`。Panel 计划阶段消费此 brief 的安全字段，不直接暴露 manager 长 rationale。
   */
  readonly brief?: DeepResearchBriefView;
};

// ---------------------------------------------------------------------------
// HTTP 响应信封（各 deep 端点的完整 JSON 响应）
// ---------------------------------------------------------------------------

/** POST /api/deep/conversations 响应。 */
export type CreateDeepConversationResponse = {
  readonly ok: true;
  readonly status: "created";
  readonly conversation: DeepConversationView;
};

/** POST /api/deep/conversations/:id/runs 响应（202 后台执行）。 */
export type StartDeepRunResponse = {
  readonly ok: true;
  readonly status: "running";
  readonly run: {
    readonly runId: string;
    readonly conversationId: string;
    readonly status: DeepRunStatus;
    readonly runKind: DeepRunKind;
    readonly runMode: DeepRunMode;
    readonly rootRunId?: string;
    readonly turnOrdinal?: number;
  };
};

/** POST /api/deep/intake 响应。 */
export type DeepIntakeResponse =
  | {
      readonly ok: true;
      readonly status: "needs_input" | "answered";
      readonly conversation: DeepConversationView;
      readonly intake: DeepIntakeTurn;
    }
  | {
      readonly ok: true;
      readonly status: "running";
      readonly conversation: DeepConversationView;
      readonly intake: DeepIntakeTurn;
      readonly run: {
        readonly runId: string;
        readonly conversationId: string;
        readonly status: DeepRunStatus;
        readonly runKind: DeepRunKind;
        readonly runMode: DeepRunMode;
        readonly rootRunId?: string;
        readonly turnOrdinal?: number;
      };
    };

/** GET /api/deep/conversations/:id/runs 响应（历史复盘列表）。 */
export type ListDeepRunsResponse = {
  readonly ok: true;
  readonly conversationId: string;
  readonly runs: readonly DeepRunSummary[];
};

/** GET /api/deep/runs 响应（跨会话最近运行列表）。 */
export type ListDeepRunSummariesResponse = {
  readonly ok: true;
  readonly runs: readonly DeepRunSummary[];
};

/** GET /api/deep/runs/:runId/view 响应。 */
export type GetDeepRunViewResponse = {
  readonly ok: true;
  readonly view: DeepRunView;
};

/** POST /api/deep/runs/:runId/interrupt|correct|stop 响应（202 已接受控制请求）。 */
export type DeepRunControlResponse = {
  readonly ok: true;
  readonly status: "interrupt_requested" | "correct_requested" | "stop_requested";
  readonly runId: string;
};

/** POST /api/deep/runs/:runId/follow-up 响应。 */
export type DeepRunFollowUpResponse = {
  readonly ok: true;
  readonly status: "running";
  readonly conversationId: string;
  readonly runId: string;
  readonly parentRunId: string;
};

/** POST /api/deep/runs/:runId/resynthesize 响应。 */
export type DeepRunResynthesisResponse = {
  readonly ok: true;
  readonly view: DeepRunView;
};

/** POST /api/deep/runs/:runId/children/:childRunId/messages 响应。 */
export type DeepChildOperationResponse = {
  readonly ok: true;
  readonly status?: "queued" | "continued";
  readonly runId?: string;
  readonly childRunId?: string;
  readonly messageRef?: string;
  readonly childStatus?: DeepChildRunStatus;
  readonly queuedCount?: number;
  readonly queuedAt?: string;
  readonly view: DeepRunView;
};

/** POST /api/deep/runs/:runId/children/:childRunId/confirmations/:confirmationId/decision 响应。 */
export type DeepChildConfirmationResponse = {
  readonly ok: true;
  readonly view: DeepRunView;
};
