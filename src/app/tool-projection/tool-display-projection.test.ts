import assert from "node:assert/strict";
import test from "node:test";
import { projectToolDisplay } from "./tool-display-projection.js";

test("projectToolDisplay keeps concrete request targets before tool output exists", () => {
  const read = projectToolDisplay(
    { callId: "call-read-live", toolName: "Read", input: { path: "src/app/runtime.ts" } },
    undefined,
  );
  const browser = projectToolDisplay(
    { callId: "call-browser-live", toolName: "WebFetch", input: { url: "https://example.test/docs" } },
    undefined,
  );
  const http = projectToolDisplay(
    {
      callId: "call-http-live",
      toolName: "HttpRequest",
      input: { method: "POST", url: "https://example.test/api/check" },
    },
    undefined,
  );

  assert.equal(read.kind, "read_result");
  assert.equal(read.kind === "read_result" ? read.title : undefined, "src/app/runtime.ts");
  assert.equal(browser.kind, "web_fetch");
  assert.equal(browser.kind === "web_fetch" ? browser.url : undefined, "https://example.test/docs");
  assert.equal(http.kind, "http_response");
  assert.equal(http.kind === "http_response" ? http.method : undefined, "POST");
  assert.equal(http.kind === "http_response" ? http.url : undefined, "https://example.test/api/check");
});

test("projectToolDisplay gives sub-agent calls a task-native display", () => {
  const requested = projectToolDisplay(
    {
      callId: "call-agent-live",
      toolName: "Agent",
      input: {
        sub_agent_name: "review-expert",
        task: "检查工具展示的信息层级",
        context: null,
      },
    },
    undefined,
  );
  const completed = projectToolDisplay(
    {
      callId: "call-agent-live",
      toolName: "Agent",
      input: {
        sub_agent_name: "review-expert",
        task: "检查工具展示的信息层级",
        context: null,
      },
    },
    "发现两处重复信息。",
  );

  assert.equal(requested.kind, "agent_task");
  assert.equal(requested.kind === "agent_task" ? requested.agentName : undefined, "review-expert");
  assert.equal(requested.kind === "agent_task" ? requested.task : undefined, "检查工具展示的信息层级");
  assert.equal(requested.kind === "agent_task" ? requested.result : undefined, undefined);
  assert.equal(completed.kind === "agent_task" ? completed.result : undefined, "发现两处重复信息。");
});

