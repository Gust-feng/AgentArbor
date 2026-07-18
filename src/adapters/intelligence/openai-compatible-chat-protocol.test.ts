import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOpenAICompatibleChatDialectControls,
  applyOpenAICompatibleChatRequestPolicy,
  resolveOpenAICompatibleChatDialect,
} from "./openai-compatible-chat-protocol.js";

test("Kimi K3 omits the legacy Moonshot thinking field", () => {
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

  assert.equal(dialect.reasoningControl, "none");
  assert.deepEqual(request, { tool_choice: "required" });
});
