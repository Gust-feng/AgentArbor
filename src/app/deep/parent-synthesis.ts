/**
 * Parent Synthesis —— 父层综合与 SynthesizedConclusion 产出（deep 一期，T2-5）。
 *
 * 职责边界（design.md §3.1/§4.1/§5.2/§7.3）：
 *   - 消费 child 局部材料（DeepChildSummary + 已完成 ChildAgentRun），经 AgentTurnRuntime
 *     调模型（deep_synthesis 契约）做对比/反驳/合并/降权/追问/停止，产出可解释的
 *     {@link SynthesizedConclusion}（结论 + 一句话理由 + 关键证据引用 + 候选取舍 +
 *     主要不确定性，五要素）；
 *   - **强制 assertNoDirectChildOutputHandoff 硬约束**（FR-005）：综合产出 outputRefs
 *     不得直接等于任何 child outputRefs，直通交接在写入前被拒绝（可观察触发）；
 *   - 同时产出一份 domain {@link ParentSynthesisResult}（run-tree 级综合记录），供
 *     DeepRuntime（T2-6）写入 AgentRunTree.parentSyntheses，承载"结论如何形成"的
 *     可追溯证据链（FR-009）。
 *
 * 模块边界：本文件是 T2-3 中内联在 deep-run-executor.ts 的 synthesize 分支抽取出的
 * 独立模块（design.md §5.2）。deep-run-executor.ts 改为委托调用 synthesizeDeepConclusion，
 * 不再内联实现综合逻辑。父层综合由模型完成（AI-first 边界），executor 只执行模型决策
 * + 守边界（assertNoDirectChildOutputHandoff），不替代模型语义判断。
 *
 * 能力优先口径（ADR-0025）：模型工作所需的完整 child 工具结果/证据材料不被摘要替代。
 * DeepChildSummary 只是安全摘要投影字段；本模块装配综合消息时携带完整 findings/evidenceRefs，
 * 结论解析保留 keyEvidenceRefs/candidateDispositions 等完整可解释字段。
 *
 * 命名红线：消费 contracts.ts 的 SynthesizedConclusion / DeepChildSummary；不引入
 * Plan / directionHandoffPackage / artifact / Fruits 产物字段。
 */
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type {
  ChildAgentRun,
  ParentSynthesisResult,
  ParentSynthesisNextAction,
} from "../../domain/underground/agent-fabric.js";
import { assertNoDirectChildOutputHandoff } from "../../domain/underground/agent-fabric.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { createId, nowIso } from "../../kernel/id.js";
import type {
  DeepChildSummary,
  SynthesizedConclusion,
} from "./contracts.js";
import {
  DEEP_SYNTHESIS_CONTRACT_ID,
  deepSynthesisMessages,
  deepSynthesisOutputContract,
  extractStructuredOutput,
  parseDeepSynthesis,
} from "./deep-model-io.js";
import { executeDeepTurn } from "./deep-turn.js";
import { DEEP_MANAGER_AGENT_ID } from "./child-delegation.js";

// ---------------------------------------------------------------------------
// 父层综合结果类型
// ---------------------------------------------------------------------------

/**
 * 一次父层综合的完整产出：
 *   - {@link conclusion}：结论级 {@link SynthesizedConclusion}（五要素，FR-006）；
 *   - {@link synthesisRecord}：run-tree 级 {@link ParentSynthesisResult}，供 DeepRuntime
 *     写入 AgentRunTree.parentSyntheses（FR-009 可复盘证据链）。
 *
 * 二者由同一次模型综合产出，语义一致：synthesisRecord 是 run-tree 持久化投影，
 * conclusion 是对外可解释结论。命名红线：不叫 Plan / DirectionHandoff。
 */
export type DeepSynthesisOutcome = {
  readonly conclusion: SynthesizedConclusion;
  readonly synthesisRecord: ParentSynthesisResult;
};

/**
 * 父层综合输入。`completedChildRuns` 用于 assertNoDirectChildOutputHandoff 硬约束
 * （child outputRefs 断言）与 synthesisRecord.childRunIds；`childSummaries` 用于
 * 综合消息装配（携带完整 findings/evidenceRefs，能力优先口径）。
 */
export type SynthesizeDeepConclusionInput = {
  readonly turnRuntime: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly runId: string;
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly completedChildRuns: readonly ChildAgentRun[];
  readonly evidenceRefs: readonly string[];
  readonly inputRefs: readonly ObservationRef[];
  readonly maxModelRounds: number;
  readonly maxToolRounds: number;
  readonly parentAgentId?: string;
  readonly createdAt?: string;
};

// ---------------------------------------------------------------------------
// 主入口：synthesizeDeepConclusion
// ---------------------------------------------------------------------------

