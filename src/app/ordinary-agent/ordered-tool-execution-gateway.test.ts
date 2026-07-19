import assert from "node:assert/strict";
import test from "node:test";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionGateway,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import { OrderedToolExecutionGateway } from "./ordered-tool-execution-gateway.js";

const context: ToolExecutionContext = { callerAgentId: "ordinary", traceId: "run-1", goalId: "run-1" };
const permission: ToolPermissionCheck = { callerAgentId: "ordinary", allowedTools: ["read_a", "read_b", "write"] };

test("OrderedToolExecutionGateway runs consecutive reads in parallel", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const started: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    started.push(request.callId);
    await (request.callId === "r1" ? first.promise : second.promise);
    return completed(request);
  }));

  const one = gateway.execute(call("r1", "read_a"), context, permission);
  const two = gateway.execute(call("r2", "read_b"), context, permission);
  await eventually(() => started.length === 2);
  assert.deepEqual(started, ["r1", "r2"]);
  first.resolve(undefined);
  second.resolve(undefined);
  await Promise.all([one, two]);
});

test("OrderedToolExecutionGateway keeps writes exclusive and blocks later reads", async () => {
  const writeDone = deferred<void>();
  const order: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    order.push(`start:${request.callId}`);
    if (request.callId === "w1") await writeDone.promise;
    order.push(`end:${request.callId}`);
    return completed(request);
  }));

  const write = gateway.execute(call("w1", "write"), context, permission);
  const read = gateway.execute(call("r1", "read_a"), context, permission);
  await eventually(() => order.includes("start:w1"));
  assert.deepEqual(order, ["start:w1"]);
  writeDone.resolve(undefined);
  await Promise.all([write, read]);
  assert.deepEqual(order, ["start:w1", "end:w1", "start:r1", "end:r1"]);
});

test("OrderedToolExecutionGateway cancels queued calls without entering the executor", async () => {
  const writeDone = deferred<void>();
  const executed: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    executed.push(request.callId);
    if (request.callId === "w1") await writeDone.promise;
    return completed(request);
  }));
  const abort = new AbortController();
  const write = gateway.execute(call("w1", "write"), context, permission);
  const queued = gateway.execute(call("w2", "write"), { ...context, abortSignal: abort.signal }, permission);
  abort.abort("cancel queued write");
  writeDone.resolve(undefined);

  const result = await queued;
  await write;
  assert.equal(result.status, "cancelled");
  assert.equal(result.errorFacts?.code, "tool_cancelled_while_queued");
  assert.deepEqual(executed, ["w1"]);
});

test("OrderedToolExecutionGateway preserves registered provider order when execute callbacks arrive in reverse", async () => {
  const firstDone = deferred<void>();
  const order: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    order.push(`start:${request.callId}`);
    if (request.callId === "w1") await firstDone.promise;
    order.push(`end:${request.callId}`);
    return completed(request);
  }));
  const firstCall = call("w1", "write");
  const secondCall = call("w2", "write");
  gateway.registerToolRound([firstCall, secondCall]);
  gateway.preflight(secondCall, context, permission);
  gateway.preflight(firstCall, context, permission);

  const second = gateway.execute(secondCall, context, permission);
  const first = gateway.execute(firstCall, context, permission);
  await eventually(() => order.includes("start:w1"));
  assert.deepEqual(order, ["start:w1"]);
  firstDone.resolve(undefined);
  await Promise.all([first, second]);
  assert.deepEqual(order, ["start:w1", "end:w1", "start:w2", "end:w2"]);
});

