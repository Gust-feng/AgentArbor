/**
 * DeepChildScheduler 测试（T1-3，tasks.md _测试_ 点位）：
 *   1. startQueued 并发启动多个 child 且 onChildStarted 回调记录到多个 started 先于任何 completed；
 *   2. waitForProgress 等待任一终态并返回新终态材料列表（并发槽空闲时继续启动 pending）；
 *   3. cancelPendingAndRunning 后 pending 置 cancelled 且后续 startQueued 为 no-op；
 *   4. 单 child 抛错经 buildFailedChildExploration 降级为 failed task，不击穿（FR-SCH-04）；
 *   5. enqueue 复用 deriveDeepChildren 守数量上限（overflowCount 可观察）。
 *
 * 回调用 mock 注入验证调用顺序，不依赖 T2-1 runtime 装配（tasks.md T1-3 注）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  blockChildAgentRun,
  completeChildAgentRun,
  failChildAgentRun,
  interruptChildAgentRun,
  type ChildAgentRun,
} from "../../domain/underground/agent-fabric.js";
import type { AgentTurnPendingApproval } from "../../kernel/intelligence/agent-turn-runtime.js";
import { resetIdsForTests } from "../../kernel/id.js";
import type {
  DeepChildSpec,
  DeepChildSummary,
  DeepChildStatus,
  DeepChildTask,
} from "./contracts.js";
import { DeepTaskBoard } from "./deep-task-board.js";
import {
  DeepChildScheduler,
  type ContinueDeepChildFactory,
  type ExploreDeepChildFactory,
} from "./deep-child-scheduler.js";
import type { ExploreDeepChildResult } from "./child-delegation.js";

type SchedulerEvent =
  | { readonly kind: "started"; readonly childRunId: string }
  | { readonly kind: "terminal"; readonly childRunId: string; readonly status: DeepChildStatus }
  | {
      readonly kind: "instruction_queued";
      readonly childRunId: string;
      readonly instructionId: string;
      readonly queuedCount: number;
      readonly source: "manager" | "control_api";
      readonly hasRawInstruction: boolean;
    }
  | {
      readonly kind: "instruction_recorded";
      readonly childRunId: string;
      readonly instructionId: string;
      readonly source: "manager" | "control_api";
      readonly status: "queued" | "executed" | "cancelled";
      readonly instruction: string;
    };

/**
 * 构造一个可控的 exploreFactory：每次调用记录顺序并把 resolve/reject 控制权交给测试。
 * 测试在断言"started 先于 completed"后才触发 resolve，从而证明多个 child 已并发进入
 * running（而非串行 await 完成）。
 */
