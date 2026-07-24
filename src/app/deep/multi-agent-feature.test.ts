import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
  SanitizedInformationAccessConfig,
} from "../../domain/config/index.js";
import type {
  IntelligenceChannel,
  ModelRequest,
  ModelResponse,
} from "../../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../../domain/tools/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import { normalizeToolFactValue } from "../../domain/tools/index.js";
import {
  DeepChildPendingContinuationStore,
  type DeepChildPendingContinuation,
  type DeepChildPendingContinuationRetentionOptions,
} from "./deep-child-continuations.js";
import {
  InMemoryDeepRunRecordStore,
  type DeepRunRecordStore,
} from "./deep-run-record-store.js";
import type {
  DeepChildInstructionContinueResult,
  DeepChildInstructionQueueHandle,
} from "./deep-child-scheduler-contracts.js";
import type { DeepChildLoopContextStore } from "./deep-child-loop-contexts.js";
import {
  type DeepRunRecordWriteCoordinator,
} from "./deep-run-record-write-coordinator.js";
import {
  createDeepChildMessageRecord,
  type DeepChildMessageStore,
} from "./deep-child-messages.js";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";
import {
  createMultiAgentFeatureTestFixture as createMultiAgentFeature,
} from "./tests/multi-agent-feature-test-support.js";

test("MultiAgentFeature gives each operation a fresh bus and awaits lease release", async () => {
  const buses: object[] = [];
  let releaseStarted = 0;
  let releaseCompleted = 0;
  let unblockFirstRelease: (() => void) | undefined;
  const firstReleaseGate = new Promise<void>((resolve) => {
    unblockFirstRelease = resolve;
  });
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ channelContext, capabilitySnapshot }) => {
      acquisitionCount += 1;
      const acquisition = acquisitionCount;
      buses.push(channelContext.bus);
      return {
        intelligenceChannel: directAnswerChannel(),
        toolCenter: emptyToolBroker(),
        capabilitySnapshot,
        release: async () => {
          releaseStarted += 1;
          if (acquisition === 1) {
            await firstReleaseGate;
          }
          releaseCompleted += 1;
        },
      };
    },
  });

  let firstSettled = false;
  const first = feature.intake({
    aiMode: "fake",
    message: "请直接回答第一个问题。",
  }).finally(() => {
    firstSettled = true;
  });
  await waitUntil(() => releaseStarted === 1);
  assert.equal(firstSettled, false, "command must remain pending until resource release finishes");
  unblockFirstRelease?.();
  assert.equal((await first).status, "answered");
  assert.equal(releaseCompleted, 1);

  const second = await feature.intake({
    aiMode: "fake",
    message: "请直接回答第二个问题。",
  });
  assert.equal(second.status, "answered");
  assert.equal(releaseCompleted, 2);
  assert.equal(buses.length, 2);
  assert.notEqual(buses[0], buses[1], "operations must not share an unbounded feature-lifetime bus");

  await feature.dispose();
});

test("MultiAgentFeature preserves an intake result when lease release fails", async () => {
  const releaseFailures: unknown[] = [];
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: directAnswerChannel(),
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => {
        throw new Error("fixture intake release failed");
      },
    }),
    reportBackgroundFailure: ({ error }) => {
      releaseFailures.push(error);
    },
  });

  const result = await feature.intake({
    aiMode: "fake",
    message: "请直接回答，清理失败不能覆盖回答。",
  });
  assert.equal(result.status, "answered");
  assert.equal(releaseFailures.length, 1);
  assert.match(String(releaseFailures[0]), /fixture intake release failed/);
  await feature.dispose();
});

test("MultiAgentFeature stops admission synchronously and waits for in-flight command setup", async () => {
  const operationStarted = deferred<void>();
  const operationGate = deferred<void>();
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => {
      operationStarted.resolve();
      await operationGate.promise;
      return {
        capabilitySnapshot: capabilitySnapshot(),
        informationAccess: informationAccess(),
        confirmationPolicy: "full_access",
      };
    },
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: directAnswerChannel(),
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
  const inFlight = feature.intake({
    aiMode: "fake",
    message: "请直接回答正在进入关闭阶段的问题。",
  });
  await operationStarted.promise;

  let disposeSettled = false;
  const disposing = feature.dispose().finally(() => {
    disposeSettled = true;
  });
  await assert.rejects(
    feature.createConversation({
      aiMode: "fake",
      goal: "关闭后不得创建会话。",
    }),
    (error) => error instanceof Error
      && "code" in error
      && error.code === "feature_quiescing",
  );
  assert.equal(disposeSettled, false);

  operationGate.resolve();
  assert.equal((await inFlight).status, "answered");
  await disposing;
  assert.equal(disposeSettled, true);
});

test("MultiAgentFeature waitForIdle waits for the run-record write drain", async () => {
  const feature = createMultiAgentFeature();
  const internal = feature as typeof feature & {
    readonly runRecordWrites: {
      drain: () => Promise<void>;
    };
  };
  const drainStarted = deferred<void>();
  const drainGate = deferred<void>();
  const originalDrain = internal.runRecordWrites.drain;
  internal.runRecordWrites.drain = async () => {
    drainStarted.resolve();
    await drainGate.promise;
  };

  let settled = false;
  const waiting = feature.waitForIdle().finally(() => {
    settled = true;
  });
  await drainStarted.promise;
  assert.equal(settled, false);
  drainGate.resolve();
  await waiting;
  internal.runRecordWrites.drain = originalDrain;
  await feature.dispose();
});

test("MultiAgentFeature keeps immediate control working before a durable run lookup", async () => {
  const modelStarted = deferred<void>();
  const modelGate = deferred<void>();
  const baseChannel = directRunChannel();
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "full_access",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: {
        async request(request: ModelRequest, options?: Parameters<IntelligenceChannel["request"]>[1]) {
          modelStarted.resolve();
          await modelGate.promise;
          return baseChannel.request(request, options);
        },
        validateResponse: (request: ModelRequest, response: ModelResponse) =>
          baseChannel.validateResponse(request, response),
      },
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "在初始 run 记录查询不可用时仍能立即停止。",
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  await modelStarted.promise;

  const internal = feature as typeof feature & {
    readonly runRecordStore: DeepRunRecordStore;
  };
  const originalGet = internal.runRecordStore.get;
  (internal.runRecordStore as { get: DeepRunRecordStore["get"] }).get = async () => undefined;
  try {
    const control = await feature.requestRunControl({
      runId: started.runId,
      action: "stop",
      reason: "立即停止测试",
    });
    assert.equal(control.status, "requested");
  } finally {
    (internal.runRecordStore as { get: DeepRunRecordStore["get"] }).get = originalGet;
  }

  modelGate.resolve();
  await feature.waitForIdle();
  await feature.dispose();
});

test("MultiAgentFeature owns background release failures through an explicit reporter", async () => {
  const failures: Array<{ readonly runId: string; readonly error: unknown }> = [];
  const frozenInformationAccess = informationAccess();
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: frozenInformationAccess,
      confirmationPolicy: "full_access",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: directRunChannel(),
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => {
        throw new Error("fixture release failed");
      },
    }),
    reportBackgroundFailure: ({ runId, error }) => {
      failures.push({ runId, error });
    },
  });
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "直接回答这个测试目标。",
    taskSoilInput: {
      permissionBoundaryRefs: ["read:workspace:fixture"],
    },
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });

  await feature.waitForIdle();
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.runId, started.runId);
  assert.match(String(failures[0]?.error), /fixture release failed/);
  const persisted = await feature.getRun(started.runId);
  assert.equal(persisted?.run.status, "completed");
  assert.deepEqual(persisted?.run.continuationFacts, {
    informationAccess: frozenInformationAccess,
    taskSoilInput: {
      permissionBoundaryRefs: ["read:workspace:fixture"],
    },
    permissionBoundaryRefs: ["read:workspace:fixture"],
    confirmationPolicy: "full_access",
  });
  assert.equal((await feature.queries.getRunRuntimeHealth(started.runId))?.state, "terminal");
  await assert.rejects(
    feature.requestRunControl({ runId: started.runId, action: "interrupt" }),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      error.code === "run_not_active"
    ),
    "terminal runs must reject control instead of acknowledging a stale handle",
  );

  await feature.dispose();
});

