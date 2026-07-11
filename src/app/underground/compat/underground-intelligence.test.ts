/**
 * @deprecated 测试废弃候选（T4-1 / ADR-0025 deep 一期）— 随被测 ①/②/②' 废弃候选代码一并退役。
 *
 * 闭环4 §8.1 阶段②：被测代码迁移到 DeepRuntime 后，本测试随之迁移或退役；
 * 当前保持运行不阻塞构建。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse, ModelToolCall } from "../../../domain/intelligence/index.js";
import type { RootletClusterKind } from "../../../domain/underground/index.js";
import { nowIso } from "../../../kernel/id.js";
import { NativeIntelligenceChannel } from "../../../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../../../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../../../kernel/intelligence/validation.js";
import { createDefaultToolCenter } from "../../model-runtime/index.js";
import type { FetchLike } from "../../tool-center/index.js";
import { createUndergroundAiRuntimeConfig } from "../../underground-ai-runtime.js";
import { createUndergroundDemoSummary } from "./underground-demo-summary.js";
import {
  runUndergroundDirectionSession,
  runUndergroundDirectionSessionWithIntelligence,
} from "./underground-direction-session.js";

const COMPLEX_ALL_ROOTLETS_GOAL =
  "构建任务管理平台，需要风险、安全、资产、证据、约束和反驳候选，包含测试和监控，不接数据库，并提供替代方向。";

test("Underground intelligence output enters candidate pool and waits for convergence before handoff", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          output: {
            candidates: [
              {
                summary: "Model suggested an additional candidate direction.",
                tradeoffs: ["adds another judged option"],
                applicability: "Use when deterministic candidates need more breadth.",
              },
            ],
          },
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.eventTypes.includes("direction_handoff.completed"), true);
  const modelOutput = result.undergroundReport.rootletOutputs.find((output) => output.source === "ai");
  assert.notEqual(modelOutput, undefined);
  assert.equal(modelOutput?.sourceRefs.includes("model.requested"), true);
  assert.equal(
    modelOutput?.sourceRefs.some((ref) => ref.startsWith("rootlet-variant:")),
    true
  );
  assert.equal(result.undergroundReport.candidatePool.counts.total, 1);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.option.length, 1);
  assert.equal(modelOutput?.source, "ai");
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 7);
  assert.equal(result.undergroundReport.convergenceReport.source, "ai");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "completed");
  assert.equal(
    result.undergroundReport.convergenceReport.aiAdvisory?.recommendedOptionId,
    result.undergroundReport.convergenceReport.handoffCandidateRefs[0]
  );
  assert.equal(result.directionHandoff?.clarifiedGoal.includes("Build a small deterministic helper"), true);
  assert.equal(result.directionHandoff?.clarifiedGoal.includes("Convergence advisory confirms"), false);
  assert.deepEqual(
    result.directionHandoff?.sourceCandidateRefs.map((candidate) => candidate.id),
    result.undergroundReport.convergenceReport.handoffCandidateRefs
  );
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) => !("outputId" in candidate)),
    true
  );
});

test("Convergence AI judgment cannot recommend a missing candidate into handoff", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          responses: [
            {
              output: {
                candidates: [
                  {
                    summary: "Model suggested a legal option candidate.",
                    tradeoffs: ["keeps candidate pool as the source of truth"],
                    applicability: "Use when the goal needs a bounded helper.",
                  },
                ],
              },
            },
          ],
          convergenceOutput: (request) =>
            createConvergenceJudgmentOutput({
                recommendedOptionId: "candidate-does-not-exist",
                summary: "Pick candidate-does-not-exist directly.",
                candidateIdsByKind: candidateIdsByKindFromConvergenceRequest(request),
            }),
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "completed");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.recommendedOptionId, undefined);
  assert.equal(
    result.undergroundReport.convergenceReport.aiAdvisory?.candidateAnalyses.some(
      (analysis) => analysis.candidateId === "candidate-does-not-exist"
    ),
    false
  );
  assert.notEqual(result.directionHandoff?.recommendedOptionId, "candidate-does-not-exist");
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.some((candidate) => candidate.id === "candidate-does-not-exist"),
    false
  );
  assert.equal(JSON.stringify(result.directionHandoff).includes("candidate-does-not-exist"), false);
});

test("Convergence AI judgment cannot recommend a non-handoff candidate into handoff", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence(COMPLEX_ALL_ROOTLETS_GOAL, {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          convergenceOutput: (request) => {
            const riskCandidateId = firstAdvisoryCandidateIdForKind(request, "risk") ?? "candidate-risk-missing";
            return createConvergenceJudgmentOutput({
              recommendedOptionId: riskCandidateId,
              summary: `Prefer non-handoff risk candidate ${riskCandidateId}.`,
              candidateIdsByKind: candidateIdsByKindFromConvergenceRequest(request),
            });
          },
        }),
        bus: runtime.bus,
      }),
  });

  const advisoryRecommendedId = firstAdvisoryCandidateIdForKindFromReport(result, "risk");

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "completed");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.recommendedOptionId, undefined);
  assert.equal(advisoryRecommendedId === undefined || result.undergroundReport.convergenceReport.handoffCandidateRefs.includes(advisoryRecommendedId), false);
  assert.notEqual(result.directionHandoff?.recommendedOptionId, advisoryRecommendedId);
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) =>
      result.undergroundReport.convergenceReport.handoffCandidateRefs.includes(candidate.id)
    ),
    true
  );
});

test("Convergence AI judgment failure stops instead of approving deterministic convergence", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          responses: [
            {
              output: {
                candidates: [
                  {
                    summary: "Model suggested a candidate before advisory failure.",
                    tradeoffs: ["keeps deterministic fallback available"],
                    applicability: "Use when convergence advice is unavailable.",
                  },
                ],
              },
            },
            { fail: true },
          ],
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.undergroundReport.convergenceReport.source, "deterministic_fallback");
  assert.equal(result.undergroundReport.convergenceReport.confidence < 0.3, true);
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "failed");
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 1);
  assert.equal(
    result.loadedDirectionHandoffPackage.validation.passed,
    false
  );
});

test("All selected rootlet kinds request AI candidate advice through IntelligenceChannel", async () => {
  const aiConfig = createUndergroundAiRuntimeConfig({ mode: "fake" });
  if (!aiConfig.enabled) {
    throw new Error("Expected fake AI config to be enabled.");
  }

  const result = await runUndergroundDirectionSessionWithIntelligence(COMPLEX_ALL_ROOTLETS_GOAL, {
    createIntelligenceChannel: aiConfig.createIntelligenceChannel,
  });

  assert.deepEqual(result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind), [
    "option",
    "risk",
    "asset_fit",
    "evidence",
    "constraint",
    "counterfactual",
  ]);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 12);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 12);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 0);
  assert.equal(result.undergroundReport.convergenceReport.source, "ai");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "completed");

  for (const kind of result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind)) {
    const modelOutput = result.undergroundReport.rootletOutputs.find(
      (output) => output.kind === kind && output.source === "ai"
    );
    assert.notEqual(modelOutput, undefined, `Expected model output for ${kind}`);
    assert.equal(
      result.undergroundReport.candidatePool.candidatesByKind[kind].some((candidate) =>
        candidate.sourceRefs.includes(modelOutput!.outputId)
      ),
      true
    );
  }
});

test("Rootlet AI can call unified search through ToolCenter before producing candidate output", async () => {
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        {
          title: "ToolCenter result",
          url: "https://example.test/tool-center",
          content: "Tool search result snippet.",
        },
      ],
    }),
  });
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          responses: [
            {
              toolCalls: [
                {
                  callId: "call-search",
                  toolName: "search",
                  input: { query: "AgentArbor ToolCenter", sources: ["web"] },
                },
              ],
            },
            {
              output: {
                candidates: [
                  {
                    summary: "Model used a tool before suggesting the deterministic helper candidate.",
                    tradeoffs: ["adds current-information evidence for the helper goal"],
                    applicability: "Use when a deterministic helper rootlet needs external context.",
                  },
                ],
              },
            },
          ],
        }),
        bus: runtime.bus,
      }),
    createToolCenter: (runtime) =>
      createDefaultToolCenter({
        runtime,
        env: { AGENTARBOR_TAVILY_API_KEY: "tvly-test-secret" },
        fetch,
      }),
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.deepEqual(
    result.runtime.eventLog.types().filter((type) => type.startsWith("tool.")),
    ["tool.requested", "tool.completed"]
  );
  const modelOutput = result.undergroundReport.rootletOutputs.find((output) => output.source === "ai");
  assert.notEqual(modelOutput, undefined);
  assert.equal(JSON.stringify(modelOutput).includes("Tool search result snippet"), false);
  assert.equal(JSON.stringify(result.runtime.eventLog.list()).includes("tvly-test-secret"), false);
});

test("Rootlet AI can call unified search then read before producing candidate output", async () => {
  const fetch: FetchLike = async (_url, init) => {
    if ((init as { method: string }).method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () =>
          "<html><body><h1>ToolCenter read result</h1><p>Page read body should stay out of EventLog.</p></body></html>",
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "ToolCenter result",
            url: "https://example.test/tool-center",
            content: "Tool search result snippet.",
          },
        ],
      }),
    };
  };
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          responses: [
            {
              toolCalls: [
                {
                  callId: "call-search",
                  toolName: "search",
                  input: { query: "AgentArbor ToolCenter", sources: ["web"] },
                },
              ],
            },
            {
              toolCalls: [
                {
                  callId: "call-read",
                  toolName: "read",
                  input: { ref: "https://example.test/tool-center", source: "page" },
                },
              ],
            },
            {
              output: {
                candidates: [
                  {
                    summary: "Model used search and read before suggesting the deterministic helper candidate.",
                    tradeoffs: ["adds current-information evidence for the helper goal", "keeps research as candidate material"],
                    applicability: "Use when a deterministic helper rootlet needs a search result and a page preview.",
                  },
                ],
              },
            },
          ],
        }),
        bus: runtime.bus,
      }),
    createToolCenter: (runtime) =>
      createDefaultToolCenter({
        runtime,
        env: { AGENTARBOR_TAVILY_API_KEY: "tvly-test-secret" },
        fetch,
      }),
  });

  const toolEvents = result.runtime.eventLog.types().filter((type) => type.startsWith("tool."));
  const modelOutput = result.undergroundReport.rootletOutputs.find((output) => output.source === "ai");
  const eventLogText = JSON.stringify(result.runtime.eventLog.list());

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.deepEqual(toolEvents, ["tool.requested", "tool.completed", "tool.requested", "tool.completed"]);
  assert.notEqual(modelOutput, undefined);
  assert.equal(eventLogText.includes("tvly-test-secret"), false);
  assert.equal(eventLogText.includes("Page read body should stay out of EventLog"), false);
  assert.equal(JSON.stringify(modelOutput).includes("Page read body should stay out of EventLog"), false);
});

test("Contract-violating AI rootlet output falls back before convergence and handoff", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence(
    "Stop because no viable candidate should be produced.",
    {
      createIntelligenceChannel: (runtime) =>
        new NativeIntelligenceChannel({
          provider: new TestModelProvider({ output: { rationale: "Missing summary field." } }),
          bus: runtime.bus,
        }),
    }
  );

  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "ai"),
    false
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) => output.source === "deterministic_fallback"),
    true
  );
  assert.equal(JSON.stringify(result.directionHandoff).includes("Missing summary field."), false);
});

test("Completed AI calls with empty candidate arrays fall back to deterministic rootlet output", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({ output: { candidates: [] } }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 7);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 0);
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "completed");
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "ai"),
    false
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) => output.source === "deterministic_fallback"),
    true
  );
});

test("AI provider failures fall back to deterministic rootlet outputs before autonomy stops", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence(COMPLEX_ALL_ROOTLETS_GOAL, {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({ fail: true }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory, undefined);
  assert.equal(result.undergroundReport.convergenceReport.stopReason, "autonomy_decision_failed");
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "ai"),
    false
  );

  const fallbackKinds = new Set<RootletClusterKind>();
  for (const output of result.undergroundReport.rootletOutputs) {
    if (output.source === "deterministic_fallback") {
      fallbackKinds.add(output.kind);
    }
  }
  assert.deepEqual([...fallbackKinds], [
    "option",
    "risk",
    "asset_fit",
    "evidence",
    "constraint",
    "counterfactual",
  ]);
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) => output.source === "deterministic_fallback"),
    true
  );
});

test("Default AgentTurnRuntime-disabled underground session stops without model events or approval", async () => {
  const result = await runUndergroundDirectionSession(COMPLEX_ALL_ROOTLETS_GOAL);

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.runtime.eventLog.types().some((type) => type.startsWith("model.")), false);
  assert.equal(result.runtime.eventLog.types().includes("direction_handoff.completed"), false);
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory, undefined);
  assert.equal(result.undergroundReport.convergenceReport.stopReason, "ai_required_for_autonomy");
  assert.equal(result.loadedDirectionHandoffPackage.manifest.status, "draft");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "ai"),
    false
  );
});

test("EventLog and Observation Snapshot do not expose provider secret values", async () => {
  const secret = "sk-test-secret-token";

  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          secret,
          output: {
            candidates: [
              {
                summary: "Helper runtime direction keeps secret material out of EventLog and Observation Snapshot.",
                tradeoffs: ["keeps secret material out of EventLog"],
                applicability: "Use only as candidate advice.",
              },
            ],
          },
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(JSON.stringify(result.runtime.eventLog.list()).includes(secret), false);
  assert.equal(JSON.stringify(result.observationSnapshot).includes(secret), false);
  assert.equal(JSON.stringify(result.runtime.eventLog.list()).includes("token"), false);
  assert.equal(JSON.stringify(result.observationSnapshot).includes("token"), false);
});

test("Convergence AI advisory text is preserved in public projections", async () => {
  const secret = "sk-convergence-secret-token";
  const bearer = "Bearer advisory-token-value";

  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          convergenceOutput: (request) => {
            const candidateIdsByKind = candidateIdsByKindFromConvergenceRequest(request);
            const candidateId = candidateIdsByKind.get("option")?.[0];
            const output = createConvergenceJudgmentOutput({
              recommendedOptionId: candidateId,
              summary: `Advisory summary mentions ${secret} and ${bearer}.`,
              candidateIdsByKind,
            });
            const candidateDecisions = Array.isArray(output.candidateDecisions)
              ? output.candidateDecisions
              : [];
            return {
              ...output,
              candidateDecisions: candidateDecisions.map((decision) => ({
                ...(decision as Record<string, unknown>),
                contentDifference: `This advisory difference includes ${secret}.`,
                whyPreferred: `This advisory rationale includes ${bearer}.`,
                conflictWith: [`api key: ${secret}`],
              })),
              conflictsNeedingUserInput: [`Confirm no prompt or ${secret} is exposed.`],
              constraintViolations: [`Do not leak ${bearer}.`],
            };
          },
        }),
        bus: runtime.bus,
      }),
  });
  const summary = createUndergroundDemoSummary(result, undefined, {
    enabled: true,
    mode: "fake",
    providerId: "test-underground-model-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-underground-model",
  });
  const publicProjectionText = JSON.stringify({
    eventLog: result.runtime.eventLog.list(),
    observationSnapshot: result.observationSnapshot,
    directionHandoff: result.directionHandoff,
    summary,
  });

  assert.equal(publicProjectionText.includes(secret), true);
  assert.equal(publicProjectionText.includes(bearer), true);
  assert.equal(publicProjectionText.includes("api key: sk-"), true);
  assert.equal(publicProjectionText.includes("[redacted-secret]"), false);
});

type TestModelProviderOptions = {
  readonly output?: unknown;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
  readonly secret?: string;
  readonly responses?: readonly TestModelProviderResponse[];
  readonly convergenceOutput?: (request: ModelRequest) => unknown;
};

type TestModelProviderResponse = {
  readonly output?: unknown;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly fail?: boolean;
};

class TestModelProvider implements ModelProvider {
  readonly providerId = "test-underground-model-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "test-underground-model";
  private callCount = 0;

  constructor(private readonly options: TestModelProviderOptions = {}) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.options.fail && request.outputContract.contractId === "underground.intent_profile.v1") {
      return completedTestResponse({
        request,
        provider: this,
        structuredOutput: createLegalIntentProfileOutput(request),
      });
    }

    if (!this.options.fail && request.outputContract.contractId === "underground.growth_governor.v1") {
      return completedTestResponse({
        request,
        provider: this,
        structuredOutput: createLegalGrowthGovernorOutput(request),
      });
    }

    if (!this.options.fail && request.outputContract.contractId === "underground.autonomy_decision.v1") {
      return completedTestResponse({
        request,
        provider: this,
        structuredOutput: createLegalAutonomyDecisionOutput(),
      });
    }

    if (!this.options.fail && request.outputContract.contractId === "underground.candidate_aggregation.v1") {
      return completedTestResponse({
        request,
        provider: this,
        structuredOutput: createLegalCandidateAggregationOutput(),
      });
    }

    const step = this.nextStep();
    if (step.fail) {
      return createFailedModelResponse({
        requestId: request.requestId,
        providerId: this.providerId,
        providerKind: this.providerKind,
        protocolKind: this.protocolKind,
        model: this.model,
        outputKind: request.outputContract.outputKind,
        failureKind: "provider_response",
        message: "Test provider was configured to fail.",
      });
    }
    const structuredOutput = resolveStructuredOutput({
      request,
      step,
      convergenceOutput: this.options.convergenceOutput,
    });

    return completedTestResponse({
      request,
      provider: this,
      structuredOutput,
      toolCalls: step.toolCalls,
    });
  }

  private nextStep(): TestModelProviderResponse {
    const step = this.options.responses?.[this.callCount];
    this.callCount += 1;
    return step ?? {
      output: this.options.output,
      toolCalls: this.options.toolCalls,
      fail: this.options.fail,
    };
  }
}

function completedTestResponse(input: {
  readonly request: ModelRequest;
  readonly provider: TestModelProvider;
  readonly structuredOutput: unknown;
  readonly toolCalls?: readonly ModelToolCall[];
}): ModelResponse {
  return {
    responseId: "model-response-underground-test",
    requestId: input.request.requestId,
    providerId: input.provider.providerId,
    providerKind: input.provider.providerKind,
    protocolKind: input.provider.protocolKind,
    model: input.provider.model,
    status: "completed",
    outputKind: input.request.outputContract.outputKind,
    structuredOutput: input.structuredOutput,
    toolCalls: input.toolCalls?.map((toolCall) => ({
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      input: globalThis.structuredClone(toolCall.input),
    })),
    finishReason: input.toolCalls === undefined || input.toolCalls.length === 0 ? "stop" : "tool_call",
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function createLegalCandidateAggregationOutput(): Record<string, unknown> {
  return {
    aggregationRationale: "Test Candidate Collector aggregated rootlet outputs into candidate pool.",
    deduplicationNotes: [],
    implicitRelations: [],
    decisionSummary: "Test candidate aggregation completed.",
    uncertainty: "Test output, not real judgment.",
    confidence: 0.74,
  };
}

function createLegalAutonomyDecisionOutput(): Record<string, unknown> {
  return {
    action: "request_convergence",
    completionAssessment: "The current candidate pool has enough material for convergence.",
    informationGaps: [],
    spawnRequests: [],
    rationale: "Convergence Judge remains the only promotion path.",
    sourceRefs: [],
    decisionSummary: "Autonomy recommends convergence.",
    uncertainty: "Test output, not real judgment.",
    confidence: 0.74,
  };
}

function createLegalIntentProfileOutput(request: ModelRequest): Record<string, unknown> {
  const goal = extractGoalAnchor(request);
  const concepts = conceptsForGoal(goal);
  return {
    goalStatement: goal,
    keyConcepts: concepts,
    domainConcepts: concepts,
    nonGoals: [],
    acceptanceCriteria: ["Parent underground agents can review the profile before handoff."],
    assumptions: ["The test provider only returns safe structured fixture data."],
    riskHints: goal.includes("风险") || goal.toLowerCase().includes("risk") ? ["risk"] : [],
    constraintHints: goal.includes("约束") || goal.toLowerCase().includes("constraint") ? ["goal:constraint"] : [],
    unknowns: [],
    decisionSummary: `Intent Core shaped ${goal} as a candidate profile.`,
    uncertainty: "This test fixture contains only safe summary text and no raw provider state.",
    confidence: 0.79,
  };
}

function conceptsForGoal(goal: string): string[] {
  if (goal.includes("任务管理")) {
    return ["task_management", "testing", "monitoring", "handoff"];
  }
  return ["helper", "runtime", "handoff"];
}

function createLegalGrowthGovernorOutput(request: ModelRequest): Record<string, unknown> {
  const rootletKinds = availableRootletKindsFromGrowthRequest(request);
  return {
    rootletKinds,
    budget: {
      maxRootletClusters: rootletKinds.length,
      maxCandidateOutputs: rootletKinds.length,
    },
    dispatchDecision: "Start selected rootlet clusters as lower-layer material for parent convergence.",
    decisionSummary: "Growth Governor selected bounded rootlet clusters.",
    uncertainty: "This test fixture cannot approve handoff or bypass Convergence Judge.",
    confidence: 0.77,
  };
}

function resolveStructuredOutput(input: {
  readonly request: ModelRequest;
  readonly step: TestModelProviderResponse;
  readonly convergenceOutput?: (request: ModelRequest) => unknown;
}): unknown {
  if (input.step.toolCalls !== undefined && input.step.toolCalls.length > 0) {
    return undefined;
  }
  if (input.request.outputContract.contractId === "underground.convergence_judgment.v1") {
    if (isConvergenceJudgmentOutput(input.step.output)) {
      return input.step.output;
    }
    return input.convergenceOutput?.(input.request) ?? createConvergenceJudgmentOutput({
      recommendedOptionId: firstAdvisoryCandidateIdForKind(input.request, "option"),
      summary: "Convergence Judge confirms the candidate pool as the source of truth.",
      candidateIdsByKind: candidateIdsByKindFromConvergenceRequest(input.request),
    });
  }
  if (input.request.outputContract.contractId === "underground.handoff_narrative.v1") {
    return createLegalHandoffNarrativeOutput(input.request);
  }
  if (input.request.outputContract.contractId === "convergence-advisory") {
    return {
      candidateAnalyses: [],
      conflictsNeedingUserInput: [],
      constraintViolations: [],
      overallDirectionSummary: "Legacy convergence advisory fixture remains bounded by package validation.",
    };
  }
  if (input.step.output !== undefined) {
    return input.step.output;
  }
  const kind = rootletKindFromContractId(input.request.outputContract.contractId);
  const goalAnchor = extractGoalAnchor(input.request);
  const goalSpecificMaterial = goalAnchor.includes("任务管理")
    ? {
        summary: "task_management 任务管理看板方向：围绕任务状态流转、测试证据和监控告警形成可交接方案。",
        tradeoff: "保留 task_management 任务状态流转和监控证据作为收束依据。",
        applicability: "适用于 task_management 任务管理平台的地下方向交接。",
        risk: "任务管理状态流转缺少监控证据会影响交接质量。",
        asset: "任务管理运行证据资产",
        evidence: "任务管理测试证据",
        constraint: "任务管理交接约束",
        counterfactual: "只做通用平台会丢失任务状态流转和监控告警边界。",
      }
    : {
        summary: "Helper runtime direction: keep the helper contract testable, observable, and bounded.",
        tradeoff: "Keep helper contract evidence visible to convergence.",
        applicability: "Use for a bounded helper runtime handoff.",
        risk: "Helper contract evidence gaps can weaken the handoff.",
        asset: "helper runtime evidence asset",
        evidence: "helper contract test evidence",
        constraint: "helper runtime boundary",
        counterfactual: "A generic workflow would lose helper contract observability.",
      };
  const candidate = candidateForKind(kind, goalSpecificMaterial);
  return {
    candidates: [candidate],
  };
}

function candidateForKind(
  kind: RootletClusterKind,
  material: {
    readonly summary: string;
    readonly tradeoff: string;
    readonly applicability: string;
    readonly risk: string;
    readonly asset: string;
    readonly evidence: string;
    readonly constraint: string;
    readonly counterfactual: string;
  }
): Record<string, unknown> {
  switch (kind) {
    case "risk":
      return {
        summary: material.risk,
        impactScope: "underground direction handoff",
        severity: "medium",
        mitigation: "Keep the risk as evidence for Convergence Judge instead of promoting it as a handoff option.",
      };
    case "asset_fit":
      return {
        summary: `${material.asset} fits only as a referenced support asset.`,
        assetRefs: ["soil:minimal-constraints"],
        fitConditions: [material.applicability],
        doNotApplyWhen: ["The asset would be copied into the handoff as Soil body content."],
      };
    case "evidence":
      return {
        summary: material.evidence,
        evidenceType: "verification",
        confidence: "medium",
      };
    case "constraint":
      return {
        summary: material.constraint,
        constraintLevel: "hard",
        enforcementGate: "direction_handoff",
      };
    case "counterfactual":
      return {
        summary: material.counterfactual,
        alternativeDirection: material.counterfactual,
        whyNotChosen: "Counterfactual material remains why-not evidence and cannot become the retained option.",
      };
    case "option":
      return {
        summary: material.summary,
        tradeoffs: ["deterministic test output", material.tradeoff],
        applicability: material.applicability,
      };
  }
}

function createConvergenceJudgmentOutput(input: {
  readonly recommendedOptionId?: string;
  readonly summary: string;
  readonly candidateIdsByKind?: ReadonlyMap<RootletClusterKind, readonly string[]>;
}): Record<string, unknown> {
  const candidateIdsByKind = input.candidateIdsByKind ?? new Map<RootletClusterKind, readonly string[]>();
  const firstOptionId = candidateIdsByKind.get("option")?.[0];
  const candidateDecisions = [...candidateIdsByKind.entries()].flatMap(([kind, candidateIds]) =>
    candidateIds.map((candidateId) => {
      const status = convergenceStatusForKind(kind, candidateId, firstOptionId);
      return {
        candidateId,
        status,
        reason: `AI Convergence Judge marked ${candidateId} as ${status}.`,
        evidenceRefs: [],
        contentDifference: `AI differentiator for ${candidateId}.`,
        whyPreferred: `AI rationale for ${candidateId}.`,
        conflictWith: [],
      };
    })
  );
  return {
    recommendedOptionId: input.recommendedOptionId,
    candidateDecisions,
    nextAction: "approve_handoff",
    conflictsNeedingUserInput: [],
    constraintViolations: [],
    overallDirectionSummary: input.summary,
    decisionSummary: "Convergence Judge made candidate-level convergence decisions.",
    uncertainty: "This test fixture exposes only safe summary text.",
    confidence: 0.82,
  };
}

function isConvergenceJudgmentOutput(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.candidateDecisions) &&
    typeof record.nextAction === "string" &&
    Array.isArray(record.conflictsNeedingUserInput) &&
    Array.isArray(record.constraintViolations) &&
    typeof record.overallDirectionSummary === "string" &&
    typeof record.decisionSummary === "string"
  );
}

function createLegalHandoffNarrativeOutput(request: ModelRequest): Record<string, unknown> {
  const candidateIds = candidateIdsFromHandoffRequest(request);
  const convergenceOutcome = lineValueFromRequest(request, "Convergence outcome:") ?? "approved";
  const status =
    convergenceOutcome === "approved" && candidateIds.length > 0
      ? "approved"
      : convergenceOutcome === "awaiting_user"
        ? "awaiting_user"
        : "stopped";
  return {
    status,
    clarifiedGoal: `Handoff Steward packages ${extractGoalAnchor(request)} with source candidate lineage.`,
    optionNarratives:
      status === "approved"
        ? candidateIds.map((candidateId) => ({
            candidateId,
            directionSummary: `Handoff narrative for ${candidateId}: preserve the candidate lineage, evidence refs, and package validation boundary.`,
            whyPreferred: "The candidate is accepted or merged by Convergence Judge.",
            whyNot: [],
            doNotChooseWhen: ["When package validation fails."],
            evidenceRefs: [`handoff-narrative:${candidateId}`],
          }))
        : [],
    nonGoals: ["Do not bypass DirectionHandoffPackage validation."],
    assumptions: ["Convergence Judge remains the candidate promotion owner."],
    missingInformation: status === "approved" ? [] : ["Approved handoff narrative is unavailable."],
    risks: ["Aboveground must preserve handoff evidence refs."],
    evidenceBoundary: "Use source candidates, convergence refs, model refs and package validation only.",
    growthEntry: {
      allowedRuntimeShapes: ["single_agent", "sub_agent_tree"],
      suggestedFirstWorkflowNodes: ["confirm_direction_handoff", "derive_execution_plan", "preserve_evidence_refs"],
      escalationRules: ["Stop if package validation fails."],
    },
    decisionSummary: "Handoff Steward test fixture organized safe handoff material.",
    uncertainty: "No private reasoning trace or raw provider response is exposed.",
    confidence: status === "approved" ? 0.8 : 0.2,
  };
}

function convergenceStatusForKind(
  kind: RootletClusterKind,
  candidateId: string,
  firstOptionId: string | undefined
): "accepted" | "merged" | "rejected" | "unknown" {
  if (kind === "option") {
    return candidateId === firstOptionId ? "accepted" : "merged";
  }
  if (kind === "risk" || kind === "counterfactual") {
    return "rejected";
  }
  return "merged";
}

function firstAdvisoryCandidateIdForKind(request: ModelRequest, kind: RootletClusterKind): string | undefined {
  return candidateIdsByKindFromConvergenceRequest(request).get(kind)?.[0];
}

function firstAdvisoryCandidateIdForKindFromReport(
  result: Awaited<ReturnType<typeof runUndergroundDirectionSessionWithIntelligence>>,
  kind: RootletClusterKind
): string | undefined {
  return result.undergroundReport.convergenceReport.aiAdvisory?.candidateAnalyses.find(
    (analysis) => analysis.kind === kind
  )?.candidateId;
}

function candidateIdsFromHandoffRequest(request: ModelRequest): string[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  return [...content.matchAll(/candidateId=([^\s\n]+)/g)]
    .map((match) => match[1])
    .filter((candidateId): candidateId is string => candidateId !== undefined && candidateId.length > 0);
}

function candidateIdsByKindFromConvergenceRequest(request: ModelRequest): Map<RootletClusterKind, string[]> {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const result = new Map<RootletClusterKind, string[]>();
  const currentPattern = /- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\]\s+candidateId=([^\s]+)\s+outputId=[^\s\n]+/g;
  for (const match of content.matchAll(currentPattern)) {
    const kind = match[1] as RootletClusterKind;
    const candidateId = match[2]?.trim();
    if (candidateId !== undefined && candidateId.length > 0) {
      result.set(kind, [...(result.get(kind) ?? []), candidateId]);
    }
  }
  if (result.size > 0) {
    return result;
  }

  const legacyPattern = /- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\] outputId=.*?\n\s+candidates: ([^\n]+)/g;
  for (const match of content.matchAll(legacyPattern)) {
    const kind = match[1] as RootletClusterKind;
    const rawCandidateIds = match[2] ?? "";
    if (rawCandidateIds === "none") {
      continue;
    }
    result.set(
      kind,
      rawCandidateIds
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    );
  }
  return result;
}

function rootletKindFromContractId(contractId: string): RootletClusterKind {
  const prefix = "underground.rootlet_candidate_advice.";
  const rawKind = contractId.startsWith(prefix) ? contractId.slice(prefix.length).split(".")[0] : undefined;
  return isRootletClusterKind(rawKind) ? rawKind : "option";
}

function isRootletClusterKind(value: string | undefined): value is RootletClusterKind {
  return (
    value === "option" ||
    value === "risk" ||
    value === "asset_fit" ||
    value === "evidence" ||
    value === "constraint" ||
    value === "counterfactual"
  );
}

function extractGoalAnchor(request: ModelRequest): string {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const rawGoalLine = content.split("\n").find((line) => line.trim().startsWith("Raw goal:"));
  if (rawGoalLine !== undefined) {
    const rawGoal = rawGoalLine.slice("Raw goal:".length).trim();
    if (rawGoal.length > 0) {
      return rawGoal.length > 80 ? `${rawGoal.slice(0, 77)}...` : rawGoal;
    }
  }
  return "current goal";
}

function lineValueFromRequest(request: ModelRequest, prefix: string): string | undefined {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith(prefix));
  return line?.slice(line.indexOf(prefix) + prefix.length).trim();
}

function availableRootletKindsFromGrowthRequest(request: ModelRequest): RootletClusterKind[] {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const line = content.split("\n").find((candidate) => candidate.trim().startsWith("Available rootlet kinds:"));
  const rawKinds = line?.slice(line.indexOf(":") + 1).trim() ?? "option";
  return rawKinds
    .split(",")
    .map((kind) => kind.trim())
    .filter(isRootletClusterKind);
}
