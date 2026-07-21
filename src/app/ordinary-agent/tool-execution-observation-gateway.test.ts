import assert from "node:assert/strict";
import test from "node:test";
import type {
  ToolCallRequest,
  ToolExecutionGateway,
  ToolExecutionMetricEvent,
} from "../../domain/tools/index.js";
import { ToolExecutionObservationGateway } from "./tool-execution-observation-gateway.js";

test("tool execution observation records concurrency without serializing the inner gateway", async () => {
  const events: ToolExecutionMetricEvent[] = [];
  let active = 0;
  let maxActive = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let bothStarted!: () => void;
  const started = new Promise<void>((resolve) => { bothStarted = resolve; });
  const definition = {
    name: "read_file",
    description: "Read a file.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
    metadata: {
      category: "workspace" as const,
      riskLevel: "low" as const,
      operationType: "read-only" as const,
      requiresConfirmation: false,
    },
  };
  const inner: ToolExecutionGateway = {
    list: () => [definition],
    has: (name) => name === definition.name,
    preflight: (request) => ({ status: "ready", request }),
    async execute(request) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 2) bothStarted();
      await released;
      active -= 1;
      return { ...request, output: "done", status: "completed", durationMs: 1 };
    },
  };
  const observed = new ToolExecutionObservationGateway(inner, { record: (event) => { events.push(event); } });
  const request = (callId: string): ToolCallRequest => ({ callId, toolName: "read_file", input: {} });
  const context = { callerAgentId: "ordinary", traceId: "run-1", goalId: "run-1", toolCallId: "call" };
  const permission = { callerAgentId: "ordinary", allowedTools: ["read_file"] };

  const first = observed.execute(request("call-1"), context, permission);
  const second = observed.execute(request("call-2"), context, permission);
  await started;
  release();
  await Promise.all([first, second]);

  assert.equal(maxActive, 2);
  assert.deepEqual(events.map((event) => event.kind), ["scheduling", "scheduling"]);
  assert.equal(events.every((event) => event.kind !== "scheduling" || event.queueWaitMs === 0), true);
  assert.equal(events.some((event) => event.kind === "scheduling" && event.activeCount === 2), true);
});
