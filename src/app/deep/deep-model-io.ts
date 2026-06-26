/**
 * DeepRuntime 模型 IO（deep 一期，ADR-0025）。
 *
 * 本文件为 DeepRunExecutor（manager 决策循环）与 Child Delegation（child 探索）
 * 提供统一的模型输入输出契约：
 *   - 输出契约（{@link ModelOutputContract}）：deep.decision / deep.direct_answer /
 *     deep.child_material / deep.synthesis 四类，contractId 与 fake-model-provider-deep
 *     的 defaultFakeOutput 派发对齐。
 *   - 消息装配：把目标、Task Soil 上下文、run tree 状态、child 材料等组装为
 *     {@link ModelMessage}，供 AgentTurnRuntime 作为 sanitizedMessages 使用。
 *   - 解析器：把模型 structuredOutput 解析为 deep 契约类型（DeepDelegationDecision /
 *     DeepChildSpec / SynthesizedConclusion 等）。
 *
 * 设计边界（ADR-0025 决策一 AI-first）：解析器只做 schema 守卫（必填校验、范围裁剪），
 * 不替代模型语义判断；决策来源标记 source: "ai"，确定性 fallback 仅在 schema 校验
 * 失败的守卫场景出现，且不伪装成已完成判断（见 DeepRunExecutor 的 AI-first 边界）。
 *
 * 复用边界：不 import cognitive-work-session-*（legacy action loop，仅作设计输入），
 * 解析辅助函数在本文件本地定义，避免与 legacy 模块耦合。
 */
import type { ModelOutputContract, ModelResponse } from "../../domain/intelligence/contracts.js";
import type { ModelMessage } from "../../domain/intelligence/contracts.js";
import type { TaskSoil } from "../../domain/soil/task-soil.js";
import type {
  CandidateDisposition,
  DeepChildSpec,
  DeepChildSummary,
  DeepDelegationAction,
  DeepDelegationDecision,
  SynthesizedConclusion,
} from "./contracts.js";
import { DEEP_DELEGATION_ACTIONS } from "./contracts.js";
import { createId } from "../../kernel/id.js";

// ---------------------------------------------------------------------------
// 输出契约 ID 常量（与 fake-model-provider-deep 派发键对齐）
// ---------------------------------------------------------------------------

export const DEEP_DECISION_CONTRACT_ID = "deep.decision.v1";
export const DEEP_DIRECT_ANSWER_CONTRACT_ID = "deep.direct_answer.v1";
export const DEEP_CHILD_MATERIAL_CONTRACT_ID = "deep.child_material.v1";
export const DEEP_SYNTHESIS_CONTRACT_ID = "deep.synthesis.v1";

// ---------------------------------------------------------------------------
// 输出契约工厂
// ---------------------------------------------------------------------------

/**
 * manager 决策输出契约。json_object，必填动作/摘要/不确定性/置信度；
 * childSpecs 仅 spawn_children 时由模型给出，作为可选 visibleOutput 暴露。
 */
export function deepDecisionOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_DECISION_CONTRACT_ID,
    outputKind: "candidate",
    format: "json_object",
    requiredFields: ["action", "decisionSummary", "uncertainty", "confidence"],
    visibleOutput: {
      arrayField: "childSpecs",
      fields: ["specId", "displayName", "role", "objective", "allowedTools", "inputRefs"],
      fieldTypes: {
        allowedTools: "string_array",
        inputRefs: "string_array",
      },
      maxItems: 8,
    },
  };
}

/**
 * direct_answer 输出契约。json_object，必填结论/一句话理由/关键证据引用/主要不确定性。
 * direct_answer 是 manager 在无需多角度探索时直接产出 SynthesizedConclusion 的路径，
 * 因此字段与 synthesis 契约一致（候选取舍在直接回答场景可为空）。
 */
export function deepDirectAnswerOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_DIRECT_ANSWER_CONTRACT_ID,
    outputKind: "explanation",
    format: "json_object",
    requiredFields: ["conclusion", "oneLineRationale", "keyEvidenceRefs", "mainUncertainty"],
  };
}

/**
 * child 探索材料输出契约。json_object，必填摘要/发现/证据引用/不确定性/置信度。
 */
export function deepChildMaterialOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_CHILD_MATERIAL_CONTRACT_ID,
    outputKind: "evidence_suggestion",
    format: "json_object",
    requiredFields: ["summary", "findings", "evidenceRefs", "uncertainty", "confidence"],
  };
}

