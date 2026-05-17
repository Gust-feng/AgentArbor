import assert from "node:assert/strict";
import test from "node:test";
import type { BasicAgentCapabilitySnapshot, CapabilityToolCatalogItem } from "../domain/config/index.js";
import type { IntelligenceChannel, ModelRequest } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../domain/tools/index.js";
import { runDesktopAgentSession } from "./desktop-agent-session.js";

test("Desktop Agent Session answers ordinary questions without entering deep mode", async () => {
  const result = await runDesktopAgentSession("你是什么模型？", { aiMode: "fake" });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("AgentArbor 桌面助手"), true);
  assert.equal(result.pendingConfirmation, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Agent Session keeps complex requests in ordinary desktop assistant mode by default", async () => {
  const result = await runDesktopAgentSession("分析当前仓库的问题并给我优化建议", { aiMode: "fake" });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("桌面任务处理"), true);
  assert.equal(result.answer?.answer.includes("深度模式"), false);
  assert.equal(result.pendingConfirmation, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Agent Session can use authorized tools before answering", async () => {
  const toolCenter = new FixtureToolCenter();
  const result = await runDesktopAgentSession("分析当前仓库的问题并给我优化建议", {
    aiMode: "fake",
    createToolCenter: () => toolCenter,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("授权工具检查"), true);
  assert.equal(result.answer?.answer.includes("深度模式"), false);
  assert.equal(result.answer?.toolCallRefs.includes("call-desktop-agent-search"), true);
  assert.equal(result.answer?.evidenceRefs.some((ref) => ref.includes("research:codebase:desktop-agent")), true);
  assert.equal(result.toolCallRefs.includes("call-desktop-agent-search"), true);
  assert.equal(result.answer?.resultBlocks.some((block) => block.kind === "tool_summary"), true);
  assert.equal(toolCenter.getCallCount(), 1);
  assert.equal(result.eventTypes.includes("tool.requested"), true);
  assert.equal(result.eventTypes.includes("tool.completed"), true);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Agent Session projects local tool summaries and refs", async () => {
  const toolCenter = new LocalToolCenter();
  const channel = new LocalToolChannel();
  const result = await runDesktopAgentSession("读取 README 并总结", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.evidenceRefs.includes("workspace:file:README.md"), true);
  const toolBlock = result.answer?.resultBlocks.find((block) => block.kind === "tool_summary");
  assert.notEqual(toolBlock, undefined);
  assert.equal(toolBlock?.summary.includes("read_file: README.md · 12 bytes"), true);
  assert.equal(result.activity.some((item) => item.toolName === "read_file" && item.summary.includes("README.md")), true);
  assert.equal(channel.requests[0]?.tools?.some((tool) => tool.name === "read_file"), true);
});

test("Desktop Agent Session derives model-visible tools from capability snapshot and Task Soil permissions", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "我会只使用本轮授权的工具。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("分析当前仓库的问题并给我优化建议", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => new FixtureToolCenter(),
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      capabilityTool("read", "read-only"),
    ]),
    taskSoilInput: {
      permissionBoundaryRefs: ["deny:tool:search"],
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), ["read"]);
});

