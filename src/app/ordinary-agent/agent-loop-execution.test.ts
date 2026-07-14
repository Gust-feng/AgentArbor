import assert from "node:assert/strict";
import test from "node:test";
import type { ConfirmationDecision, ConfirmationRequest } from "../../domain/confirmation/index.js";
import type { ModelMessage } from "../../domain/intelligence/index.js";
import type { ToolExecutionGateway } from "../../domain/tools/index.js";
import type {
  AgentLoop,
  AgentLoopAgentTool,
  AgentLoopInput,
  AgentLoopResult,
  AgentLoopToolBoundary,
} from "../model-runtime/index.js";
import {
  createOrdinaryAgentLoopExecutionPort,
  type AcquireOrdinaryAgentLoopRunResourcesInput,
  type OrdinaryAgentLoopRunResources,
} from "./agent-loop-execution.js";
import { ordinaryCapabilityResolution, ordinaryRunBirth } from "./test-support.js";

test("completed execution maps canonical facts and releases its run resources once", async () => {
  let received: AgentLoopInput | undefined;
  const fixture = executionFixture({
    async execute(input) {
      received = input;
      return completedResult();
    },
    async release() { return undefined; },
  });
  const outcome = await fixture.execution.execute(executionInput());

  assert.deepEqual(outcome, {
    status: "completed",
    answer: "done",
    canonicalMessages: completedResult().messages,
    toolCalls: [],
    usage: {},
  });
  assert.equal(received?.instructions, ordinaryRunBirth().instructions);
  assert.equal(received?.tools, fixture.resources.tools);
  assert.equal(fixture.releaseCount(), 1);
});

test("cleanup failure cannot replace a known completed outcome", async () => {
  const cleanupError = new Error("cleanup failed");
  const observed: unknown[] = [];
  let releases = 0;
  const resources = {
    loop: {
      async execute() { return completedResult(); },
      async release() { return undefined; },
    },
    resolvedMessages: executionInput().messages,
    tools: toolBoundary(),
    async release() { releases += 1; throw cleanupError; },
  } satisfies OrdinaryAgentLoopRunResources;
  const execution = createOrdinaryAgentLoopExecutionPort({
    resources: { async acquire() { return resources; } },
    onReleaseError(error) { observed.push(error); },
  });

  const outcome = await execution.execute(executionInput());

  assert.equal(outcome.status, "completed");
  assert.equal(releases, 1);
  assert.deepEqual(observed, [cleanupError]);
});

test("failed loop result maps to Ordinary failure and releases resources", async () => {
  const fixture = executionFixture({
    async execute() {
      return {
        status: "failed",
        error: "invalid provider response",
        messages: [{ role: "user", content: "hello" }],
        toolResults: [],
        usage: {},
        confirmationRequests: [],
      };
    },
    async release() { return undefined; },
  });

  const outcome = await fixture.execution.execute(executionInput());

  assert.deepEqual(outcome.status === "failed" ? outcome.error : undefined, {
    code: "agent_loop_failed",
    message: "invalid provider response",
  });
  assert.equal(fixture.releaseCount(), 1);
});

test("approval keeps the same lease through recursive decisions and releases only at the terminal outcome", async () => {
  const firstRequest = confirmation("confirmation-1");
  const secondRequest = confirmation("confirmation-2");
  let firstDecisions = 0;
  let secondDecisions = 0;
  const fixture = executionFixture({
    async execute() {
      return approvalResult(firstRequest, {
        availability: "live_only",
        async decide() {
          firstDecisions += 1;
          return approvalResult(secondRequest, {
            availability: "live_only",
            async decide() {
              secondDecisions += 1;
              return completedResult({ inputTokens: 9, outputTokens: 2, totalTokens: 11 });
            },
          }, { inputTokens: 6, totalTokens: 6 });
        },
      }, { inputTokens: 3, totalTokens: 3 });
    },
    async release() { return undefined; },
  }, { capabilityResolution: ordinaryCapabilityResolution() });

  const first = await fixture.execution.execute(executionInput());
  assert.equal(first.status, "approval_required");
  assert.deepEqual(first.usage, { inputTokens: 3, totalTokens: 3 });
  assert.deepEqual(first.capabilityResolution, ordinaryCapabilityResolution());
  assert.equal(fixture.releaseCount(), 0);
  if (first.status !== "approval_required") return;

  const second = await first.continuation.decide({ decision: decision(firstRequest), abortSignal: new AbortController().signal });
  assert.equal(second.status, "approval_required");
  assert.deepEqual(second.usage, { inputTokens: 6, totalTokens: 6 });
  assert.deepEqual(second.capabilityResolution, ordinaryCapabilityResolution());
  assert.equal(fixture.releaseCount(), 0);
  await assert.rejects(
    first.continuation.decide({ decision: decision(firstRequest), abortSignal: new AbortController().signal }),
    /already been decided/,
  );
  assert.equal(fixture.releaseCount(), 0);
  if (second.status !== "approval_required") return;

  const terminal = await second.continuation.decide({ decision: decision(secondRequest), abortSignal: new AbortController().signal });
  assert.equal(terminal.status, "completed");
  assert.deepEqual(terminal.usage, { inputTokens: 9, outputTokens: 2, totalTokens: 11 });
  assert.deepEqual(terminal.capabilityResolution, ordinaryCapabilityResolution());
  assert.equal(firstDecisions, 1);
  assert.equal(secondDecisions, 1);
  assert.equal(fixture.releaseCount(), 1);
  await assert.rejects(
    second.continuation.decide({ decision: decision(secondRequest), abortSignal: new AbortController().signal }),
    /already been decided/,
  );
  assert.equal(fixture.releaseCount(), 1);
});

