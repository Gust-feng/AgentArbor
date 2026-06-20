import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentArborLocalSettings } from "../../domain/config/index.js";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "./file-system-config-store.js";

test("FileSystemNormalSettingsStore writes settings through a same-directory temp file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-atomic-settings-"));
  const configDirectory = path.join(root, "nested", "config");
  const store = new FileSystemNormalSettingsStore(configDirectory);
  const renames: Array<{ from: string; to: string }> = [];
  const originalRename = fs.rename;
  fs.rename = (async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    renames.push({ from: path.resolve(String(from)), to: path.resolve(String(to)) });
    await originalRename(from, to);
  }) as typeof fs.rename;

  try {
    await store.writeSettings(createSettings("2026-06-20T00:00:00.000Z"));

    const settingsRaw = await fs.readFile(store.settingsPath, "utf8");
    const configEntries = await fs.readdir(configDirectory);
    const tempEntry = configEntries.find((entry) => entry.includes(".tmp"));

    assert.equal(renames.length, 1);
    assert.equal(renames[0]?.to, path.resolve(store.settingsPath));
    assert.equal(path.dirname(renames[0]!.from), path.resolve(configDirectory));
    assert.match(path.basename(renames[0]!.from), /^\.settings\.json\..+\.tmp$/);
    assert.equal(settingsRaw, `${JSON.stringify(createSettings("2026-06-20T00:00:00.000Z"), null, 2)}\n`);
    assert.equal(tempEntry, undefined);
  } finally {
    fs.rename = originalRename;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("FileSystemLocalDevSecretStore keeps JSON format while writing secrets atomically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-atomic-secrets-"));
  const store = new FileSystemLocalDevSecretStore(path.join(root, "config"));
  const renames: Array<{ from: string; to: string }> = [];
  const originalRename = fs.rename;
  fs.rename = (async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    renames.push({ from: path.resolve(String(from)), to: path.resolve(String(to)) });
    await originalRename(from, to);
  }) as typeof fs.rename;

  try {
    await store.writeSecret("secret://local-dev/test/api-key", "sk-test-secret");
    await store.deleteSecret("secret://local-dev/test/api-key");

    const secretsRaw = await fs.readFile(store.secretsPath, "utf8");
    const secrets = JSON.parse(secretsRaw) as { readonly secrets?: Record<string, unknown> };
    const configEntries = await fs.readdir(path.dirname(store.secretsPath));
    const tempEntry = configEntries.find((entry) => entry.includes(".tmp"));

    assert.equal(renames.length, 2);
    assert.deepEqual(
      renames.map((rename) => rename.to),
      [path.resolve(store.secretsPath), path.resolve(store.secretsPath)]
    );
    assert.deepEqual(
      renames.map((rename) => path.dirname(rename.from)),
      [path.resolve(path.dirname(store.secretsPath)), path.resolve(path.dirname(store.secretsPath))]
    );
    assert.equal(renames.every((rename) => /^\.local-dev-secrets\.json\..+\.tmp$/.test(path.basename(rename.from))), true);
    assert.equal(secretsRaw.endsWith("\n"), true);
    assert.deepEqual(secrets.secrets, {});
    assert.equal(tempEntry, undefined);
  } finally {
    fs.rename = originalRename;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function createSettings(updatedAt: string): AgentArborLocalSettings {
  return {
    version: 3,
    activeModelProfileId: "default",
    modelProvider: createModelProvider(updatedAt),
    modelProfiles: [createModelProvider(updatedAt)],
    updatedAt,
  };
}

function createModelProvider(updatedAt: string): AgentArborLocalSettings["modelProvider"] {
  return {
    profileId: "default",
    label: "OpenAI",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    defaultAiMode: "openai-compatible",
    secretRef: "secret://local-dev/model-provider/default/api-key",
    enabled: true,
    updatedAt,
  };
}
