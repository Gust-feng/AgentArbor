/** Core concurrency and terminal-state behavior for DeepChildScheduler. */
import assert from "node:assert/strict";
import test from "node:test";
import { sampleSpec, setupHarness } from "./deep-child-scheduler-test-support.js";

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
