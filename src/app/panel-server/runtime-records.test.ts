import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../../domain/common.js";
import type { ToolCallResult } from "../../domain/tools/index.js";
import type { EventLogEntry } from "../../kernel/events/in-memory-event-log.js";
import { createToolCompletedMessage, createToolFailedMessage } from "../../kernel/intelligence/tool-events.js";
import type { PanelRunJob } from "./run-jobs.js";
import { createPanelRunTranscript } from "../panel-run-read-model.js";
import type { PanelRunStreamEvent } from "../panel-read-model/run/panel-run-stream-contracts.js";
import type { PanelRunTraceReadModel } from "../panel-read-model/run/panel-run-tracking-contracts.js";
import type { PanelRunTranscript } from "../panel-read-model/run/panel-run-transcript-contracts.js";
import { createRunCapabilityPlan } from "../model-capability-registry.js";
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
  }, "2026-05-31T00:00:01.000Z", "run-1");
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
  assert.equal(workspace.workspaceId, "workspace:run:run-1");
  assert.equal(run.completedAt, "2026-05-31T00:00:10.000Z");
  assert.equal(run.resultTitle, "运行失败");
  assert.equal(run.resultSummary?.includes("sk-hidden-secret"), true);
  assert.deepEqual(run.informationAccess?.sourcePreference, ["docs"]);
  assert.equal(run.informationAccess?.web.secretRef, "secret://test/tavily");
  assert.equal(run.informationAccess?.web.secretConfigured, false);
  assert.equal(JSON.stringify(run).includes("sk-hidden-secret"), true);
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
          ...capabilityResolution(),
          capabilityPlan: createRunCapabilityPlan({
            profile: modelConfig(),
            modelCapabilities: modelCapabilities(),
            allowedTools: ["search", "mcp_docs_search"],
            warnings: ["MCP 已登记。"],
          }),
          allowedTools: ["search", "mcp_docs_search"],
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
              reason: "可用。",
            },
            {
              name: "mcp_docs_search",
              displayName: "MCP docs",
              enabled: true,
              modelVisible: true,
              scopes: ["mcp"],
              availability: "available",
              riskLevel: "medium",
              operationType: "external-submit",
              requiresConfirmation: true,
              reason: "可用，命令执行会先等你确认。",
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
              reason: "已登记。",
            },
          ],
          warnings: ["MCP 已登记。"],
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.deepEqual(run.capabilityResolution?.allowedTools, ["search", "mcp_docs_search"]);
  assert.equal(run.capabilityResolution?.agentId, "desktop-agent-session");
  assert.equal(run.capabilityResolution?.toolVisibilityProfileId, "desktop-root-agent:ordinary-visible-tools:v2");
  assert.equal(run.capabilityResolution?.toolExposures.find((tool) => tool.name === "mcp_docs_search")?.modelVisible, true);
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

