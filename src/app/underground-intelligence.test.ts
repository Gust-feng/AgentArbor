import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import type { RootletClusterKind } from "../domain/underground/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { createUndergroundAiRuntimeConfig } from "./intelligence-channel-factory.js";
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
  assert.deepEqual(result.eventTypes.slice(0, 5), [
    "goal.received",
    "underground.exploration_planned",
    "rootlet_cluster.started",
    "model.requested",
    "model.completed",
  ]);
  assert.equal(result.eventTypes.indexOf("convergence_review.completed") < result.eventTypes.indexOf("direction_handoff.completed"), true);
  const modelOutput = result.undergroundReport.rootletOutputs.find((output) =>
    output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))
  );
  assert.notEqual(modelOutput, undefined);
  assert.equal(modelOutput?.sourceRefs.includes("rootlet.invocation_requested"), true);
  assert.equal(
    modelOutput?.sourceRefs.some((ref) => ref.startsWith("rootlet-invocation-request")),
    true
  );
  assert.equal(
    result.undergroundReport.agentClusterRun?.invocations.some(
      (invocation) =>
        invocation.invocationId === modelOutput?.invocationId &&
        invocation.role === "rootlet_agent" &&
        invocation.outputRefs.includes(modelOutput.outputId)
    ),
      true
  );
  assert.equal(result.undergroundReport.candidatePool.counts.total, 1);
  assert.equal(result.undergroundReport.candidatePool.candidatesByKind.option.length, 1);
  assert.deepEqual(
    result.directionHandoff?.sourceCandidateRefs.map((candidate) => candidate.id),
    result.undergroundReport.convergenceReport.handoffCandidateRefs
  );
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) => !("outputId" in candidate)),
    true
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
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 6);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 6);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 0);

  for (const kind of result.undergroundReport.plan.rootletClusters.map((cluster) => cluster.kind)) {
    const modelOutput = result.undergroundReport.rootletOutputs.find(
      (output) => output.kind === kind && output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))
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

  assert.deepEqual(result.eventTypes.slice(0, 5), [
    "goal.received",
    "underground.exploration_planned",
    "rootlet_cluster.started",
    "model.requested",
    "model.failed",
  ]);
  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))),
    false
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.sourceRefs.includes("ai-fallback:option")),
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

  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 1);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 0);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))),
    false
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.every((output) => output.sourceRefs.includes("ai-fallback:option")),
    true
  );
});

test("AI provider failures fall back to deterministic rootlet outputs for every selected kind", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence(COMPLEX_ALL_ROOTLETS_GOAL, {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({ fail: true }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 6);
  assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.failed").length, 6);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))),
    false
  );

  const fallbackKinds = new Set<RootletClusterKind>();
  for (const output of result.undergroundReport.rootletOutputs) {
    if (output.sourceRefs.includes(`ai-fallback:${output.kind}`)) {
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
});

test("Default underground session stays deterministic with no model events or AI fallback refs", () => {
  const result = runUndergroundDirectionSession(COMPLEX_ALL_ROOTLETS_GOAL);

  assert.equal(result.runtime.eventLog.types().some((type) => type.startsWith("model.")), false);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) =>
      output.sourceRefs.some((ref) => ref.startsWith("ai-fallback:"))
    ),
    false
  );
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) =>
      output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))
    ),
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

type TestModelProviderOptions = {
  readonly output?: unknown;
  readonly fail?: boolean;
  readonly secret?: string;
};

class TestModelProvider implements ModelProvider {
  readonly providerId = "test-underground-model-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "test-underground-model";

  constructor(private readonly options: TestModelProviderOptions = {}) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (this.options.fail) {
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

    return {
      responseId: "model-response-underground-test",
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: this.options.output ?? {
        candidates: [
          {
            summary: "Candidate advice from test provider.",
            tradeoffs: ["deterministic test output"],
            applicability: "Use as a test candidate.",
          },
        ],
      },
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}
