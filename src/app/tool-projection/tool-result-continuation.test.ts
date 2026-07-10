import assert from "node:assert/strict";
import test from "node:test";
import { projectToolApprovalRequired, projectToolFailure, projectToolResult, redactOrdinaryMarkdownFragment } from "./safe-projection.js";

test("workspace list and grep projections keep factual traversal metadata", () => {
  const listProjection = projectToolResult({
    request: {
      callId: "call-list",
      toolName: "list_dir",
      input: { path: ".", depth: 2 },
    },
    output: {
      action: "list_dir",
      summary: ". · 2 entries · depth 2",
      result: {
        path: ".",
        depth: 2,
        maxDepth: 3,
        entriesReturned: 2,
        totalEntries: 2,
        unreadableDirectories: 0,
        entries: [
          { path: "src", name: "src", kind: "directory", depth: 1 },
          { path: "src/index.ts", name: "index.ts", kind: "file", bytes: 12, depth: 2 },
        ],
      },
    },
  });
  const listContent = listProjection.agentContent as {
    readonly depth?: number;
    readonly entriesReturned?: number;
    readonly totalEntries?: number;
    readonly entries?: readonly {
      readonly path?: string;
      readonly name?: string;
      readonly depth?: number;
    }[];
  };

  assert.equal(listContent.depth, 2);
  assert.equal(listContent.entriesReturned, 2);
  assert.equal(listContent.totalEntries, 2);
  assert.equal(listContent.entries?.[1]?.path, "src/index.ts");
  assert.equal(listContent.entries?.[1]?.depth, 2);
  assert.equal(listProjection.display?.kind, "directory_listing");
  assert.equal(listProjection.display?.kind === "directory_listing" ? listProjection.display.totalEntries : undefined, 2);

  const grepProjection = projectToolResult({
    request: {
      callId: "call-grep",
      toolName: "grep_files",
      input: { path: ".", query: "needle" },
    },
    output: {
      action: "grep_files",
      summary: ". · 1 matches for needle",
      result: {
        query: "needle",
        path: ".",
        engine: "js",
        matches: [{ path: "src/index.ts", line: 1, preview: "needle" }],
        searchedFiles: 1,
        skippedFactsAvailable: true,
        skippedFactsComplete: true,
        skippedFiles: 2,
        skippedBinaryFiles: 1,
        skippedTooLargeFiles: 1,
        skippedUnreadableFiles: 0,
        skippedDirectories: 1,
        skippedOtherEntries: 0,
        skippedSamples: [
          { path: "dist", reason: "skipped_directory" },
          { path: "logo.png", reason: "binary", bytes: 3 },
        ],
      },
    },
  });
  const grepContent = grepProjection.agentContent as {
    readonly engine?: string;
    readonly searchedFiles?: number;
    readonly skippedFactsAvailable?: boolean;
    readonly skippedFiles?: number;
    readonly skippedSamples?: readonly { readonly path?: string; readonly reason?: string }[];
  };

  assert.equal(grepContent.engine, "js");
  assert.equal(grepContent.searchedFiles, 1);
  assert.equal(grepContent.skippedFactsAvailable, true);
  assert.equal(grepContent.skippedFiles, 2);
  assert.deepEqual(grepContent.skippedSamples?.map((sample) => sample.reason), ["skipped_directory", "binary"]);
  assert.equal(grepProjection.display?.kind, "file_search_results");
  assert.equal(grepProjection.display?.kind === "file_search_results" ? grepProjection.display.matches[0]?.path : undefined, "src/index.ts");
});

