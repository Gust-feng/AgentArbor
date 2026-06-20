import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "./contracts.js";
import {
  resolveEffectiveConfirmationRequirement,
  validateModelVisibleToolContract,
} from "./index.js";

// 这些测试覆盖「进模型可见集合」的完备门槛（FR-TOOL-001 / FR-TOOL-002）：
// 工具必须同时具备完整的能力契约元数据（metadata）与模型可见功能性契约
// （modelContract），且确认要求在缺策略时取保守默认。完备门槛只依赖工具
// 自身的显式契约字段，不依赖工具名前缀、关键字或硬编码白名单。

function completeToolDefinition(): ToolDefinition {
  return {
    name: "fixture_tool",
    description: "A fixture tool that carries a complete model-visible contract.",
    inputSchema: { type: "object", properties: {} },
    metadata: {
      category: "workspace",
      riskLevel: "low",
      operationType: "read-write",
      requiresConfirmation: false,
      visibleResultPolicy: {
        userVisible: "safe-preview",
        maxPreviewChars: 800,
        omitRawOutput: false,
      },
    },
    modelContract: {
      purpose: "Fixture purpose: demonstrate contract completeness.",
      whenToUse: ["When you need fixture behavior."],
      whenNotToUse: ["Avoid for unrelated tasks."],
      inputNotes: ["Provide input X."],
      usageNotes: ["Validate X before calling."],
      outputNotes: ["Returns the fixture result payload."],
      runtimeHints: [{ label: "maxCalls", value: "10" }],
      examples: [{ input: { x: 1 } }],
    },
  };
}

function withMetadataFieldRemoved(field: string): ToolDefinition {
  const base = completeToolDefinition();
  const metadata = { ...(base.metadata as object) } as Record<string, unknown>;
  delete metadata[field];
  return { ...base, metadata: metadata as ToolDefinition["metadata"] };
}

function withModelContractFieldRemoved(field: string): ToolDefinition {
  const base = completeToolDefinition();
  const contract = { ...(base.modelContract as object) } as Record<string, unknown>;
  delete contract[field];
  return { ...base, modelContract: contract as ToolDefinition["modelContract"] };
}

test("validateModelVisibleToolContract accepts a tool with complete contract and metadata", () => {
  const validation = validateModelVisibleToolContract(completeToolDefinition());
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.missing, []);
});

test("validateModelVisibleToolContract flags a blank description", () => {
  const validation = validateModelVisibleToolContract({ ...completeToolDefinition(), description: "   " });
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("description"));
});

test("validateModelVisibleToolContract requires metadata presence (FR-TOOL-002)", () => {
  const validation = validateModelVisibleToolContract({ ...completeToolDefinition(), metadata: undefined });
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("metadata"));
});

test("validateModelVisibleToolContract requires every capability metadata field", () => {
  for (const field of ["category", "riskLevel", "operationType", "requiresConfirmation", "visibleResultPolicy"]) {
    const validation = validateModelVisibleToolContract(withMetadataFieldRemoved(field));
    assert.equal(validation.ok, false, `expected ${field} to be flagged as missing`);
    assert.ok(
      validation.missing.includes(`metadata.${field}`),
      `expected missing to include metadata.${field}, got: ${validation.missing.join(", ")}`
    );
  }
});

test("validateModelVisibleToolContract requires modelContract presence", () => {
  const validation = validateModelVisibleToolContract({ ...completeToolDefinition(), modelContract: undefined });
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("modelContract"));
});

test("validateModelVisibleToolContract requires modelContract guidance fields", () => {
  for (const field of ["outputNotes", "runtimeHints", "examples"]) {
    const validation = validateModelVisibleToolContract(withModelContractFieldRemoved(field));
    assert.equal(validation.ok, false, `expected ${field} to be flagged as missing`);
    assert.ok(
      validation.missing.some((item) => item.includes(`modelContract.${field}`)),
      `expected missing to reference modelContract.${field}, got: ${validation.missing.join(", ")}`
    );
  }
});

test("resolveEffectiveConfirmationRequirement treats explicit requiresConfirmation as authoritative", () => {
  assert.equal(resolveEffectiveConfirmationRequirement({ requiresConfirmation: true }), true);
  assert.equal(resolveEffectiveConfirmationRequirement({ requiresConfirmation: false }), false);
});

test("resolveEffectiveConfirmationRequirement defaults to confirmation for high-impact actions when the field is missing (FR-TOOL-002)", () => {
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
