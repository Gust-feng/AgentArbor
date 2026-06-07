import assert from "node:assert/strict";
import test from "node:test";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import {
  createPersistedPanelRunResponse,
  panelStatusFromRuntimeStatus,
} from "./persisted-run-response.js";

test("persisted run response restores safe transcript and tracking projections", () => {
  const response = createPersistedPanelRunResponse({
    snapshot: runtimeSnapshot(),
    config: modelConfig(),
    informationAccess: informationAccess(),
    conversation: {
      conversationId: "conversation-1",
      title: "Safe task",
      preview: "Safe task",
      currentAction: "结果已生成。",
      nextStep: "打开查看结果，或继续追问下一步。",
      status: "completed",
      requiresUserAction: false,
      queuedRunIds: [],
      queuedRunCount: 0,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:10.000Z",
      turns: [],
    },
  });

  assert.equal(response.restoredFromSnapshot, true);
  assert.equal(response.status, "completed");
  assert.equal(response.config.profileId, "snapshot-profile");
  assert.equal(response.config.baseUrl, "https://snapshot.example.test");
  assert.equal(response.config.model, "snapshot-model");
  assert.equal(response.tracking.provider.model, "snapshot-model");
  assert.deepEqual(response.agentDefinitionRef, response.snapshot.run.agentDefinitionRef);
  assert.equal(response.agentDefinitionRef?.agentId, "custom-restored-agent");
  assert.deepEqual(response.informationAccess.sourcePreference, ["web", "codebase"]);
  assert.equal(response.informationAccess.web.maxResults, 5);
  assert.equal(response.tracking.informationSources.web.maxResults, 5);
  assert.equal(response.restoredResult?.summary, "安全结果摘要");
  assert.equal(response.tracking.modelTotals.completed, 1);
  assert.equal(response.tracking.toolTotals.completed, 1);
  assert.deepEqual(response.transcript.events.map((event) => event.type), [
    "run.started",
    "tool.requested",
    "tool.completed",
    "user.guidance",
    "final.result",
  ]);
  assert.equal(JSON.stringify(response.transcript.events).includes("legacy-direction"), false);
  assert.equal(JSON.stringify(response.transcript.events).includes("legacy-report-artifact"), false);
  assert.equal(JSON.stringify(response.transcript.events).includes("delegation-legacy"), false);
  assert.equal(JSON.stringify(response.transcript.events).includes("child-run-legacy"), false);
  assert.equal(JSON.stringify(response.transcript.events).includes("parent-synthesis-legacy"), false);
  assert.equal(response.transcript.events[0]?.agentLabel, "Custom Restored Agent");
  assert.equal(response.transcript.events.at(-1)?.agentLabel, "Custom Restored Agent");
  assert.equal(JSON.stringify(response.transcript.events).includes("正在判断下一步"), false);
  assert.equal(response.transcriptNodes.some((node) => node.kind === "tool"), true);
  assert.equal(response.streamCursor.lastSequence, response.transcript.events.at(-1)?.sequence);
  assert.equal(JSON.stringify(response).includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(JSON.stringify(response.agentDefinitionRef).includes("systemPrompt"), false);
});

test("persisted runtime running status restores as blocked ordinary panel state", () => {
  assert.equal(panelStatusFromRuntimeStatus("running"), "blocked");
});

test("persisted user-action statuses restore explicit waiting points", () => {
  const approval = createPersistedPanelRunResponse({
    snapshot: runtimeSnapshotWithStatus("approval_needed"),
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  const needsInput = createPersistedPanelRunResponse({
    snapshot: runtimeSnapshotWithStatus("needs_input"),
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  assert.equal(approval.status, "approval_needed");
  assert.equal(approval.trace.currentPhase, "agent");
  assert.equal(approval.tracking.run.phase, "agent");
  assert.equal(approval.trace.waitingPoint, "等待你确认下一步。");
  assert.equal(approval.tracking.run.waitingPoint, "等待你确认下一步。");
  assert.equal(approval.transcript.events.some((event) => event.type === "confirmation.needed"), true);
  assert.equal(approval.transcript.events.at(-1)?.type, "confirmation.needed");
  assert.equal(approval.transcript.events.at(-1)?.summary, "等待用户确认下一步。");
  assert.equal(needsInput.status, "needs_input");
  assert.equal(needsInput.trace.waitingPoint, "需要你补充材料后继续。");
  assert.equal(needsInput.tracking.run.waitingPoint, "需要你补充材料后继续。");
  assert.equal(needsInput.transcript.events.some((event) => event.type === "confirmation.needed"), false);
});

function runtimeSnapshot(): RuntimeRunSnapshot {
  return {
    run: {
      runId: "run-1",
      profile: "lite",
      runKind: "desktop",
      runMode: "agent",
      status: "completed",
      goalSummary: "Safe task",
      aiMode: "fake",
      conversationId: "conversation-1",
      traceId: "trace-1",
      appHome: "C:\\AgentArbor\\app",
      runHome: "C:\\AgentArbor\\runtime\\runs\\run-1",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:10.000Z",
      completedAt: "2026-05-31T00:00:10.000Z",
      resultTitle: "已完成",
      resultSummary: "安全结果摘要",
      agentDefinitionRef: {
        agentId: "custom-restored-agent",
        agentDisplayName: "Custom Restored Agent",
        promptRef: "prompt:custom-restored-agent:v1",
        promptVersion: "1",
        outputContractId: "desktop.agent_response.v1",
        toolVisibilityProfileId: "custom-restored-agent:ordinary-visible-tools:v1",
      },
      capabilitySnapshot: frozenCapabilitySnapshot(),
      informationAccess: frozenInformationAccess(),
    },
    workspace: {
      workspaceId: "workspace:current",
      kind: "local_directory",
      path: "Z:\\AgentArbor",
      label: "AgentArbor",
      selectedAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
    basicEvents: [],
    events: [
      runtimeEvent(1, "goal.received", "收到任务", []),
      runtimeEvent(2, "model.requested", "正在判断下一步", [{ kind: "model_call", id: "model-1" }]),
      runtimeEvent(3, "tool.requested", "准备运行命令", [{ kind: "tool_call", id: "tool-1" }]),
      runtimeEvent(4, "tool.completed", "命令已完成", [{ kind: "tool_call", id: "tool-1" }]),
      runtimeEvent(5, "agent.delegation.planned", "已形成 legacy delegation", [{ kind: "agent_delegation", id: "delegation-legacy" }]),
      runtimeEvent(6, "agent.child.started", "已启动 legacy child", [{ kind: "agent_run", id: "child-run-legacy" }]),
      runtimeEvent(7, "agent.parent_synthesis.completed", "已完成 legacy parent synthesis", [{ kind: "parent_synthesis", id: "parent-synthesis-legacy" }]),
      runtimeEvent(8, "direction_handoff.completed", "已生成 legacy-direction", [{ kind: "direction_handoff", id: "legacy-direction" }]),
      runtimeEvent(9, "artifact.produced", "已生成 legacy-report-artifact", [{ kind: "artifact", id: "legacy-report-artifact" }]),
    ],
    modelCalls: [
      {
        requestId: "model-1",
        runId: "run-1",
        responseId: "response-1",
        status: "completed",
        purpose: "desktop_agent",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "fake-model",
        eventRefs: ["run-1:event:2"],
      },
    ],
    toolCalls: [
      {
        callId: "tool-1",
        runId: "run-1",
        toolName: "shell_command",
        status: "completed",
        action: "执行 Shell",
        command: "pnpm test",
        exitCode: 0,
        summary: "命令完成",
        preview: "测试通过",
        display: {
          kind: "command_summary",
          command: "pnpm",
          args: ["test"],
          exitCode: 0,
          outputSummary: "测试通过",
        },
        eventRefs: ["run-1:event:3", "run-1:event:4"],
      },
    ],
    artifacts: [],
    confirmations: [
      {
        confirmationId: "confirmation-1",
        runId: "run-1",
        conversationId: "conversation-1",
        status: "guidance",
        title: "用户指导",
        actionSummary: "用户补充指导",
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: "2026-05-31T00:00:04.000Z",
        decidedAt: "2026-05-31T00:00:05.000Z",
        guidance: "继续使用安全摘要",
        eventRefs: ["confirmation:confirmation-1"],
      },
    ],
  };
}

function runtimeSnapshotWithStatus(status: RuntimeRunSnapshot["run"]["status"]): RuntimeRunSnapshot {
  const snapshot = runtimeSnapshot();
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      status,
      completedAt: undefined,
      resultTitle: undefined,
      resultSummary: undefined,
    },
    confirmations: status === "approval_needed"
      ? [
          {
            confirmationId: "confirmation-pending",
            runId: "run-1",
            conversationId: "conversation-1",
            status: "pending",
            title: "需要确认",
            actionSummary: "等待用户确认下一步。",
            affectedResources: [],
            riskLevel: "medium",
            requestedAt: "2026-05-31T00:00:04.000Z",
            eventRefs: ["confirmation:confirmation-pending"],
          },
        ]
      : [],
  };
}

function frozenCapabilitySnapshot(): NonNullable<RuntimeRunSnapshot["run"]["capabilitySnapshot"]> {
  return {
    snapshotId: "capability-snapshot-1",
    createdAt: "2026-05-31T00:00:00.000Z",
    activeModel: {
      ...modelConfig(),
      profileId: "snapshot-profile",
      baseUrl: "https://snapshot.example.test",
      model: "snapshot-model",
      updatedAt: "2026-05-30T00:00:00.000Z",
    },
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
    toolCatalog: {
      scope: "desktop-basic",
      tools: [],
      allowedTools: [],
    },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\SnapshotWorkspace",
      updatedAt: "2026-05-30T00:00:00.000Z",
    },
    securitySummary: "Frozen capability snapshot for the restored run.",
    warnings: [],
  };
}

function frozenInformationAccess(): SanitizedInformationAccessConfig {
  return {
    sourcePreference: ["web", "codebase"],
    web: {
      provider: "tavily",
      providerKind: "tavily",
      maxResults: 5,
      secretRef: "secret://snapshot/tavily",
      secretConfigured: true,
      status: "ready",
      updatedAt: "2026-05-30T00:00:00.000Z",
    },
    stubs: {
      docs: "readonly_stub",
      packages: "stub",
      github: "readonly_stub",
      run_memory: "stub",
    },
  };
}

function runtimeEvent(
  sequence: number,
  type: RuntimeRunSnapshot["events"][number]["type"],
  summary: string,
  refs: RuntimeRunSnapshot["events"][number]["refs"]
): RuntimeRunSnapshot["events"][number] {
  return {
    eventId: `run-1:event:${sequence}`,
    runId: "run-1",
    sequence,
    type,
    summary,
    scope: "aboveground",
    severity: "info",
    progress: { status: "completed", label: "Completed" },
    refs,
    traceId: "trace-1",
    intent: type.replaceAll(".", "_"),
    createdAt: "2026-05-31T00:00:00.000Z",
    recordedAt: "2026-05-31T00:00:00.000Z",
  };
}

function modelConfig(): SanitizedModelProviderConfig {
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

function informationAccess(): SanitizedInformationAccessConfig {
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
