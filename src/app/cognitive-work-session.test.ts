import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../domain/tools/index.js";
import { createId, nowIso } from "../kernel/id.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { pendingModelOutputValidation } from "../kernel/intelligence/validation.js";
import { runCognitiveWorkSession } from "./cognitive-work-session.js";

test("Cognitive Work Session fake AI completes with child delegation, parent synthesis, and report artifact", async () => {
  const result = await runCognitiveWorkSession("分析当前 AgentArbor 项目并产出优化方向报告", { aiMode: "fake" });
  const eventTypes = result.runtime.eventLog.types();

  assert.equal(result.status, "completed");
  assert.equal(result.finalArtifact?.ref.type, "report");
  assert.equal((result.report?.keyFindings.length ?? 0) > 0, true);
  assert.equal(result.agentRunTree.childRuns.length >= 1, true);
  assert.equal(result.agentRunTree.parentSyntheses.length, 1);
  assert.equal(eventTypes.includes("agent.delegation.planned"), true);
  assert.equal(eventTypes.includes("agent.child.completed"), true);
  assert.equal(eventTypes.includes("agent.parent_synthesis.completed"), true);
  assert.equal(eventTypes.includes("artifact.produced"), true);
  assert.equal(eventTypes.includes("underground.exploration_planned"), false);
  assert.equal(eventTypes.includes("direction_handoff.completed"), false);
  assert.deepEqual(result.steps.map((step) => step.action), ["spawn_children", "synthesize", "produce_artifact"]);
});

test("Cognitive Work Session answers lightweight questions directly without child delegation or report artifact", async () => {
  const result = await runCognitiveWorkSession("你是什么模型？", { aiMode: "fake" });
  const eventTypes = result.runtime.eventLog.types();

  assert.equal(result.status, "completed");
  assert.equal(result.directAnswer?.answer.includes("AgentArbor 桌面助手"), true);
  assert.equal(result.finalArtifact, undefined);
  assert.equal(result.report, undefined);
  assert.equal(result.agentRunTree.childRuns.length, 0);
  assert.equal(result.agentRunTree.parentSyntheses.length, 0);
  assert.deepEqual(result.steps.map((step) => step.action), ["direct_answer"]);
  assert.equal(eventTypes.includes("agent.delegation.planned"), false);
  assert.equal(eventTypes.includes("agent.child.completed"), false);
  assert.equal(eventTypes.includes("agent.parent_synthesis.completed"), false);
  assert.equal(eventTypes.includes("artifact.produced"), false);
});

test("Cognitive Work Session accepts natural language text for direct answers", async () => {
  const result = await runCognitiveWorkSession("你是什么模型？", {
    aiMode: "fake",
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        bus: runtime.bus,
        provider: new SequenceModelProvider([
          {
            action: "direct_answer",
            childSpecs: [],
            decisionSummary: "用户只需要一个直接回答。",
            uncertainty: "不需要工作区探索。",
            confidence: 0.82,
          },
          {
            textOutput:
              "我是 AgentArbor 桌面助手。底层模型取决于你在设置中配置的模型运行时；我不会把普通问题强行包装成项目分析报告。",
          },
        ]),
      }),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.directAnswer?.answer.includes("不会把普通问题强行包装成项目分析报告"), true);
  assert.equal(result.finalArtifact, undefined);
  assert.equal(result.report, undefined);
  assert.equal(result.agentRunTree.childRuns.length, 0);
  assert.deepEqual(result.steps.map((step) => step.action), ["direct_answer"]);
});

test("Cognitive Work Session does not let child output refs directly become final artifact source refs", async () => {
  const result = await runCognitiveWorkSession("检查 child output 是否绕过父层综合", { aiMode: "fake" });
  const childOutputRefs = new Set(result.agentRunTree.childRuns.flatMap((run) => run.outputRefs));
  const artifactEvent = result.runtime.eventLog.list().find((entry) => entry.type === "artifact.produced");
  const sourceRefs = Array.isArray((artifactEvent?.message.payload as { sourceRefs?: unknown }).sourceRefs)
    ? ((artifactEvent?.message.payload as { sourceRefs: unknown[] }).sourceRefs.filter((ref): ref is string => typeof ref === "string"))
    : [];

  assert.equal(result.agentRunTree.parentSyntheses.length, 1);
  assert.equal(sourceRefs.some((ref) => ref.startsWith("parent-synthesis:")), true);
  assert.equal(sourceRefs.some((ref) => childOutputRefs.has(ref)), false);
});

