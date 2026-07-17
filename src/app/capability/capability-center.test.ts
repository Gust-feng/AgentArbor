import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../../adapters/config/index.js";
import { CapabilityCenter } from "./capability-center.js";
import { ConfigCenter } from "../config-center/index.js";
import type { SkillRootInput } from "../skills/index.js";
import type { SubAgentRootInput } from "../sub-agents/sub-agent-loader.js";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";

test("CapabilityCenter exposes the shared tool-output reader when the Host provides its store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-tool-output-"));
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
      playwrightAvailable: false,
      toolOutputStore: new InMemoryToolOutputStore(),
    }).snapshot();

    const reader = snapshot.toolCatalog.tools.find((tool) => tool.name === "read_tool_output");
    assert.equal(reader?.availability, "available");
    assert.equal(reader?.enabled, true);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("read_tool_output"), true);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("CapabilityCenter freezes transient run workspace without changing the default workspace", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-workspace-"));
  const defaultWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-default-workspace-"));
  const runWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-run-workspace-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.updateWorkspaceConfig({ workspaceDirectory: defaultWorkspace });
    const center = new CapabilityCenter({ configCenter, skillRoots: [] });

    const defaultSnapshot = await center.snapshot();
    const runSnapshot = await center.snapshot({ workspaceDirectory: runWorkspace });
    const cachedDefaultSnapshot = await center.snapshot();
    const persistedWorkspace = await configCenter.getWorkspaceConfig();

    assert.equal(defaultSnapshot.workspace.workspaceDirectory, path.resolve(defaultWorkspace));
    assert.equal(runSnapshot.workspace.workspaceDirectory, path.resolve(runWorkspace));
    assert.equal(cachedDefaultSnapshot.snapshotId, defaultSnapshot.snapshotId);
    assert.equal(cachedDefaultSnapshot.workspace.workspaceDirectory, path.resolve(defaultWorkspace));
    assert.equal(persistedWorkspace.workspaceDirectory, path.resolve(defaultWorkspace));
  } finally {
    await removeTestDirectory(directory);
    await removeTestDirectory(defaultWorkspace);
    await removeTestDirectory(runWorkspace);
  }
});

test("CapabilityCenter retries a default snapshot after a transient assembly failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-snapshot-retry-"));
  try {
    const configCenter = new ConfigCenter({
      settingsStore: new FileSystemNormalSettingsStore(directory),
      secretStore: new FileSystemLocalDevSecretStore(directory),
    });
    const readModel = configCenter.getModelProviderConfig.bind(configCenter);
    let attempts = 0;
    configCenter.getModelProviderConfig = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient model configuration read failure");
      return readModel();
    };
    const center = new CapabilityCenter({ configCenter, skillRoots: [], playwrightAvailable: false });

    await assert.rejects(center.snapshot(), /transient model configuration read failure/);
    const recovered = await center.snapshot();

    assert.equal(attempts, 2);
    assert.match(recovered.snapshotId, /^capability-snapshot-/);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("CapabilityCenter discovers project skills from the effective workspace", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-workspace-skills-"));
  const userSkillRoot = path.join(directory, "user-skills");
  const defaultWorkspace = path.join(directory, "default-workspace");
  const runWorkspace = path.join(directory, "run-workspace");
  try {
    await writeTestSkillPackage(userSkillRoot, "global-helper", "Global helper skill.");
    await writeTestSkillPackage(
      path.join(defaultWorkspace, ".agents", "skills"),
      "default-helper",
      "Default workspace skill."
    );
    await writeTestSkillPackage(
      path.join(runWorkspace, ".agents", "skills"),
      "run-helper",
      "Run workspace skill."
    );

    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.updateWorkspaceConfig({ workspaceDirectory: defaultWorkspace });
    const center = new CapabilityCenter({
      configCenter,
      skillRoots: skillRootsForWorkspace(userSkillRoot, defaultWorkspace),
      resolveSkillRoots: (input) => skillRootsForWorkspace(
        userSkillRoot,
        input.workspaceDirectory ?? defaultWorkspace
      ),
    });

    const defaultSkills = await center.listSkills();
    const runSnapshot = await center.snapshot({ workspaceDirectory: runWorkspace });

    assert.deepEqual(defaultSkills.map((skill) => `${skill.name}:${skill.sourceKind}`).sort(), [
      "default-helper:project",
      "global-helper:user",
    ]);
    assert.deepEqual(runSnapshot.skillCatalog.map((skill) => `${skill.name}:${skill.sourceKind}`).sort(), [
      "global-helper:user",
      "run-helper:project",
    ]);
    assert.equal(runSnapshot.skillCatalog.some((skill) => skill.name === "default-helper"), false);
    assert.equal(runSnapshot.skillCatalog.find((skill) => skill.name === "run-helper")?.sourceRootId, "project");
  } finally {
    await removeTestDirectory(directory);
  }
});

