import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore, resolveAgentArborConfigDirectory } from "../adapters/config/index.js";
import { ConfigCenter } from "./config-center.js";

test("ConfigCenter keeps raw API key out of the normal settings store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-center-"));
  const secret = "sk-local-dev-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const sanitized = await configCenter.updateModelProviderConfig({
      baseUrl: "https://example.test/",
      model: "demo-model",
      defaultAiMode: "openai-compatible",
      apiKey: secret,
    });
    const env = await configCenter.createUndergroundAiEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(sanitized.secretConfigured, true);
    assert.equal(sanitized.baseUrl, "https://example.test");
    assert.equal(sanitized.model, "demo-model");
    assert.equal(sanitized.defaultAiMode, "openai-compatible");
    assert.equal(JSON.stringify(sanitized).includes(secret), false);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(secretsRaw.includes(secret), true);
    assert.equal(env.AGENTARBOR_MODEL_API_KEY, secret);
    assert.equal(env.OPENAI_API_KEY, undefined);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter defaults to no AI and resolves explicit config directory outside tests", async () => {
  const directory = path.join(os.tmpdir(), "agentarbor-explicit-config");
  const resolved = resolveAgentArborConfigDirectory({
    env: { AGENTARBOR_CONFIG_DIR: directory },
    homeDirectory: path.join(os.tmpdir(), "home"),
    platform: "linux",
  });

  assert.equal(resolved, path.resolve(directory));
});

test("default local config directory resolves outside the repository", () => {
  const localAppData = path.join(os.tmpdir(), "agentarbor-local-app-data");
  const resolved = resolveAgentArborConfigDirectory({
    env: { LOCALAPPDATA: localAppData },
    homeDirectory: path.join(os.tmpdir(), "home"),
    platform: "win32",
  });

  assert.equal(resolved, path.join(localAppData, "AgentArbor", "config"));
  assert.equal(path.resolve(resolved).startsWith(path.resolve(process.cwd())), false);
});
