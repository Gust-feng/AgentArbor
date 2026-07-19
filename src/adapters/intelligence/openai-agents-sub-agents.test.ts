import assert from "node:assert/strict";
import test from "node:test";
import type { AgentLoopAgentTool } from "../../app/model-runtime/agent-loop.js";
import { canonicalToolResultMessage } from "../../app/model-runtime/tool-result-message.js";
import {
  SPAWN_SUB_AGENT_TOOL_NAME,
  createSubAgentAgentTools,
} from "../../app/sub-agents/sub-agent-agent-tools.js";
import { SubAgentRegistry } from "../../app/sub-agents/sub-agent-registry.js";
import type { ConfirmationDecision } from "../../domain/confirmation/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolExecutionPreflight,
  ToolFactValue,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { toolCallFactId } from "../../domain/tools/index.js";
import {
  createOpenAIAgentsLoop,
  openAIAgentsPromptCacheKey,
  type OpenAIAgentsLoopConfig,
} from "./openai-agents-loop.js";

const MODEL = "agent-loop-sub-agent-test";
const ROOT_SYSTEM = "ROOT_SYSTEM_MARKER: synthesize delegated results.";
const CHILD_SYSTEM = "CHILD_SYSTEM_MARKER: work only on the delegated task.";
const CHAT_BASE_URL = "https://compatible.example.test/v1";
const OFFICIAL_BASE_URL = "https://api.openai.com/v1";

type JsonRecord = Record<string, unknown>;
type CapturedFetch = {
  readonly url: string;
  readonly body: JsonRecord;
  readonly signal: AbortSignal;
};

test("Chat keeps child exchanges private while returning one complete agent-tool result to the parent history", async () => {
  const fullOutput = `complete-child-output:${"x".repeat(130_000)}`;
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const observedToolResults: ToolCallResult[] = [];
  let parentObservedToolOutput: string | undefined;
  const fetch = scriptedFetch([
    ({ body }) => {
      assert.deepEqual(toolNames(body), ["read_fact", "call_sub_agent"]);
      return chatTool("parent-delegate-call", "call_sub_agent", { task: "inspect facts" });
    },
    ({ body }) => {
      assert.equal(systemText(body), CHILD_SYSTEM);
      assert.deepEqual(toolNames(body), ["read_fact"]);
      return chatTool("child-read-call", "read_fact", { value: "fact" });
    },
    ({ body }) => {
      assert.equal(systemText(body), CHILD_SYSTEM);
      assert.match(JSON.stringify(body.messages), /gateway:read_fact/u);
      return chatText(fullOutput);
    },
    ({ body }) => {
      assert.equal(systemText(body), ROOT_SYSTEM);
      const serialized = JSON.stringify(body.messages);
      assert.equal(serialized.includes("child-read-call"), false);
      assert.equal(serialized.includes("gateway:read_fact"), false);
      assert.equal(occurrences(serialized, fullOutput), 1);
      parentObservedToolOutput = chatToolOutput(body, "parent-delegate-call");
      return chatText("root-synthesis");
    },
  ]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["read_fact"] })],
      onToolResult: async (toolResult) => { observedToolResults.push(toolResult); },
    }));
    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "root-synthesis");
    assert.equal(gateway.executions.length, 1);
    assert.equal(gateway.executions[0]?.context.callerAgentId, "sub-agent:fixed");
    assert.deepEqual(gateway.executions[0]?.permission.allowedTools, ["read_fact"]);
    const parentResult = result.toolResults.find((item) => item.callId === "parent-delegate-call");
    assert.equal(parentResult?.output, fullOutput);
    const canonicalToolMessages = result.messages.filter((message) => message.role === "tool");
    assert.deepEqual(canonicalToolMessages.map((message) => message.toolCallId), ["parent-delegate-call"]);
    assert.equal(canonicalToolMessages[0]?.content, canonicalToolResultMessage(parentResult!).content);
    assert.equal(parentObservedToolOutput, canonicalToolMessages[0]?.content);
    assert.equal(result.messages.some((message) => message.toolCallId === "child-read-call"), false);
    assert.deepEqual(observedToolResults.map((item) => [item.callId, item.status]), [
      ["child-read-call", "completed"],
      ["parent-delegate-call", "completed"],
    ]);
    assert.equal(observedToolResults[0]?.parentToolCallFactId, "parent-delegate-call");
    assert.equal(observedToolResults[1]?.parentToolCallFactId, undefined);
  } finally {
    await loop.release();
  }
});

test("Chat Sub-Agent never replays a reasoning-only assistant before its tool call", async () => {
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const fetch = scriptedFetch([
    () => chatTool("parent-reasoning-delegate", "call_sub_agent", { task: "review facts" }),
    () => chatReasoningTool("child-reasoning-read", "read_fact", { value: "fact" }),
    ({ body }) => hasInvalidAssistantMessage(body)
      ? invalidAssistantMessageResponse()
      : chatText("child-review-complete"),
    ({ body }) => {
      assert.match(chatToolOutput(body, "parent-reasoning-delegate") ?? "", /child-review-complete/u);
      return chatText("root-used-child-review");
    },
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
  });

  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["read_fact"] })],
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "root-used-child-review");
    assert.equal(fetch.requests.length, 4);
  } finally {
    await loop.release();
  }
});

