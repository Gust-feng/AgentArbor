import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../../../domain/common.js";
import { ROOTLET_CLUSTER_KINDS } from "../../../domain/underground/index.js";
import type { EventLogEntry } from "../../../kernel/events/in-memory-event-log.js";
import type { AgentRunTreeAttachment } from "../../run-read-model/agent-run-tree-attachment.js";
import type { PanelRunSummary } from "./panel-run-summary.js";
import { createPanelRunTrace, createPanelRunTracking } from "./panel-run-tracking.js";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../../domain/config/index.js";

test("panel run tracking derives safe provider context and event totals", () => {
  const tracking = createPanelRunTracking({
    status: "running",
    config: {
      profileId: "default",
      defaultAiMode: "openai-compatible",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.example.test/v1",
      model: "example-model",
      secretRef: "model-provider-api-key",
      secretConfigured: true,
      updatedAt: "2026-05-07T00:00:00.000Z",
      openAI: {},
    } satisfies SanitizedModelProviderConfig,
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    runMode: "agent",
    eventEntries: [
      eventEntry(1, "goal.received", {}),
      eventEntry(2, "model.requested", { requestId: "request-1" }),
      eventEntry(3, "tool.requested", { toolCallId: "tool-1" }),
      eventEntry(4, "tool.completed", { toolCallId: "tool-1" }),
      eventEntry(5, "context.compaction.completed", {
        tokenCount: 320,
        threshold: 400,
        coveredRefCount: 3,
        summary: "Earlier context was safely summarized.",
      }),
    ],
  });

  assert.equal(tracking.provider.status, "ready");
  assert.deepEqual(tracking.modelTotals, { requested: 1, completed: 0, failed: 0 });
  assert.deepEqual(tracking.toolTotals, { requested: 1, completed: 1, failed: 0, cancelled: 0 });
  assert.equal(tracking.run.phase, "agent");
  assert.equal(tracking.context.compaction.latest?.summary, "Earlier context was safely summarized.");
  assert.equal(JSON.stringify(tracking).includes("sk-secret"), false);
});

test("panel run tracking keeps shared model events in underground phase for deep runs", () => {
  const tracking = createPanelRunTracking({
    status: "running",
    config: modelConfig(),
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    runMode: "deep",
    eventEntries: [
      eventEntry(1, "goal.received", {}),
      eventEntry(2, "model.requested", { requestId: "request-1" }),
    ],
  });

  assert.equal(tracking.run.phase, "underground");
});

test("ordinary agent trace keeps skill events and hides deep compatibility while runtime projection keeps raw event facts", () => {
  const eventEntries = [
    eventEntry(1, "goal.received", {}),
    eventEntry(2, "skill.triggered", { skillId: "skill-legacy" }),
    eventEntry(3, "agent.delegation.planned", { decisionId: "delegation-legacy" }),
    eventEntry(4, "model.requested", { requestId: "request-ordinary" }),
    eventEntry(5, "artifact.produced", { artifactId: "legacy-report" }),
    eventEntry(6, "tool.completed", { callId: "tool-call-ordinary" }),
  ];

  const visible = createPanelRunTrace({
    status: "running",
    runMode: "agent",
    eventEntries,
  });
  const runtime = createPanelRunTrace({
    status: "running",
    runMode: "agent",
    projection: "runtime",
    eventEntries,
  });

  assert.deepEqual(
    visible.events.map((event) => event.type),
    ["goal.received", "skill.triggered", "model.requested", "tool.completed"],
  );
  assert.equal(visible.currentPhase, "agent");
  assert.equal(visible.eventCursor.eventCount, 4);
  assert.deepEqual(
    runtime.events.map((event) => event.type),
    eventEntries.map((entry) => entry.type),
  );
  assert.equal(runtime.eventCursor.eventCount, eventEntries.length);
});

