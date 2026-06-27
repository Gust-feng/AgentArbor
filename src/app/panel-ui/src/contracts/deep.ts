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

/** AgentRunTree 级状态（4 值）。镜像 [`AgentRunTree.status`](src/domain/underground/agent-fabric.ts:123)。 */
export type DeepAgentRunTreeStatus = "running" | "completed" | "failed" | "stopped";

/** ChildAgentRun 状态枚举。镜像 [`ChildAgentRunStatus`](src/domain/underground/agent-fabric.ts:34)。 */
export type DeepChildRunStatus =
  | "planned"
  | "running"
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
  readonly isolation: DeepConversationIsolationMark;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** 镜像 [`projectDeepRunSummary`](src/app/panel-server/deep-routes.ts:608)。 */
export type DeepRunSummary = {
  readonly runId: string;
  readonly conversationId: string;
  readonly goal: string;
  readonly status: DeepRunStatus;
  readonly runKind: DeepRunKind;
  readonly runMode: DeepRunMode;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly hasConclusion: boolean;
  readonly childCount: number;
  readonly eventCount: number;
};

/** run 级摘要（projectDeepRunView 的 `run` 字段，也用于 start run 响应）。 */
export type DeepRunRecord = {
  readonly runId: string;
  readonly conversationId: string;
  readonly goal: string;
  readonly status: DeepRunStatus;
  readonly runKind: DeepRunKind;
  readonly runMode: DeepRunMode;
  readonly startedAt: string;
  readonly updatedAt: string;
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

/** deep 运行 SSE 流式事件类型全集（10 个 deep.* 类型）。镜像 [`DeepEventType`](src/app/deep/deep-events.ts:37)。 */
export type DeepEventType =
  | "deep.goal_received"
  | "deep.manager.decided"
  | "deep.child.started"
  | "deep.child.waiting"
  | "deep.child.completed"
  | "deep.parent_synthesis.completed"
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
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
  readonly maxChildRuns?: number;
  readonly maxOutputRefs?: number;
};

/** AgentSpec 的 permissions 子结构。镜像 [`AgentTurnPermissionPolicy`](src/domain/common.ts:36)。 */
export type DeepAgentPermissionPolicy = {
  readonly allowModel: boolean;
  readonly allowedTools: readonly string[];
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
  readonly fallback: "deterministic" | "disabled";
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
  readonly protocol: DeepAgentProtocol;
  readonly promptRef: string;
  readonly outputContractRef: string;
  readonly permissions: DeepAgentPermissionPolicy;
  readonly budget: DeepAgentSpecBudget;
  readonly inputRefs: readonly string[];
  readonly createdAt: string;
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
  readonly source: "ai" | "deterministic_fallback";
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
  readonly agentRunTree: DeepAgentRunTreeRef;
  readonly report: DeepExplorationReportView | undefined;
  readonly eventSequence: readonly DeepStreamEvent[];
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
  };
};

/** GET /api/deep/conversations/:id/runs 响应（历史复盘列表）。 */
export type ListDeepRunsResponse = {
  readonly ok: true;
  readonly conversationId: string;
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
