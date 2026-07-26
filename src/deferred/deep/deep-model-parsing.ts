import type { ModelResponse } from "../../domain/intelligence/contracts.js";
import { createId } from "../../kernel/id.js";
import type {
  CandidateDisposition,
  ChildAgentRunParentReview,
  DeepChildOperation,
  DeepChildSpec,
  DeepChildSummary,
  DeepDelegationAction,
  DeepDelegationDecision,
  DeepIntakeDecisionAction,
  DeepIntakeTurn,
  SynthesizedConclusion,
} from "./contracts.js";
import { DEEP_DELEGATION_ACTIONS } from "./contracts.js";
import {
  DEEP_CHILD_MATERIAL_CONTRACT_ID,
  DEEP_DECISION_CONTRACT_ID,
  DEEP_DIRECT_ANSWER_CONTRACT_ID,
  DEEP_INTAKE_CONTRACT_ID,
  DEEP_SYNTHESIS_CONTRACT_ID,
} from "./deep-model-contracts.js";
export function parseDeepIntake(input: {
  readonly value: unknown;
  readonly userMessage: string;
  readonly createdAt: string;
}): DeepIntakeTurn {
  const record = requireRecord(input.value, DEEP_INTAKE_CONTRACT_ID);
  const action = parseDeepIntakeAction(record.action);
  const assistantMessage = requireString(record.assistantMessage, "assistantMessage");
  const normalizedObjective = optionalString(record.normalizedObjective);
  const plan = optionalString(record.plan);
  if (action === "start_collaboration" && normalizedObjective === undefined) {
    throw new Error("deep intake start_collaboration 必须给出 normalizedObjective");
  }
  if (action === "start_collaboration" && plan === undefined) {
    throw new Error("deep intake start_collaboration 必须给出 plan");
  }
  return {
    turnId: createId("deep-intake"),
    userMessage: input.userMessage,
    assistantMessage,
    action,
    normalizedObjective,
    plan,
    uncertainty: optionalString(record.uncertainty),
    confidence: clampConfidence(numberOr(record.confidence, 0.2)),
    createdAt: input.createdAt,
  };
}

/**
 * 解析 manager 决策 structuredOutput 为 DeepDelegationDecision。
 * schema 守卫：动作必须是 manager 动作集之一；置信度裁剪到 [0,1]。
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
    childOperations: parseDeepChildOperations(record.childOperations),
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

function optionalRoundLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
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
  throw new Error(`deep decision action 必须是 manager 动作集之一，实际为 ${describeValue(value)}`);
}

function parseDeepIntakeAction(value: unknown): DeepIntakeDecisionAction {
  if (value === "ask_user" || value === "direct_answer" || value === "start_collaboration") {
    return value;
  }
  throw new Error(`deep intake action 必须是 ask_user/direct_answer/start_collaboration，实际为 ${describeValue(value)}`);
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
      displayName: optionalString(record.displayName) ?? `子 Agent ${index + 1}`,
      role: optionalString(record.role) ?? `deep_child_${index + 1}`,
      objective: optionalString(record.objective) ?? "Explore the goal from this child's angle.",
      allowedTools: stringArray(record.allowedTools),
      inputRefs: stringArray(record.inputRefs),
      maxModelRounds: optionalRoundLimit(record.maxModelRounds),
      maxToolRounds: optionalRoundLimit(record.maxToolRounds),
    };
  });
}

function parseDeepChildOperations(value: unknown): readonly DeepChildOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      const record = requireRecord(item, `childOperations[${index}]`);
      return {
        childRunId: requireString(record.childRunId, `childOperations[${index}].childRunId`),
        review: parseDeepChildOperationReview(record, index),
        instruction: requireString(record.instruction, `childOperations[${index}].instruction`),
      };
    });
}

function parseDeepChildOperationReview(
  operationRecord: Record<string, unknown>,
  operationIndex: number,
): ChildAgentRunParentReview | undefined {
  const rawReview = operationRecord.review;
  const reviewRecord =
    rawReview === undefined
      ? operationRecord
      : requireRecord(rawReview, `childOperations[${operationIndex}].review`);
  const reason =
    optionalString(reviewRecord.reason) ??
    optionalString(reviewRecord.reviewReason);
  if (reason === undefined) {
    return undefined;
  }
  const decision = parseChildReviewDecision(
    optionalString(reviewRecord.decision) ??
    optionalString(reviewRecord.reviewDecision),
  );
  const confidenceValue = reviewRecord.confidence ?? reviewRecord.reviewConfidence;
  return {
    decision,
    reason,
    evidenceRefs: stringArray(reviewRecord.evidenceRefs ?? reviewRecord.reviewEvidenceRefs),
    confidence: confidenceValue === undefined ? undefined : clampConfidence(numberOr(confidenceValue, 0.2)),
  };
}

function parseChildReviewDecision(value: string | undefined): ChildAgentRunParentReview["decision"] {
  switch (value) {
    case "accepted":
    case "rejected":
    case "needs_followup":
      return value;
    default:
      return "needs_followup";
  }
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
