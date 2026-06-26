/**
 * Child Delegation（deep 一期，T2-4，ADR-0025 §5.2/§7.3）。
 *
 * 本文件实现 manager spawn_children 后的 child 派生与一层 child 探索：
 *   - {@link deriveDeepChildren}：按 decision.childSpecs 动态创建 child（一层，depth=1），
 *     复用 domain AgentSpec/ChildAgentRun 持久化契约。
 *   - {@link assertOneLayerChildDepth}：Guard 确定性硬约束，强制 depth=1（复用
 *     AGENT_FABRIC_MVP_MAX_DEPTH + domain/underground/guard.ts），递归派生子 child 在
 *     写入前拒绝（FR-004 硬约束，可观察触发）。
 *   - {@link exploreDeepChild}：child 工具调用经 ToolCenter/Confirmation Gate（复用
 *     AgentTurnRuntime 的 toolCenter），产出局部材料（来源/证据/置信度/适用条件）。
 *   - 数量上限：超出 {@link DEEP_MAX_CHILDREN} 的 childSpecs 不派生（overflowCount 可观察），
 *     由 manager 在下一 step 据此收束或 ask_user（AI-first 边界，不伪装派生成功）。
 *
 * 复用边界：不 import cognitive-work-session-fabric.ts（legacy），AgentSpec 构建在本文件
 * 本地实现；guard 复用 domain/underground/guard.ts；tool 执行复用 AgentTurnRuntime。
 */