/**
 * 父层综合输出契约。json_object，必填五要素：结论/一句话理由/关键证据引用/
 * 候选取舍/主要不确定性。
 */
export function deepSynthesisOutputContract(): ModelOutputContract {
  return {
    contractId: DEEP_SYNTHESIS_CONTRACT_ID,
    outputKind: "explanation",
    format: "json_object",
    requiredFields: [
      "conclusion",
      "oneLineRationale",
      "keyEvidenceRefs",
      "candidateDispositions",
      "mainUncertainty",
    ],
  };
}

// ---------------------------------------------------------------------------
// 消息装配输入类型
// ---------------------------------------------------------------------------

export type DeepTurnMessage = {
  readonly role: "system" | "user";
  readonly content: string;
  readonly ref?: string;
};

export type DeepDecisionMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly stepIndex: number;
  readonly stepLimit: number;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly priorDecisionSummaries: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly permissionBoundaryRefs: readonly string[];
  readonly maxChildren: number;
  /**
   * 用户中途纠正/补充的上下文（T2-7，FR-008）。携带时 manager 应在本轮决策中据此
   * 调整派生与综合方向（非空时消息显式标注"用户纠正/补充"段，可观察影响下一 step）。
   */
  readonly correctionContext?: readonly string[];
};

export type DeepDirectAnswerMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly decision: DeepDelegationDecision;
  readonly evidenceRefs: readonly string[];
};

export type DeepChildMaterialMessagesInput = {
  readonly goal: string;
  readonly childSpec: DeepChildSpec;
  readonly permissionBoundaryRefs: readonly string[];
};

export type DeepSynthesisMessagesInput = {
  readonly goal: string;
  readonly taskSoil: TaskSoil;
  readonly childSummaries: readonly DeepChildSummary[];
  readonly evidenceRefs: readonly string[];
};

// ---------------------------------------------------------------------------
// 消息装配实现
// ---------------------------------------------------------------------------

export function deepDecisionMessages(input: DeepDecisionMessagesInput): readonly DeepTurnMessage[] {
  const correctionSection = formatCorrectionContext(input.correctionContext);
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:manager_system",
    content: [
      "你是 DeepRuntime 的 manager（深层多角度探索协调者）。",
      "你的职责是理解用户目标，逐 step 决策本轮动作，并产出可解释的决策。",
      "",
      "可选动作（六动作，必须选择其一）：",
      "- direct_answer：证据已足够，直接产出结论（简单任务，无需多角度探索）。",
      "- spawn_children：需要多角度/多证据，派生多个 child 分头探索。",
      "- wait_children：已派生的 child 仍在进行中，本轮等待。",
      "- synthesize：child 材料已足够，进入父层综合产出结论。",
      "- ask_user：证据/方向不足，向用户澄清（不要在证据不足时伪装成已完成判断）。",
      "- stop：预算耗尽或目标已达成，停止运行。",
      "",
      "AI-first 边界：你的决策由语义推理产出。当证据不足时，必须选择 spawn_children",
      "（继续探索）或 ask_user（向用户澄清），不得选择 direct_answer/synthesize 伪装完成。",
      "",
      "若用户在中途给出纠正/补充上下文，你必须据此调整本轮派生与综合方向，不能忽略。",
      "",
      `本轮约束：step ${input.stepIndex}/${input.stepLimit}，最多派生 ${input.maxChildren} 个 child。`,
      "输出 JSON：action, decisionSummary, rationale, uncertainty, confidence(0-1),",
      "reasoningRefs(string[]); 仅当 action=spawn_children 时给出 childSpecs 数组。",
    ].join("\n"),
  };
  const contextRefs = taskSoilContextSummary(input.taskSoil);
  const childSection = input.childSummaries.length === 0
    ? "(暂无已完成的 child 探索材料)"
    : input.childSummaries.map((child, index) => formatChildSummary(child, index)).join("\n");
  const priorSection = input.priorDecisionSummaries.length === 0
    ? "(暂无历史决策)"
    : input.priorDecisionSummaries.map((summary, index) => `  ${index + 1}. ${summary}`).join("\n");
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:decision_user",
    content: [
      `Raw goal: ${input.goal}`,
      `Task soil refs: ${contextRefs}`,
      `Permission boundary refs: ${input.permissionBoundaryRefs.join(", ") || "(none)"}`,
      `Collected evidence refs: ${input.evidenceRefs.join(", ") || "(none)"}`,
      `Prior decisions:`,
      priorSection,
      `Completed child materials:`,
      childSection,
      correctionSection,
      "",
      "请决策本轮动作并输出 JSON。",
    ].filter((line) => line.length > 0).join("\n"),
  };
  return [system, user];
}

