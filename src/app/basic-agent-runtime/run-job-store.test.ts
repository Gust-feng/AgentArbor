import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type {
  BasicAgentRunCompletedPayload,
  BasicAgentRunFailedPayload,
  BasicAgentRunJob,
  BasicAgentRunTerminalPayload,
} from "./run-job.js";
import { InMemoryBasicAgentRunJobStore } from "./run-job-store.js";
import { createRunCapabilityPlan } from "../model-capability-registry.js";

test("InMemoryBasicAgentRunJobStore keeps frozen run facts when awaiting approval receives forged facts", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.awaitApproval(job.runId, completedPayload(forgedFacts()));

  assertFrozenFacts(runJobs.get(job.runId));
  assertFrozenFacts(runJobs.get(job.runId)?.completed);
  assert.equal(runJobs.get(job.runId)?.status, "approval_needed");
  assert.equal(runJobs.get(job.runId)?.completed?.ordinary?.pendingConfirmation?.confirmationId, "confirmation-pending");
  assert.equal(runJobs.get(job.runId)?.completed?.ordinary?.contextLedger?.runId, job.runId);
});

test("InMemoryBasicAgentRunJobStore keeps frozen run facts when completed payload is forged", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.complete(job.runId, completedPayload(forgedFacts()));

  assertFrozenFacts(runJobs.get(job.runId));
  assertFrozenFacts(runJobs.get(job.runId)?.completed);
  assert.equal(runJobs.get(job.runId)?.status, "completed");
  assertTerminalOrdinaryFacts(runJobs.get(job.runId)?.completed?.ordinary, job.runId);
});

test("InMemoryBasicAgentRunJobStore keeps frozen run facts when failed payload is forged", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.fail(job.runId, failedPayload(forgedFacts()));

  assertFrozenFacts(runJobs.get(job.runId));
  assertFrozenFacts(runJobs.get(job.runId)?.failed);
  assert.equal(runJobs.get(job.runId)?.status, "failed");
  assertTerminalOrdinaryFacts(runJobs.get(job.runId)?.failed?.ordinary, job.runId);
});

test("InMemoryBasicAgentRunJobStore keeps frozen run facts when cancelled payload is forged", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.cancel(job.runId, terminalPayload(forgedFacts()));

  assertFrozenFacts(runJobs.get(job.runId));
  assertFrozenFacts(runJobs.get(job.runId)?.cancelled);
  assert.equal(runJobs.get(job.runId)?.status, "cancelled");
  assertTerminalOrdinaryFacts(runJobs.get(job.runId)?.cancelled?.ordinary, job.runId);
  assert.equal(runJobs.get(job.runId)?.streamEvents.some((event) => event.type === "run.cancelled"), false);
});

test("InMemoryBasicAgentRunJobStore keeps frozen run facts when blocked payload is forged", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.block(job.runId, terminalPayload(forgedFacts()));

  assertFrozenFacts(runJobs.get(job.runId));
  assertFrozenFacts(runJobs.get(job.runId)?.blocked);
  assert.equal(runJobs.get(job.runId)?.status, "blocked");
  assertTerminalOrdinaryFacts(runJobs.get(job.runId)?.blocked?.ordinary, job.runId);
  assert.equal(runJobs.get(job.runId)?.streamEvents.some((event) => event.type === "run.blocked"), false);
});

test("InMemoryBasicAgentRunJobStore keeps completed terminal state stable", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.complete(job.runId, completedPayload(forgedFacts()));
  const completed = runJobs.get(job.runId);

  runJobs.fail(job.runId, failedPayload(forgedFacts()));
  runJobs.block(job.runId, terminalPayload(forgedFacts()));
  runJobs.cancel(job.runId, terminalPayload(forgedFacts()));
  runJobs.awaitApproval(job.runId, completedPayload(forgedFacts()));
  runJobs.markResuming(job.runId);
  runJobs.markNeedsInput(job.runId);
  runJobs.recordConfirmationDecision({
    runId: job.runId,
    confirmationId: "confirmation-late",
    decision: "approve_once",
    decidedAt: "2026-06-07T00:01:00.000Z",
  });
  runJobs.recordRunResumed(job.runId, {
    confirmationId: "confirmation-late",
    resumedAt: "2026-06-07T00:02:00.000Z",
  });

  const finalJob = runJobs.get(job.runId);
  assert.equal(finalJob?.status, "completed");
  assert.equal(finalJob?.updatedAt, completed?.updatedAt);
  assert.equal(finalJob?.failed, undefined);
  assert.equal(finalJob?.blocked, undefined);
  assert.equal(finalJob?.cancelled, undefined);
  assert.equal(finalJob?.completed, completed?.completed);
  assert.deepEqual(finalJob?.confirmationDecisions, []);
  assert.equal(finalJob?.streamEvents.some((event) => event.type === "user_approval.received" || event.type === "run.resumed"), false);
  assertFrozenFacts(finalJob);
  assertFrozenFacts(finalJob?.completed);
});

