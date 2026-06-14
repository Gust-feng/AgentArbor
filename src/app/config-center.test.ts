import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ModelCapabilities } from "../domain/config/index.js";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore, resolveAgentArborConfigDirectory } from "../adapters/config/index.js";
import { ConfigCenter, ConfigCenterValidationError } from "./config-center.js";
import { toSanitizedCommandShellConfig } from "./config-center/command-shell-settings.js";

test("config settings schema keeps OpenAI request settings split", async () => {
  const [settingsSchema, openAIRequestSettings] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "settings-schema.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "openai-request-settings.ts"), "utf8"),
  ]);

  assert.equal(settingsSchema.includes('from "./openai-request-settings.js"'), true);
  assert.equal(settingsSchema.includes("export function normalizeOpenAIModelRequestSettings"), false);
  assert.equal(settingsSchema.includes("function parseOpenAIModelRequestSettings"), false);
  assert.equal(settingsSchema.includes("function normalizeOpenAIReasoningEffort"), false);
  assert.equal(settingsSchema.includes("function parseOpenAIReasoningEffort"), false);
  assert.equal(openAIRequestSettings.includes("export function normalizeOpenAIModelRequestSettings"), true);
  assert.equal(openAIRequestSettings.includes("export function parseOpenAIModelRequestSettings"), true);
  assert.equal(openAIRequestSettings.includes("function normalizeOpenAIReasoningEffort"), true);
  assert.equal(openAIRequestSettings.includes("function parseOpenAIReasoningEffort"), true);
});

test("config settings schema keeps model provider settings split", async () => {
  const [settingsSchema, modelProviderSettings, profileSettings, catalogSettings, capabilitySettings, commonSettings] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "settings-schema.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "model-provider-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "model-provider-profile-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "model-provider-catalog-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "model-provider-capability-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "model-provider-common.ts"), "utf8"),
  ]);

  assert.equal(settingsSchema.includes('from "./model-provider-settings.js"'), true);
  assert.equal(settingsSchema.includes("export function normalizeModelProfile"), false);
  assert.equal(settingsSchema.includes("function parseModelProfile"), false);
  assert.equal(settingsSchema.includes("function parseModelCatalogs"), false);
  assert.equal(settingsSchema.includes("function parseModelCapabilityOverrides"), false);
  assert.equal(settingsSchema.includes("function normalizeModelCatalogs"), false);
  assert.equal(settingsSchema.includes("function normalizeModelCapabilityOverrides"), false);
  assert.equal(settingsSchema.includes("function createDefaultProfile"), false);
  assert.equal(settingsSchema.includes("function defaultProtocolForProfile"), false);
  assert.equal(modelProviderSettings.trim().split(/\r?\n/).every((line) => line.startsWith("export * from ")), true);
  assert.equal(profileSettings.includes("export function normalizeModelProfile"), true);
  assert.equal(profileSettings.includes("export function parseModelProfile"), true);
  assert.equal(catalogSettings.includes("export function parseModelCatalogs"), true);
  assert.equal(catalogSettings.includes("export function normalizeModelCatalogs"), true);
  assert.equal(capabilitySettings.includes("export function parseModelCapabilityOverrides"), true);
  assert.equal(capabilitySettings.includes("export function normalizeModelCapabilityOverrides"), true);
  assert.equal(commonSettings.includes("export const DEFAULT_MODEL_PROVIDER_BASE_URL"), true);
  assert.equal(commonSettings.includes("export function normalizeProfileId"), true);
});

