import assert from "node:assert/strict";
import test from "node:test";
import type {
  RunCapabilityResolution,
  SanitizedInformationAccessConfig,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-stream-contracts.js";
import { InMemoryProcessRegistry } from "../runtime-guard/index.js";
import { createPanelRunJobResponse } from "./run-job-response.js";

test("panel run job response derives events, transcript nodes, and steps from synced stream events", () => {
  const syncedToolEvent: PanelRunStreamEvent = {
    eventId: "run-response:event:2:tool.completed",
    runId: "run-response",
    sequence: 2,
    type: "tool.completed",
    createdAt: "2026-06-06T00:00:02.000Z",
    agentLabel: "工具",
    toolName: "read_file",
    summary: "读取文件完成：README.md",
    status: "completed",
    detail: {
      kind: "tool",
      action: "读取文件",
      path: "README.md",
      preview: "README.md",
    },
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: ["tool-call-readme"],
  };
  const runtime = {
    runJobs: {
      syncStreamEvents: (_runId: string, events: readonly PanelRunStreamEvent[]) => [
        ...events,
        syncedToolEvent,
      ],
    },
    runExecutor: {
      syncRunEvents: () => [],
    },
    conversations: {
      getReadModel: () => undefined,
    },
  } satisfies Parameters<typeof createPanelRunJobResponse>[0];

  const response = createPanelRunJobResponse(runtime, panelRunJob());

  assert.equal(response.transcript.events.some((event) => event.eventId === syncedToolEvent.eventId), true);
  assert.equal(response.transcriptNodes.some((node) => node.eventType === "tool.completed"), true);
  assert.equal(response.steps.some((step) => step.toolCalls.some((tool) => tool.toolName === "read_file")), true);
  assert.deepEqual(response.transcript.steps, response.steps);
  assert.deepEqual(response.transcript.transcriptNodes, response.transcriptNodes);
  assert.equal(response.streamCursor.lastSequence, 2);
});

test("panel run job response uses the payload matching the current status", () => {
  const response = createPanelRunJobResponse(emptyRuntime(), {
    ...panelRunJob(),
    status: "failed",
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
          modelCallRefs: [],
          toolCallRefs: [],
          activity: [],
        },
        explanation: {
          resultWhyReasonable: "旧确认投影不应覆盖失败终态。",
          observationPanelRole: "开发者详情展示运行事件。",
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
          observationPanelRole: "开发者详情展示运行事件。",
        },
      },
      error: {
        code: "desktop_agent_failed",
        message: "模型调用失败。",
      },
    },
  });

  assert.equal(response.status, "failed");
  assert.equal(response.error?.code, "desktop_agent_failed");
  assert.equal(response.canvas?.kind, "desktop_agent_canvas");
  assert.equal(response.canvas?.taskSoil.taskSoilId, "task-soil-failed");
  assert.equal(response.capabilityResolution?.snapshotId, "snapshot-failed");
  assert.deepEqual(response.capabilityResolution?.allowedTools, ["read"]);
});

test("panel run job response preserves failed configuration summaries", () => {
  const response = createPanelRunJobResponse(emptyRuntime(), {
    ...panelRunJob(),
    status: "failed",
    failed: {
      config: modelConfig(),
      informationAccess: informationAccess(),
      error: {
        code: "missing_api_key",
        message: "模型密钥未配置。",
      },
      summary: {
        ai: {
          enabled: true,
          mode: "openai-responses",
          providerId: "openai-responses",
          providerKind: "openai_compatible",
          protocolKind: "openai_responses",
          status: "configuration_failed",
          eventCounts: { requested: 0, completed: 0, failed: 0 },
          aiCandidateCount: 0,
          fallbackCount: 0,
          aiFallbackUsed: false,
          rootletKinds: [],
          modelCallRefs: [],
          configurationError: {
            code: "missing_api_key",
            message: "模型密钥未配置。",
          },
        },
      },
    },
  });

  assert.equal(response.status, "failed");
  assert.equal(response.summary?.ai.status, "configuration_failed");
  assert.equal(response.summary?.ai.eventCounts.requested, 0);
});

test("panel run job response exposes runtime visibility summary from process registry facts", () => {
  const registry = new InMemoryProcessRegistry({ now: () => "2026-06-16T00:00:00.000Z" });
  registry.register({
    processId: "process-response-dev-server",
    runId: "run-response",
    toolCallId: "tool-call-response-shell",
    pid: 6180,
    kind: "background",
    owned: true,
    commandLine: "pnpm dev -- --port 6180",
    cwd: "Z:\\AgentArbor",
    startedAt: "2026-06-16T00:00:00.000Z",
    status: "running",
    logRef: "command-log://run-response/tool-call-response-shell",
    logPath: "C:\\Temp\\agentarbor-command-logs\\response-dev.log",
    ports: [
      {
        port: 6180,
        host: "localhost",
        requestedAt: "2026-06-16T00:00:01.000Z",
        status: "ready",
        ready: true,
      },
    ],
  });

  const response = createPanelRunJobResponse({
    ...emptyRuntime(),
    processRegistry: registry,
  }, panelRunJob());

  assert.equal(response.runtimeSummary?.kind, "panel_runtime_visibility_summary");
  assert.equal(response.runtimeSummary?.totalCount, 1);
  assert.equal(response.runtimeSummary?.processes[0]?.pid, 6180);
  assert.equal(response.runtimeSummary?.processes[0]?.ports[0]?.port, 6180);
  assert.equal(response.runtimeSummary?.processes[0]?.logRef, "command-log://run-response/tool-call-response-shell");
  assert.equal(JSON.stringify(response.runtimeSummary).includes("should"), false);
});

function emptyRuntime(): Parameters<typeof createPanelRunJobResponse>[0] {
  return {
    runJobs: {
      syncStreamEvents: (_runId: string, events: readonly PanelRunStreamEvent[]) => events,
    },
    runExecutor: {
      syncRunEvents: () => [],
    },
    conversations: {
      getReadModel: () => undefined,
    },
  };
}

function panelRunJob(): PanelRunJob {
  return {
    runId: "run-response",
    runKind: "desktop",
    runMode: "agent",
    goal: "读取 README",
    aiMode: "fake",
    createdAt: "2026-06-06T00:00:00.000Z",
    status: "running",
    updatedAt: "2026-06-06T00:00:02.000Z",
    config: modelConfig(),
    informationAccess: informationAccess(),
    streamEvents: [],
    streamEventIds: new Set<string>(),
    nextStreamSequence: 1,
    confirmationDecisions: [],
  };
}

function capabilityResolution(snapshotId: string, allowedTools: readonly string[]): RunCapabilityResolution {
  return {
    resolutionId: `capability-resolution-${snapshotId}`,
    snapshotId,
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    allowedTools,
    toolExposures: allowedTools.map((name) => ({
      name,
      displayName: name,
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

function modelConfig(): SanitizedModelProviderConfig {
  return {
    defaultAiMode: "fake",
    profileId: "test-profile",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://test.example.test",
    model: "test-model",
    secretRef: "secret://test/model",
    secretConfigured: false,
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

function informationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-06-06T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}