test("InMemoryBasicAgentRunJobStore keeps approved confirmations out of ordinary visible stream", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);

  runJobs.recordConfirmationDecision({
    runId: job.runId,
    confirmationId: "confirmation-approved",
    decision: "approve_once",
    decidedAt: "2026-06-07T00:01:00.000Z",
  });
  runJobs.recordRunResumed(job.runId, {
    confirmationId: "confirmation-approved",
    resumedAt: "2026-06-07T00:02:00.000Z",
  });
  runJobs.recordConfirmationDecision({
    runId: job.runId,
    confirmationId: "confirmation-denied",
    decision: "deny",
    decidedAt: "2026-06-07T00:03:00.000Z",
  });
  runJobs.recordConfirmationDecision({
    runId: job.runId,
    confirmationId: "confirmation-guidance",
    decision: "guidance",
    guidance: "只列出风险。",
    decidedAt: "2026-06-07T00:04:00.000Z",
  });

  const current = runJobs.get(job.runId);
  const streamText = JSON.stringify(current?.streamEvents);

  assert.equal(current?.confirmationDecisions.length, 3);
  assert.equal(current?.streamEvents.some((event) => event.type === "run.resumed"), false);
  assert.equal(current?.streamEvents.some((event) => event.summary === "已继续。"), false);
  assert.deepEqual(current?.streamEvents.map((event) => event.type), ["user_approval.received", "user.guidance"]);
  assert.equal(current?.streamEvents[0]?.agentLabel, "用户");
  assert.equal(current?.streamEvents[0]?.status, "blocked");
  assert.equal(current?.streamEvents[1]?.agentLabel, "补充要求");
  assert.equal(streamText.includes("继续处理"), false);
});

test("InMemoryBasicAgentRunJobStore owns monotonic sequence and keeps duplicate events immutable", () => {
  const runJobs = new InMemoryBasicAgentRunJobStore();
  const job = createDesktopAgentJob(runJobs);
  const event = {
    eventId: `${job.runId}:tool.completed`,
    runId: job.runId,
    type: "tool.completed",
    createdAt: "2026-06-07T00:01:00.000Z",
    agentLabel: "工具",
    summary: "读取完成。",
    status: "completed" as const,
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: ["tool-call-read"],
  };

  const first = runJobs.appendStreamEvent(job.runId, event);
  const duplicate = runJobs.appendStreamEvent(job.runId, {
    ...event,
    summary: "不应覆盖既有事实。",
  });
  const second = runJobs.appendStreamEvent(job.runId, {
    ...event,
    eventId: `${job.runId}:tool.failed`,
    type: "tool.failed",
    summary: "读取失败。",
    status: "failed",
  });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(duplicate, first);
  assert.equal(duplicate.summary, "读取完成。");
  assert.deepEqual(runJobs.get(job.runId)?.streamEvents.map((item) => item.sequence), [1, 2]);
});

function createDesktopAgentJob(runJobs: InMemoryBasicAgentRunJobStore): BasicAgentRunJob {
  const snapshot = capabilitySnapshot({
    snapshotId: "snapshot-created",
    profileId: "created-profile",
    model: "created-model",
  });
  return runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "ordinary agent run facts are frozen",
    aiMode: "fake",
    config: snapshot.activeModel,
    informationAccess: informationAccess({ maxResults: 5, sourcePreference: ["web"] }),
    capabilitySnapshot: snapshot,
    agentDefinitionRef: agentDefinitionRef(),
  });
}

function forgedFacts(): {
  readonly config: SanitizedModelProviderConfig;
  readonly informationAccess: SanitizedInformationAccessConfig;
  readonly capabilitySnapshot: BasicAgentCapabilitySnapshot;
  readonly capabilityResolution: RunCapabilityResolution;
} {
  const snapshot = capabilitySnapshot({
    snapshotId: "snapshot-forged",
    profileId: "forged-profile",
    model: "forged-model",
  });
  return {
    config: snapshot.activeModel,
    informationAccess: informationAccess({ maxResults: 99, sourcePreference: ["docs"] }),
    capabilitySnapshot: snapshot,
    capabilityResolution: {
      resolutionId: "capability-resolution-forged",
      snapshotId: "snapshot-forged",
      runMode: "agent",
      agentId: "desktop-agent-session",
      agentDisplayName: "Desktop Agent",
      toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
      capabilityPlan: createRunCapabilityPlan({
        profile: snapshot.activeModel,
        modelCapabilities: snapshot.modelCapabilities,
        allowedTools: ["forged-tool"],
        warnings: [],
      }),
      allowedTools: ["forged-tool"],
      toolExposures: [],
      enabledSkills: [],
      mcpDrafts: [],
      warnings: [],
      createdAt: "2026-06-07T00:00:00.000Z",
    },
  };
}

