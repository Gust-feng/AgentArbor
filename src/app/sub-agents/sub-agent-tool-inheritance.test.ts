import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CapabilitySubAgentCatalogItem } from "../../domain/config/index.js";
import type { IntelligenceChannel, ModelRequest, ModelResponse } from "../../domain/intelligence/index.js";
import type { SubAgentRunTrace } from "../../domain/sub-agents/contracts.js";
import type { ToolExecutor } from "../../domain/tools/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { nowIso } from "../../kernel/id.js";
import { pendingModelOutputValidation } from "../../kernel/intelligence/validation.js";
import { ToolCenter } from "../tool-center/tool-center.js";
import { SubAgentRegistry, type SubAgentDefinition } from "./sub-agent-registry.js";
import { InMemorySubAgentRunTraceStore } from "./sub-agent-trace-store.js";
import { createSubAgentToolExecutors } from "./sub-agent-tools.js";
import { runSubAgent, SUB_AGENT_DEFAULT_MAX_STEPS } from "./sub-agent-runner.js";

test("runSubAgent inherits parent allowed tools and hides sub-agent recursion tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-test", "call-read", "read_file", { path: "README.md" }),
    textResponse("model-request-final", "read completed"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));
  center.register(testTool("spawn_sub_agent", async () => ({ should_not_run: true })));

  const result = await runSubAgent({
    subAgent: testSubAgent({ allowedTools: [] }),
    task: "read a file",
    toolBroker: center,
    channel,
    allowedTools: ["read_file", "spawn_sub_agent"],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["read_file"]);
});

test("runSubAgent intersects declared sub-agent tools with parent tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "done"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));
  center.register(testTool("shell_command", async () => ({ summary: "ran" }), "execute", true));
  center.register(testTool("spawn_sub_agent", async () => ({ should_not_run: true })));

  const result = await runSubAgent({
    subAgent: testSubAgent({ allowedTools: ["read_file", "spawn_sub_agent"] }),
    task: "use only declared tools",
    toolBroker: center,
    channel,
    allowedTools: ["read_file", "shell_command", "spawn_sub_agent"],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["read_file"]);
});

test("runSubAgent policy overrides cannot reopen sub-agent recursion tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "done"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));
  center.register(testTool("spawn_sub_agent", async () => ({ should_not_run: true })));

  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "do not recurse",
    toolBroker: center,
    channel,
    allowedTools: ["read_file"],
    policyOverrides: {
      allowedTools: ["read_file", "spawn_sub_agent"],
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["read_file"]);
});

test("runSubAgent uses the documented lightweight default step budget", async () => {
  assert.equal(SUB_AGENT_DEFAULT_MAX_STEPS, 30);
});

test("builtin sub-agent step budgets stay tool-sized", async () => {
  const registry = new SubAgentRegistry({
    roots: [{
      rootPath: path.join(process.cwd(), "src", "app", "sub-agents", "builtin"),
      sourceKind: "builtin",
      sourceRootId: "builtin",
      precedence: 1,
    }],
  });
  const subAgents = await registry.list();

  assert.deepEqual(
    Object.fromEntries(subAgents.map((subAgent) => [subAgent.name, subAgent.maxSteps])),
    {
      "code-expert": 50,
      "doc-expert": 30,
      "research-expert": 40,
      "review-expert": 30,
      "test-expert": 40,
    },
  );
});

