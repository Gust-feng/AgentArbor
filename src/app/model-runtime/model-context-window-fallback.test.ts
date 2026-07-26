import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../../adapters/config/index.js";
import { ConfigCenter } from "../config-center/index.js";
import { persistContextWindowFallback } from "./model-context-window-fallback.js";
import { resolveModelCapabilities } from "./model-capability-registry.js";

test("context window fallback writes a scoped 128K override without losing provider model capabilities", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-window-fallback-"));
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    await configCenter.createModelProviderProfile({
      profileId: "vendor-a",
      label: "Vendor A",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://vendor-a.example/v1",
      model: "shared-model",
      defaultAiMode: "openai-compatible",
    });
    await configCenter.createModelProviderProfile({
      profileId: "vendor-b",
      label: "Vendor B",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://vendor-b.example/v1",
      model: "shared-model",
      defaultAiMode: "openai-compatible",
    });
    await configCenter.updateModelCapabilityOverride({
      providerKind: "openai_compatible",
      model: "shared-model",
      capabilities: {
        maxOutputTokens: 12_000,
        supportsVisionInput: false,
      },
    });

    await persistContextWindowFallback({
      configCenter,
      event: {
        profileId: "vendor-a",
        providerKind: "openai_compatible",
        model: "shared-model",
        message: "This model's maximum context length is 128000 tokens.",
      },
    });

    const overrides = await configCenter.listModelCapabilityOverrides();
    const scoped = overrides.find((override) => override.profileId === "vendor-a");
    const profile = (await configCenter.listModelProviderProfiles()).find((item) => item.profileId === "vendor-a");
    const otherProfile = (await configCenter.listModelProviderProfiles()).find((item) => item.profileId === "vendor-b");
    assert.equal(scoped?.capabilities.contextWindowTokens, 128_000);
    assert.equal(overrides.find((override) => override.profileId === undefined)?.capabilities.maxOutputTokens, 12_000);
    assert.equal(profile?.model, "shared-model");
    assert.equal(
      resolveModelCapabilities({ profile: profile!, overrides }).contextWindowTokens,
      128_000
    );
    assert.equal(
      resolveModelCapabilities({ profile: otherProfile!, overrides }).contextWindowTokens,
      256_000
    );
    assert.equal(resolveModelCapabilities({ profile: profile!, overrides }).maxOutputTokens, 12_000);
    assert.equal(resolveModelCapabilities({ profile: profile!, overrides }).supportsVisionInput, false);
    assert.equal(resolveModelCapabilities({ profile: otherProfile!, overrides }).supportsVisionInput, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