test("MultiAgentFeature reports cleanup failure without replacing the active run failure", async () => {
  const failures: unknown[] = [];
  const feature = createMultiAgentFeature({
    reportBackgroundFailure: ({ error }) => {
      failures.push(error);
    },
  });
  const primaryFailure = new Error("fixture active run failed");
  const cleanupFailure = new Error("fixture active run cleanup failed");
  const internal = feature as typeof feature & {
    readonly trackActiveRun: (input: {
      readonly runId: string;
      readonly conversationId: string;
      readonly promise: Promise<void>;
      readonly releaseResources?: () => void | Promise<void>;
    }) => void;
  };
  internal.trackActiveRun({
    runId: "deep-run-primary-and-cleanup-failure",
    conversationId: "deep-conversation-primary-and-cleanup-failure",
    promise: Promise.resolve().then(() => {
      throw primaryFailure;
    }),
    releaseResources: async () => {
      throw cleanupFailure;
    },
  });

  await feature.waitForIdle();
  assert.equal(failures.includes(primaryFailure), true);
  assert.equal(failures.includes(cleanupFailure), true);
  assert.equal(failures.length, 2);
  await feature.dispose();
});

test("MultiAgentFeature retries the complete final record without discarding child facts", async () => {
  const durable = new InMemoryDeepRunRecordStore();
  const failures: unknown[] = [];
  let failFinalRecord = true;
  const runRecordStore: DeepRunRecordStore = {
    upsert: async (record) => {
      if (
        failFinalRecord
        && record.run.status !== "running"
        && record.agentRunTree.childRuns.length > 0
      ) {
        failFinalRecord = false;
        throw new Error("fixture final run record write failed");
      }
      return durable.upsert(record);
    },
    get: (runId) => durable.get(runId),
    list: (limit) => durable.list(limit),
    listByConversation: (conversationId, limit) => durable.listByConversation(conversationId, limit),
    listByRootRun: (rootRunId, limit) => durable.listByRootRun(rootRunId, limit),
    delete: (runId) => durable.delete(runId),
  };
  const feature = createMultiAgentFeature({
    runRecordStore,
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: pendingApprovalRunChannel(),
      toolCenter: new ApprovalFixtureToolBroker("approval"),
      capabilitySnapshot,
      release: async () => undefined,
    }),
    reportBackgroundFailure: ({ error }) => {
      failures.push(error);
    },
  });

  const pending = await createPendingApprovalChild(feature);
  const record = await feature.getRun(pending.runId);
  assert.equal(record?.run.status, "completed");
  assert.equal(record?.agentRunTree.status, "completed");
  assert.ok(record?.report, "the retry must commit the complete report, not the earlier live snapshot");
  assert.equal(record?.report?.conclusion?.conclusion, "子 Agent 正在等待写入确认。");
  assert.equal(record?.agentRunTree.parentSyntheses.length, 1);
  assert.equal(record?.agentRunTree.childRuns[0]?.childRunId, pending.childRunId);
  assert.equal(record?.agentRunTree.childRuns[0]?.status, "blocked");
  assert.equal(record?.liveProjection?.children[0]?.childRunId, pending.childRunId);
  assert.equal(failures.length, 1);
  assert.match(String(failures[0]), /fixture final run record write failed/);
  await feature.dispose();
});

test("MultiAgentFeature restores run-start TaskSoil for child follow-up and resynthesis", async () => {
  const acquiredTaskSoils: TaskSoil[] = [];
  const releaseFailures: unknown[] = [];
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot, taskSoil }) => {
      acquisitionCount += 1;
      const leaseId = acquisitionCount;
      acquiredTaskSoils.push(taskSoil);
      return {
        intelligenceChannel: leaseId === 1
          ? pendingApprovalRunChannel()
          : leaseId === 3
            ? resumedChildChannel()
            : directRunChannel(),
        toolCenter: leaseId === 1
          ? new ApprovalFixtureToolBroker("approval")
          : emptyToolBroker(),
        capabilitySnapshot,
        release: async () => {
          if (leaseId === 4) {
            throw new Error("fixture resynthesis release failed");
          }
        },
      };
    },
    reportBackgroundFailure: ({ error }) => {
      releaseFailures.push(error);
    },
  });
  const attachmentRef = "local-file:C:/fixture/requirements.md";
  const attachmentId = "attachment-requirements";
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "核查附件后给出综合结论。",
    taskSoilInput: {
      contextRefs: [{
        attachmentId,
        ref: attachmentRef,
        kind: "file",
        title: "requirements.md",
        readonlyPreview: {
          title: "需求附件",
          text: "必须保留到后续 child 指令与重新综合。",
        },
      }],
      permissionBoundaryRefs: ["read:local-file:C:/fixture/requirements.md"],
    },
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  await feature.waitForIdle();
  const initialRecord = await feature.getRun(started.runId);
  const child = initialRecord?.agentRunTree.childRuns[0];
  assert.ok(child);
  assert.equal(child.status, "blocked");

  const laterAttachmentRef = "local-file:C:/fixture/later-turn.md";
  const followUp = await feature.followUp({
    runId: started.runId,
    aiMode: "fake",
    message: "这是后续一轮的新附件。",
    taskSoilInput: {
      contextRefs: [{
        attachmentId: "attachment-later-turn",
        ref: laterAttachmentRef,
        kind: "file",
        title: "later-turn.md",
      }],
      permissionBoundaryRefs: ["read:local-file:C:/fixture/later-turn.md"],
    },
  });
  await feature.waitForIdle();
  assert.notEqual(followUp.runId, started.runId);

  const continued = await feature.sendChildInstruction({
    runId: started.runId,
    childRunId: child.childRunId,
    message: "请结合最初附件继续完成核查。",
  });
  assert.equal(continued.status, "continued");
  const resynthesized = await feature.resynthesize({ runId: started.runId });
  assert.equal(resynthesized.liveProjection?.synthesis?.status, "completed");
  assert.equal(releaseFailures.length, 1);
  assert.match(String(releaseFailures[0]), /fixture resynthesis release failed/);

  assert.equal(acquiredTaskSoils.length, 4);
  assert.equal(acquiredTaskSoils[1]?.contextRefs.some((ref) => ref.ref === laterAttachmentRef), true);
  for (const taskSoil of acquiredTaskSoils.slice(2)) {
    const attachment = taskSoil.contextRefs.find((ref) => ref.ref === attachmentRef);
    assert.equal(attachment?.attachmentId, attachmentId);
    assert.equal(attachment?.readonlyPreview?.text, "必须保留到后续 child 指令与重新综合。");
    assert.equal(taskSoil.contextRefs.some((ref) => ref.ref === laterAttachmentRef), false);
  }
  await feature.dispose();
});

test("MultiAgentFeature projects a known post-terminal child result when message and release cleanup fail", async () => {
  let acquisitionCount = 0;
  const backgroundFailures: unknown[] = [];
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      const leaseId = acquisitionCount;
      return {
        intelligenceChannel: leaseId === 1 ? pendingApprovalRunChannel() : resumedChildChannel(),
        toolCenter: leaseId === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => {
          if (leaseId > 1) {
            throw new Error("fixture post-terminal release failed");
          }
        },
      };
    },
    reportBackgroundFailure: ({ error }) => {
      backgroundFailures.push(error);
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly childMessageStore: DeepChildMessageStore;
  };
  const messageStore = internal.childMessageStore as DeepChildMessageStore & {
    upsert: DeepChildMessageStore["upsert"];
  };
  const originalUpsert = messageStore.upsert;
  messageStore.upsert = async (record) => {
    if (record.status === "executed") {
      throw new Error("fixture post-terminal child message write failed");
    }
    return originalUpsert.call(messageStore, record);
  };
  try {
    const continued = await feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "继续完成同一个子任务。",
    });
    assert.equal(continued.status, "continued");
    assert.equal(continued.record.agentRunTree.childRuns[0]?.status, "completed");
    assert.equal(backgroundFailures.length, 2);
    assert.equal(
      backgroundFailures.some((error) => String(error).includes("fixture post-terminal child message write failed")),
      true,
    );
    assert.equal(
      backgroundFailures.some((error) => String(error).includes("fixture post-terminal release failed")),
      true,
    );
  } finally {
    messageStore.upsert = originalUpsert;
    await feature.dispose();
  }
});