test("runSubAgent sends instructions as system and the delegated task as user input", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-test", "task completed"),
  ]);
  const center = new ToolCenter();

  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "generate three ideas",
    context: "Use today's schedule.",
    toolBroker: center,
    channel,
    allowedTools: [],
  });

  assert.equal(result.status, "completed");

  const messages = channel.requests[0]?.sanitizedMessages ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
  assert.match(messages[0]?.content ?? "", /你是「test-helper」专家/);
  assert.doesNotMatch(messages[0]?.content ?? "", /generate three ideas/);
  assert.match(messages[1]?.content ?? "", /## 任务描述/);
  assert.match(messages[1]?.content ?? "", /generate three ideas/);
  assert.match(messages[1]?.content ?? "", /## 额外上下文/);
  assert.match(messages[1]?.content ?? "", /Use today's schedule\./);
  assert.equal(result.trace?.subRunId, result.runId);
  assert.equal(result.trace?.modelExchanges[0]?.messages[0]?.role, "system");
  assert.match(result.trace?.modelExchanges[0]?.messages[1]?.content ?? "", /generate three ideas/);
  assert.equal(result.trace?.modelExchanges[0]?.textOutput, "task completed");
});

test("runSubAgent trace captures model tool calls and failed responses", async () => {
  const failedChannel = new SequenceIntelligenceChannel([
    failedResponse("model-request-failed", "upstream unavailable"),
  ]);
  const failed = await runSubAgent({
    subAgent: testSubAgent(),
    task: "fail",
    toolBroker: new ToolCenter(),
    channel: failedChannel,
    allowedTools: [],
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.trace?.modelExchanges[0]?.failureMessage, "upstream unavailable");

  const toolChannel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-tool", "call-read", "read_file", { path: "README.md" }),
    textResponse("model-request-final", "read completed"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));

  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "read",
    toolBroker: center,
    channel: toolChannel,
    allowedTools: ["read_file"],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.trace?.modelExchanges[0]?.toolCalls[0]?.toolName, "read_file");
  assert.equal(result.trace?.toolTraces[0]?.toolName, "read_file");
  assert.equal(result.trace?.toolTraces[0]?.status, "completed");
});

test("runSubAgent preserves long output separately from display summary", async () => {
  const sentinel = "TAIL_SENTINEL_FULL_OUTPUT";
  const fullOutput = `${"0123456789".repeat(80)}${sentinel}`;
  const result = await runSubAgent({
    subAgent: testSubAgent(),
    task: "produce a long result",
    toolBroker: new ToolCenter(),
    channel: new SequenceIntelligenceChannel([
      textResponse("model-request-long", fullOutput),
    ]),
    allowedTools: [],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.fullOutput, fullOutput);
  assert.equal(result.trace?.fullOutput, fullOutput);
  assert.match(result.summary, /^子 Agent 已完成，完整输出 \d+ 字。$/);
  assert.equal(result.summary.includes(sentinel), false);
});

test("runSubAgent fails closed when SUB_AGENT.md hash drifts after discovery", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "agentarbor-sub-agent-hash-"));
  const packageDir = path.join(root, "test-helper");
  mkdirSync(packageDir);
  const sourcePath = path.join(packageDir, "SUB_AGENT.md");
  writeTestSubAgentFile(sourcePath, "You are the original helper.");

  const registry = new SubAgentRegistry({ roots: [root] });
  const subAgent = await registry.getByName("test-helper");
  assert.ok(subAgent);

  writeTestSubAgentFile(sourcePath, "You are the changed helper.");
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-should-not-run", "should not run"),
  ]);

  const result = await runSubAgent({
    subAgent,
    task: "use the helper",
    toolBroker: new ToolCenter(),
    channel,
    allowedTools: [],
  });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /Sub-agent definition hash does not match/);
  assert.match(result.error ?? "", /Refusing to execute changed SUB_AGENT\.md content/);
  assert.equal(channel.requests.length, 0);
});

test("frozen SubAgentRegistry only exposes sub-agents from the run birth catalog", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "agentarbor-frozen-sub-agent-catalog-"));
  const packageDir = path.join(root, "test-helper");
  mkdirSync(packageDir);
  writeTestSubAgentFile(path.join(packageDir, "SUB_AGENT.md"), "You are the original helper.");

  const discoveredRegistry = new SubAgentRegistry({ roots: [root] });
  const original = await discoveredRegistry.getByName("test-helper");
  assert.ok(original);
  const frozenCatalog = [capabilitySubAgentCatalogItem(original)];

  const latePackageDir = path.join(root, "late-helper");
  mkdirSync(latePackageDir);
  writeTestSubAgentFile(path.join(latePackageDir, "SUB_AGENT.md"), "You are a late helper.", "late-helper");

  const frozenRegistry = new SubAgentRegistry({ roots: [root], catalog: frozenCatalog });

  assert.equal((await frozenRegistry.getByName("late-helper")), undefined);
  assert.equal((await frozenRegistry.getByName("test-helper"))?.contentHash, original.contentHash);
});

