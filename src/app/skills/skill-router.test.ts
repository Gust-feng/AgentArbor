import assert from "node:assert/strict";
import test from "node:test";
import type {
  IntelligenceChannel,
  ModelOutputValidationResult,
  ModelRequest,
  ModelRequestOptions,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import { resetIdsForTests } from "../../kernel/id.js";
import { routeSkillsWithModel, type SkillRouterCatalogSkill } from "./skill-router.js";
import type { SkillCandidateContext } from "./skill-loader.js";

test("routeSkillsWithModel preserves valid explicit skills and asks the model without tools", async () => {
  resetIdsForTests();
  const channel = new TestSkillRouterChannel({
    selectedSkillIds: ["writer"],
    reasons: [{ skillId: "writer", reason: "The goal asks for polished writing.", confidence: 0.82 }],
    confidence: 0.8,
  });

  const result = await routeSkillsWithModel({
    goal: "use $reviewer before writing the release note",
    catalog: [skill("reviewer", { triggers: ["review"] }), skill("writer", { triggers: ["write"] })],
    candidateContexts: [
      context("reviewer", { explicit: true, keywordScore: 4 }),
      context("writer", { keywordScore: 3 }),
    ],
    intelligenceChannel: channel,
    requestId: "skill-router-request-test",
    traceId: "skill-router-trace-test",
    requestedAt: "2026-06-21T00:00:00.000Z",
  });

  assert.deepEqual(result.selectedSkillIds, ["reviewer", "writer"]);
  assert.equal(result.source, "model");
  assert.equal(result.fallback, false);
  assert.equal(result.confidence, 0.8);
  assert.equal(result.selectionReasons[0]?.code, "explicit_invocation");
  assert.equal(result.selectionReasons[1]?.code, "model_selected");
  assert.equal(result.modelCallRef?.requestId, "skill-router-request-test");
  assert.equal(channel.requests.length, 1);
  assert.equal(channel.requests[0]?.purpose, "skill_routing");
  assert.deepEqual(channel.requests[0]?.tools, []);
  assert.equal(channel.requests[0]?.toolChoice, "none");
  assert.equal(JSON.stringify(channel.requests[0]).includes("FULL SKILL BODY"), false);
  assert.equal(JSON.stringify(channel.requests[0]).includes("sourcePath"), false);
  const routerInput = JSON.parse(channel.requests[0]?.sanitizedMessages[1]?.content ?? "{}") as {
    readonly candidates?: readonly { readonly sourceKind?: string }[];
  };
  assert.equal(routerInput.candidates?.some((candidate) => candidate.sourceKind === "project"), true);
});

test("routeSkillsWithModel rejects model-selected missing, disabled, and invalid skills", async () => {
  const channel = new TestSkillRouterChannel({
    selectedSkillIds: ["missing", "disabled", "invalid", "valid"],
    reasons: [
      { skillId: "valid", reason: "Valid candidate.", confidence: 0.7 },
      { skillId: "disabled", reason: "Should be rejected.", confidence: 0.9 },
    ],
    confidence: 0.9,
  });

  const result = await routeSkillsWithModel({
    goal: "review this change",
    catalog: [
      skill("valid", { triggers: ["review"] }),
      skill("disabled", { enabled: false, triggers: ["review"] }),
      skill("invalid", { validationStatus: "invalid", triggers: ["review"] }),
    ],
    candidateContexts: [
      context("valid", { keywordScore: 5 }),
      context("disabled", { keywordScore: 5 }),
      context("invalid", { keywordScore: 5 }),
    ],
    intelligenceChannel: channel,
  });

  assert.deepEqual(result.selectedSkillIds, ["valid"]);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "missing_from_catalog" && reason.skillId === "missing"
  ), true);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "disabled" && reason.skillId === "disabled"
  ), true);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "invalid" && reason.skillId === "invalid"
  ), true);
});

