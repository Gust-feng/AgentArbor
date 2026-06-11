import assert from "node:assert/strict";
import test from "node:test";
import type {
  BasicAgentCapabilitySnapshot,
  CapabilityToolCatalogItem,
  CapabilityToolScope,
} from "../domain/config/index.js";
import type { IntelligenceChannel, ModelRequest } from "../domain/intelligence/index.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolDefinition,
  ToolExecutionBroker,
  ToolExecutionContext,
  ToolPermissionCheck,
} from "../domain/tools/index.js";
import { toolPresentationForName } from "../domain/tools/index.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";
import { runDesktopAgentSession } from "./desktop-agent-session.js";
import { createOpenAiStreamTextResponse } from "./panel-openai-test-fixtures.js";

test("Desktop Agent Session answers ordinary questions without entering deep mode", async () => {
  const result = await runDesktopAgentSession("你是什么模型？", { aiMode: "fake" });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("AgentArbor 桌面助手"), true);
  assert.equal(result.pendingConfirmation, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Agent Session activity omits generic message and model progress", async () => {
  const result = await runDesktopAgentSession("你是什么模型？", { aiMode: "fake" });
  const activityText = JSON.stringify(result.activity);

  assert.equal(result.status, "completed");
  assert.equal(result.activity.some((item) => item.type === "model_requested"), false);
  assert.equal(result.activity.some((item) => item.type === "model_completed"), false);
  assert.equal(result.activity.some((item) => item.type === "task_received"), false);
  assert.equal(activityText.includes("正在处理"), false);
  assert.equal(activityText.includes("继续处理"), false);
});

test("Desktop Agent Session defaults aiMode from the frozen capability snapshot", async () => {
  const result = await runDesktopAgentSession("使用本轮冻结的默认模型模式", {
    capabilitySnapshot: desktopCapabilitySnapshot([], {
      activeModel: {
        defaultAiMode: "fake",
        model: "frozen-fixture-model",
      },
    }),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  const requested = result.runtime.eventLog.list().find((entry) => entry.type === "model.requested");
  assert.equal((requested?.message.payload as { readonly providerKind?: string }).providerKind, "fake");
});

test("Desktop Agent Session prefers frozen capability model facts over env model settings", async () => {
  const fetchCalls: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
  const result = await runDesktopAgentSession("使用本轮冻结的模型配置回答", {
    aiMode: "openai-compatible",
    aiEnvironment: {
      AGENTARBOR_MODEL_API_KEY: "sk-test-secret",
      AGENTARBOR_MODEL_NAME: "env-model-should-not-run",
      AGENTARBOR_MODEL_BASE_URL: "https://env-provider.example",
    },
    capabilitySnapshot: desktopCapabilitySnapshot([], {
      activeModel: {
        defaultAiMode: "openai-compatible",
        baseUrl: "https://snapshot-provider.example",
        model: "snapshot-desktop-model",
      },
    }),
    providerFetch: async (url, init) => {
      fetchCalls.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl-desktop-snapshot",
          model: "snapshot-desktop-model",
          choices: [
            {
              message: { role: "assistant", content: "已使用冻结模型配置。" },
              finish_reason: "stop",
            },
          ],
        }),
      };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(fetchCalls[0]?.url, "https://snapshot-provider.example/chat/completions");
  assert.equal(fetchCalls[0]?.body.model, "snapshot-desktop-model");
  assert.equal(result.answer?.answer, "已使用冻结模型配置。");
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

test("Desktop Agent Session fails when the model stops without a visible answer", async () => {
  const channel = new EmptyVisibleAnswerChannel("");
  const result = await runDesktopAgentSession("给出一个可见答案", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.answer, undefined);
  assert.equal(result.failureMessage, "Desktop Agent model stopped without a visible answer.");
  assert.equal(channel.requests.length, 1);
  assert.deepEqual(result.eventTypes, ["goal.received"]);
});

test("Desktop Agent Session fails when safety projection removes the whole model answer", async () => {
  const channel = new EmptyVisibleAnswerChannel("<tool_call>{\"name\":\"read_file\"}</tool_call>");
  const result = await runDesktopAgentSession("不要把内部控制文本当答案", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.answer, undefined);
  assert.equal(result.failureMessage, "Desktop Agent model stopped without a visible answer.");
  assert.equal(channel.requests.length, 1);
  assert.equal(JSON.stringify(result).includes("<tool_call>"), false);
});

test("Desktop Agent Session can use authorized tools before answering", async () => {
  const toolCenter = new FixtureToolCenter();
  const result = await runDesktopAgentSession("分析当前仓库的问题并给我优化建议", {
    aiMode: "fake",
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      capabilityTool("read", "read-only"),
    ]),
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
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("read_file", "read-only"),
    ]),
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
  assert.equal(result.capabilityResolution?.agentId, DESKTOP_ROOT_AGENT.agentId);
  assert.equal(result.capabilityResolution?.agentDisplayName, DESKTOP_ROOT_AGENT.displayName);
  assert.equal(result.capabilityResolution?.toolVisibilityProfileId, DESKTOP_ROOT_AGENT.toolVisibilityProfile.profileId);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["read"]);
  assert.equal(result.capabilityResolution?.toolExposures.find((tool) => tool.name === "search")?.modelVisible, false);
});

test("Desktop Agent Session exposes frozen MCP tools to the default ordinary Agent", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "我会使用普通 Agent 可见的工具边界。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("展示当前能力边界", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => new McpFixtureToolCenter(),
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      { ...capabilityTool("mcp_docs_search", "external-submit"), scopes: ["mcp"] },
    ], {
      mcpCatalog: [
        {
          serverId: "docs",
          label: "Docs MCP",
          transport: "stdio",
          enabled: true,
          confirmationMode: "always",
          availability: "configured",
          commandSummary: "node server.js --token omitted",
          envSecretRefCount: 1,
          authSecretRefCount: 0,
          toolExposureMode: "all",
          enabledTools: [],
        autoApprovedTools: [],
          tools: [{ ...capabilityTool("mcp_docs_search", "external-submit"), scopes: ["mcp"] }],
          exposedTools: [{ ...capabilityTool("mcp_docs_search", "external-submit"), scopes: ["mcp"] }],
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
      ],
    }),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), ["search", "mcp_docs_search"]);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["search", "mcp_docs_search"]);
  assert.equal(result.capabilityResolution?.toolExposures.find((tool) => tool.name === "mcp_docs_search")?.modelVisible, true);
  assert.equal(result.capabilityResolution?.mcpDrafts[0]?.source, "mcp");
  assert.equal(JSON.stringify(result.capabilityResolution).includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
  assert.equal(JSON.stringify(result.capabilityResolution).includes("--token"), false);
  assert.equal(JSON.stringify(result.capabilityResolution).includes("secret://"), false);
});