test("MultiAgentFeature retries a known direct child projection without reacquiring runtime", async () => {
  let acquisitionCount = 0;
  let toolExecutions = 0;
  let failNextChildProjection = false;
  const durableRunRecords = new InMemoryDeepRunRecordStore();
  const runRecordStore: DeepRunRecordStore = {
    upsert: async (record) => {
      if (
        failNextChildProjection
        && record.agentRunTree.childRuns.some((childRun) => childRun.status === "completed")
      ) {
        failNextChildProjection = false;
        throw new Error("fixture direct child projection failed");
      }
      return durableRunRecords.upsert(record);
    },
    get: (runId) => durableRunRecords.get(runId),
    list: (limit) => durableRunRecords.list(limit),
    listByConversation: (conversationId, limit) =>
      durableRunRecords.listByConversation(conversationId, limit),
    listByRootRun: (rootRunId, limit) => durableRunRecords.listByRootRun(rootRunId, limit),
    delete: (runId) => durableRunRecords.delete(runId),
  };
  const feature = createMultiAgentFeature({
    runRecordStore,
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : directChildInstructionChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed", () => {
              toolExecutions += 1;
            }),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  failNextChildProjection = true;
  await assert.rejects(
    feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "执行一次直接 child 跟进。",
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("fixture direct child projection failed"),
  );
  assert.equal(toolExecutions, 1);
  assert.equal(acquisitionCount, 2);

  const retried = await feature.sendChildInstruction({
    runId: pending.runId,
    childRunId: pending.childRunId,
    message: "执行一次直接 child 跟进。",
  });
  assert.equal(retried.status, "continued");
  assert.equal(retried.record.agentRunTree.childRuns[0]?.status, "completed");
  assert.equal(toolExecutions, 1, "projection retry must not replay the tool");
  assert.equal(acquisitionCount, 2, "projection retry must not acquire another runtime");
  await feature.dispose();
});

test("MultiAgentFeature retries a known live child projection without continuing the child twice", async () => {
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: pendingApprovalRunChannel(),
      toolCenter: new ApprovalFixtureToolBroker("approval"),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
  const pending = await createPendingApprovalChild(feature);
  const initial = await feature.getRun(pending.runId);
  const child = initial?.agentRunTree.childRuns.find((candidate) => candidate.childRunId === pending.childRunId);
  const summary = initial?.report?.childSummaries.find((candidate) => candidate.childRunId === pending.childRunId);
  assert.ok(child);
  assert.ok(summary);
  const completedAt = "2026-07-13T12:00:00.000Z";
  const messageRef = "child_message:live-projection-retry";
  const completedSummary = {
    ...summary,
    status: "completed" as const,
    summary: "运行中的 child 已知结果。",
    uncertainty: "无。",
    confidence: 0.91,
  };
  const completedRun = {
    ...child,
    status: "completed" as const,
    pendingApproval: undefined,
    failureReason: undefined,
    completedAt,
    parentInstructions: [
      ...(child.parentInstructions ?? []),
      {
        instructionId: "live-projection-retry",
        messageRef,
        source: "control_api" as const,
        status: "executed" as const,
        instructionSummary: "补齐运行中 child 材料。",
        requestedAt: completedAt,
        executedAt: completedAt,
      },
    ],
    execution: {
      modelRounds: 1,
      toolRounds: 1,
      toolCalls: [{ callId: "live-tool-call", toolName: "write", status: "completed" as const }],
    },
    executionHistory: [
      ...(child.executionHistory ?? []),
      {
        modelRounds: 1,
        toolRounds: 1,
        toolCalls: [{ callId: "live-tool-call", toolName: "write", status: "completed" as const }],
        outcome: "completed" as const,
        recordedAt: completedAt,
      },
    ],
  };
  const continuedResult: DeepChildInstructionContinueResult = {
    status: "continued",
    childRunId: pending.childRunId,
    childStatus: "completed",
    material: {
      task: {
        taskId: "task-live-projection-retry",
        childRunId: pending.childRunId,
        spec: completedSummary.spec,
        status: "completed",
        startedAt: child.startedAt,
        updatedAt: completedAt,
        completedAt,
        summary: completedSummary,
      },
      summary: completedSummary,
      completedRun,
    },
  };
  const internal = feature as typeof feature & {
    readonly runRecordStore: DeepRunRecordStore;
    readonly childContinuations: DeepChildPendingContinuationStore;
    readonly childInstructionQueues: {
      readonly register: (runId: string, handle: DeepChildInstructionQueueHandle) => void;
      readonly unregister: (runId: string, handle: DeepChildInstructionQueueHandle) => Promise<void>;
    };
  };
  const store = internal.runRecordStore as DeepRunRecordStore & {
    get: DeepRunRecordStore["get"];
  };
  const originalGet = store.get;
  const projectionReadStarted = deferred<void>();
  const projectionReadGate = deferred<void>();
  let failNextRead = false;
  store.get = async (runId) => {
    if (failNextRead) {
      failNextRead = false;
      projectionReadStarted.resolve();
      await projectionReadGate.promise;
      throw new Error("fixture live child projection read failed");
    }
    return originalGet(runId);
  };
  let continuationExecutions = 0;
  const queueHandle: DeepChildInstructionQueueHandle = {
    queueChildInstruction: ({ childRunId }) => ({
      status: "not_accepting",
      childRunId,
      childStatus: "blocked",
      reason: "terminal child uses immediate continuation",
    }),
    continueChildInstruction: async () => {
      continuationExecutions += 1;
      internal.childContinuations.deleteForChildRun(pending.runId, pending.childRunId);
      failNextRead = true;
      return continuedResult;
    },
    snapshot: () => ({
      runId: pending.runId,
      phase: "waiting",
      tasks: [continuedResult.material.task],
      updatedAt: completedAt,
    }),
  };
  internal.childInstructionQueues.register(pending.runId, queueHandle);

  try {
    const firstAttempt = feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "补齐运行中 child 材料。",
    });
    await projectionReadStarted.promise;
    let unregisterSettled = false;
    const unregister = internal.childInstructionQueues.unregister(pending.runId, queueHandle).finally(() => {
      unregisterSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      unregisterSettled,
      false,
      "terminal seal must wait through result registration and authoritative projection",
    );
    projectionReadGate.resolve();
    await assert.rejects(
      firstAttempt,
      /fixture live child projection read failed/,
    );
    await unregister;
    assert.equal(continuationExecutions, 1);

    const retried = await feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "补齐运行中 child 材料。",
    });
    assert.equal(retried.status, "continued");
    assert.equal(retried.record.agentRunTree.childRuns[0]?.status, "completed");
    assert.equal(continuationExecutions, 1, "known live child material must only be projected on retry");
  } finally {
    store.get = originalGet;
    await feature.dispose();
  }
});