test("Desktop Agent Session projects tool failures without leaking raw output", async () => {
  const toolCenter = new FailingToolCenter();
  const result = await runDesktopAgentSession("分析当前仓库的问题并给我优化建议", {
    aiMode: "fake",
    createToolCenter: () => toolCenter,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.eventTypes.includes("tool.failed"), true);
  assert.equal(result.answer?.resultBlocks.some((block) => block.kind === "failure"), true);
  assert.equal(JSON.stringify({ answer: result.answer, activity: result.activity }).includes("raw provider payload"), false);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
});


test("Desktop Agent Session keeps returning tool results until the model stops itself", async () => {
  const toolCenter = new MixedToolCenter();
  const channel = new MixedToolLimitChannel();
  const result = await runDesktopAgentSession("展示下你的能力", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("我已经基于多轮工具结果完成回答"), true);
  assert.equal(result.failureMessage, undefined);
  assert.equal(result.eventTypes.includes("tool.failed"), true);
  assert.equal(channel.requests.length, 5);
});

test("Desktop Agent Session stops cleanly when AI is disabled", async () => {
  const result = await runDesktopAgentSession("你是什么模型？", { aiMode: "none" });

  assert.equal(result.status, "stopped");
  assert.equal(result.answer, undefined);
  assert.equal(result.modelCallRefs.length, 0);
  assert.equal(result.toolCallRefs.length, 0);
  assert.deepEqual(result.eventTypes, ["goal.received"]);
  assert.equal(result.activity.some((item) => item.type === "stopped"), true);
});

test("Desktop Agent Session explains missing file context without synthetic confirmation", async () => {
  const result = await runDesktopAgentSession("帮我看看桌面文件", { aiMode: "fake" });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("文件或文件夹"), true);
  assert.equal(result.pendingConfirmation, undefined);
  assert.equal(result.toolCallRefs.length, 0);
  assert.equal(result.eventTypes.includes("user_approval.requested"), false);
  assert.equal(result.answer?.resultBlocks.some((block) => block.kind === "pending_confirmation"), false);
});

test("Desktop Agent Session keeps daily efficiency advice as direct answer", async () => {
  const result = await runDesktopAgentSession("请给我三条今天提高效率的建议", { aiMode: "fake" });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("效率建议"), true);
  assert.equal(result.pendingConfirmation, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Agent Session injects safe conversation history as separate messages", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "可以继续。我会基于前文解释，不把这轮追问升级成报告。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("那你能继续解释一下吗？", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    conversationHistory: [
      {
        role: "user",
        content: "你好，你能做什么？",
        ref: "conversation:test:turn:0",
      },
      {
        role: "assistant",
        content: "我可以直接回答问题，也可以处理文件、网页和任务。",
        ref: "conversation:test:turn:1",
      },
    ],
  });

  const messages = capturedRequest?.sanitizedMessages ?? [];
  assert.equal(result.status, "completed");
  assert.deepEqual(messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.equal(messages[1]?.content.includes("你好，你能做什么"), true);
  assert.equal(messages[2]?.content.includes("我可以直接回答问题"), true);
  assert.equal(messages[3]?.content.includes("Current user message: 那你能继续解释一下吗？"), true);
  assert.equal(JSON.stringify(messages).includes("workspace:conversation-history"), false);
  assert.equal(capturedRequest?.budget.maxOutputTokens, 3200);
  assert.equal(capturedRequest?.budget.maxLatencyMs, 60_000);
  assert.equal(result.pendingConfirmation, undefined);
});

