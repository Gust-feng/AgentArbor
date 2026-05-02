import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import { nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { createFailedModelResponse } from "../kernel/intelligence/failures.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { runUndergroundDirectionSessionWithIntelligence } from "./underground-direction-session.js";

test("Underground intelligence output enters candidate pool and waits for convergence before handoff", async () => {
  const result = await runUndergroundDirectionSessionWithIntelligence("Build a small deterministic helper.", {
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        provider: new TestModelProvider({
          output: { summary: "Model suggested an additional candidate direction." },
        }),
        bus: runtime.bus,
      }),
  });

  assert.equal(result.terminalStatus, "approved_package_created");
  assert.deepEqual(result.eventTypes.slice(0, 3), ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.eventTypes.indexOf("convergence_review.completed") < result.eventTypes.indexOf("direction_handoff.completed"), true);
  assert.equal(result.undergroundReport.rootletOutputs.some((output) => output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))), true);
  assert.equal(result.undergroundReport.candidatePool.counts.total, 2);
  assert.deepEqual(
    result.directionHandoff?.sourceCandidateRefs.map((candidate) => candidate.id),
    result.undergroundReport.convergenceReport.handoffCandidateRefs
  );
  assert.equal(
    result.directionHandoff?.sourceCandidateRefs.every((candidate) => !("outputId" in candidate)),
    true
  );
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

  assert.deepEqual(result.eventTypes.slice(0, 3), ["goal.received", "model.requested", "model.failed"]);
  assert.equal(result.terminalStatus, "stopped");
  assert.equal(result.loadedDirectionHandoffPackage.validation.passed, false);
  assert.equal(
    result.undergroundReport.rootletOutputs.some((output) => output.evidenceRefs.some((ref) => ref.startsWith("model-call:"))),
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
          output: { summary: "Secret-safe model advice." },
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
      structuredOutput: this.options.output ?? { summary: "Candidate advice from test provider." },
      finishReason: "stop",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }
}
