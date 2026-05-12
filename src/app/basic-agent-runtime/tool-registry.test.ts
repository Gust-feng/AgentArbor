import assert from "node:assert/strict";
import test from "node:test";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { createDesktopBasicToolRegistry, ToolRegistry } from "./tool-registry.js";

test("desktop-basic tool registry exposes catalog and allowed tools from scoped metadata", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: true });
  const catalog = registry.catalog("desktop-basic");

  assert.deepEqual(catalog.allowedTools, [
    "browser_snapshot",
    "edit_file",
    "grep_files",
    "list_dir",
    "read",
    "read_file",
    "run_command",
    "search",
    "shell_command",
    "write_file",
  ]);
  assert.equal(catalog.tools.every((tool) => tool.visibleResultPolicy.omitRawOutput), true);
  assert.equal(catalog.tools.find((tool) => tool.name === "write_file")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "run_command")?.operationType, "execute");
  assert.equal(catalog.tools.find((tool) => tool.name === "shell_command")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.operationType, "read-only");
  assert.equal(catalog.tools.find((tool) => tool.name === "browser_snapshot")?.availability, "available");
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
