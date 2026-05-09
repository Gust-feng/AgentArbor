import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceChannel, ModelRequest } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../domain/tools/index.js";
import { runDesktopChatSession } from "./desktop-chat-session.js";

test("Desktop Chat Session answers ordinary questions without entering deep mode", async () => {
  const result = await runDesktopChatSession("你是什么模型？", { aiMode: "fake" });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("AgentArbor 桌面助手"), true);
  assert.equal(result.upgradeRequest, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Chat Session keeps complex requests in ordinary Root Agent mode by default", async () => {
  const result = await runDesktopChatSession("分析当前仓库的问题并给我优化建议", { aiMode: "fake" });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("深度模式"), true);
  assert.equal(result.upgradeRequest, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Chat Session can use authorized tools before answering", async () => {
  const toolCenter = new FixtureToolCenter();
  const result = await runDesktopChatSession("分析当前仓库的问题并给我优化建议", {
    aiMode: "fake",
    createToolCenter: () => toolCenter,
  });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("授权工具检查"), true);
  assert.equal(result.answer?.toolCallRefs.includes("call-desktop-agent-search"), true);
  assert.equal(result.toolCallRefs.includes("call-desktop-agent-search"), true);
  assert.equal(toolCenter.getCallCount(), 1);
  assert.equal(result.eventTypes.includes("tool.requested"), true);
  assert.equal(result.eventTypes.includes("tool.completed"), true);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Chat Session asks for file authorization before claiming desktop file access", async () => {
  const result = await runDesktopChatSession("帮我看看桌面文件", { aiMode: "fake" });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("不能直接看到你的桌面文件"), true);
  assert.equal(result.answer?.answer.includes("附件选择具体文件或文件夹"), true);
  assert.equal(result.upgradeRequest, undefined);
  assert.equal(result.toolCallRefs.length, 0);
});

test("Desktop Chat Session keeps daily efficiency advice as direct chat answer", async () => {
  const result = await runDesktopChatSession("请给我三条今天提高效率的建议", { aiMode: "fake" });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("效率建议"), true);
  assert.equal(result.upgradeRequest, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Chat Session includes safe conversation preview for follow-up context", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return {
        responseId: "model-response-follow-up",
        requestId: request.requestId,
        providerId: "test-provider",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "test-model",
        status: "completed",
        outputKind: "explanation",
        textOutput: "可以继续。我会基于前文解释，不把这轮追问升级成报告。",
        validation: { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopChatSession("那你能继续解释一下吗？", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    taskSoilInput: {
      contextRefs: [
        {
          ref: "workspace:conversation-history",
          kind: "workspace",
          summary: "当前对话上下文",
          readonlyPreview: {
            title: "当前对话",
            text: "你：你好，你能做什么？\n助手：我可以直接回答问题，也可以处理文件、网页和任务。",
          },
        },
      ],
    },
  });

  const prompt = capturedRequest?.sanitizedMessages.map((message) => message.content).join("\n") ?? "";
  assert.equal(result.status, "answered");
  assert.equal(prompt.includes("workspace:conversation-history"), true);
  assert.equal(prompt.includes("你好，你能做什么"), true);
  assert.equal(prompt.includes("我可以直接回答问题"), true);
  assert.equal(result.upgradeRequest, undefined);
});

test("Desktop Chat Session removes internal control fragments from visible answers", async () => {
  const channel: IntelligenceChannel = {
    async request(request) {
      return {
        responseId: "model-response-control-text",
        requestId: request.requestId,
        providerId: "test-provider",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "test-model",
        status: "completed",
        outputKind: "explanation",
        textOutput:
          "先处理这个动作。<start_work_session><query>分析当前项目</query></start_work_session>\n可见结论：这更适合作为任务处理。",
        validation: { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopChatSession("分析当前项目", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    allowWorkSessionUpgrade: false,
  });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("<start_work_session>"), false);
  assert.equal(result.answer?.answer.includes("<query>"), false);
  assert.equal(result.answer?.answer.includes("可见结论"), true);
});

test("Desktop Chat Session removes internal task diagnostics from visible answers", async () => {
  const channel: IntelligenceChannel = {
    async request(request) {
      return {
        responseId: "model-response-internal-diagnostics",
        requestId: request.requestId,
        providerId: "test-provider",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "test-model",
        status: "completed",
        outputKind: "explanation",
        textOutput:
          "## 当前任务 (goal-0003)\nrequestId: model-request-abc\n这里是内部任务状态。\n\n可以继续。刚才的问题需要你选择文件或给出只读引用，我再帮你分析。",
        validation: { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopChatSession("?", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("当前任务"), false);
  assert.equal(result.answer?.answer.includes("goal-0003"), false);
  assert.equal(result.answer?.answer.includes("model-request-abc"), false);
  assert.equal(result.answer?.answer.includes("可以继续"), true);
});

test("Desktop Chat Session drops provider control markup instead of rendering fake tool activity", async () => {
  const channel: IntelligenceChannel = {
    async request(request) {
      return {
        responseId: "model-response-tool-markup",
        requestId: request.requestId,
        providerId: "test-provider",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "test-model",
        status: "completed",
        outputKind: "explanation",
        textOutput:
          "<tool_call>{\"name\":\"read\",\"arguments\":{\"ref\":\"file:/tmp/a.md\"}}</tool_call>\n我需要你先提供文件引用或授权，才能读取具体文件。",
        validation: { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopChatSession("你能读取文件吗？", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("<tool_call>"), false);
  assert.equal(result.answer?.answer.includes("准备调用工具"), false);
  assert.equal(result.answer?.answer.includes("我需要你先提供文件引用"), true);
});

class FixtureToolCenter implements ToolExecutionBroker {
  private calls = 0;

  list(): ToolDefinition[] {
    return [
      {
        name: "search",
        description: "Fixture search tool.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      {
        name: "read",
        description: "Fixture read tool.",
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
    permission?: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    if (permission?.allowedTools !== undefined && !permission.allowedTools.includes(request.toolName)) {
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
            refId: "research:codebase:desktop-chat",
            source: "codebase",
            title: "src/app/desktop-chat-session.ts",
            uri: "repo://src/app/desktop-chat-session.ts",
            snippet: "Desktop Root Agent tool evidence.",
            status: "available",
          },
        ],
      },
      status: "completed",
      durationMs: 0,
    };
  }

  resetCallCount(): void {
    this.calls = 0;
  }

  getCallCount(): number {
    return this.calls;
  }
}
