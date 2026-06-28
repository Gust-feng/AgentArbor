import assert from "node:assert/strict";
import test from "node:test";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import {
  modelVisibleToolDescription,
  validateModelVisibleToolContract,
} from "../../domain/tools/index.js";
import { createDesktopBasicToolRegistry } from "./builtin-tool-runtime.js";
import { ToolRegistry } from "./tool-registry.js";

test("desktop-basic tool registry exposes catalog and allowed tools from scoped metadata", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: true });
  const catalog = registry.catalog("desktop-basic");

  assert.deepEqual(catalog.allowedTools, [
    "browser_snapshot",
    "create_file",
    "delete_file",
    "edit_file",
    "grep_files",
    "http_request",
    "inspect_context_attachment_archive",
    "inspect_context_attachment_table",
    "list_context_attachment_files",
    "list_context_attachments",
    "list_dir",
    "read",
    "read_context_attachment_image",
    "read_context_attachment_pdf_text",
    "read_context_attachment_table",
    "read_context_attachment_text",
    "read_file",
    "search",
    "search_context_attachment_files",
    "shell_command",
    "write_file",
  ]);
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.visibleResultPolicy.omitRawOutput, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "write_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "create_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "edit_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "delete_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "delete_file")?.fileOperation, "delete");
  assert.equal(catalog.tools.find((tool) => tool.name === "write_file")?.fileOperation, undefined);
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.operationType, "execute");
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.enabledByDefault, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.enabledByDefault, true);
  assert.equal(registry.createToolCenter("desktop-basic").has("run_command"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("shell_command"), true);
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.operationType, "read-only");
  assert.equal(catalog.tools.find((tool) => tool.name === "http_request")?.operationType, "external-submit");
  assert.equal(catalog.tools.find((tool) => tool.name === "http_request")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "http_request")?.displayName, "HTTP 请求");
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.availability, "available");
  assert.equal(catalog.tools.find((tool) => tool.name === "read_file")?.displayName, "读取文件");
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.confirmationLabel, "需确认");
  assert.equal(catalog.tools.every((tool) => tool.displayName !== tool.name), true);
  assert.equal(catalog.tools.every((tool) => tool.categoryLabel.length > 0 && tool.operationLabel.length > 0), true);
  assert.equal(JSON.stringify(catalog).includes("api_key"), false);

  const runCommand = catalog.tools.find((tool) => tool.name === "run_command");
  const shellCommand = catalog.tools.find((tool) => tool.name === "shell_command");
  assert.equal(runCommand?.displayDescription, "兼容旧命令入口，保留给历史运行与旧提示词。");
  assert.equal(shellCommand?.displayDescription, "在当前会话 Shell 中运行命令，并把结果原样返回给模型。");
  assert.match(runCommand?.description ?? "", /Legacy alias of shell_command/);
  assert.match(shellCommand?.description ?? "", /current integrated shell/);
  assert.match(shellCommand?.description ?? "", /Use commandLine for normal shell-native command execution/);
  assert.equal(shellCommand?.runtimeHints?.[0]?.kind, "command_shell");
});

test("desktop-basic model-visible tools carry structured model contracts", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: true });
  const center = registry.createToolCenter("desktop-basic");
  const modelVisibleTools = center.list();

  assert.deepEqual(modelVisibleTools.map((tool) => tool.name), [
    "search",
    "read",
    "read_file",
    "list_dir",
    "grep_files",
    "create_file",
    "write_file",
    "edit_file",
    "delete_file",
    "shell_command",
    "list_context_attachments",
    "read_context_attachment_text",
    "read_context_attachment_pdf_text",
    "read_context_attachment_image",
    "inspect_context_attachment_table",
    "read_context_attachment_table",
    "inspect_context_attachment_archive",
    "list_context_attachment_files",
    "search_context_attachment_files",
    "http_request",
    "browser_snapshot",
  ]);

  for (const tool of modelVisibleTools) {
    const validation = validateModelVisibleToolContract(tool);
    assert.equal(validation.ok, true, `${tool.name}: ${validation.missing.join(", ")}`);
  }
});

test("model-visible tool description is concise and structured for the model", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["shell_command"],
  });
  const shellCommand = registry.createToolCenter("desktop-basic").list()[0];
  assert.notEqual(shellCommand, undefined);
  const description = modelVisibleToolDescription(shellCommand!);

  assert.match(description, /^Run a real command/m);
  assert.match(description, /\nUse for: /);
  assert.match(description, /\nInputs: commandLine/);
  assert.match(description, /\nRuntime: current shell=/);
  assert.match(description, /\nOutputs: result\.stdout/);
  assert.match(description, /creating directories, copying or moving files/);
  assert.match(description, /\nExample: \{"commandLine":"pnpm test","timeoutMs":120000\}/);
  assert.equal(description.includes("When to use"), false);
  assert.doesNotMatch(description, /Shell 命令|需确认|终端命令|风险|运行时工具/);
  assert.equal(description.includes("Allowed tools:"), false);
});

