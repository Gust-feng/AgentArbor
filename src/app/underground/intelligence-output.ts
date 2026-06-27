/**
 * @deprecated 废弃候选（T4-1 / ADR-0025 deep 一期）— ②' 固定拓扑主体（强耦合 directionHandoffPackage/Plan，不做本期主线）。
 *
 * 替代物：src/app/deep/* DeepRuntime（manager 自由决策循环 → 一层 child 探索 → 父层综合）；
 * 正式入口 POST /api/deep/conversations + /api/deep/conversations/:id/runs。
 *
 * 删除前置条件（闭环4 §8.1 阶段④）：smoke/tests 迁移完成 + 等价能力验证通过 + 无活跃引用。
 * 当前保持运行不阻塞构建；禁止改名/删除（仍被 test/smoke/compat 引用）。
 * 边界：domain/underground 的 AgentLoop/Guard/run tree/事件契约为保留复用抽象，不在退役范围。
 */
import type { RootletClusterKind } from "../../domain/underground/index.js";
import {
  getUndergroundRootletCandidateAdviceContract,
  type UndergroundRootletCandidateFieldContract,
} from "./intelligence-contracts.js";

export type UndergroundRootletCandidateAdviceValue = string | readonly string[];

export type ParsedUndergroundRootletCandidateAdvice = {
  readonly kind: RootletClusterKind;
  readonly summary: string;
  readonly details: Readonly<Record<string, UndergroundRootletCandidateAdviceValue>>;
  readonly sourceIndex: number;
};

export type UndergroundRootletCandidateAdviceParseIssue = {
  readonly code: string;
  readonly message: string;
  readonly path: string;
};

export type ParseUndergroundRootletCandidateAdviceOutputResult = {
  readonly candidates: readonly ParsedUndergroundRootletCandidateAdvice[];
  readonly discardedCount: number;
  readonly issues: readonly UndergroundRootletCandidateAdviceParseIssue[];
};

const MAX_ROOTLET_ADVICE_SUMMARY_FIELD_LENGTH = 180;
const TRUNCATED_MARKER = "... (truncated)";

export function parseUndergroundRootletCandidateAdviceOutput(input: {
  readonly kind: RootletClusterKind;
  readonly output: unknown;
  readonly maxCandidates: number;
}): ParseUndergroundRootletCandidateAdviceOutputResult {
  const contract = getUndergroundRootletCandidateAdviceContract(input.kind);
  const issues: UndergroundRootletCandidateAdviceParseIssue[] = [];
  const record = asRecord(input.output);
  if (record === undefined) {
    return {
      candidates: [],
      discardedCount: 0,
      issues: [issue("ROOTLET_ADVICE_OUTPUT_NOT_OBJECT", "Model output must be an object.", "$")],
    };
  }

  const rawCandidates = record[contract.candidateArrayField];
  if (!Array.isArray(rawCandidates)) {
    return {
      candidates: [],
      discardedCount: 0,
      issues: [
        issue(
          "ROOTLET_ADVICE_CANDIDATES_NOT_ARRAY",
          "Model output candidates field must be an array.",
          contract.candidateArrayField
        ),
      ],
    };
  }

  const maxCandidates = Math.max(0, Math.floor(input.maxCandidates));
  const candidates: ParsedUndergroundRootletCandidateAdvice[] = [];
  let discardedCount = 0;

  rawCandidates.forEach((candidate, index) => {
    if (candidates.length >= maxCandidates) {
      return;
    }

    const parsed = parseCandidate(input.kind, candidate, index, contract.candidateFields);
    if (parsed.candidate === undefined) {
      discardedCount += 1;
      issues.push(...parsed.issues);
      return;
    }
    candidates.push(parsed.candidate);
  });

  return {
    candidates,
    discardedCount,
    issues,
  };
}

