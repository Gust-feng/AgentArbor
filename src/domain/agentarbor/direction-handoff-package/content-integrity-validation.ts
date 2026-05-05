import type { DirectionHandoffPackage } from "./contracts.js";
import { serializeDirectionHandoffPackageFiles } from "./serialization.js";
import type { AddDirectionHandoffPackageIssue } from "./validation-issues.js";

const GENERIC_HANDOFF_MARKERS = [
  "primary in-memory direction",
  "modular verification-first direction",
  "deferred persistence direction",
  "generic direction",
  "generic workflow",
  "useful agent workflow",
  "useful agent",
  "helpful outputs",
  "clear steps",
  "placeholder",
];

export function validateGoalRelevanceAndFileContent(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
): void {
  validateGoalRelevance(pkg, addIssue);
  validateSerializedFileContent(pkg, addIssue);
}

function validateGoalRelevance(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
): void {
  const handoff = pkg.directionHandoff;
  const goalTerms = extractGoalTerms(handoff.clarifiedGoal);
  if (handoff.status !== "approved" || goalTerms.length === 0) {
    return;
  }

  const goalEchoes = extractGoalEchoes(handoff.clarifiedGoal);
  const retainedOption = handoff.options.find((option) => option.optionId === handoff.decisionRecord.retainedOptionId);
  const sourceCandidateById = new Map(handoff.sourceCandidateRefs.map((candidate) => [candidate.id, candidate]));
  const candidateAndOptionText = goalSpecificText(
    [
      ...handoff.options.map((option) => option.directionSummary),
      ...handoff.sourceCandidateRefs.map((candidate) => candidate.summary ?? ""),
    ],
    goalEchoes
  );
  const retainedText = goalSpecificText(
    [
      retainedOption?.directionSummary ?? "",
      sourceCandidateById.get(handoff.decisionRecord.retainedOptionId)?.summary ?? "",
    ],
    goalEchoes
  );
  const matched = goalTerms.filter((term) => candidateAndOptionText.includes(normalize(term)));
  const retainedMatched = goalTerms.filter((term) => retainedText.includes(normalize(term)));
  if (matched.length === 0) {
    addIssue(
      "HANDOFF_GOAL_RELEVANCE_MISSING",
      "directionHandoff.options",
      "Approved DirectionHandoffPackage must keep at least one option or source candidate related to the clarified goal."
    );
  }
  if (retainedMatched.length === 0) {
    addIssue(
      "HANDOFF_RETAINED_OPTION_GOAL_RELEVANCE_MISSING",
      "directionHandoff.decisionRecord.retainedOptionId",
      "Approved DirectionHandoffPackage retained option must be related to the clarified goal beyond echoing the goal text."
    );
  }

  const genericOnly = handoff.options.some((option) => {
    const summary = stripGoalEchoes(option.directionSummary, goalEchoes);
    return GENERIC_HANDOFF_MARKERS.some((marker) => summary.includes(marker)) &&
      !goalTerms.some((term) => summary.includes(normalize(term)));
  });
  if (genericOnly) {
    addIssue(
      "HANDOFF_TEMPLATE_ONLY_DIRECTION",
      "directionHandoff.options",
      "Approved DirectionHandoffPackage cannot approve template-only direction text without goal-specific concepts."
    );
  }
}

