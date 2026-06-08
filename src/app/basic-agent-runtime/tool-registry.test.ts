import assert from "node:assert/strict";
import test from "node:test";
import type { ToolExecutor } from "../../domain/tools/index.js";
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
    "list_dir",
    "read",
    "read_file",
    "run_command",
    "search",
  ]);
  assert.equal(catalog.tools.every((tool) => tool.visibleResultPolicy.omitRawOutput), true);
  assert.equal(catalog.tools.find((tool) => tool.name === "create_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "edit_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "delete_file")?.requiresConfirmation, true);
  assert.equal(catalog.tools.some((tool) => tool.name === "write_file"), false);
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.operationType, "execute");
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.enabledByDefault, false);
  assert.equal(registry.createToolCenter("desktop-basic").has("shell_command"), false);
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.operationType, "read-only");
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.availability, "available");
  assert.equal(catalog.tools.find((tool) => tool.name === "read_file")?.displayName, "读取文件");
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.confirmationLabel, "高影响");
  assert.equal(catalog.tools.every((tool) => tool.displayName !== tool.name), true);
  assert.equal(catalog.tools.every((tool) => tool.categoryLabel.length > 0 && tool.operationLabel.length > 0), true);
  assert.equal(JSON.stringify(catalog).includes("api_key"), false);
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
  assert.match(plainToolCopy, /按唯一锚点修改工作区文本文件/);
});

test("desktop-basic tool registry keeps unavailable browser tools out of allowed tools", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: false });
  const catalog = registry.catalog("desktop-basic");

  const browser = catalog.tools.find((tool) => tool.name === "browser_snapshot");
  assert.equal(browser?.availability, "unavailable");
  assert.equal(catalog.allowedTools.includes("browser_snapshot"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("browser_snapshot"), false);
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

test("desktop-basic tool registry can keep optional executors enabled from frozen tool state", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolStates: [{ name: "shell_command", enabled: true, updatedAt: "2026-05-12T00:00:00.000Z" }],
    toolCatalogNames: ["shell_command"],
  });
  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["shell_command"]);
  assert.deepEqual(catalog.allowedTools, ["shell_command"]);
  assert.equal(catalog.tools[0]?.enabledByDefault, true);
  assert.equal(catalog.tools[0]?.requiresConfirmation, true);
  assert.equal(center.has("shell_command"), true);
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

test("desktop-basic tool registry keeps MCP tools out of the default ordinary agent scope", () => {
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

function mcpToolExecutor(): ToolExecutor {
  return {
    definition: {
      name: "mcp_docs_search",
      description: "Search docs through an MCP server.",
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
