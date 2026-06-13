import assert from "node:assert/strict";
import test from "node:test";
import { projectToolResult, redactOrdinaryMarkdownFragment } from "./safe-projection.js";

test("ordinary markdown fragments preserve whitespace-only streaming deltas", () => {
  assert.equal(redactOrdinaryMarkdownFragment(" "), " ");
  assert.equal(redactOrdinaryMarkdownFragment("   "), "   ");
  assert.equal(redactOrdinaryMarkdownFragment("\n"), "\n");
});

test("ordinary markdown fragments preserve indentation and repeated spaces", () => {
  assert.equal(
    redactOrdinaryMarkdownFragment("```ts\n  const value  = 1;\n```"),
    "```ts\n  const value  = 1;\n```"
  );
});

test("ordinary markdown fragments keep visible text without redaction", () => {
  assert.equal(
    redactOrdinaryMarkdownFragment(" hello api_key=secret-value "),
    " hello api_key=secret-value "
  );
});

test("read tool projection exposes content preview to model continuation", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-read",
      toolName: "read",
      input: { ref: "research:web:one" },
    },
    output: {
      action: "read",
      ref: "research:web:one",
      status: "completed",
      result: {
        refId: "research:page:one",
        source: "page",
        title: "Readable Page",
        uri: "https://example.test/page",
        status: "completed",
        summary: "Readable summary",
        contentPreview: "Actual page body preview for the model.",
        truncated: true,
        sourceSearchRef: "research:web:one",
        metadata: { contentLength: 3000 },
      },
      trace: {
        traceId: "research-trace-test",
        action: "read",
        ref: "research:web:one",
        requestedSources: ["page"],
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.001Z",
        sourceSteps: [],
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly title?: string;
    readonly url?: string;
    readonly source?: string;
    readonly status?: string;
    readonly contentPreview?: string;
    readonly truncated?: boolean;
  };

  assert.equal(projection.display?.kind, "read_result");
  assert.equal(agentContent.title, "Readable Page");
  assert.equal(agentContent.url, "https://example.test/page");
  assert.equal(agentContent.source, "page");
  assert.equal(agentContent.status, "completed");
  assert.equal(agentContent.contentPreview, "Actual page body preview for the model.");
  assert.equal(agentContent.truncated, true);
  assert.equal(JSON.stringify(agentContent).includes("资料读取完成"), false);
  assert.equal(JSON.stringify(agentContent).includes("材料已读取"), false);
});
