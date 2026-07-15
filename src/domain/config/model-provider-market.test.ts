import assert from "node:assert/strict";
import test from "node:test";
import {
  listBuiltinModelProviderPresets,
  listBuiltinProviderProtocolProfiles,
} from "./model-provider-market.js";

const SUPPORTED_PROTOCOLS = new Set([
  "openai_responses",
  "openai_compatible_chat_completions",
]);

test("model provider market exposes only the two production OpenAI protocols", () => {
  const profiles = listBuiltinProviderProtocolProfiles();
  const presets = listBuiltinModelProviderPresets();

  assert.deepEqual(
    profiles.map((profile) => profile.profileId),
    ["openai", "deepseek", "moonshot", "glm", "minimax", "openai_compatible"]
  );
  assert.deepEqual(
    presets.map((preset) => preset.presetId),
    ["openai", "deepseek", "moonshot", "glm", "minimax"]
  );
  assert.equal(
    [...profiles, ...presets].every((entry) => entry.providerKind === "openai_compatible"),
    true
  );
  assert.equal(
    [...profiles, ...presets].every((entry) =>
      SUPPORTED_PROTOCOLS.has(
        "recommendedProtocolKind" in entry ? entry.recommendedProtocolKind : entry.protocolKind
      ) && (entry.supportedProtocolKinds ?? []).every((protocol) => SUPPORTED_PROTOCOLS.has(protocol))
    ),
    true
  );
});
