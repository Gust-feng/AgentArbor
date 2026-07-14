import assert from "node:assert/strict";
import test from "node:test";
import type { ModelResponse } from "../../domain/intelligence/index.js";
import {
  modelContextMessagesForNextTurn,
  ordinaryModelContextFromTurn,
} from "./model-context.js";

test("ordinary model context persists the exact text/tool chain and final Responses output items", () => {
  const context = ordinaryModelContextFromTurn({
    runId: "run-context",
    contextMessages: [
      { role: "system", content: "root", ref: "context:system:desktop-agent" },
      { role: "user", content: "read it", ref: "context:goal:first" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-1", toolName: "read_file", input: { path: "a.ts" } }],
        protocolExtensions: {
          response_id: "resp-tool",
          openai_responses_output_items: [{ type: "function_call", call_id: "call-1", name: "read_file", arguments: "{}" }],
          unknown_provider_state: { mustNotPersist: true },
        },
      },
      {
        role: "tool",
        content: "file body",
        toolCallId: "call-1",
        toolName: "read_file",
        attachments: [{
          kind: "file",
          source: { kind: "data", mimeType: "text/plain", data: "ZmlsZSBib2R5" },
          filename: "a.ts",
        }],
      },
    ],
    finalOutput: completedResponsesOutput(),
    completed: true,
  });

  assert.ok(context);
  assert.deepEqual(context.messages.map((message) => message.role), ["system", "user", "assistant", "tool", "assistant"]);
  assert.equal(context.messages[3]?.attachments, undefined);
  assert.deepEqual(Object.keys(context.messages[2]?.protocolExtensions ?? {}), ["openai_responses_output_items"]);
  assert.equal(context.messages[4]?.content, "done");
  assert.deepEqual(context.messages[4]?.protocolExtensions?.openai_responses_output_items, [
    { type: "reasoning", encrypted_content: "opaque-reasoning" },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "done" }],
    },
  ]);
  assert.deepEqual(modelContextMessagesForNextTurn(context).map((message) => message.role), [
    "user", "assistant", "tool", "assistant",
  ]);
});

function completedResponsesOutput(): ModelResponse {
  const outputItems = [
    { type: "reasoning", encrypted_content: "opaque-reasoning" },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "done" }],
    },
  ];
  return {
    responseId: "resp-final",
    requestId: "request-final",
    providerId: "openai-responses",
    providerKind: "openai_compatible",
    protocolKind: "openai_responses",
    model: "gpt-4.1",
    status: "completed",
    outputKind: "explanation",
    textOutput: "done",
    assistantMessage: {
      role: "assistant",
      content: "done",
      protocolExtensions: {
        response_id: "resp-final",
        openai_responses_output_items: outputItems,
      },
    },
    finishReason: "stop",
    validation: { status: "passed", checkedAt: "2026-07-14T00:00:00.000Z", issues: [] },
    completedAt: "2026-07-14T00:00:00.000Z",
  };
}
