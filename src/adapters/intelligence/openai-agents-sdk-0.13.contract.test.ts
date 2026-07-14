import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import test from "node:test";
import {
  Agent,
  MemorySession,
  OpenAIProvider,
  Runner,
  RunState,
  setTracingDisabled,
  tool,
} from "@openai/agents";
import { z } from "zod";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/contracts.js";

const MODEL = "agents-sdk-contract-model";
const API_KEY = "agents-sdk-contract-key";
const CONTRACT_TEST_TIMEOUT_MS = 10_000;
const CHILD_PROCESS_TIMEOUT_MS = 5_000;

// Runner.tracingDisabled prevents model payload tracing, but SDK 0.13.3 still creates the
// outer workflow trace. The isolated probe disables the global exporter as a second guard.
setTracingDisabled(true);

type JsonRecord = Record<string, unknown>;

type CapturedRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: JsonRecord;
};

type ScriptedStep = (
  request: CapturedRequest,
  response: ServerResponse,
  incoming: IncomingMessage,
) => void | Promise<void>;

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

class ScriptedOpenAIServer {
  private readonly server: Server;
  private readonly waiters = new Map<number, Deferred<CapturedRequest>>();
  private readonly steps: ScriptedStep[];

  readonly requests: CapturedRequest[] = [];
  baseUrl = "";

  constructor(steps: readonly ScriptedStep[]) {
    this.steps = [...steps];
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
        }
        response.end(JSON.stringify({ error: errorMessage(error) }));
      });
    });
  }

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The scripted OpenAI server did not expose a TCP address.");
    }
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error === undefined ? resolve() : reject(error));
      this.server.closeAllConnections();
    });
  }

  waitForRequest(index: number): Promise<CapturedRequest> {
    const existing = this.requests[index];
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    let waiter = this.waiters.get(index);
    if (waiter === undefined) {
      waiter = createDeferred<CapturedRequest>();
      this.waiters.set(index, waiter);
    }
    return waiter.promise;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = parseJsonRecord(await readRequestBody(request));
    const captured: CapturedRequest = {
      method: request.method ?? "",
      path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      body,
    };
    const index = this.requests.push(captured) - 1;
    this.waiters.get(index)?.resolve(captured);
    this.waiters.delete(index);

    const step = this.steps.shift();
    if (step === undefined) {
      sendJson(response, 500, { error: `Unexpected request ${captured.method} ${captured.path}.` });
      return;
    }
    await step(captured, response, request);
  }
}

test("OpenAI Agents SDK 0.13.3 selects the Responses endpoint explicitly", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (request, response) => {
      assert.equal(request.path, "/v1/responses");
      assert.equal(request.body.model, MODEL);
      sendResponsesText(response, "responses-ok", "resp_contract_1");
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, true);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  const result = await runtime.runner.run(createAgent(), "use Responses", { maxTurns: null });

  assert.equal(result.finalOutput, "responses-ok");
  assert.equal(result.lastResponseId, "resp_contract_1");
  assert.deepEqual(server.requests.map((request) => request.path), ["/v1/responses"]);
});

test("OpenAI Agents SDK 0.13.3 selects compatible Chat with baseURL and useResponses false", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (request, response) => {
      assert.equal(request.path, "/v1/chat/completions");
      assert.equal(request.body.model, MODEL);
      sendChatText(response, "chat-ok", "chat_contract_1");
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  const result = await runtime.runner.run(createAgent(), "use compatible Chat", { maxTurns: null });

  assert.equal(result.finalOutput, "chat-ok");
  assert.deepEqual(server.requests.map((request) => request.path), ["/v1/chat/completions"]);
});

test("OpenAI Agents SDK 0.13.3 streams text after executing one tool exactly once", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (_request, response) => sendChatToolStream(response, {
      callId: "call_stream_once",
      toolName: "echo_once",
      argumentsJson: JSON.stringify({ value: "stream-input" }),
    }),
    (request, response) => {
      const serialized = JSON.stringify(request.body);
      assert.equal(countOccurrences(serialized, "call_stream_once"), 2);
      assert.equal(countOccurrences(serialized, "tool-result-once"), 1);
      sendChatTextStream(response, ["stream ", "complete"]);
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  let executions = 0;
  const echoTool = tool({
    name: "echo_once",
    description: "Return one deterministic tool result.",
    parameters: z.object({ value: z.string() }),
    execute: ({ value }) => {
      executions += 1;
      assert.equal(value, "stream-input");
      return "tool-result-once";
    },
  });
  const stream = await runtime.runner.run(
    createAgent([echoTool]),
    "call the echo tool once",
    { maxTurns: null, stream: true },
  );
  const chunks: string[] = [];
  for await (const chunk of stream.toTextStream()) {
    chunks.push(chunk);
  }
  await stream.completed;

  assert.equal(stream.cancelled, false);
  assert.equal(chunks.join(""), "stream complete");
  assert.equal(stream.finalOutput, "stream complete");
  assert.equal(executions, 1);
  assert.equal(server.requests.length, 2);
});