export function deepDirectAnswerMessages(input: DeepDirectAnswerMessagesInput): readonly DeepTurnMessage[] {
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:direct_answer_system",
    content: [
      "你是 DeepRuntime 的 manager，正在直接回答一个你判定无需多角度探索的目标。",
      "请基于现有证据产出结论级 SynthesizedConclusion，包含五要素：",
      "conclusion（结论）, oneLineRationale（一句话理由）, keyEvidenceRefs（关键证据引用）,",
      "mainUncertainty（主要不确定性）。candidateDispositions 可留空（直接回答场景无候选取舍）。",
    ].join("\n"),
  };
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:direct_answer_user",
    content: [
      `Raw goal: ${input.goal}`,
      `Task soil refs: ${taskSoilContextSummary(input.taskSoil)}`,
      `Decision rationale: ${input.decision.decisionSummary}`,
      `Evidence refs: ${input.evidenceRefs.join(", ") || "(none)"}`,
      "",
      "请输出结论 JSON。",
    ].join("\n"),
  };
  return [system, user];
}

export function deepChildMaterialMessages(input: DeepChildMaterialMessagesInput): readonly DeepTurnMessage[] {
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:child_material_system",
    content: [
      "你是 DeepRuntime 派生的一个 child agent，负责从特定角度探索目标的一个方面。",
      "你只能在一层深度内工作（不可再派生子 agent）。你可以使用授权工具收集证据。",
      "产出局部材料 JSON：summary（摘要）, findings（关键发现数组）, evidenceRefs（证据引用）,",
      "uncertainty（本角度的主要不确定性）, confidence(0-1)。",
      "请保留来源/证据/置信度/适用条件，便于父层综合时取舍。",
    ].join("\n"),
  };
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:child_material_user",
    content: [
      `Parent goal: ${input.goal}`,
      `Your role: ${input.childSpec.role} (${input.childSpec.displayName})`,
      `Your objective: ${input.childSpec.objective}`,
      `Allowed tools: ${input.childSpec.allowedTools.join(", ") || "(none)"}`,
      `Input refs: ${input.childSpec.inputRefs.join(", ") || "(none)"}`,
      `Permission boundary refs: ${input.permissionBoundaryRefs.join(", ") || "(none)"}`,
      "",
      "请探索并输出局部材料 JSON。",
    ].join("\n"),
  };
  return [system, user];
}

