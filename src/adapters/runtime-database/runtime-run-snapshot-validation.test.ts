import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import { validateRuntimeRunSnapshotContent } from "./runtime-run-snapshot-validation.js";

test("runtime snapshot accepts only the persisted Responses continuation whitelist", () => {
  const snapshot = ordinarySnapshot();

  assert.equal(validateRuntimeRunSnapshotContent(snapshot, snapshot.run.runId).ok, true);
});

test("runtime snapshot rejects attachments and unknown provider state in Ordinary model context", () => {
  const snapshot = ordinarySnapshot();
  const withUnknownState = {
    ...snapshot,
    ordinaryModelContext: {
      ...snapshot.ordinaryModelContext,
      messages: [{
        role: "assistant",
        content: "done",
        protocolExtensions: { unknown_provider_state: { value: true } },
      }],
    },
  };
  const withAttachment = {
    ...snapshot,
    ordinaryModelContext: {
      ...snapshot.ordinaryModelContext,
      messages: [{
        role: "user",
        content: "inspect",
        attachments: [{
          kind: "file",
          source: { kind: "data", mimeType: "text/plain", data: "aGVsbG8=" },
        }],
      }],
    },
  };

  assert.equal(validateRuntimeRunSnapshotContent(withUnknownState, snapshot.run.runId).ok, false);
  assert.equal(validateRuntimeRunSnapshotContent(withAttachment, snapshot.run.runId).ok, false);
});

test("runtime snapshot rejects broken tool-call history instead of repairing it", () => {
  const snapshot = ordinarySnapshot();
  const orphanToolResult = {
    ...snapshot,
    ordinaryModelContext: {
      runId: snapshot.run.runId,
      messages: [{ role: "tool", content: "result", toolCallId: "missing-call", toolName: "read_file" }],
    },
  };
  const unresolvedToolCall = {
    ...snapshot,
    ordinaryModelContext: {
      runId: snapshot.run.runId,
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-1", toolName: "read_file", input: { path: "README.md" } }],
      }],
    },
  };
  const validToolChain = {
    ...snapshot,
    ordinaryModelContext: {
      runId: snapshot.run.runId,
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ callId: "call-1", toolName: "read_file", input: { path: "README.md" } }],
        },
        { role: "tool", content: "file body", toolCallId: "call-1", toolName: "read_file" },
      ],
    },
  };

  assert.equal(validateRuntimeRunSnapshotContent(orphanToolResult, snapshot.run.runId).ok, false);
  assert.equal(validateRuntimeRunSnapshotContent(unresolvedToolCall, snapshot.run.runId).ok, false);
  assert.equal(validateRuntimeRunSnapshotContent(validToolChain, snapshot.run.runId).ok, true);
});

function ordinarySnapshot(): RuntimeRunSnapshot {
  const runId = "run-model-context-validation";
  return {
    run: {
      runId,
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status: "completed",
      goalSummary: "validate context",
      aiMode: "fake",
      appHome: "C:/AgentArbor",
      runHome: `C:/AgentArbor/runs/${runId}`,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:01.000Z",
      completedAt: "2026-07-14T00:00:01.000Z",
    },
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
    subAgentRuns: [],
    ordinaryModelContext: {
      runId,
      messages: [{
        role: "assistant",
        content: "done",
        protocolExtensions: {
          openai_responses_output_items: [{
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "done" }],
          }],
        },
      }],
    },
  };
}
