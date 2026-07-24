import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemNormalSettingsStore } from "../../../adapters/config/index.js";
import type {
  AppUpdateFetch,
  AppUpdateInfo,
  AppUpdateServiceLike,
} from "../../app-update/app-update-service.js";
import { startLocalPanelServer, type PanelModelCatalogFetch } from "../../panel-server.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("panel config API keeps model provider and search keys out of ordinary responses", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-config-"));
  const secret = "sk-panel-secret";
  const tavilySecret = "tvly-panel-secret";
  const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const update = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        label: "OpenAI Router",
        logoDataUrl,
        baseUrl: "https://provider.example/",
        model: "panel-model",
        defaultAiMode: "openai-compatible",
        apiKey: secret,
      },
    });
    const informationUpdate = await requestJson(server.url, "/api/config/information-sources", {
      method: "POST",
      body: {
        tavilyApiKey: tavilySecret,
        tavilyMaxResults: 2,
      },
    });
    const config = await requestJson(server.url, "/api/config");
    const settingsRaw = await fs.readFile(new FileSystemNormalSettingsStore(directory).settingsPath, "utf8");

    assert.equal(update.status, 200);
    assert.equal(informationUpdate.status, 200);
    assert.equal(config.status, 200);
    assert.equal(update.text.includes(secret), false);
    assert.equal(informationUpdate.text.includes(tavilySecret), false);
    assert.equal(config.text.includes(secret), false);
    assert.equal(config.body.config.apiKey, undefined);
    assert.equal(config.text.includes(tavilySecret), false);
    assert.equal(settingsRaw.includes(secret), false);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(update.body.config.secretConfigured, true);
    assert.equal(informationUpdate.body.informationAccess.web.secretConfigured, true);
    assert.equal(informationUpdate.body.informationAccess.web.maxResults, 2);
    assert.equal(config.body.informationAccess.web.secretConfigured, true);
    assert.equal(config.body.capabilities.activeModel.secretConfigured, true);
    assert.equal(config.body.profiles.length, 1);
    assert.deepEqual(config.body.modelCatalogs, []);
    assert.equal(
      config.body.modelProviderMarket.presets.some((preset: { presetId?: string; baseUrl?: string }) =>
        preset.presetId === "openai" && preset.baseUrl === "https://api.openai.com/v1"
      ),
      true
    );
    assert.equal(
      config.body.modelProviderMarket.presets.every((preset: { providerKind?: string; protocolKind?: string }) =>
        preset.providerKind === "openai_compatible" &&
        (preset.protocolKind === "openai_responses" || preset.protocolKind === "openai_compatible_chat_completions")
      ),
      true
    );
    assert.deepEqual(
      config.body.modelProviderMarket.presets
        .map((preset: { presetId?: string }) => preset.presetId)
        .filter((presetId: string | undefined) => presetId === "claude" || presetId === "gemini"),
      []
    );
    assert.equal(
      config.body.modelProviderMarket.presets.some((preset: { presetId?: string }) => preset.presetId === "deepseek"),
      true
    );
    assert.equal(
      config.body.modelProviderMarket.presets.some((preset: { label?: string }) => preset.label === "月之暗面"),
      true
    );
    assert.equal(config.text.includes("sk-panel-secret"), false);
    assert.equal(update.body.config.label, "OpenAI Router");
    assert.equal(update.body.config.logoDataUrl, logoDataUrl);
    assert.equal(update.body.config.baseUrl, "https://provider.example");
    assert.equal(update.body.config.defaultAiMode, "openai-compatible");
    assert.equal(config.body.config.label, "OpenAI Router");
    assert.equal(config.body.config.logoDataUrl, logoDataUrl);

    const clearLogo = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        clearLogoDataUrl: true,
      },
    });
    assert.equal(clearLogo.status, 200);
    assert.equal(clearLogo.body.config.label, "OpenAI Router");
    assert.equal(clearLogo.body.config.logoDataUrl, undefined);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config API updates Desktop Agent system prompt", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-desktop-agent-config-"));
  const customPrompt = "You are configured from the settings panel.";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config");
    const update = await requestJson(server.url, "/api/config/desktop-agent", {
      method: "POST",
      body: { systemPrompt: customPrompt },
    });
    const config = await requestJson(server.url, "/api/config");
    const reset = await requestJson(server.url, "/api/config/desktop-agent", {
      method: "POST",
      body: { resetSystemPrompt: true },
    });

    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.desktopAgent.systemPrompt, "string");
    assert.equal(initial.body.desktopAgent.isDefault, true);
    assert.equal(update.status, 200);
    assert.equal(update.body.desktopAgent.systemPrompt, customPrompt);
    assert.equal(update.body.desktopAgent.isDefault, false);
    assert.equal(config.body.desktopAgent.systemPrompt, customPrompt);
    assert.equal(reset.status, 200);
    assert.equal(reset.body.desktopAgent.isDefault, true);
    assert.notEqual(reset.body.desktopAgent.systemPrompt, customPrompt);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config API persists 3MiB model provider logos", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-large-provider-logo-"));
  const largeLogoDataUrl = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024).toString("base64")}`;
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const update = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        label: "Large Logo Router",
        logoDataUrl: largeLogoDataUrl,
        baseUrl: "https://provider.example/v1",
        model: "panel-model",
        defaultAiMode: "openai-compatible",
      },
    });
    const config = await requestJson(server.url, "/api/config");

    assert.equal(update.status, 200);
    assert.equal(update.body.config.logoDataUrl, largeLogoDataUrl);
    assert.equal(config.status, 200);
    assert.equal(config.body.config.logoDataUrl, largeLogoDataUrl);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config API scopes model provider logos to one profile", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-provider-logo-scope-"));
  const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-profiles", {
      method: "POST",
      body: {
        profileId: "router-one",
        label: "Router One",
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://router-one.example/v1",
        model: "router-one-model",
        defaultAiMode: "openai-compatible",
      },
    });
    await requestJson(server.url, "/api/config/model-profiles", {
      method: "POST",
      body: {
        profileId: "router-two",
        label: "Router Two",
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://router-two.example/v1",
        model: "router-two-model",
        defaultAiMode: "openai-compatible",
      },
    });
    const update = await requestJson(server.url, "/api/config/model-profiles/router-one", {
      method: "POST",
      body: { logoDataUrl },
    });
    const config = await requestJson(server.url, "/api/config");
    const profiles = config.body.profiles as readonly { readonly profileId: string; readonly logoDataUrl?: string }[];

    assert.equal(update.status, 200);
    assert.equal(update.body.profile.logoDataUrl, logoDataUrl);
    assert.equal(profiles.find((profile) => profile.profileId === "router-one")?.logoDataUrl, logoDataUrl);
    assert.equal(profiles.find((profile) => profile.profileId === "router-two")?.logoDataUrl, undefined);
    assert.equal(profiles.find((profile) => profile.profileId === "default")?.logoDataUrl, undefined);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel app update API reports status and checks configured manifest", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-update-api-"));
  const calls: string[] = [];
  const updateFetch: AppUpdateFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        version: "9.9.9",
        releaseDate: "2026-06-28T00:00:00.000Z",
        releasePageUrl: "https://updates.example/releases/9.9.9",
        downloadUrl: "https://updates.example/downloads/agentarbor-9.9.9.exe",
      }),
    };
  };
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    updateManifestUrl: "https://updates.example/agentarbor.json",
    updateManifestFetch: updateFetch,
  });
  try {
    const initial = await requestJson(server.url, "/api/app/update");
    const checked = await requestJson(server.url, "/api/app/update/check", { method: "POST" });
    const after = await requestJson(server.url, "/api/app/update");

    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, "idle");
    assert.equal(initial.body.manifestUrlConfigured, true);
    assert.equal(checked.status, 200);
    assert.equal(checked.body.ok, true);
    assert.equal(checked.body.status, "available");
    assert.equal(checked.body.latest.version, "9.9.9");
    assert.equal(checked.body.latest.releasePageUrl, "https://updates.example/releases/9.9.9");
    assert.equal(checked.body.latest.downloadUrl, "https://updates.example/downloads/agentarbor-9.9.9.exe");
    assert.equal(after.body.status, "available");
    assert.deepEqual(calls, ["https://updates.example/agentarbor.json"]);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel app update API can install a downloaded desktop update", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-update-install-api-"));
  const installed: string[] = [];
  let current: AppUpdateInfo = {
    ok: true,
    status: "downloaded",
    runtime: "electron",
    currentVersion: "0.1.0",
    manifestUrlConfigured: true,
    canCheck: false,
    canInstall: true,
    downloadedAt: "2026-06-30T00:00:00.000Z",
    latest: { version: "0.2.0" },
  };
  const appUpdateService: AppUpdateServiceLike = {
    status: () => current,
    check: async () => current,
    install: async () => {
      installed.push("install");
      current = {
        ...current,
        status: "installing",
        canInstall: false,
      };
      return current;
    },
  };
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    appUpdateService,
  });
  try {
    const initial = await requestJson(server.url, "/api/app/update");
    const install = await requestJson(server.url, "/api/app/update/install", { method: "POST" });

    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, "downloaded");
    assert.equal(initial.body.canInstall, true);
    assert.equal(install.status, 200);
    assert.equal(install.body.status, "installing");
    assert.deepEqual(installed, ["install"]);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel app update API stays usable when update source is missing or invalid", async () => {
  const unconfiguredDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-update-none-"));
  const invalidDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-update-invalid-"));
  const invalidFetch: AppUpdateFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: "not valid" }),
  });
  const unconfiguredServer = await startLocalPanelServer({
    port: 0,
    configDirectory: unconfiguredDirectory,
  });
  const invalidServer = await startLocalPanelServer({
    port: 0,
    configDirectory: invalidDirectory,
    updateManifestUrl: "https://updates.example/agentarbor.json",
    updateManifestFetch: invalidFetch,
  });
  try {
    const unconfigured = await requestJson(unconfiguredServer.url, "/api/app/update/check", { method: "POST" });
    const failed = await requestJson(invalidServer.url, "/api/app/update/check", { method: "POST" });

    assert.equal(unconfigured.status, 200);
    assert.equal(unconfigured.body.ok, true);
    assert.equal(unconfigured.body.status, "unsupported");
    assert.equal(unconfigured.body.manifestUrlConfigured, false);
    assert.equal(unconfigured.body.canCheck, false);
    assert.equal(unconfigured.body.canInstall, false);
    assert.equal(failed.status, 200);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.errorSummary, "更新清单版本号无效。");
  } finally {
    await unconfiguredServer.close();
    await invalidServer.close();
    await removeTemporaryTree(unconfiguredDirectory);
    await removeTemporaryTree(invalidDirectory);
  }
});

test("panel config API keeps built-in provider label and logo immutable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-builtin-provider-immutable-"));
  const customLogoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const builtInLogoAttempt = "data:image/png;base64,aGVsbG8=";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const custom = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        label: "OpenAI Router",
        logoDataUrl: customLogoDataUrl,
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4.1",
        defaultAiMode: "openai-compatible",
      },
    });
    const builtIn = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        label: "Should Be Ignored",
        logoDataUrl: builtInLogoAttempt,
        baseUrl: "https://api.openai.com/v1",
        defaultAiMode: "openai-responses",
      },
    });
    const config = await requestJson(server.url, "/api/config");

    assert.equal(custom.status, 200);
    assert.equal(builtIn.status, 200);
    assert.equal(config.status, 200);
    assert.equal(custom.body.config.label, "OpenAI Router");
    assert.equal(custom.body.config.logoDataUrl, customLogoDataUrl);
    assert.equal(builtIn.body.config.label, "OpenAI");
    assert.equal(builtIn.body.config.logoDataUrl, undefined);
    assert.equal(config.body.config.label, "OpenAI");
    assert.equal(config.body.config.logoDataUrl, undefined);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel tools config routes return sanitized web search config and never echo raw key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-tools-config-"));
  const tavilySecret = "tvly-panel-tools-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config/tools");
    const update = await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: tavilySecret,
        maxResults: 2,
      },
    });
    const after = await requestJson(server.url, "/api/config/tools");
    const settingsRaw = await fs.readFile(new FileSystemNormalSettingsStore(directory).settingsPath, "utf8");

    assert.equal(initial.status, 200);
    assert.equal(initial.body.tools.webSearch.provider, "tavily");
    assert.equal(initial.body.tools.webSearch.status, "no-provider");
    assert.equal(initial.body.tools.catalog.scope, "desktop-basic");
    assert.equal(
      initial.body.tools.catalog.tools.some((tool: { name?: string; availability?: string }) => tool.name === "web_fetch" && (tool.availability === "available" || tool.availability === "unavailable")),
      true
    );
    assert.equal(update.status, 200);
    assert.equal(after.status, 200);
    assert.equal(update.text.includes(tavilySecret), false);
    assert.equal(after.text.includes(tavilySecret), false);
    assert.equal(settingsRaw.includes(tavilySecret), false);
    assert.equal(update.body.tools.webSearch.secretConfigured, true);
    assert.equal(update.body.tools.webSearch.status, "ready");
    assert.equal(update.body.tools.webSearch.maxResults, 2);
    assert.equal(after.body.tools.webSearch.secretConfigured, true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config API persists command shell selection into capability snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-command-shell-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config");
    const update = await requestJson(server.url, "/api/config/command-shell", {
      method: "POST",
      body: {
        kind: "pwsh",
      },
    });
    const after = await requestJson(server.url, "/api/config");

    assert.equal(initial.status, 200);
    assert.equal(update.status, 200);
    assert.equal(after.status, 200);
    assert.equal(initial.body.commandShell.configuredKind, "auto");
    assert.equal(initial.body.commandShell.autoDetected, true);
    assert.equal(Array.isArray(initial.body.commandShell.availableShells), true);
    assert.equal(Array.isArray(initial.body.commandShell.runtimeTools), true);
    assert.equal(update.body.commandShell.kind, "pwsh");
    assert.equal(update.body.commandShell.configuredKind, "pwsh");
    assert.equal(update.body.commandShell.autoDetected, false);
    assert.equal(update.body.commandShell.syntax, "powershell");
    assert.equal(update.body.capabilities.commandShell.kind, "pwsh");
    assert.equal(update.body.capabilities.commandShell.configuredKind, "pwsh");
    assert.equal(after.body.commandShell.kind, "pwsh");
    assert.equal(after.body.commandShell.configuredKind, "pwsh");
    assert.equal(after.body.capabilities.commandShell.kind, "pwsh");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config API persists tool confirmation policy into capability snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-tool-confirmation-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config");
    const update = await requestJson(server.url, "/api/config/tool-confirmation", {
      method: "POST",
      body: {
        policy: "full_access",
      },
    });
    const after = await requestJson(server.url, "/api/config");

    assert.equal(initial.status, 200);
    assert.equal(update.status, 200);
    assert.equal(after.status, 200);
    assert.equal(initial.body.toolConfirmation.policy, "prompt");
    assert.equal(initial.body.toolConfirmation.shellCommandRequiresConfirmation, true);
    assert.equal(update.body.toolConfirmation.policy, "full_access");
    assert.equal(update.body.toolConfirmation.shellCommandRequiresConfirmation, false);
    assert.equal(update.body.capabilities.toolConfirmation.policy, "full_access");
    assert.equal(after.body.toolConfirmation.policy, "full_access");
    assert.equal(after.body.capabilities.toolConfirmation.policy, "full_access");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel config API persists skill trigger mode into capability snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-skill-trigger-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config");
    const update = await requestJson(server.url, "/api/config/skill-trigger", {
      method: "POST",
      body: {
        mode: "model",
      },
    });
    const after = await requestJson(server.url, "/api/config");

    assert.equal(initial.status, 200);
    assert.equal(update.status, 200);
    assert.equal(after.status, 200);
    assert.equal(initial.body.skillTrigger.mode, "keyword");
    assert.equal(initial.body.capabilities.skillTrigger.mode, "keyword");
    assert.equal(update.body.skillTrigger.mode, "model");
    assert.equal(update.body.skillTrigger.modelRouterEnabled, true);
    assert.equal(update.body.capabilities.skillTrigger.mode, "model");
    assert.equal(after.body.skillTrigger.mode, "model");
    assert.equal(after.body.capabilities.skillTrigger.mode, "model");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel capability and profile APIs expose safe unified capability projections", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-capabilities-"));
  const secret = "sk-panel-capability-secret";
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const createProfile = await requestJson(server.url, "/api/config/model-profiles", {
        method: "POST",
        body: {
          profileId: "custom",
          label: "Custom",
          providerKind: "openai_compatible",
          protocolKind: "openai_compatible_chat_completions",
          baseUrl: "https://provider.example/v1",
          model: "vendor-model",
          defaultAiMode: "openai-compatible",
          apiKey: secret,
        },
      });
      const activate = await requestJson(server.url, "/api/config/model-profiles/custom/activate", { method: "POST" });
      const capabilities = await requestJson(server.url, "/api/config/capabilities");
      const capabilityUpdate = await requestJson(server.url, "/api/config/model-capabilities", {
        method: "POST",
        body: {
          profileId: "custom",
          model: "vendor-model",
          capabilities: {
            contextWindowTokens: 32_000,
            maxOutputTokens: 4_000,
            supportsToolCalling: true,
            supportsParallelToolCalls: false,
            supportsStructuredOutputs: true,
            supportsStreaming: true,
          },
        },
      });
      const deleteActive = await requestJson(server.url, "/api/config/model-profiles/custom", { method: "DELETE" });

      assert.equal(createProfile.status, 200);
      assert.equal(activate.status, 200);
      assert.equal(capabilities.status, 200);
      assert.equal(capabilityUpdate.status, 200);
      assert.equal(capabilities.body.capabilities.activeModel.profileId, "custom");
      assert.equal(capabilities.body.capabilities.modelCapabilities.contextWindowTokens, 256_000);
      assert.equal(capabilities.body.capabilities.modelCapabilities.supportsToolCalling, true);
      assert.equal(capabilityUpdate.body.capabilities.activeModel.profileId, "custom");
      assert.equal(capabilityUpdate.body.capabilities.modelCapabilities.contextWindowTokens, 32_000);
      assert.equal(capabilityUpdate.body.capabilities.modelCapabilities.maxOutputTokens, 4_000);
      assert.equal(capabilityUpdate.body.capabilities.modelCapabilities.supportsToolCalling, true);
      assert.equal(capabilityUpdate.body.capabilities.modelCapabilities.supportsStructuredOutputs, true);
      assert.equal(Array.isArray(capabilities.body.capabilities.toolCatalog.allowedTools), true);
      assert.equal(capabilities.text.includes(secret), false);
      assert.equal(capabilityUpdate.text.includes(secret), false);
      assert.equal(deleteActive.status, 400);
      assert.equal(deleteActive.body.error.code, "invalid_config");
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
  }
});

test("panel config API projects context windows for every configured model option", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-model-capability-options-"));
  const secret = "sk-panel-model-capability-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const createProfile = await requestJson(server.url, "/api/config/model-profiles", {
      method: "POST",
      body: {
        profileId: "openai-router",
        label: "OpenAI Router",
        providerKind: "openai_compatible",
        protocolKind: "openai_responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        defaultAiMode: "openai-responses",
        apiKey: secret,
      },
    });
    const savedCatalog = await requestJson(server.url, "/api/config/model-profiles/openai-router/model-catalog", {
      method: "POST",
      body: {
        label: "OpenAI Router",
        baseUrl: "https://api.openai.com/v1",
        modelsPath: "/models",
        fetchedAt: "2026-06-28T00:00:00.000Z",
        models: [
          { id: "gpt-4.1", displayName: "GPT-4.1" },
          { id: "gpt-4o", displayName: "GPT-4o" },
        ],
      },
    });
    const config = await requestJson(server.url, "/api/config");
    const modelCapabilities = (config.body.modelCapabilityProfiles as readonly {
      readonly profileId: string;
      readonly model: string;
      readonly capabilities: { readonly contextWindowTokens?: number; readonly maxOutputTokens?: number };
    }[]).filter((item) => item.profileId === "openai-router");

    assert.equal(createProfile.status, 200);
    assert.equal(savedCatalog.status, 200);
    assert.equal(config.status, 200);
    assert.equal(
      modelCapabilities.find((item) => item.model === "gpt-4.1")?.capabilities.contextWindowTokens,
      1_047_576
    );
    assert.equal(
      modelCapabilities.find((item) => item.model === "gpt-4o")?.capabilities.contextWindowTokens,
      128_000
    );
    assert.equal(
      modelCapabilities.find((item) => item.model === "gpt-4o")?.capabilities.maxOutputTokens,
      16_384
    );
    assert.equal(config.text.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel model profile catalog route fetches provider models without leaking API keys", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-model-catalog-"));
  const secret = "sk-panel-catalog-secret";
  const catalogCalls: Array<{ url: string; authorization?: string }> = [];
  const modelCatalogFetch: PanelModelCatalogFetch = async (url, init) => {
    catalogCalls.push({ url, authorization: init.headers.authorization });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "deepseek-chat", owned_by: "deepseek" },
          { id: "deepseek-reasoner", owned_by: "deepseek" },
        ],
      }),
    };
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, modelCatalogFetch });
  try {
    const createProfile = await requestJson(server.url, "/api/config/model-profiles", {
      method: "POST",
      body: {
        profileId: "deepseek",
        label: "DeepSeek",
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        defaultAiMode: "openai-compatible",
        apiKey: secret,
      },
    });
    const activateProfile = await requestJson(server.url, "/api/config/model-profiles/deepseek/activate", { method: "POST" });
    const catalog = await requestJson(server.url, "/api/config/model-profiles/deepseek/models");
    const configAfterFetch = await requestJson(server.url, "/api/config");
    const savedCatalog = await requestJson(server.url, "/api/config/model-profiles/deepseek/model-catalog", {
      method: "POST",
      body: {
        label: catalog.body.catalog.label,
        baseUrl: catalog.body.catalog.baseUrl,
        modelsPath: catalog.body.catalog.modelsPath,
        fetchedAt: catalog.body.catalog.fetchedAt,
        models: [catalog.body.catalog.models[0]],
      },
    });
    const configAfterSave = await requestJson(server.url, "/api/config");
    const trimmedCatalog = await requestJson(server.url, "/api/config/model-profiles/deepseek/model-catalog", {
      method: "POST",
      body: {
        label: catalog.body.catalog.label,
        baseUrl: catalog.body.catalog.baseUrl,
        modelsPath: catalog.body.catalog.modelsPath,
        fetchedAt: catalog.body.catalog.fetchedAt,
        models: [catalog.body.catalog.models[1]],
      },
    });
    const configAfterTrim = await requestJson(server.url, "/api/config");
    const selectedRemainingModel = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        profileId: "deepseek",
        label: "DeepSeek",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-reasoner",
        defaultAiMode: "openai-compatible",
      },
    });
    const configAfterSelectRemaining = await requestJson(server.url, "/api/config");
    const emptyCatalog = await requestJson(server.url, "/api/config/model-profiles/deepseek/model-catalog", {
      method: "POST",
      body: {
        label: catalog.body.catalog.label,
        baseUrl: catalog.body.catalog.baseUrl,
        modelsPath: catalog.body.catalog.modelsPath,
        fetchedAt: catalog.body.catalog.fetchedAt,
        models: [],
      },
    });
    const configAfterEmpty = await requestJson(server.url, "/api/config");
    const apiKey = await requestJson(server.url, "/api/config/model-profiles/deepseek/api-key");

    assert.equal(createProfile.status, 200);
    assert.equal(activateProfile.status, 200);
    assert.equal(catalog.status, 200);
    assert.equal(configAfterFetch.status, 200);
    assert.equal(savedCatalog.status, 200);
    assert.equal(configAfterSave.status, 200);
    assert.equal(trimmedCatalog.status, 200);
    assert.equal(configAfterTrim.status, 200);
    assert.equal(selectedRemainingModel.status, 200);
    assert.equal(configAfterSelectRemaining.status, 200);
    assert.equal(emptyCatalog.status, 200);
    assert.equal(configAfterEmpty.status, 200);
    assert.equal(apiKey.status, 200);
    assert.equal(catalogCalls.length, 1);
    assert.equal(catalogCalls[0]?.url, "https://api.deepseek.com/models");
    assert.equal(catalogCalls[0]?.authorization, `Bearer ${secret}`);
    assert.equal(apiKey.body.apiKey, secret);
    assert.deepEqual(
      catalog.body.catalog.models.map((model: { id: string }) => model.id),
      ["deepseek-chat", "deepseek-reasoner"]
    );
    assert.deepEqual(configAfterFetch.body.modelCatalogs, []);
    assert.deepEqual(
      savedCatalog.body.catalog.models.map((model: { id: string }) => model.id),
      ["deepseek-chat"]
    );
    assert.deepEqual(
      configAfterSave.body.modelCatalogs[0].models.map((model: { id: string }) => model.id),
      ["deepseek-chat"]
    );
    assert.deepEqual(
      trimmedCatalog.body.catalog.models.map((model: { id: string }) => model.id),
      ["deepseek-reasoner"]
    );
    assert.equal(
      trimmedCatalog.body.profiles.find((profile: { profileId?: string }) => profile.profileId === "deepseek")?.model,
      undefined
    );
    assert.equal(configAfterTrim.body.config.model, undefined);
    assert.equal(configAfterSelectRemaining.body.config.model, "deepseek-reasoner");
    assert.deepEqual(emptyCatalog.body.catalog.models, []);
    assert.equal(emptyCatalog.body.config.model, undefined);
    assert.equal(
      emptyCatalog.body.profiles.find((profile: { profileId?: string }) => profile.profileId === "deepseek")?.model,
      undefined
    );
    assert.deepEqual(configAfterEmpty.body.modelCatalogs, []);
    assert.equal(configAfterEmpty.body.config.model, undefined);
    assert.equal(catalog.text.includes(secret), false);
    assert.equal(savedCatalog.text.includes(secret), false);
    assert.equal(configAfterSave.text.includes(secret), false);
    assert.equal(selectedRemainingModel.text.includes(secret), false);
    assert.equal(createProfile.text.includes(secret), false);
    assert.equal(activateProfile.text.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel model provider config can clear a saved API key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-clear-model-key-"));
  const secret = "sk-panel-clear-secret";
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const saved = await requestJson(server.url, "/api/config/model-provider", {
        method: "POST",
        body: {
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          defaultAiMode: "openai-compatible",
          apiKey: secret,
        },
      });
      const cleared = await requestJson(server.url, "/api/config/model-provider", {
        method: "POST",
        body: {
          apiKey: "sk-panel-stale-key-should-not-survive",
          clearApiKey: true,
        },
      });
      const config = await requestJson(server.url, "/api/config");
      const apiKey = await requestJson(server.url, "/api/config/model-profiles/default/api-key");

      assert.equal(saved.status, 200);
      assert.equal(saved.body.config.secretConfigured, true);
      assert.equal(cleared.status, 200);
      assert.equal(cleared.body.config.secretConfigured, false);
      assert.equal(config.body.config.secretConfigured, false);
      assert.equal(apiKey.status, 404);
      assert.equal(saved.text.includes(secret), false);
      assert.equal(cleared.text.includes(secret), false);
      assert.equal(cleared.text.includes("sk-panel-stale-key-should-not-survive"), false);
      assert.equal(config.text.includes(secret), false);
      assert.equal(config.text.includes("sk-panel-stale-key-should-not-survive"), false);
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
  }
});

test("panel tool state and MCP config APIs return catalogs without raw MCP secret payloads", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-tools-"));
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const toolState = await requestJson(server.url, "/api/config/tools/shell/state", {
        method: "POST",
        body: { enabled: false },
      });
      const mcp = await requestJson(server.url, "/api/config/mcp", {
        method: "POST",
        body: {
          serverId: "docs",
          label: "Docs",
          description: "Documentation MCP service.",
          transport: "stdio",
          command: "node",
          args: ["server.js", "--token=secret-mcp-value"],
          envSecretRefs: ["secret://local-dev/mcp/docs/token"],
          enabled: true,
        },
      });
      const mcpList = await requestJson(server.url, "/api/config/mcp");

      assert.equal(toolState.status, 200);
      assert.equal(toolState.body.tools.catalog.allowedTools.includes("shell"), false);
      assert.equal(mcp.status, 200);
      assert.equal(mcp.body.catalog[0].serverId, "docs");
      assert.equal(mcp.body.catalog[0].description, "Documentation MCP service.");
      assert.equal(mcp.body.catalog[0].envSecretRefCount, 1);
      assert.equal(mcp.text.includes("secret-mcp-value"), false);
      assert.equal(mcpList.text.includes("secret-mcp-value"), false);
      assert.equal(mcpList.body.catalog[0].availability, "configured");
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
  }
});

test("panel MCP management API tests connection, lists tools, updates whitelist, and keeps secrets out", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-management-"));
  const serverDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-server-"));
  const serverPath = path.join(serverDirectory, "server.mjs");
  await fs.writeFile(serverPath, mcpServerSource(), "utf8");
  const bearerSecret = "secret-mcp-bearer-value";
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const created = await requestJson(server.url, "/api/config/mcp", {
        method: "POST",
        body: {
          serverId: "docs",
          label: "Docs",
          transport: "stdio",
          commandLine: `${process.execPath} ${JSON.stringify(serverPath)}`,
          confirmationMode: "always",
          bearerTokenSecretRef: "secret://local-dev/mcp/docs/bearer",
          enabled: true,
        },
      });
      const secret = await requestJson(server.url, "/api/config/mcp/docs/secrets", {
        method: "POST",
        body: {
          secretRef: "secret://local-dev/mcp/docs/bearer",
          value: bearerSecret,
        },
      });
      const rejectedSecret = await requestJson(server.url, "/api/config/mcp/docs/secrets", {
        method: "POST",
        body: {
          secretRef: "secret://local-dev/mcp/docs/not-declared",
          value: "should-not-save",
        },
      });
      const tested = await requestJson(server.url, "/api/config/mcp/docs/test", { method: "POST" });
      const listed = await requestJson(server.url, "/api/config/mcp/docs/tools");
      const references = await requestJson(server.url, "/api/config/mcp/docs/references");
      const narrowed = await requestJson(server.url, "/api/config/mcp/docs", {
        method: "POST",
        body: {
          serverId: "docs",
          toolExposureMode: "selected",
          enabledTools: ["lookup"],
          autoApprovedTools: [],
        },
      });
      const disabled = await requestJson(server.url, "/api/config/mcp/docs", {
        method: "POST",
        body: {
          serverId: "docs",
          enabled: false,
        },
      });
      const disabledTest = await requestJson(server.url, "/api/config/mcp/docs/test", { method: "POST" });
      const reloaded = await requestJson(server.url, "/api/config/mcp/reload", { method: "POST" });

      assert.equal(created.status, 200);
      assert.equal(created.body.catalog[0].confirmationMode, "always");
      assert.equal(created.body.catalog[0].authSecretRefCount, 1);
      assert.equal(secret.status, 200);
      assert.equal(secret.body.secret.configured, true);
      assert.equal(secret.body.secret.secretRef, "secret://local-dev/mcp/docs/bearer");
      assert.equal(rejectedSecret.status, 400);
      assert.equal(tested.status, 200);
      assert.equal(tested.body.ok, true);
      assert.equal(tested.body.toolCount, 2);
      assert.deepEqual(tested.body.tools.map((tool: { name: string }) => tool.name).sort(), ["lookup", "mutate"]);
      assert.equal(typeof tested.body.connectedAt, "string");
      assert.equal(tested.body.catalog[0].promptCount, 1);
      assert.equal(tested.body.catalog[0].resourceCount, 1);
      assert.equal(tested.body.catalog[0].resourceTemplateCount, 1);
      assert.equal(typeof tested.body.catalog[0].referencesCachedAt, "string");
      assert.equal(listed.status, 200);
      assert.equal(listed.body.toolCount, 2);
      assert.equal(references.status, 200);
      assert.equal(references.body.ok, true);
      assert.equal(references.body.cached, undefined);
      assert.equal(references.body.cachedAt, undefined);
      assert.deepEqual(references.body.prompts.map((prompt: { name: string }) => prompt.name), ["draft_summary"]);
      assert.deepEqual(references.body.resources.map((resource: { name: string }) => resource.name), ["guide"]);
      assert.deepEqual(references.body.resourceTemplates.map((template: { name: string }) => template.name), ["guide-topic"]);
      assert.equal(narrowed.status, 200);
      assert.deepEqual(narrowed.body.catalog[0].enabledTools, ["lookup"]);
      assert.equal(narrowed.body.catalog[0].toolExposureMode, "selected");
      assert.deepEqual(narrowed.body.catalog[0].tools.map((tool: { name: string }) => tool.name), ["docs__lookup", "docs__mutate"]);
      assert.deepEqual(narrowed.body.catalog[0].exposedTools.map((tool: { name: string }) => tool.name), ["docs__lookup"]);
      assert.equal(narrowed.body.catalog[0].exposedTools[0].requiresConfirmation, true);
      assert.equal(disabled.status, 200);
      assert.equal(disabled.body.catalog[0].enabled, false);
      assert.equal(disabled.body.catalog[0].runtimeStatus, "disabled");
      assert.equal(disabledTest.status, 200);
      assert.equal(disabledTest.body.ok, false);
      assert.equal(disabledTest.body.errorCode, "mcp_server_disabled");
      assert.equal(disabledTest.body.toolCount, 0);
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.connected, 0);
      for (const response of [created, secret, rejectedSecret, tested, listed, references, narrowed, disabled, disabledTest, reloaded]) {
        assert.equal(response.text.includes(bearerSecret), false);
        assert.equal(response.text.includes("should-not-save"), false);
      }
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
    await removeTemporaryTree(serverDirectory);
  }
});

test("panel MCP environment check reports command availability without echoing sensitive args", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-env-"));
  const managedBin = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-bin-"));
  const secret = "sk-env-check-should-not-leak";
  const previousManagedBin = process.env.AGENTARBOR_MCP_BIN;
  try {
    process.env.AGENTARBOR_MCP_BIN = managedBin;
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const available = await requestJson(server.url, "/api/config/mcp/environment-check", {
        method: "POST",
        body: {
          commandLine: `${JSON.stringify(process.execPath)} --version`,
        },
      });
      const missing = await requestJson(server.url, "/api/config/mcp/environment-check", {
        method: "POST",
        body: {
          commandLine: `definitely-missing-agentarbor-env-check --token ${secret}`,
        },
      });
      const unsupportedInstall = await requestJson(server.url, "/api/config/mcp/environment-install", {
        method: "POST",
        body: {
          commandLine: `definitely-missing-agentarbor-env-check --token ${secret}`,
        },
      });

      assert.equal(available.status, 200);
      assert.equal(available.body.ok, true);
      assert.equal(available.body.status, "ready");
      assert.equal(available.body.resolvedCommand, path.join(managedBin, process.platform === "win32" ? "node.exe" : "node"));
      assert.equal(available.body.managed, true);
      assert.equal(missing.status, 200);
      assert.equal(missing.body.ok, false);
      assert.equal(missing.body.status, "not_found");
      assert.equal(unsupportedInstall.status, 200);
      assert.equal(unsupportedInstall.body.ok, false);
      assert.equal(unsupportedInstall.body.status, "unsupported");
      assert.equal(missing.text.includes(secret), false);
      assert.equal(unsupportedInstall.text.includes(secret), false);
    } finally {
      await server.close();
    }
  } finally {
    if (previousManagedBin === undefined) {
      delete process.env.AGENTARBOR_MCP_BIN;
    } else {
      process.env.AGENTARBOR_MCP_BIN = previousManagedBin;
    }
    await removeTemporaryTree(directory);
    await removeTemporaryTree(managedBin);
  }
});

test("panel MCP presets and JSON import keep imported servers conservative", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-import-"));
  const token = "ghp-import-token-should-not-leak";
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const presets = await requestJson(server.url, "/api/config/mcp/presets");
      const imported = await requestJson(server.url, "/api/config/mcp/import", {
        method: "POST",
        body: {
          config: JSON.stringify({
            mcpServers: {
              context7: {
                url: "https://mcp.context7.com/mcp",
                headers: {
                  CONTEXT7_API_KEY: token,
                },
              },
              localDocs: {
                command: "node",
                args: ["server.mjs"],
              },
            },
          }),
        },
      });

      assert.equal(presets.status, 200);
      assert.equal(presets.body.presets.some((preset: { presetId: string }) => preset.presetId === "filesystem"), true);
      assert.equal(presets.body.presets.every((preset: { server: { enabled: boolean; toolExposureMode: string } }) => preset.server.enabled === false && preset.server.toolExposureMode === "none"), true);
      assert.equal(imported.status, 200);
      assert.equal(imported.body.importedCount, 2);
      const importedCatalog = imported.body.catalog as readonly { serverId: string; enabled: boolean; toolExposureMode: string; authSecretRefCount: number }[];
      assert.deepEqual(importedCatalog.map((item) => item.serverId).sort(), ["context7", "localdocs"]);
      assert.equal(importedCatalog.find((item) => item.serverId === "context7")?.enabled, false);
      assert.equal(importedCatalog.find((item) => item.serverId === "context7")?.toolExposureMode, "none");
      assert.equal(importedCatalog.find((item) => item.serverId === "context7")?.authSecretRefCount, 1);
      assert.equal(imported.text.includes(token), false);
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
  }
});

test("panel MCP test connection failure returns connection error and leaves system usable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-mcp-failure-"));
  const secret = "sk-should-not-leak-from-mcp-error";
  try {
    const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    try {
      const created = await requestJson(server.url, "/api/config/mcp", {
        method: "POST",
        body: {
          serverId: "broken",
          transport: "stdio",
          command: "definitely-missing-agentarbor-mcp-command",
          args: ["--token", secret],
          enabled: true,
        },
      });
      const tested = await requestJson(server.url, "/api/config/mcp/broken/test", { method: "POST" });
      const list = await requestJson(server.url, "/api/config/mcp");

      assert.equal(created.status, 200);
      assert.equal(tested.status, 200);
      assert.equal(tested.body.ok, false);
      assert.equal(tested.body.errorCode, "command_not_found");
      assert.equal(tested.text.includes(secret), false);
      assert.equal(list.status, 200);
      assert.equal(list.body.catalog[0].runtimeStatus, "error");
      assert.equal(list.text.includes(secret), false);
    } finally {
      await server.close();
    }
  } finally {
    await removeTemporaryTree(directory);
  }
});

test("panel workspace config route stores and returns the workspace directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-config-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-root-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const initial = await requestJson(server.url, "/api/config");
    const update = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const after = await requestJson(server.url, "/api/config");
    const created = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: path.join(workspace, "created", "child") },
    });
    const reset = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: "" },
    });
    const implicitDefault = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: {},
    });

    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.workspace.workspaceDirectory, "string");
    assert.equal(update.status, 200);
    assert.equal(update.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(after.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(created.status, 200);
    assert.equal(created.body.workspace.workspaceDirectory, path.resolve(workspace, "created", "child"));
    assert.equal(reset.status, 200);
    assert.equal(reset.body.workspace.workspaceDirectory, path.join(os.homedir(), ".agentarbor", "workspace"));
    assert.equal(implicitDefault.status, 200);
    assert.equal(implicitDefault.body.workspace.workspaceDirectory, path.join(os.homedir(), ".agentarbor", "workspace"));
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("panel workspace picker route handles success cancellation and unavailable desktop picker", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-picker-"));
  const cancelDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-picker-cancel-"));
  const browserDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-workspace-picker-browser-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-picked-workspace-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    workspaceDirectoryPicker: async () => workspace,
  });
  const cancelServer = await startLocalPanelServer({
    port: 0,
    configDirectory: cancelDirectory,
    workspaceDirectoryPicker: async () => undefined,
  });
  const browserServer = await startLocalPanelServer({
    port: 0,
    configDirectory: browserDirectory,
  });
  try {
    const selected = await requestJson(server.url, "/api/config/workspace/select-directory", { method: "POST" });
    const cancelled = await requestJson(cancelServer.url, "/api/config/workspace/select-directory", { method: "POST" });
    const unavailable = await requestJson(browserServer.url, "/api/config/workspace/select-directory", { method: "POST" });

    assert.equal(selected.status, 200);
    assert.equal(selected.body.status, "completed");
    assert.equal(selected.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(typeof cancelled.body.workspace.workspaceDirectory, "string");
    assert.equal(unavailable.status, 501);
    assert.equal(unavailable.body.error.code, "workspace_picker_unavailable");
    assert.equal(unavailable.body.error.message.includes("手动输入默认文件夹路径"), true);
  } finally {
    await server.close();
    await cancelServer.close();
    await browserServer.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(cancelDirectory);
    await removeTemporaryTree(browserDirectory);
    await removeTemporaryTree(workspace);
  }
});

test("panel task workspace picker returns a transient directory without updating the default workspace", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-task-workspace-picker-"));
  const defaultWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-default-workspace-"));
  const selectedWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-task-workspace-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    workspaceDirectoryPicker: async () => selectedWorkspace,
  });
  try {
    const configured = await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: defaultWorkspace },
    });
    const selected = await requestJson(server.url, "/api/context/workspace/select-directory", { method: "POST" });
    const after = await requestJson(server.url, "/api/config");

    assert.equal(configured.status, 200);
    assert.equal(configured.body.workspace.workspaceDirectory, path.resolve(defaultWorkspace));
    assert.equal(selected.status, 200);
    assert.equal(selected.body.status, "completed");
    assert.equal(selected.body.workspaceDirectory, path.resolve(selectedWorkspace));
    assert.equal(after.body.workspace.workspaceDirectory, path.resolve(defaultWorkspace));
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(defaultWorkspace);
    await removeTemporaryTree(selectedWorkspace);
  }
});

function mcpServerSource(): string {
  const mcpServerModule = import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  const stdioTransportModule = import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  const zodModule = import.meta.resolve("zod");
  return [
    `import { McpServer, ResourceTemplate } from ${JSON.stringify(mcpServerModule)};`,
    `import { StdioServerTransport } from ${JSON.stringify(stdioTransportModule)};`,
    `import { z } from ${JSON.stringify(zodModule)};`,
    'const server = new McpServer({ name: "panel-test", version: "1.0.0" });',
    'server.registerTool("lookup", { description: "Lookup docs.", inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } }, async (args) => ({ content: [{ type: "text", text: `Docs: ${args.query}` }] }));',
    'server.registerTool("mutate", { description: "Mutate docs.", inputSchema: { value: z.string() }, annotations: { destructiveHint: true } }, async (args) => ({ content: [{ type: "text", text: `Mutated: ${args.value}` }] }));',
    'server.registerPrompt("draft_summary", { title: "Draft Summary", description: "Draft a short summary.", argsSchema: { topic: z.string() } }, async (args) => ({ messages: [{ role: "user", content: { type: "text", text: `Summarize ${args.topic}` } }] }));',
    'server.registerResource("guide", "docs://guide", { title: "Guide", description: "Static guide.", mimeType: "text/plain" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: "Guide body" }] }));',
    'server.registerResource("guide-topic", new ResourceTemplate("docs://guide/{topic}", { list: undefined }), { title: "Guide Topic", description: "Guide by topic.", mimeType: "text/plain" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: "Topic guide" }] }));',
    "await server.connect(new StdioServerTransport());",
    "",
  ].join("\n");
}