function createDeferredFactory(specByChildRunId: Map<string, DeepChildSpec>): {
  readonly factory: ExploreDeepChildFactory;
  readonly callOrder: () => readonly string[];
  readonly resolveSuccess: (childRunId: string) => void;
  readonly resolveBlocked: (childRunId: string) => void;
  readonly resolveFailed: (childRunId: string) => void;
  readonly resolveInterrupted: (childRunId: string) => void;
  readonly resolveBlockedWithContinuation: (childRunId: string) => void;
  readonly reject: (childRunId: string, error: Error) => void;
} {
  const childRuns = new Map<string, ChildAgentRun>();
  const resolvers = new Map<string, (result: ExploreDeepChildResult) => void>();
  const rejecters = new Map<string, (error: Error) => void>();
  const callOrder: string[] = [];
  const factory: ExploreDeepChildFactory = (childRun) => {
    childRuns.set(childRun.childRunId, childRun);
    callOrder.push(childRun.childRunId);
    return new Promise<ExploreDeepChildResult>((resolve, reject) => {
      resolvers.set(childRun.childRunId, resolve);
      rejecters.set(childRun.childRunId, reject);
    });
  };
  const buildSuccess = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "completed",
      summary: `${childRunId} 探索完成`,
      findings: ["f"],
      evidenceRefs: ["e"],
      confidence: 0.8,
      uncertainty: "u",
    };
    return { summary, completedRun: childRun };
  };
  const buildBlocked = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "blocked",
      summary: `${childRunId} 等待确认`,
      findings: ["需要用户确认后继续"],
      evidenceRefs: ["call-needs-approval"],
      confidence: 0,
      uncertainty: "waiting for tool confirmation",
    };
    return {
      summary,
      completedRun: blockChildAgentRun({
        run: childRun,
        reason: "waiting for tool confirmation",
        evidenceRefs: ["call-needs-approval"],
        uncertainty: "waiting for tool confirmation",
        blockedAt: "2026-05-01T00:00:01.000Z",
      }),
    };
  };
  const buildBlockedWithContinuation = (childRunId: string): ExploreDeepChildResult => {
    const result = buildBlocked(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const pendingApproval = fakePendingApproval("confirm-call-needs-approval");
    const completedRun = blockChildAgentRun({
      run: result.completedRun,
      reason: result.completedRun.failureReason ?? "waiting for tool confirmation",
      evidenceRefs: result.completedRun.evidenceRefs,
      uncertainty: result.completedRun.uncertainty,
      pendingApproval: {
        confirmationId: pendingApproval.confirmationId,
        toolCallId: pendingApproval.toolLoop.pendingToolCall.callId,
        toolName: pendingApproval.toolLoop.pendingToolCall.toolName,
        title: "需要确认",
        actionSummary: "运行 search",
        affectedResources: ["search"],
        riskLevel: "medium",
        resumeAvailability: "live",
        requestedAt: "2026-05-01T00:00:00.000Z",
        sourceRefs: ["call-needs-approval"],
      },
      blockedAt: result.completedRun.completedAt ?? "2026-05-01T00:00:01.000Z",
    });
    return {
      ...result,
      completedRun,
      pendingContinuation: {
        childRunId,
        confirmationId: pendingApproval.confirmationId,
        childRun: completedRun,
        childSpec: spec,
        pendingApproval,
      },
    };
  };
  const buildFailed = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "failed",
      summary: `${childRunId} 输出材料不合约`,
      findings: [],
      evidenceRefs: [],
      confidence: 0,
      uncertainty: "invalid child material",
    };
    return {
      summary,
      completedRun: failChildAgentRun(
        childRun,
        "invalid child material",
        "2026-05-01T00:00:01.000Z",
        {
          modelRounds: 2,
          toolRounds: 1,
          toolCalls: [
            { callId: "call-search", toolName: "search", status: "completed" },
          ],
        },
      ),
    };
  };
  const buildInterrupted = (childRunId: string): ExploreDeepChildResult => {
    const childRun = childRuns.get(childRunId);
    const spec = specByChildRunId.get(childRunId);
    if (childRun === undefined || spec === undefined) {
      throw new Error(`test fixture missing for ${childRunId}`);
    }
    const summary: DeepChildSummary = {
      childRunId,
      spec,
      status: "interrupted",
      summary: `${childRunId} 子 Agent 中断`,
      findings: ["子 Agent 自身中断，需要父层审查后继续"],
      evidenceRefs: [],
      confidence: 0,
      uncertainty: "child interrupted before producing enough material",
    };
    return {
      summary,
      completedRun: interruptChildAgentRun(
        childRun,
        "child interrupted before producing enough material",
        "2026-05-01T00:00:01.000Z",
      ),
    };
  };
  return {
    factory,
    callOrder: () => callOrder,
    resolveSuccess: (childRunId) => resolvers.get(childRunId)?.(buildSuccess(childRunId)),
    resolveBlocked: (childRunId) => resolvers.get(childRunId)?.(buildBlocked(childRunId)),
    resolveBlockedWithContinuation: (childRunId) =>
      resolvers.get(childRunId)?.(buildBlockedWithContinuation(childRunId)),
    resolveFailed: (childRunId) => resolvers.get(childRunId)?.(buildFailed(childRunId)),
    resolveInterrupted: (childRunId) => resolvers.get(childRunId)?.(buildInterrupted(childRunId)),
    reject: (childRunId, error) => rejecters.get(childRunId)?.(error),
  };
}

function sampleSpec(id: string): DeepChildSpec {
  return {
    specId: id,
    displayName: `${id} 角度`,
    role: id,
    objective: `${id} 目标`,
    allowedTools: ["search"],
    inputRefs: ["goal:1"],
  };
}

function fakePendingApproval(confirmationId: string): AgentTurnPendingApproval {
  return {
    confirmationId,
    modelRequest: {
      requestId: "model-request-test",
      traceId: "trace-1",
      callerRef: { kind: "agent_run", id: "child-run" },
      purpose: "deep_child_material",
      inputRefs: [],
      sanitizedMessages: [{ role: "user", content: "continue" }],
      outputContract: {
        contractId: "deep.child_material.v1",
        outputKind: "evidence_suggestion",
        format: "json_object",
        requiredFields: [],
      },
      constraintRefs: [],
      budget: {},
      sensitivity: "internal",
      requestedAt: "2026-05-01T00:00:00.000Z",
    },
    toolLoop: {
      confirmationId,
      pendingToolCall: {
        callId: "call-needs-approval",
        toolName: "search",
        input: {},
      },
      remainingToolCallsAfterApproval: [],
      messagesBeforeToolCall: [{ role: "user", content: "continue" }],
      assistantMessage: {
        role: "assistant",
        content: "",
        toolCalls: [{ callId: "call-needs-approval", toolName: "search", input: {} }],
      },
      completedToolResults: [],
      toolCallsBeforeApproval: [],
      modelRounds: 1,
      rounds: 0,
      requestId: "model-request-resume",
    },
    policy: {
      allowModel: true,
      allowedTools: ["search"],
      fallback: "disabled",
      callerAgentId: "deep-child",
      traceId: "trace-1",
      goalId: "goal-1",
      purpose: "deep_child_material",
      outputContract: {
        contractId: "deep.child_material.v1",
        outputKind: "evidence_suggestion",
        format: "json_object",
        requiredFields: [],
      },
      sensitivity: "internal",
      budget: {},
    },
  };
}

