import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createPanelRunTracking } from "./panel-run-tracking.js";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../domain/config/index.js";

test("panel run tracking derives safe provider context and event totals", () => {
  const tracking = createPanelRunTracking({
    status: "running",
    config: {
      profileId: "default",
      defaultAiMode: "openai-compatible",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.example.test/v1",
      model: "example-model",
      secretRef: "model-provider-api-key",
      secretConfigured: true,
      updatedAt: "2026-05-07T00:00:00.000Z",
      openAI: {},
    } satisfies SanitizedModelProviderConfig,
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    eventEntries: [
      eventEntry(1, "goal.received", {}),
      eventEntry(2, "model.requested", { requestId: "request-1" }),
      eventEntry(3, "tool.requested", { toolCallId: "tool-1" }),
      eventEntry(4, "tool.completed", { toolCallId: "tool-1" }),
      eventEntry(5, "context.compaction.completed", {
        tokenCount: 320,
        threshold: 400,
        coveredRefCount: 3,
        summary: "Earlier context was safely summarized.",
      }),
    ],
  });

  assert.equal(tracking.provider.status, "ready");
  assert.deepEqual(tracking.modelTotals, { requested: 1, completed: 0, failed: 0 });
  assert.deepEqual(tracking.toolTotals, { requested: 1, completed: 1, failed: 0 });
  assert.equal(tracking.context.compaction.latest?.summary, "Earlier context was safely summarized.");
  assert.equal(JSON.stringify(tracking).includes("sk-secret"), false);
});

test("panel run tracking reports provider configuration boundaries without secret values", () => {
  const tracking = createPanelRunTracking({
    status: "failed",
    config: {
      profileId: "default",
      defaultAiMode: "openai-compatible",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.example.test/v1",
      secretRef: "model-provider-api-key",
      secretConfigured: false,
      updatedAt: "2026-05-07T00:00:00.000Z",
      openAI: {},
    } satisfies SanitizedModelProviderConfig,
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    eventEntries: [],
  });

  assert.equal(tracking.provider.status, "missing_model_and_secret");
  assert.equal(tracking.run.waitingPoint, "运行失败，查看错误摘要。");
  assert.equal(JSON.stringify(tracking).includes("apiKey"), false);
});

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "tavily-api-key",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}

function eventEntry(sequence: number, type: ArborMessageType, payload: Record<string, unknown>): EventLogEntry {
  const message: ArborMessage = {
    id: `message-${sequence}`,
    traceId: "trace-panel-tracking",
    from: { id: "test", role: "system" },
    type,
    intent: type.replaceAll(".", "_"),
    payload,
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence,
    type,
    message,
    recordedAt: "2026-05-07T00:00:00.000Z",
  };
}
