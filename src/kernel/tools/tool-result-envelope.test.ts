import assert from "node:assert/strict";
import test from "node:test";
import { projectToolResultEnvelope, projectToolStatusEnvelope } from "./tool-result-envelope.js";

test("tool result envelope converts typed display into safe model summary and refs", () => {
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

  assert.equal(envelope.rawRetention, "diagnostic_ref_only");
  assert.equal(envelope.redacted, true);
  assert.equal(envelope.uiDisplay?.kind, "search_results");
  assert.equal(envelope.evidenceRefs.includes("tool:call-search"), true);
  const json = JSON.stringify(envelope);
  assert.equal(json.includes("sk-secret"), false);
  assert.equal(json.includes("api_key"), false);
});

test("tool status envelope covers failed, approval-required, and cancelled without raw output", () => {
  for (const status of ["failed", "approval_required", "cancelled"] as const) {
    const envelope = projectToolStatusEnvelope({
      request: { callId: `call-${status}`, toolName: "shell_command", input: { command: "pnpm test" } },
      status,
      summary: `status ${status} stdout: raw stdout body Bearer sk-secret`,
      diagnosticRef: `tool:call-${status}:${status}`,
    });

    assert.equal(envelope.rawRetention, "diagnostic_ref_only");
    assert.equal(envelope.redacted, true);
    assert.equal(envelope.evidenceRefs.includes(`tool:call-${status}`), true);
    assert.equal(JSON.stringify(envelope).includes("sk-secret"), false);
  }
});
