/** Parent-instruction queue and terminal child continuation behavior for DeepChildScheduler. */
import assert from "node:assert/strict";
import test from "node:test";
import { completeChildAgentRun } from "../../domain/underground/agent-fabric.js";
import type { DeepChildSummary } from "./contracts.js";
import {
  fakePendingApproval,
  sampleSpec,
  setupHarness,
  type SchedulerEvent,
} from "./deep-child-scheduler-test-support.js";
import { DeepChildExecutionAdmissionError } from "./deep-child-run-contracts.js";

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

test("queued parent instruction keeps executed history in a pending confirmation continuation", async () => {
  const pendingApproval = fakePendingApproval("confirm-queued-followup");
  let continuationCalls = 0;
  const h = setupHarness({
    specs: [sampleSpec("queued-followup-confirmation")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec) => {
      continuationCalls += 1;
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "blocked",
        summary: "排队指令已执行并等待确认。",
        findings: ["确认 continuation 必须携带 executed 指令历史"],
        evidenceRefs: [],
        confidence: 0,
        uncertainty: "waiting for confirmation",
      };
      return {
        summary,
        completedRun: childRun,
        pendingContinuation: {
          childRunId: childRun.childRunId,
          confirmationId: pendingApproval.confirmationId,
          childRun,
          childSpec,
          pendingApproval,
        },
      };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const queued = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "执行后等待用户确认。",
  });
  const queuedAfterApproval = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "确认未决时不得继续执行这条指令。",
  });
  assert.equal(queued.status, "queued");
  assert.equal(queuedAfterApproval.status, "queued");

  const progress = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  const [material] = await progress;

  assert.equal(continuationCalls, 1, "pending approval must stop FIFO continuation consumption");
  assert.equal(material?.completedRun.parentInstructions?.[0]?.status, "executed");
  assert.equal(material?.completedRun.parentInstructions?.[1]?.status, "cancelled");
  assert.equal(
    material?.pendingContinuation?.childRun.parentInstructions?.[0]?.status,
    "executed",
  );
  assert.equal(
    material?.pendingContinuation?.childRun.parentInstructions?.[0]?.instructionId,
    queued.status === "queued" ? queued.instructionId : undefined,
  );
  assert.equal(
    material?.pendingContinuation?.childRun.parentInstructions?.[1]?.instructionId,
    queuedAfterApproval.status === "queued" ? queuedAfterApproval.instructionId : undefined,
  );
  assert.equal(
    material?.pendingContinuation?.childRun.parentInstructions?.[1]?.status,
    "cancelled",
  );
});

