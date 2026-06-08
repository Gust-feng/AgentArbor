import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../domain/config/index.js";
import { PanelRunJobStore, type PanelRunJob } from "./panel-run-jobs.js";

test("PanelRunJobStore derives deep mode for underground run jobs at birth", () => {
  const runJobs = new PanelRunJobStore();
  const job = runJobs.create({
    runKind: "underground",
    goal: "default underground mode",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  assert.equal(job.runMode, "deep");
});

test("PanelRunJobStore rejects invalid run kind and mode pairs at birth", () => {
  const runJobs = new PanelRunJobStore();

  assert.throws(
    () =>
      runJobs.create({
        runKind: "desktop",
        runMode: "deep",
        goal: "invalid desktop deep run",
        aiMode: "fake",
        config: modelConfig(),
        informationAccess: informationAccess(),
      }),
    /Desktop run jobs must use ordinary agent mode/
  );
});

test("PanelRunJobStore requires frozen birth facts for ordinary desktop agent jobs", () => {
  const runJobs = new PanelRunJobStore();

  assert.throws(
    () =>
      runJobs.create({
        runKind: "desktop",
        runMode: "agent",
        goal: "missing capability snapshot",
        aiMode: "fake",
        config: modelConfig(),
        informationAccess: informationAccess(),
        agentDefinitionRef: agentDefinitionRef(),
      }),
    /capability snapshot frozen at run birth/
  );
  assert.throws(
    () =>
      runJobs.create({
        runKind: "desktop",
        runMode: "agent",
        goal: "missing agent definition ref",
        aiMode: "fake",
        config: modelConfig(),
        informationAccess: informationAccess(),
        capabilitySnapshot: capabilitySnapshot(),
      }),
    /AgentDefinition ref frozen at run birth/
  );

  const job = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "valid ordinary desktop agent job",
    aiMode: "fake",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilitySnapshot: capabilitySnapshot(),
    agentDefinitionRef: agentDefinitionRef(),
  });

  assert.equal(job.runMode, "agent");
  assert.equal(job.capabilitySnapshot?.snapshotId, "snapshot-panel-run-job");
  assert.equal(job.agentDefinitionRef?.agentId, "desktop-agent-session");
});

test("PanelRunJobStore keeps frozen run facts when completed payload is forged", () => {
  const runJobs = new PanelRunJobStore();
  const createdSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    snapshotId: "snapshot-created-panel-run-job",
    activeModel: {
      ...modelConfig(),
      profileId: "created-profile",
      model: "created-model",
    },
  };
  const job = runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "valid ordinary desktop agent job",
    aiMode: "fake",
    config: createdSnapshot.activeModel,
    informationAccess: informationAccess(),
    capabilitySnapshot: createdSnapshot,
    agentDefinitionRef: agentDefinitionRef(),
  });
  const forgedSnapshot: BasicAgentCapabilitySnapshot = {
    ...capabilitySnapshot(),
    snapshotId: "snapshot-forged-panel-run-job",
    activeModel: {
      ...modelConfig(),
      profileId: "forged-profile",
      model: "forged-model",
    },
  };

  runJobs.complete(job.runId, {
    config: forgedSnapshot.activeModel,
    informationAccess: {
      ...informationAccess(),
      sourcePreference: ["docs"],
      web: {
        ...informationAccess().web,
        maxResults: 99,
      },
    },
    capabilitySnapshot: forgedSnapshot,
    capabilityResolution: forgedCapabilityResolution(),
  });

  const completed = runJobs.get(job.runId);
  assert.equal(completed?.config.profileId, "created-profile");
  assert.equal(completed?.config.model, "created-model");
  assert.deepEqual(completed?.informationAccess.sourcePreference, ["web"]);
  assert.equal(completed?.informationAccess.web.maxResults, 5);
  assert.equal(completed?.capabilitySnapshot?.snapshotId, "snapshot-created-panel-run-job");
  assert.equal(completed?.completed?.config.profileId, "created-profile");
  assert.deepEqual(completed?.completed?.informationAccess.sourcePreference, ["web"]);
  assert.equal(completed?.completed?.capabilitySnapshot?.snapshotId, "snapshot-created-panel-run-job");
  assert.equal(completed?.capabilityResolution, undefined);
  assert.equal(completed?.completed?.capabilityResolution, undefined);
});

test("PanelRunJobStore accepts only capability resolution matching frozen agent birth facts", () => {
  const runJobs = new PanelRunJobStore();
  const acceptedJob = createDesktopAgentJob(runJobs);
  const acceptedResolution = matchingCapabilityResolution(
    acceptedJob.capabilitySnapshot,
    acceptedJob.agentDefinitionRef
  );

  runJobs.complete(acceptedJob.runId, completedPayload({
    config: acceptedJob.config,
    informationAccess: acceptedJob.informationAccess,
    capabilitySnapshot: acceptedJob.capabilitySnapshot as BasicAgentCapabilitySnapshot,
    capabilityResolution: acceptedResolution,
  }));

  const accepted = runJobs.get(acceptedJob.runId);
  assert.deepEqual(accepted?.capabilityResolution, acceptedResolution);
  assert.deepEqual(accepted?.completed?.capabilityResolution, acceptedResolution);

  const rejectedJob = createDesktopAgentJob(runJobs);
  const rejectedResolution: RunCapabilityResolution = {
    ...matchingCapabilityResolution(rejectedJob.capabilitySnapshot, rejectedJob.agentDefinitionRef),
    agentId: "forged-agent",
    agentDisplayName: "Forged Agent",
  };

  runJobs.complete(rejectedJob.runId, completedPayload({
    config: rejectedJob.config,
    informationAccess: rejectedJob.informationAccess,
    capabilitySnapshot: rejectedJob.capabilitySnapshot as BasicAgentCapabilitySnapshot,
    capabilityResolution: rejectedResolution,
  }));

  const rejected = runJobs.get(rejectedJob.runId);
  assert.equal(rejected?.capabilityResolution, undefined);
  assert.equal(rejected?.completed?.capabilityResolution, undefined);
});

