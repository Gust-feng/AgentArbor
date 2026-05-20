import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createPanelRunStreamEvents, createPanelRunTranscript } from "./panel-run-read-model.js";

test("panel reasoning trace is matched by exact model output contract", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-trace",
    status: "running",
    eventEntries: [
      modelCompletedEntry({
        sequence: 1,
        requestId: "request-intent",
        contractId: "underground.intent_profile.v1",
        decisionSummary: "Intent Core shaped the goal.",
      }),
      modelCompletedEntry({
        sequence: 2,
        requestId: "request-convergence",
        contractId: "underground.convergence_judgment.v1",
        decisionSummary: "Convergence Judge selected the handoff candidate.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
  });

  const intentNote = transcript.workNotes.find((note) => note.noteId.endsWith(":intent-core"));
  const convergenceNote = transcript.workNotes.find((note) => note.noteId.endsWith(":convergence-judge"));
  const handoffNote = transcript.workNotes.find((note) => note.noteId.endsWith(":handoff-steward"));

  assert.equal(intentNote?.reasoningTrace?.decisionSummary, "Intent Core shaped the goal.");
  assert.equal(convergenceNote?.reasoningTrace?.decisionSummary, "Convergence Judge selected the handoff candidate.");
  assert.equal(handoffNote?.reasoningTrace, undefined);
});

test("panel transcript exposes delegation and parent synthesis as semantic stream events", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-fabric",
    status: "running",
    eventEntries: [
      eventEntry({
        sequence: 1,
        type: "agent.delegation.planned",
        payload: {
          decisionId: "delegation-1",
          delegationDecision: {
            decisionId: "delegation-1",
            action: "spawn_children",
          },
          childSpecIds: ["spec-rootlet-option"],
        },
      }),
      eventEntry({
        sequence: 2,
        type: "agent.child.started",
        payload: {
          childRunId: "child-run-option",
          agentSpec: {
            specId: "spec-rootlet-option",
            agentId: "rootlet-explorer-option",
            displayName: "Rootlet option",
          },
          childRun: {
            childRunId: "child-run-option",
            status: "running",
          },
        },
      }),
      eventEntry({
        sequence: 3,
        type: "agent.parent_synthesis.completed",
        payload: {
          synthesisId: "parent-synthesis-1",
          parentSynthesis: {
            synthesisId: "parent-synthesis-1",
            decisionSummary: "Parent synthesized child material without raw provider output.",
            nextAction: "request_convergence",
          },
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });

  assert.deepEqual(
    transcript.events.map((event) => event.type).filter((type) => type.startsWith("agent.")),
    ["agent.delegation.planned", "agent.child.started", "agent.parent_synthesis.completed"],
  );
  assert.equal(
    transcript.events.some((event) => event.sourceRefs.includes("agent_delegation:delegation-1")),
    true,
  );
  assert.equal(JSON.stringify(transcript).includes("raw provider response"), false);
});

test("panel transcript projects confirmation and user guidance as safe ordinary-agent events", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-confirmation",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({
        sequence: 1,
        type: "goal.received",
        payload: { goalId: "goal-confirmation" },
      }),
      eventEntry({
        sequence: 2,
        type: "user_approval.requested",
        payload: {
          confirmationId: "confirmation-1",
          question: "请选择要读取的文件。",
          consequence: "未授权前不会读取本地文件。",
        },
      }),
      eventEntry({
        sequence: 3,
        type: "user_approval.received",
        payload: {
          confirmationId: "confirmation-1",
          decision: "拒绝",
          note: "先不要读取，直接说明需要哪些材料。",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });

  assert.deepEqual(
    transcript.events.map((event) => event.type),
    ["run.started", "confirmation.needed", "user.guidance", "final.result"],
  );
  assert.equal(transcript.events[1]?.summary?.includes("请选择要读取的文件"), true);
  assert.equal(transcript.events[2]?.summary?.includes("先不要读取"), true);
  assert.equal(JSON.stringify(transcript).includes("raw prompt"), false);
});

