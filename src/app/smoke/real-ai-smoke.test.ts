import assert from "node:assert/strict";
import test from "node:test";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import type { OrdinaryExecutionPort } from "../ordinary-agent/index.js";
import { runRealAiSmoke } from "./real-ai-smoke-runner.js";

const configuredEnv = {
  AGENTARBOR_MODEL_API_KEY: "sk-smoke-test",
  AGENTARBOR_MODEL_NAME: "smoke-model",
  AGENTARBOR_MODEL_PROTOCOL: "openai_compatible_chat_completions",
};

test("real AI smoke uses the formal Ordinary feature entry and reports canonical completion", async () => {
  const summary = await runRealAiSmoke("finish the smoke", {
    env: configuredEnv,
    ordinaryAgentExecution: completedExecution("formal Ordinary answer"),
  });

  assert.equal(summary.status, "completed");
  if (summary.status !== "completed") return;
  assert.equal(summary.runtime, "ordinary_agent");
  assert.equal(summary.protocol, "openai_compatible_chat_completions");
  assert.equal(summary.answer, "formal Ordinary answer");
  assert.equal(summary.toolCallCount, 1);
  assert.deepEqual(summary.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8 });
});

test("real AI smoke rejects a completed run without a persisted tool fact", async () => {
  const summary = await runRealAiSmoke("finish without tools", {
    env: configuredEnv,
    ordinaryAgentExecution: {
      async execute(input) {
        return {
          status: "completed",
          answer: "unsupported smoke success",
          canonicalMessages: [...input.messages, { role: "assistant", content: "unsupported smoke success" }],
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        };
      },
    },
  });

  assert.equal(summary.status, "failed");
  if (summary.status !== "failed") return;
  assert.match(summary.message, /without a persisted tool fact/u);
});

test("real AI smoke returns an approval pause immediately instead of waiting for timeout", async () => {
  const request = confirmation("smoke-approval");
  const summary = await runRealAiSmoke("request approval", {
    env: configuredEnv,
    timeoutMs: 2_000,
    ordinaryAgentExecution: {
      async execute(input) {
        return {
          status: "approval_required",
          canonicalMessages: input.messages,
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
          confirmationRequests: [request],
          continuation: {
            availability: "live_only",
            async decide() { throw new Error("Smoke must not decide confirmations."); },
            async release() { return undefined; },
          },
        };
      },
    },
  });

  assert.equal(summary.status, "failed");
  if (summary.status !== "failed") return;
  assert.match(summary.message, /approval_needed/u);
});

test("real AI smoke reports an Ordinary terminal failure without inventing an answer", async () => {
  const summary = await runRealAiSmoke("fail the smoke", {
    env: { ...configuredEnv, AGENTARBOR_MODEL_PROTOCOL: "openai_responses" },
    ordinaryAgentExecution: {
      async execute(input) {
        return {
          status: "failed",
          error: { code: "provider_failed", message: "provider unavailable" },
          canonicalMessages: input.messages,
          toolCalls: [],
          usage: {},
        };
      },
    },
  });

  assert.deepEqual(summary.status, "failed");
  if (summary.status !== "failed") return;
  assert.equal(summary.protocol, "openai_responses");
  assert.match(summary.message, /provider unavailable/u);
});

test("real AI smoke skips before creating runtime resources when configuration is missing", async () => {
  assert.deepEqual(await runRealAiSmoke("unused", { env: {} }), {
    status: "skipped",
    runtime: "ordinary_agent",
    boundary: "configuration",
    code: "missing_api_key",
    message: "AGENTARBOR_MODEL_API_KEY or OPENAI_API_KEY is required.",
  });
});

function completedExecution(answer: string): OrdinaryExecutionPort {
  return {
    async execute(input) {
      const toolResult = completedToolResult();
      await input.onToolResult?.(toolResult);
      return {
        status: "completed",
        answer,
        canonicalMessages: [...input.messages, { role: "assistant", content: answer }],
        toolCalls: [toolResult],
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      };
    },
  };
}

function completedToolResult(): ToolCallResult {
  return {
    callId: "smoke-list-dir",
    toolName: "list_dir",
    input: { path: "." },
    output: { entries: ["README.md", "src"] },
    status: "completed",
    durationMs: 2,
  };
}

function confirmation(runId: string): ConfirmationRequest {
  return {
    confirmationId: `${runId}-confirmation`,
    toolCallFactId: `${runId}:tool-fact`,
    title: "Confirm command",
    actionSummary: "Run a command",
    affectedResources: ["workspace"],
    riskLevel: "medium",
    resumeAvailability: "live",
    requestedAt: "2026-01-01T00:00:02.000Z",
    sourceRefs: [],
  };
}