test("CapabilityCenter discovers project sub-agents and tools from the effective workspace", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-workspace-sub-agents-"));
  const defaultWorkspace = path.join(directory, "default-workspace");
  const runWorkspace = path.join(directory, "run-workspace");
  try {
    await writeTestSubAgentPackage(
      path.join(defaultWorkspace, ".agents", "sub-agents"),
      "default-helper",
      "Default workspace helper."
    );
    await writeTestSubAgentPackage(
      path.join(runWorkspace, ".agents", "sub-agents"),
      "run-helper",
      "Run workspace helper."
    );

    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.updateWorkspaceConfig({ workspaceDirectory: defaultWorkspace });
    const center = new CapabilityCenter({
      configCenter,
      skillRoots: [],
      resolveSubAgentRoots: (input) =>
        subAgentRootsForWorkspace(input.workspaceDirectory ?? defaultWorkspace),
      playwrightAvailable: false,
    });

    const defaultSubAgents = await center.listSubAgents();
    const runSnapshot = await center.snapshot({ workspaceDirectory: runWorkspace });
    const panelCatalog = await center.toolCatalog({ workspaceDirectory: runWorkspace });

    assert.deepEqual(defaultSubAgents.map((subAgent) => `${subAgent.name}:${subAgent.sourceKind}`), [
      "default-helper:project",
    ]);
    assert.deepEqual(runSnapshot.subAgentCatalog.map((subAgent) => `${subAgent.name}:${subAgent.sourceKind}`), [
      "run-helper:project",
    ]);
    assert.equal(runSnapshot.subAgentCatalog[0]?.sourceRootId, "project");
    assert.equal(runSnapshot.toolCatalog.allowedTools.includes("call_sub_agent"), true);
    assert.equal(runSnapshot.toolCatalog.allowedTools.includes("spawn_sub_agent"), true);
    assert.equal(runSnapshot.toolCatalog.allowedTools.includes("call_sub_agents"), false);
    assert.equal(runSnapshot.toolCatalog.tools.find((tool) => tool.name === "call_sub_agent")?.catalogOnly, true);
    assert.equal(runSnapshot.toolCatalog.tools.find((tool) => tool.name === "spawn_sub_agent")?.catalogOnly, true);
    assert.equal(runSnapshot.toolCatalog.allowedTools.includes("read_sub_agent_output"), false);
    assert.equal(panelCatalog.scope, "desktop-basic");
    assert.equal(panelCatalog.tools.some((tool) => tool.name === "call_sub_agent"), false);
    assert.equal(panelCatalog.allowedTools.every((name) =>
      panelCatalog.tools.some((tool) => tool.name === name && tool.enabledByDefault)), true);
    assert.equal(panelCatalog.tools.every((tool) => tool.inputSchema.type === "object"), true);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("CapabilityCenter freezes safe model, tool, skill, and MCP catalog projections", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-"));
  const skillRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-skills-"));
  try {
    await fs.mkdir(path.join(skillRoot, "repo-review"), { recursive: true });
    await fs.mkdir(path.join(skillRoot, "repo-review", "scripts"), { recursive: true });
    await fs.mkdir(path.join(skillRoot, "repo-review", "refs"), { recursive: true });
    await fs.mkdir(path.join(skillRoot, "repo-review", "assets"), { recursive: true });
    await fs.writeFile(path.join(skillRoot, "repo-review", "scripts", "review.js"), "export default function review() {}\n", "utf8");
    await fs.writeFile(path.join(skillRoot, "repo-review", "refs", "checklist.md"), "# Checklist\n", "utf8");
    await fs.writeFile(path.join(skillRoot, "repo-review", "assets", "logo.txt"), "asset-bytes\n", "utf8");
    await fs.writeFile(
      path.join(skillRoot, "repo-review", "SKILL.md"),
      [
        "---",
        "name: repo-review",
        "description: |",
        "  Review repositories.",
        "when_to_use: Use when a repository review requires a checklist.",
        "disable-model-invocation: false",
        "user-invocable: true",
        "summary: Review code changes with repository context.",
        "category: code-review",
        "version: 2.1.0",
        "provenance:",
        "  registry: project",
        "  plugin: repo-tools",
        "  revision: 42",
        "  verified: true",
        "  sourcePath: do-not-leak",
        "  token: do-not-leak",
        "license: MIT",
        "common: &common",
        "  agent: desktop_agent",
        "compatibility:",
        "  <<: *common",
        "  agent: desktop_agent",
        "  platform: cross-platform",
        "metadata:",
        "  owner: platform",
        "  priority: 3",
        "  secretPath: do-not-leak",
        "allowed-tools: [read_file, docs__lookup]",
        "scripts: [scripts/review.js]",
        "references: [refs/checklist.md]",
        "assets: [assets/logo.txt]",
        "triggers: [review]",
        "---",
        "",
        "Do not include this body in snapshot.",
      ].join("\n"),
      "utf8"
    );
    await fs.mkdir(path.join(skillRoot, "disabled-skill"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "disabled-skill", "SKILL.md"),
      "---\nname: disabled-skill\ndescription: Hidden.\nenabled: false\ntriggers: [review]\n---\n\nDisabled body.",
      "utf8"
    );
    await fs.mkdir(path.join(skillRoot, "invalid-skill"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "invalid-skill", "SKILL.md"),
      "---\nname: invalid-skill\nenabled: true\ntriggers: [invalid]\n---\n",
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
      description: "Documentation MCP service.",
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
    await configCenter.updateMcpServerConnectionState({
      serverId: "docs",
      connectedAt: "2026-06-20T00:00:00.000Z",
      cachedTools: [
        {
          name: "lookup",
          description: "Lookup docs through MCP.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          annotations: { readOnlyHint: true },
        },
      ],
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [{ rootPath: skillRoot, sourceKind: "project", sourceRootId: "project", precedence: 100 }],
      playwrightAvailable: false,
    }).snapshot();
    const text = JSON.stringify(snapshot);

    assert.equal(snapshot.activeModel.model, "custom-vendor-model");
    assert.equal(snapshot.activeModel.secretConfigured, true);
    assert.equal(snapshot.modelCapabilities.contextWindowTokens, 48_000);
    assert.equal(snapshot.modelCapabilities.supportsToolCalling, true);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("shell_command"), false);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("browser_snapshot"), false);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("read_skill_resource"), false);
    assert.equal(snapshot.toolCatalog.tools.find((tool) => tool.name === "browser_snapshot")?.availability, "unavailable");
    assert.equal(snapshot.toolCatalog.tools.find((tool) => tool.name === "read_skill_resource")?.displayName, "读取技能资源");
    assert.equal(snapshot.toolCatalog.tools.find((tool) => tool.name === "read_skill_resource")?.enabled, true);
    const shellTool = snapshot.toolCatalog.tools.find((tool) => tool.name === "shell_command");
    assert.equal(shellTool?.inputSchema?.properties.commandLine !== undefined, true);
    assert.match(shellTool?.modelContract?.purpose ?? "", /stdout/);
    assert.equal((shellTool?.modelContract?.examples?.length ?? 0) > 0, true);
    assert.deepEqual(snapshot.skillCatalog.map((skill) => `${skill.name}:${skill.enabled}`), [
      "disabled-skill:false",
      "invalid-skill:false",
      "repo-review:true",
    ]);
    const reviewSkill = snapshot.skillCatalog.find((skill) => skill.id === "repo-review");
    assert.equal(reviewSkill?.summary, "Review code changes with repository context.");
    assert.equal(reviewSkill?.category, "code-review");
    assert.equal(reviewSkill?.sourceKind, "project");
    assert.equal(reviewSkill?.sourceRootId, "project");
    assert.equal(reviewSkill?.sourcePrecedence, 100);
    assert.equal(reviewSkill?.stateKey, "source:project:repo-review");
    assert.equal(reviewSkill?.whenToUse, "Use when a repository review requires a checklist.");
    assert.equal(reviewSkill?.disableModelInvocation, false);
    assert.equal(reviewSkill?.userInvocable, true);
    assert.equal(reviewSkill?.version, "2.1.0");
    assert.deepEqual(reviewSkill?.provenance, {
      registry: "project",
      plugin: "repo-tools",
      revision: 42,
      verified: true,
    });
    assert.equal(reviewSkill?.license, "MIT");
    assert.deepEqual(reviewSkill?.compatibility, { agent: "desktop_agent", platform: "cross-platform" });
    assert.deepEqual(reviewSkill?.metadata, { owner: "platform", priority: 3 });
    assert.deepEqual(reviewSkill?.allowedTools, ["read_file", "docs__lookup"]);
    assert.equal(reviewSkill?.validationStatus, "valid");
    assert.match(reviewSkill?.contentHash ?? "", /^sha256:/);
    assert.match(reviewSkill?.bodyHash ?? "", /^sha256:/);
    assert.deepEqual(reviewSkill?.resources?.map((resource) => resource.kind).sort(), ["asset", "reference", "script"]);
    assert.equal(reviewSkill?.resources?.every((resource) => resource.contentHash?.startsWith("sha256:")), true);
    const invalidSkill = snapshot.skillCatalog.find((skill) => skill.id === "invalid-skill");
    assert.equal(invalidSkill?.validationStatus, "invalid");
    assert.deepEqual(invalidSkill?.validationErrors, ["description is required"]);
    assert.equal(snapshot.mcpCatalog[0]?.availability, "configured");
    assert.equal(snapshot.mcpCatalog[0]?.description, "Documentation MCP service.");
    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "configured");
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
    assert.equal(snapshot.skillTrigger?.mode, "keyword");
    assert.equal(snapshot.skillTrigger?.modelRouterEnabled, false);
    assert.equal(snapshot.securitySummary, "本轮模型、工具、技能和工作区能力快照。确认策略：标准访问。");
    assert.equal(snapshot.securitySummary.includes("prompt"), false);
    assert.equal(snapshot.securitySummary.includes("raw"), false);
    assert.equal(text.includes("sk-capability-secret"), false);
    assert.equal(text.includes("do-not-leak"), false);
    assert.equal(text.includes("Do not include this body"), false);
    assert.equal(text.includes("Disabled body"), false);
  } finally {
    await removeTestDirectory(directory);
    await removeTestDirectory(skillRoot);
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
    await removeTestDirectory(directory);
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
    await configCenter.updateMcpServerConnectionState({
      serverId: "docs",
      connectedAt: "2026-06-20T00:00:00.000Z",
      cachedTools: [
        {
          name: "lookup",
          description: "Lookup docs through MCP.",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          annotations: { readOnlyHint: true },
        },
        {
          name: "mutate",
          description: "Mutate docs through MCP.",
          inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
          annotations: { destructiveHint: true },
        },
      ],
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
    }).snapshot();

    assert.deepEqual(snapshot.mcpCatalog[0]?.tools.map((tool) => tool.name), ["docs__lookup", "docs__mutate"]);
    assert.deepEqual(snapshot.mcpCatalog[0]?.exposedTools.map((tool) => tool.name), ["docs__lookup"]);
    assert.deepEqual(snapshot.toolCatalog.allowedTools.filter((name) => name.startsWith("docs__")), ["docs__lookup"]);
    assert.equal(snapshot.mcpCatalog[0]?.exposedTools[0]?.requiresConfirmation, true);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("CapabilityCenter leaves uncached configured MCP servers out of the model tool list", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-mcp-uncached-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.upsertMcpServer({
      serverId: "docs",
      label: "Docs",
      transport: "stdio",
      command: "node",
      confirmationMode: "unsafe_only",
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
      autoApprovedTools: [],
      enabled: true,
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
    }).snapshot();

    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "configured");
    assert.deepEqual(snapshot.mcpCatalog[0]?.tools, []);
    assert.deepEqual(snapshot.mcpCatalog[0]?.exposedTools, []);
    assert.equal(snapshot.toolCatalog.allowedTools.includes("docs__lookup"), false);
  } finally {
    await removeTestDirectory(directory);
  }
});