test("routeSkillsWithModel applies selection limit after explicit skills", async () => {
  const channel = new TestSkillRouterChannel({
    selectedSkillIds: ["beta", "gamma"],
    reasons: [
      { skillId: "beta", reason: "Second best.", confidence: 0.7 },
      { skillId: "gamma", reason: "Third best.", confidence: 0.65 },
    ],
    confidence: 0.75,
  });

  const result = await routeSkillsWithModel({
    goal: "use $alpha and route the rest",
    catalog: [skill("alpha"), skill("beta"), skill("gamma")],
    candidateContexts: [
      context("alpha", { explicit: true, keywordScore: 2 }),
      context("beta", { keywordScore: 2 }),
      context("gamma", { keywordScore: 2 }),
    ],
    limit: 2,
    intelligenceChannel: channel,
  });

  assert.deepEqual(result.selectedSkillIds, ["alpha", "beta"]);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "selection_limit" && reason.skillId === "gamma"
  ), true);
});

test("routeSkillsWithModel keeps the highest-precedence duplicate catalog id", async () => {
  const channel = new TestSkillRouterChannel({
    selectedSkillIds: ["shared"],
    reasons: [{ skillId: "shared", reason: "Use the project skill.", confidence: 0.8 }],
    confidence: 0.8,
  });

  const result = await routeSkillsWithModel({
    goal: "review with shared skill",
    catalog: [
      skill("shared", { description: "User skill.", sourceKind: "user", sourceRootId: "user", sourcePrecedence: 10 }),
      skill("shared", { description: "Project skill.", sourceKind: "project", sourceRootId: "project", sourcePrecedence: 100 }),
    ],
    candidateContexts: [context("shared", { keywordScore: 5 })],
    intelligenceChannel: channel,
  });
  const routerInput = JSON.parse(channel.requests[0]?.sanitizedMessages[1]?.content ?? "{}") as {
    readonly candidates?: readonly { readonly description?: string; readonly sourceKind?: string }[];
  };

  assert.deepEqual(result.selectedSkillIds, ["shared"]);
  assert.equal(routerInput.candidates?.[0]?.description, "Project skill.");
  assert.equal(routerInput.candidates?.[0]?.sourceKind, "project");
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "duplicate_catalog_id" && reason.skillId === "shared"
  ), true);
});

test("routeSkillsWithModel excludes disable-model-invocation skills from automatic routing", async () => {
  const channel = new TestSkillRouterChannel({
    selectedSkillIds: ["deploy", "review"],
    reasons: [
      { skillId: "deploy", reason: "Should not be visible to automatic routing.", confidence: 0.9 },
      { skillId: "review", reason: "Review is relevant.", confidence: 0.72 },
    ],
    confidence: 0.7,
  });

  const result = await routeSkillsWithModel({
    goal: "review then maybe deploy",
    catalog: [
      skill("deploy", { disableModelInvocation: true, triggers: ["deploy"] }),
      skill("review", { triggers: ["review"] }),
    ],
    candidateContexts: [
      context("deploy", { keywordScore: 5 }),
      context("review", { keywordScore: 4 }),
    ],
    intelligenceChannel: channel,
  });

  assert.deepEqual(result.selectedSkillIds, ["review"]);
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "model_invocation_disabled" && reason.skillId === "deploy"
  ), true);
  assert.equal(JSON.stringify(channel.requests[0]).includes('"skillId":"deploy"'), false);
});

test("routeSkillsWithModel keeps explicit disable-model-invocation skills selectable", async () => {
  const channel = new TestSkillRouterChannel({
    selectedSkillIds: [],
    reasons: [],
    confidence: 0.4,
  });

  const result = await routeSkillsWithModel({
    goal: "use $deploy",
    catalog: [
      skill("deploy", { disableModelInvocation: true }),
    ],
    candidateContexts: [
      context("deploy", { explicit: true }),
    ],
    intelligenceChannel: channel,
  });

  assert.deepEqual(result.selectedSkillIds, ["deploy"]);
  assert.equal(result.selectionReasons[0]?.code, "explicit_invocation");
});

