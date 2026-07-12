import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCallResult } from "../../../domain/tools/index.js";
import { evidenceRefsFromToolCalls } from "./cognitive-work-session-run-projection.js";

test("Cognitive Work Session evidence refs consume flat research read facts", () => {
  const refs = evidenceRefsFromToolCalls([
    toolCall("call-read", {
      refId: "research:codebase:single",
      traceId: "trace-single",
    }),
    toolCall("call-read-batch", {
      items: [
        { refId: "research:codebase:first" },
        { refId: "research:codebase:second" },
      ],
    }),
  ]);

  assert.deepEqual(refs, [
    "tool-call:call-read",
    "research:codebase:single",
    "research-trace:trace-single",
    "tool-call:call-read-batch",
    "research:codebase:first",
    "research:codebase:second",
  ]);
});

test("Cognitive Work Session evidence refs do not read the legacy result envelope", () => {
  const refs = evidenceRefsFromToolCalls([
    toolCall("call-legacy-read", {
      result: { refId: "research:legacy:wrapped" },
      trace: { traceId: "legacy-trace" },
    }),
  ]);

  assert.deepEqual(refs, ["tool-call:call-legacy-read"]);
});

function toolCall(callId: string, output: ToolCallResult["output"]): ToolCallResult {
  return {
    callId,
    toolName: "read",
    input: { ref: "research:codebase:fixture" },
    output,
    status: "completed",
    durationMs: 1,
  };
}
