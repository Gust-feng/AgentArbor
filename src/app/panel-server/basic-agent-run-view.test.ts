import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  RunAgentDefinitionRef,
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { BasicAgentRun, RunEvent } from "../../domain/basic-agent/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-stream-contracts.js";
import { createBasicAgentRunViewReadModel } from "./basic-agent-run-view.js";

test("basic agent run view for live runs exposes the job birth agent definition ref consistently", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const jobAgentDefinitionRef = agentRef("job-birth-agent", "Job Birth Agent");
  const run = basicRun(runAgentDefinitionRef);
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
      syncRunEvents: () => [],
    },
    runJobs: {
      get: () => basicJob(jobAgentDefinitionRef),
      syncStreamEvents: (_runId: string, events: readonly never[]) => events,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.notEqual(view, undefined);
  assert.notDeepEqual(runAgentDefinitionRef, jobAgentDefinitionRef);
  assert.deepEqual(view?.run.agentDefinitionRef, jobAgentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, jobAgentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, view?.run.agentDefinitionRef);
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-live");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(view === undefined ? false : "workSession" in view, false);
});

test("basic agent run view prefers completed live run facts over stale job facts", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "completed" as const,
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
      syncRunEvents: () => [],
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "completed" as const,
        capabilityResolution: capabilityResolution("snapshot-stale-job", ["stale"]),
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-completed", ["read"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-completed",
              goalSummary: "完成运行",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "completed" as const,
              finalAnswer: "完成回答。",
              modelCallRefs: ["model-call-completed"],
              toolCallRefs: ["tool-call-read"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "已回答。",
              observationPanelRole: "开发者详情只展示安全事件。",
            },
          },
        },
      }),
      syncStreamEvents: (_runId: string, events: readonly never[]) => events,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.detail.status, "completed");
  assert.equal(view?.detail.canvas?.kind, "desktop_agent_canvas");
  assert.equal(view?.detail.canvas?.agent.status, "completed");
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-completed");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.notEqual(view?.capabilityResolution?.snapshotId, "snapshot-stale-job");
});

test("basic agent run view exposes failed live desktop canvas from the backend result", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "failed" as const,
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
      syncRunEvents: () => [],
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "failed" as const,
        capabilityResolution: capabilityResolution("snapshot-stale-job", ["stale"]),
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-stale-completed", ["stale-completed"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-stale-completed",
              goalSummary: "旧确认视图",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "confirmation_needed" as const,
              modelCallRefs: ["model-call-stale"],
              toolCallRefs: ["tool-call-stale"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "这是旧的确认投影，不应覆盖失败终态。",
              observationPanelRole: "开发者详情只展示安全事件。",
            },
          },
        },
        failed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-failed", ["read"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-failed",
              goalSummary: "失败运行",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "failed" as const,
              failureMessage: "模型调用失败。",
              modelCallRefs: ["model-call-failed"],
              toolCallRefs: [],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "",
              observationPanelRole: "开发者详情只展示安全事件。",
            },
          },
          error: {
            code: "desktop_agent_failed",
            message: "模型调用失败。",
          },
        },
      }),
      syncStreamEvents: (_runId: string, events: readonly never[]) => events,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.detail.status, "failed");
  assert.equal(view?.detail.error?.code, "desktop_agent_failed");
  assert.equal(view?.detail.canvas?.kind, "desktop_agent_canvas");
  assert.equal(view?.detail.canvas?.taskSoil.taskSoilId, "task-soil-failed");
  assert.equal(view?.detail.canvas?.agent.status, "failed");
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-failed");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.equal(view?.workView.stage, "failed");
  assert.equal(view?.workView.stage, "failed");
  assert.equal(view === undefined ? false : "workSession" in view, false);
});

test("basic agent run view exposes cancelled live desktop canvas from the backend result", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "cancelled" as const,
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
      syncRunEvents: () => [],
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "cancelled" as const,
        capabilityResolution: capabilityResolution("snapshot-stale-job", ["stale"]),
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-stale-completed", ["stale-completed"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-stale-completed",
              goalSummary: "旧确认视图",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "confirmation_needed" as const,
              modelCallRefs: ["model-call-stale"],
              toolCallRefs: ["tool-call-stale"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "这是旧的确认投影，不应覆盖取消终态。",
              observationPanelRole: "开发者详情只展示安全事件。",
            },
          },
        },
        cancelled: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-cancelled", ["read"]),
          reason: {
            code: "user_cancelled",
            message: "用户取消了运行。",
          },
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-cancelled",
              goalSummary: "取消运行",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "stopped" as const,
              modelCallRefs: ["model-call-cancelled"],
              toolCallRefs: ["tool-call-read"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "普通 Agent 运行已由用户取消，当前只展示取消前的安全投影。",
              observationPanelRole: "开发者详情只展示安全事件。",
            },
          },
        },
      }),
      syncStreamEvents: (_runId: string, events: readonly never[]) => events,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.detail.status, "cancelled");
  assert.equal(view?.detail.error?.code, "user_cancelled");
  assert.equal(view?.detail.canvas?.kind, "desktop_agent_canvas");
  assert.equal(view?.detail.canvas?.taskSoil.taskSoilId, "task-soil-cancelled");
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-cancelled");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.notEqual(view?.capabilityResolution?.snapshotId, "snapshot-stale-job");
});

