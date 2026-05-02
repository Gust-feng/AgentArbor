import type { Constraint } from "../constraints.js";
import type { RootletClusterKind } from "./radial-growth.js";

export type GoalIntentProfile = {
  goalId: string;
  rawGoal: string;
  goalStatement: string;
  keyConcepts: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  assumptions: string[];
  riskHints: string[];
  constraintHints: string[];
  unknowns: string[];
  createdAt: string;
};

export type CreateGoalIntentProfileInput = {
  goalId: string;
  rawGoal: string;
  constraints: readonly Constraint[];
  createdAt?: string;
};

type KeywordHint = {
  keyword: string;
  concept: string;
};

const RISK_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "risk", concept: "risk" },
  { keyword: "风险", concept: "risk" },
  { keyword: "safe", concept: "safety" },
  { keyword: "安全", concept: "safety" },
  { keyword: "permission", concept: "permission" },
  { keyword: "权限", concept: "permission" },
  { keyword: "cost", concept: "cost" },
  { keyword: "成本", concept: "cost" },
];

const ASSET_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "asset", concept: "asset" },
  { keyword: "资产", concept: "asset" },
  { keyword: "capability", concept: "capability" },
  { keyword: "能力", concept: "capability" },
  { keyword: "soil", concept: "soil" },
  { keyword: "土壤", concept: "soil" },
  { keyword: "path bias", concept: "path_bias" },
  { keyword: "路径倾向", concept: "path_bias" },
];

const EVIDENCE_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "evidence", concept: "evidence" },
  { keyword: "证据", concept: "evidence" },
  { keyword: "validation", concept: "validation" },
  { keyword: "verification", concept: "verification" },
  { keyword: "验证", concept: "verification" },
  { keyword: "acceptance", concept: "acceptance" },
  { keyword: "验收", concept: "acceptance" },
];

const CONSTRAINT_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "constraint", concept: "constraint" },
  { keyword: "约束", concept: "constraint" },
  { keyword: "hard constraint", concept: "hard_constraint" },
  { keyword: "硬约束", concept: "hard_constraint" },
  { keyword: "must not", concept: "non_goal" },
  { keyword: "不要", concept: "non_goal" },
  { keyword: "不需要", concept: "non_goal" },
  { keyword: "不新增", concept: "non_goal" },
  { keyword: "不接", concept: "non_goal" },
];

const COUNTERFACTUAL_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "counterfactual", concept: "counterfactual" },
  { keyword: "alternative", concept: "alternative" },
  { keyword: "why not", concept: "why_not" },
  { keyword: "反驳", concept: "counterfactual" },
  { keyword: "替代", concept: "alternative" },
];

const UNKNOWN_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "unknown", concept: "unknown" },
  { keyword: "unclear", concept: "unclear" },
  { keyword: "missing", concept: "missing_information" },
  { keyword: "未知", concept: "unknown" },
  { keyword: "不确定", concept: "unclear" },
  { keyword: "待确认", concept: "missing_information" },
  { keyword: "确认", concept: "confirmation" },
];

const NEGATION_MARKERS = ["不要", "不需要", "不新增", "不接", "不能", "without", "do not", "don't", "no "];
const ACCEPTANCE_MARKERS = ["验收", "通过", "必须", "需要", "确保", "acceptance", "must", "should", "ensure"];
const ASSUMPTION_MARKERS = ["假设", "assume", "assuming", "默认"];