test("Cognitive Work Session aiMode none stops before model calls and final artifact", async () => {
  const result = await runCognitiveWorkSession("禁用 AI 时不能伪造成功报告", { aiMode: "none" });

  assert.equal(result.status, "stopped");
  assert.equal(result.finalArtifact, undefined);
  assert.equal(result.report, undefined);
  assert.equal(result.openQuestions.length, 1);
  assert.equal(result.runtime.eventLog.types().includes("model.requested"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Cognitive Work Session keeps child delegation bounded and filters unsafe tool grants", async () => {
  const result = await runCognitiveWorkSession("只允许一层安全 child agent", {
    aiMode: "fake",
    maxChildRuns: 1,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        bus: runtime.bus,
        provider: new SequenceModelProvider([
          {
            action: "spawn_children",
            childSpecs: [
              {
                specId: "unsafe-child",
                displayName: "Unsafe Child",
                role: "unsafe_child",
                objective: "Try to exceed the MVP boundary.",
                allowedTools: ["search", "write_files", "delete_files"],
                inputRefs: ["workspace:current"],
              },
              {
                specId: "second-child",
                displayName: "Second Child",
                role: "second_child",
                objective: "Should be cut by maxChildRuns.",
                allowedTools: ["read"],
                inputRefs: ["workspace:current"],
              },
            ],
            decisionSummary: "Spawn bounded children.",
            uncertainty: "This is a test fixture.",
            confidence: 0.8,
          },
          {
            summary: "Unsafe child produced bounded local material.",
            findings: ["Tool grants were filtered to safe read/search tools."],
            evidenceRefs: ["code:test"],
            uncertainty: "Low.",
            confidence: 0.7,
          },
          {
            action: "synthesize",
            childSpecs: [],
            decisionSummary: "Synthesize bounded child material.",
            uncertainty: "Fixture uncertainty.",
            confidence: 0.7,
          },
          {
            reportTitle: "Bounded work session report",
            keyFindings: ["Only one child run was executed."],
            recommendations: ["Keep recursive delegation disabled in MVP."],
            evidenceRefs: ["code:test"],
            uncertainty: ["None for fixture."],
            nextActions: ["Continue with bounded Work Session tests."],
            decisionSummary: "Parent synthesis completed.",
            confidence: 0.7,
          },
          {
            action: "produce_artifact",
            childSpecs: [],
            decisionSummary: "Produce the final bounded report.",
            uncertainty: "Fixture uncertainty.",
            confidence: 0.7,
          },
        ]),
      }),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.agentRunTree.childRuns.length, 1);
  assert.deepEqual(result.agentRunTree.childRuns[0]?.spec.permissions.allowedTools, ["search"]);
  assert.equal(result.agentRunTree.childRuns[0]?.spec.agentKind, "child");
});

test("Cognitive Work Session keeps child tool schemas out of user prompts", async () => {
  const provider = new SequenceModelProvider([
    {
      action: "spawn_children",
      childSpecs: [
        {
          specId: "prompt-child",
          displayName: "Prompt Child",
          role: "prompt_child",
          objective: "Inspect the child prompt boundary.",
          allowedTools: ["search", "read"],
          inputRefs: ["workspace:current"],
        },
      ],
      decisionSummary: "Spawn one child for prompt boundary inspection.",
      uncertainty: "Fixture uncertainty.",
      confidence: 0.8,
    },
    {
      summary: "Child inspected the prompt boundary.",
      findings: ["Tool schemas stayed on the request tools field."],
      evidenceRefs: ["code:test"],
      uncertainty: "Fixture child material.",
      confidence: 0.7,
    },
    {
      action: "synthesize",
      childSpecs: [],
      decisionSummary: "Synthesize child material.",
      uncertainty: "Fixture uncertainty.",
      confidence: 0.7,
    },
    {
      reportTitle: "Prompt boundary report",
      keyFindings: ["Child prompt did not list tools."],
      recommendations: ["Keep tool exposure in request tools."],
      evidenceRefs: ["code:test"],
      uncertainty: ["None for fixture."],
      nextActions: ["Keep the regression test."],
      decisionSummary: "Parent synthesis completed.",
      confidence: 0.7,
    },
    {
      action: "produce_artifact",
      childSpecs: [],
      decisionSummary: "Produce final report.",
      uncertainty: "Fixture uncertainty.",
      confidence: 0.74,
    },
  ]);
  const result = await runCognitiveWorkSession("检查 child 工具提示边界", {
    aiMode: "fake",
    createToolCenter: () => new FixtureToolCenter(),
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        bus: runtime.bus,
        provider,
      }),
  });
  const childRequest = provider.requests().find(
    (request) => request.outputContract.contractId === "work_session.child_material.v1"
  );
  const promptText = childRequest?.sanitizedMessages.map((message) => message.content).join("\n") ?? "";
  const allPromptText = provider.requests().flatMap((request) => request.sanitizedMessages).map((message) => message.content).join("\n");

  assert.equal(result.status, "completed");
  assert.notEqual(childRequest, undefined);
  assert.deepEqual(childRequest?.tools?.map((tool) => tool.name), ["search", "read"]);
  assert.equal(provider.requests().some((request) => request.tools !== undefined && request.tools.length > 0), true);
  assert.equal(allPromptText.includes("Allowed tools:"), false);
  assert.equal(promptText.includes("Allowed tools:"), false);
  assert.equal(promptText.includes("search, read"), false);
  assert.equal(promptText.includes("Fixture codebase search tool."), false);
  assert.equal(promptText.includes("Fixture codebase read tool."), false);
});