test("PanelRunJobStore keeps completed terminal state stable", () => {
  const runJobs = new PanelRunJobStore();
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
  assert.equal(finalJob?.streamEvents.some((event) => event.type === "run.cancelled" || event.type === "run.blocked"), false);
  assert.equal(finalJob?.streamEvents.some((event) => event.type === "user_approval.received" || event.type === "run.resumed"), false);
  assertFrozenFacts(finalJob);
  assertFrozenFacts(finalJob?.completed);
});

test("PanelRunJobStore keeps approved confirmations out of ordinary visible stream", () => {
  const runJobs = new PanelRunJobStore();
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

function createDesktopAgentJob(runJobs: PanelRunJobStore): PanelRunJob {
  const snapshot = {
    ...capabilitySnapshot(),
    snapshotId: "snapshot-created-panel-run-job-stable",
    activeModel: {
      ...modelConfig(),
      profileId: "created-profile",
      model: "created-model",
    },
  };
  return runJobs.create({
    runKind: "desktop",
    runMode: "agent",
    goal: "valid ordinary desktop agent job",
    aiMode: "fake",
    config: snapshot.activeModel,
    informationAccess: informationAccess(),
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
  const snapshot = {
    ...capabilitySnapshot(),
    snapshotId: "snapshot-forged-panel-run-job-stable",
    activeModel: {
      ...modelConfig(),
      profileId: "forged-profile",
      model: "forged-model",
    },
  };
  return {
    config: snapshot.activeModel,
    informationAccess: {
      ...informationAccess(),
      sourcePreference: ["docs"],
      web: {
        ...informationAccess().web,
        maxResults: 99,
      },
    },
    capabilitySnapshot: snapshot,
    capabilityResolution: forgedCapabilityResolution(),
  };
}

function completedPayload(facts: ReturnType<typeof forgedFacts>): Parameters<PanelRunJobStore["complete"]>[1] {
  return {
    ...facts,
    canvas: {
      kind: "desktop_agent_canvas",
      taskSoil: {
        taskSoilId: "task-soil-completed",
        goalSummary: "completed",
        contextRefs: [],
        permissionBoundaryRefs: [],
      },
      agent: {
        status: "completed",
        modelCallRefs: [],
        toolCallRefs: [],
        activity: [],
      },
      explanation: {
        resultWhyReasonable: "completed",
        observationPanelRole: "safe events only",
      },
    },
  };
}

function failedPayload(facts: ReturnType<typeof forgedFacts>): Parameters<PanelRunJobStore["fail"]>[1] {
  return {
    ...facts,
    error: {
      code: "model_failed",
      message: "forged failure",
    },
  };
}

function terminalPayload(facts: ReturnType<typeof forgedFacts>): Parameters<PanelRunJobStore["block"]>[1] {
  return {
    ...facts,
    reason: {
      code: "late_terminal",
      message: "late terminal state",
    },
  };
}

function assertFrozenFacts(
  value:
    | PanelRunJob
    | Parameters<PanelRunJobStore["complete"]>[1]
    | Parameters<PanelRunJobStore["fail"]>[1]
    | Parameters<PanelRunJobStore["block"]>[1]
    | undefined
): void {
  assert.notEqual(value, undefined);
  assert.equal(value?.config.profileId, "created-profile");
  assert.equal(value?.config.model, "created-model");
  assert.deepEqual(value?.informationAccess.sourcePreference, ["web"]);
  assert.equal(value?.informationAccess.web.maxResults, 5);
  assert.equal(value?.capabilitySnapshot?.snapshotId, "snapshot-created-panel-run-job-stable");
  assert.equal(value?.capabilityResolution, undefined);
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    profileId: "default",
    defaultAiMode: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: "test-model",
    secretRef: "secret:model-provider:default",
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
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-panel-run-job",
    createdAt: "2026-06-07T00:00:00.000Z",
    activeModel: modelConfig(),
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
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: process.cwd(),
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    securitySummary: "test snapshot",
    warnings: [],
  };
}

function forgedCapabilityResolution(): RunCapabilityResolution {
  return {
    resolutionId: "capability-resolution-forged",
    snapshotId: "snapshot-forged-panel-run-job",
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
    allowedTools: ["forged-tool"],
    toolExposures: [],
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-06-07T00:00:00.000Z",
  };
}

function matchingCapabilityResolution(
  snapshot: BasicAgentCapabilitySnapshot | undefined,
  agentRef: RunAgentDefinitionRef | undefined
): RunCapabilityResolution {
  assert.notEqual(snapshot, undefined);
  assert.notEqual(agentRef, undefined);
  const frozenSnapshot = snapshot as BasicAgentCapabilitySnapshot;
  const frozenAgentRef = agentRef as RunAgentDefinitionRef;
  return {
    resolutionId: "capability-resolution-matching",
    snapshotId: frozenSnapshot.snapshotId,
    runMode: "agent",
    agentId: frozenAgentRef.agentId,
    agentDisplayName: frozenAgentRef.agentDisplayName,
    toolVisibilityProfileId: frozenAgentRef.toolVisibilityProfileId,
    allowedTools: [],
    toolExposures: [],
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-06-07T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret:tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    sourcePreference: ["web"],
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}