test("frozen SubAgentRegistry preserves hash expectations when a cataloged file changes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "agentarbor-frozen-sub-agent-hash-"));
  const packageDir = path.join(root, "test-helper");
  mkdirSync(packageDir);
  const sourcePath = path.join(packageDir, "SUB_AGENT.md");
  writeTestSubAgentFile(sourcePath, "You are the original helper.");

  const discoveredRegistry = new SubAgentRegistry({ roots: [root] });
  const original = await discoveredRegistry.getByName("test-helper");
  assert.ok(original);
  const frozenCatalog = [capabilitySubAgentCatalogItem(original)];

  writeTestSubAgentFile(sourcePath, "You are the changed helper.");
  const frozenRegistry = new SubAgentRegistry({ roots: [root], catalog: frozenCatalog });
  const frozen = await frozenRegistry.getByName("test-helper");
  assert.ok(frozen);

  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-should-not-run", "should not run"),
  ]);
  const result = await runSubAgent({
    subAgent: frozen,
    task: "use the helper",
    toolBroker: new ToolCenter(),
    channel,
    allowedTools: [],
  });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /Sub-agent definition hash does not match/);
  assert.equal(channel.requests.length, 0);
});

test("call_sub_agent projection exposes full output to parent model continuation", async () => {
  const sentinel = "PARENT_VISIBLE_TAIL_SENTINEL";
  const fullOutput = `${"abcdef".repeat(120)}${sentinel}`;
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-sub-agent", fullOutput),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent"],
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-parent-sub-agent",
      toolName: "call_sub_agent",
      input: { sub_agent_name: "test-helper", task: "return long output" },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agent"] }
  );

  const output = result.output as {
    readonly result?: { readonly full_output?: string };
    readonly summary?: string;
  };
  assert.equal(result.status, "completed");
  assert.equal(output.result?.full_output, fullOutput);
  assert.equal(output.summary?.includes(sentinel), false);
});

test("read_sub_agent_output reads current-run sub-agent output slices", async () => {
  const fullOutput = "0123456789".repeat(40);
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-sub-agent", fullOutput),
  ]);
  const center = new ToolCenter();
  const traces = new InMemorySubAgentRunTraceStore();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent", "read_sub_agent_output"],
    traceSink: traces,
  })) {
    center.register(executor);
  }

  const subAgentResult = await center.execute(
    {
      callId: "call-parent-sub-agent",
      toolName: "call_sub_agent",
      input: { sub_agent_name: "test-helper", task: "return output" },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agent"] }
  );
  const subAgentOutput = subAgentResult.output as {
    readonly result?: {
      readonly run_id?: string;
      readonly full_output_ref?: string;
      readonly continuation?: { readonly nextInput?: { readonly sub_run_id?: string } };
    };
  };
  const subRunId = subAgentOutput.result?.run_id;
  assert.equal(subAgentResult.status, "completed");
  assert.ok(subRunId);
  assert.equal(subAgentOutput.result?.full_output_ref, `sub-agent-output:${subRunId}`);
  assert.equal(subAgentOutput.result?.continuation?.nextInput?.sub_run_id, subRunId);
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name) ?? [], []);

  const readResult = await center.execute(
    {
      callId: "read-sub-agent-output",
      toolName: "read_sub_agent_output",
      input: { sub_run_id: subRunId, start_char: 10, max_chars: 25 },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["read_sub_agent_output"] }
  );
  const readOutput = readResult.output as {
    readonly result?: {
      readonly content?: string;
      readonly start_char?: number;
      readonly end_char?: number;
      readonly total_chars?: number;
      readonly has_more_after?: boolean;
      readonly continuation?: { readonly nextInput?: { readonly start_char?: number } };
    };
  };

  assert.equal(readResult.status, "completed");
  assert.equal(readOutput.result?.content, fullOutput.slice(10, 35));
  assert.equal(readOutput.result?.start_char, 10);
  assert.equal(readOutput.result?.end_char, 35);
  assert.equal(readOutput.result?.total_chars, fullOutput.length);
  assert.equal(readOutput.result?.has_more_after, true);
  assert.equal(readOutput.result?.continuation?.nextInput?.start_char, 35);

  const crossRunRead = await center.execute(
    {
      callId: "read-cross-run-sub-agent-output",
      toolName: "read_sub_agent_output",
      input: { sub_run_id: subRunId },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "other-goal" },
    { callerAgentId: "agent-test", allowedTools: ["read_sub_agent_output"] }
  );

  assert.equal(crossRunRead.status, "failed");
  assert.match(crossRunRead.error ?? "", /does not belong to the current run/);
});

