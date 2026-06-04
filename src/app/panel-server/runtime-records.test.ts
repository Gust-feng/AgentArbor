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
  assert.equal(JSON.stringify(run).includes("sk-hidden-secret"), false);
  assert.equal(isTerminalPanelRunStatus("blocked"), true);
  assert.equal(isTerminalPanelRunStatus("running"), false);
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
