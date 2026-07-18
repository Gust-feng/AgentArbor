import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalNamespacedToolName,
  canonicalToolName,
  canonicalToolNamespacePrefix,
  isCanonicalToolName,
} from "./name.js";

test("external tool names become one provider-portable canonical identity", () => {
  assert.equal(canonicalToolName("query-docs"), "query_docs");
  assert.equal(canonicalNamespacedToolName("my-server", "query-docs"), "my_server__query_docs");
  assert.equal(canonicalToolNamespacePrefix("my-server"), "my_server__");
  assert.equal(isCanonicalToolName("my_server__query_docs"), true);
  assert.equal(isCanonicalToolName("my-server__query-docs"), false);
});

test("empty external tool names are rejected", () => {
  assert.throws(() => canonicalToolName(""), /cannot be empty/u);
});