test("desktop-basic tool descriptions stay plain and do not expose deep product terms", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: true });
  const catalog = registry.catalog("desktop-basic");
  const plainToolCopy = catalog.tools
    .filter((tool) => tool.enabledByDefault)
    .map((tool) => [
      tool.name,
      tool.displayName,
      tool.displayDescription,
      tool.description,
      tool.operationLabel,
      tool.riskLabel,
      tool.confirmationLabel,
    ].join("\n"))
    .join("\n\n");

  assert.doesNotMatch(plainToolCopy, /\batomic\b|原子|Plan|Handoff|Underground|rootlet|child agent|普通 Agent|自动执行|执行前确认|高级|智能编辑|变异|mutation/i);
  assert.match(plainToolCopy, /编辑文件/);
  assert.match(plainToolCopy, /精确修改工作区文本文件/);
});

test("desktop-basic tool registry keeps unavailable browser tools out of allowed tools", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: false });
  const catalog = registry.catalog("desktop-basic");

  const browser = catalog.tools.find((tool) => tool.name === "browser_snapshot");
  assert.equal(browser?.availability, "unavailable");
  assert.equal(catalog.allowedTools.includes("browser_snapshot"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("browser_snapshot"), false);
});

test("desktop-basic tool registry keeps image attachment tool unavailable when model lacks vision input", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    modelCapabilities: modelCapabilities({ supportsVisionInput: false }),
  });
  const catalog = registry.catalog("desktop-basic");
  const imageTool = catalog.tools.find((tool) => tool.name === "read_context_attachment_image");

  assert.equal(imageTool?.availability, "unavailable");
  assert.equal(imageTool?.disabledReason, "Current model does not support vision input.");
  assert.equal(catalog.allowedTools.includes("read_context_attachment_image"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("read_context_attachment_image"), false);
});

test("desktop-basic tool registry prefers frozen tool availability over current environment", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["browser_snapshot"],
    toolCatalogAvailability: [
      {
        name: "browser_snapshot",
        availability: "unavailable",
        disabledReason: "Unavailable when the run started.",
      },
    ],
  });
  const catalog = registry.catalog("desktop-basic");
  const browser = catalog.tools.find((tool) => tool.name === "browser_snapshot");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["browser_snapshot"]);
  assert.equal(browser?.availability, "unavailable");
  assert.equal(browser?.disabledReason, "Unavailable when the run started.");
  assert.deepEqual(catalog.allowedTools, []);
  assert.equal(registry.createToolCenter("desktop-basic").has("browser_snapshot"), false);
});

test("desktop-basic tool registry applies configured tool disabled state", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolStates: [{ name: "shell_command", enabled: false, updatedAt: "2026-05-12T00:00:00.000Z" }],
  });
  const catalog = registry.catalog("desktop-basic");

  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.enabledByDefault, false);
  assert.equal(catalog.allowedTools.includes("shell_command"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("shell_command"), false);
});

test("desktop-basic tool registry can keep compatibility executors enabled from frozen tool state", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolStates: [{ name: "run_command", enabled: true, updatedAt: "2026-05-12T00:00:00.000Z" }],
    toolCatalogNames: ["run_command"],
  });
  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["run_command"]);
  assert.deepEqual(catalog.allowedTools, ["run_command"]);
  assert.equal(catalog.tools[0]?.enabledByDefault, true);
  assert.equal(catalog.tools[0]?.requiresConfirmation, true);
  assert.equal(center.has("run_command"), true);
});

test("desktop-basic tool registry can restrict executors to a frozen tool catalog", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["read_file"],
  });
  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["read_file"]);
  assert.deepEqual(catalog.allowedTools, ["read_file"]);
  assert.equal(center.has("read_file"), true);
  assert.equal(center.has("search"), false);
  assert.equal(center.has("run_command"), false);
});

test("desktop-basic tool registry registers read_skill_resource for frozen skill resources", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["read_skill_resource"],
    skillContexts: [{
      skill: {
        id: "repo-review",
        name: "Repo Review",
        description: "Review repositories.",
        enabled: true,
        sourcePath: "Z:/AgentArbor/.agents/skills/repo-review/SKILL.md",
        triggers: ["review"],
        resources: [{
          kind: "reference",
          name: "checklist.md",
          relativePath: "references/checklist.md",
          sourcePath: "Z:/AgentArbor/.agents/skills/repo-review/references/checklist.md",
          byteLength: 32,
          contentHash: "sha256:reference",
        }],
      },
      body: "Use the checklist only when needed.",
      triggerReason: "model selected repo-review",
      loadStatus: "loaded",
      omitted: false,
    }],
  });

  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["read_skill_resource"]);
  assert.deepEqual(catalog.allowedTools, ["read_skill_resource"]);
  assert.equal(center.has("read_skill_resource"), true);
});