test("runtime record mapper persists full ordinary answers separately from UI summaries", () => {
  const answer = [
    "第一行保留。",
    "",
    "```ts",
    "const value = 42;",
    "```",
    "后续说明：",
    "x".repeat(1_200),
  ].join("\n");
  const run = createRuntimeRunRecord({
    job: job({
      completed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        canvas: {
          kind: "desktop_agent_canvas",
          taskSoil: {
            taskSoilId: "task-soil-answer",
            goalSummary: "需要完整回答",
            contextRefs: [],
            permissionBoundaryRefs: [],
          },
          agent: {
            status: "completed",
            answer: {
              answer,
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
            resultWhyReasonable: "完整回答应作为运行事实持久化。",
            observationPanelRole: "测试。",
          },
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.equal(run.resultTitle, "已完成");
  assert.equal(run.resultAnswer, answer);
  assert.equal(run.resultAnswer?.includes("```ts\nconst value = 42;\n```"), true);
  assert.notEqual(run.resultSummary, run.resultAnswer);
  assert.equal((run.resultSummary?.length ?? 0) <= 900, true);
  assert.equal(run.stopReason, "completed");
  assert.equal(run.continuationAvailability, "none");
});

test("runtime record mapper preserves paused stop reasons and new-turn continuation facts", () => {
  const run = createRuntimeRunRecord({
    job: job({
      status: "blocked",
      blocked: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        reason: {
          code: "context_overflow",
          message: "上下文整理没有成功，任务没有完成。",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.equal(run.status, "blocked");
  assert.equal(run.stopReason, "context_overflow");
  assert.equal(run.continuationAvailability, "new_turn");
  assert.equal(run.resultTitle, "需要处理");
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
            observationPanelRole: "开发者详情展示运行事件。",
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

test("runtime record mapper classifies failed run error domains from existing facts", () => {
  const toolFailedRun = createRuntimeRunRecord({
    job: job({
      status: "failed",
      streamEvents: [
        streamEvent({
          sequence: 1,
          type: "tool.failed",
          toolName: "read_file",
          toolCallRefs: ["tool-read-missing"],
          detail: {
            kind: "tool",
            action: "读取文件",
            error: "ENOENT: no such file or directory, open missing.md",
          },
        }),
      ],
      failed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        error: {
          code: "desktop_agent_failed",
          message: "ENOENT: no such file or directory, open missing.md",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });
  const modelFailedRun = createRuntimeRunRecord({
    job: job({
      status: "failed",
      failed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        error: {
          code: "desktop_agent_failed",
          message: "模型服务连接失败。",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });
  const processFailedRun = createRuntimeRunRecord({
    job: job({
      status: "failed",
      streamEvents: [
        streamEvent({
          sequence: 1,
          type: "tool.failed",
          toolName: "shell_command",
          toolCallRefs: ["tool-shell-missing"],
          detail: {
            kind: "tool",
            action: "执行 Shell",
            error: "spawn pnpm ENOENT",
          },
        }),
      ],
      failed: {
        config: modelConfig(),
        informationAccess: informationAccess(),
        error: {
          code: "desktop_agent_failed",
          message: "spawn pnpm ENOENT",
        },
      },
    }),
    workspace: undefined,
    appHome: "C:\\AgentArbor\\app",
    runtimeHome: "C:\\AgentArbor\\runtime",
  });

  assert.equal(toolFailedRun.error?.errorDomain, "tool_error");
  assert.equal(toolFailedRun.error?.message, "ENOENT: no such file or directory, open missing.md");
  assert.equal(modelFailedRun.error?.errorDomain, "model_error");
  assert.equal(processFailedRun.error?.errorDomain, "process_error");
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
        toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
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
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
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
            rawRetention: "none",
            redacted: false,
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
      sequence: 1,
      type: "tool.requested",
      payload: {
        callId: "call-shell-confirmed",
        toolName: "shell_command",
      },
    }),
    eventEntry({
      sequence: 2,
      type: "user_approval.requested",
      payload: {
        confirmationId: "confirmation-1",
        question: "是否运行命令？",
        consequence: "会读取命令摘要。",
        affectedResources: ["shell:pnpm test"],
        riskLevel: "medium",
        resumeAvailability: "live",
        sourceRefs: ["tool:call-shell-confirmed"],
      },
    }),
  ]);

  assert.equal(runtimeEvent.summary.includes("hidden-token"), true);
  assert.equal(modelCall.requestId, "request-1");
  assert.equal(toolCalls[0]?.command, "pnpm test");
  assert.equal(toolCalls[0]?.display?.kind, "command_summary");
  assert.equal(toolCalls[0]?.envelope?.rawRetention, "none");
  assert.equal(JSON.stringify(toolCalls).includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(confirmations[0]?.status, "guidance");
  assert.equal(confirmations[0]?.actionSummary, "是否运行命令？");
  assert.equal(confirmations[0]?.actionSummary.includes("会读取命令摘要"), false);
  assert.equal(confirmations[0]?.guidance?.includes("sk-guidance-secret"), true);
  assert.equal(confirmations[0]?.toolCallId, "call-shell-confirmed");
  assert.equal(confirmations[0]?.toolName, "shell_command");
  assert.equal(confirmations[0]?.resumeAvailability, "lost_after_restart");
  assert.deepEqual(confirmations[0]?.sourceRefs, ["tool:call-shell-confirmed"]);
});

test("runtime record mapper keeps commandLine as the persisted command fact", () => {
  const toolCalls = toRuntimeToolCallRecords("run-1", [
    streamEvent({
      sequence: 1,
      type: "tool.completed",
      toolName: "shell_command",
      toolCallRefs: ["tool-call-quoted"],
      detail: {
        kind: "tool",
        action: "执行 Shell",
      },
    }),
  ], [
    eventEntry({
      sequence: 1,
      type: "tool.completed",
      payload: {
        callId: "tool-call-quoted",
        toolName: "shell_command",
        input: {
          commandLine: `node -e "console.log('fragile quoted shell')"`,
          command: "node",
          args: ["-e", "console.log('fragile quoted shell')"],
        },
        output: {
          action: "shell_command",
          summary: `node -e "console.log('fragile quoted shell')" · exit 0`,
          result: {
            command: "node",
            commandLine: `node -e "console.log('fragile quoted shell')"`,
            args: ["-e", "console.log('fragile quoted shell')"],
            exitCode: 0,
            stdout: "fragile quoted shell",
          },
        },
      },
    }),
  ]);

  assert.equal(toolCalls[0]?.command, `node -e "console.log('fragile quoted shell')"`);
  assert.equal(toolCalls[0]?.command?.includes(`-e console.log('fragile quoted shell')`), false);
  assert.equal(toolCalls[0]?.preview, `node -e "console.log('fragile quoted shell')"`);
});

test("runtime confirmation records title decisions without generic continue copy", () => {
  const confirmations = toRuntimeConfirmationRecords(job({
    confirmationDecisions: [
      {
        confirmationId: "confirmation-approved",
        runId: "run-1",
        decision: "approve_once",
        decidedAt: "2026-05-31T00:00:08.000Z",
      },
      {
        confirmationId: "confirmation-denied",
        runId: "run-1",
        decision: "deny",
        decidedAt: "2026-05-31T00:00:09.000Z",
      },
      {
        confirmationId: "confirmation-guidance",
        runId: "run-1",
        decision: "guidance",
        guidance: "只列出风险。",
        decidedAt: "2026-05-31T00:00:10.000Z",
      },
    ],
  }), []);

  assert.deepEqual(confirmations.map((confirmation) => `${confirmation.status}:${confirmation.title}:${confirmation.actionSummary}`), [
    "approved:已确认:用户已确认。",
    "denied:已不执行:用户已选择不执行。",
    "guidance:补充要求:用户已补充要求。",
  ]);
  assert.equal(JSON.stringify(confirmations).includes("继续处理"), false);
});

test("runtime record mapper persists ordinary tool previews without diagnostic counters", () => {
  const toolCalls = toRuntimeToolCallRecords("run-1", [
    completedToolStreamEvent(1, "tool-command", "shell_command"),
    completedToolStreamEvent(2, "tool-list", "list_dir"),
    completedToolStreamEvent(3, "tool-edit", "edit_file"),
    completedToolStreamEvent(4, "tool-create", "create_file"),
    completedToolStreamEvent(5, "tool-delete", "delete_file"),
  ], [
    toolCompletedEntry(1, "tool-command", "shell_command", { command: "pnpm", args: ["test"] }, {
      action: "shell_command",
      summary: "pnpm test · exit 0",
      result: {
        command: "pnpm",
        args: ["test"],
        exitCode: 0,
        stdout: "RAW_STDOUT_SENTINEL",
      },
    }),
    toolCompletedEntry(2, "tool-list", "list_dir", { path: "." }, {
      action: "list_dir",
      summary: ". · 2 entries",
      result: {
        path: ".",
        entries: [
          { kind: "file", name: "README.md", bytes: 120 },
          { kind: "file", name: "package.json", bytes: 300 },
        ],
      },
    }),
    toolCompletedEntry(3, "tool-edit", "edit_file", {
      path: "notes.md",
      edits: [{ oldText: "old visible line", newText: "new visible line" }],
    }, {
      action: "edit_file",
      summary: "notes.md · 32 -> 18 chars · 1 replacement",
      result: {
        path: "notes.md",
        previousLength: 32,
        nextLength: 18,
        replacements: 1,
      },
    }),
    toolCompletedEntry(4, "tool-create", "create_file", { path: "created.md" }, {
      action: "create_file",
      summary: "created.md · 42 bytes · created",
      result: {
        path: "created.md",
        bytes: 42,
      },
    }),
    toolCompletedEntry(5, "tool-delete", "delete_file", { path: "old.md" }, {
      action: "delete_file",
      summary: "old.md · 42 bytes · deleted",
      result: {
        path: "old.md",
        bytes: 42,
      },
    }),
  ]);
  const serialized = JSON.stringify(toolCalls);
  const listedCall = toolCalls.find((call) => call.callId === "tool-list");

  assert.equal(toolCalls.find((call) => call.callId === "tool-command")?.preview, "pnpm test");
  assert.equal(listedCall?.preview, "file README.md\nfile package.json");
  assert.equal(toolCalls.find((call) => call.callId === "tool-edit")?.preview, "- old visible line\n+ new visible line");
  assert.equal(toolCalls.find((call) => call.callId === "tool-create")?.preview, "created.md · 已创建\n文件：created.md");
  assert.equal(toolCalls.find((call) => call.callId === "tool-delete")?.preview, "old.md · 已删除\n文件：old.md");
  assert.equal(listedCall?.display?.kind, "directory_listing");
  assert.equal(
    listedCall?.display?.kind === "directory_listing"
      ? listedCall.display.totalEntries
      : undefined,
    2,
  );
  assert.equal(serialized.includes("exit 0"), false);
  assert.equal(serialized.includes("32 -> 18 chars"), false);
  assert.equal(serialized.includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(serialized.includes("old visible line"), true);
  assert.equal(serialized.includes("new visible line"), true);
});

test("runtime tool call records preserve tool and process error domains", () => {
  const toolCalls = toRuntimeToolCallRecords("run-1", [
    streamEvent({
      sequence: 1,
      type: "tool.failed",
      toolName: "read_file",
      toolCallRefs: ["tool-read-missing"],
      detail: {
        kind: "tool",
        action: "读取文件",
        error: "ENOENT: no such file or directory, open missing.md",
      },
    }),
    streamEvent({
      sequence: 2,
      type: "tool.failed",
      toolName: "shell_command",
      toolCallRefs: ["tool-shell-missing"],
      detail: {
        kind: "tool",
        action: "执行 Shell",
        error: "spawn pnpm ENOENT",
      },
    }),
  ], [
    eventEntry({
      sequence: 1,
      type: "tool.failed",
      payload: {
        callId: "tool-read-missing",
        toolName: "read_file",
        input: { path: "missing.md" },
        error: "ENOENT: no such file or directory, open missing.md",
        output: {
          envelope: {
            agentSummary: "ENOENT: no such file or directory, open missing.md",
            evidenceRefs: ["tool:tool-read-missing"],
            rawRetention: "none",
            redacted: false,
            errorDomain: "tool_error",
            errorFacts: {
              code: "ENOENT",
              path: "missing.md",
            },
          },
        },
      },
    }),
    eventEntry({
      sequence: 2,
      type: "tool.failed",
      payload: {
        callId: "tool-shell-missing",
        toolName: "shell_command",
        input: { command: "pnpm", args: ["missing"] },
        error: "spawn pnpm ENOENT",
        output: {
          result: {
            command: "pnpm",
            args: ["missing"],
          },
        },
      },
    }),
  ]);

  assert.equal(toolCalls.find((call) => call.callId === "tool-read-missing")?.errorDomain, "tool_error");
  assert.equal(toolCalls.find((call) => call.callId === "tool-read-missing")?.envelope?.errorDomain, "tool_error");
  assert.equal(toolCalls.find((call) => call.callId === "tool-read-missing")?.errorFacts?.code, "ENOENT");
  assert.equal(toolCalls.find((call) => call.callId === "tool-read-missing")?.envelope?.errorFacts?.path, "missing.md");
  assert.equal(toolCalls.find((call) => call.callId === "tool-shell-missing")?.errorDomain, "process_error");
});

test("runtime record mapper preserves projected failure facts from real tool.failed events", () => {
  const errorFacts = {
    code: "ENOENT",
    syscall: "spawn",
    command: "pnpm",
    args: ["missing"],
  };
  const result: ToolCallResult = {
    callId: "tool-shell-missing",
    toolName: "shell_command",
    input: { command: "pnpm", args: ["missing"] },
    output: undefined,
    status: "failed",
    error: "spawn pnpm ENOENT",
    errorDomain: "process_error",
    errorFacts,
    durationMs: 7,
    projection: {
      agentContent: {
        status: "failed",
        toolName: "shell_command",
        callId: "tool-shell-missing",
        error: "spawn pnpm ENOENT",
        errorDomain: "process_error",
        errorFacts,
      },
      uiSummary: "spawn pnpm ENOENT",
      diagnosticRef: "tool:tool-shell-missing:failed",
      envelope: {
        agentSummary: "spawn pnpm ENOENT",
        evidenceRefs: ["tool:tool-shell-missing"],
        tokenEstimate: 8,
        truncated: false,
        redacted: false,
        diagnosticRef: "tool:tool-shell-missing:failed",
        rawRetention: "none",
        errorDomain: "process_error",
        errorFacts,
      },
      truncated: false,
      redacted: false,
    },
  };
  const message = createToolFailedMessage({
    result,
    context: {
      callerAgentId: "agent-test",
      traceId: "trace-runtime-records",
      goalId: "goal-test",
    },
  });
  const projectedOutput = message.payload.output as {
    readonly envelope?: {
      readonly errorDomain?: string;
      readonly errorFacts?: {
        readonly code?: string;
        readonly command?: string;
      };
    };
  };
  const eventEntries: readonly EventLogEntry[] = [
    {
      sequence: 1,
      type: message.type,
      message,
      recordedAt: "2026-05-31T00:00:01.000Z",
    },
  ];
  const transcript = createPanelRunTranscript({
    runId: "run-1",
    status: "failed",
    eventEntries,
    desktopMode: "agent",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:10.000Z",
    error: {
      code: "desktop_agent_failed",
      message: "spawn pnpm ENOENT",
    },
  });
  const failedStreamEvent = transcript.events.find((event) => event.type === "tool.failed");
  const failedNode = transcript.transcriptNodes.find((node) => node.eventType === "tool.failed");
  const toolCalls = toRuntimeToolCallRecords("run-1", transcript.events, eventEntries);
  const call = toolCalls.find((item) => item.callId === "tool-shell-missing");

  assert.equal(message.payload.errorDomain, "process_error");
  assert.equal(message.payload.errorFacts?.code, "ENOENT");
  assert.equal(projectedOutput.envelope?.errorDomain, "process_error");
  assert.equal(projectedOutput.envelope?.errorFacts?.command, "pnpm");
  assert.equal(failedStreamEvent?.detail?.errorDomain, "process_error");
  assert.equal(failedStreamEvent?.detail?.envelope?.errorFacts?.code, "ENOENT");
  assert.equal(failedStreamEvent?.detail?.errorFacts?.syscall, "spawn");
  assert.equal(failedNode?.phase, "failed");
  assert.equal(failedNode?.refs.some((ref) => ref.kind === "tool_call" && ref.id === "tool-shell-missing"), true);
  assert.equal(call?.errorDomain, "process_error");
  assert.equal(call?.errorFacts?.code, "ENOENT");
  assert.deepEqual(call?.errorFacts?.args, ["missing"]);
  assert.equal(call?.envelope?.errorDomain, "process_error");
  assert.equal(call?.envelope?.errorFacts?.command, "pnpm");
});

test("runtime record mapper omits ephemeral tool model attachments", () => {
  const attachmentData = "BASE64_IMAGE_SENTINEL";
  const result: ToolCallResult = {
    callId: "tool-read-image",
    toolName: "read_context_attachment_image",
    input: { attachmentId: "ctx-image" },
    output: {
      action: "read_context_attachment_image",
      status: "completed",
      result: {
        attachmentId: "ctx-image",
        mimeType: "image/png",
        bytes: 12,
        readable: true,
        modelInput: { attached: true, detail: "auto" },
      },
    },
    status: "completed",
    durationMs: 5,
    projection: {
      agentContent: {
        summary: "image metadata returned",
        attachmentId: "ctx-image",
        modelInput: { attached: true, detail: "auto" },
      },
      modelAttachments: [{
        kind: "image",
        attachmentId: "ctx-image",
        inputRef: "local-file:C:/secret/screenshot.png",
        filename: "screenshot.png",
        detail: "auto",
        byteLength: 12,
        source: { kind: "data", mimeType: "image/png", data: attachmentData },
      }],
      uiSummary: "Image attached for model input.",
      display: {
        kind: "generic_tool_summary",
        action: "read_context_attachment_image",
        summary: "Image attached for model input.",
      },
      truncated: false,
      redacted: false,
    },
  };
  const message = createToolCompletedMessage({
    result,
    context: {
      callerAgentId: "agent-test",
      traceId: "trace-runtime-records",
      goalId: "goal-test",
    },
  });
  const eventEntries: readonly EventLogEntry[] = [
    {
      sequence: 1,
      type: message.type,
      message,
      recordedAt: "2026-05-31T00:00:01.000Z",
    },
  ];
  const transcript = createPanelRunTranscript({
    runId: "run-1",
    status: "completed",
    eventEntries,
    desktopMode: "agent",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:10.000Z",
  });
  const toolCalls = toRuntimeToolCallRecords("run-1", transcript.events, eventEntries);
  const serialized = JSON.stringify({ payload: message.payload, events: transcript.events, toolCalls });
  const call = toolCalls.find((item) => item.callId === "tool-read-image");

  assert.equal(call?.toolName, "read_context_attachment_image");
  assert.equal(call?.display?.kind, "generic_tool_summary");
  assert.equal(serialized.includes("Image attached for model input."), true);
  assert.equal(serialized.includes("BASE64_IMAGE_SENTINEL"), false);
  assert.equal(serialized.includes("modelAttachments"), false);
  assert.equal(serialized.includes("local-file:"), false);
  assert.equal(serialized.includes("C:/secret/screenshot.png"), false);
});

test("runtime record mapper persists completed read provider failure facts", () => {
  const errorFacts = {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 54321,
    method: "GET",
    url: "http://127.0.0.1:54321/status",
    durationMs: 5,
  };
  const display = {
    kind: "read_result" as const,
    ref: "http://127.0.0.1:54321/status",
    status: "provider-failed",
    error: "http_request failed: ECONNREFUSED 127.0.0.1:54321",
    errorFacts,
  };
  const envelope = {
    agentSummary: "资料读取已完成。\n错误：http_request failed: ECONNREFUSED 127.0.0.1:54321",
    evidenceRefs: ["tool:tool-read-http", "http://127.0.0.1:54321/status"],
    tokenEstimate: 24,
    truncated: false,
    rawRetention: "none" as const,
    redacted: false,
    errorFacts,
  };
  const toolCalls = toRuntimeToolCallRecords("run-1", [
    streamEvent({
      sequence: 1,
      type: "tool.completed",
      toolName: "read",
      toolCallRefs: ["tool-read-http"],
      detail: {
        kind: "tool",
        action: "读取资料",
        display,
        envelope,
        errorFacts,
      },
    }),
  ], [
    eventEntry({
      sequence: 1,
      type: "tool.completed",
      payload: {
        callId: "tool-read-http",
        toolName: "read",
        input: { ref: "http://127.0.0.1:54321/status" },
        output: {
          summary: "资料读取已完成。",
          display,
          envelope,
          result: {},
        },
      },
    }),
  ]);
  const call = toolCalls.find((item) => item.callId === "tool-read-http");

  assert.equal(call?.status, "completed");
  assert.equal(call?.display?.kind, "read_result");
  assert.equal(call?.errorFacts?.code, "ECONNREFUSED");
  assert.equal(call?.envelope?.errorFacts?.port, 54321);
  assert.equal(call?.preview?.includes("ECONNREFUSED"), true);
});

test("runtime record mapper persists search invalid-input messages", () => {
  const display = {
    kind: "search_results" as const,
    query: "",
    status: "invalid-input",
    message: "search requires a non-empty query.",
    results: [],
  };
  const toolCalls = toRuntimeToolCallRecords("run-1", [
    streamEvent({
      sequence: 1,
      type: "tool.completed",
      toolName: "search",
      toolCallRefs: ["tool-search-empty"],
      detail: {
        kind: "tool",
        action: "搜索资料",
      },
    }),
  ], [
    eventEntry({
      sequence: 1,
      type: "tool.completed",
      payload: {
        callId: "tool-search-empty",
        toolName: "search",
        input: { query: "" },
        output: {
          action: "search",
          display,
        },
      },
    }),
  ]);
  const call = toolCalls.find((item) => item.callId === "tool-search-empty");

  assert.equal(call?.display?.kind, "search_results");
  assert.equal(call?.display?.kind === "search_results" ? call.display.message : undefined, "search requires a non-empty query.");
  assert.equal(call?.preview?.includes("invalid-input"), true);
  assert.equal(call?.preview?.includes("search requires a non-empty query."), true);
});

test("runtime text compaction preserves text before truncating", () => {
  const compacted = compactRuntimeText("prefix sk-secret-value-123456 suffix", 24);

  assert.equal(compacted.includes("sk-secret"), true);
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

function modelCapabilities(): NonNullable<PanelRunJob["capabilitySnapshot"]>["modelCapabilities"] {
  return {
    contextWindowTokens: 16_000,
    maxOutputTokens: 4_000,
    supportsToolCalling: true,
    supportsParallelToolCalls: false,
    supportsStructuredOutputs: false,
    supportsStreaming: true,
    supportsVisionInput: false,
    supportsReasoningEffort: false,
    preferredApiStyle: "chat_completions",
    stability: "stable",
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
  const allowedTools = ["search"];
  const warnings: readonly string[] = [];
  return {
    resolutionId: "capability-resolution-test",
    snapshotId: "snapshot-test",
    runMode: "agent",
    agentId: "desktop-agent-session",
    agentDisplayName: "Desktop Agent",
    toolVisibilityProfileId: "desktop-root-agent:ordinary-visible-tools:v2",
    capabilityPlan: createRunCapabilityPlan({
      profile: modelConfig(),
      modelCapabilities: modelCapabilities(),
      allowedTools,
      warnings,
    }),
    allowedTools,
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
        reason: "可用。",
      },
    ],
    enabledSkills: [],
    mcpDrafts: [],
    warnings,
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

function completedToolStreamEvent(
  sequence: number,
  toolCallRef: string,
  toolName: string
): PanelRunStreamEvent {
  return streamEvent({
    sequence,
    type: "tool.completed",
    toolName,
    toolCallRefs: [toolCallRef],
  });
}

function toolCompletedEntry(
  sequence: number,
  callId: string,
  toolName: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>
): EventLogEntry {
  return eventEntry({
    sequence,
    type: "tool.completed",
    payload: {
      callId,
      toolName,
      input,
      output,
    },
  });
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