test("Sub-Agent uses the same streaming transport as a streaming Ordinary run", async () => {
  const gateway = new RecordingGateway([]);
  const fetch = scriptedFetch([
    () => chatToolStream("parent-stream-delegate", "call_sub_agent", { task: "stream child" }),
    () => chatTextStream(["child-", "streamed"]),
    () => chatTextStream(["root-", "complete"]),
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { stream: true },
  });
  const deltas: string[] = [];
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: [] })],
      onTextDelta: (delta) => deltas.push(delta),
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "root-complete");
    assert.deepEqual(fetch.requests.map(({ body }) => body.stream), [true, true, true]);
    assert.equal(deltas.join(""), "root-complete");
  } finally {
    await loop.release();
  }
});

test("Responses Sub-Agent keeps streaming across delegation and parent synthesis", async () => {
  const gateway = new RecordingGateway([]);
  const fetch = scriptedFetch([
    () => responsesToolStream("responses-parent-delegate", "call_sub_agent", { task: "stream child" }),
    () => responsesTextStream(["responses-child-", "streamed"], "responses-child"),
    () => responsesTextStream(["responses-root-", "complete"], "responses-root"),
  ]);
  const loop = createLoop({
    protocol: "openai_responses",
    baseUrl: OFFICIAL_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { stream: true },
  });
  const deltas: string[] = [];
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: [] })],
      onTextDelta: (delta) => deltas.push(delta),
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "responses-root-complete");
    assert.deepEqual(fetch.requests.map(({ body }) => body.stream), [true, true, true]);
    assert.equal(deltas.join(""), "responses-root-complete");
  } finally {
    await loop.release();
  }
});

test("Sub-Agent exhausts only its model-request retry budget and returns classified failure facts", async () => {
  const gateway = new RecordingGateway([]);
  const connectionFailure = () => {
    throw new TypeError("terminated", { cause: new Error("other side closed") });
  };
  const fetch = scriptedFetch([
    () => chatTool("parent-failed-delegate", "call_sub_agent", { task: "retry child" }),
    connectionFailure,
    connectionFailure,
    connectionFailure,
    () => chatText("root handled classified child failure"),
  ]);
  const loop = createLoop({
    protocol: "openai_compatible_chat_completions",
    baseUrl: CHAT_BASE_URL,
    fetch: fetch.fetch,
  });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: [] })],
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(fetch.requests.length, 5);
    const failed = result.toolResults.find((item) => item.callId === "parent-failed-delegate");
    assert.equal(failed?.status, "failed");
    assert.deepEqual(failed?.errorFacts, {
      code: "sub_agent_execution_failed",
      causeCode: "provider_network",
      retryable: true,
    });
    assert.match(failed?.error ?? "", /connection error|terminated/iu);
  } finally {
    await loop.release();
  }
});

test("Sub-Agent records an incomplete Responses terminal state as a failed tool fact before the parent continues", async () => {
  const observedToolResults: ToolCallResult[] = [];
  const gateway = new RecordingGateway([]);
  const fetch = scriptedFetch([
    () => responsesTool("parent-invalid-child", "call_sub_agent", { task: "return a verified result" }),
    () => responsesTextWithStatus("child partial", "child-incomplete", "incomplete"),
    () => responsesText("parent handled the child failure", "root-after-child"),
  ]);
  const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: [] })],
      onToolResult: async (toolResult) => { observedToolResults.push(toolResult); },
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "parent handled the child failure");
    assert.equal(result.toolResults.find((item) => item.callId === "parent-invalid-child")?.status, "failed");
    assert.equal(observedToolResults.find((item) => item.callId === "parent-invalid-child")?.status, "failed");
  } finally {
    await loop.release();
  }
});

test("Sub-Agent terminal gate rejects an incomplete child tool turn before nested execution", async () => {
  const observedToolResults: ToolCallResult[] = [];
  const gateway = new RecordingGateway([plainTool("write_fact")]);
  const fetch = scriptedFetch([
    () => responsesTool("parent-invalid-child-tool", "call_sub_agent", { task: "perform a delegated write" }),
    () => responsesToolWithStatus(
      "child-incomplete-write",
      "write_fact",
      { value: "changed" },
      "incomplete",
    ),
    () => responsesText("parent handled the rejected child tool", "root-after-rejected-child-tool"),
  ]);
  const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["write_fact"] })],
      onToolResult: async (toolResult) => { observedToolResults.push(toolResult); },
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(
      result.status === "completed" ? result.finalText : undefined,
      "parent handled the rejected child tool",
    );
    assert.equal(gateway.executions.length, 0);
    assert.equal(fetch.requests.length, 3);
    assert.equal(
      result.toolResults.find((item) => item.callId === "parent-invalid-child-tool")?.status,
      "failed",
    );
    assert.equal(
      observedToolResults.some((item) => item.callId === "child-incomplete-write"),
      false,
    );
  } finally {
    await loop.release();
  }
});