type Harness = {
  readonly scheduler: DeepChildScheduler;
  readonly events: SchedulerEvent[];
  readonly tasks: readonly DeepChildTask[];
  readonly resolveSuccess: (childRunId: string) => void;
  readonly resolveBlocked: (childRunId: string) => void;
  readonly resolveFailed: (childRunId: string) => void;
  readonly resolveInterrupted: (childRunId: string) => void;
  readonly resolveBlockedWithContinuation: (childRunId: string) => void;
  readonly reject: (childRunId: string, error: Error) => void;
  readonly callOrder: () => readonly string[];
  readonly childRunIdBySpec: (specId: string) => string;
};

function setupHarness(opts: {
  readonly specs: readonly DeepChildSpec[];
  readonly maxConcurrency: number;
  readonly maxChildren?: number;
  readonly continueFactory?: ContinueDeepChildFactory;
}): Harness {
  resetIdsForTests();
  const specByChildRunId = new Map<string, DeepChildSpec>();
  const events: SchedulerEvent[] = [];
  const board = new DeepTaskBoard({ runId: "run-1" });
  const controller = createDeferredFactory(specByChildRunId);
  const scheduler = new DeepChildScheduler({
    board,
    exploreFactory: controller.factory,
    continueFactory: opts.continueFactory,
    maxConcurrency: opts.maxConcurrency,
    maxChildren: opts.maxChildren,
    callbacks: {
      onChildStarted: (task) => {
        events.push({ kind: "started", childRunId: task.childRunId });
      },
      onChildTerminal: (task) => {
        events.push({ kind: "terminal", childRunId: task.childRunId, status: task.status });
      },
      onChildInstructionQueued: (task, queued) => {
        events.push({
          kind: "instruction_queued",
          childRunId: task.childRunId,
          instructionId: queued.instructionId,
          queuedCount: queued.queuedCount,
          source: queued.source,
          hasRawInstruction: Object.prototype.hasOwnProperty.call(queued, "instruction"),
        });
      },
      onChildInstructionRecorded: (instruction) => {
        events.push({
          kind: "instruction_recorded",
          childRunId: instruction.childRunId,
          instructionId: instruction.instructionId,
          source: instruction.source,
          status: instruction.status,
          instruction: instruction.instruction,
        });
      },
    },
  });
  const result = scheduler.enqueue({
    specs: opts.specs,
    parentAgentId: "deep-runtime-manager",
    goalId: "goal-1",
    traceId: "trace-1",
  });
  for (const task of result.tasks) {
    specByChildRunId.set(task.childRunId, task.spec);
  }
  const childRunIdBySpec = (specId: string): string => {
    const task = result.tasks.find((t) => t.spec.specId === specId);
    if (task === undefined) {
      throw new Error(`no task for spec ${specId}`);
    }
    return task.childRunId;
  };
  return {
    scheduler,
    events,
    tasks: result.tasks,
    resolveSuccess: controller.resolveSuccess,
    resolveBlocked: controller.resolveBlocked,
    resolveFailed: controller.resolveFailed,
    resolveInterrupted: controller.resolveInterrupted,
    resolveBlockedWithContinuation: controller.resolveBlockedWithContinuation,
    reject: controller.reject,
    callOrder: controller.callOrder,
    childRunIdBySpec,
  };
}

test("startQueued 并发启动多个 child：多个 started 先于任何 completed（FR-SCH-02 事件顺序证明并发）", async () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b"), sampleSpec("c")],
    maxConcurrency: 3,
  });
  h.scheduler.startQueued();

  // 并发关键断言：3 个 child 在任何 child Agent run 终态前都已进入 running（onChildStarted
  // 各触发一次），而非成对串行 started/completed。
  assert.equal(h.events.filter((e) => e.kind === "started").length, 3);
  assert.equal(h.events.filter((e) => e.kind === "terminal").length, 0);
  // exploreFactory 被并发调用 3 次（复用 child Agent runner，FR-SCH-03）
  assert.equal(h.callOrder().length, 3);
  // board snapshot 反映 3 个 running
  const snap = h.scheduler.snapshot();
  assert.equal(snap.tasks.filter((t) => t.status === "running").length, 3);

  // 现在才 resolve 全部，终端事件在所有 started 之后
  const waitAll = h.scheduler.waitForAll();
  for (const task of h.tasks) {
    h.resolveSuccess(task.childRunId);
  }
  await waitAll;

  // 全部 started（索引 0-2）严格先于全部 terminal（索引 3-5）
  const startedIdx = h.events.filter((e) => e.kind === "started");
  const terminalIdx = h.events.filter((e) => e.kind === "terminal");
  assert.equal(startedIdx.length, 3);
  assert.equal(terminalIdx.length, 3);
  const firstTerminalEventIndex = h.events.findIndex((e) => e.kind === "terminal");
  const lastStartedEventIndex = (() => {
    let idx = -1;
    h.events.forEach((e, i) => {
      if (e.kind === "started") idx = i;
    });
    return idx;
  })();
  assert.ok(
    firstTerminalEventIndex > lastStartedEventIndex,
    "所有 started 应先于任何 terminal（证明并发而非串行成对）",
  );
  // 全部 completed
  const finalSnap = h.scheduler.snapshot();
  assert.equal(finalSnap.tasks.filter((t) => t.status === "completed").length, 3);
});

