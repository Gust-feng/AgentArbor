import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import type { OrdinaryExecutionPort } from "../ordinary-agent/index.js";
import { createAgentSessionExecutionTestDriver } from "../testing/agent-session-execution-driver.js";
import { runRealAiSmoke } from "./real-ai-smoke-runner.js";

const configuredEnv = {
  AGENTARBOR_MODEL_API_KEY: "sk-smoke-test",
  AGENTARBOR_MODEL_NAME: "smoke-model",
  AGENTARBOR_MODEL_PROTOCOL: "openai_compatible_chat_completions",
};

test("real AI smoke traverses the production Agent Session loop through a local OpenAI-compatible stream", async (t) => {
  const provider = await createOpenAICompatibleFixture();
  t.after(provider.close);

  const summary = await runRealAiSmoke(undefined, {
    env: {
      ...configuredEnv,
      AGENTARBOR_MODEL_BASE_URL: `${provider.url}/v1`,
    },
    timeoutMs: 10_000,
  });

  assert.equal(summary.status, "completed", summary.status === "failed" ? summary.message : undefined);
  if (summary.status !== "completed") return;
  assert.equal(summary.answer, "Observed the workspace root through list.");
  assert.equal(summary.toolCallCount, 1);
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0]?.authorization, "Bearer sk-smoke-test");
  assert.equal(hasToolResultMessage(provider.requests[1]?.body), true);
});

test("real AI smoke uses the formal Ordinary feature entry and reports canonical completion", async () => {
  const summary = await runRealAiSmoke("finish the smoke", {
    env: configuredEnv,
    ordinaryAgentExecution: (configDirectory) => completedExecution(configDirectory, "formal Ordinary answer"),
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
    ordinaryAgentExecution: (configDirectory) => ({
      async execute(input) {
        const session = await createAgentSessionExecutionTestDriver(configDirectory)
          .complete(input, "unsupported smoke success");
        return {
          status: "completed",
          answer: "unsupported smoke success",
          session,
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        };
      },
    }),
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
    ordinaryAgentExecution: (configDirectory) => ({
      async execute(input) {
        const approval = approvalToolResult(request);
        const session = await createAgentSessionExecutionTestDriver(configDirectory)
          .prepareToolRound(input, [approval]);
        await input.onToolResult?.(approval);
        return {
          status: "approval_required",
          session,
          toolCalls: [approval],
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
          confirmationRequests: [request],
          continuation: {
            availability: "live_only",
            async decide() { throw new Error("Smoke must not decide confirmations."); },
            async release() { return undefined; },
          },
        };
      },
    }),
  });

  assert.equal(summary.status, "failed");
  if (summary.status !== "failed") return;
  assert.match(summary.message, /approval_needed/u);
});

test("real AI smoke reports an Ordinary terminal failure without inventing an answer", async () => {
  const summary = await runRealAiSmoke("fail the smoke", {
    env: { ...configuredEnv, AGENTARBOR_MODEL_PROTOCOL: "openai_responses" },
    ordinaryAgentExecution: () => ({
      async execute() {
        return {
          status: "failed",
          error: { code: "provider_failed", message: "provider unavailable" },
          toolCalls: [],
          usage: {},
        };
      },
    }),
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

function completedExecution(configDirectory: string, answer: string): OrdinaryExecutionPort {
  return {
    async execute(input) {
      const driver = createAgentSessionExecutionTestDriver(configDirectory);
      const toolResult = completedToolResult();
      const session = await driver.prepareToolRound(input, [toolResult]);
      await input.onToolResult?.(toolResult);
      const completedToolSession = await driver.commitToolResults(input, session, [toolResult]);
      const completedSession = await driver.complete(input, answer, completedToolSession);
      return {
        status: "completed",
        answer,
        session: completedSession,
        toolCalls: [toolResult],
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      };
    },
  };
}

function completedToolResult(): ToolCallResult {
  return {
    callId: "smoke-list-dir",
    toolName: "list",
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

function approvalToolResult(request: ConfirmationRequest): ToolCallResult {
  return {
    callId: request.toolCallFactId,
    toolName: "shell",
    input: { commandLine: "echo smoke" },
    output: undefined,
    status: "approval_required",
    durationMs: 0,
    confirmationRequest: request,
  };
}

async function createOpenAICompatibleFixture(): Promise<{
  readonly url: string;
  readonly requests: Array<{ readonly authorization?: string; readonly body: unknown }>;
  readonly close: () => Promise<void>;
}> {
  const requests: Array<{ readonly authorization?: string; readonly body: unknown }> = [];
  const server = createServer((request, response) => {
    void handleOpenAICompatibleRequest(request, response, requests).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}

async function handleOpenAICompatibleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: Array<{ readonly authorization?: string; readonly body: unknown }>,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(await readRequestBody(request)) as unknown;
  requests.push({
    ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }),
    body,
  });
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  if (requests.length === 1) {
    writeSse(response, completionChunk({
      delta: {
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: "smoke-list-root",
          type: "function",
          function: { name: "list", arguments: JSON.stringify({ path: "." }) },
        }],
      },
      finishReason: "tool_calls",
    }));
  } else {
    writeSse(response, completionChunk({
      delta: { role: "assistant", content: "Observed the workspace root through list." },
      finishReason: "stop",
    }));
  }
  writeSse(response, {
    id: `chatcmpl-smoke-${requests.length}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "smoke-model",
    choices: [],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  });
  response.end("data: [DONE]\n\n");
}

function completionChunk(input: { readonly delta: unknown; readonly finishReason: "tool_calls" | "stop" }) {
  return {
    id: "chatcmpl-smoke",
    object: "chat.completion.chunk",
    created: 1,
    model: "smoke-model",
    choices: [{ index: 0, delta: input.delta, finish_reason: input.finishReason }],
  };
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function hasToolResultMessage(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("messages" in body)) return false;
  const messages = (body as { readonly messages?: unknown }).messages;
  return Array.isArray(messages) && messages.some((message) =>
    typeof message === "object" && message !== null && (message as { readonly role?: unknown }).role === "tool");
}
