import assert from "node:assert/strict";
import test from "node:test";
import { projectAssistantMessageStructure } from "./panel-assistant-message-structure.js";
import type { AssistantSubAgentRunLike } from "./panel-assistant-message-output.js";
import type { ProjectableTranscriptNode } from "./panel-read-model/transcript/panel-transcript-node-projection.js";

test("assistant message structure keeps leading activity before the first visible body", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断下一步。",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "第一段正文。",
      }),
      node({
        nodeId: "tool-1",
        sequence: 3,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "README.md",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.equal(structure.segments[0]?.kind, "activity");
  assert.deepEqual(structure.segments[0]?.kind === "activity" ? structure.segments[0].timeline.items.map((item) => item.nodeId) : [], ["thinking-1"]);
  assert.equal(structure.segments[1]?.kind, "body");
  assert.equal(structure.segments[1]?.kind === "body" ? structure.segments[1].text : undefined, "第一段正文。");
});

test("assistant message structure uses merged activity nodes instead of stale raw duplicates", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "The user is asking me to demonstrate capabilities.",
        refs: [{ kind: "model_call", id: "model-1" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities.",
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate capabilities and inspect the workspace.",
        refs: [{ kind: "model_call", id: "model-1" }],
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.equal(structure.segments[0]?.kind, "activity");
  const activity = structure.segments[0]?.kind === "activity" ? structure.segments[0] : undefined;
  assert.equal(activity?.timeline.items.length, 1);
  assert.equal(activity?.timeline.items[0]?.nodeId, "thinking-live");
  assert.equal(
    activity?.timeline.items[0]?.copy.detail,
    "思考中",
  );
  assert.equal(
    activity?.timeline.items[0]?.copy.expandedDetail,
    "The user is asking me to demonstrate capabilities and inspect the workspace.",
  );
});

test("assistant message structure keeps repeated thinking from splitting the workflow after body", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-1" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities by exploring the workspace.",
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "latest AI agent development trends 2025",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.deepEqual(
    structure.segments[0]?.kind === "activity"
      ? structure.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["thinking-live"],
  );
  assert.deepEqual(
    structure.segments[2]?.kind === "activity"
      ? structure.segments[2].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
});

test("assistant message structure removes repeated thinking inside one post-body activity segment", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities by exploring the workspace.",
      }),
      node({
        nodeId: "thinking-live",
        sequence: 2,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-live" }],
      }),
      node({
        nodeId: "thinking-settled",
        sequence: 3,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "latest AI agent development trends 2025",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["body", "activity"]);
  const activity = structure.segments[1]?.kind === "activity" ? structure.segments[1] : undefined;
  assert.deepEqual(activity?.timeline.items.map((item) => item.nodeId), ["thinking-live", "tool-1"]);
  assert.deepEqual(activity?.timeline.items.map((item) => item.copy.detail), [
    "思考中",
    "latest AI agent development trends 2025",
  ]);
  assert.equal(
    activity?.timeline.items[0]?.copy.expandedDetail,
    "The user is asking me to demonstrate my capabilities.",
  );
});

test("assistant message structure removes repeated narration from the same cold projection", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-live",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-live" }],
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "Let me showcase my capabilities by exploring the workspace.",
      }),
      node({
        nodeId: "side-settled",
        sequence: 3,
        kind: "system",
        eventType: "model.side.completed",
        phase: "completed",
        text: "The user is asking me to demonstrate my capabilities.",
        summary: "The user is asking me to demonstrate my capabilities.",
        refs: [{ kind: "model_call", id: "model-settled" }],
      }),
      node({
        nodeId: "tool-1",
        sequence: 4,
        kind: "tool",
        eventType: "tool.completed",
        phase: "completed",
        summary: "latest AI agent development trends 2025",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body", "activity"]);
  assert.deepEqual(
    structure.segments[0]?.kind === "activity"
      ? structure.segments[0].timeline.items.map((item) => item.nodeId)
      : [],
    ["thinking-live"],
  );
  assert.deepEqual(
    structure.segments[2]?.kind === "activity"
      ? structure.segments[2].timeline.items.map((item) => item.nodeId)
      : [],
    ["tool-1"],
  );
});

test("assistant message structure exposes segment lifecycle", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "thinking-open",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.delta",
        phase: "noted",
        text: "正在判断下一步。",
      }),
      node({
        nodeId: "body-live",
        sequence: 2,
        kind: "body",
        eventType: "model.output.delta",
        phase: "noted",
        text: "正在输出正文",
      }),
      node({
        nodeId: "tool-failed",
        sequence: 3,
        kind: "tool",
        eventType: "tool.failed",
        phase: "failed",
        summary: "pnpm test",
      }),
    ],
  });

  assert.deepEqual(
    structure.segments.map((segment) => segment.kind === "activity" ? segment.lifecycle : segment.lifecycle),
    ["open", "open", "attention"],
  );
});