test("Desktop Agent Session records executable tool restrictions in run capability resolution", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "我只会看到本轮真实可执行的工具。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("展示可执行工具边界", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => new SearchOnlyToolCenter(),
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      capabilityTool("read", "read-only"),
    ]),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), ["search"]);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["search"]);
  assert.equal(result.capabilityResolution?.toolExposures.find((tool) => tool.name === "read")?.modelVisible, false);
  assert.equal(result.capabilityResolution?.toolExposures.find((tool) => tool.name === "read")?.reason, "工具执行器当前未提供该工具。");
  assert.match(result.capabilityResolution?.warnings.join("\n") ?? "", /工具执行器/);
  assert.equal(result.capabilityResolution?.warnings.includes("本轮没有可用工具。"), false);
});

test("Desktop Agent Session hides underground-scoped tools from the ordinary agent", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "我只会看到普通路径允许的工具。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("展示当前可见工具", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => new FixtureToolCenter(),
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      {
        ...capabilityTool("underground_probe", "read-only"),
        scopes: ["underground"],
      },
    ]),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), ["search"]);
});

test("Desktop Agent Session does not let direct session options override allowed tools", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "我会按正式能力边界使用工具。");
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
      capabilityTool("read", "read-only"),
    ]),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), ["read"]);
  assert.equal(capturedRequest?.tools?.some((tool) => tool.name === "search"), false);
});

test("Desktop Agent Session derives caller identity and output contract from the desktop agent definition", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "定义层已生效。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("确认当前普通 Agent 的运行身份", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "completed");
  assert.equal(capturedRequest?.purpose, DESKTOP_ROOT_AGENT.turnPolicy.purpose);
  assert.equal(capturedRequest?.outputContract.contractId, DESKTOP_ROOT_AGENT.outputContract.contractId);
  assert.equal(capturedRequest?.sanitizedMessages[0]?.content, DESKTOP_ROOT_AGENT.prompt.systemPrompt);
});