test("startQueued 受 maxConcurrency 约束：只启动到上限个，剩余 pending", () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b"), sampleSpec("c")],
    maxConcurrency: 2,
  });
  h.scheduler.startQueued();
  const snap = h.scheduler.snapshot();
  assert.equal(snap.tasks.filter((t) => t.status === "running").length, 2);
  assert.equal(snap.tasks.filter((t) => t.status === "pending").length, 1);
  assert.equal(h.events.filter((e) => e.kind === "started").length, 2);
});

test("waitForProgress 等待任一终态并返回新终态材料；并发槽空闲时继续启动 pending（FR-WAIT-01/02）", async () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b"), sampleSpec("c")],
    maxConcurrency: 2,
  });
  h.scheduler.startQueued();
  const runningTasks = h.tasks.filter((t) => h.scheduler.snapshot().tasks.find((x) => x.childRunId === t.childRunId)?.status === "running");
  assert.equal(runningTasks.length, 2);
  const firstRunning = runningTasks[0];

  // 等待任一终态（此时未 resolve，waitForProgress 阻塞）
  const waitProg = h.scheduler.waitForProgress();
  h.resolveSuccess(firstRunning.childRunId);
  const batch1 = await waitProg;

  assert.equal(batch1.length, 1);
  assert.equal(batch1[0].task.status, "completed");
  assert.equal(batch1[0].summary.childRunId, firstRunning.childRunId);
  // completedRun 透传给父层（供 executor 合并进 completedChildRuns）
  assert.equal(batch1[0].completedRun.childRunId, firstRunning.childRunId);

  // 并发槽空闲（一个 completed，一个仍 running），继续启动剩余 pending
  h.scheduler.startQueued();
  const snap = h.scheduler.snapshot();
  assert.equal(
    snap.tasks.filter((t) => t.status === "running").length,
    2,
    "空出的并发槽应启动剩余 pending",
  );
  assert.equal(snap.tasks.filter((t) => t.status === "pending").length, 0);
  // 第三个 started 事件已触发
  assert.equal(h.events.filter((e) => e.kind === "started").length, 3);
});

test("waitForAll 等待全部 in-flight 终态并累积全部材料（FR-SAFE-03 synthesize 前清场）", async () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b")],
    maxConcurrency: 2,
  });
  h.scheduler.startQueued();
  const waitAll = h.scheduler.waitForAll();
  for (const task of h.tasks) {
    h.resolveSuccess(task.childRunId);
  }
  const all = await waitAll;
  assert.equal(all.length, 2);
  assert.equal(h.scheduler.snapshot().tasks.filter((t) => t.status === "completed").length, 2);
});

test("waitForAllQueued 分批启动 pending 并等待到无 pending/running（synthesize 前清场）", async () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b"), sampleSpec("c")],
    maxConcurrency: 1,
  });
  h.scheduler.startQueued();
  const firstRunning = h.scheduler.snapshot().tasks.find((t) => t.status === "running");
  assert.ok(firstRunning !== undefined);

  const waitAllQueued = h.scheduler.waitForAllQueued();
  h.resolveSuccess(firstRunning.childRunId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const secondRunning = h.scheduler
    .snapshot()
    .tasks.find((t) => t.status === "running");
  assert.ok(secondRunning !== undefined);
  h.resolveSuccess(secondRunning.childRunId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const thirdRunning = h.scheduler
    .snapshot()
    .tasks.find((t) => t.status === "running");
  assert.ok(thirdRunning !== undefined);
  h.resolveSuccess(thirdRunning.childRunId);

  const all = await waitAllQueued;
  assert.equal(all.length, 3);
  const snap = h.scheduler.snapshot();
  assert.equal(snap.tasks.some((t) => t.status === "pending" || t.status === "running"), false);
  assert.equal(snap.tasks.filter((t) => t.status === "completed").length, 3);
});