test("MultiAgentFeature blocks an orphaned durable child instruction before runtime acquisition", async () => {
  let acquisitionCount = 0;
  let startFactsResolutionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => {
      startFactsResolutionCount += 1;
      return {
        capabilitySnapshot: approvalCapabilitySnapshot(),
        informationAccess: informationAccess(),
        confirmationPolicy: "prompt",
      };
    },
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : directChildInstructionChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly childMessageStore: DeepChildMessageStore;
    readonly runRecordStore: DeepRunRecordStore;
  };
  const orphanedInstructionId = "orphaned-instruction";
  const orphanedMessageRef = `child_message:${orphanedInstructionId}`;
  const queuedAt = "2026-07-13T00:00:00.000Z";
  const record = await internal.runRecordStore.get(pending.runId);
  assert.ok(record);
  await internal.runRecordStore.upsert({
    ...record,
    agentRunTree: {
      ...record.agentRunTree,
      childRuns: record.agentRunTree.childRuns.map((childRun) =>
        childRun.childRunId === pending.childRunId
          ? {
              ...childRun,
              parentInstructions: [
                ...(childRun.parentInstructions ?? []),
                {
                  instructionId: orphanedInstructionId,
                  messageRef: orphanedMessageRef,
                  source: "control_api" as const,
                  status: "queued" as const,
                  instructionSummary: "这条指令的执行结果尚未投影。",
                  requestedAt: queuedAt,
                  queuedAt,
                },
              ],
            }
          : childRun
      ),
    },
  });
  await internal.childMessageStore.upsert(createDeepChildMessageRecord({
    runId: pending.runId,
    childRunId: pending.childRunId,
    instructionId: orphanedInstructionId,
    messageRef: orphanedMessageRef,
    source: "control_api",
    status: "queued",
    content: "这条指令的执行结果在进程重启前未完成投影。",
    requestedAt: queuedAt,
    queuedAt,
  }));

  const acquisitionBaseline = acquisitionCount;
  const startFactsBaseline = startFactsResolutionCount;

  await assert.rejects(
    feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "不得盲目重放上一条指令。",
    }),
    childInstructionOutcomeUnknownError,
  );
  await assert.rejects(
    feature.resynthesize({ runId: pending.runId }),
    childInstructionOutcomeUnknownError,
  );
  await assert.rejects(
    feature.intake({
      conversationId: pending.conversationId,
      activeRunId: pending.runId,
      aiMode: "fake",
      message: "基于上一轮材料继续判断。",
    }),
    childInstructionOutcomeUnknownError,
  );
  await assert.rejects(
    feature.startRun({
      conversationId: pending.conversationId,
      parentRunId: pending.runId,
      aiMode: "fake",
    }),
    childInstructionOutcomeUnknownError,
  );
  await assert.rejects(
    feature.followUp({
      runId: pending.runId,
      aiMode: "fake",
      message: "继续上一轮深入协作。",
    }),
    childInstructionOutcomeUnknownError,
  );
  assert.equal(
    acquisitionCount,
    acquisitionBaseline,
    "orphan reconciliation must fail before acquiring another runtime",
  );
  assert.equal(
    startFactsResolutionCount,
    startFactsBaseline,
    "run-dependent commands must fail before resolving new start facts",
  );
  await feature.dispose();
});

test("MultiAgentFeature refreshes a stale running snapshot after the live queue disappears", async () => {
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : directChildInstructionChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly runRecordStore: DeepRunRecordStore;
  };
  const originalGet = internal.runRecordStore.get;
  let reads = 0;
  internal.runRecordStore.get = async (runId) => {
    reads += 1;
    const record = await originalGet(runId);
    if (reads !== 2 || record === undefined) {
      return record;
    }
    return {
      ...record,
      run: {
        ...record.run,
        status: "running",
        completedAt: undefined,
      },
    };
  };

  try {
    const continued = await feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "基于终态权威记录继续，不要使用刚好过期的 running 快照。",
    });

    assert.equal(continued.status, "continued");
    assert.equal(reads >= 3, true, "lease miss must trigger an authoritative run refresh");
    assert.equal(acquisitionCount, 2);
  } finally {
    internal.runRecordStore.get = originalGet;
    await feature.dispose();
  }
});

test("MultiAgentFeature does not replace a durable child approval after its live continuation is lost", async () => {
  const durable = new InMemoryDeepRunRecordStore();
  const firstFeature = createMultiAgentFeature({
    runRecordStore: durable,
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: pendingApprovalRunChannel(),
      toolCenter: new ApprovalFixtureToolBroker("approval"),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
  const pending = await createPendingApprovalChild(firstFeature);
  await firstFeature.dispose();

  let restartedAcquisitions = 0;
  const restartedFeature = createMultiAgentFeature({
    runRecordStore: durable,
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      restartedAcquisitions += 1;
      return {
        intelligenceChannel: directChildInstructionChannel(),
        toolCenter: new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  try {
    await assert.rejects(
      restartedFeature.sendChildInstruction({
        runId: pending.runId,
        childRunId: pending.childRunId,
        message: "不能绕过已经丢失的确认上下文。",
      }),
      (error: unknown) => error instanceof Error
        && "code" in error
        && error.code === "confirmation_continuation_lost",
    );
    assert.equal(restartedAcquisitions, 0);
  } finally {
    await restartedFeature.dispose();
  }
});

test("MultiAgentFeature keeps a child confirmation continuation when resource acquisition fails", async () => {
  let acquisitionCount = 0;
  let failNextResumeAcquisition = true;
  let resumedToolExecutions = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      if (acquisitionCount > 1 && failNextResumeAcquisition) {
        failNextResumeAcquisition = false;
        throw new Error("fixture resume acquisition failed");
      }
      return acquisitionCount === 1
        ? {
            intelligenceChannel: pendingApprovalRunChannel(),
            toolCenter: new ApprovalFixtureToolBroker("approval"),
            capabilitySnapshot,
            release: async () => undefined,
          }
        : {
            intelligenceChannel: resumedChildChannel(),
            toolCenter: new ApprovalFixtureToolBroker("completed", () => {
              resumedToolExecutions += 1;
            }),
            capabilitySnapshot,
            release: async () => undefined,
          };
    },
  });
  const pending = await createPendingApprovalChild(feature);

  await assert.rejects(
    feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    }),
    /fixture resume acquisition failed/,
  );

  const resumed = await feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  });
  const child = resumed.agentRunTree.childRuns.find((candidate) => candidate.childRunId === pending.childRunId);
  assert.equal(child?.status, "completed");
  assert.equal(resumedToolExecutions, 1);
  await feature.dispose();
});

test("MultiAgentFeature keeps the prior approval when child continuation context preparation fails", async () => {
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : acquisitionCount === 2
            ? directChildInstructionChannel()
            : resumedChildChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly childLoopContextStore: DeepChildLoopContextStore;
    readonly childMessageStore: DeepChildMessageStore;
  };
  const originalGetByRef = internal.childLoopContextStore.getByRef;
  (internal.childLoopContextStore as { getByRef: DeepChildLoopContextStore["getByRef"] }).getByRef = async () => {
    throw new Error("fixture child continuation context read failed");
  };
  try {
    await assert.rejects(
      feature.sendChildInstruction({
        runId: pending.runId,
        childRunId: pending.childRunId,
        message: "上下文准备成功后才允许替换原确认。",
      }),
      /fixture child continuation context read failed/,
    );
    assert.equal(
      (await internal.childMessageStore.listForChild(pending.runId, pending.childRunId)).length,
      0,
      "failed context preparation must not leave a write-ahead marker",
    );
  } finally {
    (internal.childLoopContextStore as { getByRef: DeepChildLoopContextStore["getByRef"] }).getByRef = originalGetByRef;
  }

  const resumed = await feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  });
  assert.equal(
    resumed.agentRunTree.childRuns.find((child) => child.childRunId === pending.childRunId)?.status,
    "completed",
  );
  assert.equal(acquisitionCount, 3);
  await feature.dispose();
});

test("MultiAgentFeature keeps an unknown confirmation outcome ahead of a new child instruction", async () => {
  let acquisitionCount = 0;
  let unexpectedToolExecutions = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : resumedChildChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed", () => {
              unexpectedToolExecutions += 1;
            }),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly childContinuations: DeepChildPendingContinuationStore;
  };
  const reservation = internal.childContinuations.reserve(
    pending.runId,
    pending.childRunId,
    pending.confirmationId,
  );
  internal.childContinuations.markOutcomeUnknown(reservation);

  await assert.rejects(
    feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    }),
    confirmationOutcomeUnknownError,
  );
  await assert.rejects(
    feature.sendChildInstruction({
      runId: pending.runId,
      childRunId: pending.childRunId,
      message: "未知结果不能通过新父指令绕过。",
    }),
    confirmationOutcomeUnknownError,
  );
  assert.equal(acquisitionCount, 1, "an unknown outcome must be rejected before runtime acquisition");
  assert.equal(unexpectedToolExecutions, 0);
  await feature.dispose();
});

