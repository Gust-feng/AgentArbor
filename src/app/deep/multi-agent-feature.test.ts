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
import type { DeepRunRecordStore } from "./deep-run-record-store.js";
import { InMemoryToolOutputStore } from "../tool-center/tool-output-store.js";
import { createMultiAgentFeature } from "./multi-agent-feature.js";

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
  assert.equal(feature.isRunActive(started.runId), false);
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

test("MultiAgentFeature restores run-start TaskSoil for child follow-up and resynthesis", async () => {
  const acquiredTaskSoils: TaskSoil[] = [];
  let acquisitionCount = 0;
  const feature = createMultiAgentFeature({
    resolveRunStartFacts: async () => ({
      capabilitySnapshot: approvalCapabilitySnapshot(),
      informationAccess: informationAccess(),
      confirmationPolicy: "prompt",
    }),
    acquireRunResources: async ({ capabilitySnapshot, taskSoil }) => {
      acquisitionCount += 1;
      acquiredTaskSoils.push(taskSoil);
      return {
        intelligenceChannel: acquisitionCount === 1
          ? pendingApprovalRunChannel()
          : acquisitionCount === 3
            ? resumedChildChannel()
            : directRunChannel(),
        toolCenter: acquisitionCount === 1
          ? new ApprovalFixtureToolBroker("approval")
          : emptyToolBroker(),
        capabilitySnapshot,
        release: async () => undefined,
      };
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
  await feature.resynthesize({ runId: started.runId });

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
      readonly get: (runId: string) => unknown;
    };
    readonly controlHandleForRun: (runId: string) => unknown;
  };
  internal.childContinuations.remember(
    started.runId,
    pendingContinuation("stale-child", "stale-confirmation"),
  );

  await waitUntil(() => internal.childInstructionQueues.get(started.runId) !== undefined);
  assert.notEqual(internal.controlHandleForRun(started.runId), undefined);

  gate.resolve();
  await feature.waitForIdle();

  assert.equal(internal.controlHandleForRun(started.runId), undefined);
  assert.equal(internal.childInstructionQueues.get(started.runId), undefined);
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
                  allowedTools: ["write_file"],
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
          toolName: "write_file",
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
    providerKind: "local",
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
      name: "write_file",
      description: "Fixture write tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    }];
  }

  has(name: string): boolean {
    return name === "write_file";
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
        runId: "fixture-child-run",
        title: "需要确认工具调用",
        actionSummary: "运行 write_file",
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
    name: "write_file",
    displayName: "写入文件",
    displayDescription: "写入测试文件。",
    description: "Fixture write tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
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
        providerKind: "local",
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
        providerKind: "local",
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
      providerKind: "local",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "http://localhost",
      model: "fixture-model",
      defaultAiMode: "fake",
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