test("sub-agent tool approval bubbles as the parent tool pending confirmation and resumes after approve", async () => {
  let shellRuns = 0;
  const eventLog = new InMemoryEventLog();
  const traces = new InMemorySubAgentRunTraceStore();
  const channel = new SequenceIntelligenceChannel([
    toolCallResponse("model-request-child", "call-shell", "shell_command", { commandLine: "pnpm test" }),
    textResponse("model-request-child-final", "shell finished"),
  ]);
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => {
    shellRuns += 1;
    return { summary: "shell executed" };
  }, "execute", true));
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent", "shell_command"],
    confirmationPolicy: () => "prompt",
    publishToolEvent: (message) => eventLog.append(message),
    traceSink: traces,
    includeSpawnTool: true,
    eventLog,
  })) {
    center.register(executor);
  }

  const request = {
    callId: "call-parent-sub-agent",
    toolName: "call_sub_agent",
    input: {
      sub_agent_name: "test-helper",
      task: "run shell",
    },
  };
  const context = {
    callerAgentId: "agent-test",
    traceId: "trace-test",
    goalId: "goal-test",
  };

  const paused = await center.execute(request, context, {
    callerAgentId: "agent-test",
    allowedTools: ["call_sub_agent", "shell_command"],
    confirmationPolicy: "prompt",
  });

  assert.equal(paused.status, "approval_required");
  assert.equal(paused.callId, "call-parent-sub-agent");
  assert.equal(paused.toolName, "call_sub_agent");
  assert.equal(paused.confirmationRequest?.confirmationId, "confirmation-call-shell");
  assert.equal(paused.confirmationRequest?.title, "Shell 命令");
  assert.deepEqual(paused.confirmationRequest?.affectedResources, ["pnpm test"]);
  assert.equal(shellRuns, 0);
  assert.equal(eventLog.types().includes("user_approval.requested"), true);
  assert.equal(traces.list().length, 1);
  assert.equal(traces.list()[0]?.status, "approval_required");
  assert.equal(traces.list()[0]?.toolTraces[0]?.status, "approval_required");

  const resumed = await center.execute(request, context, {
    callerAgentId: "agent-test",
    allowedTools: ["call_sub_agent", "shell_command"],
    approvedConfirmationIds: ["confirmation-call-shell"],
    confirmationPolicy: "prompt",
  });

  assert.equal(resumed.status, "completed");
  assert.equal(shellRuns, 1);
  assert.equal((resumed.output as { readonly status?: string }).status, "completed");
  assert.equal(channel.requests.length, 2);
  const mergedTrace = traces.list()[0];
  assert.equal(traces.list().length, 1);
  assert.equal(mergedTrace?.status, "completed");
  assert.equal(mergedTrace?.modelExchanges.length, 2);
  assert.equal(mergedTrace?.toolTraces.length, 1);
  assert.equal(mergedTrace?.toolTraces[0]?.status, "completed");
});

