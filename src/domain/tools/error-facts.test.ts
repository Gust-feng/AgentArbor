import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToolErrorFacts } from "./error-facts.js";

test("normalizeToolErrorFacts preserves prototype-shaped JSON keys as own facts", () => {
  const source = JSON.parse(`{
    "__proto__": { "polluted": true },
    "constructor": { "name": "tool-error" },
    "prototype": { "kind": "error-fact" },
    "nested": { "__proto__": "nested-error-fact" }
  }`) as Record<string, unknown>;

  const normalized = normalizeToolErrorFacts(source) as Record<string, unknown>;
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
