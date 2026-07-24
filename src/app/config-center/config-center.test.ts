import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { McpCachedToolInfo, ModelCapabilities } from "../../domain/config/index.js";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore, resolveAgentArborConfigDirectory } from "../../adapters/config/index.js";
import { ConfigCenter, ConfigCenterValidationError } from "./index.js";
import { toSanitizedCommandShellConfig } from "./command-shell-settings.js";
import { DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT } from "./desktop-agent-settings.js";
import { parseLocalSettingsFile } from "./settings-schema.js";

test("config settings reject retired model providers and protocols instead of rewriting them", () => {
  const baseProfile = {
    profileId: "default",
    label: "Retired provider",
    baseUrl: "https://retired.example",
    defaultAiMode: "openai-compatible",
    secretRef: "secret://local-dev/model-provider/default/api-key",
    enabled: true,
    updatedAt: "2026-07-15T00:00:00.000Z",
  };

  assert.throws(
    () => parseLocalSettingsFile({
      version: 3,
      modelProvider: { ...baseProfile, providerKind: "anthropic", protocolKind: "anthropic_messages" },
      updatedAt: baseProfile.updatedAt,
    }),
    /provider kind must be openai_compatible/u
  );
  assert.throws(
    () => parseLocalSettingsFile({
      version: 3,
      modelProvider: { ...baseProfile, providerKind: "openai_compatible", protocolKind: "gemini_generate_content" },
      updatedAt: baseProfile.updatedAt,
    }),
    /model protocol must be openai_responses or openai_compatible_chat_completions/u
  );
});

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
  const [settingsSchema, toolMcpSettings, toolConfirmationSettings, settingsUtils] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "settings-schema.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "tool-mcp-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "tool-confirmation-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "settings-utils.ts"), "utf8"),
  ]);

  assert.equal(settingsSchema.includes('from "./tool-mcp-settings.js"'), true);
  assert.equal(settingsSchema.includes('from "./tool-confirmation-settings.js"'), true);
  assert.equal(settingsSchema.includes('from "./settings-utils.js"'), true);
  assert.equal(settingsSchema.includes("export function sanitizeMcpArgs"), false);
  assert.equal(settingsSchema.includes("export function parseMcpCommandLine"), false);
  assert.equal(settingsSchema.includes("function parseToolStates"), false);
  assert.equal(settingsSchema.includes("function parseMcpServers"), false);
  assert.equal(settingsSchema.includes("function normalizeToolStates"), false);
  assert.equal(settingsSchema.includes("function normalizeMcpServers"), false);
  assert.equal(settingsSchema.includes("function parseToolConfirmationSettings"), false);
  assert.equal(settingsSchema.includes("function normalizeToolConfirmationSettings"), false);
  assert.equal(settingsSchema.includes("function requiredString"), false);
  assert.equal(settingsSchema.includes("function asRecord"), false);
  assert.equal(toolMcpSettings.includes("export function sanitizeMcpArgs"), true);
  assert.equal(toolMcpSettings.includes("export function parseMcpCommandLine"), true);
  assert.equal(toolMcpSettings.includes("export function parseToolStates"), true);
  assert.equal(toolMcpSettings.includes("export function parseMcpServers"), true);
  assert.equal(toolMcpSettings.includes("export function normalizeToolStates"), true);
  assert.equal(toolMcpSettings.includes("export function normalizeMcpServers"), true);
  assert.equal(toolConfirmationSettings.includes("export function parseToolConfirmationSettings"), true);
  assert.equal(toolConfirmationSettings.includes("export function normalizeToolConfirmationSettings"), true);
  assert.equal(settingsUtils.includes("export function requiredString"), true);
  assert.equal(settingsUtils.includes("export function asRecord"), true);
});

test("command shell settings keep runtime environment detection split", async () => {
  const [commandShellSettings, runtimeEnvironmentDetection] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "command-shell-settings.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "runtime-environment-detection.ts"), "utf8"),
  ]);

  assert.equal(commandShellSettings.includes('from "./runtime-environment-detection.js"'), true);
  assert.equal(commandShellSettings.includes('from "node:fs"'), false);
  assert.equal(commandShellSettings.includes('from "node:path"'), false);
  assert.equal(commandShellSettings.includes("function detectCommandShellOptions"), false);
  assert.equal(commandShellSettings.includes("function detectRuntimeEnvironmentTools"), false);
  assert.equal(commandShellSettings.includes("function findExecutableInPath"), false);
  assert.equal(runtimeEnvironmentDetection.includes("export function detectCommandShellOptions"), true);
  assert.equal(runtimeEnvironmentDetection.includes("export function detectRuntimeEnvironmentTools"), true);
  assert.equal(runtimeEnvironmentDetection.includes("export function defaultShellKind"), true);
  assert.equal(runtimeEnvironmentDetection.includes("export function defaultExecutable"), true);
  assert.equal(runtimeEnvironmentDetection.includes("function findExecutableInPath"), true);
});

