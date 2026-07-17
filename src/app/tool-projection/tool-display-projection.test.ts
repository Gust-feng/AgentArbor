import assert from "node:assert/strict";
import test from "node:test";
import { projectToolDisplay } from "./tool-display-projection.js";

test("projectToolDisplay consumes flat shell facts and keeps stdout out of the activity summary", () => {
  const display = projectToolDisplay(
    { callId: "call-shell", toolName: "shell_command", input: { command: "node", args: ["-v"] } },
    {
      command: "node",
      commandLine: "node -v",
      cwd: ".",
      exitCode: 0,
      stdout: "v24.0.0",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  );

  assert.equal(display.kind, "command_summary");
  assert.equal(display.kind === "command_summary" ? display.commandLine : undefined, "node -v");
  assert.equal(display.kind === "command_summary" ? display.exitCode : undefined, 0);
  assert.equal(display.kind === "command_summary" ? display.outputSummary : undefined, "v24.0.0");
  assert.equal(display.kind === "command_summary" ? display.stdoutPreview : undefined, "v24.0.0");
});

test("projectToolDisplay keeps useful bounded stdout and stderr previews separate", () => {
  const stdout = Array.from({ length: 12 }, (_, index) => `stdout line ${index + 1}`).join("\n");
  const stderr = Array.from({ length: 8 }, (_, index) => `stderr line ${index + 1}`).join("\n");
  const output = { commandLine: "pnpm test", exitCode: 1, stdout, stderr };
  const display = projectToolDisplay(
    { callId: "call-shell-detail", toolName: "shell_command", input: { commandLine: "pnpm test" } },
    output,
  );

  assert.equal(display.kind, "command_summary");
  assert.equal(display.kind === "command_summary" ? display.stdoutPreview : undefined, stdout);
  assert.equal(display.kind === "command_summary" ? display.stderrPreview : undefined, stderr);
  assert.equal(display.kind === "command_summary" ? display.outputSummary?.includes("stdout line 12") : true, false);
  assert.equal(output.stdout, stdout);
  assert.equal(output.stderr, stderr);
});

test("projectToolDisplay bounds the UI preview without changing the full command fact", () => {
  const stdout = "x".repeat(20_000);
  const output = { commandLine: "node task.js", exitCode: 0, stdout };
  const display = projectToolDisplay(
    { callId: "call-shell-bounded", toolName: "shell_command", input: { commandLine: "node task.js" } },
    output,
  );

  assert.equal((display.kind === "command_summary" ? display.stdoutPreview?.length ?? 0 : 0) <= 16_002, true);
  assert.equal(output.stdout.length, 20_000);
});

test("projectToolDisplay consumes flat research read facts", () => {
  const display = projectToolDisplay(
    { callId: "call-read", toolName: "read", input: { ref: "research:web:one" } },
    {
      ref: "research:web:one",
      researchStatus: "completed",
      refId: "research:web:one",
      source: "page",
      title: "AgentArbor",
      uri: "https://example.test/agentarbor",
      contentPreview: "short preview",
      truncated: false,
    },
  );

  assert.equal(display.kind, "read_result");
  assert.equal(display.kind === "read_result" ? display.status : undefined, "completed");
  assert.equal(display.kind === "read_result" ? display.title : undefined, "AgentArbor");
  assert.equal(display.kind === "read_result" ? display.contentPreview : undefined, "short preview");
});

test("projectToolDisplay preserves flat search, browser, and HTTP display facts", () => {
  const search = projectToolDisplay(
    { callId: "call-search", toolName: "search", input: { query: "AgentArbor" } },
    {
      query: "AgentArbor",
      researchStatus: "completed",
      message: "2 sources",
      results: [
        { title: "One", url: "https://example.test/one", snippet: "first" },
        { title: "Two", url: "https://example.test/two", snippet: "second" },
      ],
    },
  );
  const browser = projectToolDisplay(
    { callId: "call-browser", toolName: "browser_snapshot", input: { url: "https://example.test" } },
    { title: "Example", url: "https://example.test", text: "page text", truncated: true },
  );
  const http = projectToolDisplay(
    { callId: "call-http", toolName: "http_request", input: { url: "https://example.test/api" } },
    {
      method: "GET",
      url: "https://example.test/api",
      statusCode: 200,
      statusText: "OK",
      durationMs: 12,
      body: "response body",
      truncated: false,
    },
  );

  assert.equal(search.kind, "search_results");
  assert.equal(search.kind === "search_results" ? search.status : undefined, "completed");
  assert.equal(search.kind === "search_results" ? search.results.length : undefined, 2);
  assert.equal(browser.kind, "browser_snapshot");
  assert.equal(browser.kind === "browser_snapshot" ? browser.text : undefined, "page text");
  assert.equal(browser.kind === "browser_snapshot" ? browser.truncated : undefined, true);
  assert.equal(http.kind, "http_response");
  assert.equal(http.kind === "http_response" ? http.statusCode : undefined, 200);
  assert.equal(http.kind === "http_response" ? http.bodyPreview : undefined, "response body");
});

test("projectToolDisplay keeps read and HTTP detail beyond the former short-summary limit", () => {
  const readContent = `read-start\n${"r".repeat(2_000)}\nread-end`;
  const responseBody = `http-start\n${"h".repeat(2_000)}\nhttp-end`;
  const read = projectToolDisplay(
    { callId: "call-read-detail", toolName: "read_file", input: { path: "README.md" } },
    { path: "README.md", content: readContent },
  );
  const http = projectToolDisplay(
    { callId: "call-http-detail", toolName: "http_request", input: { url: "https://example.test" } },
    { url: "https://example.test", statusCode: 200, body: responseBody },
  );

  assert.equal(read.kind === "read_result" ? read.contentPreview : undefined, readContent);
  assert.equal(http.kind === "http_response" ? http.bodyPreview : undefined, responseBody);
});

test("projectToolDisplay does not interpret legacy action, summary, or result wrappers", () => {
  const display = projectToolDisplay(
    { callId: "call-legacy", toolName: "vendor__lookup", input: {} },
    {
      action: "legacy action",
      summary: "legacy summary",
      result: { path: "legacy/path", text: "legacy body" },
    },
  );

  assert.equal(display.kind, "generic_tool_summary");
  assert.notEqual(display.kind === "generic_tool_summary" ? display.action : undefined, "legacy action");
  assert.equal(display.kind === "generic_tool_summary" ? display.summary : undefined, undefined);
  assert.equal(JSON.stringify(display).includes("legacy body"), false);
});