test("assistant message structure keeps model usage on the matching answer body", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "body-1",
        sequence: 1,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "最终回答。",
        modelUsage: {
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
          latencyMs: 1_500,
          firstTokenLatencyMs: 300,
          outputDurationMs: 1_200,
          outputTokensPerSecond: 20.83,
        },
      }),
    ],
  });

  const body = structure.segments.find((segment) => segment.kind === "body");
  assert.deepEqual(body?.kind === "body" ? body.modelUsage : undefined, {
    inputTokens: 100,
    outputTokens: 25,
    totalTokens: 125,
    latencyMs: 1_500,
    firstTokenLatencyMs: 300,
    outputDurationMs: 1_200,
    outputTokensPerSecond: 20.83,
  });
});

test("assistant message structure applies final-result model usage to fallback answer bodies", () => {
  const structure = projectAssistantMessageStructure({
    fallbackText: "直接回答。",
    transcriptNodes: [
      node({
        nodeId: "answer-1",
        sequence: 1,
        kind: "answer",
        eventType: "final.result",
        phase: "completed",
        summary: "直接回答。",
        modelUsage: {
          inputTokens: 12,
          outputTokens: 6,
          totalTokens: 18,
          latencyMs: 800,
        },
      }),
    ],
  });

  const body = structure.segments.find((segment) => segment.kind === "body");
  assert.deepEqual(body?.kind === "body" ? body.modelUsage : undefined, {
    inputTokens: 12,
    outputTokens: 6,
    totalTokens: 18,
    latencyMs: 800,
  });
});

test("assistant message structure merges fallback answer into the latest body when the copy overlaps", () => {
  const structure = projectAssistantMessageStructure({
    fallbackText: "最终回答",
    transcriptNodes: [
      node({
        nodeId: "thinking-1",
        sequence: 1,
        kind: "thinking",
        eventType: "model.reasoning.completed",
        phase: "completed",
        text: "先判断下一步。",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "最终",
      }),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.equal(structure.segments[1]?.kind, "body");
  assert.equal(structure.segments[1]?.kind === "body" ? structure.segments[1].text : undefined, "最终回答");
  assert.equal(structure.copyText, "最终回答");
});

test("assistant message structure suppresses speculative fallback body while a live turn has not emitted a body node", () => {
  const structure = projectAssistantMessageStructure({
    fallbackText: "这是预览正文",
    keepStreamMounted: true,
    transcriptNodes: [],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["awaiting"]);
  assert.equal(structure.awaitingFirstVisibleOutput, true);
});

test("assistant message structure suppresses body that only echoes a sub-agent result", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "sub-agent-1",
        sequence: 1,
        kind: "sub_agent",
        eventType: "sub_agent.completed",
        phase: "completed",
        summary: "作为 research-expert，我可以协助用户完成以下工作：技术调研与信息梳理。",
        subAgentRunId: "sub-run-1",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "作为 research-expert，我可以协助用户完成以下工作：技术调研与信息梳理。",
      }),
    ],
    subAgentRuns: [
      subAgentRun("sub-run-1", "作为 research-expert，我可以协助用户完成以下工作：技术调研与信息梳理。"),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
  const activity = structure.segments[0];
  assert.equal(activity?.kind, "activity");
  assert.deepEqual(activity?.kind === "activity" ? activity.timeline.items.map((item) => item.variant) : [], ["sub_agent"]);
});

test("assistant message structure suppresses parent preface that only introduces a sub-agent result", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "sub-agent-1",
        sequence: 1,
        kind: "sub_agent",
        eventType: "sub_agent.completed",
        phase: "completed",
        summary: "主题：RAG 选型。洞察：1）数据质量比模型大小更影响答案可信度；2）召回策略决定上限；3）评测需看命中率、延迟、成本三者平衡。",
        subAgentRunId: "sub-run-1",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我刚刚派了一个子 Agent 做了个简短演示。子 agent 输出：主题：RAG 选型。洞察：1）数据质量比模型大小更影响答案可信度；2）召回策略决定上限；3）评测需看命中率、延迟、成本三者平衡。",
      }),
    ],
    subAgentRuns: [
      subAgentRun("sub-run-1", "主题：RAG 选型。洞察：1）数据质量比模型大小更影响答案可信度；2）召回策略决定上限；3）评测需看命中率、延迟、成本三者平衡。"),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
});

