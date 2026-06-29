import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToolDisplayForOperation } from "./tool-display-normalization.js";

test("normalizeToolDisplayForOperation derives edit_file display without output display", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "edit_file",
    input: {
      path: "src/app/example.ts",
      edits: [
        {
          oldText: "const value = 1;",
          newText: "const value = 2;",
          occurrence: 1,
          startLine: 4,
        },
      ],
    },
    output: {
      summary: "src/app/example.ts · 1 处修改",
      result: {
        replacements: 1,
        previousLength: 16,
        nextLength: 16,
      },
    },
  });

  assert.equal(display.kind, "file_diff_preview");
  assert.equal(display.kind === "file_diff_preview" ? display.path : undefined, "src/app/example.ts");
  assert.equal(display.kind === "file_diff_preview" ? display.operation : undefined, "edit");
  assert.equal(display.kind === "file_diff_preview" ? display.replacements : undefined, 1);
  assert.equal(display.kind === "file_diff_preview" ? display.previousLength : undefined, 16);
  assert.equal(display.kind === "file_diff_preview" ? display.nextLength : undefined, 16);
  assert.equal(display.kind === "file_diff_preview" ? display.preview?.includes("- const value = 1;") : false, true);
  assert.equal(display.kind === "file_diff_preview" ? display.preview?.includes("+ const value = 2;") : false, true);
});

test("normalizeToolDisplayForOperation derives write_file display without output display", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "write_file",
    input: {
      path: "notes/demo.md",
      content: "hello\nworld\n",
      append: true,
    },
    output: {
      truncated: true,
      result: {
        bytes: 12,
        previousLength: 5,
        nextLength: 17,
        append: true,
      },
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.path : undefined, "notes/demo.md");
  assert.equal(display.kind === "file_change_summary" ? display.operation : undefined, "append");
  assert.equal(display.kind === "file_change_summary" ? display.bytes : undefined, 12);
  assert.equal(display.kind === "file_change_summary" ? display.append : undefined, true);
  assert.equal(display.kind === "file_change_summary" ? display.previousLength : undefined, 5);
  assert.equal(display.kind === "file_change_summary" ? display.nextLength : undefined, 17);
  assert.equal(display.kind === "file_change_summary" ? display.truncated : undefined, true);
  assert.equal(display.kind === "file_change_summary" ? display.preview?.includes("+ hello") : false, true);
});

test("normalizeToolDisplayForOperation derives built-in create and delete operations", () => {
  const createDisplay = normalizeToolDisplayForOperation({
    toolName: "create_file",
    input: {
      path: "src/new.ts",
      content: "export const value = 1;\n",
    },
    output: {
      action: "create_file",
      result: {
        path: "src/new.ts",
        bytes: 24,
      },
    },
  });
  const deleteDisplay = normalizeToolDisplayForOperation({
    toolName: "delete_file",
    input: {
      path: "src/old.ts",
      content: "RAW_BODY_SHOULD_NOT_SURFACE",
    },
    output: {
      action: "delete_file",
      result: {
        path: "src/old.ts",
        bytes: 128,
      },
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

test("normalizeToolDisplayForOperation preserves existing file display and fills operation", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "write_file",
    input: {
      path: "notes/existing.md",
      content: "new body",
    },
    output: {
      display: {
        kind: "file_change_summary",
        path: "notes/existing.md",
        bytes: 8,
      },
      result: {
        path: "notes/existing.md",
      },
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.path : undefined, "notes/existing.md");
  assert.equal(display.kind === "file_change_summary" ? display.bytes : undefined, 8);
  assert.equal(display.kind === "file_change_summary" ? display.operation : undefined, "write");
});

test("normalizeToolDisplayForOperation derives custom file action operation without raw body", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "workspace__remove",
    input: {
      path: "notes/remove.md",
      content: "RAW_INPUT_BODY_SHOULD_NOT_SURFACE",
    },
    output: {
      action: "delete",
      summary: "notes/remove.md deleted",
      result: {
        path: "notes/remove.md",
        text: "RAW_RESULT_TEXT_SHOULD_NOT_SURFACE",
      },
    },
  });

  assert.equal(display.kind, "file_change_summary");
  assert.equal(display.kind === "file_change_summary" ? display.path : undefined, "notes/remove.md");
  assert.equal(display.kind === "file_change_summary" ? display.operation : undefined, "delete");
  assert.equal(JSON.stringify(display).includes("RAW_INPUT_BODY_SHOULD_NOT_SURFACE"), false);
  assert.equal(JSON.stringify(display).includes("RAW_RESULT_TEXT_SHOULD_NOT_SURFACE"), false);
});

test("normalizeToolDisplayForOperation derives structured directory listings from list results", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "list_dir",
    input: {
      path: ".",
      depth: 1,
    },
    output: {
      action: "list_dir",
      truncated: true,
      summary: ". · 9 of 29 entries · depth 1 · truncated",
      result: {
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
    },
  });

  assert.equal(display.kind, "directory_listing");
  assert.equal(display.kind === "directory_listing" ? display.path : undefined, ".");
  assert.equal(display.kind === "directory_listing" ? display.depth : undefined, 1);
  assert.equal(display.kind === "directory_listing" ? display.entriesReturned : undefined, 9);
  assert.equal(display.kind === "directory_listing" ? display.totalEntries : undefined, 29);
  assert.equal(display.kind === "directory_listing" ? display.entries[0]?.path : undefined, "README.md");
  assert.equal(display.kind === "directory_listing" ? display.unreadableSamples?.[0]?.path : undefined, "node_modules/.cache");
  assert.equal(display.kind === "directory_listing" ? display.truncated : undefined, true);
});

