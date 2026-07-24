import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToolDisplayForOperation } from "./tool-display-normalization.js";

test("normalizeToolDisplayForOperation consumes the canonical edit unified diff", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "edit",
    input: {
      path: "src/app/example.ts",
      edits: [
        {
          oldText: "INPUT MUST NOT BECOME A DIFF",
          newText: "INPUT MUST NOT BECOME A PREVIEW",
          occurrence: 1,
          startLine: 4,
        },
      ],
    },
    output: {
      path: "src/app/example.ts",
      replacements: 1,
      previousLength: 16,
      nextLength: 16,
      diff: {
        status: "available",
        unifiedDiff: "Index: src/app/example.ts\n--- src/app/example.ts\n+++ src/app/example.ts\n@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;\n",
      },
    },
  });

  assert.equal(display.kind, "file_diff_preview");
  assert.equal(display.kind === "file_diff_preview" ? display.path : undefined, "src/app/example.ts");
  assert.equal(display.kind === "file_diff_preview" ? display.operation : undefined, "edit");
  assert.equal(JSON.stringify(display).includes("replacements"), false);
  assert.equal(JSON.stringify(display).includes("previousLength"), false);
  assert.equal(JSON.stringify(display).includes("nextLength"), false);
  assert.equal(display.kind === "file_diff_preview" ? display.preview?.includes("-const value = 1;") : false, true);
  assert.equal(display.kind === "file_diff_preview" ? display.preview?.includes("+const value = 2;") : false, true);
  assert.equal(display.kind === "file_diff_preview" ? display.preview?.includes("INPUT MUST NOT") : true, false);
});

test("normalizeToolDisplayForOperation does not reconstruct an edit diff from input", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "edit",
    input: {
      path: "notes/demo.md",
      anchor: "old line",
      replacement: "new line",
    },
    output: {
      path: "notes/demo.md",
      replacements: 1,
    },
  });

  assert.equal(display.kind, "file_diff_preview");
  assert.equal(display.kind === "file_diff_preview" ? display.path : undefined, "notes/demo.md");
  assert.equal(display.kind === "file_diff_preview" ? display.preview : "unexpected", undefined);
});

test("normalizeToolDisplayForOperation uses the canonical diff fact for custom file edits", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "workspace_patch",
    input: {
      path: "notes/demo.md",
    },
    output: {
      operation: "edit",
      path: "notes/demo.md",
      diff: {
        status: "available",
        unifiedDiff: "@@ line 1\n- old\n+ new",
      },
      replacements: 1,
    },
  });

  assert.equal(display.kind, "file_diff_preview");
  assert.equal(display.kind === "file_diff_preview" ? display.preview : undefined, "@@ line 1\n- old\n+ new");
});

test("normalizeToolDisplayForOperation keeps one multi-file tool call as a file change group", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "workspace_patch",
    output: {
      files: [
        {
          path: "src/app.ts",
          operation: "edit",
          replacements: 1,
          diff: {
            status: "available",
            unifiedDiff: "@@ -1 +1 @@\n-old app\n+new app",
          },
        },
        {
          path: "src/app.test.ts",
          operation: "create",
          preview: "+ test('app', () => true);",
        },
      ],
    },
  });

  assert.equal(display.kind, "file_change_group");
  assert.deepEqual(display.kind === "file_change_group" ? display.files.map((file) => file.path) : [], [
    "src/app.ts",
    "src/app.test.ts",
  ]);
  assert.equal(display.kind === "file_change_group" ? display.files[0]?.preview?.includes("+new app") : false, true);
  assert.equal(display.kind === "file_change_group" ? display.files[1]?.operation : undefined, "create");
});

test("normalizeToolDisplayForOperation derives write display without output display", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "write",
    input: {
      path: "notes/demo.md",
      content: "hello\nworld\n",
      append: true,
    },
    output: {
      truncated: true,
      bytes: 12,
      previousLength: 5,
      nextLength: 17,
      append: true,
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.path : undefined, "notes/demo.md");
  assert.equal(display.kind === "file_change_summary" ? display.operation : undefined, "append");
  assert.equal(display.kind === "file_change_summary" ? display.preview : undefined, "+ hello\n+ world");
  assert.equal(JSON.stringify(display).includes("bytes"), false);
  assert.equal(JSON.stringify(display).includes("truncated"), false);
});