export function deepSynthesisMessages(input: DeepSynthesisMessagesInput): readonly DeepTurnMessage[] {
  const system: DeepTurnMessage = {
    role: "system",
    ref: "context:deep:synthesis_system",
    content: [
      "你是 DeepRuntime 的 manager，正在做父层综合：消费多个 child 的局部材料，",
      "对冲突材料做对比/反驳/合并/降权，产出可解释的 SynthesizedConclusion。",
      "结论五要素：conclusion, oneLineRationale, keyEvidenceRefs, candidateDispositions,",
      "mainUncertainty。candidateDispositions 必须说明每个 child 候选为什么选/不选。",
      "child 产出不可直通结论——你必须基于全部材料综合判断，不能照搬单个 child 的 outputRefs。",
    ].join("\n"),
  };
  const childSection = input.childSummaries.length === 0
    ? "(无 child 材料，无法综合)"
    : input.childSummaries.map((child, index) => formatChildSummary(child, index)).join("\n");
  const user: DeepTurnMessage = {
    role: "user",
    ref: "context:deep:synthesis_user",
    content: [
      `Raw goal: ${input.goal}`,
      `Task soil refs: ${taskSoilContextSummary(input.taskSoil)}`,
      `Collected evidence refs: ${input.evidenceRefs.join(", ") || "(none)"}`,
      `Child materials to synthesize:`,
      childSection,
      "",
      "请综合产出结论 JSON。",
    ].join("\n"),
  };
  return [system, user];
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

/**
 * 解析 manager 决策 structuredOutput 为 DeepDelegationDecision。
 * schema 守卫：动作必须是六动作之一；置信度裁剪到 [0,1]。
 * source 固定 "ai"——决策由模型语义推理产出。
 */
export function parseDeepDecision(input: {
  readonly value: unknown;
  readonly parentAgentId: string;
  readonly createdAt: string;
}): DeepDelegationDecision {
  const record = requireRecord(input.value, DEEP_DECISION_CONTRACT_ID);
  return {
    decisionId: createId("deep-decision"),
    parentAgentId: input.parentAgentId,
    action: parseDeepAction(record.action),
    childSpecs: parseDeepChildSpecs(record.childSpecs),
    decisionSummary: requireString(record.decisionSummary, "decisionSummary"),
    rationale: optionalString(record.rationale) ?? requireString(record.decisionSummary, "decisionSummary"),
    uncertainty: requireString(record.uncertainty, "uncertainty"),
    source: "ai",
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    reasoningRefs: stringArray(record.reasoningRefs),
    createdAt: input.createdAt,
  };
}

/**
 * 解析 direct_answer structuredOutput 为 SynthesizedConclusion。
 * 直接回答场景候选取舍为空（无 child 候选）。
 */
export function parseDeepDirectAnswer(input: {
  readonly value: unknown;
  readonly createdAt: string;
  readonly evidenceRefs: readonly string[];
}): SynthesizedConclusion {
  const record = requireRecord(input.value, DEEP_DIRECT_ANSWER_CONTRACT_ID);
  const conclusion = requireString(record.conclusion, "conclusion");
  return {
    conclusionId: createId("deep-conclusion"),
    conclusion,
    oneLineRationale: requireString(record.oneLineRationale, "oneLineRationale"),
    keyEvidenceRefs: dedupeStrings([...input.evidenceRefs, ...stringArray(record.keyEvidenceRefs)]).slice(0, 24),
    candidateDispositions: [],
    mainUncertainty: requireString(record.mainUncertainty, "mainUncertainty"),
    // 直接回答的 outputRefs 由结论本身产出，不等于任何 child outputRefs（直接回答无 child）。
    outputRefs: [`conclusion:${conclusion.slice(0, 40)}`],
    source: "ai",
    confidence: clampConfidence(numberOr(record.confidence, 0.5)),
    createdAt: input.createdAt,
  };
}

/**
 * 解析 child 探索材料 structuredOutput 为 DeepChildSummary。
 */
export function parseDeepChildMaterial(input: {
  readonly value: unknown;
  readonly childSpec: DeepChildSpec;
  readonly childRunId: string;
}): DeepChildSummary {
  const record = requireRecord(input.value, DEEP_CHILD_MATERIAL_CONTRACT_ID);
  return {
    childRunId: input.childRunId,
    spec: input.childSpec,
    status: "completed",
    summary: requireString(record.summary, "summary"),
    findings: stringArray(record.findings).slice(0, 8),
    evidenceRefs: stringArray(record.evidenceRefs).slice(0, 16),
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    uncertainty: optionalString(record.uncertainty),
  };
}

/**
 * 解析父层综合 structuredOutput 为 SynthesizedConclusion。
 * 候选取舍（candidateDispositions）解析为 CandidateDisposition 数组。
 */
export function parseDeepSynthesis(input: {
  readonly value: unknown;
  readonly createdAt: string;
  readonly childSummaries: readonly DeepChildSummary[];
}): SynthesizedConclusion {
  const record = requireRecord(input.value, DEEP_SYNTHESIS_CONTRACT_ID);
  const conclusion = requireString(record.conclusion, "conclusion");
  return {
    conclusionId: createId("deep-conclusion"),
    conclusion,
    oneLineRationale: requireString(record.oneLineRationale, "oneLineRationale"),
    keyEvidenceRefs: stringArray(record.keyEvidenceRefs).slice(0, 24),
    candidateDispositions: parseCandidateDispositions(record.candidateDispositions, input.childSummaries),
    mainUncertainty: requireString(record.mainUncertainty, "mainUncertainty"),
    // 综合产出 outputRefs 由结论本身产出；assertNoDirectChildOutputHandoff 在写入前断言
    // 其不等于任何 child outputRefs（FR-005 硬约束）。
    outputRefs: [`synthesis:${conclusion.slice(0, 40)}`],
    source: "ai",
    confidence: clampConfidence(numberOr(record.confidence, 0.5)),
    createdAt: input.createdAt,
  };
}

/**
 * 提取 ModelResponse 的 structuredOutput（json_object 契约）。
 * 若模型返回 textOutput（某些适配器），尝试 JSON.parse；失败则交给解析器 schema 守卫抛错。
 */
export function extractStructuredOutput(response: ModelResponse | undefined): unknown {
  if (response === undefined) {
    return undefined;
  }
  if (response.structuredOutput !== undefined) {
    return response.structuredOutput;
  }
  if (typeof response.textOutput === "string" && response.textOutput.trim().length > 0) {
    try {
      return JSON.parse(response.textOutput);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 本地解析辅助函数（不 import legacy cognitive-work-session-safe.js）
// ---------------------------------------------------------------------------

function requireRecord(value: unknown, contractId: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${contractId}: structuredOutput 必须是 JSON 对象，实际为 ${describeValue(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field}: 必须是非空字符串，实际为 ${describeValue(value)}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function parseDeepAction(value: unknown): DeepDelegationAction {
  if (typeof value === "string" && (DEEP_DELEGATION_ACTIONS as readonly string[]).includes(value)) {
    return value as DeepDelegationAction;
  }
  throw new Error(`deep decision action 必须是六动作之一，实际为 ${describeValue(value)}`);
}

function parseDeepChildSpecs(value: unknown): readonly DeepChildSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const record = requireRecord(item, `childSpecs[${index}]`);
    const specId = optionalString(record.specId) ?? `deep-child-${index + 1}`;
    return {
      specId,
      displayName: optionalString(record.displayName) ?? `Deep Child ${index + 1}`,
      role: optionalString(record.role) ?? `deep_child_${index + 1}`,
      objective: optionalString(record.objective) ?? "Explore the goal from this child's angle.",
      allowedTools: stringArray(record.allowedTools),
      inputRefs: stringArray(record.inputRefs),
    };
  });
}

function parseCandidateDispositions(
  value: unknown,
  childSummaries: readonly DeepChildSummary[],
): readonly CandidateDisposition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownChildIds = new Set(childSummaries.map((child) => child.childRunId));
  return value.map((item, index) => {
    const record = requireRecord(item, `candidateDispositions[${index}]`);
    const candidateId = optionalString(record.candidateId) ?? `candidate-${index + 1}`;
    return {
      candidateId,
      label: optionalString(record.label) ?? candidateId,
      selected: Boolean(record.selected),
      reason: optionalString(record.reason) ?? (knownChildIds.has(candidateId) ? "Adopted." : "Not adopted."),
    };
  });
}

function taskSoilContextSummary(taskSoil: TaskSoil): string {
  const refs = taskSoil.contextRefs.map((ref) => `${ref.kind}:${ref.ref}`);
  return [
    `taskSoil:${taskSoil.taskSoilId}`,
    taskSoil.goalId ? `goal:${taskSoil.goalId}` : "",
    taskSoil.traceId ? `trace:${taskSoil.traceId}` : "",
    ...refs,
  ].filter((segment) => segment.length > 0).join(", ");
}

function formatCorrectionContext(correctionContext: readonly string[] | undefined): string {
  if (correctionContext === undefined) {
    return "";
  }
  const entries = correctionContext
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return "";
  }
  const lines = entries.map((entry, index) => `  ${index + 1}. ${entry}`).join("\n");
  return [`User corrections / supplementary context (必须据此调整本轮派生与综合方向):`, lines].join("\n");
}

function formatChildSummary(child: DeepChildSummary, index: number): string {
  const confidence = child.confidence !== undefined ? ` (confidence=${child.confidence})` : "";
  const uncertainty = child.uncertainty !== undefined ? `\n      uncertainty: ${child.uncertainty}` : "";
  return [
    `  ${index + 1}. [${child.childRunId}] ${child.spec.displayName} (${child.spec.role})${confidence}`,
    `      summary: ${child.summary}`,
    `      findings: ${child.findings.join("; ") || "(none)"}`,
    `      evidenceRefs: ${child.evidenceRefs.join(", ") || "(none)"}`,
    uncertainty,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 类型再导出（供消费方按需引用）
// ---------------------------------------------------------------------------

export type { ModelMessage };