test("ConfigCenter keeps projections and workspace validation split from orchestration", async () => {
  const [configCenter, projections, workspaceSettings] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "index.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "projections.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src", "app", "config-center", "workspace-settings.ts"), "utf8"),
  ]);

  assert.equal(configCenter.includes('from "./projections.js"'), true);
  assert.equal(configCenter.includes('from "./workspace-settings.js"'), true);
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
    const fakeNode = path.join(directory, "node.exe");
    const fakePython = path.join(directory, "python.exe");
    await fs.writeFile(fakeGitBash, "", "utf8");
    await fs.writeFile(fakeNode, "", "utf8");
    await fs.writeFile(fakePython, "", "utf8");

    const gitBash = toSanitizedCommandShellConfig(undefined, {
      platform: "win32",
      env: {
        CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash,
        PATH: directory,
        PATHEXT: ".EXE",
      },
      now: "test",
    });
    const externalPowerShellPreference = toSanitizedCommandShellConfig(undefined, {
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" },
      now: "test",
    });
    const agentPowerShellPreference = toSanitizedCommandShellConfig(undefined, {
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash, AGENTARBOR_USE_POWERSHELL_TOOL: "1" },
      now: "test",
    });
    const explicitCmd = toSanitizedCommandShellConfig({ kind: "cmd", updatedAt: "test" }, {
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: fakeGitBash },
      now: "test",
    });

    assert.equal(gitBash.configuredKind, "auto");
    assert.equal(gitBash.autoDetected, true);
    assert.equal(gitBash.kind, "bash");
    assert.equal(gitBash.label, "Git Bash");
    assert.equal(gitBash.syntax, "posix");
    assert.equal(gitBash.executable, fakeGitBash);
    assert.equal(gitBash.availableShells.some((shell) => shell.kind === "bash" && shell.availability === "available"), true);
    assert.equal(gitBash.runtimeTools.some((tool) => tool.id === "node" && tool.availability === "available"), true);
    assert.equal(gitBash.runtimeTools.some((tool) => tool.id === "python" && tool.availability === "available"), true);
    assert.equal(gitBash.runtimeTools.some((tool) => tool.id === "git-bash" && tool.availability === "available"), true);
    assert.equal(externalPowerShellPreference.kind, "bash");
    assert.equal(agentPowerShellPreference.kind, "powershell");
    assert.equal(agentPowerShellPreference.syntax, "powershell");
    assert.equal(explicitCmd.configuredKind, "cmd");
    assert.equal(explicitCmd.kind, "cmd");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter persists tool confirmation policy and defaults shell commands to prompt", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-tool-confirmation-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const initial = await configCenter.getToolConfirmationConfig();
    const updated = await configCenter.updateToolConfirmationConfig({ policy: "full_access" });
    const reloaded = await new ConfigCenter({ settingsStore, secretStore }).getToolConfirmationConfig();
    const settingsRaw = JSON.parse(await fs.readFile(settingsStore.settingsPath, "utf8")) as {
      readonly toolConfirmation?: { readonly policy?: string };
    };

    assert.equal(initial.policy, "prompt");
    assert.equal(initial.shellCommandRequiresConfirmation, true);
    assert.equal(updated.policy, "full_access");
    assert.equal(updated.shellCommandRequiresConfirmation, false);
    assert.equal(updated.riskDisclosure.includes("sandbox"), true);
    assert.equal(reloaded.policy, "full_access");
    assert.equal(settingsRaw.toolConfirmation?.policy, "full_access");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter persists skill trigger mode and defaults to keyword", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-skill-trigger-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const initial = await configCenter.getSkillTriggerConfig();
    const updated = await configCenter.updateSkillTriggerConfig({ mode: "model" });
    const reloaded = await new ConfigCenter({ settingsStore, secretStore }).getSkillTriggerConfig();
    const settingsRaw = JSON.parse(await fs.readFile(settingsStore.settingsPath, "utf8")) as {
      readonly skillTrigger?: { readonly mode?: string };
    };

    assert.equal(initial.mode, "keyword");
    assert.equal(initial.modelRouterEnabled, false);
    assert.equal(updated.mode, "model");
    assert.equal(updated.modelRouterEnabled, true);
    assert.equal(reloaded.mode, "model");
    assert.equal(settingsRaw.skillTrigger?.mode, "model");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter persists Desktop Agent system prompt settings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-desktop-agent-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const customPrompt = "You are a user configured Desktop Agent prompt.";

    const initial = await configCenter.getDesktopAgentConfig();
    const updated = await configCenter.updateDesktopAgentConfig({ systemPrompt: customPrompt });
    const reloaded = await new ConfigCenter({ settingsStore, secretStore }).getDesktopAgentConfig();
    const settingsRaw = JSON.parse(await fs.readFile(settingsStore.settingsPath, "utf8")) as {
      readonly desktopAgent?: { readonly systemPrompt?: string };
    };
    const reset = await configCenter.updateDesktopAgentConfig({ resetSystemPrompt: true });

    assert.equal(initial.systemPrompt, DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT);
    assert.equal(initial.isDefault, true);
    assert.equal(updated.systemPrompt, customPrompt);
    assert.equal(updated.isDefault, false);
    assert.equal(reloaded.systemPrompt, customPrompt);
    assert.equal(settingsRaw.desktopAgent?.systemPrompt, customPrompt);
    assert.equal(reset.systemPrompt, DEFAULT_DESKTOP_AGENT_SYSTEM_PROMPT);
    assert.equal(reset.isDefault, true);
  } finally {
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter persists custom model provider label and logo", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-model-provider-logo-"));
  const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const largeLogoDataUrl = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024).toString("base64")}`;
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const saved = await configCenter.updateModelProviderConfig({
      label: "OpenAI Router",
      logoDataUrl,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
      defaultAiMode: "openai-compatible",
    });
    const reloaded = await new ConfigCenter({ settingsStore, secretStore }).getModelProviderConfig();
    const savedLargeLogo = await configCenter.updateModelProviderConfig({
      logoDataUrl: largeLogoDataUrl,
    });
    const reloadedLargeLogo = await new ConfigCenter({ settingsStore, secretStore }).getModelProviderConfig();
    const ignoredInvalidLogo = await configCenter.updateModelProviderConfig({
      logoDataUrl: "data:text/plain;base64,Zm9v",
    });
    const cleared = await configCenter.updateModelProviderConfig({
      clearLogoDataUrl: true,
    });

    assert.equal(saved.label, "OpenAI Router");
    assert.equal(saved.logoDataUrl, logoDataUrl);
    assert.equal(saved.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(reloaded.label, "OpenAI Router");
    assert.equal(reloaded.logoDataUrl, logoDataUrl);
    assert.equal(savedLargeLogo.logoDataUrl, largeLogoDataUrl);
    assert.equal(reloadedLargeLogo.logoDataUrl, largeLogoDataUrl);
    assert.equal(ignoredInvalidLogo.logoDataUrl, largeLogoDataUrl);
    assert.equal(cleared.label, "OpenAI Router");
    assert.equal(cleared.logoDataUrl, undefined);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter scopes model provider logos to the updated profile", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-profile-logo-scope-"));
  const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.createModelProviderProfile({
      profileId: "router-one",
      label: "Router One",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://router-one.example/v1",
      model: "router-one-model",
      defaultAiMode: "openai-compatible",
    });
    await configCenter.createModelProviderProfile({
      profileId: "router-two",
      label: "Router Two",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://router-two.example/v1",
      model: "router-two-model",
      defaultAiMode: "openai-compatible",
    });

    const saved = await configCenter.updateModelProviderConfig({
      profileId: "router-one",
      logoDataUrl,
    });
    const profiles = await new ConfigCenter({ settingsStore, secretStore }).listModelProviderProfiles();

    assert.equal(saved.profileId, "router-one");
    assert.equal(saved.logoDataUrl, logoDataUrl);
    assert.equal(profiles.find((profile) => profile.profileId === "router-one")?.logoDataUrl, logoDataUrl);
    assert.equal(profiles.find((profile) => profile.profileId === "router-two")?.logoDataUrl, undefined);
    assert.equal(profiles.find((profile) => profile.profileId === "default")?.logoDataUrl, undefined);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter does not restore an active profile logo into a cleared custom profile after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-profile-logo-clear-"));
  const historicalLogo = "data:image/png;base64,iVBORw0KGgo=";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.updateModelProviderConfig({
      label: "历史厂商",
      logoDataUrl: historicalLogo,
      baseUrl: "https://history.example/v1",
      defaultAiMode: "openai-compatible",
    });
    await configCenter.createModelProviderProfile({
      profileId: "custom_fresh",
      label: "自定义厂商",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.example.com/v1",
      defaultAiMode: "openai-compatible",
    });
    const cleared = await configCenter.updateModelProviderConfig({
      profileId: "custom_fresh",
      clearLogoDataUrl: true,
    });
    const restored = await new ConfigCenter({ settingsStore, secretStore }).listModelProviderProfiles();

    assert.equal(cleared.logoDataUrl, undefined);
    assert.equal(restored.find((profile) => profile.profileId === "default")?.logoDataUrl, historicalLogo);
    assert.equal(restored.find((profile) => profile.profileId === "custom_fresh")?.logoDataUrl, undefined);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter keeps a custom profile logo independent when it uses a built-in endpoint", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-custom-endpoint-logo-"));
  const firstLogo = "data:image/png;base64,QUFB";
  const replacementLogo = "data:image/png;base64,QkJC";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.createModelProviderProfile({
      profileId: "custom_openai_router",
      label: "团队 OpenAI 路由",
      logoDataUrl: firstLogo,
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.openai.com/v1",
      defaultAiMode: "openai-compatible",
    });
    const updated = await configCenter.updateModelProviderConfig({
      profileId: "custom_openai_router",
      logoDataUrl: replacementLogo,
    });
    const restored = (await new ConfigCenter({ settingsStore, secretStore }).listModelProviderProfiles())
      .find((profile) => profile.profileId === "custom_openai_router");

    assert.equal(updated.label, "团队 OpenAI 路由");
    assert.equal(updated.logoDataUrl, replacementLogo);
    assert.equal(restored?.logoDataUrl, replacementLogo);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter repairs logo pollution on built-in model provider profiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-builtin-logo-repair-"));
  const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const now = "2026-06-28T00:00:00.000Z";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const customProfile = {
      profileId: "custom-router",
      label: "Gen.GPT",
      logoDataUrl,
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.gustfeng.dev/v1",
      defaultAiMode: "openai-compatible",
      secretRef: "secret://local-dev/model-provider/custom-router/api-key",
      enabled: true,
      updatedAt: now,
    };
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(settingsStore.settingsPath, JSON.stringify({
      version: 3,
      activeModelProfileId: "custom-router",
      modelProvider: customProfile,
      modelProfiles: [
        {
          profileId: "default",
          label: "OpenAI",
          logoDataUrl,
          providerKind: "openai_compatible",
          protocolKind: "openai_responses",
          baseUrl: "https://api.openai.com/v1",
          defaultAiMode: "openai-responses",
          secretRef: "secret://local-dev/model-provider/default/api-key",
          enabled: true,
          updatedAt: now,
        },
        {
          profileId: "deepseek",
          label: "DeepSeek",
          logoDataUrl,
          providerKind: "openai_compatible",
          protocolKind: "openai_compatible_chat_completions",
          baseUrl: "https://api.deepseek.com",
          defaultAiMode: "openai-compatible",
          secretRef: "secret://local-dev/model-provider/deepseek/api-key",
          enabled: true,
          updatedAt: now,
        },
        customProfile,
      ],
      updatedAt: now,
    }, null, 2), "utf8");

    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const active = await configCenter.getModelProviderConfig();
    const profiles = await configCenter.listModelProviderProfiles();

    assert.equal(active.profileId, "custom-router");
    assert.equal(active.logoDataUrl, logoDataUrl);
    assert.equal(profiles.find((profile) => profile.profileId === "default")?.logoDataUrl, undefined);
    assert.equal(profiles.find((profile) => profile.profileId === "deepseek")?.logoDataUrl, undefined);
    assert.equal(profiles.find((profile) => profile.profileId === "custom-router")?.logoDataUrl, logoDataUrl);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter keeps built-in provider label and logo immutable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-builtin-provider-immutable-"));
  const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const saved = await configCenter.updateModelProviderConfig({
      label: "OpenAI Router",
      logoDataUrl,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
      defaultAiMode: "openai-compatible",
    });
    const revertedToBuiltin = await configCenter.updateModelProviderConfig({
      profileId: "default",
      label: "Should Be Ignored",
      logoDataUrl,
      baseUrl: "https://api.openai.com/v1",
      defaultAiMode: "openai-responses",
    });
    const reloaded = await new ConfigCenter({ settingsStore, secretStore }).getModelProviderConfig();

    assert.equal(saved.label, "OpenAI Router");
    assert.equal(saved.logoDataUrl, logoDataUrl);
    assert.equal(revertedToBuiltin.label, "OpenAI");
    assert.equal(revertedToBuiltin.logoDataUrl, undefined);
    assert.equal(revertedToBuiltin.baseUrl, "https://api.openai.com/v1");
    assert.equal(reloaded.label, "OpenAI");
    assert.equal(reloaded.logoDataUrl, undefined);
  } finally {
    await removeTestDirectory(directory);
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
      profileId: "router",
      label: "Router",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://router.example/v1",
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
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
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
    assert.equal(disabled.secretConfigured, false);
    assert.equal(disabled.maxResults, 4);
    assert.equal(informationAccess.web.provider, "none");
    assert.equal(informationAccess.web.status, "disabled");
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, undefined);
    assert.equal(env.AGENTARBOR_WEB_SEARCH_PROVIDER, "none");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_API_KEY, undefined);
    assert.equal(env.TAVILY_API_KEY, undefined);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(secretsRaw.includes(tavilySecret), true);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter model built-in web search enables model-native search without external provider", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-web-search-model-builtin-"));
  const tavilySecret = "tvly-model-builtin-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.updateWebSearchConfig({
      provider: "tavily",
      apiKey: tavilySecret,
      maxResults: 4,
    });
    const updated = await configCenter.updateWebSearchConfig({ provider: "model_builtin" });
    const informationAccess = await configCenter.getInformationAccessConfig();
    const env = await configCenter.createModelRuntimeEnvironment();

    assert.equal(updated.provider, "model_builtin");
    assert.equal(updated.status, "ready");
    assert.equal(updated.secretConfigured, false);
    assert.equal(updated.maxResults, 4);
    assert.equal(informationAccess.web.provider, "model_builtin");
    assert.equal(informationAccess.web.status, "ready");
    assert.equal(env.AGENTARBOR_MODEL_BUILTIN_WEB_SEARCH, "true");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_PROVIDER, "none");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_API_KEY, undefined);
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, undefined);
  } finally {
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter rejects retired settings versions instead of migrating them", async () => {
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
    await assert.rejects(
      configCenter.getModelProviderConfig(),
      /settings version must be 3/u
    );
  } finally {
    await removeTestDirectory(directory);
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
    assert.equal(deepseek?.model, "deepseek-v4-pro");
    assert.equal(deepseek?.protocolKind, "openai_compatible_chat_completions");
    assert.equal(glmAlias?.label, "智谱 AI");
    assert.equal(glmAlias?.protocolKind, "openai_compatible_chat_completions");
    assert.equal(glmAlias?.defaultAiMode, "openai-compatible");
    assert.equal(glmAlias?.model, "glm-4.5");
    assert.equal(proxy?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(proxy?.model, "anthropic/claude-sonnet-4");
    assert.equal(openaiProxy?.label, "OpenAI Proxy");
    assert.equal(openaiProxy?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(openaiProxy?.model, "deepseek-proxy-model");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter stores Exa web search keys under provider-scoped secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-web-search-exa-"));
  const exaSecret = "exa-web-search-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const updated = await configCenter.updateWebSearchConfig({
      provider: "exa",
      apiKey: exaSecret,
      maxResults: 7,
    });
    const env = await configCenter.createModelRuntimeEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(updated.provider, "exa");
    assert.equal(updated.providerKind, "exa");
    assert.equal(updated.status, "ready");
    assert.equal(updated.secretConfigured, true);
    assert.equal(updated.maxResults, 7);
    assert.equal(JSON.stringify(updated).includes(exaSecret), false);
    assert.equal(env.AGENTARBOR_WEB_SEARCH_PROVIDER, "exa");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_API_KEY, exaSecret);
    assert.equal(env.AGENTARBOR_EXA_API_KEY, exaSecret);
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, undefined);
    assert.equal(settingsRaw.includes(exaSecret), false);
    assert.equal(secretsRaw.includes(exaSecret), true);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter stores Metaso web search keys under provider-scoped secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-web-search-metaso-"));
  const metasoSecret = "metaso-web-search-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const updated = await configCenter.updateWebSearchConfig({
      provider: "metaso",
      apiKey: metasoSecret,
      maxResults: 6,
    });
    const env = await configCenter.createModelRuntimeEnvironment();
    const settingsRaw = await fs.readFile(settingsStore.settingsPath, "utf8");
    const secretsRaw = await fs.readFile(secretStore.secretsPath, "utf8");

    assert.equal(updated.provider, "metaso");
    assert.equal(updated.providerKind, "metaso");
    assert.equal(updated.status, "ready");
    assert.equal(updated.secretConfigured, true);
    assert.equal(updated.maxResults, 6);
    assert.equal(JSON.stringify(updated).includes(metasoSecret), false);
    assert.equal(env.AGENTARBOR_WEB_SEARCH_PROVIDER, "metaso");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_API_KEY, metasoSecret);
    assert.equal(env.AGENTARBOR_METASO_API_KEY, metasoSecret);
    assert.equal(env.METASO_API_KEY, metasoSecret);
    assert.equal(env.AGENTARBOR_TAVILY_API_KEY, undefined);
    assert.equal(settingsRaw.includes(metasoSecret), false);
    assert.equal(secretsRaw.includes(metasoSecret), true);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter requires Google engine id before reporting web search ready", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-web-search-google-"));
  const googleSecret = "google-web-search-secret";
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const withoutEngine = await configCenter.updateWebSearchConfig({
      provider: "google",
      apiKey: googleSecret,
      maxResults: 3,
    });
    const ready = await configCenter.updateWebSearchConfig({
      provider: "google",
      googleEngineId: "engine-id",
    });
    const env = await configCenter.createModelRuntimeEnvironment();

    assert.equal(withoutEngine.provider, "google");
    assert.equal(withoutEngine.status, "no-provider");
    assert.equal(withoutEngine.secretConfigured, true);
    assert.equal(ready.status, "ready");
    assert.equal(ready.engineId, "engine-id");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_PROVIDER, "google");
    assert.equal(env.AGENTARBOR_WEB_SEARCH_API_KEY, googleSecret);
    assert.equal(env.AGENTARBOR_GOOGLE_API_KEY, googleSecret);
    assert.equal(env.AGENTARBOR_WEB_SEARCH_GOOGLE_ENGINE_ID, "engine-id");
    assert.equal(env.AGENTARBOR_GOOGLE_CSE_ID, "engine-id");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter keeps duplicate model ids scoped to provider profiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-duplicate-provider-models-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const now = new Date("2026-05-19T00:00:00.000Z").toISOString();
    const sharedModel = "shared-router-model";
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      settingsStore.settingsPath,
      `${JSON.stringify(
        {
          version: 3,
          activeModelProfileId: "openai",
          modelProvider: {
            profileId: "openai",
            label: "OpenAI Router",
            providerKind: "openai_compatible",
            protocolKind: "openai_compatible_chat_completions",
            baseUrl: "https://openrouter.ai/api/v1",
            model: sharedModel,
            defaultAiMode: "openai-compatible",
            secretRef: "secret://local-dev/model-provider/openai/api-key",
            enabled: true,
            updatedAt: now,
          },
          modelProfiles: [
            {
              profileId: "openai",
              label: "OpenAI Router",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://openrouter.ai/api/v1",
              model: sharedModel,
              defaultAiMode: "openai-compatible",
              secretRef: "secret://local-dev/model-provider/openai/api-key",
              enabled: true,
              updatedAt: now,
            },
            {
              profileId: "deepseek",
              label: "DeepSeek",
              providerKind: "openai_compatible",
              protocolKind: "openai_compatible_chat_completions",
              baseUrl: "https://api.deepseek.com",
              model: sharedModel,
              defaultAiMode: "openai-compatible",
              secretRef: "secret://local-dev/model-provider/deepseek/api-key",
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
              models: [{ id: sharedModel, displayName: sharedModel, owner: "deepseek" }],
            },
          ],
          updatedAt: now,
        },
        null,
        2
      )}\n`
    );
    await secretStore.writeSecret("secret://local-dev/model-provider/openai/api-key", "sk-openrouter");
    await secretStore.writeSecret("secret://local-dev/model-provider/deepseek/api-key", "sk-deepseek");

    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const active = await configCenter.getModelProviderConfig();
    const profiles = await configCenter.listModelProviderProfiles();
    const env = await configCenter.createModelRuntimeEnvironment({ modelProvider: active });

    assert.equal(active.profileId, "openai");
    assert.equal(active.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(active.model, sharedModel);
    assert.equal(profiles.find((profile) => profile.profileId === "deepseek")?.model, sharedModel);
    assert.equal(env.AGENTARBOR_MODEL_BASE_URL, "https://openrouter.ai/api/v1");
    assert.equal(env.AGENTARBOR_MODEL_NAME, sharedModel);
    assert.equal(env.AGENTARBOR_MODEL_API_KEY, "sk-openrouter");
  } finally {
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter repairs cosmetic generated model catalog display names", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-model-catalog-display-names-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.createModelProviderProfile({
      profileId: "minimax",
      label: "MiniMax",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.minimaxi.com/v1",
      defaultAiMode: "openai-compatible",
    });
    await configCenter.upsertModelProviderModelCatalog({
      profileId: "minimax",
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
      modelsPath: "/models",
      fetchedAt: "2026-05-19T00:00:00.000Z",
      models: [
        { id: "MiniMax-M3", displayName: "Mini Max M3", owner: "minimax" },
        { id: "plain-model", displayName: "Provider Plain Model", owner: "provider" },
      ],
    });

    const catalogs = await new ConfigCenter({ settingsStore, secretStore }).listModelProviderModelCatalogs();

    assert.equal(catalogs[0]?.models.find((model) => model.id === "MiniMax-M3")?.displayName, "MiniMax-M3");
    assert.equal(catalogs[0]?.models.find((model) => model.id === "plain-model")?.displayName, "Provider Plain Model");
  } finally {
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter stores capability overrides, tool states, and MCP settings without raw secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-capabilities-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const overrides = await configCenter.updateModelCapabilityOverride({
      profileId: "custom-profile",
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
    const toolStates = await configCenter.updateToolState({ name: "shell", enabled: false });
    const mcpServers = await configCenter.upsertMcpServer({
      serverId: "local-docs",
      label: "Local Docs",
      description: "Local documentation tools.",
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

    assert.equal(overrides[0]?.profileId, "custom-profile");
    assert.equal(overrides[0]?.capabilities.contextWindowTokens, 64_000);
    assert.equal(overrides[0]?.capabilities.supportsToolCalling, true);
    assert.equal(overrides[0]?.capabilities.preferredApiStyle, undefined);
    assert.equal(overrides[0]?.capabilities.stability, undefined);
    assert.equal(overrides[0]?.capabilities.lastVerifiedAt, undefined);
    assert.equal(safeOverride.find((override) => override.model === "safe-custom-model")?.capabilities.preferredApiStyle, "responses");
    assert.equal(safeOverride.find((override) => override.model === "safe-custom-model")?.capabilities.stability, "preview");
    assert.equal(safeOverride.find((override) => override.model === "safe-custom-model")?.capabilities.lastVerifiedAt, "2026-05-12");
    assert.equal(toolStates.find((state) => state.name === "shell")?.enabled, false);
    const mcpServer = mcpServers.find((server) => server.serverId === "local-docs");
    assert.equal(mcpServer?.enabled, true);
    assert.equal(mcpServer?.description, "Local documentation tools.");
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
    await removeTestDirectory(directory);
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
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter normalizes legacy MCP SSE transport to streamable HTTP", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-mcp-legacy-sse-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      settingsStore.settingsPath,
      JSON.stringify({
        version: 3,
        mcpServers: [
          {
            serverId: "legacy-docs",
            label: "Legacy Docs",
            transport: "sse",
            url: "https://mcp.example.test/mcp",
            envSecretRefs: [],
            confirmationMode: "never",
            toolExposureMode: "none",
            enabledTools: [],
            autoApprovedTools: [],
            enabled: true,
            updatedAt: "2026-06-20T00:00:00.000Z",
          },
        ],
        updatedAt: "2026-06-20T00:00:00.000Z",
      }, null, 2),
      "utf8"
    );
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    const servers = await configCenter.listMcpServers();

    assert.equal(servers[0]?.transport, "http");
    assert.equal(servers[0]?.url, "https://mcp.example.test/mcp");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter preserves MCP tool cache across policy edits and clears it when connection config changes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-mcp-cache-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    const cachedTools: readonly McpCachedToolInfo[] = [
      {
        name: "lookup",
        description: "Lookup docs.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["fast", "safe"] },
            target: { $ref: "#/$defs/target" },
            retries: { type: "integer", minimum: 0, maximum: 3 },
            slug: { type: "string", pattern: "^[a-z]+$" },
            operation: { const: "lookup" },
          },
          required: ["mode", "target"],
          additionalProperties: { type: "string" },
          $defs: {
            target: {
              type: "object",
              properties: { id: { type: "string", minLength: 1 } },
              required: ["id"],
              additionalProperties: false,
            },
          },
          oneOf: [
            { required: ["mode"] },
            { properties: { mode: { const: "safe" } } },
          ],
          dependentRequired: { mode: ["target"] },
        },
        outputSchema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: { $ref: "#/$defs/result" },
            },
          },
          required: ["results"],
          $defs: {
            result: {
              type: "object",
              properties: { score: { type: "number", minimum: 0, maximum: 1 } },
              required: ["score"],
            },
          },
        },
        annotations: { readOnlyHint: true },
      },
    ];

    await configCenter.upsertMcpServer({
      serverId: "docs",
      description: "Docs lookup.",
      transport: "http",
      url: "https://mcp.example.test/mcp",
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
      enabled: true,
    });
    await configCenter.updateMcpServerConnectionState({
      serverId: "docs",
      connectedAt: "2026-06-20T00:00:00.000Z",
      cachedTools,
      cachedReferences: {
        prompts: [{ name: "draft", title: "Draft", description: "Draft with docs." }],
        resources: [{ uri: "docs://guide", name: "guide", title: "Guide", mimeType: "text/plain" }],
        resourceTemplates: [],
      },
    });
    const afterPolicyEdit = await configCenter.upsertMcpServer({
      serverId: "docs",
      description: "Internal docs lookup.",
      toolExposureMode: "selected",
      enabledTools: ["lookup", "search"],
      autoApprovedTools: ["lookup"],
    });
    const preserved = afterPolicyEdit.find((server) => server.serverId === "docs");
    const reloaded = new ConfigCenter({ settingsStore, secretStore });
    const reloadedServer = (await reloaded.listMcpServers()).find((server) => server.serverId === "docs");
    const afterDescriptionClear = await configCenter.upsertMcpServer({
      serverId: "docs",
      description: "",
    });
    const clearedDescription = afterDescriptionClear.find((server) => server.serverId === "docs");
    await configCenter.upsertMcpServer({
      serverId: "docs",
      url: "https://mcp.example.test/changed",
    });
    const changed = (await configCenter.listMcpServers()).find((server) => server.serverId === "docs");

    assert.deepEqual(preserved?.cachedTools?.map((tool) => tool.name), ["lookup"]);
    assert.deepEqual(preserved?.cachedTools?.[0]?.inputSchema, cachedTools[0]?.inputSchema);
    assert.deepEqual(preserved?.cachedTools?.[0]?.outputSchema, cachedTools[0]?.outputSchema);
    assert.deepEqual(reloadedServer?.cachedTools?.[0]?.inputSchema, cachedTools[0]?.inputSchema);
    assert.deepEqual(reloadedServer?.cachedTools?.[0]?.outputSchema, cachedTools[0]?.outputSchema);
    assert.deepEqual(preserved?.cachedReferences?.prompts.map((prompt) => prompt.name), ["draft"]);
    assert.deepEqual(preserved?.cachedReferences?.resources.map((resource) => resource.name), ["guide"]);
    assert.equal(preserved?.description, "Internal docs lookup.");
    assert.equal(preserved?.lastConnectedAt, "2026-06-20T00:00:00.000Z");
    assert.deepEqual(preserved?.autoApprovedTools, ["lookup"]);
    assert.equal(clearedDescription?.description, undefined);
    assert.deepEqual(clearedDescription?.cachedTools?.map((tool) => tool.name), ["lookup"]);
    assert.deepEqual(clearedDescription?.cachedReferences?.prompts.map((prompt) => prompt.name), ["draft"]);
    assert.equal(changed?.cachedTools, undefined);
    assert.equal(changed?.cachedReferences, undefined);
    assert.equal(changed?.toolsCachedAt, undefined);
    assert.equal(changed?.lastConnectedAt, undefined);
    assert.equal(changed?.lastError, undefined);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("ConfigCenter preserves MCP server order when updating existing servers", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-config-mcp-order-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });

    await configCenter.upsertMcpServer({
      serverId: "context7",
      label: "Context7",
      transport: "http",
      url: "https://context7.example.test/mcp",
      enabled: true,
    });
    await configCenter.upsertMcpServer({
      serverId: "exa",
      label: "Exa",
      transport: "http",
      url: "https://exa.example.test/mcp",
      enabled: false,
    });
    await configCenter.upsertMcpServer({
      serverId: "docs",
      label: "Docs",
      transport: "stdio",
      command: "node",
      args: ["server.mjs"],
      enabled: true,
    });

    const afterPolicyEdit = await configCenter.upsertMcpServer({
      serverId: "context7",
      enabled: false,
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
    });
    const afterConnectionState = await configCenter.updateMcpServerConnectionState({
      serverId: "exa",
      connectedAt: "2026-06-20T00:00:00.000Z",
      cachedTools: [{
        name: "search",
        description: "Search.",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      }],
    });
    const afterConnectionEdit = await configCenter.upsertMcpServer({
      serverId: "context7",
      url: "https://context7.example.test/changed",
    });
    const afterAppend = await configCenter.upsertMcpServer({
      serverId: "new-docs",
      label: "New Docs",
      transport: "http",
      url: "https://docs.example.test/mcp",
      enabled: true,
    });

    assert.deepEqual(afterPolicyEdit.map((server) => server.serverId), ["context7", "exa", "docs"]);
    assert.deepEqual(afterConnectionState.map((server) => server.serverId), ["context7", "exa", "docs"]);
    assert.deepEqual(afterConnectionEdit.map((server) => server.serverId), ["context7", "exa", "docs"]);
    assert.deepEqual(afterAppend.map((server) => server.serverId), ["context7", "exa", "docs", "new-docs"]);
  } finally {
    await removeTestDirectory(directory);
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
    const reset = await configCenter.updateWorkspaceConfig({ workspaceDirectory: "   " });
    const missing = path.join(workspace, "child", "missing");
    const autoCreated = await configCenter.updateWorkspaceConfig({ workspaceDirectory: missing });
    const settingsRaw = JSON.parse(await fs.readFile(settingsStore.settingsPath, "utf8")) as { workspaceDirectory?: string };

    assert.equal(defaultWorkspace.workspaceDirectory, path.join(os.homedir(), ".agentarbor", "workspace"));
    assert.equal(updated.workspaceDirectory, path.resolve(workspace));
    assert.equal(reset.workspaceDirectory, path.join(os.homedir(), ".agentarbor", "workspace"));
    assert.equal(autoCreated.workspaceDirectory, path.resolve(missing));
    assert.equal(settingsRaw.workspaceDirectory, path.resolve(missing));
  } finally {
    await removeTestDirectory(directory);
    await removeTestDirectory(workspace);
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

async function removeTestDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
