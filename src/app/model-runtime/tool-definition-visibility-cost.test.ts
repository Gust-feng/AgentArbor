import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "../../domain/tools/index.js";
import {
  isProgressiveToolVisibilityCostEffective,
  progressiveToolVisibilityCostGate,
  serializeModelVisibleToolDefinitions,
} from "./tool-definition-visibility-cost.js";

const RESPONSES_SERIALIZATION = {
  api: "openai-responses" as const,
  includeStrict: true,
};
const CHAT_SERIALIZATION_WITH_STRICT = {
  api: "openai-completions" as const,
  includeStrict: true,
};
const CHAT_SERIALIZATION_WITHOUT_STRICT = {
  api: "openai-completions" as const,
  includeStrict: false,
};

test("progressive tool visibility freezes bounded context-relative cost gates", () => {
  assert.deepEqual(progressiveToolVisibilityCostGate(128_000, RESPONSES_SERIALIZATION), {
    minimumDeferredDefinitionTokens: 12_800,
    minimumNetDefinitionSavingsTokens: 320,
    definitionSerialization: RESPONSES_SERIALIZATION,
  });
  assert.deepEqual(progressiveToolVisibilityCostGate(1_000_000, RESPONSES_SERIALIZATION), {
    minimumDeferredDefinitionTokens: 20_000,
    minimumNetDefinitionSavingsTokens: 1_024,
    definitionSerialization: RESPONSES_SERIALIZATION,
  });
  assert.equal(progressiveToolVisibilityCostGate(0, RESPONSES_SERIALIZATION), undefined);
  assert.equal(progressiveToolVisibilityCostGate(Number.NaN, RESPONSES_SERIALIZATION), undefined);
});

test("progressive tool visibility requires both deferred cost and real net savings", () => {
  const base = definition("read");
  const deferred = definition("docs__lookup");
  const search = definition("mcp_search");
  const load = definition("mcp_load");
  const costGate = {
    minimumDeferredDefinitionTokens: 1_000,
    minimumNetDefinitionSavingsTokens: 300,
    definitionSerialization: RESPONSES_SERIALIZATION,
  };

  assert.equal(isProgressiveToolVisibilityCostEffective({
    directDefinitions: [base, deferred],
    deferredDefinitions: [deferred],
    progressiveDefinitions: [base, search, load],
    costGate,
    countTokens: weightedCounter({ read: 100, docs__lookup: 999, mcp_search: 100, mcp_load: 100 }),
  }), false);
  assert.equal(isProgressiveToolVisibilityCostEffective({
    directDefinitions: [base, deferred],
    deferredDefinitions: [deferred],
    progressiveDefinitions: [base, search, load],
    costGate,
    countTokens: weightedCounter({ read: 100, docs__lookup: 1_000, mcp_search: 400, mcp_load: 400 }),
  }), false);
  assert.equal(isProgressiveToolVisibilityCostEffective({
    directDefinitions: [base, deferred],
    deferredDefinitions: [deferred],
    progressiveDefinitions: [base, search, load],
    costGate,
    countTokens: weightedCounter({ read: 100, docs__lookup: 1_100, mcp_search: 400, mcp_load: 400 }),
  }), true);
});

for (const serialization of [CHAT_SERIALIZATION_WITH_STRICT, CHAT_SERIALIZATION_WITHOUT_STRICT]) {
  test(`progressive tool visibility counts the real Chat envelope when includeStrict=${serialization.includeStrict}`, () => {
    const base = definition("read");
    const deferred = definition("docs__lookup");
    const search = definition("mcp_search");
    const load = definition("mcp_load");
    const serializedBatches: string[] = [];
    const countWeightedTokens = weightedCounter({
      read: 100,
      docs__lookup: 1_100,
      mcp_search: 400,
      mcp_load: 400,
    });

    assert.equal(isProgressiveToolVisibilityCostEffective({
      directDefinitions: [base, deferred],
      deferredDefinitions: [deferred],
      progressiveDefinitions: [base, search, load],
      costGate: {
        minimumDeferredDefinitionTokens: 1_000,
        minimumNetDefinitionSavingsTokens: 300,
        definitionSerialization: serialization,
      },
      countTokens: (serialized) => {
        serializedBatches.push(serialized);
        return countWeightedTokens(serialized);
      },
    }), true);

    assert.equal(serializedBatches.length, 3);
    for (const serialized of serializedBatches) {
      const definitions = JSON.parse(serialized) as readonly SerializedToolEnvelope[];
      assert.equal(definitions.length > 0, true);
      for (const definition of definitions) {
        assert.equal(definition.name, undefined);
        assert.equal(typeof definition.function?.name, "string");
        assert.equal(Object.hasOwn(definition.function ?? {}, "strict"), serialization.includeStrict);
        assert.equal(definition.function?.strict, serialization.includeStrict ? false : undefined);
      }
    }
  });
}

test("progressive cost uncertainty preserves direct model visibility", () => {
  const deferred = definition("docs__lookup");
  const costGate = {
    minimumDeferredDefinitionTokens: 1,
    minimumNetDefinitionSavingsTokens: 1,
    definitionSerialization: RESPONSES_SERIALIZATION,
  };
  assert.equal(isProgressiveToolVisibilityCostEffective({
    directDefinitions: [deferred],
    deferredDefinitions: [deferred],
    progressiveDefinitions: [],
    costGate,
    countTokens: () => { throw new Error("tokenizer unavailable"); },
  }), false);
  assert.equal(isProgressiveToolVisibilityCostEffective({
    directDefinitions: [deferred],
    deferredDefinitions: [deferred],
    progressiveDefinitions: [],
    costGate,
    countTokens: () => Number.NaN,
  }), false);
});

test("model-visible cost serialization uses the bounded description and input schema only", () => {
  const definitionWithPrivateFields: ToolDefinition = {
    ...definition("docs__lookup"),
    description: `useful ${"x".repeat(2_000)} private-tail`,
    outputSchema: { type: "object", properties: { secretOutput: { type: "string" } } },
  };

  const serialized = JSON.stringify(serializeModelVisibleToolDefinitions(
    [definitionWithPrivateFields],
    RESPONSES_SERIALIZATION,
  ));

  assert.equal(serialized.includes("private-tail"), false);
  assert.equal(serialized.includes("secretOutput"), false);
  assert.match(serialized, /\[truncated\]/u);
});

test("model-visible cost serialization matches Pi OpenAI tool envelopes", () => {
  const tool = definition("docs__lookup");
  assert.deepEqual(serializeModelVisibleToolDefinitions([tool], RESPONSES_SERIALIZATION), [{
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }]);
  assert.deepEqual(serializeModelVisibleToolDefinitions([tool], CHAT_SERIALIZATION_WITH_STRICT), [{
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    },
  }]);
  assert.deepEqual(serializeModelVisibleToolDefinitions([tool], CHAT_SERIALIZATION_WITHOUT_STRICT), [{
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }]);
});

type SerializedToolEnvelope = {
  readonly name?: unknown;
  readonly function?: {
    readonly name?: unknown;
    readonly strict?: unknown;
  };
};

function weightedCounter(weights: Readonly<Record<string, number>>): (serialized: string) => number {
  return (serialized) => {
    const definitions = JSON.parse(serialized) as readonly SerializedToolEnvelope[];
    return definitions.reduce((total, definition) => {
      const name = typeof definition.name === "string"
        ? definition.name
        : typeof definition.function?.name === "string"
          ? definition.function.name
          : undefined;
      return total + (name === undefined ? 0 : weights[name] ?? 0);
    }, 0);
  };
}

function definition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    metadata: {
      category: "mcp",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}
