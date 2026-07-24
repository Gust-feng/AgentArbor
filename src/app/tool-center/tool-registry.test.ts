import assert from "node:assert/strict";
import test from "node:test";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ToolExecutor, ToolInputSchema, ToolJsonSchema } from "../../domain/tools/index.js";
import {
  MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS,
  modelVisibleToolDescription,
  validateModelVisibleToolContract,
} from "../../domain/tools/index.js";
import { createDesktopBasicToolRegistryForTest as createDesktopBasicToolRegistry } from "../testing/desktop-basic-tool-registry.js";
import { ToolRegistry } from "./tool-registry.js";
import { registerSkillResourceTool } from "../skills/skill-resource-tool.js";
import { createTaskSoil } from "../../domain/soil/index.js";

test("desktop-basic tool registry exposes catalog and allowed tools from scoped metadata", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: true });
  const catalog = registry.catalog("desktop-basic");

  assert.deepEqual(catalog.allowedTools, [
    "AttachmentInspectArchive",
    "AttachmentInspectTable",
    "AttachmentList",
    "AttachmentListFiles",
    "AttachmentRead",
    "AttachmentReadImage",
    "AttachmentReadPdf",
    "AttachmentReadTable",
    "AttachmentSearchFiles",
    "Edit",
    "Glob",
    "Grep",
    "HttpRequest",
    "ProcessRead",
    "ProcessStop",
    "Read",
    "ResearchRead",
    "ResearchSearch",
    "Shell",
    "WebFetch",
    "Write",
  ]);
  assert.equal(catalog.tools.find((tool) => tool.name === "Shell")?.requiresConfirmation, true);
  assert.equal(catalog.tools.find((tool) => tool.name === "Write")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "Edit")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "Write")?.fileOperation, undefined);
  assert.equal(catalog.tools.find((tool) => tool.name === "Shell")?.enabledByDefault, true);
  assert.equal(registry.createToolCenter("desktop-basic").has("Shell"), true);
  assert.equal(catalog.tools.find((tool) => tool.name === "WebFetch")?.operationType, "read-only");
  assert.equal(catalog.tools.find((tool) => tool.name === "HttpRequest")?.operationType, "external-submit");
  assert.equal(catalog.tools.find((tool) => tool.name === "HttpRequest")?.requiresConfirmation, false);
  assert.equal(catalog.tools.find((tool) => tool.name === "HttpRequest")?.displayName, "HTTP 请求");
  assert.equal(catalog.tools.find((tool) => tool.name === "WebFetch")?.availability, "available");
  assert.equal(catalog.tools.find((tool) => tool.name === "Read")?.displayName, "读取文件");
  assert.equal(catalog.tools.find((tool) => tool.name === "Shell")?.confirmationLabel, "需确认");
  assert.equal(catalog.tools.every((tool) => tool.displayName !== tool.name), true);
  assert.equal(catalog.tools.every((tool) => tool.categoryLabel.length > 0 && tool.operationLabel.length > 0), true);
  assert.equal(JSON.stringify(catalog).includes("api_key"), false);

  const shellCommand = catalog.tools.find((tool) => tool.name === "Shell");
  assert.equal(shellCommand?.displayDescription, "在当前会话 Shell 中运行命令，适合构建、测试、脚本和通用 CLI 工作流。");
  assert.match(shellCommand?.description ?? "", /workspace command/);
  assert.match(shellCommand?.description ?? "", /ProcessRead and ProcessStop/);
  assert.doesNotMatch(shellCommand?.description ?? "", /HTTP requests/);
  assert.equal(shellCommand?.runtimeHints?.[0]?.kind, "command_shell");
});

