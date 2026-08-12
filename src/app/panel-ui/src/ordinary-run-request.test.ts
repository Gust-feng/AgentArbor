import assert from "node:assert/strict";
import { test } from "vitest";
import { ordinaryRunResourceUrl } from "./ordinary-run-request";

test("ordinary run requests omit the cursor until the backend issues an opaque token", () => {
  assert.equal(
    ordinaryRunResourceUrl("run/1", "view", undefined),
    "/api/basic-agent/runs/run%2F1/view",
  );
});

test("ordinary run requests return the opaque cursor unchanged except for URL encoding", () => {
  assert.equal(
    ordinaryRunResourceUrl("run-1", "stream", "opaque_token-1"),
    "/api/basic-agent/runs/run-1/stream?cursor=opaque_token-1",
  );
});