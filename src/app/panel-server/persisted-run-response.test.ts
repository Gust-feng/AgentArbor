import assert from "node:assert/strict";
import test from "node:test";
import type { SanitizedInformationAccessConfig, SanitizedModelProviderConfig } from "../../domain/config/index.js";
import type { RuntimeRunSnapshot } from "../../domain/runtime-database/index.js";
import {
  createPersistedPanelRunResponse,
  createPersistedStreamEvents,
  panelStatusFromRuntimeStatus,
} from "./persisted-run-response.js";
import { OrdinaryRuntimeSnapshotContractError } from "../basic-agent-runtime/persistence-snapshot-contract.js";
import { displayActivityItemsForNodes } from "../panel-read-model/transcript/panel-transcript-activity-copy.js";
import { activityVisibleNodes } from "../panel-read-model/transcript/panel-transcript-node-projection.js";
import { createRunCapabilityPlan } from "../model-capability-registry.js";
import { toolStreamDetail, toolSummary } from "../panel-read-model/run/panel-stream-tool-projection.js";

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
      nextStep: "查看结果，或继续追问。",
      status: "completed",
      requiresUserAction: false,
      queuedRunIds: [],
      queuedRunCount: 0,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:10.000Z",
      turns: [],
    },
  });
  const snapshot = response.snapshot!;

  assert.equal(response.restoredFromSnapshot, true);
  assert.equal(response.status, "completed");
  assert.equal(response.config.profileId, "snapshot-profile");
  assert.equal(response.config.baseUrl, "https://snapshot.example.test");
  assert.equal(response.config.model, "snapshot-model");
  assert.equal(response.tracking.provider.model, "snapshot-model");
  assert.deepEqual(response.agentDefinitionRef, snapshot.run.agentDefinitionRef);
  assert.equal(response.agentDefinitionRef?.agentId, "custom-restored-agent");
  assert.deepEqual(response.informationAccess.sourcePreference, ["web", "codebase"]);
  assert.equal(response.informationAccess.web.maxResults, 5);
  assert.equal(response.tracking.informationSources.web.maxResults, 5);
  assert.equal(response.restoredResult?.summary, "安全结果摘要");
  assert.equal(response.tracking.modelTotals.completed, 1);
  assert.equal(response.tracking.toolTotals.completed, 1);
  assert.deepEqual(response.transcript.events.map((event) => event.type), [
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
  assert.equal(JSON.stringify(response.trace.events).includes("legacy-direction"), false);
  assert.equal(JSON.stringify(response.trace.events).includes("legacy-report-artifact"), false);
  assert.equal(JSON.stringify(response.trace.events).includes("delegation-legacy"), false);
  assert.equal(JSON.stringify(response.trace.events).includes("child-run-legacy"), false);
  assert.equal(JSON.stringify(response.trace.events).includes("parent-synthesis-legacy"), false);
  assert.equal(JSON.stringify(response.transcript.events).includes("已从本地记录恢复这次运行"), false);
  assert.equal(response.transcript.events.at(-1)?.agentLabel, "Custom Restored Agent");
  assert.equal(JSON.stringify(response.transcript.events).includes("正在判断下一步"), false);
  assert.equal(response.transcriptNodes.some((node) => node.kind === "tool"), true);
  assert.equal(response.streamCursor.lastSequence, response.transcript.events.at(-1)?.sequence);
  assert.equal(JSON.stringify(response).includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(JSON.stringify(response.agentDefinitionRef).includes("systemPrompt"), false);
});

test("persisted run response restores ordinary tool transcript from factual records", () => {
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...runtimeSnapshot(),
      events: [
        runtimeEvent(1, "tool.completed", "运行命令：dir · exit 0", [{ kind: "tool_call", id: "tool-command" }], {
          callId: "tool-command",
          toolName: "shell_command",
          input: { command: "dir" },
          output: { command: "dir", exitCode: 0 },
        }),
        runtimeEvent(2, "tool.completed", "目标：README.md · 120 bytes", [{ kind: "tool_call", id: "tool-file" }], {
          callId: "tool-file",
          toolName: "read_file",
          input: { path: "README.md" },
          output: { path: "README.md", bytes: 120 },
        }),
        runtimeEvent(3, "tool.completed", "notes.md · 32 -> 18 chars · 1 replacement", [{ kind: "tool_call", id: "tool-edit" }], {
          callId: "tool-edit",
          toolName: "edit_file",
          input: { path: "notes.md" },
          output: { path: "notes.md", replacements: 1, preview: "- old\n+ new" },
        }),
      ],
      modelCalls: [],
      toolCalls: [
        {
          callId: "tool-command",
          runId: "run-1",
          toolName: "shell_command",
          status: "completed",
          eventRefs: ["run-1:event:1"],
        },
        {
          callId: "tool-file",
          runId: "run-1",
          toolName: "read_file",
          status: "completed",
          eventRefs: ["run-1:event:2"],
        },
        {
          callId: "tool-edit",
          runId: "run-1",
          toolName: "edit_file",
          status: "completed",
          eventRefs: ["run-1:event:3"],
        },
      ],
      confirmations: [],
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  const activityText = JSON.stringify(displayActivityItemsForNodes(activityVisibleNodes(response.transcriptNodes)));

  assert.equal(response.transcript.events.some((event) =>
    event.detail?.display?.kind === "command_summary" && event.detail.display.commandLine === "dir"
  ), true);
  assert.equal(response.transcript.events.some((event) => event.detail?.preview === "README.md"), true);
  assert.equal(response.transcriptNodes.some((node) => node.summary?.includes("notes.md")), true);
  assert.equal(response.transcript.events.some((event) => event.detail?.preview?.includes("- old")), true);
  assert.equal(response.transcript.events.some((event) => event.detail?.preview?.includes("+ new")), true);
  assert.equal(activityText.includes("README.md"), true);
});

test("persisted tool stream derives the same display from lifecycle facts", () => {
  const payload = {
    callId: "tool-read-parity",
    toolName: "read_file",
    input: { path: "README.md" },
    output: {
      path: "README.md",
      bytes: 120,
    },
    durationMs: 4,
  } as const;
  const snapshot = {
    ...runtimeSnapshot(),
    events: [
      runtimeEvent(1, "tool.completed", "legacy summary must not own display", [{ kind: "tool_call", id: payload.callId }], payload),
    ],
  };
  const restored = createPersistedStreamEvents(snapshot, "completed")
    .find((event) => event.type === "tool.completed");

  assert.deepEqual(restored?.detail, toolStreamDetail("tool.completed", payload));
  assert.equal(restored?.summary, toolSummary("tool.completed", payload));
});

test("persisted run response restores model failures as typed failed events", () => {
  const base = runtimeSnapshot();
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...base,
      run: {
        ...base.run,
        status: "failed",
        completedAt: undefined,
        resultTitle: undefined,
        resultSummary: undefined,
        error: {
          code: "model_failed",
          message: "工具已执行，但后续模型续跑失败。模型服务连接失败。",
        },
      },
      events: [
        runtimeEvent(1, "tool.completed", "python hello_agent.py · exit 0", [{ kind: "tool_call", id: "tool-1" }], {
          callId: "tool-1",
          toolName: "shell_command",
          input: { command: "python hello_agent.py" },
          output: { command: "python hello_agent.py", exitCode: 0 },
        }),
        runtimeEvent(2, "model.failed", "模型服务连接失败。", [{ kind: "model_call", id: "model-1" }]),
      ],
      modelCalls: [
        {
          requestId: "model-1",
          runId: "run-1",
          status: "failed",
          purpose: "desktop_agent",
          providerKind: "openai_compatible",
          protocolKind: "openai_compatible_chat_completions",
          model: "fake-model",
          failureKind: "provider_network",
          retryable: true,
          eventRefs: ["run-1:event:2"],
        },
      ],
      confirmations: [],
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  const modelFailure = response.transcript.events.find((event) => event.type === "model.failed");
  const modelFailureNode = response.transcriptNodes.find((node) => node.eventType === "model.failed");
  const activityText = JSON.stringify(displayActivityItemsForNodes(activityVisibleNodes(response.transcriptNodes)));

  assert.equal(modelFailure?.status, "failed");
  assert.equal(modelFailure?.agentLabel, "助手");
  assert.equal(modelFailureNode?.kind, "system");
  assert.equal(modelFailureNode?.phase, "failed");
  assert.equal(activityText.includes("模型"), true);
  assert.equal(response.transcript.events.some((event) => event.type === "agent.note.completed" && event.summary === "模型服务连接失败。"), false);
});

test("persisted run response omits internal context compaction model output", () => {
  const base = runtimeSnapshot();
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...base,
      events: [
        runtimeEvent(1, "model.requested", "正在压缩较早上下文…", [{ kind: "model_call", id: "model-compaction" }]),
        runtimeEvent(
          2,
          "model.completed",
          "## Goal\nContinue safely.\n\n## Constraints & Preferences\nDo not show this internal prompt.",
          [{ kind: "model_call", id: "model-response-compaction" }],
        ),
        runtimeEvent(3, "context.compaction.completed", "已整理 18 条较早上下文，后续继续当前任务。", [
          { kind: "model_call", id: "model-compaction" },
          { kind: "model_call", id: "model-response-compaction" },
        ]),
      ],
      modelCalls: [
        {
          requestId: "model-compaction",
          responseId: "model-response-compaction",
          runId: "run-1",
          status: "completed",
          purpose: "desktop_context_compaction",
          outputContractId: "desktop.context_compaction.v1",
          providerKind: "fake",
          protocolKind: "openai_compatible_chat_completions",
          model: "fake-model",
          eventRefs: ["run-1:event:1", "run-1:event:2"],
        },
      ],
      toolCalls: [],
      confirmations: [],
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  const serialized = JSON.stringify({
    events: response.transcript.events,
    nodes: response.transcriptNodes,
  });

  assert.deepEqual(response.transcript.events.map((event) => event.type), [
    "context.compaction.completed",
    "final.result",
  ]);
  assert.equal(serialized.includes("## Goal"), false);
  assert.equal(serialized.includes("Constraints & Preferences"), false);
  assert.equal(serialized.includes("内部"), false);
  assert.equal(response.transcriptNodes.some((node) => node.eventType === "model.output.completed"), false);
  assert.equal(response.transcriptNodes.some((node) => node.eventType === "context.compaction.completed"), true);
});

test("persisted runtime running status restores as blocked ordinary panel state", () => {
  assert.equal(panelStatusFromRuntimeStatus("running"), "blocked");
});

test("persisted blocked ordinary responses explain the new-turn recovery path", () => {
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...runtimeSnapshot(),
      run: {
        ...runtimeSnapshot().run,
        status: "blocked",
        stopReason: "confirmation_continuation_lost",
        continuationAvailability: "lost_after_restart",
        error: {
          code: "confirmation_continuation_lost",
          message: "这次操作无法原地继续。你可以发送新消息，让我基于当前上下文继续。",
        },
      },
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  assert.equal(response.status, "blocked");
  assert.equal(response.stopReason, "confirmation_continuation_lost");
  assert.equal(response.continuationAvailability, "lost_after_restart");
  assert.equal(response.transcript.events.at(-1)?.type, "run.blocked");
  assert.equal(response.transcript.events.at(-1)?.summary, "这次操作无法原地继续。你可以发送新消息，让我基于当前上下文继续。");
});

test("persisted run response exposes full restored answer separately from summary", () => {
  const fullAnswer = `完整回答。\n\n\`\`\`ts\nconst kept = true;\n\`\`\`\n${"x".repeat(140_000)}\nRESTORED_ANSWER_TAIL`;
  const base = runtimeSnapshot();
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...base,
      run: {
        ...base.run,
        resultSummary: "短摘要",
        resultAnswer: fullAnswer,
      },
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  assert.equal(response.restoredResult?.summary, "短摘要");
  assert.equal(response.restoredResult?.content, fullAnswer);
  assert.equal(response.transcript.events.at(-1)?.summary, "短摘要");
});

test("persisted user-action statuses restore concrete confirmation without generic waiting points", () => {
  const approvalSnapshot = runtimeSnapshotWithStatus("approval_needed");
  const approval = createPersistedPanelRunResponse({
    snapshot: {
      ...approvalSnapshot,
      events: [
        ...approvalSnapshot.events,
        runtimeEvent(
          10,
          "user_approval.requested",
          "legacy event summary must not duplicate the confirmation",
          [{ kind: "tool_call", id: "tool-pending" }],
          {
            callId: "tool-pending",
            toolName: "shell_command",
            confirmationId: "confirmation-pending",
          },
        ),
      ],
      confirmations: approvalSnapshot.confirmations.map((confirmation) => ({
        ...confirmation,
        toolCallId: "tool-pending",
        toolName: "shell_command",
      })),
    },
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
  assert.equal(approval.trace.waitingPoint, "");
  assert.equal(approval.tracking.run.waitingPoint, "");
  assert.equal(approval.transcript.events.filter((event) => event.type === "confirmation.needed").length, 1);
  assert.equal(approval.transcript.events.at(-1)?.type, "confirmation.needed");
  assert.equal(approval.transcript.events.at(-1)?.summary, "删除文件：old.txt");
  assert.deepEqual(approval.transcript.events.at(-1)?.toolCallRefs, ["tool-pending"]);
  assert.equal(needsInput.status, "needs_input");
  assert.equal(needsInput.trace.waitingPoint, "");
  assert.equal(needsInput.tracking.run.waitingPoint, "");
  assert.equal(needsInput.transcript.events.some((event) => event.type === "confirmation.needed"), false);
  assert.equal(JSON.stringify(approval).includes("等待你判断下一步"), false);
  assert.equal(JSON.stringify(needsInput).includes("需要你补充材料后继续"), false);
});

test("persisted ordinary responses omit restored approved confirmations from visible streams", () => {
  const base = runtimeSnapshotWithStatus("blocked");
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...base,
      run: {
        ...base.run,
        stopReason: "confirmation_continuation_lost",
        continuationAvailability: "lost_after_restart",
        error: {
          code: "confirmation_continuation_lost",
          message: "这次操作无法原地继续。",
        },
      },
      events: [
        ...base.events,
        runtimeEvent(
          10,
          "user_approval.requested",
          "等待批准",
          [{ kind: "tool_call", id: "tool-approved" }],
          {
            callId: "tool-approved",
            toolName: "shell_command",
            confirmationId: "confirmation-approved",
          },
        ),
        runtimeEvent(
          11,
          "user_approval.requested",
          "等待拒绝",
          [{ kind: "tool_call", id: "tool-denied" }],
          {
            callId: "tool-denied",
            toolName: "delete_file",
            confirmationId: "confirmation-denied",
          },
        ),
      ],
      confirmations: [
        {
          confirmationId: "confirmation-approved",
          runId: "run-1",
          conversationId: "conversation-1",
          status: "approved",
          title: "继续处理",
          actionSummary: "运行命令：pnpm test",
          affectedResources: [],
          riskLevel: "medium",
          toolCallId: "tool-approved",
          toolName: "shell_command",
          requestedAt: "2026-05-31T00:00:04.000Z",
          decidedAt: "2026-05-31T00:00:05.000Z",
          eventRefs: ["confirmation:confirmation-approved"],
        },
        {
          confirmationId: "confirmation-denied",
          runId: "run-1",
          conversationId: "conversation-1",
          status: "denied",
          title: "删除文件",
          actionSummary: "删除文件：old.txt",
          affectedResources: [],
          riskLevel: "medium",
          toolCallId: "tool-denied",
          toolName: "delete_file",
          requestedAt: "2026-05-31T00:00:06.000Z",
          decidedAt: "2026-05-31T00:00:07.000Z",
          eventRefs: ["confirmation:confirmation-denied"],
        },
      ],
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  const serialized = JSON.stringify({
    events: response.transcript.events,
    nodes: response.transcriptNodes,
  });

  assert.equal(response.transcript.events.filter((event) => event.type === "confirmation.needed").length, 1);
  assert.equal(response.transcript.events.find((event) => event.type === "confirmation.needed")?.summary, "等待拒绝");
  assert.equal(response.transcript.events.some((event) => event.type === "run.resumed"), false);
  assert.equal(response.transcript.events.some((event) => event.summary === "已继续。"), false);
  assert.equal(response.transcript.events.some((event) => event.type === "user_approval.received"), true);
  assert.equal(response.transcript.events.find((event) => event.type === "user_approval.received")?.agentLabel, "用户");
  assert.equal(serialized.includes("继续处理"), false);
  assert.equal(serialized.includes("等待批准"), false);
  assert.equal(serialized.includes("已不执行"), true);
});

test("persisted completed ordinary runs do not invent result summaries when none were stored", () => {
  const response = createPersistedPanelRunResponse({
    snapshot: runtimeSnapshotWithStatus("completed"),
    config: modelConfig(),
    informationAccess: informationAccess(),
  });
  const final = response.transcript.events.at(-1);
  const serialized = JSON.stringify(response);

  assert.equal(response.status, "completed");
  assert.equal(response.restoredResult, undefined);
  assert.notEqual(final?.type, "final.result");
  assert.equal(response.transcript.events.some((event) => event.type === "final.result"), false);
  assert.equal(serialized.includes("结果已经整理完成"), false);
  assert.equal(serialized.includes("结果已生成"), false);
});

test("persisted restored results do not invent fallback titles", () => {
  const base = runtimeSnapshot();
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...base,
      run: {
        ...base.run,
        resultTitle: undefined,
        resultSummary: "只有历史摘要",
      },
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  assert.equal(response.restoredResult?.title, "");
  assert.equal(response.restoredResult?.summary, "只有历史摘要");
  assert.equal(JSON.stringify(response).includes("上次结果"), false);
});

test("persisted terminal run responses keep frozen run facts instead of current fallback config", () => {
  for (const status of ["failed", "blocked", "cancelled"] as const) {
    const response = createPersistedPanelRunResponse({
      snapshot: runtimeSnapshotWithStatus(status),
      config: {
        ...modelConfig(),
        profileId: "current-profile",
        baseUrl: "https://current.example.test",
        model: "current-model",
      },
      informationAccess: {
        ...informationAccess(),
        sourcePreference: ["docs"],
        web: {
          ...informationAccess().web,
          maxResults: 99,
          status: "ready",
        },
      },
    });
    const snapshot = response.snapshot!;

    assert.equal(response.status, status);
    assert.equal(response.config.profileId, "snapshot-profile");
    assert.equal(response.config.baseUrl, "https://snapshot.example.test");
    assert.equal(response.config.model, "snapshot-model");
    assert.equal(response.tracking.provider.model, "snapshot-model");
    assert.deepEqual(response.informationAccess.sourcePreference, ["web", "codebase"]);
    assert.equal(response.informationAccess.web.maxResults, 5);
    assert.equal(response.tracking.informationSources.web.maxResults, 5);
    assert.deepEqual(response.agentDefinitionRef, snapshot.run.agentDefinitionRef);
    assert.equal(response.agentDefinitionRef?.agentId, "custom-restored-agent");
    assert.deepEqual(response.capabilityResolution, snapshot.run.capabilityResolution);
    assert.equal(response.capabilityResolution?.snapshotId, "capability-snapshot-1");
    assert.equal(response.capabilityResolution?.resolutionId, "capability-resolution-1");
    assert.deepEqual(response.capabilityResolution?.allowedTools, ["shell_command"]);
    assert.equal(response.transcript.events.at(-1)?.status, status);
  }
});

test("persisted Ordinary response rejects snapshots missing frozen run facts", () => {
  const snapshot = runtimeSnapshot();
  assert.throws(
    () => createPersistedPanelRunResponse({
      snapshot: {
        ...snapshot,
        run: {
          ...snapshot.run,
          capabilitySnapshot: undefined,
          informationAccess: undefined,
        },
      },
      config: modelConfig(),
      informationAccess: informationAccess(),
    }),
    (error: unknown) => {
      assert.equal(error instanceof OrdinaryRuntimeSnapshotContractError, true);
      const contractError = error as OrdinaryRuntimeSnapshotContractError;
      assert.equal(contractError.code, "ordinary_runtime_snapshot_invalid");
      assert.deepEqual(contractError.missingFacts, [
        "run.capabilitySnapshot",
        "run.informationAccess",
      ]);
      return true;
    }
  );
});

test("persisted Legacy Underground response keeps its owner-scoped Host fallback", () => {
  const snapshot = runtimeSnapshot();
  const response = createPersistedPanelRunResponse({
    snapshot: {
      ...snapshot,
      run: {
        ...snapshot.run,
        runKind: "underground",
        runMode: "deep",
        capabilitySnapshot: undefined,
        informationAccess: undefined,
      },
    },
    config: modelConfig(),
    informationAccess: informationAccess(),
  });

  assert.equal(response.config.profileId, "fake");
  assert.deepEqual(response.informationAccess.sourcePreference, ["docs"]);
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
      capabilityResolution: frozenCapabilityResolution(),
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
    events: [
      runtimeEvent(1, "goal.received", "收到任务", []),
      runtimeEvent(2, "model.requested", "正在判断下一步", [{ kind: "model_call", id: "model-1" }]),
      runtimeEvent(3, "tool.requested", "准备运行命令", [{ kind: "tool_call", id: "tool-1" }], {
        callId: "tool-1",
        toolName: "shell_command",
        input: { command: "pnpm test" },
      }),
      runtimeEvent(4, "tool.completed", "命令已完成", [{ kind: "tool_call", id: "tool-1" }], {
        callId: "tool-1",
        toolName: "shell_command",
        input: { command: "pnpm test" },
        output: { command: "pnpm test", exitCode: 0, stdout: "测试通过" },
      }),
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
        title: "补充要求",
        actionSummary: "用户补充要求",
        affectedResources: [],
        riskLevel: "medium",
        requestedAt: "2026-05-31T00:00:04.000Z",
        decidedAt: "2026-05-31T00:00:05.000Z",
        guidance: "继续使用运行摘要",
        eventRefs: ["confirmation:confirmation-1"],
      },
    ],
    subAgentRuns: [],
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
            title: "待处理",
            actionSummary: "删除文件：old.txt",
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
    subAgentCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:\\SnapshotWorkspace",
      updatedAt: "2026-05-30T00:00:00.000Z",
    },
    securitySummary: "Frozen capability snapshot for the restored run.",
    warnings: [],
  };
}

function frozenCapabilityResolution(): NonNullable<RuntimeRunSnapshot["run"]["capabilityResolution"]> {
  const snapshot = frozenCapabilitySnapshot();
  const allowedTools = ["shell_command"];
  const warnings: readonly string[] = [];
  return {
    resolutionId: "capability-resolution-1",
    snapshotId: "capability-snapshot-1",
    agentId: "custom-restored-agent",
    agentDisplayName: "Custom Restored Agent",
    runMode: "agent",
    toolVisibilityProfileId: "custom-restored-agent:ordinary-visible-tools:v1",
    capabilityPlan: createRunCapabilityPlan({
      profile: snapshot.activeModel,
      modelCapabilities: snapshot.modelCapabilities,
      allowedTools,
      warnings,
    }),
    allowedTools,
    toolExposures: [
      {
        name: "shell_command",
        displayName: "执行 Shell",
        enabled: true,
        modelVisible: true,
        scopes: ["desktop-basic"],
        availability: "available",
        operationType: "read-write",
        requiresConfirmation: false,
        riskLevel: "medium",
        reason: "可用。",
      },
    ],
    enabledSkills: [],
    mcpDrafts: [],
    warnings,
    createdAt: "2026-05-31T00:00:00.000Z",
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
  refs: RuntimeRunSnapshot["events"][number]["refs"],
  payload?: RuntimeRunSnapshot["events"][number]["payload"],
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
    payload,
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
