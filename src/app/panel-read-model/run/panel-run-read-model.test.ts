import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../../../domain/common.js";
import type { ModelVisibleOutputProjection } from "../../../domain/intelligence/index.js";
import type { EventLogEntry } from "../../../kernel/events/in-memory-event-log.js";
import type { PanelRunSummary } from "./panel-run-summary.js";
import {
  createPanelRunStreamEvents,
  IncrementalPanelRunStreamProjector,
} from "./panel-run-stream-events.js";
import { createPanelRunTranscript } from "./panel-run-transcript.js";
import { createPanelTranscriptNodes } from "../transcript/panel-transcript-nodes.js";

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

test("panel transcript passes frozen ordinary agent identity into desktop work notes", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-custom-agent",
    status: "completed",
    desktopMode: "agent",
    agentDefinitionRef: {
      agentId: "custom-ordinary-agent",
      agentDisplayName: "Custom Ordinary Agent",
    },
    eventEntries: [
      modelCompletedEntry({
        sequence: 1,
        requestId: "request-custom-agent",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "Custom ordinary agent answered.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
  });

  const desktopNote = transcript.workNotes.find((note) => note.noteId.endsWith(":desktop-agent"));

  assert.equal(desktopNote?.agentId, "custom-ordinary-agent");
  assert.equal(desktopNote?.agentLabel, "Custom Ordinary Agent");
  assert.equal(transcript.events[0]?.agentLabel, "Custom Ordinary Agent");
  assert.equal(transcript.events.at(-1)?.agentLabel, "Custom Ordinary Agent");
  assert.equal(JSON.stringify(transcript.workNotes).includes("promptRef"), false);
  assert.equal(JSON.stringify(transcript.workNotes).includes("systemPrompt"), false);
});

test("panel transcript keeps pending ordinary desktop runs out of underground notes", () => {
  const transcript = createPanelRunTranscript({
    runId: "run-panel-pending-agent",
    status: "running",
    desktopMode: "agent",
    agentDefinitionRef: {
      agentId: "pending-ordinary-agent",
      agentDisplayName: "Pending Ordinary Agent",
    },
    eventEntries: [],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
  });

  assert.deepEqual(transcript.workNotes.map((note) => note.agentId), ["pending-ordinary-agent"]);
  assert.equal(JSON.stringify(transcript.workNotes).includes("Model Calls"), false);
  assert.equal(JSON.stringify(transcript.workNotes).includes("模型调用"), false);
  assert.equal(JSON.stringify(transcript.workNotes).includes("underground"), false);
  assert.equal(JSON.stringify(transcript.workNotes).includes("Legacy Work Session Manager"), false);
  assert.equal(JSON.stringify(transcript.workNotes).includes("Plan Steward"), false);
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
  assertOrdinaryStreamHasNoInternalTerms(transcript.events.map(ordinaryEventVisibleText).join("\n"));
});

test("panel transcript projects concrete user decisions without generic approval progress", () => {
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
          decision: "approve_once",
        },
      }),
      eventEntry({
        sequence: 4,
        type: "user_approval.received",
        payload: {
          confirmationId: "confirmation-2",
          decision: "拒绝",
          note: "先不要读取，直接说明需要哪些材料。",
        },
      }),
      eventEntry({
        sequence: 5,
        type: "user_approval.received",
        payload: {
          confirmationId: "confirmation-3",
          decision: "guidance",
          note: "只列出需要的文件名。",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:05.000Z",
  });

  assert.deepEqual(
    transcript.events.map((event) => event.type),
    ["run.started", "confirmation.needed", "user_approval.received", "user.guidance"],
  );
  assert.equal(transcript.events[1]?.summary?.includes("请选择要读取的文件"), true);
  assert.equal(transcript.events[1]?.summary?.includes("未授权前不会读取本地文件"), false);
  assert.equal(transcript.events[2]?.summary?.includes("先不要读取"), true);
  assert.equal(transcript.events[2]?.summary?.includes("已不执行"), true);
  assert.equal(transcript.events[3]?.summary?.includes("只列出需要的文件名"), true);
  assert.equal(JSON.stringify(transcript.events).includes("approve_once"), false);
  assert.equal(JSON.stringify(transcript.events).includes("继续处理"), false);
  assert.equal(JSON.stringify(transcript).includes("raw prompt"), false);
});

