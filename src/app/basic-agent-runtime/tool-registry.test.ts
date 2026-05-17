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
    "shell_command",
  ]);
  assert.equal(catalog.tools.every((tool) => tool.visibleResultPolicy.omitRawOutput), true);
  assert.equal(catalog.tools.find((tool) => tool.name === "create_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "edit_file")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "delete_file")?.requiresConfirmation, true);
  assert.equal(catalog.tools.some((tool) => tool.name === "write_file"), false);
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.operationType, "execute");
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.operationType, "read-only");
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.availability, "available");
  assert.equal(catalog.tools.find((tool) => tool.name === "read_file")?.displayName, "读取文件");
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.confirmationLabel, "执行前确认");
  assert.equal(catalog.tools.every((tool) => tool.displayName !== tool.name), true);
  assert.equal(catalog.tools.every((tool) => tool.categoryLabel.length > 0 && tool.operationLabel.length > 0), true);
  assert.equal(JSON.stringify(catalog).includes("api_key"), false);
});

test("desktop-basic tool registry keeps unavailable browser tools out of allowed tools", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: false });
  const catalog = registry.catalog("desktop-basic");

  const browser = catalog.tools.find((tool) => tool.name === "browser_snapshot");
  assert.equal(browser?.availability, "unavailable");
  assert.equal(catalog.allowedTools.includes("browser_snapshot"), false);
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