test("Desktop Agent Session can run with an injected agent definition on the same ordinary loop", async () => {
  const customAgent = customOrdinaryAgent();
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "自定义普通 Agent 定义已生效。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("使用自定义普通 Agent", {
    aiMode: "fake",
    agentDefinition: customAgent,
    createIntelligenceChannel: () => channel,
    createToolCenter: () => new FixtureToolCenter(),
    skillContexts: [
      {
        skill: {
          id: "custom-skill",
          name: "Custom Skill",
          description: "Fixture skill.",
          enabled: true,
          sourcePath: ".agents/skills/custom/SKILL.md",
          triggers: ["自定义普通 Agent"],
        },
        body: "Custom skill body.",
        triggerReason: "User request matches fixture skill.",
      },
    ],
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      capabilityTool("read", "read-only"),
    ]),
  });

  assert.equal(result.status, "completed");
  assert.equal(capturedRequest?.purpose, customAgent.turnPolicy.purpose);
  assert.equal(capturedRequest?.outputContract.contractId, customAgent.outputContract.contractId);
  assert.equal(capturedRequest?.sanitizedMessages[0]?.content, "Custom ordinary agent prompt.");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), ["search"]);
  assert.equal(result.capabilityResolution?.agentId, "custom-ordinary-agent");
  assert.equal(result.capabilityResolution?.agentDisplayName, "Custom Ordinary Agent");
  assert.equal(result.capabilityResolution?.toolVisibilityProfileId, "custom-ordinary-agent:read-tools:v1");
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["search"]);
  const skillEvent = result.runtime.eventLog.list().find((entry) => entry.type === "skill.triggered");
  assert.equal(skillEvent?.message.from.id, "custom-ordinary-agent");
  assert.equal(skillEvent?.message.from.role, "agent");
});

test("Desktop Agent Session rejects deep AgentDefinitions on the ordinary loop", async () => {
  const deepAgent: AgentDefinition = {
    ...customOrdinaryAgent(),
    agentId: "deep-agent-definition",
    displayName: "Deep Agent Definition",
    prompt: {
      promptRef: "prompt:deep-agent-definition:v1",
      version: "1",
      systemPrompt: "Deep agent prompt must not leak.",
    },
    toolVisibilityProfile: {
      profileId: "deep-agent-definition:deep-visible-tools:v1",
      runMode: "deep",
      visibleToolScopes: ["underground"],
    },
  };

  await assert.rejects(
    () =>
      runDesktopAgentSession("不要把 deep 定义放进普通主循环", {
        aiMode: "fake",
        agentDefinition: deepAgent,
      }),
    (error) => {
      assert.equal(error instanceof Error, true);
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes("requires an ordinary AgentDefinition"), true);
      assert.equal(message.includes("deep-agent-definition"), true);
      assert.equal(message.includes(deepAgent.prompt.systemPrompt), false);
      assert.equal(message.includes("systemPrompt"), false);
      return true;
    }
  );
});

test("Desktop Agent Session rejects non-desktop purposes on the ordinary loop", async () => {
  const workSessionPurposeAgent: AgentDefinition = {
    ...customOrdinaryAgent(),
    agentId: "ordinary-work-session-purpose-agent",
    displayName: "Ordinary Work Session Purpose Agent",
    prompt: {
      promptRef: "prompt:ordinary-work-session-purpose-agent:v1",
      version: "1",
      systemPrompt: "Work-session purpose must not leak from ordinary Agent checks.",
    },
    turnPolicy: {
      ...DESKTOP_ROOT_AGENT.turnPolicy,
      purpose: "work_session_synthesis",
    },
  };

  await assert.rejects(
    () =>
      runDesktopAgentSession("普通 Agent 不能使用 work session 模型 purpose", {
        aiMode: "fake",
        agentDefinition: workSessionPurposeAgent,
      }),
    (error) => {
      assert.equal(error instanceof Error, true);
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes("requires desktop_agent purpose"), true);
      assert.equal(message.includes("ordinary-work-session-purpose-agent"), true);
      assert.equal(message.includes("work_session_synthesis"), true);
      assert.equal(message.includes(workSessionPurposeAgent.prompt.systemPrompt), false);
      assert.equal(message.includes("systemPrompt"), false);
      return true;
    }
  );
});

