import type { IntelligenceChannel, ModelBudget } from "../../domain/intelligence/index.js";
import {
  selectSkillsForGoal,
  type AgentSkillDefinition,
  type SkillSelectionResult,
} from "./skill-loader.js";
import { routeSkillsWithModel, type SkillRouterResult } from "./skill-router.js";
import { validateSkillEvalArtifacts, type SkillEvalCase } from "./skill-eval-artifact.js";

export type SkillRoutingEvalStatus = "passed" | "failed" | "skipped";

export type SkillRoutingEvalCaseResult = {
  readonly skillId: string;
  readonly caseId: string;
  readonly path: string;
  readonly expectedSelected: boolean;
  readonly actualSelected: boolean;
  readonly status: SkillRoutingEvalStatus;
  readonly selectionSource?: SkillRouterResult["source"];
  readonly fallback?: boolean;
  readonly reason?: string;
};

export type SkillRoutingEvalReport = {
  readonly caseCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly results: readonly SkillRoutingEvalCaseResult[];
};

export type RunSkillRoutingEvalsOptions = {
  readonly skills: readonly AgentSkillDefinition[];
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly limit?: number;
  readonly budget?: ModelBudget;
};

export async function runSkillRoutingEvals(options: RunSkillRoutingEvalsOptions): Promise<SkillRoutingEvalReport> {
  const results: SkillRoutingEvalCaseResult[] = [];
  for (const skill of options.skills) {
    const summary = await validateSkillEvalArtifacts(skill);
    for (const evalCase of summary.cases.filter(isRunnableRoutingCase)) {
      results.push(await runRoutingEvalCase({
        skill,
        evalCase,
        skills: options.skills,
        intelligenceChannel: options.intelligenceChannel,
        limit: options.limit ?? 4,
        budget: options.budget,
      }));
    }
  }
  return {
    caseCount: results.length,
    passedCount: results.filter((result) => result.status === "passed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

async function runRoutingEvalCase(input: {
  readonly skill: AgentSkillDefinition;
  readonly evalCase: SkillEvalCase & { readonly expectedSelected: boolean };
  readonly skills: readonly AgentSkillDefinition[];
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly limit: number;
  readonly budget?: ModelBudget;
}): Promise<SkillRoutingEvalCaseResult> {
  if (input.intelligenceChannel === undefined) {
    return result(input, {
      actualSelected: false,
      status: "skipped",
      reason: "Routing eval requires an intelligence channel.",
    });
  }

  const candidateSelection = selectSkillsForGoal(input.evalCase.goal, input.skills, {
    strategy: "llm",
    limit: input.limit,
  });
  const routerResult = await routeSkillsWithModel({
    goal: input.evalCase.goal,
    catalog: input.skills.map(routerCatalogSkill),
    candidateContexts: candidateSelection.candidateContexts,
    explicitSkillIds: candidateSelection.candidateContexts
      .filter((candidate) => candidate.explicit)
      .map((candidate) => candidate.skillId),
    keywordCandidateSkillIds: keywordCandidateIds(candidateSelection),
    limit: input.limit,
    intelligenceChannel: input.intelligenceChannel,
    callerRef: "skill-routing-eval",
    budget: input.budget,
  });
  const actualSelected = routerResult.selectedSkillIds.includes(input.skill.id);
  return result(input, {
    actualSelected,
    status: actualSelected === input.evalCase.expectedSelected ? "passed" : "failed",
    selectionSource: routerResult.source,
    fallback: routerResult.fallback,
  });
}

function result(
  input: {
    readonly skill: AgentSkillDefinition;
    readonly evalCase: SkillEvalCase & { readonly expectedSelected: boolean };
  },
  facts: {
    readonly actualSelected: boolean;
    readonly status: SkillRoutingEvalStatus;
    readonly selectionSource?: SkillRouterResult["source"];
    readonly fallback?: boolean;
    readonly reason?: string;
  }
): SkillRoutingEvalCaseResult {
  return {
    skillId: input.skill.id,
    caseId: input.evalCase.id,
    path: input.evalCase.path,
    expectedSelected: input.evalCase.expectedSelected,
    actualSelected: facts.actualSelected,
    status: facts.status,
    selectionSource: facts.selectionSource,
    fallback: facts.fallback,
    reason: facts.reason,
  };
}

function keywordCandidateIds(selection: SkillSelectionResult): readonly string[] {
  return selection.candidateContexts
    .filter((candidate) => candidate.keywordScore > 0)
    .sort((left, right) => right.keywordScore - left.keywordScore)
    .map((candidate) => candidate.skillId);
}

function isRunnableRoutingCase(caseFacts: SkillEvalCase): caseFacts is SkillEvalCase & { readonly expectedSelected: boolean } {
  return caseFacts.kind === "routing" && caseFacts.expectedSelected !== undefined;
}

function routerCatalogSkill(skill: AgentSkillDefinition) {
  return {
    ...skill,
    validationErrors: skill.validationErrors?.map((issue) => issue.message),
  };
}
