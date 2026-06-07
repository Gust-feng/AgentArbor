import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../../domain/common.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import type { PanelRunJob } from "../panel-run-jobs.js";
import type { PanelRunStreamEvent } from "../panel-run-stream-contracts.js";
import type { PanelRunTraceReadModel } from "../panel-run-tracking-contracts.js";
import type { PanelRunTranscript } from "../panel-run-transcript-contracts.js";
import {
  compactRuntimeText,
  createRuntimeRunRecord,
  createRuntimeWorkspaceRecord,
  isTerminalPanelRunStatus,
  toRuntimeConfirmationRecords,
  toRuntimeEventRecord,
  toRuntimeModelCallRecord,
  toRuntimeToolCallRecords,
} from "./runtime-records.js";

test("runtime record mapper creates safe run and workspace records", () => {
  const workspace = createRuntimeWorkspaceRecord({
    workspaceDirectory: "Z:\\AgentArbor",
    updatedAt: "2026-05-31T00:00:00.000Z",
  }, "2026-05-31T00:00:01.000Z");
  const run = createRuntimeRunRecord({
    job: job({
      status: "failed",
      failed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        error: {
          code: "provider_failed",
          message: "provider failed with sk-hidden-secret",
        },
      },
    }),
    workspace,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.equal(workspace.label, "AgentArbor");
  assert.equal(run.completedAt, "2026-05-31T00:00:10.000Z");
  assert.equal(run.resultTitle, "运行失败");
  assert.equal(run.resultSummary?.includes("[redacted-secret]"), true);
  assert.deepEqual(run.informationAccess?.sourcePreference, ["docs"]);
  assert.equal(run.informationAccess?.web.secretRef, "secret://test/tavily");
  assert.equal(run.informationAccess?.web.secretConfigured, false);
  assert.equal(JSON.stringify(run).includes("sk-hidden-secret"), false);
  assert.equal(isTerminalPanelRunStatus("blocked"), true);
  assert.equal(isTerminalPanelRunStatus("running"), false);
});

test("runtime record mapper persists safe run capability resolution", () => {
  const run = createRuntimeRunRecord({
    job: job({
      completed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        capabilityResolution: {
          resolutionId: "capability-resolution-test",
          snapshotId: "snapshot-test",
          runMode: "agent",
          agentId: "desktop-agent-session",
          agentDisplayName: "Desktop Agent",
          toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
          allowedTools: ["search"],
          toolExposures: [
            {
              name: "search",
              displayName: "Search",
              enabled: true,
              modelVisible: true,
              scopes: ["desktop-basic", "research"],
              availability: "available",
              riskLevel: "low",
              operationType: "read-only",
              requiresConfirmation: false,
              reason: "工具对本轮模型可用。",
            },
            {
              name: "mcp_docs_search",
              displayName: "MCP docs",
              enabled: true,
              modelVisible: false,
              scopes: ["desktop-basic", "mcp"],
              availability: "available",
              riskLevel: "medium",
              operationType: "external-submit",
              requiresConfirmation: true,
              reason: "该工具不对当前运行模式可见。",
            },
          ],
          enabledSkills: [],
          mcpDrafts: [
            {
              draftId: "mcp:docs",
              source: "mcp",
              label: "Docs MCP",
              availability: "configured",
              enabled: true,
              reason: "MCP 当前只作为能力草案登记，本批不执行 MCP tool。",
            },
          ],
          warnings: ["MCP 当前只进入能力草案目录，本批不执行 MCP tool。"],
          createdAt: "2026-05-31T00:00:01.000Z",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.deepEqual(run.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(run.capabilityResolution?.agentId, "desktop-agent-session");
  assert.equal(run.capabilityResolution?.toolVisibilityProfileId, "desktop-root-agent:ordinary-visible-tools:v1");
  assert.equal(run.capabilityResolution?.toolExposures.find((tool) => tool.name === "mcp_docs_search")?.modelVisible, false);
  assert.equal(run.capabilityResolution?.mcpDrafts[0]?.source, "mcp");
  assert.equal(JSON.stringify(run.capabilityResolution).includes("secret://"), false);
  assert.equal(JSON.stringify(run.capabilityResolution).includes("systemPrompt"), false);
});

test("runtime record mapper does not invent completed result summaries without visible ordinary answers", () => {
  const run = createRuntimeRunRecord({
    job: job({
      completed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.equal(run.status, "completed");
  assert.equal(run.resultTitle, undefined);
  assert.equal(run.resultSummary, undefined);
  assert.equal(JSON.stringify(run).includes("结果已生成"), false);
  assert.equal(JSON.stringify(run).includes("结果已经整理完成"), false);
});

test("runtime record mapper preserves failed run capability resolution", () => {
  const run = createRuntimeRunRecord({
    job: job({
      status: "failed",
      completed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        capabilityResolution: {
          ...capabilityResolution(),
          snapshotId: "snapshot-stale-completed",
          allowedTools: ["stale"],
        },
        canvas: {
          kind: "desktop_agent_canvas" as const,
          taskSoil: {
            taskSoilId: "task-soil-stale-completed",
            goalSummary: "旧成功摘要",
            contextRefs: [],
            permissionBoundaryRefs: [],
          },
          agent: {
            status: "completed" as const,
            answer: {
              answer: "这条旧成功回答不应进入失败记录。",
              modelCallRefs: [],
              toolCallRefs: [],
              evidenceRefs: [],
              resultBlocks: [],
            },
            modelCallRefs: [],
            toolCallRefs: [],
            activity: [],
          },
          explanation: {
            resultWhyReasonable: "旧成功投影不应覆盖失败终态。",
            observationPanelRole: "开发者详情只展示安全事件。",
          },
        },
      },
      failed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        capabilityResolution: capabilityResolution(),
        error: {
          code: "model_failed",
          message: "模型调用失败。",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.equal(run.status, "failed");
  assert.equal(run.resultTitle, "运行失败");
  assert.equal(run.resultSummary, "模型调用失败。");
  assert.deepEqual(run.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(run.capabilityResolution?.agentId, "desktop-agent-session");
  assert.equal(run.capabilityResolution?.snapshotId, "snapshot-test");
});

test("runtime record mapper persists safe run agent definition ref independently from capability resolution", () => {
  const run = createRuntimeRunRecord({
    job: job({
      status: "failed",
      agentDefinitionRef: {
        agentId: "desktop-agent-session",
        agentDisplayName: "Desktop Agent",
        promptRef: "prompt:desktop-root-agent:v1",
        promptVersion: "v1",
        outputContractId: "desktop.agent_response.v1",
        toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
        definitionHash: "sha256:runtime-record-safe-definition-hash",
      },
      failed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        error: {
          code: "missing_api_key",
          message: "缺少 API key。",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.deepEqual(run.agentDefinitionRef, {
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    promptRef: "prompt:desktop-root-agent:v1",
    promptVersion: "v1",
    outputContractId: "desktop.agent_response.v1",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
    definitionHash: "sha256:runtime-record-safe-definition-hash",
  });
  assert.equal(run.agentDefinitionRef.definitionHash?.startsWith("sha256:"), true);
  assert.equal(run.capabilityResolution, undefined);
  assert.equal(JSON.stringify(run.agentDefinitionRef).includes("systemPrompt"), false);
  assert.equal(JSON.stringify(run.agentDefinitionRef).includes("sourcePath"), false);
});

test("runtime record mapper persists safe model, event, tool, and confirmation projections", () => {
  const traceEvent: PanelRunTraceReadModel["events"][number] = {
    sequence: 1,
    type: "tool.completed",
    summary: "tool completed with Bearer hidden-token",
    scope: "aboveground",
    severity: "info",
    progress: { status: "completed", label: "Completed" },
    refs: [],
    traceId: "trace-1",
    intent: "tool_completed",
    from: { id: "runtime", role: "runtime" },
    createdAt: "2026-05-31T00:00:02.000Z",
    recordedAt: "2026-05-31T00:00:03.000Z",
  };
  const runtimeEvent = toRuntimeEventRecord("run-1", traceEvent);
  const modelCall = toRuntimeModelCallRecord("run-1", {
    requestId: "request-1",
    responseId: "response-1",
    status: "completed",
    purpose: "desktop_agent",
    outputContractId: "desktop.agent_response.v1",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "fake-model",
    outputKind: "answer",
    validationStatus: "passed",
    candidateRefs: [],
    eventRefs: ["message-1"],
  } satisfies PanelRunTranscript["modelCalls"][number]);
  const toolCalls = toRuntimeToolCallRecords("run-1", [
    streamEvent({
      sequence: 1,
      type: "tool.completed",
      toolName: "shell_command",
      toolCallRefs: ["tool-call-1"],
      detail: {
        kind: "tool",
        action: "执行 Shell",
        display: {
          kind: "command_summary",
          command: "pnpm",
          args: ["test"],
          exitCode: 0,
          outputSummary: "tests passed",
        },
      },
    }),
  ], [
    eventEntry({
      sequence: 1,
      type: "tool.completed",
      payload: {
        callId: "tool-call-1",
        toolName: "shell_command",
        input: { command: "pnpm", args: ["test"] },
        output: {
          action: "shell_command",
          summary: "pnpm test completed",
          result: {
            command: "pnpm",
            args: ["test"],
            exitCode: 0,
            stdout: "RAW_STDOUT_SENTINEL",
          },
          envelope: {
            agentSummary: "safe command summary",
            evidenceRefs: ["tool:tool-call-1"],
            rawRetention: "diagnostic_ref_only",
            redacted: true,
          },
        },
      },
    }),
  ]);
  const confirmations = toRuntimeConfirmationRecords(job({
    confirmationDecisions: [
      {
        confirmationId: "confirmation-1",
        runId: "run-1",
        decision: "guidance",
        guidance: "use safer path sk-guidance-secret",
        decidedAt: "2026-05-31T00:00:08.000Z",
      },
    ],
  }), [
    eventEntry({
      sequence: 2,
      type: "user_approval.requested",
      payload: {
        confirmationId: "confirmation-1",
        question: "是否运行命令？",
        consequence: "会读取安全摘要。",
        affectedResources: ["shell:pnpm test"],
        riskLevel: "medium",
      },
    }),
  ]);

  assert.equal(runtimeEvent.summary.includes("[redacted-token]"), true);
  assert.equal(modelCall.requestId, "request-1");
  assert.equal(toolCalls[0]?.command, "pnpm test");
  assert.equal(toolCalls[0]?.display?.kind, "command_summary");
  assert.equal(toolCalls[0]?.envelope?.rawRetention, "diagnostic_ref_only");
  assert.equal(JSON.stringify(toolCalls).includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(confirmations[0]?.status, "guidance");
  assert.equal(confirmations[0]?.guidance?.includes("[redacted-secret]"), true);
});

test("runtime text compaction redacts secrets before truncating", () => {
  const compacted = compactRuntimeText("prefix sk-secret-value-123456 suffix", 24);

  assert.equal(compacted.includes("sk-secret"), false);
  assert.equal(compacted.length <= 24, true);
});

function job(overrides: Partial<PanelRunJob> = {}): PanelRunJob {
  return {
    runId: "run-1",
    runKind: "desktop",
    runMode: "agent",
    goal: "Finish a safe desktop task",
    aiMode: "fake",
    status: "completed",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:10.000Z",
    config: modelConfig(),
    informationAccess: informationAccess(),
    streamEvents: [],
    streamEventIds: new Set(),
    nextStreamSequence: 1,
    confirmationDecisions: [],
    ...overrides,
  };
}

function modelConfig(): PanelRunJob["config"] {
  return {
    defaultAiMode: "fake",
    profileId: "fake",
    providerKind: "openai_compatible",
    protocolKind: "openai_compatible_chat_completions",
    baseUrl: "https://example.test",
    model: "fake-model",
    secretRef: "secret://test/model",
    secretConfigured: false,
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
}

function informationAccess(): PanelRunJob["informationAccess"] {
  return {
    sourcePreference: ["docs"],
    web: {
      provider: "none",
      providerKind: "tavily",
      maxResults: 0,
      secretRef: "secret://test/tavily",
      secretConfigured: false,
      status: "disabled",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
    stubs: {
      docs: "stub",
      packages: "stub",
      github: "stub",
      run_memory: "stub",
    },
  };
}

function capabilityResolution(): NonNullable<PanelRunJob["capabilityResolution"]> {
  return {
    resolutionId: "capability-resolution-test",
    snapshotId: "snapshot-test",
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v1",
    allowedTools: ["search"],
    toolExposures: [
      {
        name: "search",
        displayName: "Search",
        enabled: true,
        modelVisible: true,
        scopes: ["desktop-basic", "research"],
        availability: "available",
        riskLevel: "low",
        operationType: "read-only",
        requiresConfirmation: false,
        reason: "工具对本轮模型可用。",
      },
    ],
    enabledSkills: [],
    mcpDrafts: [],
    warnings: [],
    createdAt: "2026-05-31T00:00:01.000Z",
  };
}

function streamEvent(input: {
  readonly sequence: number;
  readonly type: PanelRunStreamEvent["type"];
  readonly toolName?: string;
  readonly toolCallRefs?: readonly string[];
  readonly detail?: PanelRunStreamEvent["detail"];
}): PanelRunStreamEvent {
  return {
    eventId: `run-1:event:${input.sequence}`,
    runId: "run-1",
    sequence: input.sequence,
    type: input.type,
    createdAt: "2026-05-31T00:00:00.000Z",
    toolName: input.toolName,
    detail: input.detail,
    sourceRefs: [],
    modelCallRefs: [],
    toolCallRefs: input.toolCallRefs ?? [],
  };
}

function eventEntry(input: {
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly payload: Record<string, unknown>;
}): EventLogEntry {
  const message: ArborMessage = {
    id: `message-${input.sequence}`,
    traceId: "trace-runtime-records",
    from: { id: "panel-test", role: "runtime" },
    to: { group: "panel" },
    type: input.type,
    intent: input.type.replaceAll(".", "_"),
    payload: input.payload,
    createdAt: "2026-05-31T00:00:00.000Z",
  };
  return {
    sequence: input.sequence,
    type: input.type,
    message,
    recordedAt: "2026-05-31T00:00:00.000Z",
  };
}