test("grep file search projection preserves project-scale match previews", () => {
  const matches = Array.from({ length: 30 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    line: index + 1,
    preview: `needle ${index}`,
  }));
  const projection = projectToolResult({
    request: {
      callId: "call-grep-large",
      toolName: "grep_files",
      input: { path: ".", query: "needle" },
    },
    output: {
      action: "grep_files",
      summary: ". · 30 matches for needle",
      result: {
        query: "needle",
        path: ".",
        engine: "js",
        matches,
        searchedFiles: 30,
      },
      truncated: false,
    },
  });

  assert.equal(projection.display?.kind, "file_search_results");
  assert.equal(projection.display?.kind === "file_search_results" ? projection.display.matches.length : undefined, 30);
  assert.equal(projection.display?.kind === "file_search_results" ? projection.display.matchesReturned : undefined, 30);
  assert.equal(projection.envelope?.uiDisplay?.kind, "file_search_results");
  assert.equal(projection.envelope?.uiDisplay?.kind === "file_search_results" ? projection.envelope.uiDisplay.matches.length : undefined, 30);
  assert.equal(projection.envelope?.uiDisplay?.kind === "file_search_results" ? projection.envelope.uiDisplay.matchesReturned : undefined, 30);
});

test("read_file projection keeps token-like file content in model-visible agent content", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-read-file-secret",
      toolName: "read_file",
      input: { path: "secrets.txt" },
    },
    output: {
      action: "read_file",
      summary: "secrets.txt 已读取。",
      result: {
        path: "secrets.txt",
        bytes: 54,
        content: "password=hunter2\napi_key=sk-file-secret\nplain text",
        truncated: false,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly content?: string;
    readonly truncated?: boolean;
    readonly rawContentRef?: string;
  };

  assert.equal(agentContent.content, "password=hunter2\napi_key=sk-file-secret\nplain text");
  assert.equal(agentContent.truncated, false);
  assert.equal(agentContent.rawContentRef, undefined);
  assert.equal(JSON.stringify(agentContent).includes("[redacted"), false);
});