test("Desktop Agent Session removes internal control fragments from visible answers", async () => {
  const channel: IntelligenceChannel = {
    async request(request) {
      return textResponse(
        request,
        "先处理这个动作。<start_work_session><query>分析当前项目</query></start_work_session>\n可见结论：这更适合作为任务处理。"
      );
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("分析当前项目", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    allowWorkSessionUpgrade: false,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("<start_work_session>"), false);
  assert.equal(result.answer?.answer.includes("<query>"), false);
  assert.equal(result.answer?.answer.includes("可见结论"), true);
});

test("Desktop Agent Session removes internal task diagnostics from visible answers", async () => {
  const channel: IntelligenceChannel = {
    async request(request) {
      return textResponse(
        request,
        "## 当前任务 (goal-0003)\nrequestId: model-request-abc\n这里是内部任务状态。\n\n可以继续。刚才的问题需要你选择文件或给出只读引用，我再帮你分析。"
      );
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("?", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("当前任务"), false);
  assert.equal(result.answer?.answer.includes("goal-0003"), false);
  assert.equal(result.answer?.answer.includes("model-request-abc"), false);
  assert.equal(result.answer?.answer.includes("可以继续"), true);
});

test("Desktop Agent Session drops provider control markup without synthetic confirmation", async () => {
  const channel: IntelligenceChannel = {
    async request(request) {
      return textResponse(
        request,
        "<tool_call>{\"name\":\"read\",\"arguments\":{\"ref\":\"file:/tmp/a.md\"}}</tool_call>\n我需要你先提供文件引用或授权，才能读取具体文件。"
      );
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("你能读取文件吗？", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("<tool_call>"), false);
  assert.equal(result.answer?.answer.includes("准备调用工具"), false);
  assert.equal(result.answer?.answer.includes("我需要你先提供文件引用"), true);
  assert.equal(result.pendingConfirmation, undefined);
  assert.equal(result.eventTypes.includes("user_approval.requested"), false);
});

function textResponse(
  request: ModelRequest,
  answer: string
) {
  return {
    responseId: `${request.requestId}-text-response`,
    requestId: request.requestId,
    providerId: "test-provider",
    providerKind: "fake" as const,
    protocolKind: "openai_compatible_chat_completions" as const,
    model: "test-model",
    status: "completed" as const,
    outputKind: "explanation" as const,
    textOutput: answer,
    finishReason: "stop" as const,
    validation: { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] },
    completedAt: new Date(0).toISOString(),
  };
}

class MixedToolLimitChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  async request(request: ModelRequest) {
    this.requests.push(request);
    const responseBase = {
      requestId: request.requestId,
      providerId: "test-provider",
      providerKind: "fake" as const,
      protocolKind: "openai_compatible_chat_completions" as const,
      model: "test-model",
      status: "completed" as const,
      outputKind: "explanation" as const,
      validation: { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] },
      completedAt: new Date(0).toISOString(),
    };
    if (this.requests.length === 1) {
      return {
        ...responseBase,
        responseId: "model-response-mixed-1",
        toolCalls: [
          { callId: "call-list", toolName: "list_dir", input: { path: "." } },
          { callId: "call-missing", toolName: "list_dir", input: { path: "memory://artifacts" } },
        ],
        finishReason: "tool_call" as const,
      };
    }
    if (this.requests.length === 2) {
      return {
        ...responseBase,
        responseId: "model-response-mixed-2",
        toolCalls: [{ callId: "call-read", toolName: "read_file", input: { path: "capability_report.md" } }],
        finishReason: "tool_call" as const,
      };
    }
    if (this.requests.length === 3) {
      return {
        ...responseBase,
        responseId: "model-response-mixed-3",
        toolCalls: [{ callId: "call-grep", toolName: "grep_files", input: { path: ".", query: "AgentArbor" } }],
        finishReason: "tool_call" as const,
      };
    }
    if (this.requests.length === 4) {
      return {
        ...responseBase,
        responseId: "model-response-mixed-4",
        toolCalls: [{ callId: "call-extra", toolName: "read_file", input: { path: "extra.md" } }],
        finishReason: "tool_call" as const,
      };
    }
    return {
      ...responseBase,
      responseId: "model-response-mixed-final",
      textOutput: "我已经基于多轮工具结果完成回答。",
      finishReason: "stop" as const,
    };
  }

  validateResponse() {
    return { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] };
  }
}

class MixedToolCenter implements ToolExecutionBroker {
  list(): ToolDefinition[] {
    return [
      { name: "list_dir", description: "List files.", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
      { name: "read_file", description: "Read file.", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
      { name: "grep_files", description: "Search files.", inputSchema: { type: "object", properties: { path: { type: "string" }, query: { type: "string" } } } },
    ];
  }

  has(name: string): boolean {
    return ["list_dir", "read_file", "grep_files"].includes(name);
  }

  async execute(request: ToolCallRequest): Promise<ToolCallResult> {
    const input = request.input as { path?: string; query?: string };
    if (input.path === "memory://artifacts") {
      return {
        callId: request.callId,
        toolName: request.toolName,
        input: request.input,
        output: { action: request.toolName, status: "failed", summary: "memory://artifacts 不存在。" },
        status: "failed",
        error: "ENOENT: no such file or directory",
        durationMs: 0,
      };
    }
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        action: request.toolName,
        status: "completed",
        refId: `workspace:${request.toolName}:${input.path ?? input.query ?? "ok"}`,
        summary: `${request.toolName}: ${input.path ?? input.query ?? "ok"}`,
        result: { path: input.path, query: input.query },
        truncated: false,
      },
      status: "completed",
      durationMs: 0,
    };
  }

  resetCallCount(): void {}

  getCallCount(): number {
    return 0;
  }
}

class LocalToolChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  async request(request: ModelRequest) {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return {
        responseId: "model-response-local-tool-call",
        requestId: request.requestId,
        providerId: "test-provider",
        providerKind: "fake" as const,
        protocolKind: "openai_compatible_chat_completions" as const,
        model: "test-model",
        status: "completed" as const,
        outputKind: "explanation" as const,
        toolCalls: [{ callId: "call-read-file", toolName: "read_file", input: { path: "README.md" } }],
        finishReason: "tool_call" as const,
        validation: { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    }
    return {
      ...textResponse(request, "已读取 README 并形成摘要。"),
      responseId: "model-response-local-final",
    };
  }

  validateResponse() {
    return { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] };
  }
}

class LocalToolCenter implements ToolExecutionBroker {
  private calls = 0;

  list(): ToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "Fixture local read tool.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ];
  }

  has(name: string): boolean {
    return name === "read_file";
  }

  async execute(request: ToolCallRequest): Promise<ToolCallResult> {
    this.calls += 1;
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        action: "read_file",
        status: "completed",
        refId: "workspace:file:README.md",
        summary: "README.md · 12 bytes",
        result: { path: "README.md", bytes: 12, content: "hello world" },
        truncated: false,
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
            refId: "research:codebase:desktop-agent",
            source: "codebase",
            title: "src/app/desktop-agent-session.ts",
            uri: "repo://src/app/desktop-agent-session.ts",
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

class FailingToolCenter extends FixtureToolCenter {
  override async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission?: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        raw: "raw provider payload must not be projected",
      },
      status: "failed",
      error: "search provider unavailable with sk-hidden-secret",
      durationMs: 0,
    };
  }
}

