import assert from "node:assert/strict";
import test from "node:test";
import { projectToolResultEnvelope, projectToolStatusEnvelope } from "./tool-result-envelope.js";

test("tool result envelope converts typed display into compact model summary and refs without redaction", () => {
  const envelope = projectToolResultEnvelope({
    request: { callId: "call-search", toolName: "search", input: { query: "AgentArbor" } },
    display: {
      kind: "search_results",
      query: "AgentArbor",
      results: [
        {
          title: "AgentArbor docs",
          url: "https://example.test/docs?token=sk-secret-token",
          snippet: "Useful snippet with api_key=sk-secret",
        },
      ],
    },
    summary: "raw provider response should not appear",
    diagnosticRef: "tool:call-search",
    truncated: false,
  });

  assert.equal(envelope.rawRetention, "none");
  assert.equal(envelope.redacted, false);
  assert.equal(envelope.uiDisplay?.kind, "search_results");
  assert.equal(envelope.evidenceRefs.includes("tool:call-search"), true);
  const json = JSON.stringify(envelope);
  assert.equal(json.includes("sk-secret"), true);
  assert.equal(json.includes("api_key"), true);
});

test("tool result envelope keeps search status messages distinct from empty results", () => {
  const envelope = projectToolResultEnvelope({
    request: { callId: "call-search-empty", toolName: "search", input: { query: "" } },
    display: {
      kind: "search_results",
      query: "",
      status: "invalid-input",
      message: "search requires a non-empty query.",
      results: [],
    },
    diagnosticRef: "tool:call-search-empty",
    truncated: false,
  });

  assert.equal(envelope.uiDisplay?.kind, "search_results");
  assert.equal(envelope.uiDisplay?.kind === "search_results" ? envelope.uiDisplay.message : undefined, "search requires a non-empty query.");
  assert.equal(envelope.agentSummary.includes("search requires a non-empty query."), true);
  assert.equal(envelope.agentSummary.includes("AgentArbor docs"), false);
});

test("tool status envelope covers failed, approval-required, and cancelled without redaction", () => {
  for (const status of ["failed", "approval_required", "cancelled"] as const) {
    const envelope = projectToolStatusEnvelope({
      request: { callId: `call-${status}`, toolName: "shell_command", input: { command: "pnpm test" } },
      status,
      summary: `status ${status} stdout: raw stdout body Bearer sk-secret`,
      diagnosticRef: `tool:call-${status}:${status}`,
    });

    assert.equal(envelope.rawRetention, "none");
    assert.equal(envelope.redacted, false);
    assert.equal(envelope.evidenceRefs.includes(`tool:call-${status}`), true);
    assert.equal(JSON.stringify(envelope).includes("sk-secret"), true);
    assert.equal(envelope.errorDomain, status === "failed" ? "process_error" : undefined);
  }
});

test("tool status envelope classifies non-process failures as tool errors", () => {
  const envelope = projectToolStatusEnvelope({
    request: { callId: "call-read", toolName: "read_file", input: { path: "missing.md" } },
    status: "failed",
    summary: "ENOENT: no such file or directory, open missing.md",
    diagnosticRef: "tool:call-read:failed",
    errorFacts: {
      code: "ENOENT",
      path: "missing.md",
    },
  });

  assert.equal(envelope.errorDomain, "tool_error");
  assert.equal(envelope.errorFacts?.code, "ENOENT");
  assert.equal(envelope.errorFacts?.path, "missing.md");
  assert.equal(envelope.agentSummary.includes("ENOENT"), true);
});

test("tool result envelope keeps structured directory evidence compact and referenced", () => {
  const envelope = projectToolResultEnvelope({
    request: { callId: "call-list", toolName: "list_dir", input: { path: "." } },
    display: {
      kind: "directory_listing",
      path: ".",
      depth: 1,
      entriesReturned: 9,
      totalEntries: 29,
      unreadableDirectories: 1,
      entries: [
        { path: "README.md", kind: "file", bytes: 120, depth: 1 },
        { path: "src", kind: "directory", depth: 1 },
      ],
      truncated: true,
    },
    diagnosticRef: "tool:call-list",
    truncated: true,
  });

  assert.equal(envelope.uiDisplay?.kind, "directory_listing");
  assert.equal(envelope.uiDisplay?.kind === "directory_listing" ? envelope.uiDisplay.totalEntries : undefined, 29);
  assert.equal(envelope.evidenceRefs.includes("file:README.md"), true);
  assert.equal(envelope.evidenceRefs.includes("file:src"), true);
  assert.equal(envelope.agentSummary.includes("29"), true);
});

test("tool result envelope keeps more than sample-sized file search matches for UI", () => {
  const envelope = projectToolResultEnvelope({
    request: { callId: "call-grep-large", toolName: "grep_files", input: { path: ".", query: "needle" } },
    display: {
      kind: "file_search_results",
      query: "needle",
      path: ".",
      matches: Array.from({ length: 30 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        line: index + 1,
        preview: `needle ${index}`,
      })),
      matchesReturned: 30,
      truncated: false,
    },
    diagnosticRef: "tool:call-grep-large",
    truncated: false,
  });

  assert.equal(envelope.uiDisplay?.kind, "file_search_results");
  assert.equal(envelope.uiDisplay?.kind === "file_search_results" ? envelope.uiDisplay.matches.length : undefined, 30);
  assert.equal(envelope.uiDisplay?.kind === "file_search_results" ? envelope.uiDisplay.matchesReturned : undefined, 30);
  assert.equal(envelope.truncated, false);
});