test("CapabilityCenter uses cached MCP tools without reconnecting unchanged servers", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-capability-center-mcp-cache-"));
  try {
    const settingsStore = new FileSystemNormalSettingsStore(directory);
    const secretStore = new FileSystemLocalDevSecretStore(directory);
    const configCenter = new ConfigCenter({ settingsStore, secretStore });
    await configCenter.upsertMcpServer({
      serverId: "docs",
      label: "Docs",
      transport: "http",
      url: "https://mcp.example.test/mcp",
      confirmationMode: "unsafe_only",
      toolExposureMode: "selected",
      enabledTools: ["lookup"],
      autoApprovedTools: [],
      enabled: true,
    });
    await configCenter.updateMcpServerConnectionState({
      serverId: "docs",
      connectedAt: "2026-06-20T00:00:00.000Z",
      cachedTools: [
        {
          name: "lookup",
          description: "Lookup docs.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          annotations: { readOnlyHint: true },
        },
      ],
      cachedReferences: {
        prompts: [{ name: "draft", description: "Draft docs." }],
        resources: [{ uri: "docs://guide", name: "guide" }],
        resourceTemplates: [{ uriTemplate: "docs://guide/{topic}", name: "guide-topic" }],
      },
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
    }).snapshot();

    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "configured");
    assert.equal(snapshot.mcpCatalog[0]?.promptCount, 1);
    assert.equal(snapshot.mcpCatalog[0]?.resourceCount, 1);
    assert.equal(snapshot.mcpCatalog[0]?.resourceTemplateCount, 1);
    assert.equal(typeof snapshot.mcpCatalog[0]?.referencesCachedAt, "string");
    assert.deepEqual(snapshot.mcpCatalog[0]?.tools.map((tool) => tool.name), ["docs__lookup"]);
    assert.deepEqual(snapshot.mcpCatalog[0]?.exposedTools.map((tool) => tool.name), ["docs__lookup"]);
    assert.deepEqual(snapshot.toolCatalog.allowedTools.filter((name) => name.startsWith("docs__")), ["docs__lookup"]);
  } finally {
    await removeTestDirectory(directory);
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

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
    }).snapshot();

    assert.equal(snapshot.mcpCatalog[0]?.availability, "unavailable");
    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "unavailable");
    assert.deepEqual(snapshot.mcpCatalog[0]?.tools, []);
  } finally {
    await removeTestDirectory(directory);
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
    await configCenter.updateMcpServerConnectionState({
      serverId: "broken",
      errorSummary: "spawn failed Authorization: Bearer runtime-token",
    });

    const snapshot = await new CapabilityCenter({
      configCenter,
      skillRoots: [],
    }).snapshot();
    const text = JSON.stringify(snapshot);

    assert.equal(snapshot.mcpCatalog[0]?.runtimeStatus, "error");
    assert.match(snapshot.mcpCatalog[0]?.errorSummary ?? "", /runtime-token/);
    assert.equal(text.includes("do-not-leak"), false);
    assert.equal(text.includes("--token"), false);
  } finally {
    await removeTestDirectory(directory);
  }
});

