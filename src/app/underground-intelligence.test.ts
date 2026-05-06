import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse, ModelToolCall } from "../domain/intelligence/index.js";
import type { RootletClusterKind } from "../domain/underground/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { createDefaultToolCenter, createUndergroundAiRuntimeConfig } from "./intelligence-channel-factory.js";
import type { FetchLike } from "./tool-center/index.js";
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
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 3);
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

test("Convergence AI advisory cannot recommend a missing candidate into handoff", async () => {
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
            {
              output: createConvergenceAdvisoryOutput({
                recommendedOptionId: "candidate-does-not-exist",
                summary: "Pick candidate-does-not-exist directly.",
                candidateIds: ["candidate-does-not-exist"],
              }),
            },
          ],
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

test("Convergence AI advisory cannot recommend a non-handoff candidate into handoff", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence(COMPLEX_ALL_ROOTLETS_GOAL, {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          convergenceOutput: (request) => {
            const riskCandidateId = firstAdvisoryCandidateIdForKind(request, "risk") ?? "candidate-risk-missing";
            return createConvergenceAdvisoryOutput({
              recommendedOptionId: riskCandidateId,
              summary: `Prefer non-handoff risk candidate ${riskCandidateId}.`,
              candidateIdsByKind: new Map([["risk", [riskCandidateId]]]),
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

test("Convergence AI advisory failure keeps deterministic flow auditable", async () => {
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

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.equal(result.undergroundReport.convergenceReport.aiAdvisory?.status, "failed");
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 1);
  assert.equal(
    result.directionHandoff?.assumptions.includes(
      "AI-assisted convergence advisory enriched candidate analysis and direction recommendation."
    ),
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
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 8);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 8);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 0);
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
});

test("Contract-violating AI output does not enter an approved Direction Handoff", async () => {
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

  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.source === "ai"),
    false
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) => output.source === "deterministic_fallback"),
    true
  );
});

test("Completed AI calls with empty candidate arrays fall back to deterministic rootlet output", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({ output: { candidates: [] } }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 3);
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
                summary: "Secret-safe model advice.",
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

test("Convergence AI advisory text is sanitized before public projections", async () => {
  const secret = "sk-convergence-secret-token";
  const bearer = "Bearer advisory-token-value";

  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          convergenceOutput: (request) => {
            const candidateId = firstAdvisoryCandidateIdForKind(request, "option");
            return {
              recommendedOptionId: candidateId,
              candidateAnalyses: [
                {
                  candidateId,
                  kind: "option",
                  contentDifference: `This advisory difference includes ${secret}.`,
                  whyPreferred: `This advisory rationale includes ${bearer}.`,
                  conflictWith: [`api key: ${secret}`],
                },
              ],
              conflictsNeedingUserInput: [`Confirm no prompt or ${secret} is exposed.`],
              constraintViolations: [`Do not leak ${bearer}.`],
              overallDirectionSummary: `Advisory summary mentions ${secret} and ${bearer}.`,
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

  assert.equal(publicProjectionText.includes(secret), false);
  assert.equal(publicProjectionText.includes(bearer), false);
  assert.equal(publicProjectionText.includes("api key: sk-"), false);
  assert.equal(publicProjectionText.includes("[redacted-secret]"), true);
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
    if (!this.options.fail && request.outputContract.contractId === "underground.autonomy_decision.v1") {
      return completedTestResponse({
        request,
        provider: this,
        structuredOutput: createLegalAutonomyDecisionOutput(),
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

function createLegalAutonomyDecisionOutput(): Record<string, unknown> {
  return {
    action: "request_convergence",
    completionAssessment: "The current candidate pool has enough material for convergence.",
    informationGaps: [],
    spawnRequests: [],
    rationale: "Convergence Judge remains the only promotion path.",
    sourceRefs: [],
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
  if (input.request.outputContract.contractId === "convergence-advisory") {
    if (isConvergenceAdvisoryOutput(input.step.output)) {
      return input.step.output;
    }
    return input.convergenceOutput?.(input.request) ?? createConvergenceAdvisoryOutput({
      recommendedOptionId: firstAdvisoryCandidateIdForKind(input.request, "option"),
      summary: "Convergence advisory confirms the candidate pool as the source of truth.",
      candidateIdsByKind: candidateIdsByKindFromConvergenceRequest(input.request),
    });
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

function createConvergenceAdvisoryOutput(input: {
  readonly recommendedOptionId?: string;
  readonly summary: string;
  readonly candidateIds?: readonly string[];
  readonly candidateIdsByKind?: ReadonlyMap<RootletClusterKind, readonly string[]>;
}): Record<string, unknown> {
  const candidateAnalyses =
    input.candidateIdsByKind === undefined
      ? (input.candidateIds ?? []).map((candidateId) => ({
          candidateId,
          kind: kindForCandidateId(candidateId),
          contentDifference: `AI differentiator for ${candidateId}.`,
          whyPreferred: `AI rationale for ${candidateId}.`,
          conflictWith: [],
        }))
      : [...input.candidateIdsByKind.entries()].flatMap(([kind, candidateIds]) =>
          candidateIds.map((candidateId) => ({
            candidateId,
            kind,
            contentDifference: `AI differentiator for ${candidateId}.`,
            whyPreferred: `AI rationale for ${candidateId}.`,
            conflictWith: [],
          }))
        );
  return {
    recommendedOptionId: input.recommendedOptionId,
    candidateAnalyses,
    conflictsNeedingUserInput: [],
    constraintViolations: [],
    overallDirectionSummary: input.summary,
  };
}

function isConvergenceAdvisoryOutput(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.candidateAnalyses) &&
    Array.isArray(record.conflictsNeedingUserInput) &&
    Array.isArray(record.constraintViolations) &&
    typeof record.overallDirectionSummary === "string"
  );
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

function candidateIdsFromConvergenceRequest(request: ModelRequest): string[] {
  return [...candidateIdsByKindFromConvergenceRequest(request).values()].flat();
}

function candidateIdsByKindFromConvergenceRequest(request: ModelRequest): Map<RootletClusterKind, string[]> {
  const content = request.sanitizedMessages.map((message) => message.content).join("\n");
  const result = new Map<RootletClusterKind, string[]>();
  const pattern = /- \[(option|risk|asset_fit|evidence|constraint|counterfactual)\] outputId=.*?\n\s+candidates: ([^\n]+)/g;
  for (const match of content.matchAll(pattern)) {
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

function kindForCandidateId(candidateId: string): RootletClusterKind {
  const marker = ":";
  const parts = candidateId.split(marker);
  const kind = parts.find((part): part is RootletClusterKind =>
    ["option", "risk", "asset_fit", "evidence", "constraint", "counterfactual"].includes(part)
  );
  return kind ?? "option";
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
