import assert from "node:assert/strict";
import test from "node:test";
import type { ArborMessage, ArborMessageType } from "../domain/common.js";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import type { EventLogEntry } from "../kernel/events/in-memory-event-log.js";
import { createPanelRunStreamEvents } from "./panel-run-stream-events.js";
import { createPanelRunTranscript } from "./panel-run-transcript.js";
import { createPanelTranscriptNodes } from "./panel-transcript-nodes.js";

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
  assertOrdinaryStreamHasNoInternalTerms(transcript.events.map(ordinaryEventVisibleText).join("\n"));
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
      summary: "已确认，继续执行。",
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
      "run.resumed:approved",
      "tool.requested:executing",
      "tool.completed:completed",
      "model.reasoning.completed:completed",
      "final.result:completed",
    ],
  );
  assert.equal(nodes[0]?.title.includes("准备"), true);
  assert.equal(nodes[3]?.title, "运行命令");
  assert.equal(nodes[5]?.sequence > nodes[4]!.sequence, true);
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
      delta: "to",
      modelCallRefs: ["model-before-tool"],
    }),
    streamEvent({
      sequence: 4,
      type: "model.reasoning.delta",
      delta: "understand",
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
      delta: "summarize",
      modelCallRefs: ["model-after-tool"],
    }),
    streamEvent({ sequence: 9, type: "final.result", summary: "结果已生成。" }),
  ]);

  assert.deepEqual(
    nodes.map((node) => `${node.kind}:${node.eventType}:${node.phase}:${node.summary}`),
    [
      "thinking:model.reasoning.completed:completed:filestounderstand",
      "tool:tool.requested:executing:workspace",
      "tool:tool.completed:completed:3 个文件",
      "thinking:model.reasoning.completed:completed:thensummarize",
      "answer:final.result:completed:结果已生成。",
    ],
  );
  assert.equal(nodes[0]?.text, "filestounderstand");
  assert.equal(nodes[3]?.text, "thensummarize");
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
      delta: "step",
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
  assert.equal(thinking?.text, "firststep");
  assert.equal(thinking?.summary, "firststep");
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
  assert.equal(events.some((event) => event.type === "model.side.completed"), true);
  assert.equal(events.some((event) => event.type === "tool.requested"), true);
  const sideSummary = events.find((event) => event.type === "model.side.completed")?.summary ?? "";
  assert.equal(sideSummary.includes("我还没有主动完成"), true);
  const blockedSummary = events.find((event) => event.type === "run.blocked")?.summary ?? "";
  assert.equal(blockedSummary.includes("任务没有完成"), true);
  assert.equal(blockedSummary.includes("轮次"), true);
  assert.equal(blockedSummary.includes("上限"), true);
  assert.equal(serialized.includes("loop"), false);
  assert.equal(serialized.includes("provider"), false);
  assert.equal(serialized.includes("raw prompt"), false);
  assert.equal(serialized.includes("fuel"), false);
  assertOrdinaryStreamHasNoInternalTerms(events.map(ordinaryEventVisibleText).join("\n"));
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
  const completedNode = transcript.transcriptNodes.find((node) => node.eventType === "tool.completed");

  assert.equal(completedTool?.detail?.display?.kind, "command_summary");
  assert.equal(completedTool?.detail?.envelope?.uiDisplay?.kind, "command_summary");
  assert.equal(completedTool?.detail?.envelope?.evidenceRefs.includes("tool:tool-call-shell"), true);
  assert.equal(JSON.stringify(transcript).includes("RAW_STDOUT_SENTINEL"), false);
  assert.equal(completedNode?.display?.kind, "command_summary");
  assert.equal(completedNode?.summary?.includes("tests passed"), true);
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

  assert.equal(completedTool?.detail?.preview?.includes("长度：32 -> 18 chars"), true);
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
    streamEvent({ sequence: 5, type: "agent.note.completed", summary: "助手已选择使用工具，工具结果会作为安全摘要进入后续处理。" }),
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
    streamEvent({ sequence: 7, type: "final.result", summary: "根据安全摘要说明失败原因。" }),
  ]);

  assert.deepEqual(
    nodes.map((node) => `${node.eventType}:${node.phase}`),
    ["tool.requested:executing", "tool.failed:failed", "final.result:completed"],
  );
  assert.equal(nodes.some((node) => node.kind === "thinking"), false);
  assert.equal(nodes[1]?.title.includes("未完成"), true);
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
  readonly contractId: string;
  readonly decisionSummary: string;
  readonly finishReason?: "stop" | "length" | "tool_call" | "content_filter" | "error";
  readonly reasoningContent?: string;
  readonly reasoningSummary?: string;
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