test("truncated command stdout and stderr keep real prefixes and raw refs", () => {
  const longStdout = `stdout token=sk-${"x".repeat(130_000)}`;
  const longStderr = `stderr Bearer sk-${"y".repeat(70_000)}`;
  const projection = projectToolResult({
    request: {
      callId: "call-long-command",
      toolName: "shell_command",
      input: { commandLine: "long-output" },
    },
    output: {
      action: "shell_command",
      result: {
        commandLine: "long-output",
        exitCode: 0,
        stdout: longStdout,
        stderr: longStderr,
        stdoutTruncated: true,
        stderrTruncated: true,
        stdoutChars: longStdout.length,
        stderrChars: longStderr.length,
        stdoutOmittedChars: 2_000,
        stderrOmittedChars: 1_000,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly truncated?: boolean;
    readonly stdoutTruncated?: boolean;
    readonly stderrTruncated?: boolean;
    readonly stdoutChars?: number;
    readonly stderrChars?: number;
    readonly stdoutOmittedChars?: number;
    readonly stderrOmittedChars?: number;
    readonly rawStdoutRef?: string;
    readonly rawStderrRef?: string;
  };

  assert.equal(agentContent.truncated, true);
  assert.equal(agentContent.stdoutTruncated, true);
  assert.equal(agentContent.stderrTruncated, true);
  assert.equal(agentContent.stdoutChars, longStdout.length);
  assert.equal(agentContent.stderrChars, longStderr.length);
  assert.equal(agentContent.stdoutOmittedChars, 2_000);
  assert.equal(agentContent.stderrOmittedChars, 1_000);
  assert.equal(agentContent.stdout?.startsWith("stdout token=sk-"), true);
  assert.equal(agentContent.stderr?.startsWith("stderr Bearer sk-"), true);
  assert.equal(agentContent.stdout?.endsWith("[truncated to 128000 chars]"), true);
  assert.equal(agentContent.stderr?.endsWith("[truncated to 64000 chars]"), true);
  assert.equal(agentContent.rawStdoutRef, "tool:call-long-command:raw:shell_command:stdout");
  assert.equal(agentContent.rawStderrRef, "tool:call-long-command:raw:shell_command:stderr");
  assert.equal(agentContent.stdout?.includes("safe summary"), false);
});

test("truncated read_file content keeps real prefix and raw content ref", () => {
  const longContent = `password=hunter2\napi_key=sk-file-${"z".repeat(130_000)}`;
  const projection = projectToolResult({
    request: {
      callId: "call-long-read-file",
      toolName: "read_file",
      input: { path: "secrets.txt" },
    },
    output: {
      action: "read_file",
      result: {
        path: "secrets.txt",
        bytes: longContent.length,
        content: longContent,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly content?: string;
    readonly truncated?: boolean;
    readonly rawContentRef?: string;
  };

  assert.equal(agentContent.truncated, true);
  assert.equal(agentContent.content?.startsWith("password=hunter2\napi_key=sk-file-"), true);
  assert.equal(agentContent.content?.endsWith("[truncated to 128000 chars]"), true);
  assert.equal(agentContent.rawContentRef, "tool:call-long-read-file:raw:read_file:content");
});

test("line-range read continuations omit maxLength so next input stays executable", () => {
  const localProjection = projectToolResult({
    request: {
      callId: "call-line-read-file",
      toolName: "read_file",
      input: { path: "src/app.ts", startLine: 1, endLine: 2, maxLength: 5 },
    },
    output: {
      action: "read_file",
      result: {
        path: "src/app.ts",
        startLine: 1,
        endLine: 2,
        totalLines: 6,
        content: "line 1\nline 2",
        hasMoreAfter: true,
      },
      truncated: true,
    },
  });
  const localNextInput = ((localProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(localNextInput?.path, "src/app.ts");
  assert.equal(localNextInput?.startLine, 3);
  assert.equal("maxLength" in (localNextInput ?? {}), false);

  const attachmentProjection = projectToolResult({
    request: {
      callId: "call-line-read-context",
      toolName: "read_context_attachment_text",
      input: { attachmentId: "ctx_notes", path: "notes.txt", startLine: 10, endLine: 12, maxLength: 5 },
    },
    output: {
      action: "read_context_attachment_text",
      result: {
        attachmentId: "ctx_notes",
        path: "notes.txt",
        startLine: 10,
        endLine: 12,
        totalLines: 20,
        content: "line 10\nline 11\nline 12",
        hasMoreAfter: true,
      },
      truncated: true,
    },
  });
  const attachmentNextInput = ((attachmentProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(attachmentNextInput?.attachmentId, "ctx_notes");
  assert.equal(attachmentNextInput?.path, "notes.txt");
  assert.equal(attachmentNextInput?.startLine, 13);
  assert.equal("maxLength" in (attachmentNextInput ?? {}), false);
});

test("truncated research read preview keeps raw preview ref", () => {
  const longPreview = `page content token=sk-preview-${"p".repeat(130_000)}`;
  const projection = projectToolResult({
    request: {
      callId: "call-long-read",
      toolName: "read",
      input: { ref: "research:web:1" },
    },
    output: {
      action: "read",
      ref: "research:web:1",
      result: {
        title: "Long page",
        uri: "https://example.test/long",
        contentPreview: longPreview,
      },
    },
  });

  const agentContent = projection.agentContent as {
    readonly contentPreview?: string;
    readonly truncated?: boolean;
    readonly rawContentPreviewRef?: string;
  };

  assert.equal(agentContent.truncated, true);
  assert.equal(agentContent.contentPreview?.startsWith("page content token=sk-preview-"), true);
  assert.equal(agentContent.contentPreview?.endsWith("[truncated to 128000 chars]"), true);
  assert.equal(agentContent.rawContentPreviewRef, "tool:call-long-read:raw:read:contentPreview");
});

test("web tool model results use model-visible body facts instead of UI previews", () => {
  const body = `${"a".repeat(1_500)}BODY_SENTINEL`;
  const projection = projectToolResult({
    request: {
      callId: "call-http-body",
      toolName: "http_request",
      input: { url: "https://example.test/api" },
    },
    output: {
      action: "http_request",
      summary: "GET https://example.test/api -> 200",
      result: {
        url: "https://example.test/api",
        method: "GET",
        statusCode: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
        body,
        durationMs: 10,
        startChar: 0,
        bodyChars: body.length,
        hasMoreAfter: false,
        truncated: false,
      },
    },
  });

  const text = projection.modelResult?.content[0]?.type === "text"
    ? projection.modelResult.content[0].text
    : "";
  const structured = projection.modelResult?.structuredContent as {
    readonly rawBodyRef?: string;
    readonly hasMoreAfter?: boolean;
  };

  assert.equal(projection.display?.kind === "http_response" ? projection.display.bodyPreview?.includes("BODY_SENTINEL") : false, false);
  assert.equal(text.includes("BODY_SENTINEL"), true);
  assert.equal(structured.hasMoreAfter, false);
  assert.equal(structured.rawBodyRef, undefined);
});

test("http and browser projections expose executable continuation input when truncated", () => {
  const httpProjection = projectToolResult({
    request: {
      callId: "call-http-truncated",
      toolName: "http_request",
      input: { url: "https://example.test/api", method: "GET", timeoutMs: 1000 },
    },
    output: {
      action: "http_request",
      summary: "GET https://example.test/api -> 200",
      result: {
        url: "https://example.test/api",
        method: "GET",
        statusCode: 200,
        statusText: "OK",
        headers: {},
        body: "first-window",
        durationMs: 10,
        startChar: 0,
        bodyChars: 12,
        hasMoreAfter: true,
        nextStartChar: 12,
        truncated: true,
      },
      truncated: true,
    },
  });
  const httpNextInput = ((httpProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);
  const httpAgentNextInput = (((httpProjection.agentContent as { readonly continuation?: { readonly nextInput?: Record<string, unknown> } }).continuation)?.nextInput);

  assert.equal(httpNextInput?.url, "https://example.test/api");
  assert.equal(httpNextInput?.method, "GET");
  assert.equal(httpNextInput?.startChar, 12);
  assert.equal(httpAgentNextInput?.startChar, 12);

  const browserProjection = projectToolResult({
    request: {
      callId: "call-browser-truncated",
      toolName: "browser_snapshot",
      input: { url: "https://example.test/page", waitMs: 500, maxTextChars: 1000 },
    },
    output: {
      action: "browser_snapshot",
      summary: "Example · https://example.test/page",
      result: {
        url: "https://example.test/page",
        title: "Example",
        text: "visible-window",
        startChar: 0,
        textChars: 14,
        totalTextChars: 40,
        hasMoreAfter: true,
        nextStartChar: 14,
      },
      truncated: true,
    },
  });
  const browserNextInput = ((browserProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);
  const browserAgentNextInput = (((browserProjection.agentContent as { readonly continuation?: { readonly nextInput?: Record<string, unknown> } }).continuation)?.nextInput);

  assert.equal(browserNextInput?.url, "https://example.test/page");
  assert.equal(browserNextInput?.waitMs, 500);
  assert.equal(browserNextInput?.maxTextChars, 1000);
  assert.equal(browserNextInput?.startChar, 14);
  assert.equal(browserAgentNextInput?.startChar, 14);
});

test("http and browser projections omit impossible continuation input at startChar ceiling", () => {
  const httpProjection = projectToolResult({
    request: {
      callId: "call-http-ceiling",
      toolName: "http_request",
      input: { url: "https://example.test/api", method: "GET" },
    },
    output: {
      action: "http_request",
      summary: "GET https://example.test/api -> 200",
      result: {
        url: "https://example.test/api",
        method: "GET",
        statusCode: 200,
        statusText: "OK",
        headers: {},
        body: "last-window",
        durationMs: 10,
        startChar: 2_000_000,
        bodyChars: 11,
        hasMoreAfter: true,
        reachedStartCharCeiling: true,
        startCharCeiling: 2_000_000,
        truncated: true,
      },
      truncated: true,
    },
  });
  const httpStructured = httpProjection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
  };
  const httpAgentContent = httpProjection.agentContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
    readonly continuation?: unknown;
  };

  assert.equal(httpProjection.modelResult?.continuation, undefined);
  assert.equal(httpStructured.hasMoreAfter, true);
  assert.equal(httpStructured.nextStartChar, undefined);
  assert.equal(httpStructured.reachedStartCharCeiling, true);
  assert.equal(httpStructured.startCharCeiling, 2_000_000);
  assert.equal(httpAgentContent.hasMoreAfter, true);
  assert.equal(httpAgentContent.nextStartChar, undefined);
  assert.equal(httpAgentContent.reachedStartCharCeiling, true);
  assert.equal(httpAgentContent.startCharCeiling, 2_000_000);
  assert.equal(httpAgentContent.continuation, undefined);
  assert.equal((httpProjection.modelResult?.truncation as { readonly truncated?: boolean } | undefined)?.truncated, true);

  const browserProjection = projectToolResult({
    request: {
      callId: "call-browser-ceiling",
      toolName: "browser_snapshot",
      input: { url: "https://example.test/page", waitMs: 500 },
    },
    output: {
      action: "browser_snapshot",
      summary: "Example · https://example.test/page",
      result: {
        url: "https://example.test/page",
        title: "Example",
        text: "last-window",
        startChar: 2_000_000,
        textChars: 11,
        totalTextChars: 2_000_012,
        hasMoreAfter: true,
        reachedStartCharCeiling: true,
        startCharCeiling: 2_000_000,
      },
      truncated: true,
    },
  });
  const browserStructured = browserProjection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
  };
  const browserAgentContent = browserProjection.agentContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartChar?: number;
    readonly reachedStartCharCeiling?: boolean;
    readonly startCharCeiling?: number;
    readonly continuation?: unknown;
  };

  assert.equal(browserProjection.modelResult?.continuation, undefined);
  assert.equal(browserStructured.hasMoreAfter, true);
  assert.equal(browserStructured.nextStartChar, undefined);
  assert.equal(browserStructured.reachedStartCharCeiling, true);
  assert.equal(browserStructured.startCharCeiling, 2_000_000);
  assert.equal(browserAgentContent.hasMoreAfter, true);
  assert.equal(browserAgentContent.nextStartChar, undefined);
  assert.equal(browserAgentContent.reachedStartCharCeiling, true);
  assert.equal(browserAgentContent.startCharCeiling, 2_000_000);
  assert.equal(browserAgentContent.continuation, undefined);
  assert.equal((browserProjection.modelResult?.truncation as { readonly truncated?: boolean } | undefined)?.truncated, true);
});

test("attachment pdf and skill resource continuations match their executable schemas", () => {
  const pdfProjection = projectToolResult({
    request: {
      callId: "call-pdf-truncated",
      toolName: "read_context_attachment_pdf_text",
      input: { attachmentId: "ctx_pdf", path: "docs/report.pdf", maxLength: 1000 },
    },
    output: {
      action: "read_context_attachment_pdf_text",
      summary: "report.pdf · truncated",
      result: {
        attachmentId: "ctx_pdf",
        path: "docs/report.pdf",
        readable: true,
        content: "pdf window",
        startChar: 0,
        textChars: 10,
        charCount: 3000,
        hasMoreAfter: true,
        nextStartChar: 1000,
      },
      truncated: true,
    },
  });
  const pdfNextInput = ((pdfProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(pdfNextInput?.attachmentId, "ctx_pdf");
  assert.equal(pdfNextInput?.path, "docs/report.pdf");
  assert.equal(pdfNextInput?.maxLength, 1000);
  assert.equal(pdfNextInput?.startChar, 1000);
  assert.equal("startLine" in (pdfNextInput ?? {}), false);

  const skillProjection = projectToolResult({
    request: {
      callId: "call-skill-truncated",
      toolName: "read_skill_resource",
      input: { skillId: "repo-review", path: "references/checklist.md", type: "reference", maxChars: 1000 },
    },
    output: {
      action: "read_skill_resource",
      summary: "repo-review · checklist · truncated",
      result: {
        skillId: "repo-review",
        path: "references/checklist.md",
        type: "reference",
        content: "skill window",
        charCount: 3000,
        truncated: true,
      },
      truncated: true,
    },
  });
  const skillNextInput = ((skillProjection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);

  assert.equal(skillNextInput?.skillId, "repo-review");
  assert.equal(skillNextInput?.path, "references/checklist.md");
  assert.equal(skillNextInput?.type, "reference");
  assert.equal(skillNextInput?.maxChars, 2000);
  assert.equal("startLine" in (skillNextInput ?? {}), false);
});

test("table read projection exposes executable row continuation input when truncated", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-table-truncated",
      toolName: "read_context_attachment_table",
      input: { attachmentId: "ctx_table", path: "sales.csv", startRow: 2, rowCount: 1, headerRow: true },
    },
    output: {
      action: "read_context_attachment_table",
      summary: "sales.csv · rows 2-2 of 3 · 1 returned",
      result: {
        attachmentId: "ctx_table",
        kind: "file",
        title: "sales.csv",
        path: "sales.csv",
        table: true,
        format: "delimited",
        headerRow: true,
        totalRows: 3,
        columns: ["region", "revenue"],
        startRow: 2,
        rowCount: 1,
        requestedRowCount: 1,
        rows: [{ rowNumber: 2, values: ["north", "1200"], record: { region: "north", revenue: "1200" } }],
        rowsReturned: 1,
        hasMoreBefore: true,
        hasMoreAfter: true,
        nextStartRow: 3,
      },
      truncated: true,
    },
  });
  const nextInput = ((projection.modelResult?.continuation as { readonly nextInput?: Record<string, unknown> } | undefined)?.nextInput);
  const agentNextInput = (((projection.agentContent as { readonly continuation?: { readonly nextInput?: Record<string, unknown> } }).continuation)?.nextInput);
  const structured = projection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartRow?: number;
  };

  assert.equal(nextInput?.attachmentId, "ctx_table");
  assert.equal(nextInput?.path, "sales.csv");
  assert.equal(nextInput?.startRow, 3);
  assert.equal(nextInput?.rowCount, 1);
  assert.equal(nextInput?.headerRow, true);
  assert.equal(agentNextInput?.startRow, 3);
  assert.equal(structured.hasMoreAfter, true);
  assert.equal(structured.nextStartRow, 3);
});

test("table read projection omits impossible row continuation at ceiling", () => {
  const projection = projectToolResult({
    request: {
      callId: "call-table-ceiling",
      toolName: "read_context_attachment_table",
      input: { attachmentId: "ctx_table", path: "sales.csv", startRow: 10000, rowCount: 1 },
    },
    output: {
      action: "read_context_attachment_table",
      summary: "sales.csv · row ceiling reached",
      result: {
        attachmentId: "ctx_table",
        path: "sales.csv",
        table: true,
        startRow: 10000,
        rowCount: 1,
        rows: [{ rowNumber: 10000, values: ["tail"] }],
        rowsReturned: 1,
        hasMoreAfter: true,
        reachedRowCeiling: true,
        rowCeiling: 10000,
      },
      truncated: true,
    },
  });
  const structured = projection.modelResult?.structuredContent as {
    readonly hasMoreAfter?: boolean;
    readonly nextStartRow?: number;
    readonly reachedRowCeiling?: boolean;
    readonly rowCeiling?: number;
  };
  const agentContent = projection.agentContent as {
    readonly hasMoreAfter?: boolean;
    readonly continuation?: unknown;
  };

  assert.equal(projection.modelResult?.continuation, undefined);
  assert.equal(structured.hasMoreAfter, true);
  assert.equal(structured.nextStartRow, undefined);
  assert.equal(structured.reachedRowCeiling, true);
  assert.equal(structured.rowCeiling, 10000);
  assert.equal(agentContent.hasMoreAfter, true);
  assert.equal(agentContent.continuation, undefined);
});
