import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserSnapshotTool, type BrowserAutomation } from "./browser-tool.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("browser_snapshot returns a safe browser page summary through injected automation", async () => {
  const automation: BrowserAutomation = {
    async snapshot(input) {
      return {
        url: input.url,
        title: "Example Page",
        text: "Visible body text with enough content for a preview.",
      };
    },
  };
  const tool = createBrowserSnapshotTool({ automation });

  const output = await tool.execute({ url: "https://example.com/path", waitMs: 10, maxTextChars: 20 }, context);
  const record = asRecord(output);
  const result = asRecord(record.result);

  assert.equal(tool.definition.metadata?.operationType, "read-only");
  assert.equal(tool.definition.metadata?.visibleResultPolicy.omitRawOutput, true);
  assert.equal(record.action, "browser_snapshot");
  assert.equal(record.summary, "Example Page · https://example.com/path");
  assert.equal(result.url, "https://example.com/path");
  assert.equal(result.title, "Example Page");
  assert.equal(String(result.text).length <= 22, true);
  assert.equal(record.truncated, true);
});

test("browser_snapshot rejects non-http urls", async () => {
  const tool = createBrowserSnapshotTool({
    automation: {
      async snapshot() {
        throw new Error("should not run");
      },
    },
  });

  await assert.rejects(() => tool.execute({ url: "file:///etc/passwd" }, context), /HTTP or HTTPS/);
});

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}