test("root tool-round hook observes the AgentTool call but not nested child model turns", async () => {
  const accepted: ModelMessage[] = [];
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const fetch = scriptedFetch([
    () => responsesTool("parent-observed-delegation", "call_sub_agent", { task: "read the delegated fact" }),
    () => responsesTool("child-unobserved-read", "read_fact", { value: "nested" }),
    () => responsesText("child-read-complete", "child-unobserved-final"),
    () => responsesText("root-observer-complete", "root-observer-final"),
  ]);
  const loop = createLoop({ protocol: "openai_responses", baseUrl: OFFICIAL_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["read_fact"] })],
      onToolRound: async ({ assistantMessage }) => { accepted.push(assistantMessage); },
    }));

    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "root-observer-complete");
    assert.equal(gateway.executions.length, 1);
    assert.deepEqual(
      accepted.flatMap((message) => message.toolCalls ?? []).map((call) => call.callId),
      ["parent-observed-delegation"],
    );
  } finally {
    await loop.release();
  }
});

test("Responses gives a no-tool child no tools or parallel flag and never reuses the root prompt cache key", async () => {
  let rootCacheKey: unknown;
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const fetch = scriptedFetch([
    ({ body }) => {
      rootCacheKey = body.prompt_cache_key;
      assert.equal(typeof rootCacheKey, "string");
      assert.equal(body.parallel_tool_calls, true);
      return responsesTool("spawn-call", "spawn_sub_agent", { task: "answer without tools" });
    },
    ({ body }) => {
      assert.equal(systemText(body), CHILD_SYSTEM);
      assert.deepEqual(toolNames(body), []);
      assert.equal(body.parallel_tool_calls, undefined);
      assert.equal(body.prompt_cache_key, undefined);
      return responsesText("temporary-specialist-output", "child-response");
    },
    ({ body }) => {
      assert.equal(systemText(body), ROOT_SYSTEM);
      assert.equal(body.prompt_cache_key, rootCacheKey);
      assert.match(JSON.stringify(body.input), /temporary-specialist-output/u);
      return responsesText("root-responses-synthesis", "root-final");
    },
  ]);
  const loop = createLoop({
    protocol: "openai_responses",
    baseUrl: OFFICIAL_BASE_URL,
    fetch: fetch.fetch,
    requestSettings: { parallelToolCalls: true },
  });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "spawn_sub_agent", allowedTools: [] })],
    }));
    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "root-responses-synthesis");
    assert.equal(result.toolResults.find((item) => item.callId === "spawn-call")?.output, "temporary-specialist-output");
  } finally {
    await loop.release();
  }
});

test("Responses serializes the production spawn_sub_agent schema within the strict JSON subset", async () => {
  const agentTools = await createSubAgentAgentTools({
    registry: new SubAgentRegistry({ roots: [] }),
    parentAllowedTools: [],
    executableTools: [],
    exposedToolNames: [SPAWN_SUB_AGENT_TOOL_NAME],
    dynamicSpawnAvailable: true,
  });
  const gateway = new RecordingGateway([]);
  const fetch = scriptedFetch([
    ({ body }) => {
      const tools = Array.isArray(body.tools) ? body.tools.map(parseRecord) : [];
      const spawn = tools.find((item) => item.name === SPAWN_SUB_AGENT_TOOL_NAME);
      assert.equal(spawn?.strict, true);
      assert.doesNotMatch(JSON.stringify(spawn?.parameters), /uniqueItems/u);
      return responsesText("schema-compatible", "schema-compatible-response");
    },
  ]);
  const loop = createLoop({
    protocol: "openai_responses",
    baseUrl: OFFICIAL_BASE_URL,
    fetch: fetch.fetch,
  });
  try {
    const result = await loop.execute(loopInput({ gateway, agentTools }));
    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
  } finally {
    await loop.release();
  }
});

test("root and child provider call-id collisions keep separate facts and permission boundaries", async () => {
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const fetch = scriptedFetch([
    () => chatTool("shared-provider-call", "read_fact", { value: "root" }),
    () => chatTool("parent-collision", "call_sub_agent", { task: "read child fact" }),
    () => chatTool("shared-provider-call", "read_fact", { value: "child" }),
    () => chatText("child-collision-result"),
    () => chatText("root-collision-result"),
  ]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["read_fact"] })],
    }));
    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(gateway.executions.length, 2);
    assert.deepEqual(gateway.executions.map((item) => item.request.callId), [
      "shared-provider-call",
      "shared-provider-call",
    ]);
    assert.deepEqual(gateway.executions.map((item) => item.request.input), [
      { value: "root" },
      { value: "child" },
    ]);
    assert.equal(toolCallFactId(gateway.executions[0]!.request), "shared-provider-call");
    assert.notEqual(
      toolCallFactId(gateway.executions[1]!.request),
      toolCallFactId(gateway.executions[0]!.request),
    );
    assert.notEqual(
      gateway.executions[1]!.context.callerAgentId,
      gateway.executions[0]!.context.callerAgentId,
    );
    const rootToolMessage = result.messages.find((message) =>
      message.toolCallId === "shared-provider-call" && message.toolName === "read_fact");
    const rootToolPayload = JSON.parse(rootToolMessage?.content ?? "{}") as {
      readonly body?: { readonly format?: string; readonly text?: string };
      readonly input?: unknown;
    };
    assert.equal(rootToolPayload.input, undefined);
    assert.deepEqual(rootToolPayload.body, { format: "text", text: "gateway:read_fact" });
  } finally {
    await loop.release();
  }
});