test("panel transcript nodes preserve ordered ordinary-agent tool lifecycle", () => {
  const nodes = createPanelTranscriptNodes([
    streamEvent({ sequence: 1, type: "run.started" }),
    streamEvent({
      sequence: 2,
      type: "tool.requested",
      toolName: "shell_command",
      summary: "准备运行 pnpm test",
      toolCallRefs: ["tool-call-shell"],
      detail: {
        kind: "tool",
        action: "运行命令",
        display: { kind: "command_summary", command: "pnpm", args: ["test"] },
      },
    }),
    streamEvent({
      sequence: 3,
      type: "confirmation.needed",
      summary: "运行命令需要确认。",
      toolCallRefs: ["tool-call-shell"],
      sourceRefs: ["confirmation:confirmation-shell"],
    }),
    streamEvent({
      sequence: 4,
      type: "run.resumed",
      summary: "继续执行。",
      sourceRefs: ["confirmation:confirmation-shell"],
    }),
    streamEvent({
      sequence: 5,
      type: "tool.requested",
      toolName: "shell_command",
      summary: "开始运行 pnpm test",
      toolCallRefs: ["tool-call-shell"],
      detail: {
        kind: "tool",
        action: "运行命令",
        display: { kind: "command_summary", command: "pnpm", args: ["test"] },
      },
    }),
    streamEvent({
      sequence: 6,
      type: "tool.completed",
      toolName: "shell_command",
      summary: "pnpm test · exit 0",
      toolCallRefs: ["tool-call-shell"],
      detail: {
        kind: "tool",
        action: "运行命令",
        display: {
          kind: "command_summary",
          command: "pnpm",
          args: ["test"],
          exitCode: 0,
          outputSummary: "tests passed",
        },
      },
    }),
    streamEvent({
      sequence: 7,
      type: "model.reasoning.delta",
      delta: "工具完成后再次检查结果。",
      modelCallRefs: ["model-after-tool"],
    }),
    streamEvent({ sequence: 8, type: "final.result", summary: "结果已生成。" }),
  ]);

  assert.deepEqual(
    nodes.map((node) => `${node.eventType}:${node.phase}`),
    [
      "tool.requested:preparing",
      "confirmation.needed:waiting_approval",
      "tool.requested:executing",
      "tool.completed:completed",
      "model.reasoning.completed:completed",
      "final.result:completed",
    ],
  );
  assert.equal(nodes[0]?.title.includes("准备"), true);
  assert.equal(nodes[2]?.title, "运行命令");
  assert.equal(nodes[3]?.summary, "pnpm test · exit 0 · tests passed");
  assert.equal(ordinaryVisibleProjectionIncludes(nodes, "exit 0"), true);
  assert.equal(nodes[4]?.sequence > nodes[3]!.sequence, true);
});

test("panel transcript nodes merge contiguous reasoning deltas without moving tool boundaries", () => {
  const nodes = createPanelTranscriptNodes([
    streamEvent({ sequence: 1, type: "run.started" }),
    streamEvent({
      sequence: 2,
      type: "model.reasoning.delta",
      delta: "files",
      modelCallRefs: ["model-before-tool"],
    }),
    streamEvent({
      sequence: 3,
      type: "model.reasoning.delta",
      delta: " to",
      modelCallRefs: ["model-before-tool"],
    }),
    streamEvent({
      sequence: 4,
      type: "model.reasoning.delta",
      delta: " understand",
      modelCallRefs: ["model-before-tool"],
    }),
    streamEvent({
      sequence: 5,
      type: "tool.requested",
      toolName: "list_files",
      summary: "开始浏览目录",
      toolCallRefs: ["tool-call-list"],
      detail: {
        kind: "tool",
        action: "浏览目录",
        display: { kind: "generic_tool_summary", action: "浏览目录", summary: "workspace" },
      },
    }),
    streamEvent({
      sequence: 6,
      type: "tool.completed",
      toolName: "list_files",
      summary: "目录浏览完成",
      toolCallRefs: ["tool-call-list"],
      detail: {
        kind: "tool",
        action: "浏览目录",
        display: { kind: "generic_tool_summary", action: "浏览目录", summary: "3 个文件" },
      },
    }),
    streamEvent({
      sequence: 7,
      type: "model.reasoning.delta",
      delta: "then",
      modelCallRefs: ["model-after-tool"],
    }),
    streamEvent({
      sequence: 8,
      type: "model.reasoning.delta",
      delta: " summarize",
      modelCallRefs: ["model-after-tool"],
    }),
    streamEvent({ sequence: 9, type: "final.result", summary: "结果已生成。" }),
  ]);

  assert.deepEqual(
    nodes.map((node) => `${node.kind}:${node.eventType}:${node.phase}:${node.summary}`),
    [
      "thinking:model.reasoning.completed:completed:files to understand",
      "tool:tool.requested:executing:workspace",
      "tool:tool.completed:completed:3 个文件",
      "thinking:model.reasoning.completed:completed:then summarize",
      "answer:final.result:completed:结果已生成。",
    ],
  );
  assert.equal(nodes[0]?.text, "files to understand");
  assert.equal(nodes[3]?.text, "then summarize");
});

test("panel transcript nodes close merged reasoning on completion event", () => {
  const nodes = createPanelTranscriptNodes([
    streamEvent({ sequence: 1, type: "run.started" }),
    streamEvent({
      sequence: 2,
      type: "model.reasoning.delta",
      delta: "first",
      modelCallRefs: ["model-reasoning"],
    }),
    streamEvent({
      sequence: 3,
      type: "model.reasoning.delta",
      delta: " step",
      modelCallRefs: ["model-reasoning"],
    }),
    streamEvent({
      sequence: 4,
      type: "model.reasoning.completed",
      summary: "思考完成。",
      modelCallRefs: ["model-reasoning"],
    }),
    streamEvent({ sequence: 5, type: "final.result", summary: "结果已生成。" }),
  ]);
  const thinking = nodes.find((node) => node.kind === "thinking");

  assert.equal(thinking?.phase, "completed");
  assert.equal(thinking?.eventType, "model.reasoning.completed");
  assert.equal(thinking?.text, "first step");
  assert.equal(thinking?.summary, "first step");
});