test("desktop-basic tool registry does not register read_skill_resource for omitted skill resources", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["read_skill_resource"],
    skillContexts: [{
      skill: {
        id: "repo-review",
        name: "Repo Review",
        description: "Review repositories.",
        enabled: true,
        sourcePath: "Z:/AgentArbor/.agents/skills/repo-review/SKILL.md",
        triggers: ["review"],
        resources: [{
          kind: "reference",
          name: "checklist.md",
          relativePath: "references/checklist.md",
          sourcePath: "Z:/AgentArbor/.agents/skills/repo-review/references/checklist.md",
        }],
      },
      body: "",
      triggerReason: "model selected repo-review",
      loadStatus: "failed",
      omitted: true,
    }],
  });

  assert.deepEqual(registry.catalog("desktop-basic").tools, []);
  assert.equal(registry.createToolCenter("desktop-basic").has("read_skill_resource"), false);
});

test("desktop-basic tool registry keeps MCP tools in the dedicated mcp scope", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    mcpManager: {
      getToolsForRegistry: () => [mcpToolExecutor()],
    } as never,
  });
  const desktopCatalog = registry.catalog("desktop-basic");
  const mcpCatalog = registry.catalog("mcp");

  assert.equal(desktopCatalog.tools.some((tool) => tool.name === "mcp_docs_search"), false);
  assert.equal(desktopCatalog.allowedTools.includes("mcp_docs_search"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("mcp_docs_search"), false);
  assert.deepEqual(mcpCatalog.allowedTools, ["mcp_docs_search"]);
  assert.equal(registry.createToolCenter("mcp").has("mcp_docs_search"), true);
});

test("desktop-basic tool registry applies the frozen tool catalog to MCP executors", () => {
  const hidden = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["read_file"],
    mcpManager: {
      getToolsForRegistry: () => [mcpToolExecutor()],
    } as never,
  });
  const included = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["mcp_docs_search"],
    mcpManager: {
      getToolsForRegistry: () => [mcpToolExecutor()],
    } as never,
  });

  assert.deepEqual(hidden.catalog("mcp").tools, []);
  assert.equal(hidden.createToolCenter("mcp").has("mcp_docs_search"), false);
  assert.deepEqual(included.catalog("desktop-basic").tools, []);
  assert.deepEqual(included.catalog("mcp").allowedTools, ["mcp_docs_search"]);
  assert.equal(included.createToolCenter("mcp").has("mcp_docs_search"), true);
});


test("tool registry rejects tools without complete metadata", () => {
  const registry = new ToolRegistry();
  const executor: ToolExecutor = {
    definition: {
      name: "unsafe_fixture",
      description: "Missing metadata.",
      inputSchema: { type: "object", properties: {} },
    },
    async execute() {
      return { ok: true };
    },
  };

  assert.throws(() => registry.register({ executor, scopes: ["desktop-basic"], enabledByDefault: true }), /without metadata/);
});

test("tool registry rejects enabled built-in-scope tools without model-visible contract guidance", () => {
  const registry = new ToolRegistry();
  const executor: ToolExecutor = {
    definition: {
      name: "thin_visible_tool",
      description: "Thin model-visible tool.",
      inputSchema: { type: "object", properties: {} },
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 400,
          omitRawOutput: true,
        },
      },
    },
    async execute() {
      return { ok: true };
    },
  };

  assert.throws(
    () => registry.register({ executor, scopes: ["desktop-basic"], enabledByDefault: true }),
    /missing model contract fields: modelContract/
  );
});

test("tool registry rejects enabled MCP tools without model-visible contract guidance", () => {
  const registry = new ToolRegistry();
  const executor: ToolExecutor = {
    definition: {
      name: "mcp_thin_tool",
      description: "Thin MCP tool.",
      inputSchema: { type: "object", properties: {} },
      metadata: {
        category: "mcp",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 400,
          omitRawOutput: true,
        },
      },
    },
    async execute() {
      return { ok: true };
    },
  };

  assert.throws(
    () => registry.register({ executor, scopes: ["mcp"], enabledByDefault: true }),
    /missing model contract fields: modelContract/
  );
});

function mcpToolExecutor(): ToolExecutor {
  return {
    definition: {
      name: "mcp_docs_search",
      description: "Search docs through an MCP server.",
      modelContract: {
        purpose: "Search documentation through a configured MCP server.",
        whenToUse: ["Use when docs_search capability is exposed by the MCP server."],
        inputNotes: ["query is required and contains the search text."],
        outputNotes: ["Returns the MCP search result payload."],
        runtimeHints: [
          { label: "MCP server", value: "docs" },
          { label: "MCP tool", value: "search" },
        ],
        examples: [
          { title: "Search docs", input: { query: "routing" } },
        ],
      },
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      metadata: {
        category: "mcp",
        riskLevel: "medium",
        operationType: "external-submit",
        requiresConfirmation: true,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 400,
          omitRawOutput: true,
        },
      },
    },
    async execute() {
      return { ok: true };
    },
  };
}

function modelCapabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    contextWindowTokens: 16_000,
    maxOutputTokens: 4_000,
    supportsToolCalling: true,
    supportsParallelToolCalls: true,
    supportsStructuredOutputs: true,
    supportsStreaming: true,
    supportsVisionInput: true,
    supportsReasoningEffort: false,
    supportsReasoningOutput: false,
    preferredApiStyle: "openai_compatible",
    stability: "stable",
    ...overrides,
  };
}