test("a nested ToolCenter approval pauses the root and resumes the exact child call with the new signal", async () => {
  const gateway = new RecordingGateway([gatedTool("write_fact")]);
  const fetch = scriptedFetch([
    () => chatTool("parent-call", "call_sub_agent", { task: "write one fact" }),
    ({ body }) => {
      assert.equal(systemText(body), CHILD_SYSTEM);
      return chatTool("child-write-call", "write_fact", { value: "approved" });
    },
    ({ body }) => {
      assert.match(JSON.stringify(body.messages), /gateway:write_fact/u);
      return chatText("child-after-approval");
    },
    ({ body }) => {
      assert.match(JSON.stringify(body.messages), /child-after-approval/u);
      return chatText("root-after-approval");
    },
  ]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const paused = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["write_fact"] })],
    }));
    assert.equal(paused.status, "approval_required", paused.status === "failed" ? paused.error : undefined);
    assert.equal(gateway.executions.length, 0);
    assert.equal(paused.confirmationRequests.length, 1);
    const confirmation = paused.confirmationRequests[0]!;

    const resumedController = new AbortController();
    const resumed = await paused.continuation.decide({
      decision: approve(confirmation.confirmationId),
      abortSignal: resumedController.signal,
    });
    assert.equal(resumed.status, "completed", resumed.status === "failed" ? resumed.error : undefined);
    assert.equal(gateway.executions.length, 1);
    assert.equal(gateway.executions[0]?.context.abortSignal, resumedController.signal);
    assert.equal(gateway.executions[0]?.context.callerAgentId, "sub-agent:fixed");
    assert.equal(resumed.toolResults.filter((item) => item.callId === "child-write-call" && item.status === "completed").length, 1);
    assert.equal(resumed.toolResults.find((item) => item.callId === "parent-call")?.output, "child-after-approval");
  } finally {
    await loop.release();
  }
});

test("nested guidance rejects the child side effect and lets child and parent agents continue", async () => {
  const gateway = new RecordingGateway([gatedTool("write_fact")]);
  const fetch = scriptedFetch([
    () => chatTool("parent-guidance", "call_sub_agent", { task: "write carefully" }),
    () => chatTool("child-guidance-call", "write_fact", { value: "unsafe" }),
    ({ body }) => {
      assert.match(JSON.stringify(body.messages), /use a read-only approach/u);
      return chatText("child-followed-guidance");
    },
    ({ body }) => {
      assert.match(JSON.stringify(body.messages), /child-followed-guidance/u);
      return chatText("root-guidance-finished");
    },
  ]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const paused = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["write_fact"] })],
    }));
    assert.equal(paused.status, "approval_required");
    if (paused.status !== "approval_required") return;
    const confirmation = paused.confirmationRequests[0]!;
    const resumed = await paused.continuation.decide({
      decision: {
        confirmationId: confirmation.confirmationId,
        decision: "guidance",
        guidance: "use a read-only approach",
        decidedAt: "2026-07-15T00:00:01.000Z",
      },
      abortSignal: new AbortController().signal,
    });
    assert.equal(resumed.status, "completed", resumed.status === "failed" ? resumed.error : undefined);
    assert.equal(gateway.executions.length, 0);
    assert.equal(
      [...resumed.toolResults].reverse().find((item) => item.callId === "child-guidance-call")?.status,
      "cancelled",
    );
    assert.equal(resumed.toolResults.find((item) => item.callId === "parent-guidance")?.output, "child-followed-guidance");
  } finally {
    await loop.release();
  }
});