test("normalizeToolDisplayForOperation does not invent a changed line for empty file content", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "create",
    input: {
      path: "notes/empty.md",
      content: "",
    },
    output: {
      path: "notes/empty.md",
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.preview : "unexpected", undefined);
});

test("normalizeToolDisplayForOperation derives built-in create and delete operations", () => {
  const createDisplay = normalizeToolDisplayForOperation({
    toolName: "create",
    input: {
      path: "src/new.ts",
      content: "export const value = 1;\n",
    },
    output: {
      path: "src/new.ts",
      bytes: 24,
    },
  });
  const deleteDisplay = normalizeToolDisplayForOperation({
    toolName: "delete",
    input: {
      path: "src/old.ts",
      content: "RAW_BODY_SHOULD_NOT_SURFACE",
    },
    output: {
      path: "src/old.ts",
      bytes: 128,
    },
  });

  assert.equal(createDisplay.kind, "file_change_summary");
  assert.equal(createDisplay.kind === "file_change_summary" ? createDisplay.operation : undefined, "create");
  assert.equal(createDisplay.kind === "file_change_summary" ? createDisplay.preview?.includes("+ export const value") : false, true);
  assert.equal(deleteDisplay.kind, "file_change_summary");
  assert.equal(deleteDisplay.kind === "file_change_summary" ? deleteDisplay.operation : undefined, "delete");
  assert.equal(deleteDisplay.kind === "file_change_summary" ? deleteDisplay.preview : undefined, undefined);
  assert.equal(JSON.stringify(deleteDisplay).includes("RAW_BODY_SHOULD_NOT_SURFACE"), false);
});

test("normalizeToolDisplayForOperation derives file display from top-level facts", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "write",
    input: {
      path: "notes/existing.md",
      content: "new body",
    },
    output: {
      path: "notes/existing.md",
      bytes: 8,
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.path : undefined, "notes/existing.md");
  assert.equal(display.kind === "file_change_summary" ? display.operation : undefined, "write");
  assert.equal(JSON.stringify(display).includes("bytes"), false);
});

test("normalizeToolDisplayForOperation derives explicit custom file operation without raw body", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "workspace__remove",
    input: {
      path: "notes/remove.md",
      content: "RAW_INPUT_BODY_SHOULD_NOT_SURFACE",
    },
    output: {
      operation: "delete",
      path: "notes/remove.md",
      text: "RAW_OUTPUT_TEXT_SHOULD_NOT_SURFACE",
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.path : undefined, "notes/remove.md");
  assert.equal(display.kind === "file_change_summary" ? display.operation : undefined, "delete");
  assert.equal(JSON.stringify(display).includes("RAW_INPUT_BODY_SHOULD_NOT_SURFACE"), false);
  assert.equal(JSON.stringify(display).includes("RAW_OUTPUT_TEXT_SHOULD_NOT_SURFACE"), false);
});

test("normalizeToolDisplayForOperation derives structured directory listings from list facts", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "list",
    input: {
      path: ".",
      depth: 1,
    },
    output: {
      truncated: true,
      path: ".",
      depth: 1,
      entriesReturned: 9,
      totalEntries: 29,
      unreadableDirectories: 1,
      unreadableSamples: [{ path: "node_modules/.cache", errorCode: "EPERM" }],
      entries: [
        { path: "README.md", name: "README.md", kind: "file", bytes: 120, depth: 1 },
        { path: "src", name: "src", kind: "directory", depth: 1 },
      ],
    },
  });

  assert.equal(display.kind, "directory_listing");
  assert.equal(display.kind === "directory_listing" ? display.path : undefined, ".");
  assert.equal(display.kind === "directory_listing" ? display.entries[0]?.path : undefined, "README.md");
  assert.equal(display.kind === "directory_listing" ? display.unreadableSamples?.[0]?.path : undefined, "node_modules/.cache");
  assert.equal(JSON.stringify(display).includes("totalEntries"), false);
  assert.equal(JSON.stringify(display).includes("bytes"), false);
  assert.equal(JSON.stringify(display).includes("truncated"), false);
});

test("normalizeToolDisplayForOperation preserves directory and search targets while tools are running", () => {
  const directory = normalizeToolDisplayForOperation({
    toolName: "list",
    input: { path: "src/app", depth: 2 },
  });
  const search = normalizeToolDisplayForOperation({
    toolName: "grep",
    input: { query: "tool.requested", path: "src" },
  });

  assert.equal(directory.kind, "directory_listing");
  assert.equal(directory.kind === "directory_listing" ? directory.path : undefined, "src/app");
  assert.deepEqual(directory.kind === "directory_listing" ? directory.entries : undefined, []);
  assert.equal(search.kind, "file_search_results");
  assert.equal(search.kind === "file_search_results" ? search.query : undefined, "tool.requested");
  assert.equal(search.kind === "file_search_results" ? search.path : undefined, "src");
  assert.deepEqual(search.kind === "file_search_results" ? search.matches : undefined, []);
});