test("basic agent live work view builds transcript nodes from synced backend stream events", async () => {
  const runAgentDefinitionRef = agentRef("run-agent", "Run Agent");
  const run = {
    ...basicRun(runAgentDefinitionRef),
    status: "approval_needed" as const,
  };
  const syncedConfirmationEvent: PanelRunStreamEvent = {
    eventId: "run-live:event:2:confirmation.needed",
    runId: run.runId,
    sequence: 2,
    type: "confirmation.needed",
    createdAt: "2026-06-06T00:00:02.000Z",
    agentLabel: "待确认",
    summary: "需要确认：编辑 Z:\\AgentArbor\\README.md",
    status: "running",
    sourceRefs: ["confirmation:confirmation-live"],
    modelCallRefs: [],
    toolCallRefs: ["tool-call-edit"],
  };
  const runtime = {
    runExecutor: {
      get: () => run,
      replayEvents: () => basicReplay(run.runId),
      syncRunEvents: () => [],
    },
    runJobs: {
      get: () => ({
        ...basicJob(runAgentDefinitionRef),
        status: "approval_needed" as const,
        streamEvents: [],
        completed: {
          config: modelConfig(),
          informationAccess: informationAccess(),
          capabilityResolution: capabilityResolution("snapshot-live", ["search"]),
          canvas: {
            kind: "desktop_agent_canvas" as const,
            taskSoil: {
              taskSoilId: "task-soil-confirmation",
              goalSummary: "等待确认",
              contextRefs: [],
              permissionBoundaryRefs: [],
            },
            agent: {
              status: "confirmation_needed" as const,
              pendingConfirmation: {
                confirmationId: "confirmation-live",
                title: "需要确认",
                question: "是否编辑 README.md？",
                consequence: "会写入工作区文件。",
                riskLevel: "medium",
                modelCallRefs: [],
                toolCallRefs: ["tool-call-edit"],
                sourceRefs: ["confirmation:confirmation-live"],
              },
              modelCallRefs: [],
              toolCallRefs: ["tool-call-edit"],
              activity: [],
            },
            explanation: {
              resultWhyReasonable: "桌面助手等待你判断后继续。",
              observationPanelRole: "开发者详情只展示安全事件。",
            },
          },
        },
      }),
      syncStreamEvents: () => [syncedConfirmationEvent],
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-live", 0);

  assert.equal(view?.run.status, "approval_needed");
  assert.equal(view?.workView.stage, "awaiting_approval");
  assert.equal(view?.workView.pendingConfirmation?.confirmationId, "confirmation-live");
  assert.equal(view?.workView.pendingConfirmation?.actionSummary, "是否编辑 README.md？");
  assert.equal(view?.workView.pendingConfirmation?.actionSummary.includes("会写入工作区文件"), false);
  assert.equal(view?.workView.transcriptNodes.some((node) => node.kind === "confirmation"), true);
  assert.equal(view?.detail.transcript?.events?.some((event) => event.type === "confirmation.needed"), true);
});

test("basic agent run view for persisted runs restores from the run snapshot without current config readers", async () => {
  const snapshot = runtimeSnapshot();
  const runtime = {
    runExecutor: {
      get: () => undefined,
      replayEvents: () => undefined,
      syncRunEvents: () => [],
    },
    runJobs: {
      get: () => undefined,
      syncStreamEvents: (_runId: string, events: readonly never[]) => events,
    },
    runtimeDatabase: {
      getRun: async () => snapshot,
    },
  } satisfies Parameters<typeof createBasicAgentRunViewReadModel>[0];

  const view = await createBasicAgentRunViewReadModel(runtime, "run-restored", 0);

  assert.notEqual(view, undefined);
  assert.equal(view?.run.runId, "run-restored");
  assert.equal(view?.run.status, "completed");
  assert.deepEqual(view?.run.agentDefinitionRef, snapshot.run.agentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, snapshot.run.agentDefinitionRef);
  assert.deepEqual(view?.agentDefinitionRef, view?.run.agentDefinitionRef);
  assert.deepEqual(view?.capabilityResolution, snapshot.run.capabilityResolution);
  assert.equal(view?.capabilityResolution?.snapshotId, "snapshot-restored");
  assert.deepEqual(view?.capabilityResolution?.allowedTools, ["read"]);
  assert.equal(view?.detail.restoredResult?.summary, "历史运行安全摘要");
  assert.equal(view?.replay.events.some((event) => event.type === "final.result"), true);
  assert.equal(view?.detail.transcript?.events?.some((event) => event.type === "final.result"), true);
  assert.equal(view === undefined ? false : "workSession" in view, false);
  assert.equal(JSON.stringify(view?.agentDefinitionRef).includes("systemPrompt"), false);
});

function basicRun(agentDefinitionRef: RunAgentDefinitionRef): BasicAgentRun {
  return {
    runId: "run-live",
    conversationId: "conversation-live",
    title: "正在处理",
    goalSummary: "测试 live run view",
    status: "running",
    runMode: "agent",
    agentDefinitionRef,
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:01.000Z",
    eventCursor: {
      lastSequence: 1,
      eventCount: 1,
    },
  };
}

function basicReplay(runId: string): {
  readonly events: readonly RunEvent[];
  readonly cursor: { readonly runId: string; readonly lastSequence: number; readonly eventCount: number };
} {
  return {
    events: [
      {
        id: `${runId}:event:1`,
        runId,
        sequence: 1,
        type: "run.started",
        title: "任务已开始",
        summary: "开始处理。",
        status: "running",
        timestamp: "2026-06-06T00:00:01.000Z",
        refs: [],
        visibility: "compact",
      },
    ],
    cursor: {
      runId,
      lastSequence: 1,
      eventCount: 1,
    },
  };
}

function basicJob(agentDefinitionRef: RunAgentDefinitionRef): PanelRunJob {
  return {
    runId: "run-live",
    runKind: "desktop",
    runMode: "agent",
    goal: "测试 live run view",
    aiMode: "fake",
    conversationId: "conversation-live",
    agentDefinitionRef,
    createdAt: "2026-06-06T00:00:00.000Z",
    status: "running",
    updatedAt: "2026-06-06T00:00:01.000Z",
    config: modelConfig(),
    informationAccess: informationAccess(),
    capabilityResolution: capabilityResolution("snapshot-live", ["search"]),
    streamEvents: [],
    streamEventIds: new Set<string>(),
    nextStreamSequence: 1,
    confirmationDecisions: [],
  };
}

function agentRef(agentId: string, agentDisplayName: string): RunAgentDefinitionRef {
  return {
    agentId,
    agentDisplayName,
    promptRef: `prompt:${agentId}:v1`,
    promptVersion: "1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: `${agentId}:ordinary-visible-tools:v1`,
  };
}

function runtimeSnapshot(): RuntimeRunSnapshot {
  return {
    run: {
      runId: "run-restored",
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status: "completed",
      goalSummary: "恢复历史运行",
      aiMode: "fake",
      conversationId: "conversation-restored",
      traceId: "trace-restored",
      appHome: "C:\\AgentArbor\\app",
      runHome: "C:\\AgentArbor\\runtime\\runs\\run-restored",
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:10.000Z",
      completedAt: "2026-06-06T00:00:10.000Z",
      resultTitle: "已完成",
      resultSummary: "历史运行安全摘要",
      agentDefinitionRef: {
        agentId: "restored-basic-agent",
        agentDisplayName: "Restored Basic Agent",
        promptRef: "prompt:restored-basic-agent:v1",
        promptVersion: "1",
        outputContractId: "desktop.agent_response.v1",
        toolVisibilityProfileId: "restored-basic-agent:ordinary-visible-tools:v1",
      },
      capabilitySnapshot: capabilitySnapshot(),
      capabilityResolution: capabilityResolution("snapshot-restored", ["read"]),
      informationAccess: informationAccess(),
    },
    basicEvents: [],
    events: [],
    modelCalls: [],
    toolCalls: [],
    artifacts: [],
    confirmations: [],
  };
}

function capabilityResolution(snapshotId: string, allowedTools: readonly string[]): RunCapabilityResolution {
  return {
    resolutionId: `capability-resolution-${snapshotId}`,
    snapshotId,
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
    allowedTools,
    toolExposures: allowedTools.map((name) => ({
      name,
      displayName: name === "read" ? "Read" : "Search",
      enabled: true,
      modelVisible: true,
      scopes: ["desktop-basic"],
      availability: "available",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
      reason: "可用。",
    })),
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-06-06T00:00:00.000Z",
  };
}

function capabilitySnapshot(): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "snapshot-restored",
    createdAt: "2026-06-06T00:00:00.000Z",
    activeModel: modelConfig(),
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 4_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
    toolCatalog: { scope: "desktop-basic", tools: [], allowedTools: [] },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\AgentArbor",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    securitySummary: "Frozen safe capability facts.",
    warnings: [],
  };
}

function modelConfig(): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId: "snapshot-profile",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://snapshot.example.test",
    model: "snapshot-model",
    secretRef: "secret://snapshot/model",
    secretConfigured: false,
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web", "codebase"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret://snapshot/tavily",
      secretConfigured: false,
      status: "ready",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "stub",
      github: "readonly_stub",
      run_memory: "stub",
    },
  };
}
