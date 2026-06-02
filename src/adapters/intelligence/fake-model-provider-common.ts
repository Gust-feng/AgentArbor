import type { ModelRequest } from "../../domain/intelligence/index.js";

export function fakeRequestContent(request: ModelRequest): string {
  return request.sanitizedMessages.map((message) => message.content).join("\n");
}

export function fakeGoalAnchorFromRequest(request: ModelRequest): string {
  const content = fakeRequestContent(request);
  const rawGoal =
    matchLineValue(content, "Raw goal:") ??
    matchLineValue(content, "Raw user question:") ??
    matchLineValue(content, "Current user message:") ??
    matchLineValue(content, "User message:");
  if (rawGoal !== undefined && rawGoal.length > 0) {
    return truncate(rawGoal, 80);
  }
  const domainConcepts = matchLineValue(content, "- domainConcepts:");
  if (domainConcepts !== undefined && domainConcepts !== "none") {
    return domainConcepts.split(";").map((value) => value.trim()).filter(Boolean).slice(0, 4).join("/");
  }
  return "current goal";
}

export function termsFromGoalAnchor(goalAnchor: string): string[] {
  return [...new Set(
    goalAnchor
      .toLowerCase()
      .split(/[\s.;,，；、/：:()]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length > 1)
  )];
}

export function stripTrailingSentencePunctuation(value: string): string {
  return value.trim().replace(/[。.!！?？]+$/u, "");
}

export function fakeRiskHintsForGoal(goalAnchor: string): string[] {
  const normalized = goalAnchor.toLowerCase();
  const hints: string[] = [];
  if (includesAny(normalized, ["risk", "风险", "safe", "安全", "security", "permission", "权限"])) {
    hints.push("risk");
  }
  return hints;
}

export function fakeConstraintHintsForGoal(goalAnchor: string): string[] {
  const normalized = goalAnchor.toLowerCase();
  const hints: string[] = [];
  if (includesAny(normalized, ["constraint", "约束", "must not", "不要", "不接", "不能", "禁止"])) {
    hints.push("goal:constraint");
  }
  return hints;
}

export function fakeUnknownsForGoal(goalAnchor: string): string[] {
  const normalized = goalAnchor.toLowerCase();
  if (includesAny(normalized, ["unknown", "unclear", "missing", "未知", "不确定", "待确认", "确认"])) {
    return ["关键权限、事实或约束边界仍需确认。"];
  }
  return [];
}

export function fakeNonGoalsForGoal(goalAnchor: string): string[] {
  const segments = goalSegments(goalAnchor);
  const explicit = segments.filter((segment) =>
    includesAny(segment.toLowerCase(), ["must not", "do not", "不要", "不需要", "不新增", "不接", "不能", "禁止"])
  );
  return explicit.length > 0 ? explicit : [];
}

export function fakeAssumptionsForGoal(goalAnchor: string): string[] {
  const segments = goalSegments(goalAnchor);
  const explicit = segments.filter((segment) =>
    includesAny(segment.toLowerCase(), ["default", "默认", "assume", "假设"])
  );
  return [
    ...explicit,
    "Fake provider output is deterministic and used only for tests or local demos.",
  ];
}

export function isLightweightQuestion(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  const withoutPunctuation = normalized.replace(/[。.!！?？]+$/u, "").trim();
  if (["hi", "hello", "你好"].includes(withoutPunctuation)) {
    return true;
  }
  if (includesAny(withoutPunctuation, [
    "你是什么模型",
    "你是哪个模型",
    "你是谁",
    "能做什么",
    "可以做什么",
    "会做什么",
    "你能干什么",
    "你能帮我",
    "what model",
    "which model",
    "who are you",
    "what can you do",
    "how can you help",
  ])) {
    return true;
  }
  if (isFollowUpQuestion(withoutPunctuation)) {
    return true;
  }
  if (normalized.length <= 48 && /[?？]$/u.test(normalized)) {
    return !includesAny(normalized, ["分析", "调研", "生成报告", "项目", "仓库", "代码", "优化方向", "方案"]);
  }
  return false;
}

export function shouldUpgradeToWorkSession(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  if (isLightweightQuestion(goalAnchor)) {
    return false;
  }
  if (includesAny(normalized, [
    "分析",
    "调研",
    "仓库",
    "repo",
    "repository",
    "项目",
    "project",
    "代码",
    "codebase",
    "重构",
    "refactor",
    "实现",
    "implement",
    "修复",
    "fix",
    "优化",
    "optimiz",
    "报告",
    "report",
    "文档",
    "document",
    "方案",
    "plan",
    "工作流",
    "workflow",
    "文件",
    "网页",
    "tool",
    "工具",
    "验证",
    "verify",
  ])) {
    return true;
  }
  if (includesAny(normalized, ["写", "生成", "create", "build", "draft", "整理"])) {
    return normalized.length > 28;
  }
  return false;
}

export function needsLightToolAnswer(goalAnchor: string): boolean {
  const normalized = goalAnchor.toLowerCase().trim();
  return includesAny(normalized, [
    "读这个网页",
    "读取这个网页",
    "总结这个网页",
    "看这个网页",
    "读取文件",
    "读文件",
    "总结文件",
    "搜一下",
    "查一下",
    "read this page",
    "summarize this page",
    "read this file",
    "summarize this file",
    "search this topic",
  ]);
}

export function buildFakeReportTitle(goalAnchor: string): string {
  const text = goalAnchor.trim();
  if (text.length === 0) {
    return "AgentArbor 工作会话结果报告";
  }
  if (includesAny(text.toLowerCase(), ["仓库", "项目", "project", "repo", "代码", "codebase"])) {
    return `${truncate(text, 24)}：项目分析与优化建议`;
  }
  return `${truncate(text, 28)}：任务结果报告`;
}

export function isFollowUpQuestion(value: string): boolean {
  if (value.length > 80) {
    return false;
  }
  return includesAny(value, [
    "继续解释",
    "继续说",
    "展开说",
    "详细说",
    "再说说",
    "解释一下",
    "什么意思",
    "为什么",
    "那你",
    "这个",
    "上面",
    "刚才",
    "继续",
    "more detail",
    "explain more",
    "go on",
  ]);
}

export function includesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLowerCase()));
}

export function matchLineValue(content: string, prefix: string): string | undefined {
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith(prefix));
  return line?.slice(line.indexOf(prefix) + prefix.length).trim();
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function goalSegments(goalAnchor: string): string[] {
  return goalAnchor
    .split(/[。.!！?？;；,，]/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