test("MultiAgentFeature retries confirmation persistence without replaying the tool", async () => {
  let acquisitionCount = 0;
  let toolExecutions = 0;
  const durableRunRecords = new InMemoryDeepRunRecordStore();
  let failNextPersistence = false;
  const runRecordStore: DeepRunRecordStore = {
    upsert: async (record) => {
      if (
        failNextPersistence
        && record.agentRunTree.childRuns.some((childRun) => childRun.status === "completed")
      ) {
        failNextPersistence = false;
        throw new Error("fixture confirmation persistence failed");
      }
      return durableRunRecords.upsert(record);
    },
    get: (runId) => durableRunRecords.get(runId),
    list: (limit) => durableRunRecords.list(limit),
    listByConversation: (conversationId, limit) =>
      durableRunRecords.listByConversation(conversationId, limit),
    listByRootRun: (rootRunId, limit) => durableRunRecords.listByRootRun(rootRunId, limit),
    delete: (runId) => durableRunRecords.delete(runId),
  };
  const feature = createMultiAgentFeature({
    runRecordStore,
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : resumedChildChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed", () => {
              toolExecutions += 1;
            }),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  failNextPersistence = true;
  const internal = feature as typeof feature & {
    readonly runRecordWrites: DeepRunRecordWriteCoordinator;
  };
  const writes = internal.runRecordWrites as DeepRunRecordWriteCoordinator & {
    acknowledgeFailure: DeepRunRecordWriteCoordinator["acknowledgeFailure"];
  };
  const originalAcknowledgeFailure = writes.acknowledgeFailure;
  let acknowledgedFailures = 0;
  writes.acknowledgeFailure = async (receipt) => {
    const acknowledged = await originalAcknowledgeFailure(receipt);
    if (acknowledged) {
      acknowledgedFailures += 1;
    }
    return acknowledged;
  };
  try {
    await assert.rejects(
      feature.resumeChild({
        ...pending,
        decision: { decision: "approve_once" },
      }),
      /fixture confirmation persistence failed/,
    );
    assert.equal(toolExecutions, 1);
    await assert.rejects(
      feature.sendChildInstruction({
        runId: pending.runId,
        childRunId: pending.childRunId,
        message: "确认结果尚未落盘时不得绕过原确认改发新指令。",
      }),
      confirmationInProgressError,
    );
    assert.equal(toolExecutions, 1, "a parent instruction must not replay a retained confirmation result");
    assert.equal(acquisitionCount, 2, "the protected child instruction must not acquire another runtime");
    const resumed = await feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    });
    assert.equal(resumed.agentRunTree.childRuns[0]?.status, "completed");
    assert.equal(toolExecutions, 1, "retry must only persist the known result");
    assert.equal(acquisitionCount, 2, "retry must not acquire a second runtime");
    assert.equal(acknowledgedFailures, 1);
  } finally {
    writes.acknowledgeFailure = originalAcknowledgeFailure;
    await feature.dispose();
  }
});

test("MultiAgentFeature keeps a known child result when resource release fails", async () => {
  let acquisitionCount = 0;
  const releaseFailures: unknown[] = [];
  let toolExecutions = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      const leaseId = acquisitionCount;
      return {
        intelligenceChannel: leaseId === 1 ? pendingApprovalRunChannel() : resumedChildChannel(),
        toolCenter: leaseId === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed", () => {
              toolExecutions += 1;
            }),
        capabilitySnapshot,
        release: async () => {
          if (leaseId > 1) {
            throw new Error("fixture confirmation release failed");
          }
        },
      };
    },
    reportBackgroundFailure: ({ error }) => {
      releaseFailures.push(error);
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const resumed = await feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  });
  assert.equal(resumed.agentRunTree.childRuns[0]?.status, "completed");
  assert.equal(toolExecutions, 1);
  assert.equal(releaseFailures.length, 1);
  await assert.rejects(
    feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    }),
    continuationLostError,
  );
  await feature.dispose();
});

test("MultiAgentFeature retries child context persistence without replaying a known confirmation tool result", async () => {
  let acquisitionCount = 0;
  let toolExecutions = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : resumedChildChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed", () => {
              toolExecutions += 1;
            }),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly childLoopContextStore: DeepChildLoopContextStore;
  };
  const contextStore = internal.childLoopContextStore as DeepChildLoopContextStore & {
    upsert: DeepChildLoopContextStore["upsert"];
  };
  const originalUpsert = contextStore.upsert;
  let failingWrites = 2;
  contextStore.upsert = async (...args: Parameters<DeepChildLoopContextStore["upsert"]>) => {
    if (failingWrites > 0) {
      failingWrites -= 1;
      throw new Error("fixture continuation context persistence failed");
    }
    return originalUpsert.call(contextStore, ...args);
  };
  try {
    await assert.rejects(
      feature.resumeChild({
        ...pending,
        decision: { decision: "approve_once" },
      }),
      (error: unknown) => error instanceof Error
        && error.message.includes("fixture continuation context persistence failed")
        && (!("code" in error) || error.code !== "confirmation_outcome_unknown"),
    );
    assert.equal(toolExecutions, 1);
    await assert.rejects(
      feature.resumeChild({
        ...pending,
        decision: { decision: "approve_once" },
      }),
      (error: unknown) => error instanceof Error
        && error.message.includes("fixture continuation context persistence failed")
        && (!("code" in error) || error.code !== "confirmation_outcome_unknown"),
    );
    assert.equal(toolExecutions, 1, "a failed persistence retry must not replay the tool");
    const resumed = await feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    });
    assert.equal(resumed.agentRunTree.childRuns[0]?.status, "completed");
    assert.equal(toolExecutions, 1);
    assert.equal(acquisitionCount, 2, "persistence retries must not acquire another child runtime");
  } finally {
    contextStore.upsert = originalUpsert;
    await feature.dispose();
  }
});

test("MultiAgentFeature projects an unpersistable known child turn as failed without replaying its tool", async () => {
  let acquisitionCount = 0;
  let toolExecutions = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunWithUnpersistableContextChannel()
          : resumedChildChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed", () => {
              toolExecutions += 1;
            }),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);

  await assert.rejects(
    feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("model_protocol_continuation_not_persistable")
      && (!("code" in error) || error.code !== "confirmation_outcome_unknown"),
  );
  assert.equal(toolExecutions, 1);

  const projected = await feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  });
  const child = projected.agentRunTree.childRuns.find(
    (candidate) => candidate.childRunId === pending.childRunId,
  );
  assert.equal(child?.status, "failed");
  assert.equal(child?.failureDetail?.failureKind, "model_protocol_continuation_not_persistable");
  assert.equal(child?.execution?.toolCalls[0]?.status, "completed");
  assert.equal(toolExecutions, 1);
  assert.equal(acquisitionCount, 2, "the failed projection must not acquire another child runtime");
  await feature.dispose();
});

test("MultiAgentFeature serializes concurrent child resumes within one conversation", async () => {
  let acquisitionCount = 0;
  let resumeAcquisitions = 0;
  let resumedToolExecutions = 0;
  let resumeReleasesStarted = 0;
  const releaseCallsByLease = new Map<number, number>();
  const acquireGate = deferred<void>();
  const releaseGate = deferred<void>();
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      const leaseId = acquisitionCount;
      if (leaseId === 1) {
        return {
          intelligenceChannel: pendingApprovalRunChannel(),
          toolCenter: new ApprovalFixtureToolBroker("approval"),
          capabilitySnapshot,
          release: async () => undefined,
        };
      }
      resumeAcquisitions += 1;
      await acquireGate.promise;
      return {
        intelligenceChannel: resumedChildChannel(),
        toolCenter: new ApprovalFixtureToolBroker("completed", () => {
          resumedToolExecutions += 1;
        }),
        capabilitySnapshot,
        release: async () => {
          releaseCallsByLease.set(leaseId, (releaseCallsByLease.get(leaseId) ?? 0) + 1);
          resumeReleasesStarted += 1;
          await releaseGate.promise;
        },
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);
  let firstSettled = false;
  let secondSettled = false;
  const first = feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  }).finally(() => {
    firstSettled = true;
  });
  const second = feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  }).finally(() => {
    secondSettled = true;
  });

  await waitUntil(() => resumeAcquisitions === 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resumeAcquisitions, 1, "the second same-conversation resume must wait behind the first");
  acquireGate.resolve();
  await waitUntil(() => resumeReleasesStarted === 1);
  assert.equal(firstSettled, false);
  assert.equal(secondSettled, false);
  assert.equal(resumedToolExecutions, 1);

  releaseGate.resolve();
  const resumed = await first;
  const child = resumed.agentRunTree.childRuns.find((candidate) => candidate.childRunId === pending.childRunId);
  assert.equal(child?.status, "completed");
  await assert.rejects(second, continuationLostError);
  assert.deepEqual([...releaseCallsByLease.values()].sort(), [1]);
  await feature.dispose();
});