function validateSerializedFileContent(
  pkg: DirectionHandoffPackage,
  addIssue: AddDirectionHandoffPackageIssue
): void {
  const files = serializeDirectionHandoffPackageFiles(pkg);
  for (const [path, content] of Object.entries(files)) {
    if (content.trim().length === 0) {
      addIssue("HANDOFF_SPLIT_FILE_EMPTY", `files.${path}`, `${path} must render non-empty content.`);
    }
  }

  if (pkg.directionHandoff.status !== "approved") {
    return;
  }

  if (pkg.directionHandoff.options.length === 0) {
    addIssue(
      "HANDOFF_OPTIONS_EMPTY",
      "directionHandoff.options",
      "Approved DirectionHandoffPackage must render at least one direction option."
    );
  }
  if (!pkg.directionHandoff.options.some((option) => option.optionId === pkg.directionHandoff.decisionRecord.retainedOptionId)) {
    addIssue(
      "HANDOFF_RETAINED_OPTION_MISSING",
      "directionHandoff.decisionRecord.retainedOptionId",
      "Approved DirectionHandoffPackage retained option must exist in options.json."
    );
  }
  if (pkg.directionHandoff.growthEntry.suggestedFirstWorkflowNodes.length === 0) {
    addIssue(
      "HANDOFF_GROWTH_ENTRY_INCOMPLETE",
      "directionHandoff.growthEntry.suggestedFirstWorkflowNodes",
      "Approved DirectionHandoffPackage must provide Aboveground entry workflow nodes."
    );
  }
  if (!files["direction.md"].includes("## Recommended Direction")) {
    addIssue(
      "HANDOFF_DIRECTION_FILE_INCOMPLETE",
      "files.direction.md",
      "direction.md must render a recommended direction section."
    );
  }
  if (!files["evidence-index.md"].includes("## Source Candidates")) {
    addIssue(
      "HANDOFF_EVIDENCE_INDEX_INCOMPLETE",
      "files.evidence-index.md",
      "evidence-index.md must render source candidates and convergence attribution."
    );
  }
}

function extractGoalTerms(value: string): string[] {
  const english = value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const chinese = value.match(/[\u4e00-\u9fff]{2,8}/gu) ?? [];
  const generic = new Set([
    "agent",
    "agentapp",
    "application",
    "direction",
    "domain",
    "concepts",
    "evidence",
    "goal",
    "target",
    "system",
    "must",
    "should",
    "need",
    "needs",
    "required",
    "require",
    "and",
    "or",
    "the",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "output",
    "outputs",
    "read",
    "reading",
    "extract",
    "extraction",
    "generate",
    "generated",
    "retain",
    "retained",
    "retention",
    "keep",
    "kept",
    "智能体",
    "方向",
    "目标",
    "领域",
    "证据",
  ]);
  return unique([...english, ...chinese].flatMap(expandGoalTerm).filter((term) => !generic.has(term.toLowerCase()))).slice(0, 24);
}

function expandGoalTerm(term: string): string[] {
  const normalized = term.trim();
  if (normalized.length === 0) {
    return [];
  }
  const aliases: Readonly<Record<string, readonly string[]>> = {
    meeting_minutes: ["会议纪要", "纪要整理", "纪要"],
    meeting_transcript: ["会议文本", "会议记录", "转写"],
    action_items: ["行动项"],
    todo_items: ["待办", "todo"],
    todo_generation: ["生成待办", "待办"],
    evidence_traceability: ["保留证据", "证据留存", "溯源"],
    input_reading: ["读取", "导入", "解析"],
    structured_extraction: ["提取", "抽取", "行动项"],
    customer_service_quality_review: ["客服质检", "质检", "评分", "抽检"],
    customer_service: ["客服"],
    quality_review: ["质检", "质量审核"],
    text_processing: ["文本"],
  };
  const parts = normalized.split(/[_\s/-]+/u).filter((part) => part.length >= 3);
  return parts.length === 0
    ? [normalized, ...(aliases[normalized] ?? [])]
    : [normalized, ...(aliases[normalized] ?? []), ...parts];
}

function extractGoalEchoes(value: string): string[] {
  const normalized = normalize(value);
  const targetDomainIndex = normalized.indexOf(" target domain concepts:");
  return unique([
    normalized,
    targetDomainIndex < 0 ? "" : normalized.slice(0, targetDomainIndex),
  ]).filter((term) => term.length > 0);
}

function goalSpecificText(values: readonly string[], goalEchoes: readonly string[]): string {
  return normalize(values.map((value) => stripGoalEchoes(value, goalEchoes)).join(" "));
}

function stripGoalEchoes(value: string, goalEchoes: readonly string[]): string {
  let result = normalize(value);
  for (const echo of goalEchoes) {
    result = result.replaceAll(echo, " ");
  }
  return normalize(result);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
