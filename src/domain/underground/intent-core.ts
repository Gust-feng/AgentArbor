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
  { keyword: "认证", concept: "authentication" },
  { keyword: "authentication", concept: "authentication" },
  { keyword: "授权", concept: "authorization" },
  { keyword: "authorization", concept: "authorization" },
  { keyword: "加密", concept: "encryption" },
  { keyword: "encryption", concept: "encryption" },
  { keyword: "隐私", concept: "privacy" },
  { keyword: "privacy", concept: "privacy" },
  { keyword: "故障", concept: "failure" },
  { keyword: "失败", concept: "failure" },
  { keyword: "failure", concept: "failure" },
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
  { keyword: "复用", concept: "reuse" },
  { keyword: "reuse", concept: "reuse" },
  { keyword: "模板", concept: "template" },
  { keyword: "template", concept: "template" },
  { keyword: "组件", concept: "component" },
  { keyword: "component", concept: "component" },
  { keyword: "模块", concept: "module" },
  { keyword: "module", concept: "module" },
];

const EVIDENCE_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "evidence", concept: "evidence" },
  { keyword: "证据", concept: "evidence" },
  { keyword: "validation", concept: "validation" },
  { keyword: "verification", concept: "verification" },
  { keyword: "验证", concept: "verification" },
  { keyword: "acceptance", concept: "acceptance" },
  { keyword: "验收", concept: "acceptance" },
  { keyword: "测试", concept: "testing" },
  { keyword: "test", concept: "testing" },
  { keyword: "检查", concept: "inspection" },
  { keyword: "check", concept: "inspection" },
  { keyword: "监控", concept: "monitoring" },
  { keyword: "monitor", concept: "monitoring" },
  { keyword: "日志", concept: "logging" },
  { keyword: "log", concept: "logging" },
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
  { keyword: "不能", concept: "non_goal" },
  { keyword: "禁止", concept: "non_goal" },
  { keyword: "限制", concept: "restriction" },
];

const COUNTERFACTUAL_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "counterfactual", concept: "counterfactual" },
  { keyword: "alternative", concept: "alternative" },
  { keyword: "why not", concept: "why_not" },
  { keyword: "反驳", concept: "counterfactual" },
  { keyword: "替代", concept: "alternative" },
  { keyword: "备选", concept: "alternative" },
  { keyword: "候选", concept: "candidate" },
  { keyword: "candidate", concept: "candidate" },
];

const UNKNOWN_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "unknown", concept: "unknown" },
  { keyword: "unclear", concept: "unclear" },
  { keyword: "missing", concept: "missing_information" },
  { keyword: "未知", concept: "unknown" },
  { keyword: "不确定", concept: "unclear" },
  { keyword: "待确认", concept: "missing_information" },
  { keyword: "确认", concept: "confirmation" },
  { keyword: "待定", concept: "pending" },
  { keyword: "pending", concept: "pending" },
];

const DOMAIN_KEYWORDS: readonly KeywordHint[] = [
  { keyword: "任务管理", concept: "task_management" },
  { keyword: "task management", concept: "task_management" },
  { keyword: "用户管理", concept: "user_management" },
  { keyword: "user management", concept: "user_management" },
  { keyword: "认证系统", concept: "authentication_system" },
  { keyword: "管理系统", concept: "management_system" },
  { keyword: "管理", concept: "management" },
  { keyword: "系统", concept: "system" },
  { keyword: "平台", concept: "platform" },
  { keyword: "服务", concept: "service" },
  { keyword: "接口", concept: "api" },
  { keyword: "api", concept: "api" },
  { keyword: "数据库", concept: "database" },
  { keyword: "database", concept: "database" },
  { keyword: "前端", concept: "frontend" },
  { keyword: "frontend", concept: "frontend" },
  { keyword: "后端", concept: "backend" },
  { keyword: "backend", concept: "backend" },
  { keyword: "部署", concept: "deployment" },
  { keyword: "deploy", concept: "deployment" },
  { keyword: "工作流", concept: "workflow" },
  { keyword: "workflow", concept: "workflow" },
  { keyword: "智能体", concept: "agent" },
  { keyword: "agent", concept: "agent" },
  { keyword: "应用", concept: "application" },
  { keyword: "application", concept: "application" },
  { keyword: "功能", concept: "feature" },
  { keyword: "feature", concept: "feature" },
  { keyword: "需求", concept: "requirement" },
  { keyword: "requirement", concept: "requirement" },
];