test("MultiAgentFeature clears terminal runtime handles and removes non-pending continuations", async () => {
  const gate = deferred<void>();
  const channel = directRunChannel();
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "full_access",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: {
        request: async (request, options) => {
          await gate.promise;
          return channel.request(request, options);
        },
        validateResponse: (request, response) => channel.validateResponse(request, response),
      },
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "直接完成且不保留确认 continuation。",
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  const internal = feature as typeof feature & {
    readonly childContinuations: DeepChildPendingContinuationStore;
    readonly childInstructionQueues: {
      readonly has: (runId: string) => boolean;
    };
    readonly controlHandleForRun: (runId: string) => unknown;
  };
  internal.childContinuations.remember(
    started.runId,
    pendingContinuation("stale-child", "stale-confirmation"),
  );

  await waitUntil(() => internal.childInstructionQueues.has(started.runId));
  assert.notEqual(internal.controlHandleForRun(started.runId), undefined);

  gate.resolve();
  await feature.waitForIdle();

  assert.equal(internal.controlHandleForRun(started.runId), undefined);
  assert.equal(internal.childInstructionQueues.has(started.runId), false);
  assert.equal(
    internal.childContinuations.get(started.runId, "stale-child", "stale-confirmation"),
    undefined,
  );
  await feature.dispose();
});

test("MultiAgentFeature reports continuation_lost after pending approval expiry", async () => {
  let now = 0;
  const feature = pendingApprovalFeature({
    ttlMs: 10,
    now: () => now,
  });
  const pending = await createPendingApprovalChild(feature);

  now = 10;
  await assert.rejects(
    feature.resumeChild({
      ...pending,
      decision: { decision: "approve_once" },
    }),
    continuationLostError,
  );
  await feature.dispose();
});

test("MultiAgentFeature reports continuation_lost after capacity eviction and conversation deletion", async () => {
  const feature = pendingApprovalFeature({
    maxEntries: 1,
    maxEntriesPerRun: 1,
  });
  const first = await createPendingApprovalChild(feature);
  const second = await createPendingApprovalChild(feature);

  await assert.rejects(
    feature.resumeChild({
      ...first,
      decision: { decision: "approve_once" },
    }),
    continuationLostError,
  );

  await feature.deleteConversation(second.conversationId);
  await assert.rejects(
    feature.resumeChild({
      ...second,
      decision: { decision: "approve_once" },
    }),
    continuationLostError,
  );
  await feature.dispose();
});

test("MultiAgentFeature serializes conversation deletion behind a post-terminal child operation", async () => {
  const resumeStarted = deferred<void>();
  const resumeGate = deferred<void>();
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      const channel = acquisitionCount === 1
        ? pendingApprovalRunChannel()
        : resumedChildChannel();
      return {
        intelligenceChannel: acquisitionCount === 1
          ? channel
          : {
              async request(request: ModelRequest, options?: Parameters<IntelligenceChannel["request"]>[1]) {
                resumeStarted.resolve();
                await resumeGate.promise;
                return channel.request(request, options);
              },
              validateResponse: (request: ModelRequest, response: ModelResponse) =>
                channel.validateResponse(request, response),
            },
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const pending = await createPendingApprovalChild(feature);

  const resume = feature.resumeChild({
    ...pending,
    decision: { decision: "approve_once" },
  });
  await resumeStarted.promise;

  let deletionSettled = false;
  const deletion = feature.deleteConversation(pending.conversationId).finally(() => {
    deletionSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(deletionSettled, false, "deletion must wait for the same-conversation child operation");

  resumeGate.resolve();
  await resume;
  await deletion;
  assert.equal(await feature.getRun(pending.runId), undefined, "late child save must not recreate a deleted run");
  await feature.dispose();
});

test("MultiAgentFeature keeps the run owner when conversation sidecar cleanup fails", async () => {
  const feature = pendingApprovalFeature({});
  const pending = await createPendingApprovalChild(feature);
  const internal = feature as typeof feature & {
    readonly childMessageStore: DeepChildMessageStore;
  };
  const messageStore = internal.childMessageStore as DeepChildMessageStore & {
    deleteForRun: DeepChildMessageStore["deleteForRun"];
  };
  const originalDeleteForRun = messageStore.deleteForRun;
  let failCleanup = true;
  messageStore.deleteForRun = async (runId) => {
    if (failCleanup) {
      failCleanup = false;
      throw new Error("fixture sidecar cleanup failed");
    }
    await originalDeleteForRun.call(messageStore, runId);
  };
  try {
    await assert.rejects(
      feature.deleteConversation(pending.conversationId),
      /fixture sidecar cleanup failed/,
    );
    assert.ok(await feature.getRun(pending.runId), "run owner must remain available for cleanup retry");
    assert.ok(await feature.getConversation(pending.conversationId));

    await feature.deleteConversation(pending.conversationId);
    assert.equal(await feature.getRun(pending.runId), undefined);
    assert.equal(await feature.getConversation(pending.conversationId), undefined);
  } finally {
    messageStore.deleteForRun = originalDeleteForRun;
    await feature.dispose();
  }
});

test("MultiAgentFeature waits for terminal persistence after the live child queue unregisters", async () => {
  const queueUnregistered = deferred<void>();
  const terminalSaveStarted = deferred<void>();
  const terminalSaveGate = deferred<void>();
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : resumedChildChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : new ApprovalFixtureToolBroker("completed"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const internal = feature as typeof feature & {
    readonly runRecordStore: DeepRunRecordStore;
    readonly childInstructionQueues: {
      readonly unregister: (
        runId: string,
        handle: DeepChildInstructionQueueHandle,
      ) => Promise<void>;
    };
  };
  // Use the concrete store methods as a test seam; the production owner remains
  // the feature's coordinated store and no route-level state is introduced.
  const store = internal.runRecordStore as DeepRunRecordStore & {
    upsert: DeepRunRecordStore["upsert"];
  };
  const originalUpsert = store.upsert;
  let holdTerminalSave = true;
  store.upsert = async (record) => {
    if (holdTerminalSave && record.run.status !== "running" && record.report !== undefined) {
      holdTerminalSave = false;
      terminalSaveStarted.resolve();
      await terminalSaveGate.promise;
    }
    return originalUpsert(record);
  };
  const queueRegistry = internal.childInstructionQueues as unknown as {
    unregister: (runId: string, handle: DeepChildInstructionQueueHandle) => Promise<void>;
  };
  const originalUnregister = queueRegistry.unregister;
  queueRegistry.unregister = async (runId, handle) => {
    await originalUnregister(runId, handle);
    queueUnregistered.resolve();
  };

  try {
    const conversation = await feature.createConversation({
      aiMode: "fake",
      goal: "验证终态写入与 child 续跑的顺序。",
    });
    const started = await feature.startRun({
      conversationId: conversation.conversationId,
      aiMode: "fake",
    });
    await queueUnregistered.promise;
    await terminalSaveStarted.promise;
    const live = await feature.getRun(started.runId);
    const child = live?.agentRunTree.childRuns[0];
    assert.ok(child);

    let settled = false;
    const instruction = feature.sendChildInstruction({
      runId: started.runId,
      childRunId: child.childRunId,
      message: "请在确认后继续完成写入。",
    }).finally(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "post-terminal instruction must wait for final persistence");
    assert.equal(acquisitionCount, 1, "must not acquire a second runtime from the stale record");

    terminalSaveGate.resolve();
    const continued = await instruction;
    assert.equal(continued.status, "continued");
    await feature.waitForIdle();
    const final = await feature.getRun(started.runId);
    assert.equal(final?.run.status, "completed");
  } finally {
    store.upsert = originalUpsert;
    await feature.dispose();
  }
});

test("MultiAgentFeature keeps Deep-owned tool output through terminal approval and reclaims it on conversation deletion", async () => {
  const outputStore = new InMemoryToolOutputStore({
    createRefToken: () => "deep-pending-output",
  });
  let retainedRef: string | undefined;
  let retainedOwner: string | undefined;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot, taskSoil }) => {
      if (retainedRef === undefined) {
        retainedOwner = taskSoil.traceId;
        const retained = await outputStore.retain({
          mediaType: "text/plain",
          content: "retained across terminal child approval",
          sourceToolName: "deep_fixture",
          sourceCallId: "deep-fixture-call",
          ownerId: taskSoil.traceId,
        });
        retainedRef = retained.ref;
      }
      return {
        intelligenceChannel: pendingApprovalRunChannel(),
        toolCenter: new ApprovalFixtureToolBroker("approval"),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
    releaseToolOutputOwner: (ownerId) => outputStore.releaseOwner(ownerId).then(() => undefined),
  });

  const pending = await createPendingApprovalChild(feature);

  assert.equal(retainedOwner, `deep-run:${pending.runId}`);
  assert.equal(
    (await outputStore.read(retainedRef!, { startChar: 0, maxChars: 30_000 }))?.content,
    "retained across terminal child approval",
    "terminal must not reclaim output needed by a live child continuation",
  );

  await feature.deleteConversation(pending.conversationId);

  assert.equal(
    await outputStore.read(retainedRef!, { startChar: 0, maxChars: 30_000 }),
    undefined,
  );
  await feature.dispose();
});

test("MultiAgentFeature conversation deletion cleans runs older than the recent-history window", async () => {
  const releasedOwners: string[] = [];
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "full_access",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: directRunChannel(),
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => undefined,
    }),
    releaseToolOutputOwner: (ownerId) => {
      releasedOwners.push(ownerId);
    },
  });
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "创建一个随后会落到最近五百条之外的运行。",
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  await feature.waitForIdle();
  const oldestRecord = await feature.getRun(started.runId);
  assert.ok(oldestRecord);

  const internal = feature as typeof feature & {
    readonly runRecordStore: DeepRunRecordStore;
  };
  for (let index = 0; index < 500; index += 1) {
    const runId = `newer-deep-run-${index}`;
    const updatedAt = `9999-12-31T23:59:${String(index % 60).padStart(2, "0")}.000Z`;
    await internal.runRecordStore.upsert({
      ...oldestRecord,
      run: {
        ...oldestRecord.run,
        runId,
        rootRunId: runId,
        turnOrdinal: index + 2,
        updatedAt,
      },
      report: oldestRecord.report === undefined ? undefined : {
        ...oldestRecord.report,
        runId,
      },
      eventSequence: oldestRecord.eventSequence.map((event) => ({ ...event, runId })),
      updatedAt,
    });
  }

  await feature.deleteConversation(conversation.conversationId);

  assert.equal(await internal.runRecordStore.get(started.runId), undefined);
  assert.equal(releasedOwners.includes(`deep-run:${started.runId}`), true);
  assert.equal(releasedOwners.length, 501);
  await feature.dispose();
});

