import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import { InMemoryEventLog } from "../events/in-memory-event-log.js";
import { nowIso } from "../id.js";
import { InMemoryMessageBus } from "../messages/in-memory-message-bus.js";
import { NativeIntelligenceChannel } from "./channel.js";
import { createFailedModelResponse } from "./failures.js";
import { pendingModelOutputValidation } from "./validation.js";

test("IntelligenceChannel rejects requests missing purpose, output contract, or budget", async () => {
  const { channel, eventLog } = createTestChannel();
  const request = {
    ...createValidModelRequest(),
    purpose: undefined,
    outputContract: undefined,
    budget: undefined,
  } as unknown as ModelRequest;

  const response = await channel.request(request);

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "request_validation");
  assert.deepEqual(eventLog.types(), ["model.failed"]);
  assert.equal(response.validation.issues.some((issue) => issue.code === "MODEL_PURPOSE_REQUIRED"), true);
  assert.equal(response.validation.issues.some((issue) => issue.code === "MODEL_OUTPUT_CONTRACT_REQUIRED"), true);
  assert.equal(response.validation.issues.some((issue) => issue.code === "MODEL_BUDGET_REQUIRED"), true);
});

test("IntelligenceChannel completed provider path emits model.requested then model.completed", async () => {
  const { channel, eventLog } = createTestChannel({
    output: { summary: "Candidate advice from fake provider." },
  });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed"]);
});

test("IntelligenceChannel failed provider path emits model.requested then model.failed", async () => {
  const { channel, eventLog } = createTestChannel({ fail: true });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
  assert.deepEqual(eventLog.types(), ["model.requested", "model.failed"]);
});

test("IntelligenceChannel turns contract-violating output into a failed response", async () => {
  const { channel, eventLog } = createTestChannel({ output: { rationale: "Missing required summary." } });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "output_validation");
  assert.equal(response.validation.status, "failed");
  assert.deepEqual(eventLog.types(), ["model.requested", "model.failed"]);
});

export function createValidModelRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    requestId: "model-request-test",
    traceId: "trace-test",
    callerRef: { kind: "goal", id: "goal-test" },
    purpose: "rootlet_candidate",
    inputRefs: [{ kind: "goal", id: "goal-test" }],
    sanitizedMessages: [{ role: "user", content: "Build a helper.", ref: "goal-test" }],
    outputContract: {
      contractId: "test.candidate.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["summary"],
      requiredStringFields: ["summary"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 128 },
    sensitivity: "internal",
    requestedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function createTestChannel(options: TestModelProviderOptions = {}) {
  const eventLog = new InMemoryEventLog();
  const bus = new InMemoryMessageBus(eventLog);
  const provider = new TestModelProvider(options);
  const channel = new NativeIntelligenceChannel({ provider, bus });
  return { channel, eventLog };
}

type TestModelProviderOptions = {
  readonly output?: unknown;
  readonly fail?: boolean;
};

class TestModelProvider implements ModelProvider {
  readonly providerId = "test-model-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "test-model";

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
      responseId: "model-response-test",
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
