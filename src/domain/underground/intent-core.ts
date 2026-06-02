import type { Constraint } from "../constraints.js";
import type { RootletClusterKind } from "./rootlet-contracts.js";

export type GoalIntentProfile = {
  goalId: string;
  rawGoal: string;
  goalStatement: string;
  keyConcepts: string[];
  domainConcepts: string[];
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
  { keyword: "质检", concept: "quality_risk" },
  { keyword: "质量", concept: "quality_risk" },
  { keyword: "证据保留", concept: "evidence_traceability_risk" },
  { keyword: "会议文本", concept: "sensitive_text_risk" },
  { keyword: "客服", concept: "customer_interaction_risk" },
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
  { keyword: "纪要", concept: "meeting_minutes_evidence" },
  { keyword: "行动项", concept: "action_item_evidence" },
  { keyword: "待办", concept: "todo_evidence" },
  { keyword: "质检", concept: "quality_review_evidence" },
  { keyword: "评分", concept: "scoring_evidence" },
  { keyword: "抽检", concept: "sampling_evidence" },
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
  { keyword: "保留证据", concept: "evidence_retention_constraint" },
  { keyword: "会议文本", concept: "input_data_boundary" },
  { keyword: "客服", concept: "customer_data_boundary" },
  { keyword: "质检", concept: "quality_policy_boundary" },
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
  { keyword: "会议纪要", concept: "meeting_minutes" },
  { keyword: "会议文本", concept: "meeting_transcript" },
  { keyword: "行动项", concept: "action_items" },
  { keyword: "待办", concept: "todo_items" },
  { keyword: "客服质检", concept: "customer_service_quality_review" },
  { keyword: "客服", concept: "customer_service" },
  { keyword: "质检", concept: "quality_review" },
  { keyword: "评分", concept: "scoring" },
  { keyword: "工单", concept: "ticketing" },
  { keyword: "对话", concept: "conversation" },
  { keyword: "文本", concept: "text_processing" },
  { keyword: "提取", concept: "extraction" },
  { keyword: "生成待办", concept: "todo_generation" },
  { keyword: "读取", concept: "input_reading" },
  { keyword: "保留证据", concept: "evidence_traceability" },
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
  { keyword: "AgentApp", concept: "agent_app" },
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
const AGENT_APP_MARKERS = ["agent", "智能体", "AgentApp", "应用", "助手", "机器人"];
const ACTION_MARKERS = ["读取", "提取", "生成", "整理", "分析", "分类", "评分", "保留", "创建", "构建", "实现", "接入", "同步", "输出"];

export function createGoalIntentProfile(input: CreateGoalIntentProfileInput): GoalIntentProfile {
  const rawGoal = normalizeWhitespace(input.rawGoal);
  const domainConcepts = unique([
    ...collectKeywordConcepts(rawGoal, DOMAIN_KEYWORDS),
    ...extractChineseDomainConcepts(rawGoal),
  ]).slice(0, 14);
  const rawConcepts = [
    ...domainConcepts,
    ...collectKeywordConcepts(rawGoal, RISK_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, ASSET_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, EVIDENCE_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, CONSTRAINT_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, COUNTERFACTUAL_KEYWORDS),
    ...collectKeywordConcepts(rawGoal, UNKNOWN_KEYWORDS),
    ...collectEnglishConcepts(rawGoal),
    ...extractChineseConcepts(rawGoal),
  ];
  const nonGoals = collectSentencesByMarkers(rawGoal, NEGATION_MARKERS);
  const explicitAcceptance = collectSentencesByMarkers(rawGoal, ACCEPTANCE_MARKERS);
  const explicitAssumptions = collectSentencesByMarkers(rawGoal, ASSUMPTION_MARKERS);
  const unknowns = collectUnknowns(rawGoal, domainConcepts);
  const constraintHints = [
    ...collectKeywordConcepts(rawGoal, CONSTRAINT_KEYWORDS).map((concept) => `goal:${concept}`),
    ...input.constraints.map((constraint) => `soil:${constraint.id}:${constraint.level}:${constraint.enforcementGate}`),
  ];
  const derivedAcceptanceCriteria = deriveAcceptanceCriteria(rawGoal, domainConcepts);

  return {
    goalId: input.goalId,
    rawGoal,
    goalStatement: extractGoalStatement(rawGoal),
    keyConcepts: unique(rawConcepts).slice(0, 16),
    domainConcepts,
    nonGoals: unique(nonGoals),
    acceptanceCriteria: unique([
      ...explicitAcceptance,
      ...derivedAcceptanceCriteria,
    ]),
    assumptions:
      explicitAssumptions.length > 0
        ? unique(explicitAssumptions)
        : deriveAssumptions(rawGoal, unknowns),
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
    domainConcepts: ["compatibility_underground_exploration"],
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
  const complexGoal = isComplexGoalIntent(profile);
  const agentAppGoal = hasAgentAppSignal(profile);
  const hasGoalConstraintSignal =
    profile.constraintHints.some((hint) => hint.startsWith("goal:")) || profile.nonGoals.length > 0;
  const hasEvidenceSignal = hasAnyKeyword(rawGoal, EVIDENCE_KEYWORDS);
  const hasAssetSignal = hasAnyKeyword(rawGoal, ASSET_KEYWORDS);
  const hasCounterfactualSignal = hasAnyKeyword(rawGoal, COUNTERFACTUAL_KEYWORDS);
  const hasPermissionUnknown = profile.unknowns.some((unknown) =>
    includesAny(unknown.toLowerCase(), ["permission", "权限", "hard constraint", "硬约束", "constraint", "约束"])
  );

  if (profile.riskHints.length > 0 || complexGoal || profile.domainConcepts.includes("quality_review")) {
    selected.add("risk");
  }
  if (hasAssetSignal || complexGoal) {
    selected.add("asset_fit");
  }
  if (hasEvidenceSignal || complexGoal || (profile.unknowns.length > 0 && !hasPermissionUnknown)) {
    selected.add("evidence");
  }
  if (hasGoalConstraintSignal || hasPermissionUnknown || complexGoal || agentAppGoal) {
    selected.add("constraint");
  }
  if (hasCounterfactualSignal || complexGoal) {
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

function collectUnknowns(rawGoal: string, domainConcepts: readonly string[]): string[] {
  const sentences = collectSentencesByMarkers(rawGoal, UNKNOWN_KEYWORDS.map((hint) => hint.keyword));
  if (rawGoal.includes("?") || rawGoal.includes("？")) {
    sentences.push(firstSentence(rawGoal) ?? rawGoal);
  }
  const normalized = rawGoal.toLowerCase();
  const isShortAgentGoal = rawGoal.length <= 24 && includesAny(normalized, AGENT_APP_MARKERS.map((marker) => marker.toLowerCase()));
  if (isShortAgentGoal) {
    sentences.push("输入来源、输出格式、验收标准、权限边界和人工复核方式仍需确认。");
  }
  if (domainConcepts.includes("customer_service_quality_review")) {
    sentences.push("客服质检规则、样本来源、评分维度、证据留存粒度和人工复核边界仍需确认。");
  }
  if (domainConcepts.includes("meeting_minutes") && !includesAny(rawGoal, ["格式", "同步", "权限", "保留多久"])) {
    sentences.push("会议文本来源、证据留存粒度、待办输出格式和同步边界仍需确认。");
  }
  return unique(sentences);
}

function extractChineseDomainConcepts(rawGoal: string): string[] {
  const concepts: string[] = [];
  const domainPatterns: readonly [RegExp, string][] = [
    [/会议[\u4e00-\u9fff]{0,4}(?:纪要|文本|记录|录音|转写)/u, "meeting_minutes"],
    [/(?:行动项|待办|TODO|todo)/iu, "action_items"],
    [/客服[\u4e00-\u9fff]{0,4}(?:质检|评分|审核|抽检)/u, "customer_service_quality_review"],
    [/(?:证据|引用|来源|溯源)[\u4e00-\u9fff]{0,4}(?:保留|留存|追踪|记录)/u, "evidence_traceability"],
    [/(?:读取|导入|解析)[\u4e00-\u9fff]{0,8}(?:文本|文档|记录|数据)/u, "input_reading"],
    [/(?:提取|抽取)[\u4e00-\u9fff]{0,8}(?:行动项|待办|结论|要点|问题)/u, "structured_extraction"],
  ];
  for (const [pattern, concept] of domainPatterns) {
    if (pattern.test(rawGoal)) {
      concepts.push(concept);
    }
  }
  return concepts;
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

function deriveAcceptanceCriteria(rawGoal: string, domainConcepts: readonly string[]): string[] {
  const criteria: string[] = [];
  if (includesAnyIgnoreCase(rawGoal, ["构建", "build", "实现", "implement", "创建", "create"])) {
    criteria.push("The system must be built and functional.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["做一个", "做个", "智能体", "助手"]) || hasAgentAppMarkerInText(rawGoal)) {
    criteria.push("The Plan must describe the target agent role, inputs, outputs, evidence boundary, and assumptions.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["支持", "support", "包含", "include"])) {
    criteria.push("All specified features must be supported.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["读取", "read", "导入", "解析"])) {
    criteria.push("Input reading requirements must identify the source material and permission boundary.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["提取", "extract", "抽取"])) {
    criteria.push("Extraction output must preserve the requested structured items.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["生成", "generate", "创建"])) {
    criteria.push("Generated outputs must be explicit enough for Aboveground planning and verification.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["保留证据", "证据", "evidence"])) {
    criteria.push("Evidence references must be retained so each output can be traced back to source material.");
  }
  if (domainConcepts.includes("meeting_minutes")) {
    criteria.push("Meeting-minutes handoff must cover transcript ingestion, summary structure, action item extraction, todo generation, and evidence retention.");
  }
  if (domainConcepts.includes("customer_service_quality_review")) {
    criteria.push("Customer-service QA handoff must cover sample source, scoring dimensions, issue evidence, review workflow, and human escalation.");
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

function deriveAssumptions(rawGoal: string, unknowns: readonly string[]): string[] {
  const assumptions = ["Current Soil constraints remain binding references for this direction."];
  if (unknowns.length > 0) {
    assumptions.push("Unspecified details remain non-blocking assumptions unless Convergence Judge marks them as requiring user clarification.");
  }
  if (includesAnyIgnoreCase(rawGoal, ["智能体", "助手"]) || hasAgentAppMarkerInText(rawGoal)) {
    assumptions.push("The requested agent is a future desktop-agent direction, not an already governed Capability Asset.");
  }
  return assumptions;
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

function hasAgentAppSignal(profile: GoalIntentProfile): boolean {
  return hasAgentAppMarkerInText(profile.rawGoal);
}

function isComplexGoalIntent(profile: GoalIntentProfile): boolean {
  const rawGoal = profile.rawGoal.toLowerCase();
  const actionCount = ACTION_MARKERS.filter((marker) => rawGoal.includes(marker.toLowerCase())).length;
  const hasListShape = /[、,，;；]/u.test(profile.rawGoal);
  const hasAgentSignal = hasAgentAppSignal(profile);
  const highSignalDomainConceptCount = profile.domainConcepts.filter(
    (concept) => !["agent", "agent_app", "application"].includes(concept)
  ).length;
  const hasRichConcepts = highSignalDomainConceptCount >= 3;
  const shortGoal = profile.rawGoal.length <= 24;
  return (hasAgentSignal && !shortGoal && (actionCount >= 3 || hasListShape || hasRichConcepts)) || actionCount >= 4;
}

function hasAgentAppMarkerInText(value: string): boolean {
  return /\bagent\b|\bagentapp\b/iu.test(value) || includesAny(value, ["智能体", "助手", "机器人"]);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