test("call_sub_agent and batch calls link traces to parent tool calls and batch ids", async () => {
  const collected: SubAgentRunTrace[] = [];
  const traces = {
    upsert(trace: SubAgentRunTrace) {
      collected.push(trace);
    },
  };
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-one", "one done"),
    textResponse("model-request-two", "two done"),
    textResponse("model-request-three", "three done"),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agent", "call_sub_agents"],
    traceSink: traces,
  })) {
    center.register(executor);
  }

  await center.execute(
    {
      callId: "call-single-parent",
      toolName: "call_sub_agent",
      input: { sub_agent_name: "test-helper", task: "single" },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agent"] }
  );
  await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
        ],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agents"] }
  );

  const singleTrace = collected.find((trace) => trace.parentToolCallId === "call-single-parent");
  const batchTraces = collected
    .filter((trace) => trace.parentToolCallId === "call-batch-parent")
    .sort((left, right) => (left.batchIndex ?? -1) - (right.batchIndex ?? -1));

  assert.ok(singleTrace);
  assert.equal(batchTraces.length, 2);
  assert.equal(batchTraces[0]?.batchIndex, 0);
  assert.equal(batchTraces[1]?.batchIndex, 1);
  assert.equal(batchTraces[0]?.batchId, batchTraces[1]?.batchId);
});

test("call_sub_agents honors max_concurrency and preserves result order", async () => {
  const channel = new ConcurrentIntelligenceChannel(2);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agents"],
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
          { sub_agent_name: "test-helper", task: "third" },
        ],
        max_concurrency: 2,
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["call_sub_agents"] }
  );

  const output = result.output as {
    readonly result?: {
      readonly results?: readonly { readonly index?: number }[];
      readonly stats?: { readonly max_concurrency?: number };
    };
  };
  assert.equal(result.status, "completed");
  assert.equal(channel.maxActive, 2);
  assert.equal(output.result?.stats?.max_concurrency, 2);
  assert.deepEqual(output.result?.results?.map((item) => item.index), [0, 1, 2]);
});

test("call_sub_agents records pending and not-started batch stats when approval pauses execution", async () => {
  const eventLog = new InMemoryEventLog();
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-one", "one done"),
    toolCallResponse("model-request-two", "call-shell", "shell_command", { commandLine: "pnpm test" }),
    textResponse("model-request-two-final", "two done"),
  ]);
  const center = new ToolCenter({ platform: "win32" });
  center.register(testTool("shell_command", async () => ({ summary: "shell executed" }), "execute", true));
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["call_sub_agents", "shell_command"],
    confirmationPolicy: () => "prompt",
    includeSpawnTool: true,
    eventLog,
  })) {
    center.register(executor);
  }

  const paused = await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
          { sub_agent_name: "test-helper", task: "third" },
        ],
        max_concurrency: 1,
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    {
      callerAgentId: "agent-test",
      allowedTools: ["call_sub_agents", "shell_command"],
      confirmationPolicy: "prompt",
    }
  );

  assert.equal(paused.status, "approval_required");
  const batchCompleted = eventLog.list().find((entry) => entry.type === "sub_agent_batch.completed");
  const payload = batchCompleted?.message.payload as {
    readonly successCount?: number;
    readonly failedCount?: number;
    readonly approvalRequiredCount?: number;
    readonly notStartedCount?: number;
    readonly results?: readonly { readonly status: string }[];
  } | undefined;
  assert.equal(payload?.successCount, 1);
  assert.equal(payload?.failedCount, 0);
  assert.equal(payload?.approvalRequiredCount, 1);
  assert.equal(payload?.notStartedCount, 1);
  assert.deepEqual(payload?.results?.map((result) => result.status), ["completed", "approval_required"]);

  const resumed = await center.execute(
    {
      callId: "call-batch-parent",
      toolName: "call_sub_agents",
      input: {
        tasks: [
          { sub_agent_name: "test-helper", task: "first" },
          { sub_agent_name: "test-helper", task: "second" },
          { sub_agent_name: "test-helper", task: "third" },
        ],
        max_concurrency: 1,
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    {
      callerAgentId: "agent-test",
      allowedTools: ["call_sub_agents", "shell_command"],
      approvedConfirmationIds: ["confirmation-call-shell"],
      confirmationPolicy: "prompt",
    }
  );

  assert.equal(resumed.status, "completed");
  const finalBatchCompleted = eventLog.list().filter((entry) => entry.type === "sub_agent_batch.completed").at(-1);
  const finalPayload = finalBatchCompleted?.message.payload as {
    readonly successCount?: number;
    readonly approvalRequiredCount?: number;
    readonly notStartedCount?: number;
    readonly results?: readonly { readonly status: string }[];
  } | undefined;
  assert.equal(finalPayload?.successCount, 2);
  assert.equal(finalPayload?.approvalRequiredCount, 0);
  assert.equal(finalPayload?.notStartedCount, 1);
  assert.deepEqual(finalPayload?.results?.map((result) => result.status), ["completed", "completed"]);
});