test("panel transcript nodes complete live reasoning after interleaved output", () => {
  const nodes = createPanelTranscriptNodes([
    streamEvent({
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "first",
      modelCallRefs: ["model-interleaved"],
    }),
    streamEvent({
      sequence: 2,
      type: "model.output.delta",
      delta: "answer",
      modelCallRefs: ["model-interleaved"],
    }),
    streamEvent({
      sequence: 3,
      type: "model.reasoning.completed",
      summary: "思考完成。",
      modelCallRefs: ["model-interleaved"],
    }),
    streamEvent({
      sequence: 4,
      type: "model.output.completed",
      summary: "回答完成。",
      modelCallRefs: ["model-interleaved"],
    }),
  ]);
  const thinking = nodes.filter((node) => node.kind === "thinking" && node.eventType?.startsWith("model.reasoning"));

  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.phase, "completed");
  assert.equal(thinking[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking[0]?.text, "first");
});

test("panel transcript nodes settle reasoning when the model turn ends without explicit completion", () => {
  const nodes = createPanelTranscriptNodes([
    streamEvent({
      sequence: 1,
      type: "model.reasoning.delta",
      delta: "first",
      modelCallRefs: ["model-no-completion"],
    }),
    streamEvent({
      sequence: 2,
      type: "model.output.delta",
      delta: "answer",
      modelCallRefs: ["model-no-completion"],
    }),
    streamEvent({
      sequence: 3,
      type: "model.output.completed",
      summary: "回答完成。",
      modelCallRefs: ["model-no-completion"],
    }),
    streamEvent({ sequence: 4, type: "final.result", summary: "结果已生成。" }),
  ]);
  const thinking = nodes.filter((node) => node.kind === "thinking" && node.eventType?.startsWith("model.reasoning"));

  assert.equal(thinking.length, 1);
  assert.equal(thinking[0]?.phase, "completed");
  assert.equal(thinking[0]?.eventType, "model.reasoning.completed");
  assert.equal(thinking[0]?.text, "first");
});

test("ordinary agent stream stays quiet for direct answers while preserving tool work", () => {
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
        usage: {
          inputTokens: 40,
          outputTokens: 12,
          totalTokens: 52,
          latencyMs: 900,
          firstTokenLatencyMs: 240,
          outputDurationMs: 660,
          outputTokensPerSecond: 18.18,
        },
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
  const directAnswerNode = createPanelTranscriptNodes(direct).find((node) => node.kind === "answer");

  assert.deepEqual(direct.map((event) => event.type), ["run.started", "final.result"]);
  assert.equal(direct.at(-1)?.summary?.includes("Direct answer text."), true);
  assert.deepEqual(direct.at(-1)?.detail?.modelUsage, {
    inputTokens: 40,
    outputTokens: 12,
    totalTokens: 52,
    latencyMs: 900,
    firstTokenLatencyMs: 240,
    outputDurationMs: 660,
    outputTokensPerSecond: 18.18,
  });
  assert.deepEqual(directAnswerNode?.modelUsage, direct.at(-1)?.detail?.modelUsage);
  assert.equal(withTool.some((event) => event.type === "agent.note.delta"), false);
  assert.equal(withTool.some((event) => event.type === "tool.requested"), true);
  assert.equal(withTool.some((event) => event.type === "model.output.completed"), true);
  assert.equal(completedTool?.detail?.kind, "tool");
  assert.equal(completedTool?.detail?.display?.kind, "generic_tool_summary");
  assert.equal(withTool.find((event) => event.type === "tool.completed")?.detail?.display?.kind, "generic_tool_summary");
  assert.equal(completedTool?.detail?.preview?.includes("notes.md"), true);
  assert.equal(completedTool?.detail?.preview?.includes("文件正文只进入本轮工具上下文"), false);
  assert.equal(JSON.stringify(withTool).includes("RAW_TOOL_OUTPUT_SENTINEL"), false);
  assert.equal(JSON.stringify(withTool).includes("\"action\":\"read_file\""), false);
});