test("routeSkillsWithModel falls back to explicit and keyword candidates when the model request throws", async () => {
  const channel = new ThrowingSkillRouterChannel(new Error("provider unavailable"));

  const result = await routeSkillsWithModel({
    goal: "use $alpha and review this patch",
    catalog: [skill("alpha"), skill("beta", { triggers: ["review"] }), skill("gamma", { triggers: ["review"] })],
    candidateContexts: [
      context("alpha", { explicit: true, keywordScore: 1 }),
      context("beta", { keywordScore: 8 }),
      context("gamma", { keywordScore: 4 }),
    ],
    limit: 2,
    intelligenceChannel: channel,
    requestId: "skill-router-request-fallback",
    traceId: "skill-router-trace-fallback",
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "model_request_failed");
  assert.deepEqual(result.selectedSkillIds, ["alpha", "beta"]);
  assert.equal(result.modelRequestRef?.requestId, "skill-router-request-fallback");
  assert.equal(result.modelCallRef, undefined);
  assert.equal(result.validationIssues[0]?.message, "provider unavailable");
  assert.equal(result.omittedReasons.some((reason) =>
    reason.code === "selection_limit" && reason.skillId === "gamma"
  ), true);
});

test("routeSkillsWithModel falls back when model output does not match the router contract", async () => {
  const channel = new TestSkillRouterChannel({ selected: ["not-the-contract"] });

  const result = await routeSkillsWithModel({
    goal: "summarize with the summary skill",
    catalog: [skill("summary", { triggers: ["summary"] })],
    candidateContexts: [context("summary", { keywordScore: 5 })],
    intelligenceChannel: channel,
  });

  assert.equal(result.fallback, true);
  assert.equal(result.fallbackReason, "model_output_invalid");
  assert.deepEqual(result.selectedSkillIds, ["summary"]);
  assert.equal(result.validationIssues[0]?.code, "SKILL_ROUTER_SELECTED_IDS_NOT_ARRAY");
  assert.equal(result.modelCallRef?.validationStatus, "passed");
});

class TestSkillRouterChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly output: unknown) {}

  async request(request: ModelRequest, _options?: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push(request);
    return completedResponse(request, this.output);
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}

class ThrowingSkillRouterChannel implements IntelligenceChannel {
  constructor(private readonly error: Error) {}

  async request(): Promise<ModelResponse> {
    throw this.error;
  }

  validateResponse(_request: ModelRequest, response: ModelResponse): ModelOutputValidationResult {
    return response.validation;
  }
}

function completedResponse(request: ModelRequest, structuredOutput: unknown): ModelResponse {
  return {
    responseId: `${request.requestId}-response`,
    requestId: request.requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: request.outputContract.outputKind,
    structuredOutput,
    validation: {
      status: "passed",
      checkedAt: "2026-06-21T00:00:00.000Z",
      issues: [],
    },
    completedAt: "2026-06-21T00:00:00.000Z",
  };
}

function skill(id: string, overrides: Partial<SkillRouterCatalogSkill> = {}): SkillRouterCatalogSkill {
  return {
    id,
    name: id,
    description: `Skill ${id}.`,
    enabled: true,
    sourcePath: `/${id}/SKILL.md`,
    triggers: [],
    ...overrides,
  };
}

function context(skillId: string, overrides: Partial<SkillCandidateContext> = {}): SkillCandidateContext {
  return {
    skillId,
    skillName: skillId,
    sourceKind: "project",
    sourceRootId: "project",
    sourcePrecedence: 100,
    text: `id: ${skillId}\nname: ${skillId}\ndescription: safe metadata only`,
    charCount: 64,
    descriptionTruncated: false,
    explicit: false,
    keywordScore: 0,
    ...overrides,
  };
}