import type { ToolConfirmationPolicy } from "../../domain/tools/contracts.js";
import type { ObservationRef } from "../../domain/observation/contracts.js";
import type { AgentSpec, ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import {
  AGENT_FABRIC_MVP_MAX_DEPTH,
  createChildAgentRun,
  completeChildAgentRun,
  startChildAgentRun,
  failChildAgentRun,
} from "../../domain/underground/agent-fabric.js";
import {
  createGuardResult,
  createGuardViolation,
  type GuardResult,
} from "../../domain/underground/guard.js";
import type { AgentTurnRuntime } from "../../kernel/intelligence/agent-turn-runtime.js";
import { createId, nowIso } from "../../kernel/id.js";
// P6：可用工具能力声明——child 探索消息投影 run 冻结的 capabilitySnapshot 中本 child 被授权
// 的工具能力简述，帮助 child 知道能用什么收集一手证据。仅作能力声明；实际调用仍经确认门。
import type { BasicAgentCapabilitySnapshot } from "../../domain/config/index.js";
import type { DeepChildSpec, DeepChildSummary } from "./contracts.js";
import {
  deepChildMaterialMessages,
  deepChildMaterialOutputContract,
  DEEP_CHILD_MATERIAL_CONTRACT_ID,
  extractStructuredOutput,
  parseDeepChildMaterial,
} from "./deep-model-io.js";
import { executeDeepTurn } from "./deep-turn.js";

/** deep 一期默认 child 数量上限（FR-004）。 */
export const DEEP_MAX_CHILDREN = 4;

/** deep manager root agent id（run tree 根节点）。 */
export const DEEP_MANAGER_AGENT_ID = "deep-runtime-manager";

// ---------------------------------------------------------------------------
// 一层 child 深度硬约束（FR-004，Guard 确定性守卫）
// ---------------------------------------------------------------------------

export const DEEP_CHILD_DEPTH_GUARD_CODE = "deep_child_depth_exceeded";

/**
 * Guard：校验 child 派生深度是否满足一层约束。
 *
 * deep 一期 MVP：manager（depth=0）可派生一层 child（depth=1 == AGENT_FABRIC_MVP_MAX_DEPTH）；
 * child 不可再派生子 child（depth=2 > maxDepth → 拒绝）。本函数是确定性守卫，只守边界，
 * 不替代 manager 的"是否派生/派生几个"语义决策（ADR-0025 决策一 AI-first 边界）。
 *
 * @returns GuardResult——passed=true 表示深度合规；passed=false 表示递归越界，调用方必须拒绝写入。
 */
export function assertOneLayerChildDepth(input: {
  readonly parentDepth: number;
  readonly maxDepth?: number;
}): GuardResult {
  const maxDepth = input.maxDepth ?? AGENT_FABRIC_MVP_MAX_DEPTH;
  const childDepth = input.parentDepth + 1;
  if (childDepth > maxDepth) {
    const violation = createGuardViolation({
      code: DEEP_CHILD_DEPTH_GUARD_CODE,
      message: `DeepRuntime MVP 只允许一层 child（maxDepth=${maxDepth}）；parentDepth=${input.parentDepth} 的派生请求会产生 depth=${childDepth}，已拒绝。`,
      severity: "error",
      sourceRef: `parentDepth:${input.parentDepth}`,
    });
    return createGuardResult({ violations: [violation] });
  }
  return createGuardResult({ violations: [] });
}

// ---------------------------------------------------------------------------
// child AgentSpec 构建
// ---------------------------------------------------------------------------

/**
 * 按 DeepChildSpec 补全为完整 domain AgentSpec（child 角度探索用）。
 *
 * DeepChildSpec 是 manager 决策语义层的轻量派生请求；本函数补全 protocol/permissions/
 * budget 等完整字段后写入 AgentRunTree（contracts.ts DeepChildSpec 注释边界）。
 */
export function createDeepChildAgentSpec(input: {
  readonly childSpec: DeepChildSpec;
  readonly index: number;
  readonly goalId: string;
  readonly traceId: string;
  readonly createdAt: string;
}): AgentSpec {
  const { childSpec, index } = input;
  return {
    specId: childSpec.specId,
    agentId: safeToken(childSpec.role, `deep-child-${index + 1}`),
    displayName: safeText(childSpec.displayName, 80) || `Deep Child ${index + 1}`,
    agentKind: "child",
    role: safeToken(childSpec.role, "deep_child"),
    protocol: {
      inputs: [{ source: "workspace", key: "task_soil_goal", required: true }],
      outputs: [{ type: "material", payloadSchema: DEEP_CHILD_MATERIAL_CONTRACT_ID }],
    },
    promptRef: `prompt:deep.child.${childSpec.specId}.v1`,
    outputContractRef: DEEP_CHILD_MATERIAL_CONTRACT_ID,
    permissions: {
      allowModel: true,
      allowedTools: [...childSpec.allowedTools],
      maxModelRounds: 2,
      maxToolRounds: 2,
      fallback: "disabled",
    },
    budget: {
      maxModelRounds: 2,
      maxToolRounds: 2,
      maxOutputRefs: 6,
    },
    inputRefs: unique([
      `goal:${input.goalId}`,
      `trace:${input.traceId}`,
      ...childSpec.inputRefs.map((ref) => safeText(ref, 160)),
    ]),
    createdAt: input.createdAt,
  };
}

// ---------------------------------------------------------------------------
// child 派生（一层 + 数量上限）
// ---------------------------------------------------------------------------

export type DeriveDeepChildrenInput = {
  readonly specs: readonly DeepChildSpec[];
  readonly parentAgentId: string;
  readonly parentDepth: number;
  readonly goalId: string;
  readonly traceId: string;
  readonly maxChildren?: number;
  readonly createdAt?: string;
};

export type DeriveDeepChildrenResult = {
  /** 实际派生的 child（已通过 depth guard + 数量上限裁剪）。 */
  readonly children: readonly ChildAgentRun[];
  /** depth=1 guard 结果（递归越界时 passed=false，children 为空）。 */
  readonly depthGuard: GuardResult;
  /** 超出数量上限的 childSpec 数量（manager 据此收束或 ask_user）。 */
  readonly overflowCount: number;
};

/**
 * 按 decision.childSpecs 派生 child（一层，depth=1）。
 *
 * 流程：
 *   1. assertOneLayerChildDepth 守卫——递归越界（parentDepth+1 > maxDepth）时拒绝，
 *      返回空 children + passed=false depthGuard（硬约束可观察触发）。
 *   2. 数量上限裁剪——仅派生前 maxChildren 个，多余记入 overflowCount（不伪造派生成功）。
 *   3. 逐个补全 AgentSpec → createChildAgentRun。
 */
export function deriveDeepChildren(input: DeriveDeepChildrenInput): DeriveDeepChildrenResult {
  const depthGuard = assertOneLayerChildDepth({ parentDepth: input.parentDepth });
  if (!depthGuard.passed) {
    return { children: [], depthGuard, overflowCount: input.specs.length };
  }
  const maxChildren = Math.max(0, Math.floor(input.maxChildren ?? DEEP_MAX_CHILDREN));
  const createdAt = input.createdAt ?? nowIso();
  const accepted = input.specs.slice(0, maxChildren);
  const overflowCount = Math.max(0, input.specs.length - maxChildren);
  const children = accepted.map((childSpec, index) => {
    const spec = createDeepChildAgentSpec({
      childSpec,
      index,
      goalId: input.goalId,
      traceId: input.traceId,
      createdAt,
    });
    return createChildAgentRun({
      childRunId: createId("deep-child-run"),
      parentAgentId: input.parentAgentId,
      spec,
      inputRefs: spec.inputRefs,
      startedAt: createdAt,
    });
  });
  return { children, depthGuard, overflowCount };
}

// ---------------------------------------------------------------------------
// child 探索（经 ToolCenter/Confirmation Gate 产出局部材料）
// ---------------------------------------------------------------------------

export type ExploreDeepChildInput = {
  readonly childRun: ChildAgentRun;
  readonly goal: string;
  readonly permissionBoundaryRefs: readonly string[];
  readonly turnRuntime: AgentTurnRuntime;
  readonly traceId: string;
  readonly goalId: string;
  readonly confirmationPolicy?: ToolConfirmationPolicy;
  /**
   * P6：run 启动时冻结的能力快照。携带时 child 探索消息会投影「本 child 被授权可用工具」段
   * （childSpec.allowedTools ∩ 可用工具）及其能力简述，帮助 child 知道能用什么收集一手证据。
   * 仅作能力声明；模型实际工具调用仍经 ToolCenter/确认门。
   */
  readonly capabilitySnapshot?: BasicAgentCapabilitySnapshot;
};

export type ExploreDeepChildResult = {
  readonly summary: DeepChildSummary;
  /** 探索完成后的 child run（status=completed，携带 outputRefs/evidenceRefs/confidence）。 */
  readonly completedRun: ChildAgentRun;
};

/**
 * 执行单个 child 探索：经 AgentTurnRuntime（复用其 toolCenter=ToolCenter/Confirmation Gate）
 * 调用模型产出 child_material，解析为 DeepChildSummary，并补全 ChildAgentRun 的产出字段。
 *
 * child 工具调用边界沿用普通 agent 工具语义（allowedTools 来自 childSpec，确认门来自
 * confirmationPolicy）；模型工作所需的完整工具结果不被摘要替代（DeepChildSummary 只是
 * 对外投影字段，内部 evidenceRefs 保留完整证据引用链）。
 *
 * 失败语义：turn 抛错时本函数不吞错——向上抛出，由 DeepRunExecutor 决定标记 child failed
 * 还是 ask_user（AI-first 边界）。
 */
export async function exploreDeepChild(input: ExploreDeepChildInput): Promise<ExploreDeepChildResult> {
  const childSpec = deepChildSpecFromRun(input.childRun);
  const startedRun = startChildAgentRun(input.childRun, input.childRun.startedAt);
  const callerRef: ObservationRef = {
    kind: "agent_run",
    id: input.childRun.childRunId,
    label: `deep_child:${childSpec.role}`,
  };
  const turn = await executeDeepTurn({
    turnRuntime: input.turnRuntime,
    traceId: input.traceId,
    goalId: input.goalId,
    callerAgentId: input.childRun.spec.agentId,
    callerRef,
    purpose: "deep_child_material",
    outputContract: deepChildMaterialOutputContract(),
    inputRefs: dedupeObservationRefs([
      { kind: "trace", id: input.traceId },
      { kind: "goal", id: input.goalId },
      ...input.childRun.inputRefs.map((ref) => observationRefFromString(ref)),
    ]),
    messages: deepChildMaterialMessages({
      goal: input.goal,
      childSpec,
      permissionBoundaryRefs: input.permissionBoundaryRefs,
      // P6：传入 run 冻结的 capabilitySnapshot，投影本 child 被授权可用工具的能力简述。
      capabilitySnapshot: input.capabilitySnapshot,
    }),
    allowedTools: [...childSpec.allowedTools],
    maxModelRounds: input.childRun.spec.budget.maxModelRounds,
    maxToolRounds: input.childRun.spec.budget.maxToolRounds,
    confirmationPolicy: input.confirmationPolicy,
  });
  const structured = extractStructuredOutput(turn.finalOutput);
  const summary = parseDeepChildMaterial({
    value: structured,
    childSpec,
    childRunId: input.childRun.childRunId,
  });
  const completedRun = completeChildAgentRun({
    run: startedRun,
    outputRefs: summary.evidenceRefs.slice(0, 6),
    evidenceRefs: summary.evidenceRefs,
    confidence: summary.confidence,
    uncertainty: summary.uncertainty,
    completedAt: nowIso(),
  });
  return { summary, completedRun };
}

// ---------------------------------------------------------------------------
// EP3 child 错误隔离：失败 child 的可观察降级投影
// ---------------------------------------------------------------------------

/**
 * 构造一个失败的 child 探索结果（EP3 工程鲁棒性）。
 *
 * 当 exploreDeepChild 因模型 turn 异常或解析失败抛错时，调用方（DeepRunExecutor
 * 的 spawn_children 分支）不再让单个 child 失败拖垮整 run，而是用本函数构造一份
 * status="failed" 的 DeepChildSummary + failChildAgentRun，汇入本批 child 结果。
 *
 * 设计边界（AI-first / 不伪造）：
 *   - 失败 child 的 summary 如实记录失败原因，findings/evidenceRefs 为空，confidence=0；
 *   - 综合消息（formatChildSummary）对 status≠completed 的 child 显式标注 [status=failed]，
 *     让父层综合模型知道该角度未产出可用证据，对其降权或忽略，而不是把它当作有效候选；
 *   - 本函数不编造任何结论或证据，只做"诚实标记失败 + 保留可观察记录"。
 */
export function buildFailedChildExploration(input: {
  readonly childRun: ChildAgentRun;
  readonly reason: string;
  readonly failedAt: string;
}): ExploreDeepChildResult {
  const childSpec = deepChildSpecFromRun(input.childRun);
  const failedRun = failChildAgentRun(input.childRun, input.reason, input.failedAt);
  const trimmedReason = input.reason.trim().length > 0 ? input.reason.trim() : "unknown exploration error";
  const summary: DeepChildSummary = {
    childRunId: input.childRun.childRunId,
    spec: childSpec,
    status: "failed",
    summary: `Child exploration failed: ${trimmedReason}`,
    findings: [],
    evidenceRefs: [],
    confidence: 0,
    uncertainty: `This child's exploration failed (${trimmedReason}); no usable evidence collected.`,
  };
  return { summary, completedRun: failedRun };
}

// ---------------------------------------------------------------------------
// 本地辅助函数
// ---------------------------------------------------------------------------

/** 从 ChildAgentRun.spec 还原 DeepChildSpec（用于消息装配与材料解析）。 */
function deepChildSpecFromRun(run: ChildAgentRun): DeepChildSpec {
  return {
    specId: run.spec.specId,
    displayName: run.spec.displayName,
    role: run.spec.role,
    objective: run.spec.protocol.outputs[0]?.payloadSchema === DEEP_CHILD_MATERIAL_CONTRACT_ID
      ? `Explore from angle: ${run.spec.role}`
      : run.spec.role,
    allowedTools: [...run.spec.permissions.allowedTools],
    inputRefs: [...run.spec.inputRefs],
  };
}

function safeToken(value: string | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  const token = value.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return token.length === 0 ? fallback : token;
}

function safeText(value: string | undefined, maxLength: number): string {
  if (value === undefined) {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

/**
 * ObservationRef 合法 kind 集合（与 domain/observation/contracts.ts 对齐）。
 * 用于把 "kind:id" 形式的字符串引用安全解析为 ObservationRef，避免误用未登记的 kind。
 */
const OBSERVATION_REF_KINDS: ReadonlySet<string> = new Set<string>([
  "trace", "goal", "event", "task", "artifact", "direction_handoff",
  "direction_package", "growth_plan", "workflow", "rootlet", "candidate",
  "candidate_pool", "autonomy_decision", "convergence_review", "model_call",
  "tool_call", "agent_spec", "agent_run", "agent_delegation",
  "parent_synthesis", "user_clarification", "verification", "fruit",
  "run_memory", "experience_candidate", "path_bias",
]);

/**
 * 把 "kind:id" 形式的字符串引用解析为 ObservationRef。
 *
 * - 已登记前缀（goal/trace/artifact/...）按前缀拆分；
 * - 未知前缀或无冒号时整体作为 id，kind 归入 artifact（保底可观察引用，不丢信息）。
 */
function observationRefFromString(ref: string): ObservationRef {
  const trimmed = ref.trim();
  const index = trimmed.indexOf(":");
  if (index <= 0) {
    return { kind: "artifact", id: trimmed };
  }
  const kind = trimmed.slice(0, index);
  const id = trimmed.slice(index + 1);
  if (id.length === 0) {
    return { kind: "artifact", id: trimmed };
  }
  if (OBSERVATION_REF_KINDS.has(kind)) {
    return { kind: kind as ObservationRef["kind"], id };
  }
  return { kind: "artifact", id: trimmed };
}

/** 按 kind+id 去重 ObservationRef（避免 childRun.inputRefs 与显式 trace/goal 重复）。 */
function dedupeObservationRefs(refs: readonly ObservationRef[]): ObservationRef[] {
  const seen = new Set<string>();
  const result: ObservationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}
