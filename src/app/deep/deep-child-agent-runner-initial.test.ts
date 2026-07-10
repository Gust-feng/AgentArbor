/** Initial deep child execution and terminal result mapping. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEP_CHILD_DEFAULT_MAX_MODEL_ROUNDS,
  DEEP_CHILD_DEFAULT_MAX_TOOL_ROUNDS,
  normalizeDeepChildRoundLimit,
  runDeepChildAgent,
} from "./deep-child-agent-runner.js";
import { createDeepTurnRuntime } from "./deep-turn.js";
import {
  completedJsonResponse,
  failedModelResponse,
  makeChildRun,
  RecordingToolBroker,
  sampleChildSpec,
  SequenceChannel,
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
  assert.equal(result.completedRun.execution?.toolCalls[0]?.summary, "search：OAuth2 migration risk");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.inputSummary, "{\"query\":\"OAuth2 migration risk\"}");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.durationMs, 1);
  assert.equal(result.completedRun.execution?.toolCalls[0]?.display?.kind, "search_results");
  assert.equal(result.completedRun.execution?.toolCalls[0]?.display?.query, "OAuth2 migration risk");
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

test("runDeepChildAgent restores the frozen parent objective when childSpec is omitted", async () => {
  const childSpec = sampleChildSpec({
    allowedTools: [],
    objective: "恢复运行时必须沿用父 Agent 生成的原始子任务目标。",
  });
  const childRun = makeChildRun(childSpec);
  const channel = new SequenceChannel([
    completedJsonResponse({
      summary: "恢复路径沿用冻结目标完成探索。",
      findings: ["冻结 objective 被注入 child prompt"],
      evidenceRefs: ["child:restored-objective"],
      uncertainty: "无",
      confidence: 0.81,
    }),
  ]);
  const turnRuntime = createDeepTurnRuntime({
    intelligenceChannel: channel,
    toolCenter: new RecordingToolBroker([]),
  });

  const result = await runDeepChildAgent({
    childRun,
    goal: "评估恢复路径",
    permissionBoundaryRefs: [],
    turnRuntime,
    traceId: "trace-test",
    goalId: "goal-test",
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.prompt.objective, childSpec.objective);
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) => message.content.includes(childSpec.objective)),
    true,
  );
  assert.equal(
    channel.requests[0]?.sanitizedMessages.some((message) => message.content.includes("Explore from angle")),
    false,
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