test("config settings schema keeps tool and MCP settings split", async () => {
  const [settingsSchema, toolMcpSettings, settingsUtils] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "settings-schema.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "tool-mcp-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "settings-utils.ts"), "utf8"),
  ]);

  assert.equal(settingsSchema.includes('from "./tool-mcp-settings.js"'), true);
  assert.equal(settingsSchema.includes('from "./settings-utils.js"'), true);
  assert.equal(settingsSchema.includes("export function sanitizeMcpArgs"), false);
  assert.equal(settingsSchema.includes("export function parseMcpCommandLine"), false);
  assert.equal(settingsSchema.includes("function parseToolStates"), false);
  assert.equal(settingsSchema.includes("function parseMcpServers"), false);
  assert.equal(settingsSchema.includes("function normalizeToolStates"), false);
  assert.equal(settingsSchema.includes("function normalizeMcpServers"), false);
  assert.equal(settingsSchema.includes("function requiredString"), false);
  assert.equal(settingsSchema.includes("function asRecord"), false);
  assert.equal(toolMcpSettings.includes("export function sanitizeMcpArgs"), true);
  assert.equal(toolMcpSettings.includes("export function parseMcpCommandLine"), true);
  assert.equal(toolMcpSettings.includes("export function parseToolStates"), true);
  assert.equal(toolMcpSettings.includes("export function parseMcpServers"), true);
  assert.equal(toolMcpSettings.includes("export function normalizeToolStates"), true);
  assert.equal(toolMcpSettings.includes("export function normalizeMcpServers"), true);
  assert.equal(settingsUtils.includes("export function requiredString"), true);
  assert.equal(settingsUtils.includes("export function asRecord"), true);
});

test("ConfigCenter keeps projections and workspace validation split from orchestration", async () => {
  const [configCenter, projections, workspaceSettings] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "projections.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "workspace-settings.ts"), "utf8"),
  ]);

  assert.equal(configCenter.includes('from "./config-center/projections.js"'), true);
  assert.equal(configCenter.includes('from "./config-center/workspace-settings.js"'), true);
  assert.equal(configCenter.includes("private async toSanitizedConfig"), false);
  assert.equal(configCenter.includes("private async toSanitizedModelProfile"), false);
  assert.equal(configCenter.includes("private async toSanitizedInformationAccessConfig"), false);
  assert.equal(configCenter.includes("private async toSanitizedWebSearchConfig"), false);
  assert.equal(configCenter.includes("private toSanitizedWorkspaceConfig"), false);
  assert.equal(configCenter.includes("async function normalizeWorkspaceDirectory"), false);
  assert.equal(configCenter.includes("async function ensureWorkspaceReady"), false);
  assert.equal(configCenter.includes("function normalizeConfiguredWorkspaceDirectory"), false);
  assert.equal(configCenter.includes("function resolveDefaultWorkspaceDirectory"), false);
  assert.equal(configCenter.includes("class WorkspaceDirectoryValidationError"), false);
  assert.equal(projections.includes("export async function toSanitizedModelProviderConfig"), true);
  assert.equal(projections.includes("export async function toSanitizedModelProfile"), true);
  assert.equal(projections.includes("export async function toSanitizedInformationAccessConfig"), true);
  assert.equal(projections.includes("export async function toSanitizedWebSearchConfig"), true);
  assert.equal(projections.includes("export function toSanitizedWorkspaceConfig"), true);
  assert.equal(workspaceSettings.includes("export class WorkspaceDirectoryValidationError"), true);
  assert.equal(workspaceSettings.includes("export async function normalizeWorkspaceDirectory"), true);
  assert.equal(workspaceSettings.includes("export function normalizeConfiguredWorkspaceDirectory"), true);
});

test("command shell auto mode prefers Windows shells that avoid cmd quoting traps", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-shell-"));
  try {
    const fakeGitBash = path.join(directory, "bash.exe");
    await fs.writeFile(fakeGitBash, "", "utf8");

    const gitBash = toSanitizedCommandShellConfig(undefined, {
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash },
      now: "test",
    });
    const powerShell = toSanitizedCommandShellConfig(undefined, {
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" },
      now: "test",
    });
    const explicitCmd = toSanitizedCommandShellConfig({ kind: "cmd", updatedAt: "test" }, {
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash },
      now: "test",
    });

    assert.equal(gitBash.kind, "bash");
    assert.equal(gitBash.syntax, "posix");
    assert.equal(gitBash.executable, fakeGitBash);
    assert.equal(powerShell.kind, "powershell");
    assert.equal(powerShell.syntax, "powershell");
    assert.equal(explicitCmd.kind, "cmd");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

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
      openAI: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2_000,
        reasoningEffort: "high",
        reasoningSummary: "auto",
        textVerbosity: "medium",
        serviceTier: "default",
        truncation: "auto",
        stream: false,
        parallelToolCalls: true,
        store: false,
      },
      apiKey: secret,
    });
    const informationAccess = await configCenter.updateInformationAccessConfig({
      tavilyApiKey: tavilySecret,
      tavilyMaxResults: 3,
    });
    const webSearch = await configCenter.getWebSearchConfig();
    const env = await configCenter.createModelRuntimeEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(sanitized.secretConfigured, true);
    assert.equal(sanitized.baseUrl, "https://example.test");
    assert.equal(sanitized.model, "demo-model");
    assert.deepEqual(sanitized.openAI, {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 2_000,
      reasoningEffort: "high",
      reasoningSummary: "auto",
      textVerbosity: "medium",
      serviceTier: "default",
      truncation: "auto",
      stream: false,
      parallelToolCalls: true,
      store: false,
    });
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