test("initial child approval cancels queued follow-ups without starting another continuation", async () => {
  let continuationCalls = 0;
  const h = setupHarness({
    specs: [sampleSpec("initial-approval-owns-child")],
    maxConcurrency: 1,
    continueFactory: async () => {
      continuationCalls += 1;
      throw new Error("queued continuation must not start while approval is pending");
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const queued = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "确认未决时不得执行。",
  });
  assert.equal(queued.status, "queued");

  const progress = h.scheduler.waitForProgress();
  h.resolveBlockedWithContinuation(task.childRunId);
  const [material] = await progress;

  assert.equal(continuationCalls, 0);
  assert.ok(material?.pendingContinuation);
  assert.equal(material?.completedRun.status, "blocked");
  assert.equal(material?.completedRun.parentInstructions?.at(-1)?.status, "cancelled");
  assert.equal(
    material?.pendingContinuation?.childRun.parentInstructions?.at(-1)?.status,
    "cancelled",
  );
  assert.equal(material?.executedQueuedInstructions?.length, 0);
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
  assert.equal(continued.material.executedQueuedInstructions?.length, 1);
  assert.equal(continued.material.executedQueuedInstructions?.[0]?.source, "control_api");
  assert.equal(
    continued.material.executedQueuedInstructions?.[0]?.instructionId,
    continued.material.completedRun.parentInstructions?.[0]?.instructionId,
  );
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

test("terminal child marks an immediate parent instruction cancelled when execution admission is rejected", async () => {
  const h = setupHarness({
    specs: [sampleSpec("terminal-admission-rejected")],
    maxConcurrency: 1,
    continueFactory: async () => {
      throw new DeepChildExecutionAdmissionError(
        new Error("fixture instruction marker write failed before model execution"),
      );
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const initial = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  await initial;

  const continued = await h.scheduler.getInstructionQueueHandle().continueChildInstruction({
    childRunId: task.childRunId,
    instruction: "只有 write-ahead 成功后才能执行。",
  });

  assert.equal(continued.status, "continued");
  if (continued.status !== "continued") {
    throw new Error("expected admission rejection to return terminal material");
  }
  assert.equal(continued.material.completedRun.status, "failed");
  assert.equal(continued.material.completedRun.parentInstructions?.at(-1)?.status, "cancelled");
  assert.equal(continued.material.completedRun.parentInstructions?.at(-1)?.executedAt, undefined);
  assert.equal(
    h.events.some((event) =>
      event.kind === "instruction_recorded" &&
      event.status === "cancelled" &&
      event.instruction === "只有 write-ahead 成功后才能执行。"
    ),
    true,
  );
  assert.equal(
    h.events.some((event) => event.kind === "instruction_recorded" && event.status === "executed"),
    false,
  );
});

test("queued parent instruction stays queued when continuation outcome is unknown", async () => {
  const h = setupHarness({
    specs: [sampleSpec("queued-outcome-unknown")],
    maxConcurrency: 1,
    continueFactory: async () => {
      throw new Error("fixture continuation result was lost after admission");
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  assert.equal(
    h.scheduler.queueChildInstruction({
      childRunId: task.childRunId,
      instruction: "继续执行，但不要在结果不明时声称完成。",
    }).status,
    "queued",
  );

  const progress = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  const [material] = await progress;

  assert.equal(material?.completedRun.status, "failed");
  assert.equal(material?.completedRun.parentInstructions?.at(-1)?.status, "queued");
  assert.equal(material?.completedRun.parentInstructions?.at(-1)?.executedAt, undefined);
  assert.equal(
    h.events.some((event) => event.kind === "instruction_recorded" && event.status === "executed"),
    false,
  );
});

test("earlier executed queued instructions remain auditable when a later FIFO admission fails", async () => {
  let continuationCalls = 0;
  const h = setupHarness({
    specs: [sampleSpec("queued-partial-audit")],
    maxConcurrency: 1,
    continueFactory: async (childRun, childSpec) => {
      continuationCalls += 1;
      if (continuationCalls === 2) {
        throw new DeepChildExecutionAdmissionError(
          new Error("fixture second queued instruction admission failed"),
        );
      }
      const summary: DeepChildSummary = {
        childRunId: childRun.childRunId,
        spec: childSpec,
        status: "completed",
        summary: "第一条排队指令已执行。",
        findings: ["第一条执行事实必须保留"],
        evidenceRefs: ["queued:first:executed"],
        confidence: 0.7,
        uncertainty: "第二条尚未准入。",
      };
      return {
        summary,
        completedRun: completeChildAgentRun({
          run: childRun,
          outputRefs: ["queued:first:output"],
          evidenceRefs: summary.evidenceRefs,
          confidence: summary.confidence,
          uncertainty: summary.uncertainty,
          execution: {
            modelRounds: 1,
            toolRounds: 1,
            toolCalls: [{
              callId: "queued-first-tool-call",
              toolName: "search",
              status: "completed",
            }],
          },
          completedAt: "2026-05-01T00:00:03.000Z",
        }),
      };
    },
  });
  const task = h.tasks[0];
  h.scheduler.startQueued();
  const first = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "先执行第一条。",
  });
  const second = h.scheduler.queueChildInstruction({
    childRunId: task.childRunId,
    instruction: "再执行第二条。",
  });
  assert.equal(first.status, "queued");
  assert.equal(second.status, "queued");

  const progress = h.scheduler.waitForProgress();
  h.resolveSuccess(task.childRunId);
  const [material] = await progress;

  assert.equal(material?.completedRun.parentInstructions?.[0]?.status, "executed");
  assert.equal(material?.completedRun.parentInstructions?.[1]?.status, "cancelled");
  assert.deepEqual(material?.completedRun.evidenceRefs, ["queued:first:executed"]);
  assert.equal(
    material?.completedRun.executionHistory?.some((segment) =>
      segment.toolCalls.some((call) => call.callId === "queued-first-tool-call")
    ),
    true,
  );
  assert.deepEqual(material?.summary.evidenceRefs, ["queued:first:executed"]);
  assert.equal(material?.executedQueuedInstructions?.length, 1);
  assert.equal(
    material?.executedQueuedInstructions?.[0]?.instructionId,
    first.status === "queued" ? first.instructionId : undefined,
  );
  assert.equal(
    material?.executedQueuedInstructions?.some((instruction) =>
      instruction.instructionId === (second.status === "queued" ? second.instructionId : "")
    ),
    false,
  );
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
