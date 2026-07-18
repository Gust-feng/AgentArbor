import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOpenAICompatibleChatDialectControls,
  applyOpenAICompatibleChatRequestPolicy,
  resolveOpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";

test("Kimi K3 uses its top-level max reasoning effort and omits legacy Moonshot thinking", () => {
  const dialect = resolveOpenAICompatibleChatDialect({
    providerProfileId: "moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k3",
  });
  const controlled = applyOpenAICompatibleChatDialectControls({
    fields: { reasoning_effort: "high" },
    dialect,
  });
  const request = applyOpenAICompatibleChatRequestPolicy({
    fields: { ...controlled, temperature: 0.2, top_p: 0.8, tool_choice: "required" },
    dialect,
  });

  assert.equal(dialect.reasoningControl, "kimi_k3_reasoning_effort");
  assert.deepEqual(request, { reasoning_effort: "max", tool_choice: "required" });
});
