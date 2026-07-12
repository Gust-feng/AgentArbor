import assert from "node:assert/strict";
import test from "node:test";
import { InvalidToolFactError, normalizeToolFactValue } from "./fact-value.js";
import { toolModelAttachmentsFromOutput, withToolModelAttachments } from "./model-attachments.js";

test("normalizeToolFactValue preserves JSON facts and optional undefined fields", () => {
  assert.deepEqual(normalizeToolFactValue({
    text: "fact",
    optional: undefined,
    values: [1, undefined, true],
  }), {
    text: "fact",
    values: [1, null, true],
  });
  assert.equal(normalizeToolFactValue(undefined), undefined);
});

test("normalizeToolFactValue rejects facts JSON would corrupt or discard", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  for (const [value, reason] of [
    [circular, "circular references"],
    [{ value: 1n }, "bigint values"],
    [{ value: () => undefined }, "function values"],
    [{ value: Number.NaN }, "non-finite numbers"],
    [{ value: new Date("2026-07-12T00:00:00.000Z") }, "Date values"],
  ] as const) {
    assert.throws(
      () => normalizeToolFactValue(value),
      (error) => error instanceof InvalidToolFactError && error.message.includes(reason)
    );
  }
});

test("normalizeToolFactValue preserves the explicit out-of-band model attachment carrier", () => {
  const source = withToolModelAttachments(
    { attachmentId: "image-1" },
    [{ kind: "image", source: { kind: "data", mimeType: "image/png", data: "aGVsbG8=" }, attachmentId: "image-1" }]
  );

  const normalized = normalizeToolFactValue(source);

  assert.deepEqual(normalized, { attachmentId: "image-1" });
  assert.deepEqual(toolModelAttachmentsFromOutput(normalized), [
    { kind: "image", source: { kind: "data", mimeType: "image/png", data: "aGVsbG8=" }, attachmentId: "image-1" },
  ]);
  assert.equal(JSON.stringify(normalized).includes("aGVsbG8="), false);
});

test("normalizeToolFactValue preserves prototype-shaped JSON keys as own facts", () => {
  const source = JSON.parse(`{
    "__proto__": { "polluted": true },
    "constructor": { "name": "tool-fact" },
    "prototype": { "kind": "fact" },
    "nested": { "__proto__": "nested-fact" }
  }`) as Record<string, unknown>;

  const normalized = normalizeToolFactValue(source) as Record<string, unknown>;
  const nested = normalized.nested as Record<string, unknown>;

  assert.deepEqual(normalized, source);
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "__proto__"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "constructor"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "prototype"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(nested, "__proto__"), true);
  assert.equal((normalized as { readonly polluted?: boolean }).polluted, undefined);
  assert.equal(({} as { readonly polluted?: boolean }).polluted, undefined);
});