test("parallel nested agents surface multiple child confirmations and execute every approved call once", async () => {
  const gateway = new RecordingGateway([gatedTool("write_fact")]);
  let rootCalls = 0;
  let childInitialActive = 0;
  let maxChildInitialActive = 0;
  let childInitialCount = 0;
  let releaseInitial: (() => void) | undefined;
  const initialBarrier = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const requests: CapturedFetch[] = [];
  const fetchImpl: typeof globalThis.fetch = async (requestInput, init) => {
    const request = requestInput instanceof Request ? requestInput : new Request(requestInput, init);
    const body = parseRecord(await request.clone().json());
    requests.push({ url: request.url, body, signal: request.signal });
    if (systemText(body) === ROOT_SYSTEM) {
      rootCalls += 1;
      if (rootCalls === 1) {
        return chatTools([
          { callId: "parent-a", name: "call_sub_agent", input: { task: "task-a" } },
          { callId: "parent-b", name: "call_sub_agent", input: { task: "task-b" } },
        ]);
      }
      assert.match(JSON.stringify(body.messages), /child-result-task-a/u);
      assert.match(JSON.stringify(body.messages), /child-result-task-b/u);
      return chatText("parallel-root-finished");
    }
    const task = JSON.stringify(body.messages).includes("task-a") ? "task-a" : "task-b";
    const hasToolResult = JSON.stringify(body.messages).includes(`gateway:write_fact`);
    if (hasToolResult) {
      return chatText(`child-result-${task}`);
    }
    childInitialActive += 1;
    childInitialCount += 1;
    maxChildInitialActive = Math.max(maxChildInitialActive, childInitialActive);
    if (childInitialCount === 2) {
      releaseInitial?.();
    }
    await initialBarrier;
    childInitialActive -= 1;
    return chatTool("child-write-shared", "write_fact", { value: task });
  };
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetchImpl });
  try {
    const paused = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["write_fact"] })],
    }));
    assert.equal(paused.status, "approval_required", paused.status === "failed" ? paused.error : undefined);
    assert.equal(maxChildInitialActive, 2);
    assert.equal(paused.confirmationRequests.length, 2);
    const decisions = paused.confirmationRequests.map((request): ConfirmationDecision =>
      approve(request.confirmationId));
    const resumed = await paused.continuation.decide({
      decisions,
      abortSignal: new AbortController().signal,
    });
    assert.equal(resumed.status, "completed", resumed.status === "failed" ? resumed.error : undefined);
    assert.equal(gateway.executions.length, 2);
    assert.deepEqual(gateway.executions.map((item) => item.request.callId), [
      "child-write-shared",
      "child-write-shared",
    ]);
    assert.equal(new Set(gateway.executions.map((item) => toolCallFactId(item.request))).size, 2);
    assert.equal(resumed.toolResults.filter((item) => item.callId === "parent-a").length, 1);
    assert.equal(resumed.toolResults.filter((item) => item.callId === "parent-b").length, 1);
    assert.equal(requests.length, 6);
  } finally {
    await loop.release();
  }
});

test("aborting the root while a child model request is active cancels the nested run", async () => {
  const gateway = new RecordingGateway([]);
  const controller = new AbortController();
  let childStarted: (() => void) | undefined;
  const childStartedPromise = new Promise<void>((resolve) => {
    childStarted = resolve;
  });
  let requestCount = 0;
  const observedToolResults: ToolCallResult[] = [];
  const fetchImpl: typeof globalThis.fetch = async (requestInput, init) => {
    const request = requestInput instanceof Request ? requestInput : new Request(requestInput, init);
    requestCount += 1;
    if (requestCount === 1) {
      return chatTool("parent-cancel", "call_sub_agent", { task: "wait" });
    }
    childStarted?.();
    return rejectWhenAborted(request.signal);
  };
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetchImpl });
  try {
    const resultPromise = loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: [] })],
      abortSignal: controller.signal,
      onToolResult: async (toolResult) => { observedToolResults.push(toolResult); },
    }));
    await childStartedPromise;
    controller.abort("cancel nested model");
    const result = await resultPromise;
    assert.equal(result.status, "cancelled", result.status === "failed" ? result.error : undefined);
    assert.equal(requestCount, 2);
    const cancelled = observedToolResults.find((item) => item.callId === "parent-cancel");
    assert.equal(cancelled?.status, "cancelled");
    assert.deepEqual(cancelled?.errorFacts, { code: "sub_agent_cancelled" });
    assert.equal(result.toolResults.find((item) => item.callId === "parent-cancel")?.status, "cancelled");
  } finally {
    await loop.release();
  }
});

test("agent-tool names must not collide with a ToolCenter executor", async () => {
  const gateway = new RecordingGateway([plainTool("call_sub_agent")]);
  const fetch = scriptedFetch([]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: [] })],
    }));
    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.error : "", /tool name is duplicated: call_sub_agent/u);
    assert.equal(fetch.requests.length, 0);
  } finally {
    await loop.release();
  }
});