test("ordinary agent stream stays quiet for direct answers but shows safe thinking around tool work", () => {
  const direct = createPanelRunStreamEvents({
    runId: "run-direct-answer",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-direct" } }),
      eventEntry({
        sequence: 2,
        type: "model.requested",
        payload: { requestId: "request-direct", purpose: "desktop_chat" },
      }),
      modelCompletedEntry({
        sequence: 3,
        requestId: "request-direct",
        contractId: "desktop.chat.answer.v1",
        decisionSummary: "Direct answer text.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });
  const withTool = createPanelRunStreamEvents({
    runId: "run-tool-work",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-tool" } }),
      eventEntry({
        sequence: 2,
        type: "model.requested",
        payload: { requestId: "request-before-tool", purpose: "desktop_agent" },
      }),
      eventEntry({
        sequence: 3,
        type: "tool.requested",
        payload: { callId: "tool-call-read", toolName: "read_file", input: { path: "notes.md" } },
      }),
      eventEntry({
        sequence: 4,
        type: "tool.completed",
        payload: {
          callId: "tool-call-read",
          toolName: "read_file",
          input: { path: "notes.md" },
          output: {
            action: "read_file",
            summary: "notes.md · 34 bytes",
            display: {
              kind: "generic_tool_summary",
              action: "read_file",
              summary: "notes.md · 34 bytes",
            },
            result: {
              path: "notes.md",
              bytes: 34,
              content: "RAW_TOOL_OUTPUT_SENTINEL must stay out of panel events.",
            },
            truncated: false,
          },
        },
      }),
      modelCompletedEntry({
        sequence: 5,
        requestId: "request-after-tool",
        contractId: "desktop.agent.answer.v1",
        decisionSummary: "Tool-assisted answer text.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:05.000Z",
  });
  const completedTool = withTool.find((event) => event.type === "tool.completed");

  assert.deepEqual(direct.map((event) => event.type), ["run.started", "final.result"]);
  assert.equal(direct.at(-1)?.summary?.includes("Direct answer text."), true);
  assert.equal(withTool.some((event) => event.type === "agent.note.delta"), true);
  assert.equal(withTool.some((event) => event.type === "model.output.completed"), true);
  assert.equal(completedTool?.detail?.kind, "tool");
  assert.equal(completedTool?.detail?.display?.kind, "generic_tool_summary");
  assert.equal(withTool.find((event) => event.type === "tool.completed")?.detail?.display?.kind, "generic_tool_summary");
  assert.equal(completedTool?.detail?.preview?.includes("notes.md"), true);
  assert.equal(completedTool?.detail?.preview?.includes("文件正文只进入本轮工具上下文"), false);
  assert.equal(JSON.stringify(withTool).includes("RAW_TOOL_OUTPUT_SENTINEL"), false);
  assert.equal(JSON.stringify(withTool).includes("\"action\":\"read_file\""), false);
});

test("ordinary agent stream exposes context compaction as safe continuation maintenance", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-context-compaction",
    status: "running",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-context" } }),
      eventEntry({
        sequence: 2,
        type: "context.compaction.completed",
        payload: {
          goalId: "goal-context",
          summaryId: "conversation-summary-1",
          tokenCount: 92_000,
          threshold: 80_000,
          coveredRefCount: 18,
          messageCountAfter: 12,
          requestId: "model-request-compaction",
          responseId: "model-response-compaction",
          summary: "上下文达到 92000/80000 tokens，已压缩 18 条较早上下文。",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });
  const compaction = events.find((event) => event.type === "context.compaction.completed");
  const serialized = JSON.stringify(events);

  assert.equal(compaction?.agentLabel, "上下文");
  assert.equal(compaction?.summary?.includes("已压缩 18 条"), true);
  assert.equal(compaction?.detail?.preview?.includes("覆盖较早上下文 18 条"), true);
  assert.deepEqual(compaction?.modelCallRefs, ["model-request-compaction", "model-response-compaction"]);
  assert.equal(serialized.includes("raw prompt"), false);
  assert.equal(serialized.includes("raw tool output"), false);
});

test("ordinary agent stream treats tool-call model text as status instead of visible answer", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-tool-call-text",
    status: "blocked",
    desktopMode: "agent",
    error: {
      code: "out_of_fuel",
      message: "internal out_of_fuel guard should not be shown as ordinary UX",
    },
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-tool-call-text" } }),
      modelCompletedEntry({
        sequence: 2,
        requestId: "request-tool-call",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "我还没有主动完成，需要继续读取额外材料。",
        finishReason: "tool_call",
      }),
      eventEntry({
        sequence: 3,
        type: "tool.requested",
        payload: { callId: "tool-call-read", toolName: "read_file", input: { path: "extra.md" } },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });
  const serialized = JSON.stringify(events);

  assert.equal(events.some((event) => event.type === "model.output.delta"), false);
  assert.equal(events.some((event) => event.type === "model.output.completed"), false);
  assert.equal(events.some((event) => event.type === "tool.requested"), true);
  const blockedSummary = events.find((event) => event.type === "run.blocked")?.summary ?? "";
  assert.equal(blockedSummary.includes("异常保护中断"), true);
  assert.equal(blockedSummary.includes("任务没有完成"), true);
  assert.equal(blockedSummary.includes("轮次"), false);
  assert.equal(blockedSummary.includes("上限"), false);
  assert.equal(serialized.includes("loop"), false);
  assert.equal(serialized.includes("provider"), false);
  assert.equal(serialized.includes("raw prompt"), false);
  assert.equal(serialized.includes("fuel"), false);
});

test("panel transcript preserves typed safe tool display without raw command output", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-command-display",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-command" } }),
      eventEntry({
        sequence: 2,
        type: "tool.completed",
        payload: {
          callId: "tool-call-shell",
          toolName: "shell_command",
          input: { command: "pnpm", args: ["test"] },
          output: {
            action: "shell_command",
            summary: "pnpm test · exit 0",
            display: {
              kind: "command_summary",
              command: "pnpm",
              args: ["test"],
              exitCode: 0,
              outputSummary: "tests passed",
            },
            envelope: {
              agentSummary: "Command completed with exit 0.\noutput summary:\ntests passed",
              evidenceRefs: ["tool:tool-call-shell"],
              uiDisplay: {
                kind: "command_summary",
                command: "pnpm",
                args: ["test"],
                exitCode: 0,
                outputSummary: "tests passed",
              },
              tokenEstimate: 12,
              truncated: false,
              redacted: true,
              diagnosticRef: "tool:tool-call-shell",
              rawRetention: "diagnostic_ref_only",
            },
            result: {
              command: "pnpm",
              args: ["test"],
              exitCode: 0,
              stdout: "RAW_STDOUT_SENTINEL",
              stderr: "",
            },
          },
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });
  const completedTool = transcript.events.find((event) => event.type === "tool.completed");

  assert.equal(completedTool?.detail?.display?.kind, "command_summary");
  assert.equal(completedTool?.detail?.envelope?.uiDisplay?.kind, "command_summary");
  assert.equal(completedTool?.detail?.envelope?.evidenceRefs.includes("tool:tool-call-shell"), true);
  assert.equal(JSON.stringify(transcript).includes("RAW_STDOUT_SENTINEL"), false);
});

test("panel transcript edit fallback omits raw replacement text", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-edit-display",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-edit" } }),
      eventEntry({
        sequence: 2,
        type: "tool.completed",
        payload: {
          callId: "tool-call-edit",
          toolName: "edit_file",
          input: {
            path: "notes.md",
            oldText: "RAW_OLD_TEXT_SENTINEL sk-edit-secret",
            newText: "RAW_NEW_TEXT_SENTINEL sk-edit-secret",
          },
          output: {
            action: "edit_file",
            summary: "notes.md · 32 -> 18 chars · 1 replacement",
            result: {
              path: "notes.md",
              previousLength: 32,
              nextLength: 18,
              replacements: 1,
            },
          },
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });
  const serialized = JSON.stringify(transcript);
  const completedTool = transcript.events.find((event) => event.type === "tool.completed");

  assert.equal(completedTool?.detail?.preview?.includes("长度：32 -> 18 chars"), true);
  assert.equal(serialized.includes("RAW_OLD_TEXT_SENTINEL"), false);
  assert.equal(serialized.includes("RAW_NEW_TEXT_SENTINEL"), false);
  assert.equal(serialized.includes("sk-edit-secret"), false);
});