test("Desktop Agent Session rejects tool exposure without a capability snapshot", async () => {
  await assert.rejects(
    () =>
      runDesktopAgentSession("分析当前仓库的问题并给我优化建议", {
        aiMode: "fake",
        createToolCenter: () => new FixtureToolCenter(),
      }),
    /requires a capability snapshot/
  );
});

test("Desktop Agent Session projects tool failures without leaking raw output", async () => {
  const toolCenter = new FailingToolCenter();
  const result = await runDesktopAgentSession("分析当前仓库的问题并给我优化建议", {
    aiMode: "fake",
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
      capabilityTool("read", "read-only"),
    ]),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.eventTypes.includes("tool.failed"), true);
  assert.equal(result.answer?.resultBlocks.some((block) => block.kind === "failure"), true);
  assert.equal(JSON.stringify({ answer: result.answer, activity: result.activity }).includes("raw provider payload"), false);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
});

test("Desktop Agent Session blocks hidden tool calls before broker execution and lets the model stop", async () => {
  const toolCenter = new FixtureToolCenter();
  const channel = new UnauthorizedToolChannel();
  const result = await runDesktopAgentSession("读取隐藏材料后回答", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("search", "read-only"),
    ]),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("未授权工具没有执行"), true);
  assert.deepEqual(result.capabilityResolution?.allowedTools, ["search"]);
  assert.deepEqual(channel.requests[0]?.tools?.map((tool) => tool.name), ["search"]);
  assert.deepEqual(channel.requests[1]?.tools?.map((tool) => tool.name), ["search"]);
  assert.equal(result.eventTypes.includes("tool.failed"), true);
  assert.equal(result.eventTypes.includes("tool.completed"), false);
  assert.equal(toolCenter.getCallCount(), 0);
  const toolFeedback = channel.requests[1]?.sanitizedMessages.find(
    (message) => message.role === "tool" && message.toolCallId === "call-hidden-read"
  );
  assert.notEqual(toolFeedback, undefined);
  assert.equal(toolFeedback?.content.includes("未授权"), true);
  assert.equal(toolFeedback?.content.includes("Desktop Agent tool evidence"), false);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
});

test("Desktop Agent Session keeps approval waits out of assistant answers", async () => {
  const toolCenter = new ApprovalRequiredToolCenter();
  const channel = new ApprovalRequiredToolChannel();
  const result = await runDesktopAgentSession("删除 pending.txt", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("delete_file", "read-write"),
    ]),
  });

  assert.equal(result.status, "confirmation_needed");
  assert.equal(result.answer, undefined);
  assert.equal(result.pendingConfirmation?.title, "删除文件");
  assert.equal(result.pendingConfirmation?.question, "删除文件：pending.txt");
  assert.equal(result.pendingConfirmation?.consequence, "");
  assert.equal(JSON.stringify(result).includes("这个操作需要你确认后才能继续"), false);
  assert.equal(JSON.stringify(result).includes("批准后"), false);
  assert.equal(result.eventTypes.includes("user_approval.requested"), true);
});

test("Desktop Agent Session publishes confirmation requests from the injected agent identity", async () => {
  const result = await runDesktopAgentSession("删除 pending.txt", {
    aiMode: "fake",
    agentDefinition: customOrdinaryAgent(),
    createIntelligenceChannel: () => new ApprovalRequiredToolChannel(),
    createToolCenter: () => new ApprovalRequiredToolCenter(),
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("delete_file", "read-write"),
    ]),
  });

  assert.equal(result.status, "confirmation_needed");
  const confirmationEvent = result.runtime.eventLog.list().find((entry) => entry.type === "user_approval.requested");
  assert.equal(confirmationEvent?.message.from.id, "custom-ordinary-agent");
  assert.equal(confirmationEvent?.message.from.role, "agent");
});


test("Desktop Agent Session keeps returning tool results until the model stops itself", async () => {
  const toolCenter = new MixedToolCenter();
  const channel = new MixedToolLimitChannel();
  const result = await runDesktopAgentSession("展示下你的能力", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("list_dir", "read-only"),
      capabilityTool("read_file", "read-only"),
      capabilityTool("grep_files", "read-only"),
    ]),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("我已经基于多轮工具结果完成回答"), true);
  assert.equal(result.failureMessage, undefined);
  assert.equal(result.eventTypes.includes("tool.failed"), true);
  assert.equal(channel.requests.length, 5);
});