test("incremental panel stream projection consumes each source fact once and preserves full-projection order", () => {
  const projector = new IncrementalPanelRunStreamProjector();
  const bufferedEntries = [
    eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-incremental" } }),
    eventEntry({
      sequence: 2,
      type: "model.requested",
      payload: { requestId: "request-incremental", purpose: "desktop_chat" },
    }),
    modelCompletedEntry({
      sequence: 3,
      requestId: "request-incremental",
      purpose: "desktop_chat",
      contractId: "desktop.chat.answer.v1",
      decisionSummary: "Answer before visible tool work.",
    }),
  ];
  const toolEntry = eventEntry({
    sequence: 4,
    type: "tool.requested",
    payload: { callId: "tool-call-incremental", toolName: "read_file", input: { path: "README.md" } },
  });
  const base = {
    runId: "run-incremental",
    status: "running" as const,
    desktopMode: "agent" as const,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:04.000Z",
  };

  const first = projector.project({ ...base, eventEntries: bufferedEntries });
  const duplicate = projector.project({ ...base, eventEntries: bufferedEntries });
  const second = projector.project({ ...base, eventEntries: [toolEntry] });
  const duplicateTool = projector.project({ ...base, eventEntries: [toolEntry] });
  const full = createPanelRunStreamEvents({
    ...base,
    eventEntries: [...bufferedEntries, toolEntry],
  });

  assert.deepEqual(first.map((event) => event.type), ["run.started"]);
  assert.deepEqual(duplicate, []);
  assert.deepEqual(duplicateTool, []);
  assert.deepEqual(
    [...first, ...second].map((event) => [event.eventId, event.type, event.summary, event.delta]),
    full.map((event) => [event.eventId, event.type, event.summary, event.delta])
  );
  assert.equal(projector.lastSourceSequence, 4);
});

test("ordinary agent stream exposes sub-agent runs as user-visible tool activity", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-sub-agent-work",
    status: "running",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-sub-agent" } }),
      eventEntry({
        sequence: 2,
        type: "sub_agent.started",
        payload: {
          runId: "run-sub-agent-work",
          subRunId: "sub-run-review",
          subAgentId: "reviewer",
          subAgentName: "Reviewer",
          task: "检查当前工具链",
          timestamp: "2026-05-07T00:00:01.000Z",
        },
      }),
      eventEntry({
        sequence: 3,
        type: "sub_agent.completed",
        payload: {
          runId: "run-sub-agent-work",
          subRunId: "sub-run-review",
          subAgentId: "reviewer",
          subAgentName: "Reviewer",
          status: "completed",
          summary: "发现 SSE 白名单遗漏。",
          toolCalls: 1,
          modelRounds: 2,
          durationMs: 1200,
          timestamp: "2026-05-07T00:00:02.000Z",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });
  const completed = events.find((event) => event.type === "sub_agent.completed");
  const nodes = createPanelTranscriptNodes(events);

  assert.deepEqual(events.map((event) => event.type), ["run.started", "sub_agent.started", "sub_agent.completed"]);
  assert.equal(completed?.detail?.kind, "sub_agent");
  assert.equal(completed?.detail?.subAgentRunId, "sub-run-review");
  assert.equal(completed?.detail?.subAgentName, "Reviewer");
  assert.equal(completed?.detail?.subAgentModelRounds, 2);
  assert.equal(nodes.some((node) => node.kind === "sub_agent" && node.subAgentRunId === "sub-run-review"), true);
});

test("ordinary agent stream preserves typed model failures after tool work", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-tool-then-model-failure",
    status: "failed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-tool-failure" } }),
      eventEntry({
        sequence: 2,
        type: "tool.completed",
        payload: {
          callId: "tool-call-shell",
          toolName: "shell_command",
          input: { command: "python", args: ["hello_agent.py"] },
          output: {
            action: "shell_command",
            summary: "python hello_agent.py · exit 0",
            result: { command: "python", args: ["hello_agent.py"], exitCode: 0 },
          },
        },
      }),
      eventEntry({
        sequence: 3,
        type: "model.failed",
        payload: {
          requestId: "request-after-tool",
          failureKind: "provider_network",
          failureMessage: "fetch failed",
          retryable: true,
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });
  const modelFailure = events.find((event) => event.type === "model.failed");

  assert.equal(modelFailure?.status, "failed");
  assert.equal(modelFailure?.summary, "模型服务连接失败。");
  assert.equal(modelFailure?.detail?.kind, "thinking");
  assert.equal(modelFailure?.detail?.error, "模型服务连接失败。");
  assert.equal(events.some((event) => event.type === "agent.note.completed" && event.summary === "模型服务连接失败。"), false);
});

test("ordinary agent completed stream ignores compatibility payloads and does not invent answers", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-ordinary-legacy-output",
    status: "completed",
    desktopMode: "agent",
    summary: panelRunSummaryFixture(),
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-ordinary-legacy" } }),
      eventEntry({
        sequence: 2,
        type: "artifact.produced",
        payload: {
          artifactId: "legacy-report-artifact",
          summary: "Legacy deep report should stay out of ordinary completion copy.",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });
  const serialized = JSON.stringify(events);

  assert.deepEqual(events.map((event) => event.type), ["run.started"]);
  assert.equal(serialized.includes("已回答"), false);
  assert.equal(serialized.includes("运行完成"), false);
  assert.equal(serialized.includes("final.result"), false);
  assert.equal(serialized.includes("可执行方案"), false);
  assert.equal(serialized.includes("报告"), false);
  assert.equal(serialized.includes("legacy-report-artifact"), false);
  assert.equal(serialized.includes("direction_package"), false);
  assert.equal(serialized.includes("direction_handoff"), false);
});

