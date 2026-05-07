import type { Constraint } from "../../domain/contracts.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { GoalIntentProfile, RootletClusterPlan } from "../../domain/underground/index.js";
import { getUndergroundRootletCandidateAdviceContract } from "./intelligence-contracts.js";

export type SoilRefSummary = {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
};

export type SiblingRootletSummary = {
  readonly kind: string;
  readonly summary: string;
};

export type BuildUndergroundRootletCandidateAdviceMessagesInput = {
  readonly goal: string;
  readonly goalIntentProfile: GoalIntentProfile;
  readonly cluster: RootletClusterPlan;
  readonly constraints: readonly Constraint[];
  readonly soilRefs?: readonly SoilRefSummary[];
  readonly historicalPathBias?: string;
  readonly siblingRootletSummaries?: readonly SiblingRootletSummary[];
};

export function buildUndergroundRootletCandidateAdviceMessages(
  input: BuildUndergroundRootletCandidateAdviceMessagesInput
): readonly ModelMessage[] {
  const adviceContract = getUndergroundRootletCandidateAdviceContract(input.cluster.kind);
  const candidateShape = adviceContract.candidateFields
    .map((field) => `- ${field.name} (${field.type}): ${field.description}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        `You are the ${input.cluster.kind} underground rootlet for AgentArbor — an AI-native AgentApp incubation platform where goals are explored by an underground agent cluster before becoming aboveground projects.`,
        "",
        "Return JSON only. The top-level object must contain a candidates array.",
        "Each candidate must follow this kind-specific output contract:",
        candidateShape,
        "",
        "QUALITY REQUIREMENTS — your output is judged by a Convergence Judge that compares all rootlet candidates:",
        "- Every candidate MUST be specific, actionable, and evidence-based — vague or generic advice will be rejected.",
        "- Candidates MUST be distinct from each other — do not produce the same idea with different wording.",
        "- For option candidates: include concrete tradeoffs, applicability conditions, and what makes this option better/worse than alternatives.",
        "- For evidence candidates: cite real sources (research refs, code patterns, case studies) — do not fabricate citations.",
        "- For risk candidates: describe specific failure scenarios with probability and impact, not generic warnings.",
        "- For constraint candidates: identify which hard constraints are at stake and propose concrete mitigation.",
        "",
        "Use the model-visible information actions `search` and `read` to gather real evidence before producing candidates.",
        "Classify information needs before tool use: real-world cases, implementation approaches, project state, technical docs, existing packages, known issues, and historical similar runs.",
        "`search` returns research refs and short snippets; `read` expands a selected ref or URL into a truncated safe preview.",
        "Research workflow: identify the information need, always search before speculating, read the most relevant ref before relying on it, cite research:* refs in candidate sourceRefs/evidenceRefs, and stop when the tool reports no-provider/stub instead of inventing facts.",
        "Use research refs, model refs, tool refs, and concise summaries. Do not inline Soil asset body content, raw provider output, full page text, prompts, or secrets.",
        "",
        "BOUNDARIES — AI output is candidate advice only. It must not:",
        "- Approve or finalize a Direction Handoff (that is the Convergence Judge's job)",
        "- Bypass CandidatePool or Convergence Judge stages",
        "- Weaken or remove hard constraints",
        "- Commit to implementation details that belong to Aboveground execution",
      ].join("\n"),
      ref: "docs/开发指南/04-模型与契约/08-智能通道契约.md",
    },
    {
      role: "user",
      content: buildUserPromptContent(input),
      ref: input.goalIntentProfile.goalId,
    },
  ];
}

function buildUserPromptContent(input: BuildUndergroundRootletCandidateAdviceMessagesInput): string {
  const sections: string[] = [
    `Raw goal: ${input.goal}`,
    "",
    "GoalIntentProfile:",
    `- goalId: ${input.goalIntentProfile.goalId}`,
    `- goalStatement: ${input.goalIntentProfile.goalStatement}`,
    `- keyConcepts: ${formatList(input.goalIntentProfile.keyConcepts)}`,
    `- domainConcepts: ${formatList(input.goalIntentProfile.domainConcepts)}`,
    `- nonGoals: ${formatList(input.goalIntentProfile.nonGoals)}`,
    `- acceptanceCriteria: ${formatList(input.goalIntentProfile.acceptanceCriteria)}`,
    `- assumptions: ${formatList(input.goalIntentProfile.assumptions)}`,
    `- unknowns: ${formatList(input.goalIntentProfile.unknowns)}`,
  ];

  if (input.goalIntentProfile.nonGoals.length > 0) {
    sections.push(
      "",
      "NON-GOALS — your candidates must NOT require, depend on, or lead toward these:",
      ...input.goalIntentProfile.nonGoals.map((nonGoal) => `  - ${nonGoal}`),
    );
  }

  if (input.goalIntentProfile.acceptanceCriteria.length > 0) {
    sections.push(
      "",
      "ACCEPTANCE CRITERIA — your candidates must satisfy these to be considered viable:",
      ...input.goalIntentProfile.acceptanceCriteria.map((criterion) => `  - ${criterion}`),
    );
  }

  sections.push(
    "",
    "Constraints summary and ConstraintRefs:",
    formatConstraints(input.constraints),
    "",
    "Rootlet cluster:",
    `- kind: ${input.cluster.kind}`,
    `- clusterId: ${input.cluster.clusterId}`,
    `- objective: ${input.cluster.objective}`,
    `- cluster budget maxCandidateOutputs: ${input.cluster.budget.maxCandidateOutputs}`,
    `- exitCriteria: ${formatList(input.cluster.exitCriteria)}`,
  );

  if (input.soilRefs !== undefined && input.soilRefs.length > 0) {
    sections.push(
      "",
      "Relevant Soil assets (existing project knowledge):",
      ...input.soilRefs.map((ref) => `  - [${ref.kind}] ${ref.id}: ${truncate(normalizeWhitespace(ref.summary), 120)}`),
    );
  }

  if (input.historicalPathBias !== undefined && input.historicalPathBias.trim().length > 0) {
    sections.push(
      "",
      `Historical path bias: ${input.historicalPathBias}`,
    );
  }

  if (input.siblingRootletSummaries !== undefined && input.siblingRootletSummaries.length > 0) {
    sections.push(
      "",
      "Sibling rootlet summaries (other completed rootlet outputs for this goal — use to generate counterpoints, rebuttals, or complementary analysis):",
      ...input.siblingRootletSummaries.map((sibling) => `  - [${sibling.kind}] ${truncate(sibling.summary, 200)}`),
    );
  }

  sections.push(
    "",
    "Return up to the cluster budget. Prefer distinct candidates that can be judged later.",
    "Search for real evidence before producing candidates. Do not speculate when search is available.",
  );

  return sections.join("\n");
}

function formatConstraints(constraints: readonly Constraint[]): string {
  if (constraints.length === 0) {
    return "- none";
  }

  return constraints
    .map((constraint) =>
      [
        `- ConstraintRef ${constraint.id}`,
        `level=${constraint.level}`,
        `gate=${constraint.enforcementGate}`,
        `status=${constraint.status}`,
        `summary=${truncate(normalizeWhitespace(constraint.statement), 160)}`,
      ].join("; ")
    )
    .join("\n");
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join("; ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
