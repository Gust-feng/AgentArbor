import assert from "node:assert/strict";
import test from "node:test";
import type { ModelOutputContract, ModelResponse } from "../../domain/intelligence/index.js";
import { createModelVisibleOutputProjection } from "./safe-visible-output.js";

test("model visible output projection preserves text whitespace", () => {
  const projection = createModelVisibleOutputProjection({
    outputContract: textContract(),
    response: completedTextResponse("\n\n- 第一项\n- 第二项\n"),
  });

  assert.equal(projection?.items[0]?.fields[0]?.value, "\n\n- 第一项\n- 第二项\n");
});

function textContract(): ModelOutputContract {
  return {
    contractId: "test.visible_text.v1",
    outputKind: "explanation",
    format: "text",
  };
}

function completedTextResponse(textOutput: string): ModelResponse {
  return {
    requestId: "request-1",
    responseId: "response-1",
    providerId: "provider-test",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "model-test",
    status: "completed",
    outputKind: "explanation",
    textOutput,
    finishReason: "stop",
    validation: {
      status: "passed",
      checkedAt: "2026-06-04T00:00:00.000Z",
      issues: [],
    },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
    },
    completedAt: "2026-06-04T00:00:00.000Z",
  };
}