test("MultiAgentFeature derives follow-up ordinal when the root is older than 500 recent runs", async () => {
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "full_access",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: directRunChannel(),
      toolCenter: emptyToolBroker(),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "在完整任务链上继续下一轮。",
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  await feature.waitForIdle();
  const rootRecord = await feature.getRun(started.runId);
  assert.ok(rootRecord);

  const internal = feature as typeof feature & {
    readonly runRecordStore: DeepRunRecordStore;
  };
  for (let index = 0; index < 500; index += 1) {
    const runId = `unrelated-recent-run-${index}`;
    const updatedAt = `9999-12-31T23:59:${String(index % 60).padStart(2, "0")}.000Z`;
    await internal.runRecordStore.upsert({
      ...rootRecord,
      run: {
        ...rootRecord.run,
        runId,
        rootRunId: runId,
        turnOrdinal: index + 1,
        updatedAt,
      },
      report: rootRecord.report === undefined ? undefined : {
        ...rootRecord.report,
        runId,
      },
      eventSequence: rootRecord.eventSequence.map((event) => ({ ...event, runId })),
      updatedAt,
    });
  }

  const followUp = await feature.followUp({
    runId: started.runId,
    aiMode: "fake",
    message: "继续完成第二轮。",
  });

  assert.equal(followUp.parentRunId, started.runId);
  assert.equal(followUp.rootRunId, started.runId);
  assert.equal(followUp.turnOrdinal, 2);
  await feature.waitForIdle();
  await feature.dispose();
});

test("MultiAgentFeature rejects a concurrent follow-up for the same conversation", async () => {
  let acquisitionCount = 0;
  const followUpModelStarted = deferred<void>();
  const followUpModelGate = deferred<void>();
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: capabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "full_access",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => {
      acquisitionCount += 1;
      const channel = directRunChannel();
      if (acquisitionCount === 1) {
        return {
          intelligenceChannel: channel,
          toolCenter: emptyToolBroker(),
          capabilitySnapshot,
          release: async () => undefined,
        };
      }
      return {
        intelligenceChannel: {
          async request(request: ModelRequest, options?: Parameters<IntelligenceChannel["request"]>[1]) {
            followUpModelStarted.resolve();
            await followUpModelGate.promise;
            return channel.request(request, options);
          },
          validateResponse: (request: ModelRequest, response: ModelResponse) =>
            channel.validateResponse(request, response),
        },
        toolCenter: emptyToolBroker(),
        capabilitySnapshot,
        release: async () => undefined,
      };
    },
  });
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "验证同一会话不会并行启动两轮深入协作。",
  });
  const firstRun = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  await feature.waitForIdle();

  const attempts = await Promise.allSettled([
    feature.followUp({ runId: firstRun.runId, aiMode: "fake", message: "第一轮继续。" }),
    feature.followUp({ runId: firstRun.runId, aiMode: "fake", message: "第二轮继续。" }),
  ]);
  const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal((rejected[0]?.reason as { readonly code?: unknown }).code, "conversation_busy");
  assert.equal(acquisitionCount, 2);
  await followUpModelStarted.promise;
  followUpModelGate.resolve();
  await feature.waitForIdle();
  await feature.dispose();
});

async function createPendingApprovalChild(
  feature: ReturnType<typeof createMultiAgentFeature>,
): Promise<{
  readonly conversationId: string;
  readonly runId: string;
  readonly childRunId: string;
  readonly confirmationId: string;
}> {
  const conversation = await feature.createConversation({
    aiMode: "fake",
    goal: "让一个子 Agent 执行需要确认的写入。",
  });
  const started = await feature.startRun({
    conversationId: conversation.conversationId,
    aiMode: "fake",
  });
  await feature.waitForIdle();
  const record = await feature.getRun(started.runId);
  const child = record?.agentRunTree.childRuns[0];
  assert.ok(child);
  assert.equal(child.status, "blocked");
  assert.ok(child.pendingApproval);
  return {
    conversationId: conversation.conversationId,
    runId: started.runId,
    childRunId: child.childRunId,
    confirmationId: child.pendingApproval.confirmationId,
  };
}

function pendingApprovalFeature(
  retention: DeepChildPendingContinuationRetentionOptions,
): ReturnType<typeof createMultiAgentFeature> {
  return createMultiAgentFeature({
    childContinuationRetention: retention,
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot }) => ({
      intelligenceChannel: pendingApprovalRunChannel(),
      toolCenter: new ApprovalFixtureToolBroker("approval"),
      capabilitySnapshot,
      release: async () => undefined,
    }),
  });
}

function pendingContinuation(
  childRunId: string,
  confirmationId: string,
): Omit<DeepChildPendingContinuation, "runId"> {
  return {
    childRunId,
    confirmationId,
    childRun: { childRunId } as DeepChildPendingContinuation["childRun"],
    childSpec: { specId: `spec-${childRunId}` } as DeepChildPendingContinuation["childSpec"],
    pendingApproval: { confirmationId } as DeepChildPendingContinuation["pendingApproval"],
  };
}

function continuationLostError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "confirmation_continuation_lost";
}

function confirmationInProgressError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "confirmation_in_progress";
}

function confirmationOutcomeUnknownError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "confirmation_outcome_unknown";
}

function childInstructionOutcomeUnknownError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    error.code === "child_instruction_outcome_unknown";
}