test("desktop-basic model-visible tools satisfy the executable factual contract", () => {
  const registry = createDesktopBasicToolRegistry({ env: {}, workspaceRoot: process.cwd(), playwrightAvailable: true });
  const center = registry.createToolCenter("desktop-basic");
  const modelVisibleTools = center.list();

  assert.deepEqual(modelVisibleTools.map((tool) => tool.name), [
    "ResearchSearch",
    "ResearchRead",
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Shell",
    "ProcessRead",
    "ProcessStop",
    "AttachmentList",
    "AttachmentRead",
    "AttachmentReadPdf",
    "AttachmentReadImage",
    "AttachmentInspectTable",
    "AttachmentReadTable",
    "AttachmentInspectArchive",
    "AttachmentListFiles",
    "AttachmentSearchFiles",
    "HttpRequest",
    "WebFetch",
  ]);

  for (const tool of modelVisibleTools) {
    const validation = validateModelVisibleToolContract(tool);
    assert.equal(validation.ok, true, `${tool.name}: ${validation.missing.join(", ")}`);
  }
});

test("core workspace schemas reject unknown fields and express numeric constraints", () => {
  const center = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
  }).createToolCenter("desktop-basic");
  const byName = new Map(center.list().map((tool) => [tool.name, tool] as const));

  for (const name of ["Read", "Glob", "Grep", "Write", "Edit", "Shell", "ProcessRead", "ProcessStop"]) {
    assert.equal(byName.get(name)?.inputSchema.additionalProperties, false, name);
  }

  const editsSchema = schemaRecord(byName.get("Edit")?.inputSchema.properties.edits);
  const editItems = schemaRecord(editsSchema.items);
  assert.equal(editItems.additionalProperties, false);
  assert.equal("occurrence" in schemaRecord(editItems.properties), false);

  const shell = byName.get("Shell")!;
  const processRead = byName.get("ProcessRead")!;
  const processStop = byName.get("ProcessStop")!;
  const read = byName.get("Read")!;
  const glob = byName.get("Glob")!;
  const grep = byName.get("Grep")!;
  const http = byName.get("HttpRequest")!;
  const browser = byName.get("WebFetch")!;
  assert.deepEqual(shell.inputSchema.required, ["command"]);
  assert.equal("background" in shell.inputSchema.properties, true);
  assert.equal("waitForPort" in shell.inputSchema.properties, false);
  assert.equal(processRead.inputSchema.required, undefined);
  assert.deepEqual(processStop.inputSchema.required, ["processId"]);
  assert.equal(schemaRecord(read.inputSchema.properties.startLine).type, "integer");
  assert.equal(schemaRecord(read.inputSchema.properties.startLine).minimum, 1);
  assert.equal(Array.isArray(read.inputSchema.allOf) ? read.inputSchema.allOf.length : 0, 4);
  assert.equal(schemaRecord(glob.inputSchema.properties.limit).type, "integer");
  assert.equal(schemaRecord(glob.inputSchema.properties.limit).maximum, 200);
  assert.equal(schemaRecord(grep.inputSchema.properties.offset).type, "integer");
  assert.equal(schemaRecord(grep.inputSchema.properties.offset).maximum, 10_000);
  assert.equal(Array.isArray(http.inputSchema.oneOf), true);
  assert.equal(schemaRecord(http.inputSchema.properties.startChar).type, "integer");
  assert.equal(schemaRecord(http.inputSchema.properties.timeoutMs).maximum, 120_000);
  assert.equal(Array.isArray(browser.inputSchema.oneOf), true);
  assert.equal(schemaRecord(browser.inputSchema.properties.waitMs).maximum, 5_000);
});

test("model-visible tool description is a concise objective capability summary", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["Shell"],
  });
  const shellCommand = registry.createToolCenter("desktop-basic").list()[0];
  assert.notEqual(shellCommand, undefined);
  const description = modelVisibleToolDescription(shellCommand!);

  assert.match(description, /^Run a workspace command in the foreground or start it as an owned background process\./);
  assert.match(description, /ProcessRead and ProcessStop/);
  assert.doesNotMatch(description, /stdout|Runtime:|continuation|package manager|dev servers/);
  assert.equal(description.length <= MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS, true);
  assert.equal(description.includes("When to use"), false);
  assert.doesNotMatch(description, /Shell 命令|需确认|终端命令|风险|运行时工具/);
  assert.equal(description.includes("Allowed tools:"), false);
});