test("OpenAI Agents SDK 0.13.3 pauses native approval and resumes serialized state without replay", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (_request, response) => sendChatTool(response, {
      callId: "call_approve_once",
      toolName: "approved_action",
      argumentsJson: JSON.stringify({ value: "approved-input" }),
    }),
    (request, response) => {
      assert.match(JSON.stringify(request.body), /approved-result/u);
      sendChatText(response, "approval-resumed", "chat_approval_done");
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  let executions = 0;
  const approvedTool = tool({
    name: "approved_action",
    description: "Perform a deterministic action after approval.",
    parameters: z.object({ value: z.string() }),
    needsApproval: true,
    execute: ({ value }) => {
      executions += 1;
      assert.equal(value, "approved-input");
      return "approved-result";
    },
  });
  const agent = createAgent([approvedTool]);
  const paused = await runtime.runner.run(agent, "request approval", { maxTurns: null });

  assert.equal(paused.interruptions.length, 1);
  assert.equal(executions, 0);

  const restored = await RunState.fromString(agent, paused.state.toString());
  const interruption = restored.getInterruptions()[0];
  assert.ok(interruption);
  restored.approve(interruption);
  const resumed = await runtime.runner.run(agent, restored, { maxTurns: null });

  assert.equal(resumed.finalOutput, "approval-resumed");
  assert.equal(resumed.interruptions.length, 0);
  assert.equal(executions, 1);
  assert.equal(server.requests.length, 2);
});

test("OpenAI Agents SDK 0.13.3 rejection resumes with guidance and never executes the tool", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (_request, response) => sendChatTool(response, {
      callId: "call_reject",
      toolName: "rejected_action",
      argumentsJson: JSON.stringify({ value: "reject-input" }),
    }),
    (request, response) => {
      assert.match(JSON.stringify(request.body), /rejected by contract probe/u);
      sendChatText(response, "rejection-resumed", "chat_rejection_done");
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  let executions = 0;
  const rejectedTool = tool({
    name: "rejected_action",
    description: "Never execute after rejection.",
    parameters: z.object({ value: z.string() }),
    needsApproval: true,
    execute: () => {
      executions += 1;
      return "must-not-run";
    },
  });
  const agent = createAgent([rejectedTool]);
  const paused = await runtime.runner.run(agent, "request rejection", { maxTurns: null });
  const interruption = paused.state.getInterruptions()[0];
  assert.ok(interruption);
  paused.state.reject(interruption, { message: "rejected by contract probe" });

  const resumed = await runtime.runner.run(agent, paused.state, { maxTurns: null });

  assert.equal(resumed.finalOutput, "rejection-resumed");
  assert.equal(resumed.interruptions.length, 0);
  assert.equal(executions, 0);
});

test("ToolExecutionBroker approval_required is not an OpenAI Agents SDK interruption", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (_request, response) => sendChatTool(response, {
      callId: "call_broker_approval",
      toolName: "broker_approval_boundary",
      argumentsJson: JSON.stringify({ value: "sensitive" }),
    }),
    (request, response) => {
      assert.match(JSON.stringify(request.body), /approval_required/u);
      sendChatText(response, "broker-boundary-observed", "chat_broker_boundary");
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  let brokerExecutions = 0;
  const broker: ToolExecutionBroker = {
    list: () => [],
    has: (name) => name === "broker_approval_boundary",
    async execute(
      request: ToolCallRequest,
      _context: ToolExecutionContext,
      _permission: ToolPermissionCheck,
    ): Promise<ToolCallResult> {
      brokerExecutions += 1;
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "approval_required",
        durationMs: 0,
      };
    },
  };
  const brokerTool = tool({
    name: "broker_approval_boundary",
    description: "Expose the ToolExecutionBroker approval boundary without adapting it.",
    parameters: z.object({ value: z.string() }),
    execute: async (input, _context, details) => JSON.stringify(await broker.execute(
      {
        callId: details?.toolCall?.callId ?? "missing-call-id",
        toolName: "broker_approval_boundary",
        input,
      },
      {
        callerAgentId: "sdk-probe",
        traceId: "sdk-probe-trace",
        goalId: "sdk-probe-goal",
        abortSignal: details?.signal,
      },
      {
        callerAgentId: "sdk-probe",
        allowedTools: ["broker_approval_boundary"],
      },
    )),
  });

  const result = await runtime.runner.run(
    createAgent([brokerTool]),
    "exercise the broker approval boundary",
    { maxTurns: null },
  );

  // The SDK only creates interruptions from its own pre-execution needsApproval contract.
  // A broker result with status approval_required is ordinary tool output, so this spike must
  // never be cited as proof that AgentArbor's ToolCenter approval continuation is integrated.
  assert.equal(result.interruptions.length, 0);
  assert.equal(result.finalOutput, "broker-boundary-observed");
  assert.equal(brokerExecutions, 1);
});