test("assistant message structure keeps parent summary body after sub-agent card", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "sub-agent-1",
        sequence: 1,
        kind: "sub_agent",
        eventType: "sub_agent.completed",
        phase: "completed",
        summary: "research-expert 已完成技术调研。",
        subAgentRunId: "sub-run-1",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "我已经汇总了 research-expert 的结果，下面给你一个更简洁的建议清单。",
      }),
    ],
    subAgentRuns: [
      subAgentRun("sub-run-1", "research-expert 已完成技术调研。"),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity", "body"]);
  assert.equal(structure.segments[1]?.kind, "body");
  assert.equal(
    structure.segments[1]?.kind === "body" ? structure.segments[1].text : undefined,
    "我已经汇总了 research-expert 的结果，下面给你一个更简洁的建议清单。",
  );
});

test("assistant message structure suppresses sub-agent echo using full output", () => {
  const fullOutput = "主题：长输出。结论：父 Agent 只是逐字复述这个完整结果，应当被折叠进子 Agent 活动。";
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "sub-agent-1",
        sequence: 1,
        kind: "sub_agent",
        eventType: "sub_agent.completed",
        phase: "completed",
        summary: "子 Agent 已完成，完整输出 40 字。",
        subAgentRunId: "sub-run-1",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: fullOutput,
      }),
    ],
    subAgentRuns: [
      subAgentRun("sub-run-1", "子 Agent 已完成，完整输出 40 字。", fullOutput),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
});

test("assistant message structure merges adjacent sub-agent activity segments for the same run", () => {
  const structure = projectAssistantMessageStructure({
    transcriptNodes: [
      node({
        nodeId: "sub-agent-started",
        sequence: 1,
        kind: "sub_agent",
        eventType: "sub_agent.started",
        phase: "executing",
        summary: "research-expert 开始处理。",
        subAgentRunId: "sub-run-1",
      }),
      node({
        nodeId: "body-1",
        sequence: 2,
        kind: "body",
        eventType: "model.output.completed",
        phase: "completed",
        text: "research-expert 开始处理。",
      }),
      node({
        nodeId: "sub-agent-completed",
        sequence: 3,
        kind: "sub_agent",
        eventType: "sub_agent.completed",
        phase: "completed",
        summary: "research-expert 已完成。",
        subAgentRunId: "sub-run-1",
      }),
    ],
    subAgentRuns: [
      subAgentRun("sub-run-1", "research-expert 已完成。"),
    ],
  });

  assert.deepEqual(structure.segments.map((segment) => segment.kind), ["activity"]);
  const activity = structure.segments[0];
  assert.equal(activity?.kind, "activity");
  assert.equal(activity?.kind === "activity" ? activity.timeline.items.length : 0, 1);
  assert.equal(activity?.kind === "activity" ? activity.timeline.items[0]?.subAgentRunId : undefined, "sub-run-1");
  assert.equal(activity?.kind === "activity" ? activity.timeline.items[0]?.phase : undefined, "completed");
});

function node(input: {
  readonly nodeId: string;
  readonly sequence: number;
  readonly kind: ProjectableTranscriptNode["kind"];
  readonly eventType: string;
  readonly phase: ProjectableTranscriptNode["phase"];
  readonly text?: string;
  readonly summary?: string;
  readonly refs?: ProjectableTranscriptNode["refs"];
  readonly modelUsage?: ProjectableTranscriptNode["modelUsage"];
  readonly subAgentRunId?: string;
  readonly subAgentBatchId?: string;
}): ProjectableTranscriptNode {
  return {
    nodeId: input.nodeId,
    runId: "run-1",
    sequence: input.sequence,
    eventType: input.eventType,
    kind: input.kind,
    phase: input.phase,
    title: input.kind,
    text: input.text,
    summary: input.summary,
    timestamp: "2026-06-18T00:00:00.000Z",
    modelUsage: input.modelUsage,
    subAgentRunId: input.subAgentRunId,
    subAgentBatchId: input.subAgentBatchId,
    refs: input.refs ?? [],
  };
}

function subAgentRun(subRunId: string, textOutput: string, fullOutput?: string): AssistantSubAgentRunLike {
  return {
    subRunId,
    subAgentName: "research-expert",
    status: "completed",
    summary: textOutput,
    fullOutput,
    modelExchanges: [{
      requestedAt: "2026-06-18T00:00:00.000Z",
      completedAt: "2026-06-18T00:00:02.000Z",
      textOutput,
    }],
  };
}