test("Desktop Agent Session reports out_of_fuel as an unfinished round boundary", async () => {
  const toolCenter = new MixedToolCenter();
  const channel = new MixedToolLimitChannel();
  const result = await runDesktopAgentSession("持续使用工具直到轮次边界", {
    aiMode: "fake",
    agentDefinition: {
      ...DESKTOP_ROOT_AGENT,
      agentId: "limited-round-agent",
      displayName: "Limited Round Agent",
      turnPolicy: {
        ...DESKTOP_ROOT_AGENT.turnPolicy,
        maxModelRounds: 1,
        maxToolRounds: 2,
      },
    },
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot([
      capabilityTool("list_dir", "read-only"),
      capabilityTool("read_file", "read-only"),
      capabilityTool("grep_files", "read-only"),
    ]),
  });

  assert.equal(result.status, "paused");
  assert.equal(result.stopReason, "out_of_fuel");
  assert.equal(result.answer, undefined);
  assert.equal(result.failureMessage?.includes("任务没有完成"), true);
  assert.equal(result.failureMessage?.includes("轮次"), false);
  assert.equal(result.failureMessage?.includes("异常保护"), false);
});

test("Desktop Agent Session pauses context_overflow when context maintenance fails before provider stop", async () => {
  const toolCenter = new BulkyToolCenter();
  const channel = new ContextOverflowChannel();
  const result = await runDesktopAgentSession("持续读取大量材料直到可以回答", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot(
      [capabilityTool("read_file", "read-only")],
      {
        modelCapabilities: {
          contextWindowTokens: 1_200,
          maxOutputTokens: 512,
          supportsToolCalling: true,
          supportsParallelToolCalls: false,
          supportsStructuredOutputs: false,
          supportsStreaming: true,
          supportsVisionInput: false,
          supportsReasoningEffort: false,
          preferredApiStyle: "openai_compatible",
          stability: "unknown",
        },
      }
    ),
  });

  assert.equal(result.status, "paused");
  assert.equal(result.stopReason, "context_overflow");
  assert.equal(result.answer, undefined);
  assert.equal(result.failureMessage?.includes("上下文整理没有成功"), true);
  assert.equal(result.eventTypes.includes("context.compaction.failed"), true);
  assert.equal(channel.requests.some((request) => request.purpose === "desktop_context_compaction"), true);
});

test("Desktop Agent Session publishes context compaction events from the injected agent identity", async () => {
  const result = await runDesktopAgentSession("持续读取大量材料直到需要压缩上下文", {
    aiMode: "fake",
    agentDefinition: customOrdinaryAgent(),
    createIntelligenceChannel: () => new ContextOverflowChannel(),
    createToolCenter: () => new BulkyToolCenter(),
    capabilitySnapshot: desktopCapabilitySnapshot(
      [capabilityTool("read_file", "read-only")],
      {
        modelCapabilities: {
          contextWindowTokens: 1_200,
          maxOutputTokens: 512,
          supportsToolCalling: true,
          supportsParallelToolCalls: false,
          supportsStructuredOutputs: false,
          supportsStreaming: true,
          supportsVisionInput: false,
          supportsReasoningEffort: false,
          preferredApiStyle: "openai_compatible",
          stability: "unknown",
        },
      }
    ),
  });

  assert.equal(result.status, "paused");
  const compactionEvent = result.runtime.eventLog.list().find((entry) => entry.type === "context.compaction.failed");
  assert.equal(compactionEvent?.message.from.id, "custom-ordinary-agent");
  assert.equal(compactionEvent?.message.from.role, "runtime");
});

test("Desktop Agent Session uses capability snapshot model capabilities for loop context maintenance", async () => {
  const toolCenter = new BulkyToolCenter();
  const channel = new ContextOverflowChannel();
  const result = await runDesktopAgentSession("只用本轮快照里的小窗口模型能力维护上下文", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => toolCenter,
    capabilitySnapshot: desktopCapabilitySnapshot(
      [capabilityTool("read_file", "read-only")],
      {
        modelCapabilities: {
          contextWindowTokens: 1_200,
          maxOutputTokens: 512,
          supportsToolCalling: true,
          supportsParallelToolCalls: false,
          supportsStructuredOutputs: false,
          supportsStreaming: true,
          supportsVisionInput: false,
          supportsReasoningEffort: false,
          preferredApiStyle: "openai_compatible",
          stability: "unknown",
        },
      }
    ),
  });

  assert.equal(result.status, "paused");
  assert.equal(result.stopReason, "context_overflow");
  assert.equal(channel.requests.some((request) => request.purpose === "desktop_context_compaction"), true);
});