test("normalizeToolDisplayForOperation uses a concrete unknown tool name and request target", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "vendor__inspect_schema",
    input: { path: "database/schema.sql" },
  });

  assert.equal(display.kind, "generic_tool_summary");
  assert.equal(display.kind === "generic_tool_summary" ? display.action : undefined, "inspect schema");
  assert.equal(display.kind === "generic_tool_summary" ? display.summary : undefined, "database/schema.sql");
});

test("normalizeToolDisplayForOperation derives structured file search results ahead of generic attachment display", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "AttachmentSearchFiles",
    input: {
      attachmentId: "ctx_project",
      query: "needle",
      path: ".",
    },
    output: {
      query: "needle",
      path: ".",
      searchedFiles: 12,
      skippedFiles: 3,
      skippedBinaryFiles: 1,
      skippedSamples: [{ path: "dist/app.bin", reason: "binary", bytes: 42 }],
      matches: [
        { path: "src/index.ts", line: 4, preview: "needle found here" },
        { path: "README.md", line: 8 },
      ],
    },
  });

  assert.equal(display.kind, "file_search_results");
  assert.equal(display.kind === "file_search_results" ? display.query : undefined, "needle");
  assert.equal(display.kind === "file_search_results" ? display.path : undefined, ".");
  assert.equal(display.kind === "file_search_results" ? display.matches.length : undefined, 2);
  assert.equal(display.kind === "file_search_results" ? display.matches[0]?.preview : undefined, "needle found here");
  assert.equal(JSON.stringify(display).includes("searchedFiles"), false);
  assert.equal(JSON.stringify(display).includes("skippedSamples"), false);
});

test("normalizeToolDisplayForOperation turns MCP web text into sources without article excerpts", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "vendor__web_lookup",
    input: { query: "AgentArbor tool display" },
    output: {
      content: [{
        type: "text",
        text: [
          "Title: AgentArbor tool display guide",
          "URL: https://example.com/agentarbor/tools",
          "Published: 2026-07-01",
          "This partial paragraph must not enter the display contract.",
        ].join("\n"),
      }],
    },
  });

  assert.equal(display.kind, "search_results");
  assert.equal(display.kind === "search_results" ? display.query : undefined, "AgentArbor tool display");
  assert.deepEqual(display.kind === "search_results" ? display.results : [], [{
    title: "AgentArbor tool display guide",
    url: "https://example.com/agentarbor/tools",
    source: "example.com",
  }]);
  assert.equal(JSON.stringify(display).includes("partial paragraph"), false);
});

test("normalizeToolDisplayForOperation keeps complete canonical diffs without truncation markers", () => {
  const body = Array.from({ length: 220 }, (_, index) => `+line ${index + 1}`).join("\n");
  const display = normalizeToolDisplayForOperation({
    toolName: "edit",
    input: { path: "src/large.ts" },
    output: {
      path: "src/large.ts",
      diff: { status: "available", unifiedDiff: `@@ -1 +1 @@\n${body}` },
    },
  });

  assert.equal(display.kind === "file_diff_preview" ? display.preview?.includes("+line 220") : false, true);
  assert.equal(JSON.stringify(display).includes("truncated"), false);
});

test("normalizeToolDisplayForOperation derives compact MCP display from canonical content facts", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "vendor__lookup",
    input: { query: "AgentArbor tool display" },
    output: {
      title: "lookup completed",
      refId: "vendor:lookup:1",
      content: [
        { type: "text", text: "result text" },
        {
          type: "image",
          mimeType: "image/png",
          byteLength: 42,
          modelInput: "attached",
          modelAttachmentIndex: 0,
        },
      ],
      structuredContent: { status: "completed", resultsReturned: 2 },
    },
  });

  assert.equal(display.kind, "generic_tool_summary");
  assert.equal(display.kind === "generic_tool_summary" ? display.summary : undefined, "AgentArbor tool display");
  assert.deepEqual(display.kind === "generic_tool_summary" ? display.items : undefined, ["result text"]);
});