test("cancelPendingAndRunning：pending 置 cancelled + board stopped + 后续 startQueued no-op（FR-SAFE-02）", async () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b"), sampleSpec("c")],
    maxConcurrency: 2,
  });
  h.scheduler.startQueued();
  // 2 running, 1 pending
  const pendingTask = h.scheduler
    .snapshot()
    .tasks.find((t) => t.status === "pending");
  assert.ok(pendingTask !== undefined);

  const cancelResult = h.scheduler.cancelPendingAndRunning("user stop");
  assert.equal(cancelResult.cancelledCount, 1);

  const snapAfterCancel = h.scheduler.snapshot();
  assert.equal(
    snapAfterCancel.tasks.find((t) => t.childRunId === pendingTask.childRunId)?.status,
    "cancelled",
  );
  // running 不被 cancel（不真 abort 模型调用，自然完成进保留材料）
  const stillRunning = snapAfterCancel.tasks.filter((t) => t.status === "running");
  assert.equal(stillRunning.length, 2);
  assert.equal(h.scheduler.getBoard().isStopped(), true);

  // 后续 startQueued 为 no-op：cancelled 不被重新启动
  h.scheduler.startQueued();
  const snapAfterStartQueued = h.scheduler.snapshot();
  assert.equal(
    snapAfterStartQueued.tasks.find((t) => t.childRunId === pendingTask.childRunId)?.status,
    "cancelled",
  );
  assert.equal(snapAfterStartQueued.tasks.filter((t) => t.status === "running").length, 2);

  // running child 完成后材料仍保留（不触发继续探索，但材料交还）
  const aRunning = stillRunning[0];
  h.resolveSuccess(aRunning.childRunId);
  const batch = await h.scheduler.waitForProgress();
  assert.equal(batch.length, 1);
  assert.equal(batch[0].task.status, "completed");
});

test("单 child 抛错降级为 failed task，不击穿 run（FR-SCH-04 / FR-SAFE-01）", async () => {
  const h = setupHarness({
    specs: [sampleSpec("a")],
    maxConcurrency: 2,
  });
  h.scheduler.startQueued();
  const task = h.tasks[0];
  const waitProg = h.scheduler.waitForProgress();
  h.reject(task.childRunId, new Error("model timeout"));
  const batch = await waitProg;

  assert.equal(batch.length, 1);
  assert.equal(batch[0].task.status, "failed");
  assert.equal(batch[0].task.failure, "model timeout");
  // buildFailedChildExploration 降级：status=failed, confidence=0, findings 空
  assert.equal(batch[0].summary.status, "failed");
  assert.equal(batch[0].summary.confidence, 0);
  assert.equal(batch[0].summary.findings.length, 0);
  // onChildTerminal 也以 failed 触发
  assert.equal(
    h.events.find((e) => e.kind === "terminal")?.status,
    "failed",
  );
});

test("child Agent 暂停态映射为 blocked task，不误报 failed", async () => {
  const h = setupHarness({
    specs: [sampleSpec("blocked")],
    maxConcurrency: 1,
  });
  h.scheduler.startQueued();
  const task = h.tasks[0];
  const waitProg = h.scheduler.waitForProgress();
  h.resolveBlocked(task.childRunId);
  const batch = await waitProg;

  assert.equal(batch.length, 1);
  assert.equal(batch[0].task.status, "blocked");
  assert.equal(batch[0].summary.status, "blocked");
  assert.equal(batch[0].completedRun.status, "blocked");
  assert.equal(batch[0].task.failure, "waiting for tool confirmation");
  assert.equal(
    h.events.find((e) => e.kind === "terminal")?.status,
    "blocked",
  );
});

test("blocked child terminal material propagates runtime-only pending continuation", async () => {
  const h = setupHarness({
    specs: [sampleSpec("blocked-continuation")],
    maxConcurrency: 1,
  });
  h.scheduler.startQueued();
  const task = h.tasks[0];
  const waitProg = h.scheduler.waitForProgress();
  h.resolveBlockedWithContinuation(task.childRunId);
  const batch = await waitProg;

  assert.equal(batch.length, 1);
  assert.equal(batch[0].task.status, "blocked");
  assert.equal(batch[0].pendingContinuation?.childRunId, task.childRunId);
  assert.equal(batch[0].pendingContinuation?.confirmationId, "confirm-call-needs-approval");
  assert.equal(batch[0].task.pendingApproval?.confirmationId, "confirm-call-needs-approval");
  assert.equal(batch[0].completedRun.pendingApproval?.confirmationId, "confirm-call-needs-approval");
  assert.equal(
    h.scheduler.snapshot().tasks[0].pendingApproval?.confirmationId,
    "confirm-call-needs-approval",
  );
});

