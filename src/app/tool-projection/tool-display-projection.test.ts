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
