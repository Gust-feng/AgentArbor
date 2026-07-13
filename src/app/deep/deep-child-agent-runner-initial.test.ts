/** Initial deep child execution and terminal result mapping. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createReadToolOutputTool,
  MAX_TOOL_OUTPUT_READ_CHARS,
} from "../tool-center/adapters/tool-output-read-tool.js";
import { ToolCenter } from "../tool-center/tool-center.js";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";
import {
  DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS,
  DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS,
  normalizeDeepChildRoundLimit,
  runDeepChildAgent,
} from "./deep-child-agent-runner.js";
import { InMemoryDeepChildLoopContextStore } from "./deep-child-loop-contexts.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import {
  capabilitySnapshotWithTools,
  completedJsonResponse,
  failedModelResponse,
  makeChildRun,
  RecordingToolBroker,
  sampleChildSpec,
  SequenceChannel,
  testTool,
  toolCallResponse,
} from "./deep-child-agent-runner-test-support.js";

test("runDeepChildAgent runs the standard model-tool-model loop and preserves the parent-created objective", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "核查 OAuth2 迁移风险，并用工具收集至少一条证据。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse(
      "call-search",
      "search",
      { query: "OAuth2 migration risk" },
      "我会先检索 OAuth2 迁移风险资料，再根据工具结果归纳证据。",
    ),
    completedJsonResponse({
      summary: "风险角度：工具证据表明迁移需要重点处理回调兼容。",
      findings: ["回调兼容性是首要风险"],
      evidenceRefs: ["tool:search:oauth-risk"],
      uncertainty: "仍需结合项目代码确认具体影响面。",
      confidence: 0.72,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.completedRun.status, "completed");
  assert.equal(result.execution.modelRounds, 2);
  assert.equal(result.execution.toolRounds, 1);
  assert.equal(result.completedRun.execution?.modelRounds, 2);
  assert.equal(result.completedRun.execution?.toolRounds, 1);
  assert.equal(result.completedRun.execution?.modelMessages?.[0]?.text, "我会先检索 OAuth2 迁移风险资料，再根据工具结果归纳证据。");
  assert.deepEqual(result.completedRun.execution?.modelMessages?.[0]?.toolCallIds, ["call-search"]);
  assert.equal(result.completedRun.executionHistory?.[0]?.modelMessages?.[0]?.text, "我会先检索 OAuth2 迁移风险资料，再根据工具结果归纳证据。");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.toolName, "search");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.status, "completed");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.summary, undefined);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.inputSummary, "{\"query\":\"OAuth2 migration risk\"}");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.durationMs, 1);
  assert.deepEqual(
    Object.keys(result.completedRun.execution?.toolCalls[0] ?? {}).sort(),
    ["callId", "durationMs", "inputSummary", "status", "toolName"].sort(),
  );
  assert.equal("display" in (result.completedRun.execution?.toolCalls[0] ?? {}), false);
  assert.deepEqual(broker.executedToolNames(), ["search"]);
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["search"]);
  assert.deepEqual(channel.requests[0]?.budget, {});
  assert.equal(channel.requests[1]?.sanitizedMessages.some((message) => message.role === "tool"), true);
  assert.equal(result.prompt.objective, childSpec.objective);
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) => message.content.includes(childSpec.objective)),
    true,
  );
});

test("runDeepChildAgent returns a failed result with tool facts when post-execution context persistence fails", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "执行一次检索，并在上下文写入失败时保留真实执行事实。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-search-persistence", "search", { query: "context persistence evidence" }),
    completedJsonResponse({
      summary: "检索已经执行，但 continuation context 无法落盘。",
      findings: ["工具只执行了一次"],
      evidenceRefs: ["tool:search:persistence"],
      uncertainty: "上下文存储不可用。",
      confidence: 0.6,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const contextStore = new InMemoryDeepChildLoopContextStore();
  contextStore.upsert = async () => {
    throw new Error("fixture initial child context write failed");
  };

  const result = await runDeepChildAgent({
    runId: "deep-run-initial-context-failure",
    childRun,
    childSpec,
    goal: "验证 child 初次运行的 post-execution 失败不会触发盲重试",
    permissionBoundaryRefs: [],
    turnRuntime: createDeepTurnRuntime({ intelligenceChannel: channel, toolCenter: broker }),
    traceId: "trace-test",
    goalId: "goal-test",
    childLoopContextStore: contextStore,
  });

  assert.equal(result.completedRun.status, "failed");
  assert.match(result.completedRun.failureReason ?? "", /fixture initial child context write failed/);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.toolName, "search");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.status, "completed");
  assert.deepEqual(broker.executedToolNames(), ["search"]);
  assert.equal(channel.requests.length, 2);
});

test("runDeepChildAgent leaves child round budgets unset when parent omits limits", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "连续核查 OAuth2 迁移风险，必要时多次使用工具后再总结。",
  });
  const childRun = makeChildRun(childSpec);
  assert.equal(childRun.spec.permissions.maxModelRounds, undefined);
  assert.equal(childRun.spec.permissions.maxToolRounds, undefined);
  const channel = new SequenceChannel([
    toolCallResponse("call-search-1", "search", { query: "OAuth2 migration callback risk" }),
    toolCallResponse("call-search-2", "search", { query: "OAuth2 migration rollback risk" }),
    completedJsonResponse({
      summary: "风险角度：两轮工具核查后确认回调兼容和回滚路径是主要风险。",
      findings: ["回调兼容性需要迁移前验证", "回滚路径需要保留旧认证入口"],
      evidenceRefs: ["tool:search:callback-risk", "tool:search:rollback-risk"],
      uncertainty: "仍需结合项目代码确认实际接口数量。",
      confidence: 0.76,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.completedRun.status, "completed");
  assert.equal(result.execution.modelRounds, 3);
  assert.equal(result.execution.toolRounds, 2);
  assert.equal(result.completedRun.execution?.modelRounds, 3);
  assert.equal(result.completedRun.execution?.toolRounds, 2);
  assert.deepEqual(broker.executedToolNames(), ["search", "search"]);
  assert.equal(channel.requests.length, 3);
  assert.deepEqual(channel.requests.map((request) => request.budget), [{}, {}, {}]);
});

test("normalizeDeepChildRoundLimit defaults to 200 and clamps manager overshoot", () => {
  assert.equal(normalizeDeepChildRoundLimit(undefined, DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS), 200);
  assert.equal(normalizeDeepChildRoundLimit(12, DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS), 12);
  assert.equal(normalizeDeepChildRoundLimit(999, DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS), 200);
  assert.equal(normalizeDeepChildRoundLimit(undefined, DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS), 200);
  assert.equal(normalizeDeepChildRoundLimit(7, DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS), 7);
  assert.equal(normalizeDeepChildRoundLimit(800, DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS), 200);
});

test("runDeepChildAgent intersects parent prompt tools with the frozen child run permissions", async () => {
  const parentSpec = sampleChildSpec({
    allowedTools: ["search", "read_file"],
    objective: "尝试通过文件读取和搜索核查风险。",
  });
  const frozenRunSpec = { ...parentSpec, allowedTools: ["search"] };
  const childRun = makeChildRun(frozenRunSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-read", "read_file", { path: "secret.txt" }),
    completedJsonResponse({
      summary: "权限外工具未执行，材料仅记录授权边界。",
      findings: ["read_file 未授权给该 child run"],
      evidenceRefs: [],
      uncertainty: "缺少文件读取证据。",
      confidence: 0.31,
    }),
  ]);
  const broker = new RecordingToolBroker(["search", "read_file"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec: parentSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["search"]);
  assert.deepEqual(broker.executedToolNames(), []);
  assert.equal(result.execution.toolCalls[0]?.toolName, "read_file");
  assert.equal(result.execution.toolCalls[0]?.status, "failed");
  assert.equal(result.summary.status, "completed");
});

test("runDeepChildAgent inherits read_tool_output as a transport companion without expanding business tools", async () => {
  const sourceToolName = "synthetic_large_output";
  const forbiddenToolName = "parent_only_business_tool";
  const retainedRef = "tool-output://deep-child-large-output";
  const childSpec = sampleChildSpec({
    allowedTools: [sourceToolName],
    objective: "读取大型工具结果并保留业务工具边界。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-large-output", sourceToolName, {}),
    toolCallResponse("call-read-output", "read_tool_output", {
      ref: retainedRef,
      startChar: 0,
      maxChars: MAX_TOOL_OUTPUT_READ_CHARS,
    }),
    completedJsonResponse({
      summary: "已通过 transport reader 读取大型工具结果。",
      findings: ["reader companion 不改变 child 的业务工具授权"],
      evidenceRefs: [retainedRef],
      uncertainty: "仅验证 transport 续读边界。",
      confidence: 0.9,
    }),
  ]);
  const store = new InMemoryToolOutputStore({
    createRefToken: () => "deep-child-large-output",
  });
  let sourceExecutions = 0;
  let forbiddenExecutions = 0;
  const broker = new ToolCenter({ outputStore: store });
  broker.register(testTool(sourceToolName, async () => {
    sourceExecutions += 1;
    return { payload: `deep-child-evidence:${"x".repeat(190_000)}` };
  }));
  broker.register(testTool(forbiddenToolName, async () => {
    forbiddenExecutions += 1;
    return { shouldNotRun: true };
  }));
  broker.register(createReadToolOutputTool(store));
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "验证 Deep child 的大型结果续读",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-large-output",
    goalId: "goal-large-output",
    capabilitySnapshot: capabilitySnapshotWithTools([
      sourceToolName,
      forbiddenToolName,
      "read_tool_output",
    ]),
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(sourceExecutions, 1);
  assert.equal(forbiddenExecutions, 0);
  assert.deepEqual(
    channel.requests.map((request) => request.tools?.map((tool) => tool.name)),
    [
      [sourceToolName, "read_tool_output"],
      [sourceToolName, "read_tool_output"],
      [sourceToolName, "read_tool_output"],
    ],
  );
  assert.deepEqual(
    result.execution.toolCalls.map((toolCall) => [toolCall.toolName, toolCall.status]),
    [
      [sourceToolName, "completed"],
      ["read_tool_output", "completed"],
    ],
  );
  assert.deepEqual(result.summary.spec.allowedTools, [sourceToolName]);
  assert.equal(
    channel.requests[2]?.sanitizedMessages.some((message) =>
      message.role === "tool" && message.content.includes("deep-child-evidence")
    ),
    true,
  );
});

test("runDeepChildAgent maps approval_required to a blocked child Agent run", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["write_file"],
    objective: "需要写入文件时先等待用户确认。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-write", "write_file", { path: "notes.md" }),
  ]);
  const broker = new RecordingToolBroker(["write_file"], ["write_file"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "整理迁移风险笔记",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
    confirmationPolicy: "prompt",
  });

  assert.equal(result.summary.status, "blocked");
  assert.equal(result.completedRun.status, "blocked");
  assert.equal(result.completedRun.failureReason, "waiting for tool confirmation");
  assert.deepEqual(result.summary.evidenceRefs, ["call-write"]);
  assert.equal(result.execution.toolCalls[0]?.status, "approval_required");
  assert.equal(result.completedRun.execution?.modelRounds, 1);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.status, "approval_required");
  assert.equal(result.completedRun.pendingApproval?.confirmationId, "confirm-call-write");
  assert.equal(result.pendingContinuation?.childRunId, childRun.childRunId);
  assert.equal(result.pendingContinuation?.confirmationId, "confirm-call-write");
  assert.equal(result.pendingContinuation?.pendingApproval.confirmationId, "confirm-call-write");
  assert.equal(result.completedRun.pendingApproval?.toolCallId, "call-write");
  assert.equal(result.completedRun.pendingApproval?.toolName, "write_file");
  assert.equal(result.completedRun.pendingApproval?.title, "需要确认工具调用");
  assert.equal(result.completedRun.pendingApproval?.actionSummary, "运行 write_file");
  assert.deepEqual(result.completedRun.pendingApproval?.affectedResources, ["write_file"]);
  assert.equal(result.completedRun.pendingApproval?.riskLevel, "medium");
  assert.deepEqual(result.completedRun.pendingApproval?.sourceRefs, ["call-write"]);
  assert.equal(channel.requests.length, 1);
});

test("runDeepChildAgent maps provider network stops to retryable interrupted child detail", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: [],
    objective: "模型调用异常停止时保留同一个子 Agent，等待父层审查后继续。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    failedModelResponse("other side closed", "provider_network"),
  ]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: new RecordingToolBroker([]),
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估异常停止后的恢复路径",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "interrupted");
  assert.equal(result.completedRun.status, "interrupted");
  assert.match(result.completedRun.failureReason ?? "", /other side closed/);
  assert.equal(result.completedRun.failureDetail?.layer, "model_provider");
  assert.equal(result.completedRun.failureDetail?.failureKind, "provider_network");
  assert.equal(result.completedRun.failureDetail?.retryable, true);
  assert.equal(result.summary.failureDetail?.failureKind, "provider_network");
  assert.equal(result.summary.summary, "模型通道暂时中断：other side closed");
  assert.equal(result.execution.modelRounds, 1);
  assert.equal(result.completedRun.executionHistory?.length, 1);
  assert.equal(result.completedRun.executionHistory?.[0]?.outcome, "interrupted");
  assert.equal(result.completedRun.childRunId, childRun.childRunId);
});

test("runDeepChildAgent maps invalid child material to failed child run while preserving loop execution facts", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: ["search"],
    objective: "工具核查后如果材料不合约，也要保留这段子 Agent 运行事实。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    toolCallResponse("call-search", "search", { query: "OAuth2 migration risk" }),
    completedJsonResponse({
      findings: ["缺少 summary 字段，无法作为有效 child material"],
      evidenceRefs: ["tool:search:invalid-material"],
      uncertainty: "输出结构不完整。",
      confidence: 0.4,
    }),
  ]);
  const broker = new RecordingToolBroker(["search"]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: broker,
  });

  const result = await runDeepChildAgent({
    childRun,
    childSpec,
    goal: "评估认证模块迁移到 OAuth2 的风险",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "failed");
  assert.equal(result.completedRun.status, "failed");
  assert.match(result.completedRun.failureReason ?? "", /invalid child material/);
  assert.equal(result.execution.modelRounds, 2);
  assert.equal(result.execution.toolRounds, 1);
  assert.equal(result.completedRun.execution?.modelRounds, 2);
  assert.equal(result.completedRun.execution?.toolRounds, 1);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.toolName, "search");
});
