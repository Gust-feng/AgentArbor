import assert from "node:assert/strict";
import test from "node:test";
import type { ModelCapabilities } from "../../domain/config/index.js";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import type {
  ToolDefinition,
  ToolInputSchema,
  ToolJsonSchema,
  ToolOperationType,
} from "../../domain/tools/index.js";
import { createModelRuntimeRequestPlan } from "./index.js";

test("model runtime request plan emits strict schemas for structured-output capable models", () => {
  const plan = createModelRuntimeRequestPlan({
    request: request([tool("search", "read-only")]),
    modelCapabilities: capabilities({
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
    }),
  });

  assert.equal(plan.toolChoice, "auto");
  assert.equal(plan.strictToolSchemas, true);
  assert.equal(plan.parallelToolCalls, true);
  assert.deepEqual(plan.tools[0]?.inputSchema.required, ["query"]);
  assert.equal(plan.tools[0]?.inputSchema.additionalProperties, false);
});

test("model runtime request plan preserves complete JSON Schema contracts", () => {
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
  const definition: ToolDefinition = {
    ...tool("schema_fidelity", "read-only"),
    inputSchema,
    outputSchema,
  };
  const loosePlan = createModelRuntimeRequestPlan({
    request: request([definition]),
    modelCapabilities: capabilities({ supportsStructuredOutputs: false }),
  });
  const strictPlan = createModelRuntimeRequestPlan({
    request: request([definition]),
    modelCapabilities: capabilities({ supportsStructuredOutputs: true }),
  });

  assert.deepEqual(loosePlan.tools[0]?.inputSchema, inputSchema);
  assert.deepEqual(loosePlan.tools[0]?.outputSchema, outputSchema);
  assert.deepEqual(strictPlan.tools[0]?.inputSchema, {
    ...inputSchema,
    additionalProperties: false,
  });
  assert.deepEqual(strictPlan.tools[0]?.outputSchema, outputSchema);
});

test("model runtime request plan disables parallel calls when any model-visible tool is risky", () => {
  const plan = createModelRuntimeRequestPlan({
    request: request([tool("search", "read-only"), tool("shell", "execute")]),
    modelCapabilities: capabilities({
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
    }),
  });

  assert.equal(plan.parallelToolCalls, false);
  assert.match(plan.warnings.join("\n"), /关闭并行工具调用/);
});

test("model runtime request plan closes tools when the selected protocol cannot carry tool calls", () => {
  const plan = createModelRuntimeRequestPlan({
    request: request([tool("search", "read-only")]),
    modelCapabilities: capabilities({
      supportsToolCalling: false,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      stability: "stable",
    }),
  });

  assert.equal(plan.toolChoice, "none");
  assert.deepEqual(plan.tools, []);
  assert.equal(plan.parallelToolCalls, false);
  assert.match(plan.warnings.join("\n"), /未启用工具调用/);
  assert.equal(plan.budget.maxInputTokens, 5_488);
});

function request(tools: readonly ToolDefinition[]): ModelRequest {
  return {
    requestId: "request-plan-test",
    traceId: "trace-test",
    callerRef: { kind: "trace", id: "trace-test" },
    purpose: "desktop_agent",
    inputRefs: [],
    sanitizedMessages: [{ role: "user", content: "hello" }],
    tools,
    outputContract: {
      contractId: "text",
      outputKind: "explanation",
      format: "text",
    },
    constraintRefs: [],
    budget: {},
    sensitivity: "internal",
    requestedAt: "2026-05-13T00:00:00.000Z",
  };
}

function tool(name: string, operationType: ToolOperationType): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    metadata: {
      category: operationType === "execute" ? "terminal" : "research",
      riskLevel: operationType === "read-only" ? "low" : "high",
      operationType,
      requiresConfirmation: operationType !== "read-only",
    },
  };
}

function capabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    contextWindowTokens: 8_000,
    maxOutputTokens: 2_000,
    supportsToolCalling: true,
    supportsParallelToolCalls: false,
    supportsStructuredOutputs: false,
    supportsStreaming: true,
    supportsVisionInput: false,
    supportsReasoningEffort: false,
    preferredApiStyle: "openai_compatible",
    stability: "stable",
    ...overrides,
  };
}
