import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolExecutor } from "../domain/tools/index.js";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../adapters/config/index.js";
import { CapabilityCenter } from "./capability-center.js";
import { ConfigCenter } from "./config-center.js";

test("CapabilityCenter freezes safe model, tool, skill, and MCP catalog projections", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-"));
  const skillRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-skills-"));
  try {
    await fs.mkdir(path.join(skillRoot, "enabled"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "enabled", "SKILL.md"),
      "---\nname: Repo Review\ndescription: Review repositories.\ntriggers: [review]\n---\n\nDo not include this body in snapshot.",
      "utf8"
    );
    await fs.mkdir(path.join(skillRoot, "disabled"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "disabled", "SKILL.md"),
      "---\nname: Disabled Skill\ndescription: Hidden.\nenabled: false\ntriggers: [review]\n---\n\nDisabled body.",
      "utf8"
    );

    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.updateModelProviderConfig({
      model: "custom-vendor-model",
      apiKey: "sk-capability-secret",
    });
    await configCenter.updateModelCapabilityOverride({
      model: "custom-vendor-model",
      providerKind: "openai_compatible",
      capabilities: {
        contextWindowTokens: 48_000,
        maxOutputTokens: 6_000,
        supportsToolCalling: true,
      },
    });
    await configCenter.updateToolState({ name: "shell_command", enabled: false });
    await configCenter.upsertMcpServer({
      serverId: "docs",
      label: "Docs",
      transport: "stdio",
      command: "node",
      args: ["server.js", "--token", "do-not-leak"],
      envSecretRefs: ["secret://local-dev/mcp/docs/token"],
      confirmationMode: "unsafe_only",
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
      autoApprovedTools: [],
      enabled: true,
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [skillRoot],
      playwrightAvailable: false,
      createMcpManager: () => fakeMcpManager({
        runtimeSnapshots: [
          {
            serverId: "docs",
            status: "connected",
            toolNames: ["lookup"],
          },
        ],
        tools: [mcpToolExecutor("docs__lookup")],
        discoveredTools: [mcpToolExecutor("docs__lookup")],
      }),
    }).snapshot();
    const text = JSON.stringify(snapshot);

    assert.equal(snapshot.activeModel.model, "custom-vendor-model");
    assert.equal(snapshot.activeModel.secretConfigured, true);
    assert.equal(snapshot.modelCapabilities.contextWindowTokens, 48_000);
    assert.equal(snapshot.modelCapabilities.supportsToolCalling, true);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("shell_command"), false);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("browser_snapshot"), false);
    assert.equal(snapshot.toolCatalog.tools.find((tool) => tool.name === "browser_snapshot")?.availability, "unavailable");
    assert.deepEqual(snapshot.skillCatalog.map((skill) => `${skill.name}:${skill.enabled}`), ["Disabled Skill:false", "Repo Review:true"]);
    assert.equal(snapshot.mcpCatalog[0]?.availability, "configured");
    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "connected");
    assert.equal(snapshot.mcpCatalog[0]?.confirmationMode, "unsafe_only");
    assert.deepEqual(snapshot.mcpCatalog[0]?.enabledTools, ["lookup"]);
    assert.equal(snapshot.mcpCatalog[0]?.toolExposureMode, "selected");
    assert.equal(snapshot.mcpCatalog[0]?.envSecretRefCount, 1);
    assert.equal(snapshot.mcpCatalog[0]?.authSecretRefCount, 0);
    assert.deepEqual(snapshot.mcpCatalog[0]?.tools.map((tool) => tool.name), ["docs__lookup"]);
    assert.deepEqual(snapshot.mcpCatalog[0]?.exposedTools.map((tool) => tool.name), ["docs__lookup"]);
    assert.equal(snapshot.toolCatalog.tools.some((tool) => tool.name === "docs__lookup" && tool.scopes.includes("mcp")), true);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("docs__lookup"), true);
    assert.equal(snapshot.toolConfirmation?.policy, "prompt");
    assert.equal(snapshot.toolConfirmation?.shellCommandRequiresConfirmation, true);
    assert.equal(snapshot.securitySummary, "本轮模型、工具、技能和工作区能力快照。确认策略：标准访问。");
    assert.equal(snapshot.securitySummary.includes("prompt"), false);
    assert.equal(snapshot.securitySummary.includes("raw"), false);
    assert.equal(text.includes("sk-capability-secret"), false);
    assert.equal(text.includes("do-not-leak"), false);
    assert.equal(text.includes("Do not include this body"), false);
    assert.equal(text.includes("Disabled body"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(skillRoot, { recursive: true, force: true });
  }
});