test("an out-of-bound agent-tool permission becomes a complete outer-model tool error without starting a child model", async () => {
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const observedToolResults: ToolCallResult[] = [];
  let parentObservedToolOutput: string | undefined;
  const fetch = scriptedFetch([
    () => chatTool("parent-outside", "call_sub_agent", { task: "try expansion" }),
    ({ body }) => {
      assert.equal(systemText(body), ROOT_SYSTEM);
      assert.match(JSON.stringify(body.messages), /outside the parent boundary: write_fact/u);
      parentObservedToolOutput = chatToolOutput(body, "parent-outside");
      return chatText("root-explained-permission-failure");
    },
  ]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["write_fact"] })],
      onToolResult: async (toolResult) => { observedToolResults.push(toolResult); },
    }));
    assert.equal(result.status, "completed", result.status === "failed" ? result.error : undefined);
    assert.equal(result.status === "completed" ? result.finalText : undefined, "root-explained-permission-failure");
    assert.equal(fetch.requests.filter((request) => systemText(request.body) === CHILD_SYSTEM).length, 0);
    assert.equal(gateway.executions.length, 0);
    const failure = observedToolResults.find((item) => item.callId === "parent-outside");
    assert.equal(failure?.status, "failed");
    assert.match(failure?.error ?? "", /error occurred while running the tool/u);
    const canonicalResult = result.messages.find((message) => message.toolCallId === "parent-outside");
    assert.equal(canonicalResult?.role, "tool");
    assert.equal((JSON.parse(canonicalResult?.content ?? "{}") as ToolCallResult).status, "failed");
    assert.equal(parentObservedToolOutput, canonicalResult?.content);
  } finally {
    await loop.release();
  }
});

test("a nested tool fact acceptance failure escapes Agent.asTool instead of continuing the parent model", async () => {
  const gateway = new RecordingGateway([plainTool("read_fact")]);
  const fetch = scriptedFetch([
    () => chatTool("parent-durable", "call_sub_agent", { task: "read one durable fact" }),
    () => chatTool("child-durable", "read_fact", { value: "fact" }),
  ]);
  const loop = createLoop({ protocol: "openai_compatible_chat_completions", baseUrl: CHAT_BASE_URL, fetch: fetch.fetch });
  try {
    const result = await loop.execute(loopInput({
      gateway,
      agentTools: [agentTool({ toolName: "call_sub_agent", allowedTools: ["read_fact"] })],
      onToolResult: async (toolResult) => {
        if (toolResult.callId === "child-durable") throw new Error("durable tool fact was rejected");
      },
    }));
    assert.equal(result.status, "failed");
    assert.match(result.status === "failed" ? result.error : "", /durable tool fact was rejected/u);
    assert.equal(fetch.requests.length, 2);
    assert.equal(result.toolResults.find((item) => item.callId === "child-durable")?.status, "completed");
    assert.equal(result.toolResults.find((item) => item.callId === "parent-durable")?.status, "failed");
    assert.equal(result.messages.find((item) => item.toolCallId === "parent-durable")?.role, "tool");
  } finally {
    await loop.release();
  }
});

test("root prompt cache identity includes agent tools independent of contribution order", () => {
  const first = agentTool({ toolName: "call_sub_agent", allowedTools: [] });
  const second = agentTool({ toolName: "spawn_sub_agent", allowedTools: [] });
  const withoutAgentTools = openAIAgentsPromptCacheKey("openai_responses", MODEL, ROOT_SYSTEM, []);
  const forward = openAIAgentsPromptCacheKey("openai_responses", MODEL, ROOT_SYSTEM, [], [first, second]);
  const reverse = openAIAgentsPromptCacheKey("openai_responses", MODEL, ROOT_SYSTEM, [], [second, first]);
  assert.notEqual(forward, withoutAgentTools);
  assert.equal(forward, reverse);
});

function agentTool(input: {
  readonly toolName: string;
  readonly allowedTools: readonly string[];
}): AgentLoopAgentTool {
  return {
    toolName: input.toolName,
    toolDescription: `Delegate through ${input.toolName}.`,
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
      additionalProperties: false,
    },
    resolve: async (value) => ({
      agentName: "test-specialist",
      instructions: CHILD_SYSTEM,
      input: `Task: ${requiredTask(value)}`,
      callerAgentId: "sub-agent:fixed",
      allowedTools: input.allowedTools,
    }),
  };
}

function requiredTask(value: ToolFactValue): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("agent tool input must be an object");
  }
  const task = (value as Readonly<Record<string, ToolFactValue | undefined>>).task;
  if (typeof task !== "string") {
    throw new Error("task must be a string");
  }
  return task;
}

function chatToolOutput(body: JsonRecord, callId: string): string | undefined {
  if (!Array.isArray(body.messages)) return undefined;
  const message = body.messages.map(parseRecord).find((item) =>
    item.role === "tool" && item.tool_call_id === callId);
  return typeof message?.content === "string" ? message.content : undefined;
}

class RecordingGateway implements ToolExecutionGateway {
  readonly executions: {
    readonly request: ToolCallRequest;
    readonly context: ToolExecutionContext;
    readonly permission: ToolPermissionCheck;
  }[] = [];

  constructor(private readonly definitions: readonly ToolDefinition[]) {}

  list(): ToolDefinition[] {
    return this.definitions.map((definition) => globalThis.structuredClone(definition));
  }

  has(name: string): boolean {
    return this.definitions.some((definition) => definition.name === name);
  }