test("Desktop Agent Session does not let direct model capabilities override a frozen snapshot", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "我会使用本轮冻结的模型能力。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("检查模型能力事实来源", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    capabilitySnapshot: desktopCapabilitySnapshot([], {
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
    }),
    modelCapabilities: {
      contextWindowTokens: 4_000,
      maxOutputTokens: 512,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: false,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "unknown",
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(capturedRequest?.budget.maxOutputTokens, 16_000);
});

test("Desktop Agent Session does not let fake mode override snapshot tool-calling capability", async () => {
  let capturedRequest: ModelRequest | undefined;
  const toolCenter = new FixtureToolCenter();
  let toolCenterCreated = false;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "本轮模型能力不允许工具调用。");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("即使是 fake 模式也不能覆盖快照能力", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    createToolCenter: () => {
      toolCenterCreated = true;
      return toolCenter;
    },
    capabilitySnapshot: desktopCapabilitySnapshot(
      [capabilityTool("search", "read-only")],
      {
        modelCapabilities: {
          contextWindowTokens: 16_000,
          maxOutputTokens: 4_000,
          supportsToolCalling: false,
          supportsParallelToolCalls: false,
          supportsStructuredOutputs: false,
          supportsStreaming: true,
          supportsVisionInput: false,
          supportsReasoningEffort: false,
          preferredApiStyle: "openai_compatible",
          stability: "unknown",
        },
      }
    ),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(capturedRequest?.tools?.map((tool) => tool.name), []);
  assert.deepEqual(result.capabilityResolution?.allowedTools, []);
  assert.equal(result.capabilityResolution?.toolExposures.find((tool) => tool.name === "search")?.reason, "当前模型不支持工具调用。");
  assert.equal(toolCenter.getCallCount(), 0);
  assert.equal(toolCenterCreated, false);
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

test("Desktop Agent Session surfaces sanitized model request exceptions as failed runs", async () => {
  const channel: IntelligenceChannel = {
    async request() {
      throw new Error("provider network unavailable api_key=sk-desktop-runtime-secret-123456");
    },
    validateResponse(_request, response) {
      return response.validation;
    },
  };

  const result = await runDesktopAgentSession("继续分析当前项目", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.answer, undefined);
  assert.equal(result.failureMessage?.includes("provider network unavailable"), true);
  assert.equal(result.failureMessage?.includes("sk-desktop-runtime-secret"), false);
  assert.equal(result.failureMessage?.includes("[redacted-secret]"), true);
  assert.notEqual(result.failureMessage, "任务没有完成。");
  assert.equal(result.modelCallRefs.length >= 2, true);
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
  assert.equal(capturedRequest?.budget.maxLatencyMs, undefined);
  assert.equal(result.pendingConfirmation, undefined);
});

test("Desktop Agent Session follows model output capability instead of applying a small ordinary-turn cap", async () => {
  let capturedRequest: ModelRequest | undefined;
  const channel: IntelligenceChannel = {
    async request(request) {
      capturedRequest = request;
      return textResponse(request, "结果是 1573");
    },
    validateResponse() {
      return { status: "passed", checkedAt: new Date(0).toISOString(), issues: [] };
    },
  };

  const result = await runDesktopAgentSession("计算 37*42+19", {
    aiMode: "fake",
    createIntelligenceChannel: () => channel,
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "chat_completions",
      stability: "stable",
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(capturedRequest?.budget.maxOutputTokens, 16_000);
});

test("Desktop Agent Session forces live streaming when a delta callback is provided", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const deltas: string[] = [];
  const result = await runDesktopAgentSession("请流式回答", {
    aiMode: "openai-compatible",
    aiEnvironment: {
      AGENTARBOR_MODEL_API_KEY: "sk-test-secret",
      AGENTARBOR_MODEL_NAME: "gpt-4o-mini",
      AGENTARBOR_MODEL_BASE_URL: "https://provider.example",
    },
    providerFetch: async (_url, init) => {
      requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return createOpenAiStreamTextResponse("gpt-4o-mini", ["第一段", "第二段"]);
    },
    onModelOutputDelta: (delta) => {
      if (delta.kind === "output") {
        deltas.push(delta.delta);
      }
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(requestBodies[0]?.stream, true);
  assert.deepEqual(deltas, ["第一段", "第二段"]);
  assert.equal(result.answer?.answer, "第一段第二段");
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
  });

  assert.equal(result.status, "completed");
  assert.equal(result.answer?.answer.includes("<start_work_session>"), false);
  assert.equal(result.answer?.answer.includes("<query>"), false);
  assert.equal(result.answer?.answer.includes("可见结论"), true);
});

test("Desktop Agent Session redacts raw references without dropping ordinary task headings", async () => {
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
  assert.equal(result.answer?.answer.includes("当前任务"), true);
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
  assert.equal(result.answer?.answer.includes("\"name\":\"read\""), false);
  assert.equal(result.answer?.answer.includes("准备调用工具"), false);
  assert.equal(result.answer?.answer.includes("我需要你先提供文件引用"), true);
  assert.equal(result.pendingConfirmation, undefined);
  assert.equal(result.eventTypes.includes("user_approval.requested"), false);
});

function customOrdinaryAgent(): AgentDefinition {
  return {
    ...DESKTOP_ROOT_AGENT,
    agentId: "custom-ordinary-agent",
    displayName: "Custom Ordinary Agent",
    prompt: {
      promptRef: "prompt:custom-ordinary-agent:v1",
      version: "1",
      systemPrompt: "Custom ordinary agent prompt.",
    },
    toolVisibilityProfile: {
      profileId: "custom-ordinary-agent:read-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic", "research"],
      hiddenToolNames: ["read"],
    },
  };
}

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

class EmptyVisibleAnswerChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly answer: string) {}

  async request(request: ModelRequest) {
    this.requests.push(request);
    return textResponse(request, this.answer);
  }

  validateResponse() {
    return { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] };
  }
}

class UnauthorizedToolChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  async request(request: ModelRequest) {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return {
        responseId: "model-response-hidden-tool-call",
        requestId: request.requestId,
        providerId: "test-provider",
        providerKind: "fake" as const,
        protocolKind: "openai_compatible_chat_completions" as const,
        model: "test-model",
        status: "completed" as const,
        outputKind: "explanation" as const,
        toolCalls: [{ callId: "call-hidden-read", toolName: "read", input: { ref: "hidden" } }],
        finishReason: "tool_call" as const,
        validation: { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    }
    return {
      ...textResponse(request, "未授权工具没有执行，我会基于当前可见信息回答。"),
      responseId: "model-response-after-hidden-tool-failure",
    };
  }

  validateResponse() {
    return { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] };
  }
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

class ContextOverflowChannel implements IntelligenceChannel {
  readonly requests: ModelRequest[] = [];

  async request(request: ModelRequest) {
    this.requests.push(request);
    if (request.purpose === "desktop_context_compaction") {
      return {
        ...textResponse(request, ""),
        responseId: `${request.requestId}-empty-compaction`,
        textOutput: "",
      };
    }
    return {
      ...textResponse(request, ""),
      responseId: `${request.requestId}-tool-call`,
      textOutput: undefined,
      toolCalls: [
        {
          callId: `call-bulky-read-${this.requests.length}`,
          toolName: "read_file",
          input: { path: `bulky-${this.requests.length}.md` },
        },
      ],
      finishReason: "tool_call" as const,
    };
  }

  validateResponse() {
    return { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] };
  }
}