test("execution forwards live text deltas and preserves prior cumulative usage when a resumed failure omits it", async () => {
  const request = confirmation("confirmation-usage");
  const deltas: string[] = [];
  const fixture = executionFixture({
    async execute(input) {
      input.onTextDelta?.("first");
      return approvalResult(request, {
        availability: "live_only",
        async decide() {
          input.onTextDelta?.(" resumed");
          return {
            status: "failed",
            error: "provider disconnected",
            messages: input.messages,
            toolResults: [],
            usage: {},
            confirmationRequests: [],
          };
        },
      }, { inputTokens: 5, cachedInputTokens: 2, totalTokens: 5 });
    },
    async release() { return undefined; },
  });

  const paused = await fixture.execution.execute({ ...executionInput(), onTextDelta: (delta) => deltas.push(delta) });
  assert.equal(paused.status, "approval_required");
  if (paused.status !== "approval_required") return;
  const failed = await paused.continuation.decide({ decision: decision(request), abortSignal: new AbortController().signal });

  assert.deepEqual(deltas, ["first", " resumed"]);
  assert.deepEqual(failed.usage, { inputTokens: 5, cachedInputTokens: 2, totalTokens: 5 });
});

test("discarding an approval continuation releases its lease idempotently", async () => {
  const request = confirmation("confirmation-release");
  const fixture = executionFixture({
    async execute() {
      return approvalResult(request, {
        availability: "live_only",
        async decide() { throw new Error("must not decide"); },
      });
    },
    async release() { return undefined; },
  });
  const outcome = await fixture.execution.execute(executionInput());
  assert.equal(outcome.status, "approval_required");
  if (outcome.status !== "approval_required") return;

  await outcome.continuation.release();
  await outcome.continuation.release();
  assert.equal(fixture.releaseCount(), 1);
  await assert.rejects(
    outcome.continuation.decide({ decision: decision(request), abortSignal: new AbortController().signal }),
    /already been decided/,
  );
});

test("cancellation signal reaches the loop and cancelled execution releases resources", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  let markEntered: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const fixture = executionFixture({
    execute(input) {
      observedSignal = input.abortSignal;
      markEntered?.();
      return new Promise<AgentLoopResult>((resolve) => {
        input.abortSignal.addEventListener("abort", () => resolve({
          status: "cancelled",
          error: String(input.abortSignal.reason),
          messages: input.messages,
          toolResults: [],
          usage: {},
          confirmationRequests: [],
        }), { once: true });
      });
    },
    async release() { return undefined; },
  });

  const pending = fixture.execution.execute(executionInput(controller.signal));
  await entered;
  controller.abort("ordinary_feature_released");
  const outcome = await pending;

  assert.equal(observedSignal, controller.signal);
  assert.deepEqual(outcome.status === "cancelled" ? outcome.reason : undefined, "ordinary_feature_released");
  assert.equal(fixture.releaseCount(), 1);
});

test("loop exceptions release resources and preserve the original failure", async () => {
  const failure = new Error("provider disconnected");
  const fixture = executionFixture({
    async execute() { throw failure; },
    async release() { return undefined; },
  });

  await assert.rejects(fixture.execution.execute(executionInput()), (error: unknown) => error === failure);
  assert.equal(fixture.releaseCount(), 1);
});