test("ordinary agent tracking ignores deep summaries, observations, agent trees, and rootlet events", () => {
  const tracking = createPanelRunTracking({
    status: "running",
    config: modelConfig(),
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    runMode: "agent",
    summary: deepSummaryFixture(),
    agentRunTree: agentRunTreeFixture(),
    eventEntries: [
      eventEntry(1, "goal.received", {}),
      eventEntry(2, "rootlet_cluster.started", {}),
      eventEntry(3, "exploration_candidate.produced", {}),
      eventEntry(4, "agent.delegation.planned", { decisionId: "delegation-legacy" }),
      eventEntry(5, "direction_handoff.completed", {}),
      eventEntry(6, "artifact.produced", {}),
      eventEntry(7, "model.requested", { requestId: "request-ordinary" }),
      eventEntry(8, "tool.completed", { callId: "tool-call-ordinary" }),
    ],
  });
  const serialized = JSON.stringify(tracking);

  assert.equal(tracking.package, undefined);
  assert.equal(tracking.convergence, undefined);
  assert.equal(tracking.agentRunTree, undefined);
  assert.equal(tracking.aiCandidates.total, 0);
  assert.equal(tracking.aiCandidates.fallbackTotal, 0);
  assert.equal(tracking.candidates.total.total, 0);
  assert.equal(tracking.run.abovegroundStatus, "not_started");
  assert.equal(tracking.run.phase, "agent");
  assert.equal(tracking.run.eventCount, 3);
  assert.equal(tracking.run.lastEventType, "tool.completed");
  for (const kind of ROOTLET_CLUSTER_KINDS) {
    assert.equal(tracking.rootletsByKind[kind].clusterStatus, "not_started");
    assert.equal(tracking.rootletsByKind[kind].model.status, "not_requested");
    assert.equal(tracking.rootletsByKind[kind].candidates.total, 0);
  }
  assert.equal(serialized.includes("deep-direction-package"), false);
  assert.equal(serialized.includes("deep-convergence-review"), false);
  assert.equal(serialized.includes("deep-agent-run-tree"), false);
});

test("deep tracking still consumes deep summary and agent tree facts", () => {
  const tracking = createPanelRunTracking({
    status: "completed",
    config: modelConfig(),
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    runMode: "deep",
    summary: deepSummaryFixture(),
    agentRunTree: agentRunTreeFixture(),
    eventEntries: [
      eventEntry(1, "goal.received", {}),
      eventEntry(2, "rootlet_cluster.started", {}),
      eventEntry(3, "model.requested", { requestId: "request-deep" }),
    ],
  });

  assert.equal(tracking.package?.id, "deep-direction-package");
  assert.equal(tracking.convergence?.reviewId, "deep-convergence-review");
  assert.equal(tracking.agentRunTree?.treeId, "deep-agent-run-tree");
  assert.equal(tracking.aiCandidates.total, 4);
  assert.equal(tracking.candidates.total.total, 7);
  assert.equal(tracking.rootletsByKind.option.clusterStatus, "running");
});

test("panel run tracking reports provider configuration boundaries without secret values", () => {
  const tracking = createPanelRunTracking({
    status: "failed",
    config: {
      profileId: "default",
      defaultAiMode: "openai-compatible",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.example.test/v1",
      secretRef: "model-provider-api-key",
      secretConfigured: false,
      updatedAt: "2026-05-07T00:00:00.000Z",
      openAI: {},
    } satisfies SanitizedModelProviderConfig,
    informationAccess: informationAccess(),
    requestedMode: "openai-compatible",
    runMode: "agent",
    eventEntries: [],
  });

  assert.equal(tracking.provider.status, "missing_model_and_secret");
  assert.equal(tracking.run.waitingPoint, "");
  assert.equal(JSON.stringify(tracking).includes("apiKey"), false);
  assert.equal(JSON.stringify(tracking).includes("未完成，请查看错误摘要"), false);
});

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "tavily-api-key",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "readonly_stub",
      github: "readonly_stub",
      run_memory: "readonly_stub",
    },
  };
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    profileId: "default",
    defaultAiMode: "openai-compatible",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://api.example.test/v1",
    model: "example-model",
    secretRef: "model-provider-api-key",
    secretConfigured: true,
    updatedAt: "2026-05-07T00:00:00.000Z",
    openAI: {},
  };
}