class BulkyToolCenter implements ToolExecutionBroker {
  list(): ToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "Return a large safe file summary.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ];
  }

  has(name: string): boolean {
    return name === "read_file";
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    const input = request.input as { path?: string };
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: {
        action: "read_file",
        status: "completed",
        refId: `workspace:file:${input.path ?? "bulky.md"}`,
        summary: `Large safe summary ${"context ".repeat(900)}`,
        result: { path: input.path, bytes: 12_000 },
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

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
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

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
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

class ApprovalRequiredToolChannel implements IntelligenceChannel {
  async request(request: ModelRequest) {
    return {
      responseId: "model-response-approval-required",
      requestId: request.requestId,
      providerId: "test-provider",
      providerKind: "fake" as const,
      protocolKind: "openai_compatible_chat_completions" as const,
      model: "test-model",
      status: "completed" as const,
      outputKind: "explanation" as const,
      toolCalls: [{ callId: "call-delete-pending", toolName: "delete_file", input: { path: "pending.txt" } }],
      finishReason: "tool_call" as const,
      validation: { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] },
      completedAt: new Date(0).toISOString(),
    };
  }

  validateResponse() {
    return { status: "passed" as const, checkedAt: new Date(0).toISOString(), issues: [] };
  }
}

class ApprovalRequiredToolCenter implements ToolExecutionBroker {
  list(): ToolDefinition[] {
    return [
      {
        name: "delete_file",
        description: "Delete a workspace file.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        metadata: {
          category: "filesystem",
          riskLevel: "high",
          operationType: "read-write",
          requiresConfirmation: true,
          visibleResultPolicy: {
            userVisible: "summary-only",
            maxPreviewChars: 0,
            omitRawOutput: true,
          },
        },
      },
    ];
  }

  has(name: string): boolean {
    return name === "delete_file";
  }

  async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck
  ): Promise<ToolCallResult> {
    return {
      callId: request.callId,
      toolName: request.toolName,
      input: request.input,
      output: undefined,
      status: "approval_required",
      durationMs: 0,
      confirmationRequest: {
        confirmationId: `confirmation-${request.callId}`,
        runId: request.callId,
        title: "删除文件",
        actionSummary: "删除文件：pending.txt",
        affectedResources: ["pending.txt"],
        riskLevel: "high",
        resumeAvailability: "live",
        requestedAt: "2026-05-30T00:00:00.000Z",
        sourceRefs: [`tool:${request.callId}`],
      },
    };
  }

  resetCallCount(): void {}

  getCallCount(): number {
    return 0;
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
            refId: "research:codebase:desktop-agent",
            source: "codebase",
            title: "src/app/desktop-agent-session.ts",
            uri: "repo://src/app/desktop-agent-session.ts",
            snippet: "Desktop Agent tool evidence.",
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

class SearchOnlyToolCenter extends FixtureToolCenter {
  override list(): ToolDefinition[] {
    return super.list().filter((tool) => tool.name === "search");
  }

  override has(name: string): boolean {
    return name === "search";
  }
}

class McpFixtureToolCenter extends FixtureToolCenter {
  override list(): ToolDefinition[] {
    return [
      ...super.list(),
      {
        name: "mcp_docs_search",
        description: "Fixture MCP docs search tool.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    ];
  }

  override has(name: string): boolean {
    return name === "mcp_docs_search" || super.has(name);
  }
}

class FailingToolCenter extends FixtureToolCenter {
  override async execute(
    request: ToolCallRequest,
    _context: ToolExecutionContext,
    _permission: ToolPermissionCheck
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

function desktopCapabilitySnapshot(
  tools: readonly CapabilityToolCatalogItem[],
  overrides: Partial<Pick<BasicAgentCapabilitySnapshot, "mcpCatalog" | "skillCatalog" | "modelCapabilities">> & {
    readonly activeModel?: Partial<BasicAgentCapabilitySnapshot["activeModel"]>;
  } = {}
): BasicAgentCapabilitySnapshot {
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
      ...overrides.activeModel,
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
      ...overrides.modelCapabilities,
    },
    toolCatalog: {
      scope: "desktop-basic",
      tools,
      allowedTools: tools.filter((tool) => tool.enabled && tool.availability === "available").map((tool) => tool.name),
    },
    skillCatalog: overrides.skillCatalog ?? [],
    mcpCatalog: overrides.mcpCatalog ?? [],
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
  const presentation = toolPresentationForName(name, {
    category: "workspace",
    riskLevel: operationType === "read-only" ? "low" : "high",
    operationType,
    requiresConfirmation: operationType !== "read-only",
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
  });
  return {
    name,
    displayName: presentation.displayName,
    displayDescription: presentation.displayDescription,
    description: `${name} tool`,
    category: "workspace",
    categoryLabel: presentation.categoryLabel,
    riskLevel: operationType === "read-only" ? "low" : "high",
    riskLabel: presentation.riskLabel,
    operationType,
    operationLabel: presentation.operationLabel,
    requiresConfirmation: operationType !== "read-only",
    confirmationLabel: presentation.confirmationLabel,
    visibleResultPolicy: {
      userVisible: "safe-preview",
      maxPreviewChars: 800,
      omitRawOutput: true,
    },
    scopes: defaultCapabilityToolScopes(operationType),
    enabled: true,
    availability: "available",
  };
}

function defaultCapabilityToolScopes(
  operationType: CapabilityToolCatalogItem["operationType"]
): readonly CapabilityToolScope[] {
  return operationType === "read-only"
    ? ["desktop-basic", "research"]
    : ["desktop-basic", "workspace"];
}