test("OrderedToolExecutionGateway skips approval pauses and admits approved calls as new requests", async () => {
  const executed: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(
    async (request) => {
      executed.push(request.callId);
      return completed(request);
    },
    (request) => request.callId === "w1"
      ? {
          status: "approval_required",
          result: {
            ...request,
            output: undefined,
            status: "approval_required",
            durationMs: 0,
            confirmationRequest: {
              confirmationId: "confirm-w1",
              toolCallFactId: request.callId,
              title: "Confirm",
              actionSummary: "Write",
              affectedResources: [],
              riskLevel: "medium",
              resumeAvailability: "live",
              requestedAt: "2026-01-01T00:00:00.000Z",
              sourceRefs: [],
            },
          },
        }
      : { status: "ready", request },
  ));
  const approval = call("w1", "write");
  const following = call("w2", "write");
  gateway.registerToolRound([approval, following]);
  gateway.preflight(approval, context, permission);
  gateway.preflight(following, context, permission);

  await gateway.execute(following, context, permission);
  await gateway.execute(approval, context, permission);
  assert.deepEqual(executed, ["w2", "w1"]);
});

test("OrderedToolExecutionGateway admits a large registered batch without a count budget", async () => {
  const executed: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    executed.push(request.callId);
    return completed(request);
  }));
  const calls = Array.from({ length: 128 }, (_, index) => call(`r${index}`, "read_a"));
  gateway.registerToolRound(calls);
  calls.forEach((request) => gateway.preflight(request, context, permission));
  await Promise.all([...calls].reverse().map((request) => gateway.execute(request, context, permission)));
  assert.equal(executed.length, calls.length);
  assert.deepEqual(new Set(executed), new Set(calls.map((request) => request.callId)));
});

test("OrderedToolExecutionGateway close is idempotent, drains in-flight work, and rejects new starts", async () => {
  const inFlightDone = deferred<void>();
  const executed: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    executed.push(request.callId);
    await inFlightDone.promise;
    return completed(request);
  }));
  const running = gateway.execute(call("w1", "write"), context, permission);
  await eventually(() => executed.length === 1);
  const firstClose = gateway.close();
  const secondClose = gateway.close();
  assert.equal(firstClose, secondClose);
  assert.equal((await gateway.execute(call("w2", "write"), context, permission)).status, "cancelled");
  let closed = false;
  void firstClose.then(() => { closed = true; });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(closed, false);
  inFlightDone.resolve(undefined);
  await Promise.all([running, firstClose]);
  assert.equal(closed, true);
  assert.deepEqual(executed, ["w1"]);
});

test("OrderedToolExecutionGateway cancels a registered callback before its earlier provider call arrives", async () => {
  const executed: string[] = [];
  const gateway = new OrderedToolExecutionGateway(fakeGateway(async (request) => {
    executed.push(request.callId);
    return completed(request);
  }));
  const first = call("w1", "write");
  const second = call("w2", "write");
  gateway.registerToolRound([first, second]);
  gateway.preflight(first, context, permission);
  gateway.preflight(second, context, permission);
  const abort = new AbortController();
  const cancelled = gateway.execute(second, { ...context, abortSignal: abort.signal }, permission);
  abort.abort("cancel registered write");

  const cancelledResult = await cancelled;
  await gateway.execute(first, context, permission);
  assert.equal(cancelledResult.status, "cancelled");
  assert.deepEqual(executed, ["w1"]);
});

function fakeGateway(
  execute: ToolExecutionGateway["execute"],
  preflight: ToolExecutionGateway["preflight"] = (request) => ({ status: "ready", request }),
): ToolExecutionGateway {
  const definitions = [definition("read_a", "read-only"), definition("read_b", "read-only"), definition("write", "read-write")];
  return {
    list: () => definitions,
    has: (name) => definitions.some((item) => item.name === name),
    preflight,
    execute,
  };
}

function definition(name: string, operationType: "read-only" | "read-write"): ToolDefinition {
  return {
    name,
    description: `${name} fixture`,
    inputSchema: { type: "object", properties: {} },
    metadata: { category: "other", riskLevel: "low", operationType, requiresConfirmation: false },
  };
}

function call(callId: string, toolName: string): ToolCallRequest {
  return { callId, toolName, input: {} };
}

function completed(request: ToolCallRequest): ToolCallResult {
  return { ...request, output: { ok: true }, status: "completed", durationMs: 0 };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function eventually(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("condition was not observed");
}