test("OpenAI Agents SDK 0.13.3 propagates AbortSignal to an in-flight model request", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const connectionClosed = createDeferred<void>();
  const server = await startServer([
    (_request, response, incoming) => {
      incoming.once("aborted", () => connectionClosed.resolve(undefined));
      response.once("close", () => connectionClosed.resolve(undefined));
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, true);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  const controller = new AbortController();
  const running = runtime.runner.run(createAgent(), "wait for cancellation", {
    maxTurns: null,
    signal: controller.signal,
  });
  await server.waitForRequest(0);
  controller.abort();

  await assert.rejects(running, isAbortError);
  await connectionClosed.promise;
  assert.equal(server.requests.length, 1);
});

test("OpenAI Agents SDK 0.13.3 needs an explicit application-context AbortSignal bridge for tools", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (_request, response) => sendChatTool(response, {
      callId: "call_abort_tool",
      toolName: "wait_for_abort",
      argumentsJson: JSON.stringify({ value: "wait" }),
    }),
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  const toolStarted = createDeferred<void>();
  type AbortBridgeContext = { readonly abortSignal: AbortSignal };
  let observedDetailsSignal: AbortSignal | undefined;
  let observedContextSignal: AbortSignal | undefined;
  let executions = 0;
  const parameters = z.object({ value: z.string() });
  const abortingTool = tool<typeof parameters, AbortBridgeContext>({
    name: "wait_for_abort",
    description: "Wait until the owning run is cancelled.",
    parameters,
    execute: async (_input, runContext, details) => {
      executions += 1;
      observedDetailsSignal = details?.signal;
      observedContextSignal = runContext?.context.abortSignal;
      toolStarted.resolve(undefined);
      await rejectWhenAborted(observedContextSignal);
      return "must-not-complete";
    },
  });
  const controller = new AbortController();
  const agent = new Agent<AbortBridgeContext>({
    name: "AgentsSdkAbortBridgeProbe",
    instructions: "Call the wait_for_abort tool once.",
    model: MODEL,
    tools: [abortingTool],
  });
  const running = runtime.runner.run(agent, "cancel the tool", {
    context: { abortSignal: controller.signal },
    maxTurns: null,
    signal: controller.signal,
  });
  await toolStarted.promise;
  controller.abort();

  await assert.rejects(running, isAbortError);
  assert.equal(observedDetailsSignal, undefined);
  assert.equal(observedContextSignal, controller.signal);
  assert.equal(observedContextSignal?.aborted, true);
  assert.equal(executions, 1);
  assert.equal(server.requests.length, 1);
});

test("OpenAI Agents SDK 0.13.3 MemorySession sends prior local history exactly once", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await startServer([
    (_request, response) => sendChatText(response, "first-assistant-sentinel", "chat_history_1"),
    (request, response) => {
      const messages = JSON.stringify(request.body.messages);
      assert.equal(countOccurrences(messages, "first-user-sentinel"), 1);
      assert.equal(countOccurrences(messages, "first-assistant-sentinel"), 1);
      assert.equal(countOccurrences(messages, "second-user-sentinel"), 1);
      sendChatText(response, "second-assistant-sentinel", "chat_history_2");
    },
  ]);
  const runtime = createSdkRuntime(server.baseUrl, false);
  t.after(async () => {
    await runtime.provider.close();
    await server.close();
  });

  const session = new MemorySession({ sessionId: "agents-sdk-contract-history" });
  const agent = createAgent();
  const first = await runtime.runner.run(agent, "first-user-sentinel", {
    maxTurns: null,
    session,
  });
  const second = await runtime.runner.run(agent, "second-user-sentinel", {
    maxTurns: null,
    session,
  });

  assert.equal(first.finalOutput, "first-assistant-sentinel");
  assert.equal(second.finalOutput, "second-assistant-sentinel");
  const stored = JSON.stringify(await session.getItems());
  assert.equal(countOccurrences(stored, "first-user-sentinel"), 1);
  assert.equal(countOccurrences(stored, "first-assistant-sentinel"), 1);
  assert.equal(countOccurrences(stored, "second-user-sentinel"), 1);
  assert.equal(countOccurrences(stored, "second-assistant-sentinel"), 1);
});

