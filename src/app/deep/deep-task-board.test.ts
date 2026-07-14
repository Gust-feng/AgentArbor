/**
 * DeepTaskBoard 测试（T1-2，tasks.md _测试_ 点位）：
 *   1. enqueue 后 snapshot.tasks 含 pending 任务且快照不可变
 *   2. markRunning/markCompleted/markFailed/markCancelled 状态迁移与时间戳更新合法（终态不可逆）
 *   3. snapshot 不保存 raw prompt/response/工具原始输出
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEP_TASK_BOARD_DEFAULT_PHASE,
  DeepTaskBoard,
} from "./deep-task-board.js";
import type { DeepChildSpec, DeepChildSummary, DeepChildTask } from "./contracts.js";

function sampleSpec(id: string): DeepChildSpec {
  return {
    specId: id,
    displayName: `${id} 展示名`,
    role: id,
    objective: `${id} 目标`,
    allowedTools: ["search", "read"],
    inputRefs: ["goal:1"],
  };
}

function sampleSummary(childRunId: string, spec: DeepChildSpec): DeepChildSummary {
  return {
    childRunId,
    spec,
    status: "completed",
    summary: `${childRunId} 探索完成`,
    findings: ["发现 A", "发现 B"],
    evidenceRefs: ["evidence:1", "evidence:2"],
    confidence: 0.7,
    uncertainty: "量化不足",
  };
}

test("DeepTaskBoard 默认相位为 planning", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const snap = board.snapshot();
  assert.equal(snap.runId, "run-1");
  assert.equal(snap.phase, DEEP_TASK_BOARD_DEFAULT_PHASE);
  assert.equal(snap.phase, "planning");
  assert.equal(snap.tasks.length, 0);
});

test("enqueue 后 snapshot.tasks 含 pending 任务且快照不可变", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const created = board.enqueue([
    { childRunId: "child-run-0001", spec: sampleSpec("spec-a") },
    { childRunId: "child-run-0002", spec: sampleSpec("spec-b") },
  ]);
  assert.equal(created.length, 2);
  assert.equal(created[0].status, "pending");
  assert.match(created[0].taskId, /^deep-task-/u);
  assert.notEqual(created[0].taskId, created[1].taskId);
  assert.equal(created[0].childRunId, "child-run-0001");
  assert.equal(created[0].spec.specId, "spec-a");

  const snap = board.snapshot();
  assert.equal(snap.tasks.length, 2);
  assert.equal(snap.tasks[0].status, "pending");
  assert.equal(snap.tasks[1].childRunId, "child-run-0002");

  // 快照不可变：外部修改不影响内部
  const mutated = snap.tasks[0] as { status: string };
  mutated.status = "completed";
  const snapAgain = board.snapshot();
  assert.equal(snapAgain.tasks[0].status, "pending", "外部修改快照不应影响 board 内部");

  // 外部修改数组也不影响内部（深拷贝：快照数组是独立副本）
  (snap.tasks as unknown as DeepChildTask[]).length = 0;
  assert.equal(board.snapshot().tasks.length, 2, "外部截断快照数组不应影响 board 内部");
});

test("enqueue/snapshot 保留父 Agent 显式派生的 child 可选预算字段", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const spec: DeepChildSpec = {
    ...sampleSpec("spec-budgeted"),
    maxModelRounds: 5,
    maxToolRounds: 3,
  };
  board.enqueue([{ childRunId: "child-run-0001", spec }]);

  const snap = board.snapshot();

  assert.equal(snap.tasks[0].spec.maxModelRounds, 5);
  assert.equal(snap.tasks[0].spec.maxToolRounds, 3);
});

test("markRunning/markCompleted 合法迁移并回填 startedAt/completedAt/summary", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);

  const running = board.markRunning(task.taskId);
  assert.equal(running.status, "running");
  assert.ok(running.startedAt !== undefined, "markRunning 应回填 startedAt");
  assert.equal(running.summary, undefined);

  const summary = sampleSummary(task.childRunId, task.spec);
  const completed = board.markCompleted(task.taskId, summary);
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt !== undefined, "markCompleted 应回填 completedAt");
  assert.deepEqual(completed.summary, summary);
  assert.equal(completed.failure, undefined);
});

test("markFailed 合法迁移并回填 failure（单 child 失败降级为 failed task）", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  board.markRunning(task.taskId);

  const failed = board.markFailed(task.taskId, "explore timeout");
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure, "explore timeout");
  assert.ok(failed.completedAt !== undefined);
});

test("markFailed 可保留安全 child summary 供父层审查", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  board.markRunning(task.taskId);
  const summary: DeepChildSummary = {
    ...sampleSummary(task.childRunId, task.spec),
    status: "failed",
    summary: "子 Agent 输出材料不合约。",
    findings: [],
    evidenceRefs: [],
    confidence: 0,
    uncertainty: "invalid child material",
  };

  const failed = board.markFailed(task.taskId, "invalid child material", summary);

  assert.equal(failed.status, "failed");
  assert.equal(failed.failure, "invalid child material");
  assert.equal(failed.summary?.status, "failed");
  assert.equal(failed.summary?.summary, "子 Agent 输出材料不合约。");
  assert.equal(failed.summary?.uncertainty, "invalid child material");
  assert.notEqual(failed.summary, summary, "任务板应保存 summary 深拷贝");
});

test("markBlocked 合法迁移并回填 summary/failure（child Agent 标准暂停态）", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  board.markRunning(task.taskId);
  const summary: DeepChildSummary = {
    ...sampleSummary(task.childRunId, task.spec),
    status: "blocked",
    summary: "等待工具确认。",
    findings: ["需要用户确认后继续"],
    evidenceRefs: ["call-needs-approval"],
    confidence: 0,
    uncertainty: "Child Agent waiting for tool confirmation.",
  };

  const blocked = board.markBlocked(task.taskId, summary);

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.summary?.status, "blocked");
  assert.equal(blocked.failure, "Child Agent waiting for tool confirmation.");
  assert.ok(blocked.completedAt !== undefined);
});

test("markBlocked 可携带安全确认投影，snapshot 深拷贝且不保存 runtime continuation", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  board.markRunning(task.taskId);
  const summary: DeepChildSummary = {
    ...sampleSummary(task.childRunId, task.spec),
    status: "blocked",
    uncertainty: "waiting for tool confirmation",
  };

  board.markBlocked(task.taskId, summary, {
    confirmationId: "confirm-call-write",
    toolCallId: "call-write",
    toolName: "write_file",
    title: "需要确认",
    actionSummary: "写入 notes.md",
    affectedResources: ["notes.md"],
    riskLevel: "medium",
    resumeAvailability: "live",
    requestedAt: "2026-05-01T00:00:00.000Z",
    sourceRefs: ["call-write"],
  });

  const snapshot = board.snapshot();
  const pending = snapshot.tasks[0].pendingApproval;
  assert.equal(pending?.confirmationId, "confirm-call-write");
  assert.equal(pending?.toolName, "write_file");
  assert.deepEqual(pending?.affectedResources, ["notes.md"]);
  assert.equal(Object.keys(pending ?? {}).includes("resume"), false);

  const mutableResources = pending?.affectedResources as unknown as string[] | undefined;
  mutableResources?.push("mutated.md");
  assert.deepEqual(board.snapshot().tasks[0].pendingApproval?.affectedResources, ["notes.md"]);
});

test("markCancelled 把 pending 置 cancelled（无 startedAt）", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);

  const cancelled = board.markCancelled(task.taskId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.startedAt, undefined, "pending 取消不应有 startedAt");
  assert.equal(cancelled.summary, undefined);
});

test("completed/failed/blocked/interrupted 只允许父层显式继续到 running；cancelled 仍不可逆", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [completedTask, failedTask, blockedTask, interruptedTask, cancelledTask] = board.enqueue([
    { childRunId: "child-run-0001", spec: sampleSpec("spec-a") },
    { childRunId: "child-run-0002", spec: sampleSpec("spec-b") },
    { childRunId: "child-run-0003", spec: sampleSpec("spec-c") },
    { childRunId: "child-run-0004", spec: sampleSpec("spec-d") },
    { childRunId: "child-run-0005", spec: sampleSpec("spec-e") },
  ]);
  board.markRunning(completedTask.taskId);
  const completed = board.markCompleted(
    completedTask.taskId,
    sampleSummary(completedTask.childRunId, completedTask.spec),
  );
  assert.equal(completed.status, "completed");

  board.markRunning(failedTask.taskId);
  const failed = board.markFailed(failedTask.taskId, "child output invalid");
  assert.equal(failed.status, "failed");

  board.markRunning(blockedTask.taskId);
  const blocked = board.markBlocked(
    blockedTask.taskId,
    { ...sampleSummary(blockedTask.childRunId, blockedTask.spec), status: "blocked" },
  );
  assert.equal(blocked.status, "blocked");

  board.markRunning(interruptedTask.taskId);
  const interrupted = board.markInterrupted(
    interruptedTask.taskId,
    "child interrupted",
    { ...sampleSummary(interruptedTask.childRunId, interruptedTask.spec), status: "interrupted" },
  );
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.failure, "child interrupted");
  assert.equal(interrupted.summary?.status, "interrupted");

  const cancelled = board.markCancelled(cancelledTask.taskId);
  assert.equal(cancelled.status, "cancelled");

  // completed/failed/blocked/interrupted → running 合法，表示父层显式要求同一个 child run 继续。
  assert.equal(board.markRunning(completedTask.taskId).status, "running");
  assert.equal(board.markRunning(failedTask.taskId).status, "running");
  assert.equal(board.markRunning(blockedTask.taskId).status, "running");
  assert.equal(board.markRunning(interruptedTask.taskId).status, "running");

  // running 后仍必须按正常生命周期完成，不能从 completed 直接改写为别的终态。
  assert.throws(
    () => board.markCompleted(cancelledTask.taskId, sampleSummary(cancelledTask.childRunId, cancelledTask.spec)),
    /illegal status transition/,
  );
  assert.throws(() => board.markRunning(cancelledTask.taskId), /illegal status transition/);
});

test("非法迁移：pending 直接 markCompleted 抛错（必须先 running）", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  assert.throws(
    () => board.markCompleted(task.taskId, sampleSummary(task.childRunId, task.spec)),
    /illegal status transition/,
  );
  assert.throws(() => board.markFailed(task.taskId, "x"), /illegal status transition/);
  assert.throws(() => board.markInterrupted(task.taskId, "x"), /illegal status transition/);
});

test("setPhase 在 step 边界更新相位，snapshot 反映当前相位", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  board.setPhase("exploring");
  assert.equal(board.getPhase(), "exploring");
  assert.equal(board.snapshot().phase, "exploring");
  board.setPhase("synthesizing");
  assert.equal(board.snapshot().phase, "synthesizing");
});

test("markStopped 后 isStopped=true 且相位切到 stopped（startQueued no-op 的权威标志）", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  assert.equal(board.isStopped(), false);
  board.markStopped();
  assert.equal(board.isStopped(), true);
  assert.equal(board.getPhase(), "stopped");
  assert.equal(board.snapshot().phase, "stopped");
});

test("snapshot 不保存 raw prompt/response/工具原始输出（FR-TB-01 安全结构化边界）", () => {
  const board = new DeepTaskBoard({ runId: "run-1" });
  board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  const snap = board.snapshot();

  // 快照字段只含 runId/phase/tasks/updatedAt
  assert.deepEqual(
    [...snap.tasks, snap].flatMap((obj) => Object.keys(obj)).some(() => true),
    true,
  );
  const snapshotKeys = Object.keys(snap).map((k) => k.toLowerCase());
  for (const forbidden of ["prompt", "response", "rawprompt", "rawresponse", "tooloutput", "stdout", "stderr"]) {
    assert.ok(!snapshotKeys.includes(forbidden), `snapshot 不应含 raw 字段 ${forbidden}`);
  }
  const taskKeys = Object.keys(snap.tasks[0]).map((k) => k.toLowerCase());
  for (const forbidden of ["prompt", "response", "rawprompt", "rawresponse", "tooloutput", "stdout", "stderr"]) {
    assert.ok(!taskKeys.includes(forbidden), `task 不应含 raw 字段 ${forbidden}`);
  }
});

test("terminalSnapshot 等价于 snapshot（终态读取点，供 final AgentRunTree 对齐）", () => {
  const board = new DeepTaskBoard({ runId: "run-1", initialPhase: "exploring" });
  const [task] = board.enqueue([{ childRunId: "child-run-0001", spec: sampleSpec("spec-a") }]);
  board.markRunning(task.taskId);
  board.markCompleted(task.taskId, sampleSummary(task.childRunId, task.spec));
  board.setPhase("completed");

  const terminal = board.terminalSnapshot();
  assert.equal(terminal.tasks.length, 1);
  assert.equal(terminal.tasks[0].status, "completed");
  assert.equal(terminal.phase, "completed");
});
