import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemNormalSettingsStore } from "../adapters/config/index.js";
import { startLocalPanelServer, type PanelModelCatalogFetch } from "./panel-server.js";
import { removeTemporaryTree, requestJson } from "./panel-server-test-utils.js";

test("panel config API keeps model provider and search keys out of ordinary responses", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-config-"));
  const secret = "sk-panel-secret";
  const tavilySecret = "tvly-panel-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const update = await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example/",
        model: "panel-model",
        defaultAiMode: "fake",
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
      config.body.modelProviderMarket.presets.some((preset: { presetId?: string; baseUrl?: string }) =>
        preset.presetId === "claude" && preset.baseUrl === "https://api.anthropic.com"
      ),
      true
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
    assert.equal(update.body.config.baseUrl, "https://provider.example");
    assert.equal(update.body.config.defaultAiMode, "openai-compatible");
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
      initial.body.tools.catalog.tools.some((tool: { name?: string; availability?: string }) => tool.name === "browser_snapshot" && (tool.availability === "available" || tool.availability === "unavailable")),
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
    assert.equal(update.body.commandShell.kind, "pwsh");
    assert.equal(update.body.commandShell.syntax, "powershell");
    assert.equal(update.body.capabilities.commandShell.kind, "pwsh");
    assert.equal(after.body.commandShell.kind, "pwsh");
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
          model: "unknown-model",
          defaultAiMode: "openai-compatible",
          apiKey: secret,
        },
      });
      const activate = await requestJson(server.url, "/api/config/model-profiles/custom/activate", { method: "POST" });
      const capabilities = await requestJson(server.url, "/api/config/capabilities");
      const deleteActive = await requestJson(server.url, "/api/config/model-profiles/custom", { method: "DELETE" });

      assert.equal(createProfile.status, 200);
      assert.equal(activate.status, 200);
      assert.equal(capabilities.status, 200);
      assert.equal(capabilities.body.capabilities.activeModel.profileId, "custom");
      assert.equal(capabilities.body.capabilities.modelCapabilities.contextWindowTokens, 16_000);
      assert.equal(capabilities.body.capabilities.modelCapabilities.supportsToolCalling, false);
      assert.equal(Array.isArray(capabilities.body.capabilities.toolCatalog.allowedTools), true);
      assert.equal(capabilities.text.includes(secret), false);
      assert.equal(deleteActive.status, 400);
      assert.equal(deleteActive.body.error.code, "invalid_config");
    } finally {
      await server.close();
    }
  } finally {
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
    assert.equal(catalog.status, 200);
    assert.equal(configAfterFetch.status, 200);
    assert.equal(savedCatalog.status, 200);
    assert.equal(configAfterSave.status, 200);
    assert.equal(trimmedCatalog.status, 200);
    assert.equal(configAfterTrim.status, 200);
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
    assert.equal(configAfterTrim.body.config.model, undefined);
    assert.deepEqual(emptyCatalog.body.catalog.models, []);
    assert.deepEqual(configAfterEmpty.body.modelCatalogs, []);
    assert.equal(catalog.text.includes(secret), false);
    assert.equal(savedCatalog.text.includes(secret), false);
    assert.equal(configAfterSave.text.includes(secret), false);
    assert.equal(createProfile.text.includes(secret), false);
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
      const toolState = await requestJson(server.url, "/api/config/tools/shell_command/state", {
        method: "POST",
        body: { enabled: false },
      });
      const mcp = await requestJson(server.url, "/api/config/mcp", {
        method: "POST",
        body: {
          serverId: "docs",
          label: "Docs",
          transport: "stdio",
          command: "node",
          args: ["server.js", "--token=secret-mcp-value"],
          envSecretRefs: ["secret://local-dev/mcp/docs/token"],
          enabled: true,
        },
      });
      const mcpList = await requestJson(server.url, "/api/config/mcp");

      assert.equal(toolState.status, 200);
      assert.equal(toolState.body.tools.catalog.allowedTools.includes("shell_command"), false);
      assert.equal(mcp.status, 200);
      assert.equal(mcp.body.catalog[0].serverId, "docs");
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
      assert.equal(listed.status, 200);
      assert.equal(listed.body.toolCount, 2);
      assert.equal(references.status, 200);
      assert.equal(references.body.ok, true);
      assert.deepEqual(references.body.prompts.map((prompt: { name: string }) => prompt.name), ["draft_summary"]);
      assert.deepEqual(references.body.resources.map((resource: { name: string }) => resource.name), ["guide"]);
      assert.deepEqual(references.body.resourceTemplates.map((template: { name: string }) => template.name), ["guide-topic"]);
      assert.equal(narrowed.status, 200);
      assert.deepEqual(narrowed.body.catalog[0].enabledTools, ["lookup"]);
      assert.equal(narrowed.body.catalog[0].toolExposureMode, "selected");
      assert.deepEqual(narrowed.body.catalog[0].tools.map((tool: { name: string }) => tool.name), ["docs__lookup", "docs__mutate"]);
      assert.deepEqual(narrowed.body.catalog[0].exposedTools.map((tool: { name: string }) => tool.name), ["docs__lookup"]);
      assert.equal(narrowed.body.catalog[0].exposedTools[0].requiresConfirmation, false);
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.connected, 1);
      for (const response of [created, secret, rejectedSecret, tested, listed, references, narrowed, reloaded]) {
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

test("panel MCP test connection failure returns sanitized error and leaves system usable", async () => {
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

    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.workspace.workspaceDirectory, "string");
    assert.equal(update.status, 200);
    assert.equal(update.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(after.body.workspace.workspaceDirectory, path.resolve(workspace));
    assert.equal(created.status, 200);
    assert.equal(created.body.workspace.workspaceDirectory, path.resolve(workspace, "created", "child"));
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
    assert.equal(unavailable.body.error.message.includes("手动输入工作文件夹路径"), true);
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