export function formatUndergroundRootletCandidateAdviceSummary(
  candidate: ParsedUndergroundRootletCandidateAdvice
): string {
  const summary = formatDetail(candidate.summary);
  switch (candidate.kind) {
    case "option":
      return `${summary} Tradeoffs: ${formatDetail(candidate.details.tradeoffs)}. Applicability: ${formatDetail(candidate.details.applicability)}.`;
    case "risk":
      return `${summary} Impact scope: ${formatDetail(candidate.details.impactScope)}. Severity: ${formatDetail(candidate.details.severity)}. Mitigation: ${formatDetail(candidate.details.mitigation)}.`;
    case "asset_fit":
      return `${summary} Asset refs: ${formatDetail(candidate.details.assetRefs)}. Fit conditions: ${formatDetail(candidate.details.fitConditions)}. Do not apply when: ${formatDetail(candidate.details.doNotApplyWhen)}.`;
    case "evidence":
      return `${summary} Evidence type: ${formatDetail(candidate.details.evidenceType)}. Confidence: ${formatDetail(candidate.details.confidence)}.`;
    case "constraint":
      return `${summary} Constraint level: ${formatDetail(candidate.details.constraintLevel)}. Enforcement gate: ${formatDetail(candidate.details.enforcementGate)}.`;
    case "counterfactual":
      return `${summary} Alternative direction: ${formatDetail(candidate.details.alternativeDirection)}. Why not chosen: ${formatDetail(candidate.details.whyNotChosen)}.`;
  }
}

function parseCandidate(
  kind: RootletClusterKind,
  value: unknown,
  index: number,
  fields: readonly UndergroundRootletCandidateFieldContract[]
): {
  readonly candidate?: ParsedUndergroundRootletCandidateAdvice;
  readonly issues: readonly UndergroundRootletCandidateAdviceParseIssue[];
} {
  const record = asRecord(value);
  const issues: UndergroundRootletCandidateAdviceParseIssue[] = [];
  if (record === undefined) {
    return {
      issues: [
        issue("ROOTLET_ADVICE_CANDIDATE_NOT_OBJECT", "Each candidate must be an object.", `candidates.${index}`),
      ],
    };
  }

  const details: Record<string, UndergroundRootletCandidateAdviceValue> = {};
  for (const field of fields) {
    const parsed = parseField(record[field.name], field, `candidates.${index}.${field.name}`);
    if (parsed.issue !== undefined) {
      issues.push(parsed.issue);
    } else if (parsed.value !== undefined) {
      details[field.name] = parsed.value;
    }
  }

  const summary = details.summary;
  if (issues.length > 0 || typeof summary !== "string") {
    return { issues };
  }

  return {
    candidate: {
      kind,
      summary,
      details,
      sourceIndex: index,
    },
    issues,
  };
}

function parseField(
  value: unknown,
  field: UndergroundRootletCandidateFieldContract,
  path: string
): {
  readonly value?: UndergroundRootletCandidateAdviceValue;
  readonly issue?: UndergroundRootletCandidateAdviceParseIssue;
} {
  if (field.type === "string") {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized.length > 0
      ? { value: normalized }
      : {
          issue: issue(
            "ROOTLET_ADVICE_STRING_FIELD_REQUIRED",
            `Candidate field ${field.name} must be a non-empty string.`,
            path
          ),
        };
  }

  if (!Array.isArray(value)) {
    return {
      issue: issue(
        "ROOTLET_ADVICE_STRING_ARRAY_FIELD_REQUIRED",
        `Candidate field ${field.name} must be a non-empty string array.`,
        path
      ),
    };
  }

  const values = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return values.length > 0
    ? { value: values }
    : {
        issue: issue(
          "ROOTLET_ADVICE_STRING_ARRAY_FIELD_REQUIRED",
          `Candidate field ${field.name} must be a non-empty string array.`,
          path
        ),
      };
}

function formatDetail(value: UndergroundRootletCandidateAdviceValue | undefined): string {
  const formatted = formatRawDetail(value);
  if (formatted.length <= MAX_ROOTLET_ADVICE_SUMMARY_FIELD_LENGTH) {
    return formatted;
  }
  const sliceLength = Math.max(0, MAX_ROOTLET_ADVICE_SUMMARY_FIELD_LENGTH - TRUNCATED_MARKER.length);
  return `${formatted.slice(0, sliceLength)}${TRUNCATED_MARKER}`;
}

function formatRawDetail(value: UndergroundRootletCandidateAdviceValue | undefined): string {
  if (Array.isArray(value)) {
    return value.join("; ");
  }
  if (typeof value === "string") {
    return value;
  }
  return "unspecified";
}

function issue(
  code: string,
  message: string,
  path: string
): UndergroundRootletCandidateAdviceParseIssue {
  return { code, message, path };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}