test("running child accepts queued parent instruction and continues same child before returning material", async () => {
  const continuedInstructions: string[] = [];
  const h = setupHarness({
    specs: [sampleSpec("followup")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec, parentInstruction, previousSummary) => {
      continuedInstructions.push(parentInstruction);
      assert.equal(childRun.childRunId, previousSummary?.childRunId);
      assert.equal(childSpec.specId, "followup");
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "completed",
        summary: "追加指令后完成",
        findings: ["同一个 child run 继续工作"],
        evidenceRefs: ["followup:evidence"],
        confidence: 0.77,
        uncertainty: "无",
      };
      return { summary, completedRun: childRun };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();

  const queued = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "请继续补齐边界条件。",
  });
  assert.equal(queued.status, "queued");
  if (queued.status !== "queued") {
    throw new Error("expected queued child instruction");
  }
  assert.equal(queued.messageRef, `child_message:${queued.instructionId}`);
  const queuedEvent = h.events.find(
    (event): event is Extract<SchedulerEvent, { readonly kind: "instruction_queued" }> =>
      event.kind === "instruction_queued",
  );
  assert.equal(queuedEvent?.childRunId, task.childRunId);
  assert.equal(queuedEvent?.queuedCount, 1);
  assert.equal(queuedEvent?.source, "control_api");
  assert.equal(queuedEvent?.hasRawInstruction, false);
  const queuedRecord = h.events.find(
    (event): event is Extract<SchedulerEvent, { readonly kind: "instruction_recorded" }> =>
      event.kind === "instruction_recorded" && event.status === "queued",
  );
  assert.equal(queuedRecord?.instruction, "请继续补齐边界条件。");
  assert.equal(queuedRecord?.source, "control_api");

  const waitProg = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  const batch = await waitProg;
  const executedRecord = h.events.find(
    (event): event is Extract<SchedulerEvent, { readonly kind: "instruction_recorded" }> =>
      event.kind === "instruction_recorded" && event.status === "executed",
  );
  assert.equal(executedRecord?.instruction, "请继续补齐边界条件。");

  assert.deepEqual(continuedInstructions, ["请继续补齐边界条件。"]);
  assert.equal(batch.length, 1);
  assert.equal(batch[0].completedRun.childRunId, task.childRunId);
  assert.equal(batch[0].summary.summary, "追加指令后完成");
  assert.equal(batch[0].executedQueuedInstructions?.length, 1);
  assert.equal(batch[0].executedQueuedInstructions?.[0]?.source, "control_api");
  assert.equal(batch[0].executedQueuedInstructions?.[0]?.childRunId, task.childRunId);
  assert.equal(batch[0].executedQueuedInstructions?.[0]?.messageRef, queued.messageRef);
  assert.equal(batch[0].executedQueuedInstructions?.[0]?.instruction, "请继续补齐边界条件。");
  assert.equal(batch[0].completedRun.parentInstructions?.length, 1);
  assert.equal(batch[0].completedRun.parentInstructions?.[0]?.source, "control_api");
  assert.equal(batch[0].completedRun.parentInstructions?.[0]?.status, "executed");
  assert.equal(batch[0].completedRun.parentInstructions?.[0]?.messageRef, queued.messageRef);
  assert.equal(batch[0].completedRun.parentInstructions?.[0]?.instructionSummary, "请继续补齐边界条件。");
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "completed");
});

test("terminal child accepts immediate parent instruction through live queue handle and reuses childRunId", async () => {
  const continuedInstructions: string[] = [];
  const h = setupHarness({
    specs: [sampleSpec("terminal-followup")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec, parentInstruction, previousSummary) => {
      continuedInstructions.push(parentInstruction);
      assert.equal(childRun.childRunId, previousSummary?.childRunId);
      assert.equal(childSpec.specId, "terminal-followup");
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "completed",
        summary: "终态后追加指令并完成",
        findings: ["同一个终态 child run 被父层继续操作"],
        evidenceRefs: ["terminal-followup:evidence"],
        confidence: 0.82,
        uncertainty: "无",
      };
      return { summary, completedRun: childRun };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const waitInitial = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  const initialBatch = await waitInitial;
  assert.equal(initialBatch.length, 1);
  assert.equal(initialBatch[0].completedRun.childRunId, task.childRunId);
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "completed");

  const handle = h.scheduler.getInstructionQueueHandle();
  const queued = handle.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "请继续审查刚才遗漏的失败恢复路径。",
  });
  assert.equal(queued.status, "not_accepting");
  assert.equal(queued.childStatus, "completed");

  const continued = await handle.continueChildInstruction({
    childRunId: task.childRunId,
    instruction: "请继续审查刚才遗漏的失败恢复路径。",
  });
  assert.equal(continued.status, "continued");
  if (continued.status !== "continued") {
    throw new Error("expected continued child instruction");
  }
  assert.equal(continued.childRunId, task.childRunId);
  assert.equal(continued.material.completedRun.childRunId, task.childRunId);
  assert.equal(continued.material.summary.summary, "终态后追加指令并完成");
  assert.deepEqual(continuedInstructions, ["请继续审查刚才遗漏的失败恢复路径。"]);
  assert.equal(continued.material.completedRun.parentInstructions?.length, 1);
  assert.equal(continued.material.completedRun.parentInstructions?.[0]?.source, "control_api");
  assert.equal(continued.material.completedRun.parentInstructions?.[0]?.status, "executed");
  assert.equal(
    continued.material.completedRun.parentInstructions?.[0]?.messageRef,
    `child_message:${continued.material.completedRun.parentInstructions?.[0]?.instructionId}`,
  );
  assert.equal(
    continued.material.completedRun.parentInstructions?.[0]?.instructionSummary.includes("失败恢复路径"),
    true,
  );

  const ready = h.scheduler.harvestReady();
  assert.equal(ready.length, 1, "live executor 应能回收控制 API 续跑后的新材料");
  assert.equal(ready[0].completedRun.childRunId, task.childRunId);
  assert.equal(ready[0].summary.summary, "终态后追加指令并完成");
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "completed");
  assert.equal(h.events.filter((event) => event.kind === "terminal").length, 2);
});

