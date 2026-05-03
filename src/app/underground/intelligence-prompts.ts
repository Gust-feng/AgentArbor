import type { Constraint } from "../../domain/contracts.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { GoalIntentProfile, RootletClusterPlan } from "../../domain/underground/index.js";
import { getUndergroundRootletCandidateAdviceContract } from "./intelligence-contracts.js";

export type BuildUndergroundRootletCandidateAdviceMessagesInput = {
  readonly goal: string;
  readonly goalIntentProfile: GoalIntentProfile;
  readonly cluster: RootletClusterPlan;
  readonly constraints: readonly Constraint[];
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
        `You are the ${input.cluster.kind} underground rootlet for AgentArbor.`,
        "Return JSON only. The top-level object must contain a candidates array.",
        "Each candidate must follow this kind-specific output contract:",
        candidateShape,
        "AI output is candidate advice only. It must not approve a Direction Handoff, bypass CandidatePool, bypass Convergence Judge, or weaken hard constraints.",
        "Use refs and concise summaries. Do not inline Soil asset body content or secrets.",
      ].join("\n"),
      ref: "docs/开发指南/04-模型与契约/08-智能通道契约.md",
    },
    {
      role: "user",
      content: [
        `Raw goal: ${input.goal}`,
        "",
        "GoalIntentProfile:",
        `- goalId: ${input.goalIntentProfile.goalId}`,
        `- goalStatement: ${input.goalIntentProfile.goalStatement}`,
        `- keyConcepts: ${formatList(input.goalIntentProfile.keyConcepts)}`,
        `- nonGoals: ${formatList(input.goalIntentProfile.nonGoals)}`,
        `- acceptanceCriteria: ${formatList(input.goalIntentProfile.acceptanceCriteria)}`,
        `- assumptions: ${formatList(input.goalIntentProfile.assumptions)}`,
        `- unknowns: ${formatList(input.goalIntentProfile.unknowns)}`,
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
        "",
        "Return up to the cluster budget. Prefer distinct candidates that can be judged later.",
      ].join("\n"),
      ref: input.goalIntentProfile.goalId,
    },
  ];
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