test("normalizeToolDisplayForOperation derives structured file search results ahead of generic attachment display", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "search_context_attachment_files",
    input: {
      attachmentId: "ctx_project",
      query: "needle",
      path: ".",
    },
    output: {
      action: "search_context_attachment_files",
      display: {
        kind: "generic_tool_summary",
        action: "search_context_attachment_files",
        summary: "项目:. · 2 matches for needle",
        items: ["src/index.ts:4", "README.md:8"],
      },
      result: {
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
    },
  });

  assert.equal(display.kind, "file_search_results");
  assert.equal(display.kind === "file_search_results" ? display.query : undefined, "needle");
  assert.equal(display.kind === "file_search_results" ? display.path : undefined, ".");
  assert.equal(display.kind === "file_search_results" ? display.matches.length : undefined, 2);
  assert.equal(display.kind === "file_search_results" ? display.matches[0]?.preview : undefined, "needle found here");
  assert.equal(display.kind === "file_search_results" ? display.skippedSamples?.[0]?.reason : undefined, "binary");
});

test("normalizeToolDisplayForOperation preserves existing non-file display", () => {
  const existingDisplay = {
    kind: "generic_tool_summary",
    action: "Vendor lookup",
    summary: "kept summary",
    items: ["kept item"],
  } as const;

  const display = normalizeToolDisplayForOperation({
    toolName: "vendor__edit_file",
    input: { query: "agentarbor" },
    output: {
      summary: "new summary",
      result: { text: "new text" },
    },
    existingDisplay,
  });

  assert.deepEqual(display, existingDisplay);
});

test("normalizeToolDisplayForOperation normalizes existing generic action labels", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "read_file",
    output: {
      display: {
        kind: "generic_tool_summary",
        action: "read_file",
        summary: "notes.md · 34 bytes",
      },
    },
  });

  assert.equal(display.kind, "generic_tool_summary");
  assert.equal(display.kind === "generic_tool_summary" ? display.action : undefined, "读取文件");
  assert.equal(JSON.stringify(display).includes("\"action\":\"read_file\""), false);
});

test("normalizeToolDisplayForOperation keeps generic summary and items when display is missing", () => {
  const display = normalizeToolDisplayForOperation({
    toolName: "vendor__lookup",
    output: {
      summary: "lookup completed",
      items: ["top-level item"],
      result: {
        text: "result text",
        multimodal: [
          {
            type: "image",
            mimeType: "image/png",
            bytesApprox: 42,
            data: "RAW_IMAGE_DATA_SHOULD_NOT_SURFACE",
          },
        ],
      },
    },
  });

  assert.equal(display.kind, "generic_tool_summary");
  assert.equal(display.kind === "generic_tool_summary" ? display.summary : undefined, "lookup completed");
  assert.equal(display.kind === "generic_tool_summary" ? display.items?.includes("top-level item") : false, true);
  assert.equal(display.kind === "generic_tool_summary" ? display.items?.includes("result text") : false, true);
  assert.equal(display.kind === "generic_tool_summary" ? display.items?.some((item) => item.includes("image/png")) : false, true);
  assert.equal(JSON.stringify(display).includes("RAW_IMAGE_DATA_SHOULD_NOT_SURFACE"), false);
});
