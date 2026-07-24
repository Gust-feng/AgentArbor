/** Deep child continuation context and confirmation-resume behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChildAgentRun } from "../../domain/underground/agent-fabric.js";
import {
  continueDeepChildAgent,
  DeepChildPostExecutionPersistenceError,
  resumeDeepChildAgent,
  retryDeepChildAgentPostExecutionPersistence,
  runDeepChildAgent,
} from "./deep-child-agent-runner.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import {
  createDeepChildLoopContextRef,
  InMemoryDeepChildLoopContextStore,
} from "./deep-child-loop-contexts.js";
import {
  completedJsonResponse,
  failedModelResponse,
  makeChildRun,
  RecordingToolBroker,
  sampleChildSpec,
  SequenceChannel,
  toolCallResponse,
} from "./deep-child-agent-runner-test-support.js";

test("continueDeepChildAgent resumes from stored tool context after provider interruption", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "先检索迁移回滚证据；如果模型通道中断，继续时不得从零开始。",
  });
  const childRun = makeChildRun(childSpec);
  const contextStore = new InMemoryDeepChildLoopContextStore();
  const channel = new SequenceChannel([
    toolCallResponse("call-search-context", "search", { query: "OAuth2 rollback evidence" }),
    failedModelResponse("other side closed", "provider_network"),
    completedJsonResponse({
      summary: "基于上一段工具结果继续后，补齐了回滚路径材料。",
      findings: ["继续时看到了上一段 search 工具结果"],
      evidenceRefs: ["tool:search:rollback-evidence"],
      uncertainty: "仍需父层综合。",
      confidence: 0.73,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker });

  const interrupted = await runDeepChildAgent({
    runId: "deep-run-context-test",
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    childLoopContextStore: contextStore,
  });

  assert.equal(interrupted.completedRun.status, "interrupted");
  const contextRef = createDeepChildLoopContextRef(childRun.childRunId);
  assert.equal(interrupted.completedRun.continuationContextRef, contextRef);
  const stored = await contextStore.getByRef(
    "deep-run-context-test",
    contextRef,
  );
  assert.equal(stored?.messages.some((message) => message.role === "assistant" && message.toolCalls?.[0]?.callId === "call-search-context"), true);
  assert.equal(stored?.messages.some((message) => message.role === "tool" && message.toolCallId === "call-search-context"), true);

  const continued = await continueDeepChildAgent({
    runId: "deep-run-context-test",
    childRun: interrupted.completedRun,
    childSpec,
    previousSummary: interrupted.summary,
    parentInstruction: "沿用上一段工具结果继续，不要重新做大范围检索。",
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    childLoopContextStore: contextStore,
  });

  assert.equal(continued.completedRun.status, "completed");
  assert.equal(channel.requests.length, 3);
  assert.equal(
    channel.requests[2]?.sanitizedMessages.some((message) =>
      message.role === "tool" && message.toolCallId === "call-search-context"
    ),
    true,
  );
  assert.equal(
    channel.requests[2]?.sanitizedMessages.some((message) =>
      message.ref === `context:deep:child_parent_instruction:${childRun.childRunId}` &&
      message.content.includes("不要重新做大范围检索")
    ),
    true,
  );
  const records = await contextStore.listForChild("deep-run-context-test", childRun.childRunId);
  assert.equal(continued.completedRun.continuationContextRef, contextRef);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.contextRef, contextRef);
  assert.equal(records[0]?.createdAt, stored?.createdAt);
});

test("continueDeepChildAgent returns a failed result with tool facts when post-execution context persistence fails", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "继续检索一次，并在上下文写入失败时保留执行事实。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-search-followup-persistence", "search", { query: "follow-up evidence" }),
    completedJsonResponse({
      summary: "跟进检索已执行，但 continuation context 无法落盘。",
      findings: ["跟进工具只执行一次"],
      evidenceRefs: ["tool:search:followup-persistence"],
      uncertainty: "上下文存储不可用。",
      confidence: 0.61,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const contextStore = new InMemoryDeepChildLoopContextStore();
  contextStore.upsert = async () => {
    throw new Error("fixture continued child context write failed");
  };

  const result = await continueDeepChildAgent({
    runId: "deep-run-followup-context-failure",
    childRun,
    childSpec,
    parentInstruction: "补充一次检索后返回材料。",
    goal: "验证 child 跟进的 post-execution 失败不会触发盲重试",
    permissionBoundaryRefs: [],
    turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker }),
    traceId: "trace-test",
    goalId: "goal-test",
    childLoopContextStore: contextStore,
  });

  assert.equal(result.completedRun.status, "failed");
  assert.match(result.completedRun.failureReason ?? "", /fixture continued child context write failed/);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.toolName, "search");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.status, "completed");
  assert.deepEqual(broker.executedToolNames(), ["search"]);
  assert.equal(channel.requests.length, 2);
});

test("continueDeepChildAgent does not start the model loop when write-ahead admission fails", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "只有 durable instruction marker 成功后才能继续执行。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    completedJsonResponse({
      summary: "不应被调用。",
      findings: [],
      evidenceRefs: [],
      uncertainty: "无。",
      confidence: 0.5,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  let admissionAttempts = 0;

  await assert.rejects(
    continueDeepChildAgent({
      childRun,
      childSpec,
      parentInstruction: "继续执行。",
      beforeExecution: async () => {
        admissionAttempts += 1;
        throw new Error("fixture child instruction marker write failed");
      },
      goal: "验证 child continuation 的 write-ahead 边界",
      permissionBoundaryRefs: [],
      turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker }),
      traceId: "trace-test",
      goalId: "goal-test",
    }),
    /fixture child instruction marker write failed/,
  );

  assert.equal(admissionAttempts, 1);
  assert.equal(channel.requests.length, 0);
  assert.deepEqual(broker.executedToolNames(), []);
});

test("resumeDeepChildAgent approves a blocked child confirmation and completes the same child run", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["write"],
    objective: "确认后继续同一个子 Agent 写入证据并输出材料。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-write", "write", { path: "notes.md" }),
    completedJsonResponse({
      summary: "确认后继续执行同一个子 Agent，并补齐写入后的材料。",
      findings: ["写入确认通过后，子 Agent 使用同一条工具 loop 完成材料输出"],
      evidenceRefs: ["tool:write:oauth-risk"],
      uncertainty: "仍需父层综合判断是否纳入最终结论。",
      confidence: 0.69,
    }),
  ]);
  const broker = new RecordingToolBroker(["write"], ["write"]);
  const contextStore = new InMemoryDeepChildLoopContextStore();
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const blocked = await runDeepChildAgent({
    runId: "deep-run-confirmation-context-test",
    childRun,
    childSpec,
    goal: "整理迁移风险笔记",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    confirmationPolicy: "prompt",
    childLoopContextStore: contextStore,
  });

  assert.equal(blocked.completedRun.status, "blocked");
  assert.equal(blocked.pendingContinuation?.confirmationId, "confirm-call-write");

  const resumed = await resumeDeepChildAgent({
    runId: "deep-run-confirmation-context-test",
    childRun: blocked.completedRun,
    childSpec,
    pendingApproval: blocked.pendingContinuation!.pendingApproval,
    decision: { decision: "approve_once" },
    turnRuntime,
    childLoopContextStore: contextStore,
  });

  assert.equal(resumed.completedRun.childRunId, childRun.childRunId);
  assert.equal(resumed.summary.status, "completed");
  assert.equal(resumed.completedRun.status, "completed");
  assert.equal(resumed.completedRun.pendingApproval, undefined);
  assert.equal(resumed.execution.modelRounds, 2);
  assert.equal(resumed.execution.toolRounds, 1);
  assert.equal(resumed.completedRun.executionHistory?.length, 2);
  assert.deepEqual(
    resumed.completedRun.executionHistory?.map((segment) => segment.outcome),
    ["blocked", "completed"],
  );
  assert.equal(resumed.completedRun.executionHistory?.[0]?.toolCalls[0]?.status, "approval_required");
  assert.equal(resumed.completedRun.executionHistory?.[1]?.toolCalls[0]?.status, "completed");
  assert.deepEqual(broker.executedToolNames(), ["write"]);
  assert.equal(channel.requests.length, 2);
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
  const contextRef = createDeepChildLoopContextRef(childRun.childRunId);
  const records = await contextStore.listForChild("deep-run-confirmation-context-test", childRun.childRunId);
  assert.equal(blocked.completedRun.continuationContextRef, contextRef);
  assert.equal(resumed.completedRun.continuationContextRef, contextRef);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.contextRef, contextRef);
});

test("resumeDeepChildAgent exposes a known tool result when only loop-context persistence fails", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["write"],
    objective: "确认后写入一次，并在 context 持久化失败时保留已知执行结果。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-write", "write", { path: "notes.md" }),
    completedJsonResponse({
      summary: "写入已执行，等待补写 continuation context。",
      findings: ["写入工具仅执行一次"],
      evidenceRefs: ["tool:write:oauth-risk"],
      uncertainty: "无。",
      confidence: 0.8,
    }),
  ]);
  const broker = new RecordingToolBroker(["write"], ["write"]);
  const contextStore = new InMemoryDeepChildLoopContextStore();
  const turnRuntime = createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker });
  const blocked = await runDeepChildAgent({
    runId: "deep-run-confirmation-persistence-test",
    childRun,
    childSpec,
    goal: "验证确认后的持久化重试不会重复写入",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    confirmationPolicy: "prompt",
    childLoopContextStore: contextStore,
  });
  const originalUpsert = contextStore.upsert.bind(contextStore);
  contextStore.upsert = async () => {
    throw new Error("fixture child context write failed");
  };

  let knownResult: DeepChildPostExecutionPersistenceError["result"] | undefined;
  await assert.rejects(
    resumeDeepChildAgent({
      runId: "deep-run-confirmation-persistence-test",
      childRun: blocked.completedRun,
      childSpec,
      pendingApproval: blocked.pendingContinuation!.pendingApproval,
      decision: { decision: "approve_once" },
      turnRuntime,
      childLoopContextStore: contextStore,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DeepChildPostExecutionPersistenceError);
      knownResult = error.result;
      assert.equal(error.result.completedRun.status, "completed");
      assert.equal(error.result.pendingPersistence?.kind, "child_loop_context");
      return true;
    },
  );
  assert.deepEqual(broker.executedToolNames(), ["write"]);

  contextStore.upsert = originalUpsert;
  assert.ok(knownResult);
  const persisted = await retryDeepChildAgentPostExecutionPersistence(knownResult, contextStore);
  assert.equal(persisted.pendingPersistence, undefined);
  assert.deepEqual(broker.executedToolNames(), ["write"]);
  assert.equal(channel.requests.length, 2);
});

test("continueDeepChildAgent appends parent instruction and keeps the same child standard loop", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "继续核查 OAuth2 迁移风险，补齐回滚证据。",
  });
  const childRun: ChildAgentRun = {
    ...makeChildRun(childSpec),
    execution: {
      modelRounds: 1,
      toolRounds: 0,
      toolCalls: [],
    },
    executionHistory: [
      {
        modelRounds: 1,
        toolRounds: 0,
        toolCalls: [],
        outcome: "blocked",
        recordedAt: "2026-05-01T00:00:01.000Z",
      },
    ],
    parentInstructions: [
      {
        instructionId: "instruction-risk-1",
        messageRef: "child_message:instruction-risk-1",
        source: "manager",
        status: "queued",
        instructionSummary: "先补齐风险边界。",
        requestedAt: "2026-05-01T00:00:01.500Z",
        queuedAt: "2026-05-01T00:00:01.500Z",
      },
    ],
  };
  const channel = new SequenceChannel([
    toolCallResponse("call-search-followup", "search", { query: "OAuth2 rollback evidence" }),
    completedJsonResponse({
      summary: "继续后补齐了回滚证据，确认需要保留旧认证入口。",
      findings: ["回滚证据显示旧入口保留可降低迁移风险"],
      evidenceRefs: ["tool:search:rollback-evidence"],
      uncertainty: "仍需项目内验证具体入口数量。",
      confidence: 0.74,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker });

  const result = await continueDeepChildAgent({
    childRun,
    childSpec,
    previousSummary: {
      childRunId: childRun.childRunId,
      spec: childSpec,
      status: "blocked",
      summary: "初轮缺少回滚证据。",
      findings: ["需要补证据"],
      evidenceRefs: [],
      uncertainty: "缺少回滚证据。",
      confidence: 0.2,
    },
    parentInstruction: "请沿用同一个子 Agent，重点补齐回滚路径证据。",
    currentParentReview: {
      decision: "needs_followup",
      reason: "父层审查发现初轮材料缺少可执行回滚证据。",
      evidenceRefs: ["child:risk:initial"],
      confidence: 0.63,
    },
    parentMessageHistory: [
      {
        messageRef: "child_message:instruction-risk-0",
        source: "control_api",
        status: "executed",
        content: "上一轮父层原文：先检查旧认证入口是否必须保留。",
        updatedAt: "2026-05-01T00:00:00.500Z",
      },
    ],
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.completedRun.childRunId, childRun.childRunId);
  assert.equal(result.execution.modelRounds, 2);
  assert.equal(result.completedRun.executionHistory?.length, 2);
  assert.deepEqual(
    result.completedRun.executionHistory?.map((segment) => segment.outcome),
    ["blocked", "completed"],
  );
  assert.deepEqual(broker.executedToolNames(), ["search"]);
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) =>
      message.content.includes("Parent Agent follow-up instruction") &&
      message.content.includes("重点补齐回滚路径证据"),
    ),
    true,
  );
  const continuationPrompt = channel.requests[0]?.sanitizedMessages.find((message) =>
    message.ref === `context:deep:child_parent_instruction:${childRun.childRunId}`,
  )?.content ?? "";
  assert.match(continuationPrompt, /Execution segments so far: 1/);
  assert.match(continuationPrompt, /Execution segment history: 1\.blocked; modelRounds=1; toolRounds=0; toolCalls=\(none\)/);
  assert.match(continuationPrompt, /Latest execution: modelRounds=1; toolRounds=0; toolCalls=\(none\)/);
  assert.match(continuationPrompt, /Current parent review decision: needs_followup/);
  assert.match(continuationPrompt, /Current parent review reason: 父层审查发现初轮材料缺少可执行回滚证据。/);
  assert.match(continuationPrompt, /Current parent review evidence refs: child:risk:initial/);
  assert.match(continuationPrompt, /manager\/queued \(child_message:instruction-risk-1\): 先补齐风险边界。/);
  assert.match(continuationPrompt, /Parent message history \(internal, raw parent-to-child messages\):/);
  assert.match(continuationPrompt, /control_api\/executed \(child_message:instruction-risk-0, 2026-05-01T00:00:00.500Z\): 上一轮父层原文：先检查旧认证入口是否必须保留。/);
});
