import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { FakeModelProvider } from "./fake-model-provider.js";

test("FakeModelProvider completed path emits model.requested then model.completed", async () => {
  const { channel, eventLog } = createFakeProviderChannel({
    output: { summary: "Candidate advice from fake provider." },
  });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal(response.usage, undefined);
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed"]);
});

test("FakeModelProvider failed path emits model.requested then model.failed", async () => {
  const { channel, eventLog } = createFakeProviderChannel({ fail: true });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
  assert.deepEqual(eventLog.types(), ["model.requested", "model.failed"]);
});

function createFakeProviderChannel(options: ConstructorParameters<typeof FakeModelProvider>[0] = {}) {
  const eventLog = new InMemoryEventLog();
  const bus = new InMemoryMessageBus(eventLog);
  const provider = new FakeModelProvider(options);
  const channel = new NativeIntelligenceChannel({ provider, bus });
  return { channel, eventLog };
}

function createValidModelRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
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