function pendingApprovalRunChannel(): IntelligenceChannel {
  let decisionCount = 0;
  return {
    async request(request): Promise<ModelResponse> {
      if (request.purpose === "deep_decision") {
        decisionCount += 1;
        return fixtureModelResponse(
          request,
          decisionCount === 1
            ? {
                action: "spawn_children",
                childSpecs: [{
                  specId: "child-spec-write",
                  displayName: "文件核查",
                  role: "file_review",
                  objective: "执行需要用户确认的写入并报告结果。",
                  allowedTools: ["write"],
                  inputRefs: [],
                }],
                childOperations: [],
                decisionSummary: "需要派生一个写入子 Agent。",
                rationale: "测试确认 continuation 生命周期。",
                uncertainty: "写入尚待确认。",
                confidence: 0.8,
                reasoningRefs: [],
              }
            : {
                action: "synthesize",
                childSpecs: [],
                childOperations: [],
                decisionSummary: "子 Agent 已进入确认等待，可以收口当前轮。",
                rationale: "保留确认 continuation 供后续恢复。",
                uncertainty: "写入尚未获批。",
                confidence: 0.7,
                reasoningRefs: [],
              },
        );
      }
      if (request.purpose === "deep_child_material") {
        return fixtureModelResponse(request, undefined, [{
          callId: "call-write-approval",
          toolName: "write",
          input: { path: "notes.md", content: "fixture" },
        }]);
      }
      if (request.purpose === "deep_synthesis") {
        return fixtureModelResponse(request, {
          conclusion: "子 Agent 正在等待写入确认。",
          oneLineRationale: "确认 continuation 已保存。",
          keyEvidenceRefs: [],
          candidateDispositions: [],
          mainUncertainty: "写入尚未获批。",
          confidence: 0.6,
        });
      }
      throw new Error(`Unexpected fixture request purpose: ${request.purpose}`);
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function resumedChildChannel(): IntelligenceChannel {
  return {
    async request(request): Promise<ModelResponse> {
      assert.equal(request.purpose, "deep_child_material");
      return fixtureModelResponse(request, {
        summary: "确认后写入成功。",
        findings: ["写入工具在同一子 Agent continuation 中完成"],
        evidenceRefs: ["tool:call-write-approval"],
        uncertainty: "无。",
        confidence: 0.9,
      });
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function directChildInstructionChannel(): IntelligenceChannel {
  let requestCount = 0;
  return {
    async request(request): Promise<ModelResponse> {
      assert.equal(request.purpose, "deep_child_material");
      requestCount += 1;
      if (requestCount === 1) {
        return fixtureModelResponse(request, undefined, [{
          callId: "call-write-direct-child",
          toolName: "write",
          input: { path: "notes.md", content: "direct child instruction" },
        }]);
      }
      return fixtureModelResponse(request, {
        summary: "直接 child 跟进已执行。",
        findings: ["写入工具只执行一次"],
        evidenceRefs: ["tool:call-write-direct-child"],
        uncertainty: "无。",
        confidence: 0.88,
      });
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function pendingApprovalRunWithUnpersistableContextChannel(): IntelligenceChannel {
  const channel = pendingApprovalRunChannel();
  return {
    async request(request, options): Promise<ModelResponse> {
      const response = await channel.request(request, options);
      if (
        request.purpose !== "deep_child_material"
        || response.toolCalls === undefined
        || response.toolCalls.length === 0
      ) {
        return response;
      }
      return {
        ...response,
        assistantMessage: {
          role: "assistant",
          content: "Pending tool call with an invalid durable protocol continuation.",
          toolCalls: response.toolCalls,
          protocolExtensions: {
            openai_responses_output_items: [{ encrypted_content: "missing-type" }],
          },
        },
      };
    },
    validateResponse: (request, response) => channel.validateResponse(request, response),
  };
}

function fixtureModelResponse(
  request: ModelRequest,
  structuredOutput: unknown,
  toolCalls: ModelResponse["toolCalls"] = [],
): ModelResponse {
  const completedAt = "2026-07-12T00:00:00.000Z";
  return {
    responseId: `response:${request.requestId}`,
    requestId: request.requestId,
    providerId: "fixture",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "fixture-model",
    status: "completed",
    outputKind: request.outputContract.outputKind,
    structuredOutput,
    toolCalls,
    validation: { status: "passed", checkedAt: completedAt, issues: [] },
    finishReason: toolCalls.length > 0 ? "tool_call" : "stop",
    completedAt,
  };
}

class ApprovalFixtureToolBroker implements ToolExecutionBroker {
  constructor(
    private readonly mode: "approval" | "completed",
    private readonly onCompleted: () => void = () => undefined,
  ) {}

  list(): ToolDefinition[] {
    return [{
      name: "write",
      description: "Fixture write tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    }];
  }

  has(name: string): boolean {
    return name === "write";
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck,
  ): Promise<ToolCallResult> {
    if (this.mode === "completed") {
      this.onCompleted();
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: normalizeToolFactValue({ path: "notes.md", written: true }),
        status: "completed",
        durationMs: 1,
      };
    }
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status: "approval_required",
      durationMs: 1,
      confirmationRequest: {
        confirmationId: "confirm-call-write-approval",
        toolCallFactId: request.factId ?? request.callId,
        title: "需要确认工具调用",
        actionSummary: "运行 write",
        affectedResources: ["notes.md"],
        riskLevel: "medium",
        requestedAt: "2026-07-12T00:00:00.000Z",
        sourceRefs: [request.callId],
      },
    };
  }
}

function approvalCapabilitySnapshot(): BasicAgentCapabilitySnapshot {
  const tool: CapabilityToolCatalogItem = {
    name: "write",
    displayName: "写入文件",
    displayDescription: "写入测试文件。",
    description: "Fixture write tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
    definitionHash: `sha256:${"0".repeat(64)}`,
    category: "workspace",
    categoryLabel: "工作区",
    riskLevel: "high",
    riskLabel: "高风险",
    operationType: "read-write",
    operationLabel: "写入",
    requiresConfirmation: true,
    confirmationLabel: "需要确认",
    scopes: ["desktop-basic"],
    enabled: true,
    availability: "available",
  };
  return {
    ...capabilitySnapshot(),
    toolCatalog: {
      scope: "desktop-basic",
      tools: [tool],
      allowedTools: [tool.name],
    },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function directAnswerChannel(): IntelligenceChannel {
  return {
    async request(request: ModelRequest): Promise<ModelResponse> {
      const completedAt = "2026-07-12T00:00:00.000Z";
      return {
        responseId: `response:${request.requestId}`,
        requestId: request.requestId,
        providerId: "fixture",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "fixture-model",
        status: "completed",
        outputKind: "candidate",
        structuredOutput: {
          action: "direct_answer",
          assistantMessage: "这是直接回答。",
          confidence: 0.9,
        },
        validation: { status: "passed", checkedAt: completedAt, issues: [] },
        finishReason: "stop",
        completedAt,
      };
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function directRunChannel(): IntelligenceChannel {
  return {
    async request(request: ModelRequest): Promise<ModelResponse> {
      const output = request.purpose === "deep_decision"
        ? {
            action: "direct_answer",
            childSpecs: [],
            childOperations: [],
            decisionSummary: "该目标可以直接回答。",
            rationale: "不需要派生子 Agent。",
            uncertainty: "无。",
            confidence: 0.9,
          }
        : {
            conclusion: "测试目标已完成。",
            oneLineRationale: "直接回答足以完成目标。",
            keyEvidenceRefs: [],
            candidateDispositions: [],
            mainUncertainty: "无。",
            confidence: 0.9,
          };
      const completedAt = "2026-07-12T00:00:00.000Z";
      return {
        responseId: `response:${request.requestId}`,
        requestId: request.requestId,
        providerId: "fixture",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "fixture-model",
        status: "completed",
        outputKind: request.outputContract.outputKind,
        structuredOutput: output,
        validation: { status: "passed", checkedAt: completedAt, issues: [] },
        finishReason: "stop",
        completedAt,
      };
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };
}

function emptyToolBroker(): ToolExecutionBroker {
  return {
    list: () => [],
    has: () => false,
    execute: async () => {
      throw new Error("No tools are available in this fixture.");
    },
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "multi-agent-feature-test",
    createdAt: "2026-07-12T00:00:00.000Z",
    activeModel: {
      profileId: "fixture",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "http://localhost",
      model: "fixture-model",
      defaultAiMode: "openai-compatible",
      secretRef: "secret:fixture",
      secretConfigured: true,
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    modelCapabilities: {
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: true,
      supportsStreaming: false,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "stable",
    },
    toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: [] },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    securitySummary: "fixture",
    warnings: [],
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: [],
    web: {
      provider: "none",
      maxResults: 5,
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for fixture state.");
}