  preflight(request: ToolCallRequest): ToolExecutionPreflight {
    const definition = this.definitions.find((item) => item.name === request.toolName);
    if (definition?.metadata?.requiresConfirmation === true) {
      return {
        status: "approval_required",
        result: {
          ...request,
          output: undefined,
          status: "approval_required",
          durationMs: 0,
          confirmationRequest: {
            confirmationId: `confirmation-${toolCallFactId(request)}`,
            toolCallFactId: toolCallFactId(request),
            title: "Confirm nested write",
            actionSummary: "Write one delegated fact.",
            affectedResources: ["nested-resource"],
            riskLevel: "medium",
            resumeAvailability: "live",
            requestedAt: "2026-07-15T00:00:00.000Z",
            sourceRefs: [`tool:${toolCallFactId(request)}`],
          },
        },
      };
    }
    return { status: "ready", request };
  }

  async execute(
    request: ToolCallRequest,
    context: ToolExecutionContext,
    permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    this.executions.push({ request, context, permission });
    return {
      ...request,
      output: `gateway:${request.toolName}`,
      status: "completed",
      durationMs: 1,
    };
  }
}

function loopInput(input: {
  readonly gateway: ToolExecutionGateway;
  readonly agentTools: readonly AgentLoopAgentTool[];
  readonly abortSignal?: AbortSignal;
  readonly onToolResult?: (result: ToolCallResult) => Promise<void>;
  readonly onToolRound?: (input: {
    readonly canonicalMessagesBeforeRound: readonly ModelMessage[];
    readonly assistantMessage: ModelMessage;
  }) => Promise<void>;
  readonly onTextDelta?: (delta: string) => void;
}) {
  const allowedTools = input.gateway.list().map((definition) => definition.name);
  return {
    instructions: ROOT_SYSTEM,
    messages: [
      { role: "system", content: ROOT_SYSTEM },
      { role: "user", content: "delegate the bounded task" },
    ] satisfies readonly ModelMessage[],
    tools: {
      gateway: input.gateway,
      context: {
        callerAgentId: "ordinary-agent",
        traceId: "trace-sub-agent",
        goalId: "goal-sub-agent",
      },
      permission: {
        callerAgentId: "ordinary-agent",
        allowedTools,
        confirmationPolicy: "prompt" as const,
      },
    },
    agentTools: input.agentTools,
    abortSignal: input.abortSignal ?? new AbortController().signal,
    onToolResult: input.onToolResult,
    onToolRound: input.onToolRound,
    onTextDelta: input.onTextDelta,
  };
}

function createLoop(config: Pick<
  OpenAIAgentsLoopConfig,
  "protocol" | "baseUrl" | "fetch" | "requestSettings"
>) {
  return createOpenAIAgentsLoop({ ...config, apiKey: "test-key", model: MODEL });
}