function deepSummaryFixture(): PanelRunSummary {
  return {
    terminalStatus: "approved_package_created",
    directionPackage: {
      id: "deep-direction-package",
      directionId: "deep-direction",
      version: 3,
      status: "approved",
      validation: {
        passed: true,
        errors: [],
        warnings: [
          {
            code: "deep_warning",
            message: "Deep warning fixture.",
            path: "direction.md",
            severity: "warning",
          },
        ],
      },
    },
    lineage: {
      current: {
        packageId: "deep-direction-package",
        directionId: "deep-direction",
        version: 3,
        status: "approved",
        schemaVersion: "direction-handoff-package/v0.2",
      },
      revisionReason: "initial",
      sourceRefs: ["candidate:deep-option"],
      createdAt: "2026-05-07T00:00:00.000Z",
    },
    versions: [1, 2, 3],
    ai: {
      enabled: true,
      mode: "openai-compatible",
      status: "completed",
      eventCounts: {
        requested: 5,
        completed: 4,
        failed: 1,
      },
      aiCandidateCount: 4,
      fallbackCount: 2,
      aiFallbackUsed: true,
      rootletKinds: [
        {
          kind: "option",
          status: "completed",
          requested: 2,
          completed: 2,
          failed: 0,
          aiCandidateCount: 3,
          fallbackCount: 1,
          aiFallbackUsed: true,
        },
      ],
      modelCallRefs: [],
    },
    tools: {
      eventCounts: {
        requested: 2,
        completed: 2,
        failed: 0,
        cancelled: 0,
      },
      toolCallRefs: [],
    },
    underground: {
      autonomy: {
        enabled: true,
        cycleCount: 2,
        latestAction: "request_convergence",
        latestDecisionStatus: "completed",
        spawnedRootletCount: 1,
        sourceRefs: ["autonomy:deep"],
        modelCallRefs: ["model:deep-autonomy"],
      },
      rootletKinds: ["option"],
      budget: {
        maxRootletClusters: 6,
        maxCandidateOutputs: 12,
        spentRootletClusters: 1,
        spentCandidateOutputs: 7,
        exhausted: false,
      },
      candidateCounts: {
        total: 7,
        candidate: 2,
        accepted: 3,
        merged: 1,
        rejected: 1,
        unknown: 0,
      },
      convergence: {
        reviewId: "deep-convergence-review",
        outcome: "approved",
        accepted: 3,
        merged: 1,
        rejected: 1,
        unknown: 0,
        userEscalationRequired: false,
      },
    },
    observationSnapshot: {
      phase: "completed",
      stage: "direction_handoff_completed",
      eventCursor: {
        eventCount: 9,
        lastSequence: 9,
        lastEventType: "direction_handoff.completed",
      },
      layerStatuses: {
        underground: "completed",
        handoff: "completed",
        aboveground: "completed",
        fruits: "completed",
        governance: "not_started",
        soilReturnStub: "not_started",
      },
    },
    eventLog: ["direction_handoff.completed"],
  };
}

function agentRunTreeFixture(): AgentRunTreeAttachment {
  return {
    treeId: "deep-agent-run-tree",
    rootRunId: "deep-root-run",
    rootAgentId: "deep-root-agent",
    rootSpec: agentRunTreeSpec("deep-root-spec", "deep-root-agent", "Deep Root Agent"),
    childRuns: [
      {
        childRunId: "deep-child-run",
        parentAgentId: "deep-root-agent",
        spec: agentRunTreeSpec("deep-child-spec", "deep-child-agent", "Deep Child Agent", "option"),
        status: "completed",
        inputRefs: ["input:deep"],
        outputRefs: ["output:deep"],
        evidenceRefs: ["evidence:deep"],
        startedAt: "2026-05-07T00:00:01.000Z",
        completedAt: "2026-05-07T00:00:02.000Z",
      },
    ],
    delegationDecisions: [],
    parentSyntheses: [],
    status: "completed",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  };
}

function agentRunTreeSpec(
  specId: string,
  agentId: string,
  displayName: string,
  rootletKind?: "option"
): AgentRunTreeAttachment["rootSpec"] {
  return {
    specId,
    agentId,
    displayName,
    agentKind: rootletKind === undefined ? "parent" : "child",
    role: rootletKind === undefined ? "center" : "rootlet",
    rootletKind,
    promptRef: `prompt:${agentId}:v1`,
    outputContractRef: `contract:${agentId}:v1`,
    permissions: {
      allowModel: true,
      allowedTools: ["search"],
    },
    budget: {
      maxModelRounds: 2,
      maxToolRounds: 1,
      maxChildRuns: rootletKind === undefined ? 1 : undefined,
      maxOutputRefs: 3,
    },
  };
}

function eventEntry(sequence: number, type: ArborMessageType, payload: Record<string, unknown>): EventLogEntry {
  const message: ArborMessage = {
    id: `message-${sequence}`,
    traceId: "trace-panel-tracking",
    from: { id: "test", role: "system" },
    type,
    intent: type.replaceAll(".", "_"),
    payload,
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence,
    type,
    message,
    recordedAt: "2026-05-07T00:00:00.000Z",
  };
}