test("Cognitive Work Session can use tools before child delegation and preserve evidence refs", async () => {
  const toolCenter = new FixtureToolCenter();
  const result = await runCognitiveWorkSession("先读取当前仓库证据，再分析 AgentArbor 下一步", {
    aiMode: "fake",
    createToolCenter: () => toolCenter,
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        bus: runtime.bus,
        provider: new SequenceModelProvider([
          {
            toolCalls: [
              {
                callId: "call-search-work-session",
                toolName: "search",
                input: { query: "CognitiveWorkSessionRuntime", sources: ["codebase"] },
              },
            ],
          },
          {
            action: "use_tools",
            childSpecs: [],
            decisionSummary: "Read workspace evidence before deciding child delegation.",
            uncertainty: "Tool evidence still needs parent synthesis.",
            confidence: 0.72,
          },
          {
            action: "spawn_children",
            childSpecs: [
              {
                specId: "evidence-child",
                displayName: "Evidence Child",
                role: "evidence_child",
                objective: "Use gathered tool refs to inspect the work session runtime.",
                allowedTools: ["read"],
                inputRefs: ["tool-call:call-search-work-session", "research:codebase:work-session"],
              },
            ],
            decisionSummary: "Spawn a child after gathering workspace evidence.",
            uncertainty: "Fixture uncertainty.",
            confidence: 0.74,
          },
          {
            summary: "Evidence child reviewed the gathered tool ref.",
            findings: ["Tool refs were retained as evidence and still required parent synthesis."],
            evidenceRefs: ["research:codebase:work-session"],
            uncertainty: "Fixture child material.",
            confidence: 0.71,
          },
          {
            action: "synthesize",
            childSpecs: [],
            decisionSummary: "Synthesize tool-backed child material.",
            uncertainty: "Fixture uncertainty.",
            confidence: 0.72,
          },
          {
            reportTitle: "Tool-backed Work Session report",
            keyFindings: ["Workspace evidence refs were gathered before child delegation."],
            recommendations: ["Keep tool outputs as refs and let parent synthesis own final reporting."],
            evidenceRefs: ["research:codebase:work-session", "tool-call:call-search-work-session"],
            uncertainty: ["Tool output remains untrusted until synthesis."],
            nextActions: ["Run a real provider smoke with configured openai-compatible model."],
            decisionSummary: "Parent synthesis used tool-backed evidence refs.",
            confidence: 0.73,
          },
          {
            action: "produce_artifact",
            childSpecs: [],
            decisionSummary: "Produce final report after tool-backed synthesis.",
            uncertainty: "Fixture uncertainty.",
            confidence: 0.74,
          },
        ]),
      }),
  });

  assert.equal(result.status, "completed");
  assert.equal(toolCenter.getCallCount(), 1);
  assert.equal(result.steps[0]?.action, "use_tools");
  assert.equal(result.steps.some((step) => step.toolCallRefs.includes("call-search-work-session")), true);
  assert.equal(result.evidenceRefs.includes("research:codebase:work-session"), true);
  assert.equal(result.runtime.eventLog.types().includes("tool.completed"), true);
  assert.equal(JSON.stringify(result).includes("raw tool output"), false);
});