function skillRootsForWorkspace(userSkillRoot: string, workspaceDirectory: string): readonly SkillRootInput[] {
  return [
    {
      rootPath: userSkillRoot,
      sourceKind: "user",
      sourceRootId: "user",
      precedence: 10,
    },
    {
      rootPath: path.join(workspaceDirectory, ".agents", "skills"),
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    },
  ];
}

function subAgentRootsForWorkspace(workspaceDirectory: string): readonly SubAgentRootInput[] {
  return [
    {
      rootPath: path.join(workspaceDirectory, ".agents", "sub-agents"),
      sourceKind: "project",
      sourceRootId: "project",
      precedence: 100,
    },
  ];
}

async function writeTestSkillPackage(root: string, packageName: string, description: string): Promise<void> {
  const skillDir = path.join(root, packageName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${packageName}\ndescription: ${description}\n---\n\n${description}`,
    "utf8"
  );
}

async function writeTestSubAgentPackage(root: string, packageName: string, description: string): Promise<void> {
  const subAgentDir = path.join(root, packageName);
  await fs.mkdir(subAgentDir, { recursive: true });
  await fs.writeFile(
    path.join(subAgentDir, "SUB_AGENT.md"),
    [
      "---",
      `name: ${packageName}`,
      `description: ${description}`,
      "enabled: true",
      "allowedTools: [read_file]",
      "maxSteps: 12",
      "---",
      "",
      description,
    ].join("\n"),
    "utf8"
  );
}

async function removeTestDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