test("CapabilityCenter freezes full access confirmation policy in snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-full-access-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.updateToolConfirmationConfig({ policy: "full_access" });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
    }).snapshot();

    assert.equal(snapshot.toolConfirmation?.policy, "full_access");
    assert.equal(snapshot.toolConfirmation?.shellCommandRequiresConfirmation, false);
    assert.equal(snapshot.securitySummary.includes("完全访问"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("CapabilityCenter applies MCP enabledTools and confirmation mode before model exposure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-mcp-policy-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.upsertMcpServer({
      serverId: "docs",
      label: "Docs",
      transport: "stdio",
      command: "node",
      confirmationMode: "always",
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
      autoApprovedTools: [],
      enabled: true,
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
      createMcpManager: () => fakeMcpManager({
        runtimeSnapshots: [
          {
            serverId: "docs",
            status: "connected",
            toolNames: ["lookup", "mutate"],
          },
        ],
        tools: [
          mcpToolExecutor("docs__lookup", { requiresConfirmation: true }),
        ],
        discoveredTools: [
          mcpToolExecutor("docs__lookup", { requiresConfirmation: true }),
          mcpToolExecutor("docs__mutate", { operationType: "read-write" }),
        ],
      }),
    }).snapshot();

    assert.deepEqual(snapshot.mcpCatalog[0]?.tools.map((tool) => tool.name), ["docs__lookup", "docs__mutate"]);
    assert.deepEqual(snapshot.mcpCatalog[0]?.exposedTools.map((tool) => tool.name), ["docs__lookup"]);
    assert.deepEqual(snapshot.toolCatalog.allowedTools.filter((name) => name.startsWith("docs__")), ["docs__lookup"]);
    assert.equal(snapshot.mcpCatalog[0]?.exposedTools[0]?.requiresConfirmation, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("CapabilityCenter marks incomplete MCP servers unavailable without connecting", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-mcp-missing-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.upsertMcpServer({
      serverId: "missing-command",
      label: "Missing Command",
      transport: "stdio",
      enabled: true,
    });
    let connected = false;

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
      createMcpManager: () => fakeMcpManager({
        connectAll: async () => {
          connected = true;
        },
      }),
    }).snapshot();

    assert.equal(connected, false);
    assert.equal(snapshot.mcpCatalog[0]?.availability, "unavailable");
    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "unavailable");
    assert.deepEqual(snapshot.mcpCatalog[0]?.tools, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("CapabilityCenter keeps MCP connection error summaries in snapshot without config args", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-mcp-error-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.upsertMcpServer({
      serverId: "broken",
      label: "Broken",
      transport: "stdio",
      command: "node",
      args: ["server.js", "--token", "do-not-leak"],
      envSecretRefs: ["secret://local-dev/mcp/broken/token"],
      enabled: true,
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
      createMcpManager: () => fakeMcpManager({
        runtimeSnapshots: [
          {
            serverId: "broken",
            status: "error",
            errorSummary: "spawn failed Authorization: Bearer runtime-token",
            toolNames: [],
          },
        ],
      }),
    }).snapshot();
    const text = JSON.stringify(snapshot);

    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "error");
    assert.match(snapshot.mcpCatalog[0]?.errorSummary ?? "", /runtime-token/);
    assert.equal(text.includes("do-not-leak"), false);
    assert.equal(text.includes("--token"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function fakeMcpManager(input: {
  readonly runtimeSnapshots?: ReturnType<import("../adapters/mcp/index.js").McpManager["getServerRuntimeSnapshots"]>;
  readonly tools?: readonly ToolExecutor[];
  readonly discoveredTools?: readonly ToolExecutor[];
  readonly connectAll?: () => Promise<void>;
} = {}) {
  return {
    async connectAll() {
      await input.connectAll?.();
    },
    async disconnectAll() {},
    getServerRuntimeSnapshots() {
      return input.runtimeSnapshots ?? [];
    },
    getToolsForRegistry() {
      return input.tools ?? [];
    },
    getDiscoveredToolsForRegistry() {
      return input.discoveredTools ?? input.tools ?? [];
    },
  };
}

function mcpToolExecutor(
  name: string,
  options: {
    readonly operationType?: "read-only" | "read-write" | "execute" | "external-submit";
    readonly requiresConfirmation?: boolean;
  } = {}
): ToolExecutor {
  const operationType = options.operationType ?? "read-only";
  const readOnly = operationType === "read-only";
  const requiresConfirmation = options.requiresConfirmation ?? !readOnly;
  return {
    definition: {
      name,
      description: "Lookup docs through MCP.",
      modelContract: {
        purpose: "Lookup documentation through a configured MCP server.",
        whenToUse: ["Use when this MCP docs lookup capability is needed."],
        inputNotes: ["query is required and contains the lookup text."],
        outputNotes: ["Returns the MCP lookup result payload."],
        runtimeHints: [
          { label: "MCP server", value: name.split("__")[0] ?? "mcp" },
          { label: "MCP tool", value: name.split("__")[1] ?? name },
        ],
        examples: [
          { title: "Lookup docs", input: { query: "routing" } },
        ],
      },
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      metadata: {
        category: "mcp",
        riskLevel: readOnly ? "low" : "high",
        operationType,
        requiresConfirmation,
        visibleResultPolicy: {
          userVisible: "safe-preview",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
    },
    async execute() {
      return { summary: "ok" };
    },
  };
}