test("failed child accepts parent follow-up and resumes the same childRunId", async () => {
  const continuedInstructions: string[] = [];
  const h = setupHarness({
    specs: [sampleSpec("failed-followup")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec, parentInstruction, previousSummary) => {
      continuedInstructions.push(parentInstruction);
      assert.equal(childRun.status, "failed");
      assert.equal(childRun.childRunId, previousSummary?.childRunId);
      assert.equal(previousSummary?.status, "failed");
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "completed",
        summary: "失败后沿用同一个子 Agent 补齐材料",
        findings: ["父层追加消息让异常终态 child 继续工作"],
        evidenceRefs: ["failed-followup:evidence"],
        confidence: 0.71,
        uncertainty: "仍需父层综合审查。",
      };
      return {
        summary,
        completedRun: completeChildAgentRun({
          run: childRun,
          outputRefs: ["failed-followup:output"],
          evidenceRefs: summary.evidenceRefs,
          confidence: summary.confidence,
          uncertainty: summary.uncertainty,
          execution: {
            modelRounds: 1,
            toolRounds: 0,
            toolCalls: [],
          },
          completedAt: "2026-05-01T00:00:02.000Z",
        }),
      };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const waitInitial = h.scheduler.waitForProgress();
  h.resolveFailed(task.childRunId);
  const initialBatch = await waitInitial;
  assert.equal(initialBatch[0]?.completedRun.status, "failed");
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "failed");

  const continued = await h.scheduler.getInstructionQueueHandle().continueChildInstruction({
    childRunId: task.childRunId,
    instruction: "请沿用这个子 Agent，从失败点继续补齐可用材料。",
  });

  assert.equal(continued.status, "continued");
  if (continued.status !== "continued") {
    throw new Error("expected failed child to continue");
  }
  assert.equal(continued.childRunId, task.childRunId);
  assert.deepEqual(continuedInstructions, ["请沿用这个子 Agent，从失败点继续补齐可用材料。"]);
  assert.equal(continued.material.completedRun.childRunId, task.childRunId);
  assert.equal(continued.material.completedRun.status, "completed");
  assert.deepEqual(continued.material.completedRun.evidenceRefs, ["failed-followup:evidence"]);
  assert.equal(continued.material.completedRun.parentInstructions?.length, 1);
  assert.equal(continued.material.completedRun.parentInstructions?.[0]?.source, "control_api");
  assert.equal(continued.material.completedRun.parentInstructions?.[0]?.status, "executed");
  assert.equal(
    continued.material.completedRun.parentInstructions?.[0]?.messageRef,
    `child_message:${continued.material.completedRun.parentInstructions?.[0]?.instructionId}`,
  );
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "completed");
  assert.equal(h.scheduler.snapshot().tasks.length, 1, "父层续跑失败 child 不应创建新 child");
});