test("web tool descriptions clearly separate raw HTTP from rendered browser reading", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["HttpRequest", "WebFetch"],
  });
  const center = registry.createToolCenter("desktop-basic");
  const httpRequest = center.list().find((tool) => tool.name === "HttpRequest");
  const browserSnapshot = center.list().find((tool) => tool.name === "WebFetch");
  assert.notEqual(httpRequest, undefined);
  assert.notEqual(browserSnapshot, undefined);

  const httpDescription = modelVisibleToolDescription(httpRequest!);
  const browserDescription = modelVisibleToolDescription(browserSnapshot!);

  assert.match(httpDescription, /^Send a bounded stateless HTTP or HTTPS request/m);
  assert.doesNotMatch(httpDescription, /OAuth|cookie jar|Avoid for/);
  assert.match(browserDescription, /^Read rendered text from an HTTP\(S\) page in an isolated browser session\./m);
  assert.doesNotMatch(browserDescription, /Playwright|Avoid for|session state=/);
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

  const browser = catalog.tools.find((tool) => tool.name === "WebFetch");
  assert.equal(browser?.availability, "unavailable");
  assert.equal(catalog.allowedTools.includes("WebFetch"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("WebFetch"), false);
});

test("desktop-basic tool registry keeps image attachment tool unavailable when model lacks vision input", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    modelCapabilities: modelCapabilities({ supportsVisionInput: false }),
  });
  const catalog = registry.catalog("desktop-basic");
  const imageTool = catalog.tools.find((tool) => tool.name === "AttachmentReadImage");

  assert.equal(imageTool?.availability, "unavailable");
  assert.equal(imageTool?.disabledReason, "Current model does not support vision input.");
  assert.equal(catalog.allowedTools.includes("AttachmentReadImage"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("AttachmentReadImage"), false);
});

test("run-scoped registry hides context attachment executors when Task Soil has no attachments", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    taskSoil: createTaskSoil({ rawGoal: "inspect the repository" }),
  });

  const contextToolNames = registry
    .createToolCenter("desktop-basic")
    .list()
    .map((tool) => tool.name)
    .filter((name) => name.startsWith("Attachment"));
  assert.deepEqual(contextToolNames, []);
});

test("run-scoped registry keeps context attachment executors when Task Soil contains an attachment", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    taskSoil: createTaskSoil({
      rawGoal: "inspect the attached note",
      contextRefs: [{
        attachmentId: "note",
        ref: "file:notes.md",
        kind: "file",
        title: "notes.md",
      }],
      permissionBoundaryRefs: ["read:file:notes.md"],
    }),
  });

  const center = registry.createToolCenter("desktop-basic");
  assert.equal(center.has("AttachmentList"), true);
  assert.equal(center.has("AttachmentRead"), true);
});

test("run-scoped registry omits managed process tools without Host process capabilities", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    taskSoil: createTaskSoil({ rawGoal: "run a foreground command" }),
  });
  const center = registry.createToolCenter("desktop-basic");

  assert.equal(center.has("Shell"), true);
  assert.equal(center.has("ProcessRead"), false);
  assert.equal(center.has("ProcessStop"), false);
  assert.equal(center.has("ProcessStart"), false);
});

test("desktop-basic tool registry prefers frozen tool availability over current environment", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["WebFetch"],
    toolCatalogAvailability: [
      {
        name: "WebFetch",
        availability: "unavailable",
        disabledReason: "Unavailable when the run started.",
      },
    ],
  });
  const catalog = registry.catalog("desktop-basic");
  const browser = catalog.tools.find((tool) => tool.name === "WebFetch");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["WebFetch"]);
  assert.equal(browser?.availability, "unavailable");
  assert.equal(browser?.disabledReason, "Unavailable when the run started.");
  assert.deepEqual(catalog.allowedTools, []);
  assert.equal(registry.createToolCenter("desktop-basic").has("WebFetch"), false);
});

test("desktop-basic tool registry applies configured tool disabled state", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolStates: [{ name: "Shell", enabled: false, updatedAt: "2026-05-12T00:00:00.000Z" }],
  });
  const catalog = registry.catalog("desktop-basic");

  assert.equal(catalog.tools.find((tool) => tool.name === "Shell")?.enabledByDefault, false);
  assert.equal(catalog.allowedTools.includes("Shell"), false);
  assert.equal(registry.createToolCenter("desktop-basic").has("Shell"), false);
});