test("Cognitive Work Session stops when artifact production is requested before parent synthesis", async () => {
  const result = await runCognitiveWorkSession("不能跳过父层综合直接产出 artifact", {
    aiMode: "fake",
    createIntelligenceChannel: (runtime) =>
      new NativeIntelligenceChannel({
        bus: runtime.bus,
        provider: new SequenceModelProvider([
          {
            action: "produce_artifact",
            childSpecs: [],
            decisionSummary: "Try to produce artifact too early.",
            uncertainty: "No parent synthesis exists.",
            confidence: 0.2,
          },
        ]),
      }),
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.finalArtifact, undefined);
  assert.equal(result.report, undefined);
  assert.equal(result.steps[0]?.action, "produce_artifact");
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

class SequenceModelProvider implements ModelProvider {
  readonly providerId = "work-session-sequence-provider";
  readonly providerKind = "fake" as const;
  readonly protocolKind = "openai_compatible_chat_completions" as const;
  readonly model = "work-session-sequence-model";
  private index = 0;
  private readonly capturedRequests: ModelRequest[] = [];

  constructor(private readonly outputs: readonly (unknown | { readonly output?: unknown; readonly textOutput?: string; readonly toolCalls?: readonly ToolCallRequest[] })[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.capturedRequests.push(request);
    const step = this.outputs[this.index] ?? {};
    this.index += 1;
    const output = isProviderStep(step) ? step.output : step;
    const textOutput = isProviderStep(step) ? step.textOutput : undefined;
    const toolCalls = isProviderStep(step) ? step.toolCalls : undefined;
    return {
      responseId: createId("model-response"),
      requestId: request.requestId,
      providerId: this.providerId,
      providerKind: this.providerKind,
      protocolKind: this.protocolKind,
      model: this.model,
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: output,
      textOutput,
      toolCalls,
      finishReason: toolCalls === undefined || toolCalls.length === 0 ? "stop" : "tool_call",
      validation: pendingModelOutputValidation(),
      completedAt: nowIso(),
    };
  }

  requests(): readonly ModelRequest[] {
    return this.capturedRequests;
  }
}

class FixtureToolCenter implements ToolExecutionBroker {
  private calls = 0;

  list(): ToolDefinition[] {
    return [
      {
        name: "search",
        description: "Fixture codebase search tool.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      {
        name: "read",
        description: "Fixture codebase read tool.",
        inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
      },
    ];
  }

  has(name: string): boolean {
    return name === "search" || name === "read";
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    if (!permission.allowedTools.includes(request.toolName)) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: undefined,
        status: "failed",
        error: "Tool is not authorized.",
        durationMs: 0,
      };
    }
    this.calls += 1;
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        status: "completed",
        results: [
          {
            refId: "research:codebase:work-session",
            source: "codebase",
            title: "src/app/cognitive-work-session.ts",
            uri: "repo://src/app/cognitive-work-session.ts",
            snippet: "Cognitive Work Session runtime evidence.",
            status: "available",
          },
        ],
        trace: {
          traceId: "trace-research-work-session",
          status: "completed",
        },
      },
      status: "completed",
      durationMs: 1,
    };
  }

  resetCallCount(): void {
    this.calls = 0;
  }

  getCallCount(): number {
    return this.calls;
  }
}

function isProviderStep(value: unknown): value is { readonly output?: unknown; readonly textOutput?: string; readonly toolCalls?: readonly ToolCallRequest[] } {
  return typeof value === "object" && value !== null && ("output" in value || "textOutput" in value || "toolCalls" in value);
}