function desktopCapabilitySnapshot(tools: readonly CapabilityToolCatalogItem[]): BasicAgentCapabilitySnapshot {
  return {
    snapshotId: "desktop-session-snapshot",
    createdAt: "2026-05-13T00:00:00.000Z",
    activeModel: {
      profileId: "default",
      label: "Default",
      providerKind: "openai_compatible",
      protocolKind: "openai_compatible_chat_completions",
      baseUrl: "https://api.openai.com",
      model: "gpt-5.5",
      defaultAiMode: "openai-compatible",
      secretRef: "secret://local-dev/model-provider/default/api-key",
      enabled: true,
      secretConfigured: false,
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "stable",
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools,
      allowedTools: tools.filter((tool) => tool.enabled && tool.availability === "available").map((tool) => tool.name),
    },
    skillCatalog: [],
    mcpCatalog: [],
    workspace: {
      workspaceDirectory: "Z:/AgentArbor",
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    securitySummary: "Safe test snapshot.",
    warnings: [],
  };
}

function capabilityTool(
  name: string,
  operationType: CapabilityToolCatalogItem["operationType"]
): CapabilityToolCatalogItem {
  return {
    name,
    description: `${name} tool`,
    category: "workspace",
    riskLevel: operationType === "read-only" ? "low" : "high",
    operationType,
    requiresConfirmation: operationType !== "read-only",
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
    enabled: true,
    availability: "available",
  };
}