function modelCompletedEntry(input: {
  readonly sequence: number;
  readonly requestId: string;
  readonly contractId: string;
  readonly decisionSummary: string;
  readonly finishReason?: "stop" | "length" | "tool_call" | "content_filter" | "error";
}): EventLogEntry {
  const type: ArborMessageType = "model.completed";
  const message: ArborMessage = {
    id: `message-${input.sequence}`,
    traceId: "trace-panel-trace",
    from: { id: "intelligence-channel", role: "underground_center" },
    to: { group: "underground-center" },
    type,
    intent: "complete_model_request",
    payload: {
      requestId: input.requestId,
      responseId: `response-${input.requestId}`,
      purpose: "test-purpose",
      outputContract: { contractId: input.contractId },
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "fake-model",
      finishReason: input.finishReason ?? "stop",
      outputKind: "explanation",
      validationStatus: "passed",
      visibleOutput: visibleOutput(input.contractId, input.decisionSummary),
    },
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence: input.sequence,
    type,
    message,
    recordedAt: "2026-05-07T00:00:00.000Z",
  };
}

function eventEntry(input: {
  readonly sequence: number;
  readonly type: ArborMessageType;
  readonly payload: Record<string, unknown>;
}): EventLogEntry {
  const message: ArborMessage = {
    id: `message-${input.sequence}`,
    traceId: "trace-panel-fabric",
    from: { id: "underground-center-manager", role: "underground_center" },
    to: { group: "underground-center" },
    type: input.type,
    intent: input.type.replaceAll(".", "_"),
    payload: input.payload,
    createdAt: "2026-05-07T00:00:00.000Z",
  };
  return {
    sequence: input.sequence,
    type: input.type,
    message,
    recordedAt: "2026-05-07T00:00:00.000Z",
  };
}

function visibleOutput(contractId: string, decisionSummary: string): ModelVisibleOutputProjection {
  return {
    source: "structured_output",
    contractId,
    outputKind: "explanation",
    validationStatus: "passed",
    items: [
      {
        itemId: "item-1",
        fields: [
          { name: "decisionSummary", value: decisionSummary, truncated: false },
          { name: "text", value: decisionSummary, truncated: false },
          { name: "uncertainty", value: "fixture uncertainty", truncated: false },
          { name: "confidence", value: "0.8", truncated: false },
        ],
      },
    ],
    truncated: false,
  };
}