test("ordinary agent stream ignores Agent Fabric events from compatibility payloads", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-ordinary-agent-fabric-legacy",
    status: "completed",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-ordinary-fabric" } }),
      eventEntry({
        sequence: 2,
        type: "agent.delegation.planned",
        payload: {
          decisionId: "delegation-legacy",
          childSpecIds: ["spec-rootlet-option"],
        },
      }),
      eventEntry({
        sequence: 3,
        type: "agent.child.started",
        payload: {
          childRunId: "child-run-legacy",
          agentSpec: {
            displayName: "Rootlet option",
          },
        },
      }),
      eventEntry({
        sequence: 4,
        type: "agent.parent_synthesis.completed",
        payload: {
          parentSynthesis: {
            decisionSummary: "Parent synthesis should stay out of ordinary stream.",
          },
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:04.000Z",
  });
  const serialized = JSON.stringify(events);

  assert.deepEqual(events.map((event) => event.type), ["run.started"]);
  assert.equal(serialized.includes("agent.delegation"), false);
  assert.equal(serialized.includes("agent.child"), false);
  assert.equal(serialized.includes("parent_synthesis"), false);
  assert.equal(serialized.includes("Rootlet"), false);
  assert.equal(serialized.includes("Parent synthesis"), false);
});

test("ordinary agent stream shows provider-visible reasoning outputs", () => {
  const withChatReasoning = createPanelRunStreamEvents({
    runId: "run-reasoning-chat",
    status: "completed",
    desktopMode: "agent",
    reasoningEffort: "high",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-reasoning" } }),
      eventEntry({
        sequence: 2,
        type: "model.requested",
        payload: { requestId: "request-reasoning", purpose: "desktop_agent" },
      }),
      modelCompletedEntry({
        sequence: 3,
        requestId: "request-reasoning",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "Final answer text.",
        reasoningContent: "先拆解用户目标，再确认应该直接给出答案。",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });

  const withSummaryReasoning = createPanelRunStreamEvents({
    runId: "run-reasoning-summary",
    status: "completed",
    desktopMode: "agent",
    reasoningEffort: "high",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-summary" } }),
      eventEntry({
        sequence: 2,
        type: "model.requested",
        payload: { requestId: "request-summary", purpose: "desktop_agent" },
      }),
      modelCompletedEntry({
        sequence: 3,
        requestId: "request-summary",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "Final answer text.",
        reasoningSummary: "先拆解需求，再说明范围与限制。",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });

  const serializedChat = JSON.stringify(withChatReasoning);
  const serializedSummary = JSON.stringify(withSummaryReasoning);

  assert.equal(withChatReasoning.some((event) => event.type === "agent.note.delta" && event.summary?.includes("深入思考") === true), false);
  assert.equal(withChatReasoning.some((event) => event.type === "model.reasoning.delta"), true);
  assert.equal(withChatReasoning.some((event) => event.type === "model.reasoning.completed"), true);
  assert.equal(serializedChat.includes("先拆解用户目标"), true);
  assert.equal(serializedChat.includes("思考强度"), false);
  assert.equal(serializedChat.includes("模型思考内容已展示"), false);

  assert.equal(withSummaryReasoning.some((event) => event.type === "model.reasoning.delta"), true);
  assert.equal(withSummaryReasoning.some((event) => event.type === "model.reasoning.completed"), true);
  assert.equal(serializedSummary.includes("先拆解需求"), true);
  assert.equal(serializedSummary.includes("raw provider response"), false);
});

test("ordinary agent stream does not fake reasoning when only effort is selected", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-no-provider-reasoning",
    status: "completed",
    desktopMode: "agent",
    reasoningEffort: "high",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-no-provider-reasoning" } }),
      eventEntry({
        sequence: 2,
        type: "model.requested",
        payload: { requestId: "request-no-provider-reasoning", purpose: "desktop_agent" },
      }),
      modelCompletedEntry({
        sequence: 3,
        requestId: "request-no-provider-reasoning",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "Final answer text.",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });
  const serialized = JSON.stringify(events);

  assert.deepEqual(events.map((event) => event.type), ["run.started", "final.result"]);
  assert.equal(serialized.includes("思考强度"), false);
  assert.equal(serialized.includes("深入思考"), false);
  assert.equal(serialized.includes("model.reasoning"), false);
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
        type: "model.requested",
        payload: {
          requestId: "model-request-compaction",
          purpose: "desktop_context_compaction",
        },
      }),
      modelCompletedEntry({
        sequence: 3,
        requestId: "model-request-compaction",
        purpose: "desktop_context_compaction",
        contractId: "desktop.context_compaction.v1",
        decisionSummary: [
          "## Goal",
          "Continue safely.",
          "## Constraints & Preferences",
          "Do not show this internal continuation prompt to the user.",
          "## Progress",
        ].join("\n"),
      }),
      eventEntry({
        sequence: 4,
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
  const requested = events.find((event) => event.type === "context.compaction.requested");
  const compaction = events.find((event) => event.type === "context.compaction.completed");
  const serialized = JSON.stringify(events);

  assert.equal(requested?.agentLabel, "上下文");
  assert.equal(requested?.summary, "正在压缩较早上下文…");
  assert.equal(requested?.status, "running");
  assert.equal(compaction?.agentLabel, "上下文");
  assert.equal(compaction?.summary, "已整理 18 条较早上下文，后续继续当前任务。");
  assert.equal(compaction?.detail?.preview, undefined);
  assert.deepEqual(compaction?.modelCallRefs, ["model-request-compaction", "model-response-compaction"]);
  assert.equal(events.some((event) => event.type === "model.output.delta"), false);
  assert.equal(events.some((event) => event.type === "model.output.completed"), false);
  assert.equal(ordinaryVisibleProjectionIncludes(events, "## Goal"), false);
  assert.equal(ordinaryVisibleProjectionIncludes(events, "Constraints & Preferences"), false);
  assert.equal(ordinaryVisibleProjectionIncludes(events, "tokens"), false);
  assert.equal(ordinaryVisibleProjectionIncludes(events, "18 条较早上下文"), true);
  assert.equal(serialized.includes("raw prompt"), false);
  assert.equal(serialized.includes("raw tool output"), false);
});

test("ordinary agent stream keeps compaction failure visible with the pause reason", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-context-compaction-failed",
    status: "blocked",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-context-failed" } }),
      eventEntry({
        sequence: 2,
        type: "context.compaction.failed",
        payload: {
          goalId: "goal-context-failed",
          tokenCount: 92_000,
          threshold: 80_000,
          requestId: "model-request-compaction",
          responseId: "model-response-compaction",
          summary: "上下文达到 92000/80000 tokens，但压缩没有成功。",
          error: "Context compaction returned an empty continuation prompt.",
        },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });
  const compaction = events.find((event) => event.type === "context.compaction.failed");

  assert.equal(compaction?.agentLabel, "上下文");
  assert.equal(compaction?.summary, "上下文整理失败，任务已暂停。Context compaction returned an empty continuation prompt.");
  assert.equal(compaction?.detail?.preview, "Context compaction returned an empty continuation prompt.");
  assert.deepEqual(compaction?.modelCallRefs, ["model-request-compaction", "model-response-compaction"]);
  assert.equal(ordinaryVisibleProjectionIncludes(events, "任务已暂停"), true);
  assert.equal(ordinaryVisibleProjectionIncludes(events, "empty continuation prompt"), true);
});

test("ordinary agent stream turns tool-call visible text into body output before tool work", () => {
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
  const nodes = createPanelTranscriptNodes(events);

  assert.equal(events.some((event) => event.type === "model.output.delta"), true);
  assert.equal(events.some((event) => event.type === "model.output.completed"), true);
  assert.equal(events.some((event) => event.type === "model.side.completed"), false);
  assert.equal(events.some((event) => event.type === "tool.requested"), true);
  const bodyText = events
    .filter((event) => event.type === "model.output.delta")
    .map((event) => event.delta ?? "")
    .join("");
  assert.equal(bodyText.includes("我还没有主动完成"), true);
  assert.deepEqual(
    nodes.map((node) => `${node.kind}:${node.eventType}`),
    ["body:model.output.completed", "tool:tool.requested", "system:run.blocked"],
  );
  const blockedSummary = events.find((event) => event.type === "run.blocked")?.summary ?? "";
  assert.equal(blockedSummary.includes("任务没有完成"), true);
  assert.equal(blockedSummary.includes("轮次"), false);
  assert.equal(blockedSummary.includes("调用次数"), false);
  assert.equal(blockedSummary.includes("上限"), false);
  assert.equal(serialized.includes("loop"), false);
  assert.equal(serialized.includes("provider"), false);
  assert.equal(serialized.includes("raw prompt"), false);
  assert.equal(serialized.includes("fuel"), false);
  assertOrdinaryStreamHasNoInternalTerms(events.map(ordinaryEventVisibleText).join("\n"));
});

test("ordinary agent stream keeps tool-call visible text even if no tool event is recorded yet", () => {
  const events = createPanelRunStreamEvents({
    runId: "run-tool-call-without-tool-event",
    status: "blocked",
    desktopMode: "agent",
    error: {
      code: "out_of_fuel",
      message: "当前任务没有完成。",
    },
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-tool-call-without-tool-event" } }),
      modelCompletedEntry({
        sequence: 2,
        requestId: "request-tool-call-without-tool-event",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "我先说明需要读取额外材料。",
        finishReason: "tool_call",
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["run.started", "model.output.delta", "model.output.completed", "run.blocked"],
  );
});

test("ordinary agent terminal stream events follow recorded runtime facts", () => {
  const blocked = createPanelRunStreamEvents({
    runId: "run-terminal-blocked",
    status: "blocked",
    desktopMode: "agent",
    error: {
      code: "out_of_fuel",
      message: "当前轮次已到上限，任务没有完成。",
    },
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-terminal-blocked" } }),
      modelCompletedEntry({
        sequence: 2,
        requestId: "request-terminal-blocked",
        contractId: "desktop.agent_response.v1",
        decisionSummary: "需要继续读取额外材料。",
        finishReason: "tool_call",
      }),
      eventEntry({
        sequence: 3,
        type: "tool.requested",
        payload: { callId: "tool-call-terminal-read", toolName: "read_file", input: { path: "extra.md" } },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:03.000Z",
  });
  const cancelled = createPanelRunStreamEvents({
    runId: "run-terminal-cancelled",
    status: "cancelled",
    desktopMode: "agent",
    eventEntries: [
      eventEntry({ sequence: 1, type: "goal.received", payload: { goalId: "goal-terminal-cancelled" } }),
      eventEntry({
        sequence: 2,
        type: "tool.requested",
        payload: { callId: "tool-call-terminal-shell", toolName: "shell_command", input: { command: "pnpm" } },
      }),
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
  });

  assert.deepEqual(
    blocked.map((event) => event.type),
    ["run.started", "model.output.delta", "model.output.completed", "tool.requested", "run.blocked"],
  );
  assert.equal(blocked.at(-1)?.status, "blocked");
  assert.deepEqual(
    cancelled.map((event) => event.type),
    ["run.started", "tool.requested", "run.cancelled"],
  );
  assert.equal(cancelled.at(-1)?.status, "cancelled");
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
  const completedNode = transcript.transcriptNodes.find((node) => node.eventType === "tool.completed");

  assert.equal(completedTool?.detail?.display?.kind, "command_summary");
  assert.equal(completedTool?.toolCallRefs.includes("tool-call-shell"), true);
  assert.equal(JSON.stringify(transcript).includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(completedNode?.display?.kind, "command_summary");
  assert.equal(completedNode?.summary?.includes("tests passed"), true);
  assert.equal(completedNode?.summary?.includes("exit 0"), true);
  assert.equal(JSON.stringify(transcript.transcriptNodes).includes("RAW_STDOUT_SENTINEL"), false);
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

  assert.equal(completedTool?.detail?.preview?.includes("32 -> 18 chars"), false);
  assert.equal(completedTool?.detail?.preview?.includes("替换：1 处"), false);
  assert.equal(completedTool?.detail?.preview?.includes("notes.md"), true);
  assert.equal(serialized.includes("RAW_OLD_TEXT_SENTINEL"), false);
  assert.equal(serialized.includes("RAW_NEW_TEXT_SENTINEL"), false);
  assert.equal(serialized.includes("sk-edit-secret"), false);
});

test("panel transcript nodes do not invent thinking and keep failed tool results separate", () => {
  const nodes = createPanelTranscriptNodes([
    streamEvent({ sequence: 1, type: "run.started" }),
    streamEvent({ sequence: 2, type: "agent.note.delta", summary: "等待模型输出。" }),
    streamEvent({ sequence: 3, type: "agent.note.delta", summary: "Intelligence Channel requested model output." }),
    streamEvent({
      sequence: 4,
      type: "tool.requested",
      toolName: "shell_command",
      summary: "开始运行 pnpm test",
      toolCallRefs: ["tool-call-shell"],
      detail: {
        kind: "tool",
        action: "运行命令",
        display: { kind: "command_summary", command: "pnpm", args: ["test"] },
      },
    }),
    streamEvent({ sequence: 5, type: "agent.note.completed", summary: "助手已选择使用工具，工具结果会进入后续处理。" }),
    streamEvent({
      sequence: 6,
      type: "tool.failed",
      toolName: "shell_command",
      summary: "pnpm test 未完成 · exit 1",
      toolCallRefs: ["tool-call-shell"],
      detail: {
        kind: "tool",
        action: "运行命令",
        display: {
          kind: "command_summary",
          command: "pnpm",
          args: ["test"],
          exitCode: 1,
          errorSummary: "tests failed",
        },
      },
    }),
    streamEvent({ sequence: 7, type: "final.result", summary: "根据工具结果说明失败原因。" }),
  ]);

  assert.deepEqual(
    nodes.map((node) => `${node.eventType}:${node.phase}`),
    ["tool.requested:executing", "tool.failed:failed", "final.result:completed"],
  );
  assert.equal(nodes.some((node) => node.kind === "thinking"), false);
  assert.equal(nodes[1]?.title.includes("未完成"), true);
  assert.equal(nodes[1]?.summary, "pnpm test · exit 1 · tests failed");
  assert.equal(ordinaryVisibleProjectionIncludes(nodes, "exit 1"), true);
  assert.equal(nodes[1]?.display?.kind, "command_summary");
});

type PanelStreamEventForTest = Parameters<typeof createPanelTranscriptNodes>[0][number];

function streamEvent(
  input: Pick<PanelStreamEventForTest, "sequence" | "type"> & Partial<Omit<PanelStreamEventForTest, "sequence" | "type">>
): PanelStreamEventForTest {
  return {
    eventId: input.eventId ?? `run-transcript-nodes:event:${input.sequence}:${input.type}`,
    runId: input.runId ?? "run-transcript-nodes",
    sequence: input.sequence,
    type: input.type,
    createdAt: input.createdAt ?? `2026-05-07T00:00:${String(input.sequence).padStart(2, "0")}.000Z`,
    agentLabel: input.agentLabel,
    summary: input.summary,
    delta: input.delta,
    status: input.status,
    toolName: input.toolName,
    detail: input.detail,
    sourceRefs: input.sourceRefs ?? [],
    modelCallRefs: input.modelCallRefs ?? [],
    toolCallRefs: input.toolCallRefs ?? [],
  };
}

function modelCompletedEntry(input: {
  readonly sequence: number;
  readonly requestId: string;
  readonly purpose?: string;
  readonly contractId: string;
  readonly decisionSummary: string;
  readonly finishReason?: "stop" | "length" | "tool_call" | "content_filter" | "error";
  readonly reasoningContent?: string;
  readonly reasoningSummary?: string;
  readonly usage?: Record<string, unknown>;
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
      purpose: input.purpose ?? "test-purpose",
      outputContract: { contractId: input.contractId },
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "fake-model",
      finishReason: input.finishReason ?? "stop",
      outputKind: "explanation",
      validationStatus: "passed",
      visibleOutput: visibleOutput(input.contractId, input.decisionSummary),
      usage: input.usage,
      reasoningOutput:
        input.reasoningSummary === undefined && input.reasoningContent === undefined
          ? undefined
          : {
              source: input.reasoningSummary === undefined
                ? "openai_chat_reasoning_content"
                : "openai_responses_reasoning_summary",
              content: input.reasoningSummary ?? input.reasoningContent ?? "",
              truncated: false,
            },
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

function panelRunSummaryFixture(): PanelRunSummary {
  return {
    terminalStatus: "approved_package_created",
    directionPackage: {
      id: "legacy-direction-package",
      directionId: "legacy-direction",
      version: 1,
      status: "approved",
      validation: {
        passed: true,
        errors: [],
        warnings: [],
      },
    },
    lineage: {
      current: {
        packageId: "legacy-direction-package",
        directionId: "legacy-direction",
        version: 1,
        status: "approved",
        schemaVersion: "direction-handoff-package/v0.2",
      },
      revisionReason: "initial",
      sourceRefs: ["candidate:legacy"],
      createdAt: "2026-05-07T00:00:00.000Z",
    },
    versions: [1],
    ai: {
      enabled: false,
      mode: "none",
      status: "disabled",
      eventCounts: {
        requested: 0,
        completed: 0,
        failed: 0,
      },
      aiCandidateCount: 0,
      fallbackCount: 0,
      aiFallbackUsed: false,
      rootletKinds: [],
      modelCallRefs: [],
    },
    tools: {
      eventCounts: {
        requested: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      toolCallRefs: [],
    },
    underground: {
      autonomy: {
        enabled: false,
        cycleCount: 0,
        spawnedRootletCount: 0,
        sourceRefs: [],
        modelCallRefs: [],
      },
      rootletKinds: [],
      budget: {
        maxRootletClusters: 0,
        maxCandidateOutputs: 0,
        spentRootletClusters: 0,
        spentCandidateOutputs: 0,
        exhausted: false,
      },
      candidateCounts: {
        total: 0,
        candidate: 0,
        accepted: 0,
        merged: 0,
        rejected: 0,
        unknown: 0,
      },
      convergence: {
        reviewId: "legacy-review",
        outcome: "approved",
        accepted: 0,
        merged: 0,
        rejected: 0,
        unknown: 0,
        userEscalationRequired: false,
      },
    },
    observationSnapshot: {
      phase: "completed",
      stage: "direction_handoff_completed",
      eventCursor: {
        eventCount: 2,
        lastSequence: 2,
        lastEventType: "artifact.produced",
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
    eventLog: ["artifact.produced"],
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

function assertOrdinaryStreamHasNoInternalTerms(text: string): void {
  for (const term of [
    "Rootlet",
    "rootlet",
    "direction_handoff",
    "Task Soil",
    "Plan Package",
    "Observation Panel",
    "Agent Run Tree",
    "Convergence Judge",
    "地下认知运行时",
    "父层",
    "自治中枢",
    "候选池",
    "兼容运行",
    "异常保护",
  ]) {
    assert.equal(text.includes(term), false, `ordinary stream should not include ${term}`);
  }
}

function ordinaryEventVisibleText(event: { readonly agentLabel?: string; readonly summary?: string; readonly delta?: string; readonly detail?: unknown }): string {
  const detail = typeof event.detail === "object" && event.detail !== null ? event.detail as { readonly action?: string; readonly preview?: string; readonly error?: string } : {};
  return [event.agentLabel, event.summary, event.delta, detail.action, detail.preview, detail.error]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function ordinaryVisibleProjectionIncludes(
  values: readonly { readonly title?: string; readonly agentLabel?: string; readonly summary?: string; readonly delta?: string; readonly detail?: unknown }[],
  text: string
): boolean {
  return values.some((value) => {
    const detail = typeof value.detail === "object" && value.detail !== null
      ? value.detail as { readonly action?: string; readonly preview?: string; readonly error?: string }
      : {};
    return [value.title, value.agentLabel, value.summary, value.delta, detail.action, detail.preview, detail.error]
      .some((candidate) => typeof candidate === "string" && candidate.includes(text));
  });
}