test("spawn_sub_agent uses instructions as the temporary sub-agent body", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-spawn", "spawned finished"),
  ]);
  const center = new ToolCenter();
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["spawn_sub_agent"],
    includeSpawnTool: true,
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-spawn",
      toolName: "spawn_sub_agent",
      input: {
        role: "Temporary Reviewer",
        instructions: "CUSTOM SYSTEM BODY FOR TEMP AGENT",
        task: "review",
        allowed_tools: ["read_file"],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["spawn_sub_agent"] }
  );

  assert.equal(result.status, "completed");
  assert.match(channel.requests[0]?.sanitizedMessages[0]?.content ?? "", /CUSTOM SYSTEM BODY FOR TEMP AGENT/);
  assert.equal(channel.requests[0]?.sanitizedMessages[1]?.role, "user");
  assert.match(channel.requests[0]?.sanitizedMessages[1]?.content ?? "", /review/);
});

test("spawn_sub_agent allowed_tools narrows inherited parent tools", async () => {
  const channel = new SequenceIntelligenceChannel([
    textResponse("model-request-spawn", "spawned finished"),
  ]);
  const center = new ToolCenter();
  center.register(testTool("read_file", async () => ({ content: "ok" })));
  center.register(testTool("shell_command", async () => ({ summary: "ran" }), "execute", true));
  const registry = await tempRegistry();
  for (const executor of createSubAgentToolExecutors({
    subAgentRegistry: registry,
    channel,
    toolBroker: center,
    allowedTools: () => ["spawn_sub_agent", "read_file", "shell_command"],
    includeSpawnTool: true,
  })) {
    center.register(executor);
  }

  const result = await center.execute(
    {
      callId: "call-spawn",
      toolName: "spawn_sub_agent",
      input: {
        role: "Temporary Reader",
        instructions: "Use only the declared read tool.",
        task: "read",
        allowed_tools: ["read_file"],
      },
    },
    { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" },
    { callerAgentId: "agent-test", allowedTools: ["spawn_sub_agent", "read_file", "shell_command"] }
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["read_file"]);
});

function testSubAgent(input: {
  readonly allowedTools?: readonly string[];
} = {}) {
  return {
    id: "test-helper",
    name: "test-helper",
    description: "Test helper",
    enabled: true,
    sourcePath: path.join(tmpdir(), "missing-sub-agent.md"),
    inlineSystemPrompt: "You are a test helper.",
    whenToUse: [],
    whenNotToUse: [],
    allowedTools: input.allowedTools ?? [],
    sourceKind: "custom" as const,
    sourceRootId: "test",
    sourcePrecedence: 0,
    sourceRootPath: "",
    packageName: "test-helper",
    packagePath: "",
    contentHash: "",
    bodyHash: "",
    metadataHash: "",
  };
}

async function tempRegistry(): Promise<SubAgentRegistry> {
  const root = mkdtempSync(path.join(tmpdir(), "agentarbor-sub-agent-"));
  const packageDir = path.join(root, "test-helper");
  mkdirSync(packageDir);
  writeTestSubAgentFile(path.join(packageDir, "SUB_AGENT.md"), "You are a test helper.");
  const registry = new SubAgentRegistry({ roots: [root] });
  await registry.list();
  return registry;
}

function writeTestSubAgentFile(sourcePath: string, body: string, name = "test-helper"): void {
  writeFileSync(
    sourcePath,
    [
      "---",
      `name: ${name}`,
      `description: ${name} test helper`,
      "enabled: true",
      "---",
      "",
      body,
      "",
    ].join("\n"),
    "utf8"
  );
}

function capabilitySubAgentCatalogItem(subAgent: SubAgentDefinition): CapabilitySubAgentCatalogItem {
  return {
    id: subAgent.id,
    name: subAgent.name,
    description: subAgent.description,
    category: subAgent.category,
    sourceKind: subAgent.sourceKind,
    sourceRootId: subAgent.sourceRootId,
    sourcePrecedence: subAgent.sourcePrecedence,
    enabled: subAgent.enabled,
    version: subAgent.version,
    whenToUse: subAgent.whenToUse,
    whenNotToUse: subAgent.whenNotToUse,
    allowedTools: subAgent.allowedTools,
    model: subAgent.model,
    maxSteps: subAgent.maxSteps,
    contentHash: subAgent.contentHash,
    bodyHash: subAgent.bodyHash,
  };
}

function testTool(
  name: string,
  execute: ToolExecutor["execute"],
  operationType: "read-only" | "read-write" | "execute" | "external-submit" = "read-only",
  requiresConfirmation = false
): ToolExecutor {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      metadata: {
        category: "other",
        riskLevel: operationType === "read-only" ? "low" : "high",
        operationType,
        requiresConfirmation,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 800,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    execute,
  };
}

class SequenceIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: readonly ModelResponse[]) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses[this.requests.length - 1] ?? this.responses.at(-1)!;
    return {
      ...response,
      requestId: request.requestId,
    };
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }
}

class ConcurrentIntelligenceChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];
  maxActive = 0;
  private active = 0;
  private released = false;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly releaseAt: number) {}

  async request(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.active >= this.releaseAt) {
      this.release();
    }
    await this.waitForReleaseOrTimeout();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    this.active -= 1;
    return textResponse(request.requestId, `done ${this.requests.length}`);
  }

  validateResponse(_request: ModelRequest, response: ModelResponse) {
    return response.validation;
  }

  private waitForReleaseOrTimeout(): Promise<void> {
    if (this.released) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.release();
        resolve();
      }, 50);
      this.waiters.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}

function completedResponse(requestId: string, output: unknown): ModelResponse {
  return {
    responseId: `${requestId}-response`,
    requestId,
    providerId: "test-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "test-model",
    status: "completed",
    outputKind: "explanation",
    structuredOutput: output,
    finishReason: "stop",
    validation: pendingModelOutputValidation(),
    completedAt: nowIso(),
  };
}

function textResponse(requestId: string, text: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    textOutput: text,
  };
}

function toolCallResponse(
  requestId: string,
  callId: string,
  toolName: string,
  input: unknown
): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    toolCalls: [{ callId, toolName, input }],
    finishReason: "tool_call",
  };
}

function failedResponse(requestId: string, message: string): ModelResponse {
  return {
    ...completedResponse(requestId, undefined),
    status: "failed",
    textOutput: undefined,
    failure: {
      kind: "provider_response",
      retryable: true,
      message,
    },
    finishReason: "error",
  };
}