/**
 * 父层综合多 child 材料产出可解释 SynthesizedConclusion + run-tree 综合记录。
 *
 * 流程（FR-005/FR-006）：
 *   1. 经 deep_synthesis 契约调模型做对比/反驳/合并/降权，解析为 SynthesizedConclusion（五要素）；
 *   2. **强制 assertNoDirectChildOutputHandoff**——综合产出 outputRefs 不得直接等于任何
 *      child outputRefs（直通交接在写入前拒绝，可观察触发，FR-005 硬约束）；
 *   3. 基于 conclusion + childRuns 构造 domain ParentSynthesisResult（run-tree 持久化记录）。
 *
 * AI-first 边界：综合由模型完成（source:"ai"）；本函数不合成 deterministic_fallback 结论，
 * 不在 child 材料不足时伪装完成（材料不足时应由 manager 选 spawn_children/ask_user，
 * 而非进入 synthesize）。
 *
 * @throws {@link AgentFabricContractError}（assertNoDirectChildOutputHandoff）当综合产出
 *   outputRefs 直接等于任何 child outputRefs（直通交接被拒绝）。
 */
export async function synthesizeDeepConclusion(
  input: SynthesizeDeepConclusionInput,
): Promise<DeepSynthesisOutcome> {
  const parentAgentId = input.parentAgentId ?? DEEP_MANAGER_AGENT_ID;
  const createdAt = input.createdAt ?? nowIso();
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: input.runId,
    label: `${parentAgentId}:synthesis`,
  };
  const turn = await executeDeepTurn({
    turnRuntime: input.turnRuntime,
    traceId: input.traceId,
    goalId: input.goalId,
    callerAgentId: parentAgentId,
    callerRef,
    purpose: "deep_synthesis",
    outputContract: deepSynthesisOutputContract(),
    inputRefs: [...input.inputRefs],
    messages: deepSynthesisMessages({
      goal: input.goal,
      taskSoil: input.taskSoil,
      childSummaries: input.childSummaries,
      evidenceRefs: input.evidenceRefs,
    }),
    allowedTools: [],
    maxModelRounds: input.maxModelRounds,
    maxToolRounds: input.maxToolRounds,
  });
  const structured = extractStructuredOutput(turn.finalOutput);
  const conclusion = parseDeepSynthesis({
    value: structured,
    createdAt,
    childSummaries: input.childSummaries,
  });

  // FR-005 硬约束：child 产出不得直通结论——综合产出 outputRefs 不得直接等于
  // 任何 child outputRefs（直通交接在写入前拒绝，可观察触发）。
  assertNoDirectChildOutputHandoff({
    handoffInputRefs: conclusion.outputRefs,
    childRuns: input.completedChildRuns,
  });

  const synthesisRecord = buildParentSynthesisRecord({
    conclusion,
    childRuns: input.completedChildRuns,
    parentAgentId,
    createdAt,
  });
  return { conclusion, synthesisRecord };
}

// ---------------------------------------------------------------------------
// ParentSynthesisRecord 构建（domain run-tree 持久化记录）
// ---------------------------------------------------------------------------

/**
 * 基于 SynthesizedConclusion + childRuns 构造 domain ParentSynthesisResult。
 *
 * 字段映射（承载"结论如何形成"的可追溯证据链，FR-009）：
 *   - childRunIds：参与综合的 child；
 *   - retainedMaterialRefs：候选取舍中"采纳"的候选（selected=true）；
 *   - rejectedMaterialRefs：候选取舍中"未采纳"的候选（selected=false）；
 *   - outputRefs：综合产出引用（已通过 assertNoDirectChildOutputHandoff）；
 *   - nextAction：固定 request_convergence（综合已产出结论，进入收束）。
 *
 * source 跟随 conclusion.source（"ai"）——综合由模型完成，不伪装 deterministic_fallback。
 */
export function buildParentSynthesisRecord(input: {
  readonly conclusion: SynthesizedConclusion;
  readonly childRuns: readonly ChildAgentRun[];
  readonly parentAgentId: string;
  readonly createdAt: string;
}): ParentSynthesisResult {
  const dispositions = input.conclusion.candidateDispositions;
  const retained = dispositions.filter((disposition) => disposition.selected);
  const rejected = dispositions.filter((disposition) => !disposition.selected);
  const nextAction: ParentSynthesisNextAction = "request_convergence";
  return {
    synthesisId: createId("deep-synthesis"),
    parentAgentId: input.parentAgentId,
    childRunIds: input.childRuns.map((run) => run.childRunId),
    inputRefs: [...input.conclusion.keyEvidenceRefs],
    retainedMaterialRefs: retained.map((disposition) => disposition.candidateId),
    rejectedMaterialRefs: rejected.map((disposition) => disposition.candidateId),
    conflictRefs: [],
    outputRefs: [...input.conclusion.outputRefs],
    nextAction,
    decisionSummary: input.conclusion.oneLineRationale,
    uncertainty: input.conclusion.mainUncertainty,
    source: input.conclusion.source,
    confidence: input.conclusion.confidence,
    reasoningTraceRefs: [...input.conclusion.keyEvidenceRefs],
    createdAt: input.createdAt,
  };
}

// ---------------------------------------------------------------------------
// 类型再导出（供消费方按需引用）
// ---------------------------------------------------------------------------

export { assertNoDirectChildOutputHandoff, DEEP_SYNTHESIS_CONTRACT_ID };
export type { ParentSynthesisResult, ParentSynthesisNextAction };