const NEGATION_MARKERS = ["不要", "不需要", "不新增", "不接", "不能", "禁止", "without", "do not", "don't", "no "];
const ACCEPTANCE_MARKERS = ["验收", "通过", "必须", "确保", "acceptance", "must", "should", "ensure"];
const ASSUMPTION_MARKERS = ["假设", "assume", "assuming", "默认", "默认使用"];

export function createGoalIntentProfile(input: CreateGoalIntentProfileInput): GoalIntentProfile {
  const rawGoal = normalizeWhitespace(input.rawGoal);
  const rawConcepts = [
    ...collectKeywordConcepts(rawGoal, RISK_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, ASSET_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, EVIDENCE_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, CONSTRAINT_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, COUNTERFACTUAL_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, UNKNOWN_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, DOMAIN_KEYWORDS),
    ...collectEnglishConcepts(rawGoal),
    ...extractChineseConcepts(rawGoal),
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
    goalStatement: extractGoalStatement(rawGoal),
    keyConcepts: unique(rawConcepts).slice(0, 16),
    nonGoals: unique(nonGoals),
    acceptanceCriteria:
      explicitAcceptance.length > 0
        ? unique(explicitAcceptance)
        : deriveAcceptanceCriteria(rawGoal),
    assumptions:
      explicitAssumptions.length > 0
        ? unique(explicitAssumptions)
        : ["Current Soil constraints remain binding references for this direction."],
    riskHints: unique([
      ...collectKeywordConcepts(rawGoal, RISK_KEYWORDS),
      ...deriveRiskHints(rawGoal),
    ]),
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

function extractChineseConcepts(rawGoal: string): string[] {
  const concepts: string[] = [];
  const chinesePatterns = [
    /[\u4e00-\u9fff]{2,6}(?:系统|平台|服务|接口|模块|组件|功能|应用|工具|框架|引擎|管理器?|处理器?|生成器?)/gu,
    /(?:构建|实现|设计|开发|创建|建立|优化|重构|集成|接入)(?:[\u4e00-\u9fff]{2,10})/gu,
    /(?:用户|任务|数据|消息|事件|配置|权限|认证|授权|验证|测试|监控|日志|部署|工作流|智能体)[\u4e00-\u9fff]{0,6}/gu,
  ];
  for (const pattern of chinesePatterns) {
    const matches = rawGoal.match(pattern);
    if (matches) {
      concepts.push(...matches);
    }
  }
  return concepts.slice(0, 8);
}

function extractGoalStatement(rawGoal: string): string {
  const sentence = firstSentence(rawGoal);
  if (sentence) {
    return sentence;
  }
  return rawGoal;
}

function deriveAcceptanceCriteria(rawGoal: string): string[] {
  const criteria: string[] = [];
  if (includesAnyIgnoreCase(rawGoal, ["构建", "build", "实现", "implement", "创建", "create"])) {
    criteria.push("The system must be built and functional.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["支持", "support", "包含", "include"])) {
    criteria.push("All specified features must be supported.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["测试", "test", "验证", "verify"])) {
    criteria.push("Tests must pass and verification must succeed.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["部署", "deploy", "发布", "release"])) {
    criteria.push("The system must be deployable.");
  }
  if (criteria.length === 0) {
    criteria.push("Direction can be evaluated against the stated goal.");
  }
  return criteria;
}

function deriveRiskHints(rawGoal: string): string[] {
  const hints: string[] = [];
  const sentences = splitSentences(rawGoal);
  for (const sentence of sentences) {
    const isNegated = NEGATION_MARKERS.some((marker) => sentence.toLowerCase().includes(marker.toLowerCase()));
    if (isNegated) {
      continue;
    }
    if (includesAnyIgnoreCase(sentence, ["认证", "authentication", "授权", "authorization"])) {
      hints.push("authentication");
    }
    if (includesAnyIgnoreCase(sentence, ["安全", "security", "加密", "encryption"])) {
      hints.push("security");
    }
    if (includesAnyIgnoreCase(sentence, ["数据库", "database", "持久化", "persistence"])) {
      hints.push("data_persistence");
    }
    if (includesAnyIgnoreCase(sentence, ["外部", "external", "第三方", "third-party", "集成", "integration"])) {
      hints.push("external_dependency");
    }
    if (includesAnyIgnoreCase(sentence, ["性能", "performance", "并发", "concurrent", "高可用", "high availability"])) {
      hints.push("scalability");
    }
  }
  return hints;
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

function includesAnyIgnoreCase(value: string, needles: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