function completedPayload(facts: ReturnType<typeof forgedFacts>): BasicAgentRunCompletedPayload {
  return {
    ...facts,
    ordinary: ordinaryFactsWithPendingConfirmation(),
    canvas: {
      kind: "desktop_agent_canvas",
      agent: {},
    },
  };
}

function failedPayload(facts: ReturnType<typeof forgedFacts>): BasicAgentRunFailedPayload {
  return {
    ...facts,
    ordinary: ordinaryFactsWithPendingConfirmation(),
    error: {
      code: "model_failed",
      message: "forged failure",
    },
  };
}

function terminalPayload(facts: ReturnType<typeof forgedFacts>): BasicAgentRunTerminalPayload {
  return {
    ...facts,
    ordinary: ordinaryFactsWithPendingConfirmation(),
    reason: {
      code: "cancelled",
      message: "forged terminal state",
    },
  };
}

function ordinaryFactsWithPendingConfirmation(): NonNullable<BasicAgentRunCompletedPayload["ordinary"]> {
  return {
    answer: {
      content: "已形成的回答仍应保留。",
      modelCallRefs: ["model-call-answer"],
      toolCallRefs: ["tool-call-answer"],
      evidenceRefs: ["tool:tool-call-answer"],
    },
    pendingConfirmation: {
      confirmationId: "confirmation-pending",
      title: "待确认操作",
      actionSummary: "删除临时文件。",
      affectedResources: ["temporary.txt"],
      riskLevel: "medium",
      requestedAt: "2026-06-07T00:00:30.000Z",
      sourceRefs: ["confirmation:confirmation-pending"],
    },
    contextLedger: {
      runId: "desktop-trace-id",
      summary: "context",
      entries: [],
      truncation: { truncated: false, omittedItemCount: 0, truncatedItemIds: [] },
    },
  };
}

function assertTerminalOrdinaryFacts(
  ordinary: BasicAgentRunCompletedPayload["ordinary"],
  runId: string,
): void {
  assert.equal(ordinary?.answer?.content, "已形成的回答仍应保留。");
  assert.equal(ordinary?.pendingConfirmation, undefined);
  assert.equal(ordinary?.contextLedger?.runId, runId);
}

function assertFrozenFacts(
  value:
    | BasicAgentRunJob
    | BasicAgentRunCompletedPayload
    | BasicAgentRunFailedPayload
    | BasicAgentRunTerminalPayload
    | undefined
): void {
  assert.notEqual(value, undefined);
  assert.equal(value?.config.profileId, "created-profile");
  assert.equal(value?.config.model, "created-model");
  assert.deepEqual(value?.informationAccess.sourcePreference, ["web"]);
  assert.equal(value?.informationAccess.web.maxResults, 5);
  assert.equal(value?.capabilitySnapshot?.snapshotId, "snapshot-created");
  assert.equal(value?.capabilitySnapshot?.activeModel.profileId, "created-profile");
  assert.equal(value?.capabilityResolution, undefined);
}

function modelConfig(input: {
  readonly profileId: string;
  readonly model: string;
}): SanitizedModelProviderConfig {
  return {
    profileId: input.profileId,
    defaultAiMode: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: input.model,
    secretRef: `secret:model-provider:${input.profileId}`,
    secretConfigured: false,
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}

function agentDefinitionRef(): RunAgentDefinitionRef {
  return {
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    promptRef: "prompt:desktop-root-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    definitionHash: "sha256:desktop-agent-session-test",
  };
}

function capabilitySnapshot(input: {
  readonly snapshotId: string;
  readonly profileId: string;
  readonly model: string;
}): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: input.snapshotId,
    createdAt: "2026-06-07T00:00:00.000Z",
    activeModel: modelConfig(input),
    modelCapabilities: {
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
    },
    toolCatalog: {
      scope: "desktop-basic",
      allowedTools: [],
      tools: [],
    },
    skillCatalog: [],
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    securitySummary: "test snapshot",
    warnings: [],
  };
}

function informationAccess(input: {
  readonly maxResults: number;
  readonly sourcePreference: SanitizedInformationAccessConfig["sourcePreference"];
}): SanitizedInformationAccessConfig {
  return {
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: input.maxResults,
      secretRef: "secret:tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    sourcePreference: input.sourcePreference,
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}