test("ConfigCenter clears saved model provider API keys explicitly", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-clear-model-key-"));
  const secret = "sk-clear-model-provider-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const saved = await configCenter.updateModelProviderConfig({
      baseUrl: "https://example.test/v1",
      model: "demo-model",
      defaultAiMode: "openai-compatible",
      apiKey: secret,
    });
    const staleSecret = "sk-clear-should-not-be-written-back";
    const cleared = await configCenter.updateModelProviderConfig({
      apiKey: staleSecret,
      clearApiKey: true,
    });
    const apiKey = await configCenter.getModelProviderApiKey();
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(saved.secretConfigured, true);
    assert.equal(cleared.secretConfigured, false);
    assert.equal(apiKey, undefined);
    assert.equal(secretsRaw.includes(secret), false);
    assert.equal(secretsRaw.includes(staleSecret), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter clears model names explicitly and does not inherit them into new profiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-clear-model-name-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const saved = await configCenter.updateModelProviderConfig({
      baseUrl: "https://provider.example",
      model: "custom-chat",
      defaultAiMode: "openai-compatible",
    });
    const created = await configCenter.createModelProviderProfile({
      profileId: "anthropic",
      label: "Anthropic",
      providerKind: "anthropic",
      protocolKind: "anthropic_messages",
      baseUrl: "https://api.anthropic.com",
      defaultAiMode: "openai-compatible",
    });
    const cleared = await configCenter.updateModelProviderConfig({
      clearModel: true,
    });
    const env = await configCenter.createModelRuntimeEnvironment();

    assert.equal(saved.model, "custom-chat");
    assert.equal(cleared.model, undefined);
    assert.equal(created.model, undefined);
    assert.equal(env.AGENTARBOR_MODEL_NAME, undefined);
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
    const env = await configCenter.createModelRuntimeEnvironment();
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
    const env = await configCenter.createModelRuntimeEnvironment();
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

test("ConfigCenter can build a model runtime environment from frozen run information access", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-frozen-information-access-"));
  const currentSecret = "tvly-current-information-secret";
  const frozenSecret = "tvly-frozen-information-secret";
  const frozenSecretRef = "secret://local-dev/information-source/tavily/frozen/api-key";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.updateWebSearchConfig({
      provider: "tavily",
      apiKey: currentSecret,
      maxResults: 9,
    });
    await secretStore.writeSecret(frozenSecretRef, frozenSecret);
    const env = await configCenter.createModelRuntimeEnvironment({
      informationAccess: {
        sourcePreference: ["docs", "web"],
        web: {
          provider: "tavily",
          providerKind: "tavily",
          maxResults: 2,
          secretRef: frozenSecretRef,
          secretConfigured: true,
          status: "ready",
          updatedAt: "2026-06-06T00:00:00.000Z",
        },
      },
    });

    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, frozenSecret);
    assert.equal(env.AGENTARBOR_TAVILY_MAX_RESULTS, "2");
    assert.equal(env.AGENTARBOR_INFORMATION_SOURCE_PREFERENCE, "docs,web");
    assert.notEqual(env.AGENTARBOR_TAVILY_API_KEY, currentSecret);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter reads v1 settings and upgrades local settings to v3", async () => {
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
      activeModelProfileId?: string;
      modelProfiles?: readonly unknown[];
      modelCatalogs?: readonly unknown[];
      modelCapabilityOverrides?: readonly unknown[];
      toolStates?: readonly unknown[];
      mcpServers?: readonly unknown[];
      informationAccess?: {
        sourcePreference?: readonly string[];
        tavily?: { maxResults?: number };
      };
    };

    assert.equal(modelConfig.baseUrl, "https://legacy.example");
    assert.equal(modelConfig.defaultAiMode, "openai-compatible");
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
    assert.equal(settingsRaw.version, 3);
    assert.equal(settingsRaw.activeModelProfileId, "default");
    assert.equal(settingsRaw.modelProfiles?.length, 1);
    assert.deepEqual(settingsRaw.modelCatalogs, []);
    assert.deepEqual(settingsRaw.modelCapabilityOverrides, []);
    assert.deepEqual(settingsRaw.toolStates, []);
    assert.deepEqual(settingsRaw.mcpServers, []);
    assert.deepEqual(settingsRaw.informationAccess?.sourcePreference, ["codebase", "web"]);
    assert.equal(settingsRaw.informationAccess?.tavily?.maxResults, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter repairs built-in model provider drift without overwriting custom proxy profiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-builtin-provider-drift-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const now = new Date("2026-05-19T00:00:00.000Z").toISOString();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      settingsStore.settingsPath,
      `${JSON.stringify(
        {
          version: 3,
          activeModelProfileId: "default",
          modelProvider: {
            profileId: "default",
            label: "OpenAI",
            providerKind: "openai_compatible",
            protocolKind: "openai_compatible_chat_completions",
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-pro",
            defaultAiMode: "fake",
            secretRef: "secret://local-dev/model-provider/default/api-key",
            enabled: true,
            updatedAt: now,
          },
          modelProfiles: [
            {
              profileId: "default",
              label: "OpenAI",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://api.deepseek.com",
              model: "deepseek-v4-pro",
              defaultAiMode: "fake",
              secretRef: "secret://local-dev/model-provider/default/api-key",
              enabled: true,
              updatedAt: now,
            },
            {
              profileId: "deepseek",
              label: "DeepSeek",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://api.deepseek.com",
              model: "deepseek-v4-pro",
              defaultAiMode: "openai-compatible",
              secretRef: "secret://local-dev/model-provider/deepseek/api-key",
              enabled: true,
              updatedAt: now,
            },
            {
              profileId: "ai",
              label: "智谱 AI",
              providerKind: "openai_compatible",
              protocolKind: "openai_responses",
              baseUrl: "https://open.bigmodel.cn/api/paas/v4",
              model: "glm-4.5",
              defaultAiMode: "openai-responses",
              secretRef: "secret://local-dev/model-provider/ai/api-key",
              enabled: true,
              updatedAt: now,
            },
            {
              profileId: "claude",
              label: "Claude",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://api.anthropic.com",
              model: "deepseek-v4-pro",
              defaultAiMode: "openai-compatible",
              secretRef: "secret://local-dev/model-provider/claude/api-key",
              enabled: true,
              updatedAt: now,
            },
            {
              profileId: "claude-proxy",
              label: "Claude Proxy",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://openrouter.ai/api/v1",
              model: "anthropic/claude-sonnet-4",
              defaultAiMode: "openai-compatible",
              secretRef: "secret://local-dev/model-provider/claude-proxy/api-key",
              enabled: true,
              updatedAt: now,
            },
            {
              profileId: "openai",
              label: "OpenAI Proxy",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://openrouter.ai/api/v1",
              model: "deepseek-proxy-model",
              defaultAiMode: "openai-compatible",
              secretRef: "secret://local-dev/model-provider/openai/api-key",
              enabled: true,
              updatedAt: now,
            },
          ],
          modelCatalogs: [
            {
              profileId: "deepseek",
              label: "DeepSeek",
              baseUrl: "https://api.deepseek.com",
              modelsPath: "/models",
              fetchedAt: now,
              models: [{ id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", owner: "deepseek" }],
            },
          ],
          updatedAt: now,
        },
        null,
        2
      )}\n`
    );

    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const active = await configCenter.getModelProviderConfig();
    const profiles = await configCenter.listModelProviderProfiles();
    const openai = profiles.find((profile) => profile.profileId === "default");
    const anthropic = profiles.find((profile) => profile.profileId === "claude");
    const deepseek = profiles.find((profile) => profile.profileId === "deepseek");
    const glmAlias = profiles.find((profile) => profile.profileId === "ai");
    const proxy = profiles.find((profile) => profile.profileId === "claude-proxy");
    const openaiProxy = profiles.find((profile) => profile.profileId === "openai");

    assert.equal(active.profileId, "default");
    assert.equal(openai?.label, "OpenAI");
    assert.equal(openai?.baseUrl, "https://api.openai.com/v1");
    assert.equal(openai?.protocolKind, "openai_responses");
    assert.equal(openai?.defaultAiMode, "openai-responses");
    assert.equal(openai?.model, undefined);
    assert.equal(anthropic?.label, "Anthropic");
    assert.equal(anthropic?.providerKind, "anthropic");
    assert.equal(anthropic?.protocolKind, "anthropic_messages");
    assert.equal(anthropic?.baseUrl, "https://api.anthropic.com");
    assert.equal(anthropic?.model, undefined);
    assert.equal(deepseek?.model, "deepseek-v4-pro");
    assert.equal(deepseek?.protocolKind, "openai_compatible_chat_completions");
    assert.equal(glmAlias?.label, "智谱 AI");
    assert.equal(glmAlias?.protocolKind, "openai_compatible_chat_completions");
    assert.equal(glmAlias?.defaultAiMode, "openai-compatible");
    assert.equal(glmAlias?.model, "glm-4.5");
    assert.equal(proxy?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(proxy?.model, "anthropic/claude-sonnet-4");
    assert.equal(openaiProxy?.label, "OpenAI");
    assert.equal(openaiProxy?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(openaiProxy?.model, "deepseek-proxy-model");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter manages model profiles and keeps profile secrets scoped", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-profiles-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.updateModelProviderConfig({
      model: "gpt-4o-mini",
      apiKey: "sk-default-profile-secret",
    });
    const created = await configCenter.createModelProviderProfile({
      profileId: "Claude Proxy",
      label: "Claude Proxy",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "anthropic/claude-sonnet-4",
      defaultAiMode: "openai-compatible",
      apiKey: "sk-proxy-secret",
    });
    const activated = await configCenter.activateModelProviderProfile("claude-proxy");
    const env = await configCenter.createModelRuntimeEnvironment({ modelProvider: activated });
    const profiles = await configCenter.listModelProviderProfiles();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");

    assert.equal(created.profileId, "claude-proxy");
    assert.equal(created.secretConfigured, true);
    assert.equal(created.protocolKind, "openai_compatible_chat_completions");
    assert.equal(activated.profileId, "claude-proxy");
    assert.equal(activated.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(env.AGENTARBOR_MODEL_API_KEY, "sk-proxy-secret");
    assert.equal(env.AGENTARBOR_MODEL_NAME, "anthropic/claude-sonnet-4");
    assert.equal(profiles.length, 2);
    assert.equal(settingsRaw.includes("sk-default-profile-secret"), false);
    assert.equal(settingsRaw.includes("sk-proxy-secret"), false);
    await assert.rejects(
      () => configCenter.deleteModelProviderProfile("claude-proxy"),
      ConfigCenterValidationError
    );
    const remaining = await configCenter.deleteModelProviderProfile("default");
    assert.equal(remaining.some((profile) => profile.profileId === "default"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter persists model catalogs and removes them with deleted profiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-model-catalogs-"));
  const secret = "sk-catalog-profile-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.createModelProviderProfile({
      profileId: "deepseek",
      label: "DeepSeek",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      defaultAiMode: "openai-compatible",
      apiKey: secret,
    });
    const saved = await configCenter.upsertModelProviderModelCatalog({
      profileId: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      modelsPath: "/models",
      fetchedAt: "2026-05-19T00:00:00.000Z",
      models: [
        { id: "deepseek-chat", displayName: "deepseek-chat", owner: "deepseek" },
        { id: "deepseek-reasoner", displayName: "deepseek-reasoner", owner: "deepseek" },
      ],
    });
    const reloaded = new ConfigCenter({ settingsStore, secretStore });
    const catalogs = await reloaded.listModelProviderModelCatalogs();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    await reloaded.upsertModelProviderModelCatalog({
      ...saved,
      models: [{ id: "deepseek-reasoner", displayName: "deepseek-reasoner", owner: "deepseek" }],
    });
    const clearedProfile = (await reloaded.listModelProviderProfiles()).find((profile) => profile.profileId === "deepseek");
    const remainingProfiles = await reloaded.deleteModelProviderProfile("deepseek");
    const remainingCatalogs = await reloaded.listModelProviderModelCatalogs();

    assert.equal(saved.profileId, "deepseek");
    assert.deepEqual(catalogs.map((catalog) => catalog.profileId), ["deepseek"]);
    assert.deepEqual(catalogs[0]?.models.map((model) => model.id), ["deepseek-chat", "deepseek-reasoner"]);
    assert.equal(settingsRaw.includes("deepseek-chat"), true);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(clearedProfile?.model, undefined);
    assert.equal(remainingProfiles.some((profile) => profile.profileId === "deepseek"), false);
    assert.equal(remainingCatalogs.length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter removes a model catalog when its saved model list is empty", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-empty-model-catalog-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.createModelProviderProfile({
      profileId: "deepseek",
      label: "DeepSeek",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      defaultAiMode: "openai-compatible",
    });
    await configCenter.upsertModelProviderModelCatalog({
      profileId: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      modelsPath: "/models",
      fetchedAt: "2026-05-19T00:00:00.000Z",
      models: [{ id: "deepseek-chat", displayName: "deepseek-chat" }],
    });
    const emptyCatalog = await configCenter.upsertModelProviderModelCatalog({
      profileId: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      modelsPath: "/models",
      fetchedAt: "2026-05-19T00:01:00.000Z",
      models: [],
    });
    const catalogs = await configCenter.listModelProviderModelCatalogs();
    const profile = (await configCenter.listModelProviderProfiles()).find((item) => item.profileId === "deepseek");

    assert.deepEqual(emptyCatalog.models, []);
    assert.equal(catalogs.length, 0);
    assert.equal(profile?.model, undefined);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter stores capability overrides, tool states, and MCP settings without raw secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-capabilities-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const overrides = await configCenter.updateModelCapabilityOverride({
      providerKind: "openai_compatible",
      model: "custom-model",
      capabilities: {
        contextWindowTokens: 64_000,
        maxOutputTokens: 8_000,
        supportsToolCalling: true,
        supportsStructuredOutputs: true,
        preferredApiStyle: "invalid-style",
        stability: "secret-stability",
        lastVerifiedAt: "sk-do-not-store",
      } as unknown as Partial<ModelCapabilities>,
    });
    const safeOverride = await configCenter.updateModelCapabilityOverride({
      providerKind: "openai_compatible",
      model: "safe-custom-model",
      capabilities: {
        preferredApiStyle: "responses",
        stability: "preview",
        lastVerifiedAt: "2026-05-12",
      },
    });
    const toolStates = await configCenter.updateToolState({ name: "shell_command", enabled: false });
    const mcpServers = await configCenter.upsertMcpServer({
      serverId: "local-docs",
      label: "Local Docs",
      transport: "stdio",
      commandLine: 'node "server.js" --token=secret-value --api-key sk-separated-secret',
      envSecretRefs: ["secret://local-dev/mcp/local-docs/token"],
      bearerTokenSecretRef: "secret://local-dev/mcp/local-docs/bearer",
      confirmationMode: "unsafe_only",
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
      autoApprovedTools: [],
      enabled: true,
    });
    await assert.rejects(
      () =>
        configCenter.writeMcpServerSecretValue({
          serverId: "local-docs",
          secretRef: "secret://local-dev/mcp/local-docs/not-declared",
          value: "should-not-write",
        }),
      /not declared/
    );
    const secret = await configCenter.writeMcpServerSecretValue({
      serverId: "local-docs",
      secretRef: "secret://local-dev/mcp/local-docs/token",
      value: "mcp-token-value",
    });
    const bearer = await configCenter.writeMcpServerSecretValue({
      serverId: "local-docs",
      secretRef: "secret://local-dev/mcp/local-docs/bearer",
      value: "mcp-bearer-value",
    });
    const mcpEnv = await configCenter.createMcpRuntimeEnvironment({
      servers: [
        {
          envSecretRefs: ["secret://local-dev/mcp/local-docs/token"],
          bearerTokenSecretRef: "secret://local-dev/mcp/local-docs/bearer",
        },
      ],
    });
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");

    assert.equal(overrides[0]?.capabilities.contextWindowTokens, 64_000);
    assert.equal(overrides[0]?.capabilities.supportsToolCalling, true);
    assert.equal(overrides[0]?.capabilities.preferredApiStyle, undefined);
    assert.equal(overrides[0]?.capabilities.stability, undefined);
    assert.equal(overrides[0]?.capabilities.lastVerifiedAt, undefined);
    assert.equal(safeOverride.find((override) => override.model === "safe-custom-model")?.capabilities.preferredApiStyle, "responses");
    assert.equal(safeOverride.find((override) => override.model === "safe-custom-model")?.capabilities.stability, "preview");
    assert.equal(safeOverride.find((override) => override.model === "safe-custom-model")?.capabilities.lastVerifiedAt, "2026-05-12");
    assert.equal(toolStates.find((state) => state.name === "shell_command")?.enabled, false);
    const mcpServer = mcpServers.find((server) => server.serverId === "local-docs");
    assert.equal(mcpServer?.enabled, true);
    assert.equal(mcpServer?.confirmationMode, "unsafe_only");
    assert.equal(mcpServer?.toolExposureMode, "selected");
    assert.deepEqual(mcpServer?.enabledTools, ["lookup"]);
    assert.equal(mcpServer?.command, "node");
    assert.deepEqual(mcpServer?.args, ["server.js", "[secret-ref-required]", "[secret-ref-required]", "[secret-ref-required]"]);
    assert.equal(secret.configured, true);
    assert.equal(secret.secretRef, "secret://local-dev/mcp/local-docs/token");
    assert.equal(bearer.configured, true);
    assert.equal(mcpEnv["secret://local-dev/mcp/local-docs/token"], "mcp-token-value");
    assert.equal(mcpEnv["secret://local-dev/mcp/local-docs/bearer"], "mcp-bearer-value");
    assert.equal(settingsRaw.includes("secret://local-dev/mcp/local-docs/bearer"), true);
    assert.equal(settingsRaw.includes("secret-value"), false);
    assert.equal(settingsRaw.includes("sk-separated-secret"), false);
    assert.equal(settingsRaw.includes("sk-do-not-store"), false);
    assert.equal(settingsRaw.includes("mcp-token-value"), false);
    assert.equal(settingsRaw.includes("mcp-bearer-value"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter MCP command line parser preserves Windows paths", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-mcp-windows-command-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const servers = await configCenter.upsertMcpServer({
      serverId: "windows-docs",
      transport: "stdio",
      commandLine: String.raw`C:\Tools\node.exe "C:\MCP Servers\server.mjs" --flag value`,
      enabled: true,
    });
    const server = servers.find((item) => item.serverId === "windows-docs");

    assert.equal(server?.command, String.raw`C:\Tools\node.exe`);
    assert.deepEqual(server?.args, [String.raw`C:\MCP Servers\server.mjs`, "--flag", "value"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ConfigCenter stores and validates workspace directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workspace-config-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-workspace-root-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const defaultWorkspace = await configCenter.getWorkspaceConfig();
    const updated = await configCenter.updateWorkspaceConfig({ workspaceDirectory: workspace });
    const missing = path.join(workspace, "child", "missing");
    await assert.rejects(
      () => configCenter.updateWorkspaceConfig({ workspaceDirectory: "   " }),
      /workspaceDirectory must be a non-empty string\./
    );
    const autoCreated = await configCenter.updateWorkspaceConfig({ workspaceDirectory: missing });
    const settingsRaw = JSON.parse(await fs.readFile(settingsStore.settingsPath, "utf8")) as { workspaceDirectory?: string };

    assert.equal(defaultWorkspace.workspaceDirectory, path.join(os.homedir(), ".agentarbor", "workspace"));
    assert.equal(updated.workspaceDirectory, path.resolve(workspace));
    assert.equal(autoCreated.workspaceDirectory, path.resolve(missing));
    assert.equal(settingsRaw.workspaceDirectory, path.resolve(missing));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("ConfigCenter resolves explicit config directory outside tests", async () => {
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