test("desktop-basic tool registry can restrict executors to a frozen tool catalog", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["Read"],
  });
  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["Read"]);
  assert.deepEqual(catalog.allowedTools, ["Read"]);
  assert.equal(center.has("Read"), true);
  assert.equal(center.has("ResearchSearch"), false);
});

test("desktop-basic tool registry registers SkillRead for frozen skill resources", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["SkillRead"],
  });
  registerSkillResourceTool(registry, [{
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
      loadStatus: "loaded",
      omitted: false,
    }]);

  const catalog = registry.catalog("desktop-basic");
  const center = registry.createToolCenter("desktop-basic");

  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["SkillRead"]);
  assert.deepEqual(catalog.allowedTools, ["SkillRead"]);
  assert.equal(catalog.tools[0]?.displayName, "读取技能资源");
  assert.equal(catalog.tools[0]?.displayDescription, "按本轮已选中技能读取参考资源或查看资源元数据。");
  assert.equal(center.has("SkillRead"), true);
});

test("desktop-basic tool registry does not register SkillRead for omitted skill resources", () => {
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: process.cwd(),
    playwrightAvailable: true,
    toolCatalogNames: ["SkillRead"],
  });
  registerSkillResourceTool(registry, [{
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
      loadStatus: "failed",
      omitted: true,
    }]);

  assert.deepEqual(registry.catalog("desktop-basic").tools, []);
  assert.equal(registry.createToolCenter("desktop-basic").has("SkillRead"), false);
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
    toolCatalogNames: ["Read"],
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

test("tool registry preserves complete input and output JSON Schema in catalog and executor definitions", () => {
  const inputSchema: ToolInputSchema = {
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
  };
  const outputSchema: ToolJsonSchema = {
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
  };
  const executor: ToolExecutor = {
    definition: {
      name: "schema_fidelity_tool",
      description: "Tool with a complete JSON Schema contract.",
      inputSchema,
      outputSchema,
      metadata: {
        category: "other",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
      },
    },
    async execute() {
      return { ok: true };
    },
  };
  const registry = new ToolRegistry();
  registry.register({ executor, scopes: ["desktop-basic"], enabledByDefault: true });

  const catalogTool = registry.catalog("desktop-basic").tools[0];
  const executableTool = registry.createToolCenter("desktop-basic").list()[0];
  assert.deepEqual(catalogTool?.inputSchema, inputSchema);
  assert.deepEqual(catalogTool?.outputSchema, outputSchema);
  assert.deepEqual(executableTool?.inputSchema, inputSchema);
  assert.deepEqual(executableTool?.outputSchema, outputSchema);
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

test("tool registry accepts enabled built-in tools with one complete definition", () => {
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
      },
    },
    async execute() {
      return { ok: true };
    },
  };

  registry.register({ executor, scopes: ["desktop-basic"], enabledByDefault: true });
  assert.equal(registry.createToolCenter("desktop-basic").has("thin_visible_tool"), true);
  assert.deepEqual(registry.catalog("desktop-basic").allowedTools, ["thin_visible_tool"]);
});

test("tool registry accepts enabled MCP tools with one complete definition", () => {
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
      },
    },
    async execute() {
      return { ok: true };
    },
  };

  registry.register({ executor, scopes: ["mcp"], enabledByDefault: true });
  assert.equal(registry.createToolCenter("mcp").has("mcp_thin_tool"), true);
  assert.deepEqual(registry.catalog("mcp").allowedTools, ["mcp_thin_tool"]);
});

test("tool registry rejects duplicate canonical tool identities", () => {
  const registry = new ToolRegistry();
  const executor = mcpToolExecutor();
  registry.register({ executor, scopes: ["mcp"], enabledByDefault: true });

  assert.throws(
    () => registry.register({ executor, scopes: ["desktop-basic"], enabledByDefault: true }),
    /already registered/u,
  );
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

function schemaRecord(value: unknown): Readonly<Record<string, unknown>> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Readonly<Record<string, unknown>>;
}