test("the acquirer may reattach ephemeral inputs and contribute native agent tools", async () => {
  const persistedMessages: readonly ModelMessage[] = [{ role: "user", content: "inspect image" }];
  const resolvedMessages: readonly ModelMessage[] = [{
    ...persistedMessages[0]!,
    attachments: [{
      kind: "image",
      attachmentId: "image-1",
      source: { kind: "data", mimeType: "image/png", data: "cG5n" },
    }],
  }];
  const agentTool: AgentLoopAgentTool = {
    toolName: "call_reviewer",
    toolDescription: "Delegate review.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async resolve() {
      return {
        agentName: "reviewer",
        instructions: "Review the work.",
        input: "Review it.",
        callerAgentId: "ordinary-agent",
        allowedTools: [],
      };
    },
  };
  let acquiredInput: AcquireOrdinaryAgentLoopRunResourcesInput | undefined;
  let loopInput: AgentLoopInput | undefined;
  const fixture = executionFixture({
    async execute(input) { loopInput = input; return completedResult(); },
    async release() { return undefined; },
  }, {
    resolvedMessages,
    agentTools: [agentTool],
    onAcquire(input) { acquiredInput = input; },
  });

  const runInput = {
    userMessage: "inspect image",
    taskSoil: {
      contextRefs: [{ attachmentId: "image-1", ref: "file:image.png", kind: "file" as const, title: "image.png" }],
      permissionBoundaryRefs: ["read:file:image.png"],
    },
  };
  await fixture.execution.execute({ ...executionInput(), runInput, messages: persistedMessages });

  assert.equal(acquiredInput?.messages, persistedMessages);
  assert.equal(acquiredInput?.runInput, runInput);
  assert.equal(loopInput?.messages, resolvedMessages);
  assert.equal(loopInput?.messages[0]?.attachments?.[0]?.attachmentId, "image-1");
  assert.equal(loopInput?.agentTools?.[0], agentTool);
});

function executionFixture(
  loop: AgentLoop,
  options: {
    readonly resolvedMessages?: readonly ModelMessage[];
    readonly agentTools?: readonly AgentLoopAgentTool[];
    readonly capabilityResolution?: OrdinaryAgentLoopRunResources["capabilityResolution"];
    readonly onAcquire?: (input: AcquireOrdinaryAgentLoopRunResourcesInput) => void;
  } = {},
) {
  let releases = 0;
  const resources: OrdinaryAgentLoopRunResources = {
    loop,
    resolvedMessages: options.resolvedMessages ?? executionInput().messages,
    tools: toolBoundary(),
    ...(options.agentTools === undefined ? {} : { agentTools: options.agentTools }),
    ...(options.capabilityResolution === undefined ? {} : { capabilityResolution: options.capabilityResolution }),
    async release() { releases += 1; },
  };
  return {
    resources,
    execution: createOrdinaryAgentLoopExecutionPort({
      resources: {
        async acquire(input) {
          options.onAcquire?.(input);
          return resources;
        },
      },
    }),
    releaseCount: () => releases,
  };
}

function executionInput(abortSignal = new AbortController().signal) {
  return {
    runId: "run-1",
    birth: ordinaryRunBirth(),
    runInput: { userMessage: "hello" },
    messages: [{ role: "user", content: "hello" }] satisfies readonly ModelMessage[],
    abortSignal,
  };
}

function completedResult(usage: Extract<AgentLoopResult, { readonly status: "completed" }>["usage"] = {}): Extract<AgentLoopResult, { readonly status: "completed" }> {
  return {
    status: "completed",
    finalText: "done",
    messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "done" }],
    toolResults: [],
    usage,
    confirmationRequests: [],
  };
}

function approvalResult(
  request: ConfirmationRequest,
  continuation: Extract<AgentLoopResult, { readonly status: "approval_required" }>["continuation"],
  usage: Extract<AgentLoopResult, { readonly status: "approval_required" }>["usage"] = {},
): Extract<AgentLoopResult, { readonly status: "approval_required" }> {
  return {
    status: "approval_required",
    messages: [{ role: "user", content: "hello" }],
    toolResults: [],
    usage,
    confirmationRequests: [request],
    continuation,
  };
}

function confirmation(confirmationId: string): ConfirmationRequest {
  return {
    confirmationId,
    runId: "run-1",
    title: "Confirm",
    actionSummary: "Run tool",
    affectedResources: ["workspace"],
    riskLevel: "medium",
    requestedAt: "2026-01-01T00:00:00.000Z",
    sourceRefs: [],
  };
}

function decision(request: ConfirmationRequest): ConfirmationDecision {
  return {
    confirmationId: request.confirmationId,
    runId: request.runId,
    decision: "approve_once",
    decidedAt: "2026-01-01T00:00:01.000Z",
  };
}

function toolBoundary(): AgentLoopToolBoundary {
  const gateway: ToolExecutionGateway = {
    list: () => [],
    has: () => false,
    preflight: (request) => ({ status: "ready", request }),
    async execute(request) {
      return {
        ...request,
        output: undefined,
        status: "completed",
        durationMs: 0,
      };
    },
  };
  return {
    gateway,
    context: { callerAgentId: "ordinary-agent", traceId: "trace-1", goalId: "run-1" },
    permission: { callerAgentId: "ordinary-agent", allowedTools: [] },
  };
}
