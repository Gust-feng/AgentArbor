import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "./contracts.js";
import {
  MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS,
  modelVisibleToolDescription,
  resolveEffectiveConfirmationRequirement,
  validateModelVisibleToolContract,
} from "./index.js";

// 模型可见准入只守定义事实；真实结果与 continuation 由 ToolCenter/executor 行为测试覆盖。

function completeToolDefinition(): ToolDefinition {
  return {
    name: "fixture_tool",
    description: "Read a fixture value and return the observed fact.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
    metadata: {
      category: "workspace",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}

function withMetadataFieldRemoved(field: string): ToolDefinition {
  const base = completeToolDefinition();
  const metadata = { ...(base.metadata as object) } as Record<string, unknown>;
  delete metadata[field];
  return { ...base, metadata: metadata as ToolDefinition["metadata"] };
}

function withInvalidInputSchema(inputSchema: unknown): ToolDefinition {
  return {
    ...completeToolDefinition(),
    inputSchema: inputSchema as ToolDefinition["inputSchema"],
  };
}

test("validateModelVisibleToolContract accepts an executable factual contract", () => {
  const validation = validateModelVisibleToolContract(completeToolDefinition());
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.missing, []);
});

test("validateModelVisibleToolContract requires identity and an objective description", () => {
  const blankName = validateModelVisibleToolContract({ ...completeToolDefinition(), name: "   " });
  assert.equal(blankName.ok, false);
  assert.ok(blankName.missing.includes("name"));

  const blankDescription = validateModelVisibleToolContract({
    ...completeToolDefinition(),
    description: "   ",
  });
  assert.equal(blankDescription.ok, false);
  assert.ok(blankDescription.missing.includes("description"));
});

test("validateModelVisibleToolContract requires an object input schema", () => {
  const invalidSchemas: readonly unknown[] = [
    undefined,
    { type: "array", properties: {} },
    { type: "object", properties: [] },
    { type: "object", properties: { key: { type: "string" } }, required: [42] },
    { type: "object", properties: {}, additionalProperties: "yes" },
  ];
  for (const inputSchema of invalidSchemas) {
    const validation = validateModelVisibleToolContract(withInvalidInputSchema(inputSchema));
    assert.equal(validation.ok, false);
    assert.ok(validation.missing.includes("inputSchema"));
  }
});

test("validateModelVisibleToolContract accepts required names supplied by schema composition", () => {
  const validation = validateModelVisibleToolContract(withInvalidInputSchema({
    type: "object",
    properties: {},
    allOf: [{ $ref: "#/$defs/input" }],
    $defs: {
      input: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
    required: ["key"],
  }));
  assert.deepEqual(validation, { ok: true, missing: [] });
});

test("validateModelVisibleToolContract requires execution and side-effect metadata", () => {
  const missingMetadata = validateModelVisibleToolContract({
    ...completeToolDefinition(),
    metadata: undefined,
  });
  assert.equal(missingMetadata.ok, false);
  assert.ok(missingMetadata.missing.includes("metadata"));

  for (const field of ["category", "riskLevel", "operationType", "requiresConfirmation"]) {
    const validation = validateModelVisibleToolContract(withMetadataFieldRemoved(field));
    assert.equal(validation.ok, false, `expected ${field} to be required`);
    assert.ok(validation.missing.includes(`metadata.${field}`));
  }

  const invalidFileOperation = completeToolDefinition();
  const validation = validateModelVisibleToolContract({
    ...invalidFileOperation,
    metadata: {
      ...invalidFileOperation.metadata!,
      fileOperation: "rename" as NonNullable<ToolDefinition["metadata"]>["fileOperation"],
    },
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("metadata.fileOperation"));
});

test("modelVisibleToolDescription exposes only the objective tool description", () => {
  const definition: ToolDefinition = {
    ...completeToolDefinition(),
  };
  const description = modelVisibleToolDescription(definition);

  assert.equal(description, definition.description);
  assert.doesNotMatch(description, /continuation|PowerShell|background|Optional recommendation/);
});

test("modelVisibleToolDescription applies the explicit budget to its objective description", () => {
  const description = modelVisibleToolDescription(
    {
      ...completeToolDefinition(),
      description: `Read a bounded resource. ${"objective detail ".repeat(40)}`,
    },
    { maxChars: 220 }
  );

  assert.equal(description.length <= 220, true);
  assert.match(description, /^Read a bounded resource\./);
  assert.match(description, /…\[truncated\]$/);
  assert.doesNotMatch(description, /continuation\.nextInput|x{100}/);
});

test("an oversized objective is bounded without appending execution metadata", () => {
  const description = modelVisibleToolDescription({
    ...completeToolDefinition(),
    description: `Read a bounded resource. ${"objective detail ".repeat(800)}`,
  });

  assert.equal(description.length <= MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS, true);
  assert.match(description, /^Read a bounded resource\./);
  assert.match(description, /…\[truncated\]$/);
  assert.doesNotMatch(description, /continuation\.nextInput|Runtime:|read-only/);
});

test("default model-visible description budget remains explicit and bounded", () => {
  const definition: ToolDefinition = {
    ...completeToolDefinition(),
    description: "y".repeat(MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS * 2),
  };
  assert.equal(
    modelVisibleToolDescription(definition).length <= MODEL_VISIBLE_TOOL_DESCRIPTION_MAX_CHARS,
    true
  );
});

test("resolveEffectiveConfirmationRequirement treats explicit requiresConfirmation as authoritative", () => {
  assert.equal(resolveEffectiveConfirmationRequirement({ requiresConfirmation: true }), true);
  assert.equal(resolveEffectiveConfirmationRequirement({ requiresConfirmation: false }), false);
});

test("resolveEffectiveConfirmationRequirement defaults to confirmation for high-impact actions when the field is missing", () => {
  assert.equal(resolveEffectiveConfirmationRequirement({ operationType: "execute" }), true);
  assert.equal(resolveEffectiveConfirmationRequirement({ operationType: "external-submit" }), true);
  assert.equal(resolveEffectiveConfirmationRequirement({ fileOperation: "delete" }), true);
  assert.equal(resolveEffectiveConfirmationRequirement({ riskLevel: "high" }), true);
});

test("resolveEffectiveConfirmationRequirement does not require confirmation for low-impact read paths by default", () => {
  assert.equal(resolveEffectiveConfirmationRequirement({ operationType: "read-only", riskLevel: "low" }), false);
  assert.equal(resolveEffectiveConfirmationRequirement({}), false);
});

test("resolveEffectiveConfirmationRequirement defaults to confirmation when metadata is entirely undefined", () => {
  assert.equal(resolveEffectiveConfirmationRequirement(undefined), true);
});