test("projectToolDisplay consumes flat shell facts and keeps stdout out of the activity summary", () => {
  const display = projectToolDisplay(
    { callId: "call-shell", toolName: "Shell", input: { command: "node", args: ["-v"] } },
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
  assert.equal(display.kind === "command_summary" ? display.stdoutPreview : undefined, "v24.0.0");
});

test("projectToolDisplay keeps useful bounded stdout and stderr previews separate", () => {
  const stdout = Array.from({ length: 12 }, (_, index) => `stdout line ${index + 1}`).join("\n");
  const stderr = Array.from({ length: 8 }, (_, index) => `stderr line ${index + 1}`).join("\n");
  const output = { commandLine: "pnpm test", exitCode: 1, stdout, stderr };
  const display = projectToolDisplay(
    { callId: "call-shell-detail", toolName: "Shell", input: { commandLine: "pnpm test" } },
    output,
  );

  assert.equal(display.kind, "command_summary");
  assert.equal(display.kind === "command_summary" ? display.stdoutPreview : undefined, stdout);
  assert.equal(display.kind === "command_summary" ? display.stderrPreview : undefined, stderr);
  assert.equal(display.kind === "command_summary" ? display.stdoutPreview?.includes("stdout line 12") : true, true);
  assert.equal(output.stdout, stdout);
  assert.equal(output.stderr, stderr);
});

test("projectToolDisplay keeps full command output in expandable detail", () => {
  const stdout = "x".repeat(20_000);
  const output = { commandLine: "node task.js", exitCode: 0, stdout };
  const display = projectToolDisplay(
    { callId: "call-shell-bounded", toolName: "Shell", input: { commandLine: "node task.js" } },
    output,
  );

  assert.equal(display.kind === "command_summary" ? display.stdoutPreview : undefined, stdout);
  assert.equal(output.stdout.length, 20_000);
});

test("projectToolDisplay consumes flat research read facts", () => {
  const display = projectToolDisplay(
    { callId: "call-read", toolName: "ResearchRead", input: { ref: "research:web:one" } },
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
  assert.equal(display.kind === "read_result" ? display.title : undefined, "AgentArbor");
  assert.equal(display.kind === "read_result" ? display.contentPreview : "unexpected", undefined);
  assert.equal(JSON.stringify(display).includes("researchStatus"), false);
  assert.equal(JSON.stringify(display).includes("short preview"), false);
});

test("projectToolDisplay presents batch reads as sources without ref or status jargon", () => {
  const display = projectToolDisplay(
    { callId: "call-read-batch", toolName: "ResearchRead", input: {} },
    {
      items: [
        { ref: "research:web:one", researchStatus: "completed", title: "First source" },
        { ref: "research:web:two", researchStatus: "provider-failed", error: "Page unavailable" },
      ],
    },
  );

  assert.equal(display.kind, "generic_tool_summary");
  assert.equal(display.kind === "generic_tool_summary" ? display.summary : undefined, "2 个来源");
  assert.deepEqual(
    display.kind === "generic_tool_summary" ? display.items : undefined,
    ["First source", "research:web:two · Page unavailable"],
  );
  assert.equal(JSON.stringify(display).includes("researchStatus"), false);
  assert.equal(JSON.stringify(display).includes("个 ref"), false);
});

test("projectToolDisplay keeps sources and HTTP content without webpage excerpts", () => {
  const search = projectToolDisplay(
    { callId: "call-search", toolName: "ResearchSearch", input: { query: "AgentArbor" } },
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
    { callId: "call-browser", toolName: "WebFetch", input: { url: "https://example.test" } },
    { title: "Example", url: "https://example.test", text: "page text", truncated: true },
  );
  const http = projectToolDisplay(
    { callId: "call-http", toolName: "HttpRequest", input: { url: "https://example.test/api" } },
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
  assert.equal(search.kind === "search_results" ? search.results.length : undefined, 2);
  assert.equal(browser.kind, "web_fetch");
  assert.equal(JSON.stringify(browser).includes("page text"), false);
  assert.equal(browser.truncated, true);
  assert.equal(http.kind, "http_response");
  assert.equal(http.kind === "http_response" ? http.statusCode : undefined, 200);
  assert.equal(http.kind === "http_response" ? http.bodyPreview : undefined, "response body");
  assert.equal(JSON.stringify(http).includes("durationMs"), false);
});

test("projectToolDisplay keeps read and HTTP detail beyond the former short-summary limit", () => {
  const readContent = `read-start\n${"r".repeat(2_000)}\nread-end`;
  const responseBody = `http-start\n${"h".repeat(2_000)}\nhttp-end`;
  const read = projectToolDisplay(
    { callId: "call-read-detail", toolName: "Read", input: { path: "README.md" } },
    { path: "README.md", content: readContent },
  );
  const http = projectToolDisplay(
    { callId: "call-http-detail", toolName: "HttpRequest", input: { url: "https://example.test" } },
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

  assert.equal(display.kind, "raw_tool_result");
  assert.notEqual(display.kind === "raw_tool_result" ? display.action : undefined, "legacy action");
  assert.equal(display.kind === "raw_tool_result" ? display.summary : undefined, undefined);
  assert.equal(JSON.stringify(display).includes("legacy body"), false);
});

test("projectToolDisplay keeps complete source titles instead of clipping them", () => {
  const title = `A complete source title ${"with meaningful context ".repeat(12).trim()}`;
  const display = projectToolDisplay(
    { callId: "call-search-title", toolName: "ResearchSearch", input: { query: "AgentArbor" } },
    { query: "AgentArbor", results: [{ title, url: "https://example.test/complete-title" }] },
  );

  assert.equal(display.kind === "search_results" ? display.results[0]?.title : undefined, title);
});

test("projectToolDisplay gives Workbench feature tools non-filesystem displays", () => {
  const knowledge = projectToolDisplay(
    { callId: "call-knowledge", toolName: "KnowledgeCreateNote", input: { title: "Daily" } },
    { status: "created", note: { id: "note-1", title: "Daily", revision: 1 } },
  );
  const spaces = projectToolDisplay(
    { callId: "call-spaces", toolName: "SpaceList", input: {} },
    { spaces: [{ id: "space-1", title: "Project", folderCount: 1, referenceItemCount: 2 }] },
  );
  const note = projectToolDisplay(
    { callId: "call-note", toolName: "NoteWrite", input: { scope: "workspace" } },
    { status: "updated", scope: "workspace", characters: 42 },
  );

  assert.equal(knowledge.kind, "knowledge_operation");
  assert.equal(knowledge.kind === "knowledge_operation" ? knowledge.operation : undefined, "create_note");
  assert.equal(spaces.kind, "space_operation");
  assert.equal(spaces.kind === "space_operation" ? spaces.operation : undefined, "list");
  assert.equal(note.kind, "note_operation");
});

test("projectToolDisplay treats Glob matches as file-search results and preserves continuation", () => {
  const display = projectToolDisplay(
    { callId: "call-glob", toolName: "Glob", input: { pattern: "*.ts", path: "src" } },
    {
      pattern: "*.ts",
      path: "src",
      matches: [{ path: "src/app.ts" }],
      truncated: true,
      continuation: { nextInput: { pattern: "*.ts", path: "src", offset: 1 } },
    },
  );

  assert.equal(display.kind, "file_search_results");
  assert.equal(display.kind === "file_search_results" ? display.query : undefined, "*.ts");
  assert.equal(display.kind === "file_search_results" ? display.matches[0]?.path : undefined, "src/app.ts");
  assert.equal(display.truncated, true);
  assert.deepEqual(display.continuation?.nextInput, { pattern: "*.ts", path: "src", offset: 1 });
});
