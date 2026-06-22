import type { IntelligenceChannel, ModelBudget, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import { loadSkillBodyFacts, type AgentSkillDefinition } from "./skill-loader.js";
import { validateSkillEvalArtifacts, type SkillEvalCase } from "./skill-eval-artifact.js";

export type SkillQualityEvalStatus = "passed" | "failed" | "skipped";

export type SkillQualityEvalCaseResult = {
  readonly skillId: string;
  readonly caseId: string;
  readonly path: string;
  readonly status: SkillQualityEvalStatus;
  readonly checkCount: number;
  readonly withSkillCheckPassedCount: number;
  readonly withoutSkillCheckPassedCount: number;
  readonly requiredDelta?: number;
  readonly actualDelta: number;
  readonly withSkillRequestId?: string;
  readonly withoutSkillRequestId?: string;
  readonly withSkillResponseId?: string;
  readonly withoutSkillResponseId?: string;
  readonly withSkillOutputChars?: number;
  readonly withoutSkillOutputChars?: number;
  readonly skillBodyTruncated?: boolean;
  readonly reason?: string;
  readonly failureCode?: "model_request_failed" | "model_response_failed" | "model_validation_failed" | "empty_text";
};

export type SkillQualityEvalReport = {
  readonly evalRunId: string;
  readonly caseCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly results: readonly SkillQualityEvalCaseResult[];
};

export type RunSkillQualityEvalsOptions = {
  readonly skills: readonly AgentSkillDefinition[];
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly budget?: ModelBudget;
  readonly maxSkillBodyChars?: number;
  readonly evalRunId?: string;
  readonly now?: Date;
};

const DEFAULT_MAX_SKILL_BODY_CHARS = 4_000;

export async function runSkillQualityEvals(options: RunSkillQualityEvalsOptions): Promise<SkillQualityEvalReport> {
  const evalRunId = safeEvalRunId(options.evalRunId ?? `skill-quality-eval-${(options.now ?? new Date()).toISOString()}`);
  const results: SkillQualityEvalCaseResult[] = [];
  for (const skill of options.skills) {
    const summary = await validateSkillEvalArtifacts(skill);
    for (const evalCase of summary.cases.filter(isRunnableQualityCase)) {
      results.push(await runQualityEvalCase({
        skill,
        evalCase,
        intelligenceChannel: options.intelligenceChannel,
        budget: options.budget,
        maxSkillBodyChars: options.maxSkillBodyChars ?? DEFAULT_MAX_SKILL_BODY_CHARS,
        evalRunId,
        requestedAt: (options.now ?? new Date()).toISOString(),
      }));
    }
  }
  return {
    evalRunId,
    caseCount: results.length,
    passedCount: results.filter((result) => result.status === "passed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

async function runQualityEvalCase(input: {
  readonly skill: AgentSkillDefinition;
  readonly evalCase: SkillEvalCase & {
    readonly qualityMustInclude: readonly string[];
    readonly qualityMustNotInclude: readonly string[];
  };
  readonly intelligenceChannel?: IntelligenceChannel;
  readonly budget?: ModelBudget;
  readonly maxSkillBodyChars: number;
  readonly evalRunId: string;
  readonly requestedAt: string;
}): Promise<SkillQualityEvalCaseResult> {
  const checkCount = input.evalCase.qualityMustInclude.length + input.evalCase.qualityMustNotInclude.length;
  if (checkCount === 0) {
    return skippedResult(input, { reason: "Quality eval requires at least one mustInclude or mustNotInclude check." });
  }
  if (input.intelligenceChannel === undefined) {
    return skippedResult(input, { checkCount, reason: "Quality eval requires an intelligence channel." });
  }
  if (!input.skill.enabled || input.skill.loadError !== undefined) {
    return skippedResult(input, { checkCount, reason: "Quality eval requires an enabled valid skill." });
  }

  let skillBody: string;
  try {
    skillBody = (await loadSkillBodyFacts(input.skill)).body;
  } catch (error) {
    return skippedResult(input, {
      checkCount,
      reason: `Skill body could not be loaded for quality eval: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const truncated = skillBody.length > input.maxSkillBodyChars;
  const skillBodyForPrompt = truncated ? skillBody.slice(0, input.maxSkillBodyChars) : skillBody;
  const withoutRequest = qualityEvalRequest({
    skill: input.skill,
    evalCase: input.evalCase,
    variant: "without_skill",
    budget: input.budget,
    evalRunId: input.evalRunId,
    requestedAt: input.requestedAt,
  });
  const withRequest = qualityEvalRequest({
    skill: input.skill,
    evalCase: input.evalCase,
    variant: "with_skill",
    skillBody: skillBodyForPrompt,
    bodyTruncated: truncated,
    budget: input.budget,
    evalRunId: input.evalRunId,
    requestedAt: input.requestedAt,
  });

  const withoutEvalResponse = await requestQualityEval(input.intelligenceChannel, withoutRequest);
  const withEvalResponse = await requestQualityEval(input.intelligenceChannel, withRequest);
  if (!withoutEvalResponse.ok) {
    return failedResult(input, {
      checkCount,
      withoutRequest,
      withRequest,
      withoutResponse: withoutEvalResponse.response,
      withResponse: withEvalResponse.response,
      skillBodyTruncated: truncated,
      reason: `withoutSkill quality eval model request failed: ${withoutEvalResponse.reason}`,
      failureCode: withoutEvalResponse.failureCode,
    });
  }
  if (!withEvalResponse.ok) {
    return failedResult(input, {
      checkCount,
      withoutRequest,
      withRequest,
      withoutResponse: withoutEvalResponse.response,
      withResponse: withEvalResponse.response,
      skillBodyTruncated: truncated,
      reason: `withSkill quality eval model request failed: ${withEvalResponse.reason}`,
      failureCode: withEvalResponse.failureCode,
    });
  }
  const withoutResponse = withoutEvalResponse.response;
  const withResponse = withEvalResponse.response;
  const withoutText = responseText(withoutResponse);
  const withText = responseText(withResponse);
  if (withoutResponse.status !== "completed" || withoutText === undefined) {
    return failedResult(input, {
      checkCount,
      withoutRequest,
      withRequest,
      withoutResponse,
      withResponse,
      withoutText,
      withText,
      skillBodyTruncated: truncated,
      reason: "withoutSkill quality eval response did not complete with text output.",
      failureCode: withoutResponse.status !== "completed" ? "model_response_failed" : "empty_text",
    });
  }
  if (withResponse.status !== "completed" || withText === undefined) {
    return failedResult(input, {
      checkCount,
      withoutRequest,
      withRequest,
      withoutResponse,
      withResponse,
      withoutText,
      withText,
      skillBodyTruncated: truncated,
      reason: "withSkill quality eval response did not complete with text output.",
      failureCode: withResponse.status !== "completed" ? "model_response_failed" : "empty_text",
    });
  }

  const withoutPassed = passedCheckCount(input.evalCase, withoutText);
  const withPassed = passedCheckCount(input.evalCase, withText);
  const requiredDelta = input.evalCase.qualityMinDelta;
  const actualDelta = withPassed - withoutPassed;
  const passed = withPassed === checkCount && (requiredDelta === undefined || actualDelta >= requiredDelta);
  return {
    skillId: input.skill.id,
    caseId: input.evalCase.id,
    path: input.evalCase.path,
    status: passed ? "passed" : "failed",
    checkCount,
    withSkillCheckPassedCount: withPassed,
    withoutSkillCheckPassedCount: withoutPassed,
    requiredDelta,
    actualDelta,
    withoutSkillRequestId: withoutRequest.requestId,
    withSkillRequestId: withRequest.requestId,
    withoutSkillResponseId: withoutResponse.responseId,
    withSkillResponseId: withResponse.responseId,
    withoutSkillOutputChars: withoutText.length,
    withSkillOutputChars: withText.length,
    skillBodyTruncated: truncated,
    reason: passed ? undefined : "withSkill output did not satisfy all quality checks or required delta.",
  };
}

function qualityEvalRequest(input: {
  readonly skill: AgentSkillDefinition;
  readonly evalCase: SkillEvalCase;
  readonly variant: "with_skill" | "without_skill";
  readonly skillBody?: string;
  readonly bodyTruncated?: boolean;
  readonly budget?: ModelBudget;
  readonly evalRunId: string;
  readonly requestedAt: string;
}): ModelRequest {
  const withSkill = input.variant === "with_skill";
  const requestId = [
    "skill-quality-eval",
    input.evalRunId,
    input.skill.id,
    input.evalCase.id,
    input.variant,
  ].map(safeIdPart).join("-");
  return {
    requestId,
    traceId: `skill-quality-eval:${input.evalRunId}:${input.skill.id}:${input.evalCase.id}`,
    callerRef: "skill-quality-eval",
    purpose: "skill_quality_eval",
    inputRefs: [],
    sanitizedMessages: [
      {
        role: "system",
        content: withSkill
          ? [
            "You are running an offline AgentArbor skill quality eval.",
            "Answer the user goal using the provided skill instructions.",
            "Do not request tools. Do not claim to have executed scripts or read hidden resources.",
            input.bodyTruncated === true ? "The skill body is truncated for this eval request." : "",
            "",
            `Skill name: ${input.skill.name}`,
            `Skill description: ${input.skill.description}`,
            "Skill instructions:",
            input.skillBody ?? "",
          ].filter((line) => line.length > 0).join("\n")
          : [
            "You are running an offline AgentArbor skill quality eval.",
            "Answer the user goal without using any skill instructions.",
            "Do not request tools. Do not claim to have executed scripts or read hidden resources.",
          ].join("\n"),
      },
      {
        role: "user",
        content: input.evalCase.goal,
      },
    ],
    tools: [],
    toolChoice: "none",
    outputContract: {
      contractId: "skill-quality-eval-text",
      outputKind: "explanation",
      format: "text",
      minTextLength: 1,
    },
    constraintRefs: [],
    budget: input.budget ?? {},
    sensitivity: "internal",
    requestedAt: input.requestedAt,
  };
}

async function requestQualityEval(
  intelligenceChannel: IntelligenceChannel,
  request: ModelRequest
): Promise<{
  readonly ok: true;
  readonly response: ModelResponse;
} | {
  readonly ok: false;
  readonly failureCode: "model_request_failed" | "model_validation_failed";
  readonly reason: string;
  readonly response?: ModelResponse;
}> {
  let response: ModelResponse;
  try {
    response = await intelligenceChannel.request(request);
  } catch {
    return {
      ok: false,
      failureCode: "model_request_failed",
      reason: "model request threw",
    };
  }
  const validation = intelligenceChannel.validateResponse(request, response);
  if (validation.status === "failed") {
    return {
      ok: false,
      failureCode: "model_validation_failed",
      reason: "model response validation failed",
      response,
    };
  }
  return { ok: true, response };
}

function passedCheckCount(
  evalCase: SkillEvalCase & {
    readonly qualityMustInclude: readonly string[];
    readonly qualityMustNotInclude: readonly string[];
  },
  output: string
): number {
  let passed = 0;
  for (const token of evalCase.qualityMustInclude) {
    if (output.includes(token)) {
      passed += 1;
    }
  }
  for (const token of evalCase.qualityMustNotInclude) {
    if (!output.includes(token)) {
      passed += 1;
    }
  }
  return passed;
}

function failedResult(
  input: {
    readonly skill: AgentSkillDefinition;
    readonly evalCase: SkillEvalCase;
  },
  facts: {
    readonly checkCount: number;
    readonly withoutRequest: ModelRequest;
    readonly withRequest: ModelRequest;
    readonly withoutResponse?: ModelResponse;
    readonly withResponse?: ModelResponse;
    readonly withoutText?: string;
    readonly withText?: string;
    readonly skillBodyTruncated?: boolean;
    readonly reason: string;
    readonly failureCode?: SkillQualityEvalCaseResult["failureCode"];
  }
): SkillQualityEvalCaseResult {
  return {
    skillId: input.skill.id,
    caseId: input.evalCase.id,
    path: input.evalCase.path,
    status: "failed",
    checkCount: facts.checkCount,
    withSkillCheckPassedCount: facts.withText === undefined ? 0 : passedCheckCountForMaybeQualityCase(input.evalCase, facts.withText),
    withoutSkillCheckPassedCount: facts.withoutText === undefined ? 0 : passedCheckCountForMaybeQualityCase(input.evalCase, facts.withoutText),
    requiredDelta: input.evalCase.qualityMinDelta,
    actualDelta: 0,
    withoutSkillRequestId: facts.withoutRequest.requestId,
    withSkillRequestId: facts.withRequest.requestId,
    withoutSkillResponseId: facts.withoutResponse?.responseId,
    withSkillResponseId: facts.withResponse?.responseId,
    withoutSkillOutputChars: facts.withoutText?.length,
    withSkillOutputChars: facts.withText?.length,
    skillBodyTruncated: facts.skillBodyTruncated,
    reason: facts.reason,
    failureCode: facts.failureCode,
  };
}

function skippedResult(
  input: {
    readonly skill: AgentSkillDefinition;
    readonly evalCase: SkillEvalCase;
  },
  facts: {
    readonly checkCount?: number;
    readonly reason: string;
  }
): SkillQualityEvalCaseResult {
  return {
    skillId: input.skill.id,
    caseId: input.evalCase.id,
    path: input.evalCase.path,
    status: "skipped",
    checkCount: facts.checkCount ?? 0,
    withSkillCheckPassedCount: 0,
    withoutSkillCheckPassedCount: 0,
    actualDelta: 0,
    requiredDelta: input.evalCase.qualityMinDelta,
    reason: facts.reason,
  };
}

function responseText(response: ModelResponse): string | undefined {
  const text = response.textOutput ?? response.assistantMessage?.content;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function isRunnableQualityCase(caseFacts: SkillEvalCase): caseFacts is SkillEvalCase & {
  readonly qualityMustInclude: readonly string[];
  readonly qualityMustNotInclude: readonly string[];
} {
  return (caseFacts.kind === "quality" || caseFacts.kind === "regression") &&
    caseFacts.qualityMustInclude !== undefined &&
    caseFacts.qualityMustNotInclude !== undefined &&
    (caseFacts.qualityMustInclude.length + caseFacts.qualityMustNotInclude.length) > 0;
}

function passedCheckCountForMaybeQualityCase(evalCase: SkillEvalCase, output: string): number {
  if (!isRunnableQualityCase(evalCase)) {
    return 0;
  }
  return passedCheckCount(evalCase, output);
}

function safeIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function safeEvalRunId(value: string): string {
  return safeIdPart(value);
}