export function createGoalIntentProfile(input: CreateGoalIntentProfileInput): GoalIntentProfile {
  const rawGoal = normalizeWhitespace(input.rawGoal);
  const rawConcepts = [
    ...collectKeywordConcepts(rawGoal, RISK_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, ASSET_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, EVIDENCE_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, CONSTRAINT_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, COUNTERFACTUAL_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, UNKNOWN_KEYWORDS),
    ...collectEnglishConcepts(rawGoal),
  ];
  const nonGoals = collectSentencesByMarkers(rawGoal, NEGATION_MARKERS);
  const explicitAcceptance = collectSentencesByMarkers(rawGoal, ACCEPTANCE_MARKERS);
  const explicitAssumptions = collectSentencesByMarkers(rawGoal, ASSUMPTION_MARKERS);
  const unknowns = collectUnknowns(rawGoal);
  const constraintHints = [
    ...collectKeywordConcepts(rawGoal, CONSTRAINT_KEYWORDS).map((concept) => `goal:${concept}`),
    ...input.constraints.map((constraint) => `soil:${constraint.id}:${constraint.level}:${constraint.enforcementGate}`),
  ];

  return {
    goalId: input.goalId,
    rawGoal,
    goalStatement: firstSentence(rawGoal) ?? rawGoal,
    keyConcepts: unique(rawConcepts).slice(0, 16),
    nonGoals: unique(nonGoals),
    acceptanceCriteria:
      explicitAcceptance.length > 0
        ? unique(explicitAcceptance)
        : ["Direction can be evaluated against the stated goal."],
    assumptions:
      explicitAssumptions.length > 0
        ? unique(explicitAssumptions)
        : ["Current Soil constraints remain binding references for this direction."],
    riskHints: unique(collectKeywordConcepts(rawGoal, RISK_KEYWORDS)),
    constraintHints: unique(constraintHints),
    unknowns,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createDefaultGoalIntentProfile(goalId: string, createdAt = new Date().toISOString()): GoalIntentProfile {
  return {
    goalId,
    rawGoal: "Run the compatibility minimal Underground exploration.",
    goalStatement: "Run the compatibility minimal Underground exploration.",
    keyConcepts: ["option", "risk", "asset", "evidence", "constraint", "counterfactual"],
    nonGoals: [],
    acceptanceCriteria: ["Compatibility path keeps all historical rootlet clusters available."],
    assumptions: ["No raw goal was supplied, so compatibility exploration remains broad."],
    riskHints: ["risk"],
    constraintHints: ["goal:constraint"],
    unknowns: [],
    createdAt,
  };
}

export function selectRootletClusterKindsForGoalIntent(profile: GoalIntentProfile): RootletClusterKind[] {
  const selected = new Set<RootletClusterKind>(["option"]);
  const rawGoal = profile.rawGoal.toLowerCase();
  const hasGoalConstraintSignal =
    profile.constraintHints.some((hint) => hint.startsWith("goal:")) || profile.nonGoals.length > 0;
  const hasEvidenceSignal = hasAnyKeyword(rawGoal, EVIDENCE_KEYWORDS);
  const hasAssetSignal = hasAnyKeyword(rawGoal, ASSET_KEYWORDS);
  const hasCounterfactualSignal = hasAnyKeyword(rawGoal, COUNTERFACTUAL_KEYWORDS);
  const hasPermissionUnknown = profile.unknowns.some((unknown) =>
    includesAny(unknown.toLowerCase(), ["permission", "权限", "hard constraint", "硬约束", "constraint", "约束"])
  );

  if (profile.riskHints.length > 0) {
    selected.add("risk");
  }
  if (hasAssetSignal) {
    selected.add("asset_fit");
  }
  if (hasEvidenceSignal || (profile.unknowns.length > 0 && !hasPermissionUnknown)) {
    selected.add("evidence");
  }
  if (hasGoalConstraintSignal || hasPermissionUnknown) {
    selected.add("constraint");
  }
  if (hasCounterfactualSignal) {
    selected.add("counterfactual");
  }

  return [...selected];
}

export function hasStopIntent(profile: GoalIntentProfile): boolean {
  return includesAny(profile.rawGoal.toLowerCase(), [
    "stop",
    "stopped",
    "no viable",
    "no candidate",
    "停止",
    "终止",
    "无候选",
    "没有可用候选",
  ]);
}

function collectUnknowns(rawGoal: string): string[] {
  const sentences = collectSentencesByMarkers(rawGoal, UNKNOWN_KEYWORDS.map((hint) => hint.keyword));
  if (rawGoal.includes("?") || rawGoal.includes("？")) {
    sentences.push(firstSentence(rawGoal) ?? rawGoal);
  }
  return unique(sentences);
}

function collectKeywordConcepts(rawGoal: string, hints: readonly KeywordHint[]): string[] {
  const normalized = rawGoal.toLowerCase();
  return hints.filter((hint) => normalized.includes(hint.keyword.toLowerCase())).map((hint) => hint.concept);
}

function collectEnglishConcepts(rawGoal: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "without",
    "into",
    "that",
    "this",
    "only",
    "need",
    "needs",
    "must",
    "should",
  ]);
  const words = rawGoal
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  return words.filter((word) => !stopWords.has(word)).slice(0, 8);
}

function collectSentencesByMarkers(rawGoal: string, markers: readonly string[]): string[] {
  const normalizedMarkers = markers.map((marker) => marker.toLowerCase());
  return splitSentences(rawGoal).filter((sentence) =>
    normalizedMarkers.some((marker) => sentence.toLowerCase().includes(marker))
  );
}

function splitSentences(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/[\n。；;.!！]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function firstSentence(value: string): string | undefined {
  return splitSentences(value)[0];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasAnyKeyword(value: string, hints: readonly KeywordHint[]): boolean {
  return hints.some((hint) => value.includes(hint.keyword.toLowerCase()));
}

function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
