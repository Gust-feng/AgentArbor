import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidToolSchemaError,
  cloneToolInputSchema,
  cloneToolJsonSchema,
  stableToolSchemaStringify,
} from "./schema.js";

test("cloneToolInputSchema preserves complete nested JSON Schema keywords", () => {
  const source = {
    type: "object",
    properties: {
      selector: {
        oneOf: [
          { $ref: "#/$defs/byId" },
          { $ref: "#/$defs/bySlug" },
        ],
      },
    },
    required: ["selector"],
    additionalProperties: { type: "string" },
    $defs: {
      byId: {
        type: "object",
        properties: { id: { type: "integer", minimum: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      bySlug: {
        type: "object",
        properties: { slug: { type: "string", pattern: "^[a-z-]+$" } },
        required: ["slug"],
        additionalProperties: false,
      },
    },
    dependentRequired: { selector: ["mode"] },
    unevaluatedProperties: false,
  };

  const cloned = cloneToolInputSchema(source);

  assert.deepEqual(cloned, source);
  assert.notEqual(cloned, source);
  assert.notEqual(cloned.properties, source.properties);
  assert.notEqual(cloned.$defs, source.$defs);
});

test("cloneToolInputSchema supplies empty properties without removing other root constraints", () => {
  assert.deepEqual(cloneToolInputSchema({
    type: "object",
    allOf: [{ required: ["query"] }],
  }), {
    type: "object",
    allOf: [{ required: ["query"] }],
    properties: {},
  });
});

test("cloneToolInputSchema rejects values JSON would silently corrupt", () => {
  const circular: Record<string, unknown> = { type: "object", properties: {} };
  circular.$defs = { self: circular };

  for (const source of [
    { type: "array", properties: {} },
    { type: "object", properties: [] },
    { type: "object", properties: {}, required: ["id", "id"] },
    { type: "object", properties: { value: { minimum: Number.NaN } } },
    circular,
  ]) {
    assert.throws(() => cloneToolInputSchema(source), InvalidToolSchemaError);
  }
});

test("cloneToolJsonSchema preserves boolean schemas and stable serialization is key-order independent", () => {
  assert.equal(cloneToolJsonSchema(false), false);
  assert.equal(
    stableToolSchemaStringify({ b: { y: 2, x: 1 }, a: [true, null] }),
    stableToolSchemaStringify({ a: [true, null], b: { x: 1, y: 2 } }),
  );
});