test("OpenAI Agents SDK 0.13.3 disables hosted tracing in a non-test child process", {
  timeout: CONTRACT_TEST_TIMEOUT_MS,
}, async () => {
  const script = String.raw`
    globalThis.fetch = async (input) => {
      globalThis.__fetchCalls.push(String(input instanceof Request ? input.url : input));
      return new Response(null, { status: 204 });
    };
    globalThis.__fetchCalls = [];
    const sdk = await import('@openai/agents');
    sdk.setTracingDisabled(true);
    const model = {
      async getResponse() {
        return {
          output: [{
            id: 'trace-message',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'trace-ok', providerData: {} }],
          }],
          usage: new sdk.Usage(),
        };
      },
      async *getStreamedResponse() {
        throw new Error('Streaming is not used by the tracing guard.');
      },
    };
    const modelProvider = { async getModel() { return model; } };
    const runner = new sdk.Runner({
      modelProvider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    });
    if (runner.config.tracingDisabled !== true || runner.config.traceIncludeSensitiveData !== false) {
      throw new Error('Runner tracing defaults are not disabled.');
    }
    const agent = new sdk.Agent({ name: 'TraceGuard', instructions: 'Return trace-ok.', model: 'local' });
    const result = await runner.run(agent, 'trace guard', { maxTurns: null });
    if (result.finalOutput !== 'trace-ok') throw new Error('Trace guard model did not complete.');
    await sdk.getGlobalTraceProvider().forceFlush();
    if (globalThis.__fetchCalls.length !== 0) {
      throw new Error('Hosted tracing attempted network access: ' + globalThis.__fetchCalls.join(', '));
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPENAI_API_KEY: "agents-sdk-tracing-guard-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const [code, signal] = await waitForChildExit(child, CHILD_PROCESS_TIMEOUT_MS);

  assert.equal(
    code,
    0,
    `Tracing guard child failed${signal === null ? "" : ` with ${signal}`}\n${Buffer.concat(stdout)}\n${Buffer.concat(stderr)}`,
  );
});

function createAgent(tools: readonly ReturnType<typeof tool>[] = []): Agent {
  return new Agent({
    name: "AgentsSdkContractProbe",
    instructions: "Follow the scripted contract response.",
    model: MODEL,
    tools: [...tools],
  });
}

function createSdkRuntime(baseUrl: string, useResponses: boolean): {
  readonly provider: OpenAIProvider;
  readonly runner: Runner;
} {
  const provider = new OpenAIProvider({
    apiKey: API_KEY,
    baseURL: baseUrl,
    useResponses,
    strictFeatureValidation: true,
    cacheResponsesWebSocketModels: false,
  });
  return {
    provider,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
    }),
  };
}

async function startServer(steps: readonly ScriptedStep[]): Promise<ScriptedOpenAIServer> {
  const server = new ScriptedOpenAIServer(steps);
  await server.start();
  return server;
}

function sendResponsesText(response: ServerResponse, text: string, responseId: string): void {
  sendJson(response, 200, {
    id: responseId,
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    output: [{
      id: `${responseId}_message`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }],
    }],
  });
}

function sendChatText(response: ServerResponse, text: string, responseId: string): void {
  sendJson(response, 200, {
    id: responseId,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function sendChatTool(response: ServerResponse, input: {
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}): void {
  sendJson(response, 200, {
    id: `${input.callId}_response`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: input.callId,
          type: "function",
          function: { name: input.toolName, arguments: input.argumentsJson },
        }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function sendChatToolStream(response: ServerResponse, input: {
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}): void {
  sendSse(response, [
    chatChunk({
      role: "assistant",
      tool_calls: [{
        index: 0,
        id: input.callId,
        type: "function",
        function: { name: input.toolName, arguments: input.argumentsJson },
      }],
    }, null),
    chatChunk({}, "tool_calls"),
  ]);
}

function sendChatTextStream(response: ServerResponse, chunks: readonly string[]): void {
  sendSse(response, [
    chatChunk({ role: "assistant", content: chunks[0] ?? "" }, null),
    ...chunks.slice(1).map((content) => chatChunk({ content }, null)),
    chatChunk({}, "stop"),
  ]);
}

function chatChunk(delta: JsonRecord, finishReason: string | null): JsonRecord {
  return {
    id: "chatcmpl_stream_contract",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendSse(response: ServerResponse, events: readonly JsonRecord[]): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const event of events) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

function sendJson(response: ServerResponse, status: number, value: JsonRecord): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonRecord(value: string): JsonRecord {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected the provider request body to be a JSON object.");
  }
  return parsed as JsonRecord;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function rejectWhenAborted(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) {
    throw new Error("The SDK did not provide an AbortSignal to tool execution.");
  }
  if (signal.aborted) {
    throw abortError();
  }
  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
  throw abortError();
}

function abortError(): Error {
  const error = new Error("The operation was aborted by the contract probe.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/iu.test(error.message));
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<[number | null, NodeJS.Signals | null]> {
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const exit = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    if (timedOut) {
      throw new Error(`Child process exceeded the ${timeoutMs}ms contract-test deadline.`);
    }
    return exit;
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}