test("interrupted child remains reviewable and resumes the same childRunId", async () => {
  const continuedInstructions: string[] = [];
  const h = setupHarness({
    specs: [sampleSpec("interrupted-followup")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec, parentInstruction, previousSummary) => {
      continuedInstructions.push(parentInstruction);
      assert.equal(childRun.status, "interrupted");
      assert.equal(childRun.childRunId, previousSummary?.childRunId);
      assert.equal(previousSummary?.status, "interrupted");
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "completed",
        summary: "中断后沿用同一个子 Agent 继续完成",
        findings: ["父层让中断 child 从原 run 继续，而非新建 child"],
        evidenceRefs: ["interrupted-followup:evidence"],
        confidence: 0.69,
        uncertainty: "仍需父层重新综合。",
      };
      return {
        summary,
        completedRun: completeChildAgentRun({
          run: childRun,
          outputRefs: ["interrupted-followup:output"],
          evidenceRefs: summary.evidenceRefs,
          confidence: summary.confidence,
          uncertainty: summary.uncertainty,
          execution: {
            modelRounds: 1,
            toolRounds: 0,
            toolCalls: [],
          },
          completedAt: "2026-05-01T00:00:02.000Z",
        }),
      };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const waitInitial = h.scheduler.waitForProgress();
  h.resolveInterrupted(task.childRunId);
  const initialBatch = await waitInitial;
  assert.equal(initialBatch[0]?.task.status, "interrupted");
  assert.equal(initialBatch[0]?.summary.status, "interrupted");
  assert.equal(initialBatch[0]?.completedRun.status, "interrupted");
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "interrupted");

  const continued = await h.scheduler.getInstructionQueueHandle().continueChildInstruction({
    childRunId: task.childRunId,
    instruction: "请沿用这个中断的子 Agent，从停止处继续补齐材料。",
  });

  assert.equal(continued.status, "continued");
  if (continued.status !== "continued") {
    throw new Error("expected interrupted child to continue");
  }
  assert.equal(continued.childRunId, task.childRunId);
  assert.deepEqual(continuedInstructions, ["请沿用这个中断的子 Agent，从停止处继续补齐材料。"]);
  assert.equal(continued.material.completedRun.childRunId, task.childRunId);
  assert.equal(continued.material.completedRun.status, "completed");
  assert.equal(continued.material.completedRun.parentInstructions?.[0]?.source, "control_api");
  assert.equal(continued.material.completedRun.parentInstructions?.[0]?.status, "executed");
  assert.equal(h.scheduler.snapshot().tasks[0]?.status, "completed");
  assert.equal(h.scheduler.snapshot().tasks.length, 1, "父层续跑中断 child 不应创建新 child");
});

test("stopped scheduler rejects queued parent instruction for running child and clears pending follow-ups", async () => {
  const continuedInstructions: string[] = [];
  const h = setupHarness({
    specs: [sampleSpec("stopped-followup")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec, parentInstruction) => {
      continuedInstructions.push(parentInstruction);
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "completed",
        summary: "追加指令后完成",
        findings: [],
        evidenceRefs: [],
        confidence: 0,
        uncertainty: "无",
      };
      return { summary, completedRun: childRun };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  assert.equal(
    h.scheduler.queueChildInstruction({
      childRunId: task.childRunId,
      instruction: "停止前已排队，但停止后不应执行。",
    }).status,
    "queued",
  );
  h.scheduler.cancelPendingAndRunning("stop before follow-up");

  const queued = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "停止后不应再追加。",
  });

  assert.equal(queued.status, "not_accepting");
  assert.equal(queued.childStatus, "running");
  assert.equal(queued.reason, "child scheduler is stopped");

  const waitProg = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  const batch = await waitProg;
  assert.equal(batch.length, 1);
  assert.equal(batch[0].summary.summary, `${task.childRunId} 探索完成`);
  assert.deepEqual(continuedInstructions, []);
  assert.equal(batch[0].completedRun.parentInstructions?.length, 1);
  assert.equal(batch[0].completedRun.parentInstructions?.[0]?.status, "cancelled");
});

test("child Agent runner 返回 failed 时映射为 failed task 并保留执行事实", async () => {
  const h = setupHarness({
    specs: [sampleSpec("invalid")],
    maxConcurrency: 1,
  });
  h.scheduler.startQueued();
  const task = h.tasks[0];
  const waitProg = h.scheduler.waitForProgress();
  h.resolveFailed(task.childRunId);
  const batch = await waitProg;

  assert.equal(batch.length, 1);
  assert.equal(batch[0].task.status, "failed");
  assert.equal(batch[0].summary.status, "failed");
  assert.equal(batch[0].completedRun.status, "failed");
  assert.equal(batch[0].completedRun.execution?.modelRounds, 2);
  assert.equal(batch[0].completedRun.execution?.toolCalls[0]?.toolName, "search");
  assert.equal(batch[0].completedRun.executionHistory?.length, 1);
  assert.equal(batch[0].completedRun.executionHistory?.[0]?.outcome, "failed");
  assert.equal(batch[0].task.failure, "invalid child material");
  assert.equal(
    h.scheduler.snapshot().tasks[0]?.summary?.status,
    "failed",
    "failed task 应保留安全 summary 供父层审查和实时投影使用",
  );
  assert.equal(
    h.events.find((e) => e.kind === "terminal")?.status,
    "failed",
  );
});

test("enqueue 复用 deriveDeepChildren 守数量上限：overflowCount 可观察，addedCount 受 maxChildren 约束", () => {
  const h = setupHarness({
    specs: [sampleSpec("a"), sampleSpec("b"), sampleSpec("c"), sampleSpec("d"), sampleSpec("e")],
    maxConcurrency: 3,
    maxChildren: 3,
  });
  assert.equal(h.tasks.length, 3);
  // 入板全 pending
  assert.equal(h.scheduler.snapshot().tasks.filter((t) => t.status === "pending").length, 3);
});

test("scheduler.snapshot 委托 board.snapshot（运行中事实源对外投影，FR-TB-02）", () => {
  const h = setupHarness({
    specs: [sampleSpec("a")],
    maxConcurrency: 2,
  });
  h.scheduler.getBoard().setPhase("exploring");
  const snap = h.scheduler.snapshot();
  assert.equal(snap.phase, "exploring");
  assert.equal(snap.tasks.length, 1);
});
