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
  const tavilySecret = "tvly-local-dev-secret";
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
    const informationAccess = await configCenter.updateInformationAccessConfig({
      tavilyApiKey: tavilySecret,
      tavilyMaxResults: 3,
    });
    const webSearch = await configCenter.getWebSearchConfig();
    const env = await configCenter.createUndergroundAiEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(sanitized.secretConfigured, true);
    assert.equal(sanitized.baseUrl, "https://example.test");
    assert.equal(sanitized.model, "demo-model");
    assert.equal(sanitized.defaultAiMode, "openai-compatible");
    assert.equal(JSON.stringify(sanitized).includes(secret), false);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(secretsRaw.includes(secret), true);
    assert.equal(secretsRaw.includes(tavilySecret), true);
    assert.equal(env.AGENTARBOR_MODEL_API_KEY, secret);
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, tavilySecret);
    assert.equal(env.AGENTARBOR_TAVILY_MAX_RESULTS, "3");
    assert.equal(env.AGENTARBOR_INFORMATION_SOURCE_PREFERENCE, "web,codebase,soil,run_memory,docs,packages,github");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(informationAccess.web.secretConfigured, true);
    assert.equal(informationAccess.web.maxResults, 3);
    assert.equal(JSON.stringify(informationAccess).includes(tavilySecret), false);
    assert.equal(webSearch.provider, "tavily");
    assert.equal(webSearch.secretConfigured, true);
    assert.equal(webSearch.status, "ready");
    assert.equal(JSON.stringify(webSearch).includes(tavilySecret), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter web search compatibility API stores key only in secret store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-web-search-config-"));
  const tavilySecret = "tvly-web-search-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const updated = await configCenter.updateWebSearchConfig({
      provider: "tavily",
      apiKey: tavilySecret,
      maxResults: 2,
    });
    const fromGetter = await configCenter.getWebSearchConfig();
    const env = await configCenter.createUndergroundAiEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(updated.provider, "tavily");
    assert.equal(updated.status, "ready");
    assert.equal(updated.secretConfigured, true);
    assert.equal(updated.maxResults, 2);
    assert.equal(JSON.stringify(updated).includes(tavilySecret), false);
    assert.deepEqual(fromGetter, updated);
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, tavilySecret);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(secretsRaw.includes(tavilySecret), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter web search provider none disables Tavily environment projection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-web-search-disabled-"));
  const tavilySecret = "tvly-disabled-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.updateWebSearchConfig({
      provider: "tavily",
      apiKey: tavilySecret,
      maxResults: 4,
    });
    const disabled = await configCenter.updateWebSearchConfig({ provider: "none" });
    const informationAccess = await configCenter.getInformationAccessConfig();
    const env = await configCenter.createUndergroundAiEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(disabled.provider, "none");
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.secretConfigured, true);
    assert.equal(disabled.maxResults, 4);
    assert.equal(informationAccess.web.provider, "none");
    assert.equal(informationAccess.web.status, "disabled");
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, undefined);
    assert.equal(env.TAVILY_API_KEY, undefined);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(secretsRaw.includes(tavilySecret), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter reads v1 settings and upgrades information source settings to v2", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-v1-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const now = new Date("2026-05-04T00:00:00.000Z").toISOString();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      settingsStore.settingsPath,
      `${JSON.stringify(
        {
          version: 1,
          modelProvider: {
            profileId: "default",
            providerKind: "openai_compatible",
            protocolKind: "openai_compatible_chat_completions",
            baseUrl: "https://legacy.example",
            defaultAiMode: "fake",
            secretRef: "secret://local-dev/model-provider/default/api-key",
            updatedAt: now,
          },
          updatedAt: now,
        },
        null,
        2
      )}\n`
    );

    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const modelConfig = await configCenter.getModelProviderConfig();
    const defaultInformation = await configCenter.getInformationAccessConfig();
    const updatedInformation = await configCenter.updateInformationAccessConfig({
      sourcePreference: ["codebase", "web"],
      tavilyMaxResults: 2,
    });
    const settingsRaw = JSON.parse(await fs.readFile(settingsStore.settingsPath, "utf8")) as {
      version: number;
      informationAccess?: {
        sourcePreference?: readonly string[];
        tavily?: { maxResults?: number };
      };
    };

    assert.equal(modelConfig.baseUrl, "https://legacy.example");
    assert.equal(modelConfig.defaultAiMode, "fake");
    assert.equal(defaultInformation.web.maxResults, 5);
    assert.deepEqual(defaultInformation.sourcePreference, [
      "web",
      "codebase",
      "soil",
      "run_memory",
      "docs",
      "packages",
      "github",
    ]);
    assert.equal(updatedInformation.web.maxResults, 2);
    assert.deepEqual(updatedInformation.sourcePreference, ["codebase", "web"]);
    assert.equal(settingsRaw.version, 2);
    assert.deepEqual(settingsRaw.informationAccess?.sourcePreference, ["codebase", "web"]);
    assert.equal(settingsRaw.informationAccess?.tavily?.maxResults, 2);
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