function plainTool(name: string): ToolDefinition {
  return {
    name,
    description: `Execute ${name}.`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    metadata: {
      category: "other",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}

function gatedTool(name: string): ToolDefinition {
  return {
    ...plainTool(name),
    metadata: {
      category: "filesystem",
      riskLevel: "medium",
      operationType: "read-write",
      requiresConfirmation: true,
    },
  };
}

function approve(confirmationId: string): ConfirmationDecision {
  return {
    confirmationId,
    decision: "approve_once",
    decidedAt: "2026-07-15T00:00:01.000Z",
  };
}

function scriptedFetch(steps: readonly ((request: CapturedFetch) => Response)[]): {
  readonly requests: CapturedFetch[];
  readonly fetch: typeof globalThis.fetch;
} {
  const remaining = [...steps];
  const requests: CapturedFetch[] = [];
  return {
    requests,
    fetch: async (requestInput, init) => {
      const request = requestInput instanceof Request ? requestInput : new Request(requestInput, init);
      const body = parseRecord(await request.clone().json());
      const captured = { url: request.url, body, signal: request.signal };
      requests.push(captured);
      const step = remaining.shift();
      if (step === undefined) {
        throw new Error(`Unexpected fetch: ${request.url}`);
      }
      return step(captured);
    },
  };
}

function toolNames(body: JsonRecord): readonly string[] {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.flatMap((value) => {
    const record = isRecord(value) ? value : {};
    const direct = typeof record.name === "string" ? record.name : undefined;
    const fn = isRecord(record.function) ? record.function : {};
    const nested = typeof fn.name === "string" ? fn.name : undefined;
    return direct ?? nested ?? [];
  });
}

function systemText(body: JsonRecord): string | undefined {
  if (typeof body.instructions === "string") {
    return body.instructions;
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find((value) => isRecord(value) && value.role === "system");
  return isRecord(system) && typeof system.content === "string" ? system.content : undefined;
}

function chatTool(callId: string, name: string, input: JsonRecord): Response {
  return chatTools([{ callId, name, input }]);
}

function chatReasoningTool(callId: string, name: string, input: JsonRecord): Response {
  return jsonResponse({
    id: "chat-" + callId,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "<think>Inspect the delegated facts.</think>",
        reasoning_content: "Choose the smallest relevant read.",
        tool_calls: [{
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function hasInvalidAssistantMessage(body: JsonRecord): boolean {
  const messages = Array.isArray(body.messages) ? body.messages.map(parseRecord) : [];
  return messages.some((message) => message.role === "assistant" &&
    !hasNonEmptyChatContent(message.content) &&
    !(Array.isArray(message.tool_calls) && message.tool_calls.length > 0));
}

function hasNonEmptyChatContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    if (!isRecord(part)) return false;
    return part.type === "text" ? typeof part.text === "string" && part.text.trim().length > 0 : true;
  });
}

function invalidAssistantMessageResponse(): Response {
  return new Response(JSON.stringify({
    error: {
      message: "Invalid assistant message: content or tool_calls must be set",
      type: "invalid_request_error",
      code: "invalid_assistant_message",
    },
  }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

function chatTools(calls: readonly { readonly callId: string; readonly name: string; readonly input: JsonRecord }[]): Response {
  return jsonResponse({
    id: `chat-${calls.map((call) => call.callId).join("-")}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: calls.map((call) => ({
          id: call.callId,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function chatText(text: string): Response {
  return chatTextWithFinishReason(text, "stop");
}

function chatTextStream(chunks: readonly string[]): Response {
  const events = [
    chatStreamChunk({ role: "assistant", content: chunks[0] ?? "" }, null),
    ...chunks.slice(1).map((content) => chatStreamChunk({ content }, null)),
    chatStreamChunk({}, "stop"),
  ];
  return eventStreamResponse(events);
}

function chatToolStream(callId: string, name: string, input: JsonRecord): Response {
  return eventStreamResponse([
    chatStreamChunk({
      role: "assistant",
      tool_calls: [{
        index: 0,
        id: callId,
        type: "function",
        function: { name, arguments: JSON.stringify(input) },
      }],
    }, null),
    chatStreamChunk({}, "tool_calls"),
  ]);
}

function chatStreamChunk(delta: JsonRecord, finishReason: string | null): JsonRecord {
  return {
    id: "chat-sub-agent-stream",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function eventStreamResponse(events: readonly JsonRecord[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function responsesTextStream(chunks: readonly string[], id: string): Response {
  const text = chunks.join("");
  const itemId = `${id}-message`;
  const message = {
    id: itemId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  return responsesEventStream([{
    type: "response.created",
    response: responsesStreamState(id, "in_progress", [], null),
  }, {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...message, status: "in_progress", content: [] },
  }, ...chunks.map((delta) => ({
    type: "response.output_text.delta",
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    delta,
  })), {
    type: "response.output_item.done",
    output_index: 0,
    item: message,
  }, {
    type: "response.completed",
    response: responsesStreamState(id, "completed", [message], {
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
    }),
  }]);
}

function responsesToolStream(callId: string, name: string, input: JsonRecord): Response {
  const id = `responses-${callId}`;
  const item = {
    id: `${id}-function-call`,
    type: "function_call",
    status: "completed",
    call_id: callId,
    name,
    arguments: JSON.stringify(input),
  };
  return responsesEventStream([{
    type: "response.created",
    response: responsesStreamState(id, "in_progress", [], null),
  }, {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...item, status: "in_progress", arguments: "" },
  }, {
    type: "response.function_call_arguments.done",
    item_id: item.id,
    output_index: 0,
    arguments: item.arguments,
  }, {
    type: "response.output_item.done",
    output_index: 0,
    item,
  }, {
    type: "response.completed",
    response: responsesStreamState(id, "completed", [item], {
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
    }),
  }]);
}

function responsesStreamState(
  id: string,
  status: "in_progress" | "completed",
  output: readonly JsonRecord[],
  usage: JsonRecord | null,
): JsonRecord {
  return {
    id,
    object: "response",
    created_at: 1,
    status,
    model: MODEL,
    output,
    usage,
  };
}

function responsesEventStream(events: readonly JsonRecord[]): Response {
  const body = `${events.map((event) =>
    `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function chatTextWithFinishReason(text: string, finishReason: string): Response {
  return jsonResponse({
    id: `chat-${text.slice(0, 20)}`,
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finishReason }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function responsesTool(callId: string, name: string, input: JsonRecord): Response {
  return responsesToolWithStatus(callId, name, input, "completed");
}

function responsesToolWithStatus(
  callId: string,
  name: string,
  input: JsonRecord,
  status: "completed" | "incomplete",
): Response {
  return jsonResponse({
    id: `response-${callId}`,
    status,
    ...(status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    output: [{
      id: `item-${callId}`,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name,
      arguments: JSON.stringify(input),
    }],
  });
}

function responsesText(text: string, id: string): Response {
  return responsesTextWithStatus(text, id, "completed");
}

function responsesTextWithStatus(
  text: string,
  id: string,
  status: "completed" | "incomplete",
): Response {
  return jsonResponse({
    id,
    status,
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    output: [{
      id: `${id}-message`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }],
    }],
  });
}

function jsonResponse(value: JsonRecord): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function parseRecord(value: unknown): JsonRecord {
  assert.equal(isRecord(value), true);
  return value as JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

async function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    throw abortError();
  }
  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
  throw abortError();
}

function abortError(): Error {
  const error = new Error("Nested model request aborted.");
  error.name = "AbortError";
  return error;
}
