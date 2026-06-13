import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../adapters/config/index.js";
import { ConfigCenter } from "./config-center.js";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";
import {
  assertSafePanelJsonText,
  removeTemporaryTree,
  requestJson,
  requestSse,
  waitForRun,
} from "./panel-server-test-utils.js";
import {
  createOpenAiReadFileToolCallResponse,
  createOpenAiSearchToolCallResponse,
  createOpenAiTextResponse,
  hasResponsesToolDefinition,
  hasResponsesToolOutput,
  parseResponsesRequestBody,
} from "./panel-openai-test-fixtures.js";
import { runAgentDefinitionRef } from "./agent-definition-runtime.js";
import type { AgentDefinition } from "./agent-prompts/contracts.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";

test("desktop async fake run answers arbitrary lightweight question without report workflow", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-direct-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你是什么模型？", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(start.body.route, undefined);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.runMode, "agent");
    assert.equal(completed.body.route, undefined);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("AgentArbor 桌面助手"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    const eventTypes = completed.body.transcript.events.map((event: { type: string }) => event.type);
    assert.equal(eventTypes[0], "run.started");
    assert.equal(eventTypes.at(-1), "final.result");
    assert.equal(completed.body.transcript.modelCalls.length, 1);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assert.equal(completed.body.transcript.events.some((event: { summary?: string }) => String(event.summary ?? "").includes("项目分析")), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop async run can omit aiMode and use the run-created model default", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-default-ai-mode-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "默认模式直接回答" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(start.body.tracking.provider.requestedMode, "openai-responses");
    assert.equal(start.body.config.defaultAiMode, "openai-responses");
    assert.equal(failed.body.tracking.provider.requestedMode, "openai-responses");
    assert.equal(failed.body.error.code, "missing_api_key");
    assert.equal(failed.body.runMode, "agent");
    const runtimeRun = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.snapshot?.run?.status === "failed",
      4_000,
      "/api/runtime/runs"
    );

    assert.deepEqual(runtimeRun.body.snapshot.run.agentDefinitionRef, runAgentDefinitionRef(DESKTOP_ROOT_AGENT));
    assert.equal(runtimeRun.body.snapshot.run.agentDefinitionRef.definitionHash.startsWith("sha256:"), true);
    assert.deepEqual(runtimeRun.body.agentDefinitionRef, runtimeRun.body.snapshot.run.agentDefinitionRef);
    assert.equal(runtimeRun.body.snapshot.run.capabilityResolution, undefined);
    assert.equal(runtimeRun.text.includes("systemPrompt"), false);
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop ordinary run executes with the same AgentDefinition used for its run facts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-custom-agent-definition-"));
  const customAgent: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "custom-panel-agent",
    displayName: "Custom Panel Agent",
    prompt: {
      promptRef: "prompt:custom-panel-agent:v1",
      version: "1",
      systemPrompt: "You are a custom panel ordinary agent for contract tests.",
    },
    toolVisibilityProfile: {
      profileId: "custom-panel-agent:ordinary-visible-tools:v1",
      runMode: "agent",
      visibleToolScopes: ["desktop-basic"],
      hiddenToolNames: ["search"],
    },
  };
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    desktopAgentDefinition: customAgent,
  });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "使用自定义普通 Agent 定义", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await waitForRun(
      server.url,
      start.body.runId,
      (body) =>
        body.snapshot?.run?.status === "completed" &&
        body.snapshot.run.capabilityResolution?.agentId === customAgent.agentId,
      4_000,
      "/api/runtime/runs"
    );

    assert.deepEqual(start.body.agentDefinitionRef, runAgentDefinitionRef(customAgent));
    assert.equal(start.body.agentDefinitionRef.definitionHash.startsWith("sha256:"), true);
    assert.deepEqual(completed.body.agentDefinitionRef, start.body.agentDefinitionRef);
    assert.equal(completed.body.capabilityResolution.agentId, customAgent.agentId);
    assert.equal(completed.body.capabilityResolution.toolVisibilityProfileId, customAgent.toolVisibilityProfile.profileId);
    assert.deepEqual(runtimeRun.body.agentDefinitionRef, runtimeRun.body.snapshot.run.agentDefinitionRef);
    assert.deepEqual(runtimeRun.body.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(completed.body.transcript.modelCalls[0]?.outputContractId, customAgent.outputContract.contractId);
    assert.equal(runtimeRun.body.agentDefinitionRef.agentId, customAgent.agentId);
    assert.equal(runtimeRun.body.snapshot.run.agentDefinitionRef.outputContractId, customAgent.outputContract.contractId);
    assert.equal(runtimeRun.body.snapshot.run.capabilityResolution.agentId, customAgent.agentId);
    assert.equal(
      runtimeRun.body.snapshot.run.capabilityResolution.toolVisibilityProfileId,
      customAgent.toolVisibilityProfile.profileId
    );
    assert.equal(
      runtimeRun.body.snapshot.run.capabilityResolution.toolExposures.find(
        (tool: { name: string }) => tool.name === "search"
      )?.modelVisible,
      false
    );
    assert.equal(JSON.stringify(runtimeRun.body.snapshot.run.agentDefinitionRef).includes(customAgent.prompt.systemPrompt), false);
    assert.equal(JSON.stringify(completed.body.capabilityResolution).includes(customAgent.prompt.systemPrompt), false);
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop ordinary run persists the execution-effective model settings after capability gating", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-effective-model-settings-"));
  const secret = "sk-desktop-effective-model-settings-secret";
  const model = "glm-effective-model";
  let requestBody: Record<string, unknown> | undefined;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body) as Record<string, unknown>;
    return createOpenAiTextResponse(model, "已使用执行期裁剪后的模型设置完成回答。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model,
        apiKey: secret,
        openAI: {
          stream: true,
          parallelToolCalls: true,
          reasoningEffort: "high",
        },
        defaultAiMode: "openai-compatible",
      },
    });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "检查执行期模型设置事实", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.snapshot?.run?.status === "completed",
      4_000,
      "/api/runtime/runs"
    );

    assert.deepEqual(start.body.config.openAI, { stream: false });
    assert.equal(completed.body.config.model, model);
    assert.deepEqual(completed.body.config.openAI, { stream: false });
    assert.equal(requestBody?.parallel_tool_calls, false);
    assert.equal(requestBody?.reasoning_effort, undefined);
    assert.equal(runtimeRun.body.snapshot.run.capabilitySnapshot.activeModel.model, model);
    assert.deepEqual(runtimeRun.body.snapshot.run.capabilitySnapshot.activeModel.openAI, { stream: false });
    assert.equal(runtimeRun.text.includes(secret), false);
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop default fake run does not auto-upgrade complex requests into deep mode", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-default-agent-mode-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "gpt-4o-mini" },
    });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const runtimeRun = await waitForRun(
      server.url,
      start.body.runId,
      (body) =>
        body.status === "completed" &&
        Array.isArray(body.snapshot?.toolCalls) &&
        body.snapshot.toolCalls.some((call: { callId: string }) => call.callId === "call-desktop-agent-search"),
      4_000,
      "/api/runtime/runs"
    );

    assert.equal(completed.body.runMode, "agent");
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("授权工具检查"), true);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("深度模式"), false);
    assert.equal(completed.body.canvas.agent.toolCallRefs.includes("call-desktop-agent-search"), true);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "agent.delegation.planned"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(completed.body.route, undefined);
    assert.equal(completed.body.transcript.modelCalls.length, 2);
    assert.equal(
      runtimeRun.body.snapshot.toolCalls.some((call: { callId: string }) => call.callId === "call-desktop-agent-search"),
      true
    );
    assert.equal(runtimeRun.body.snapshot.run.capabilityResolution.agentId, "desktop-agent-session");
    assert.equal(completed.body.capabilityResolution.agentId, "desktop-agent-session");
    assert.deepEqual(runtimeRun.body.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(runtimeRun.body.snapshot.run.capabilityResolution.agentDisplayName, "Desktop Agent");
    assert.equal(
      runtimeRun.body.snapshot.run.capabilityResolution.toolVisibilityProfileId,
      "desktop-root-agent:ordinary-visible-tools:v2"
    );
    assert.deepEqual(runtimeRun.body.snapshot.run.capabilityResolution.allowedTools.includes("search"), true);
    assert.equal(
      runtimeRun.body.snapshot.run.capabilityResolution.toolExposures.some(
        (tool: { name: string; modelVisible: boolean }) => tool.name.includes("mcp") && tool.modelVisible
      ),
      false
    );
    assert.equal(JSON.stringify(runtimeRun.body.snapshot.run.capabilityResolution).includes("sourcePath"), false);
    assert.equal(JSON.stringify(runtimeRun.body.snapshot.run.capabilityResolution).includes("systemPrompt"), false);
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop run rejects legacy work_session mode alias instead of upgrading to deep", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-run-mode-alias-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const rejected = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake", runMode: "work_session" },
    });
    const runs = await requestJson(server.url, "/api/runtime/runs");

    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, "invalid_run_mode");
    assert.equal(runs.body.runs.length, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop run rejects explicit deep mode on the default desktop entry", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-run-mode-deep-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const rejected = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake", runMode: "deep" },
    });
    const runs = await requestJson(server.url, "/api/runtime/runs");

    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, "desktop_run_mode_not_supported");
    assert.equal(runs.body.runs.length, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop openai-compatible ordinary agent keeps working until the model stops calling tools", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-agent-continuous-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-agent-continuous-workspace-"));
  const secret = "sk-desktop-agent-continuous-secret";
  for (const name of ["source-1.md", "source-2.md", "source-3.md", "source-4.md"]) {
    await fs.writeFile(path.join(workspace, name), `content for ${name}`, "utf8");
  }
  let providerCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    providerCalls += 1;
    return providerCalls <= 4
      ? createOpenAiReadFileToolCallResponse(
          `source-${providerCalls}.md`,
          `call-panel-read-file-${providerCalls}`
        )
      : createOpenAiTextResponse("desktop-continuous-model", "已连续读取材料，并由模型主动停止工具调用。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: secret,
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "持续读取材料，直到你认为可以回答", aiMode: "openai-compatible", runMode: "agent" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const eventTypes = completed.body.transcript.events.map((event: { type: string }) => event.type);

    assert.equal(providerCalls, 5);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.status, "completed");
    assert.equal(JSON.stringify(completed.body.canvas.agent.answer).includes("模型主动停止工具调用"), true);
    assert.equal(eventTypes.includes("run.blocked"), false);
    assert.equal(eventTypes.includes("final.result"), true);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("desktop context overflow blocks the run instead of completing it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-context-overflow-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-context-overflow-workspace-"));
  const configCenter = new ConfigCenter({
    settingsStore: new FileSystemNormalSettingsStore(directory),
    secretStore: new FileSystemLocalDevSecretStore(directory),
  });
  const model = "desktop-context-overflow-model";
  const secret = "sk-desktop-context-overflow-secret";
  await fs.writeFile(path.join(workspace, "huge.md"), `${"context ".repeat(5_000)}\n`, "utf8");
  await configCenter.updateWorkspaceConfig({ workspaceDirectory: workspace });
  await configCenter.updateModelProviderConfig({
    baseUrl: "https://provider.example",
    model,
    protocolKind: "openai_compatible_chat_completions",
    apiKey: secret,
    defaultAiMode: "openai-compatible",
  });
  await configCenter.updateModelCapabilityOverride({
    model,
    providerKind: "openai_compatible",
    capabilities: {
      contextWindowTokens: 1_200,
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

  let providerCalls = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    providerCalls += 1;
    const body = JSON.parse(init.body) as { messages?: readonly { role?: string; content?: string }[] };
    const compactionRequest = body.messages?.some((message) =>
      String(message.content ?? "").includes("Context to compact:")
    ) === true;
    return compactionRequest
      ? createOpenAiTextResponse(model, "")
      : createOpenAiReadFileToolCallResponse("huge.md", `call-context-overflow-${providerCalls}`);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, configCenter, providerFetch });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "持续读取大量材料直到可以回答", runMode: "agent" },
    });
    const blocked = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "blocked",
      4_000,
      "/api/desktop/runs"
    );
    const events = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    const eventTypes = events.body.events.map((event: { type: string }) => event.type);

    assert.equal(start.status, 202);
    assert.equal(providerCalls >= 2, true);
    assert.equal(blocked.body.status, "blocked");
    assert.equal(blocked.body.error.code, "context_overflow");
    assert.equal(blocked.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(blocked.body.canvas.agent.status, "paused");
    assert.equal(blocked.body.canvas.agent.answer, undefined);
    assert.equal(eventTypes.includes("context.compaction.failed"), true);
    assert.equal(eventTypes.includes("final.result"), false);
    assert.equal(blocked.text.includes(secret), false);
    assertSafePanelJsonText(blocked.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("desktop async fake run answers capability questions without upgrading into project analysis", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-capability-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("我可以直接回答问题"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.text.includes("AgentArbor 项目分析与下一步优化报告"), false);
    assert.equal(completed.text.includes("项目分析报告"), false);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop async fake run keeps efficiency tips request in direct-answer path", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-efficiency-answer-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "请给我三条今天提高效率的建议", aiMode: "fake" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("效率建议"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "artifact.produced"), false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop openai-compatible direct answer completes on natural no-tool stop", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-direct-answer-text-"));
  const secret = "sk-desktop-direct-answer-text-secret";
  const bodies: Record<string, unknown>[] = [];
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    return createOpenAiTextResponse(
      "desktop-direct-answer-text-model",
      "我是 AgentArbor 桌面助手。底层模型取决于你在设置中配置的模型运行时；普通问题会直接回答，不会被强行包装成项目分析。"
    );
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-direct-answer-text-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你是什么模型？", aiMode: "openai-compatible" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies.map((body) => body.response_format !== undefined), [false]);
    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(completed.body.route, undefined);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("普通问题会直接回答"), true);
    assert.equal(completed.body.canvas.agent.pendingConfirmation, undefined);
    assert.equal(completed.body.tracking.agentRunTree, undefined);
    const requestedTools = bodies[0]?.tools as
      | readonly { function?: { name?: string } }[]
      | undefined;
    assert.equal(requestedTools?.some((tool) => tool.function?.name === "finish_task") ?? false, false);
    assertSafePanelJsonText(completed.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop run applies composer reasoning only for reasoning-capable models", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-composer-reasoning-"));
  const secret = "sk-desktop-composer-reasoning-secret";
  const bodies: Record<string, unknown>[] = [];
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    return createOpenAiTextResponse("gpt-5", "ok");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5",
        protocolKind: "openai_responses",
        apiKey: secret,
        openAI: { reasoningEffort: "high" },
      },
    });

    const defaultStart = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "默认思考强度", aiMode: "openai-responses" },
    });
    await waitForRun(server.url, defaultStart.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    assert.equal((bodies[0]?.reasoning as { readonly effort?: string } | undefined)?.effort, undefined);

    const highStart = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "深入思考", aiMode: "openai-responses", reasoningEffort: "high" },
    });
    await waitForRun(server.url, highStart.body.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    assert.equal((bodies[1]?.reasoning as { readonly effort?: string } | undefined)?.effort, "high");
    assert.equal((bodies[1]?.reasoning as { readonly summary?: string } | undefined)?.summary, "auto");

    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "gpt-4.1" },
    });
    const unsupportedStart = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "不支持 reasoning effort", aiMode: "openai-responses", openAI: { reasoningEffort: "high" } },
    });
    const failed = await waitForRun(
      server.url,
      unsupportedStart.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );
    assert.equal(bodies.length, 2);
    assert.equal(failed.body.error.code, "unsupported_model_reasoning_effort");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop default run uses Responses mode and fails at config boundary instead of fake fallback", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-default-openai-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called before desktop config is complete");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Start with the recommended real AI entry." },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.tracking.provider.requestedMode, "openai-responses");
    assert.equal(failed.body.error.code, "missing_api_key");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.body.summary.ai.eventCounts.requested, 0);
    assert.equal(failed.text.includes("fake_provider"), false);
    assert.equal(failed.text.includes('"status":"approved"'), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop default ignores legacy fake setting and still recommends real AI boundary", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-legacy-fake-default-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called before desktop config is complete");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { defaultAiMode: "fake" },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Legacy fake settings should not become the Desktop product default." },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.tracking.provider.defaultAiMode, "openai-responses");
    assert.equal(failed.body.tracking.provider.requestedMode, "openai-responses");
    assert.equal(failed.text.includes("fake_provider"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop default run follows the active chat-compatible profile mode", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-default-chat-profile-"));
  const secret = "sk-desktop-default-chat-profile-secret";
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const providerFetch: PanelProviderFetch = async (url, init) => {
    urls.push(String(url));
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return createOpenAiTextResponse("deepseek-v4-pro", "ok");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-profiles", {
      method: "POST",
      body: {
        profileId: "deepseek",
        label: "DeepSeek",
        providerKind: "openai_compatible",
        protocolKind: "openai_compatible_chat_completions",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: secret,
      },
    });
    await requestJson(server.url, "/api/config/model-profiles/deepseek/activate", { method: "POST" });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Use the active provider default mode." },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.body.tracking.provider.requestedMode, "openai-compatible");
    assert.equal(completed.body.tracking.provider.requestedMode, "openai-compatible");
    assert.equal(completed.body.tracking.provider.protocolKind, "openai_compatible_chat_completions");
    assert.equal(urls[0]?.endsWith("/chat/completions"), true);
    assert.equal(Array.isArray(bodies[0]?.messages), true);
    assert.equal(bodies[0]?.input, undefined);
    assert.equal(bodies[0]?.reasoning, undefined);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop provider HTTP 400 surfaces provider error message directly", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-http400-friendly-"));
  const secret = "sk-desktop-http400-friendly-secret";
  const providerFetch: PanelProviderFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "model is not available on this endpoint" } }),
  });
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-http400-model",
        apiKey: secret,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "桌面文件，你看看", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(start.body.conversation.conversationId)}`
    );
    const events = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.run.runId)}/events?cursor=0`
    );
    const runtimeRun = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.snapshot?.run?.status === "failed",
      4_000,
      "/api/runtime/runs"
    );
    const assistantTurn = conversation.body.conversation.turns.at(-1);
    const eventText = JSON.stringify(events.body.events);
    const conversationText = JSON.stringify(failed.body.conversation);

    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.message, "model is not available on this endpoint");
    assert.equal(failed.body.capabilityResolution.agentId, "desktop-agent-session");
    assert.deepEqual(failed.body.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(runtimeRun.body.snapshot.run.capabilityResolution.toolVisibilityProfileId, DESKTOP_ROOT_AGENT.toolVisibilityProfile.profileId);
    assert.equal(JSON.stringify(runtimeRun.body.snapshot.run.capabilityResolution).includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
    assert.equal(assistantTurn.content, "错误信息：model is not available on this endpoint");
    assert.equal(failed.body.error.message.includes("还没有配置模型名"), false);
    assert.equal(assistantTurn.content.includes("还没有配置模型名"), false);
    assert.equal(eventText.includes("model is not available on this endpoint"), true);
    assert.equal(eventText.includes("OpenAI-compatible 返回 HTTP 400"), false);
    assert.equal(eventText.includes("failure="), false);
    assert.equal(eventText.includes("validation="), false);
    assert.equal(eventText.includes("protocol="), false);
    assert.equal(eventText.includes("model=desktop-http400-model"), false);
    assert.equal(conversationText.includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(conversationText.includes("model is not available on this endpoint"), true);
    assert.equal(conversationText.includes(secret), false);
    assert.equal(eventText.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop responses provider HTTP failure surfaces provider error message directly", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-responses-http404-friendly-"));
  const secret = "sk-desktop-responses-http404-secret";
  const providerFetch: PanelProviderFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: { message: "Cannot POST /v1/responses" } }),
  });
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "desktop-responses-http404-model",
        apiKey: secret,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试 responses 错误显示" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );
    const events = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.run.runId)}/events?cursor=0`
    );
    const eventText = JSON.stringify(events.body.events);
    const conversationText = JSON.stringify(failed.body.conversation);

    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.message, "Cannot POST /v1/responses");
    assert.equal(conversationText.includes("Cannot POST /v1/responses"), true);
    assert.equal(eventText.includes("Cannot POST /v1/responses"), true);
    assert.equal(eventText.includes("OpenAI Responses 返回 HTTP 404"), false);
    assert.equal(eventText.includes("OpenAI Responses provider returned HTTP 404"), false);
    assert.equal(eventText.includes("failure="), false);
    assert.equal(eventText.includes("validation="), false);
    assert.equal(eventText.includes("protocol="), false);
    assert.equal(eventText.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop run accepts context refs, permission refs, and readonly previews in Task Soil canvas", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-context-refs-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "Use explicit Task Soil refs.",
        aiMode: "fake",
        taskSoil: {
          contextRefs: [
            {
              ref: "file:src/app/panel-assets.ts",
              kind: "file",
              summary: "Panel source ref only.",
              readonlyPreview: {
                title: "panel-assets",
                text: "Short readonly preview from the user-selected file.",
              },
            },
            {
              ref: "https://example.test/spec",
              kind: "web",
              summary: "External spec URL ref.",
            },
          ],
          permissionBoundaryRefs: ["read:file:src/app/panel-assets.ts", "ask:before-write"],
        },
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const refs = completed.body.canvas.taskSoil.contextRefs;
    const fileRef = refs.find((ref: { ref: string }) => ref.ref === "file:src/app/panel-assets.ts");

    assert.equal(completed.body.status, "completed");
    assert.equal(refs.some((ref: { kind: string }) => ref.kind === "user_goal"), true);
    assert.notEqual(fileRef, undefined);
    assert.equal(fileRef.readonlyPreview.text, "Short readonly preview from the user-selected file.");
    assert.equal(completed.body.canvas.taskSoil.permissionBoundaryRefs.includes("read:file:src/app/panel-assets.ts"), true);
    assert.equal(completed.body.canvas.taskSoil.permissionBoundaryRefs.includes("ask:before-write"), true);
    assertSafePanelJsonText(JSON.stringify(completed.body.canvas));
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop canvas preserves Task Soil preview text", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-context-preview-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "Redact preview material.",
        aiMode: "fake",
        taskSoil: {
          contextRefs: [
            {
              ref: "file:notes/preview.md",
              kind: "file",
              summary: "summary api_key=panel-api-value",
              readonlyPreview: {
                title: "token: title-token-value",
                text: "Authorization: Bearer preview-token-value and password=panel-password-value",
              },
            },
          ],
          permissionBoundaryRefs: ["read:file:notes/preview.md"],
        },
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const canvasText = JSON.stringify(completed.body.canvas);

    assert.equal(canvasText.includes("panel-api-value"), true);
    assert.equal(canvasText.includes("title-token-value"), true);
    assert.equal(canvasText.includes("preview-token-value"), true);
    assert.equal(canvasText.includes("panel-password-value"), true);
    assert.equal(canvasText.includes("[redacted-secret]"), false);
    assert.equal(canvasText.includes("[redacted-token]"), false);
    assertSafePanelJsonText(canvasText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop run rejects unauthorized context refs before creating a run job", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-invalid-context-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const rejected = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: "Try to pass runtime refs.",
        aiMode: "fake",
        contextRefs: [{ ref: "runtime:store/live", kind: "workspace" }],
      },
    });

    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, "unauthorized_context_ref");
    assert.equal(rejected.text.includes('"status":"approved"'), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop aiMode none fails at boundary and does not approve a Plan", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-none-"));
  const secret = "sk-desktop-none-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret, model: "unused-desktop-model" },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Attempt a disabled Desktop Shell run.", aiMode: "none" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(start.status, 202);
    assert.equal(failed.body.runKind, "desktop");
    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.code, "ai_disabled");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.text.includes(secret), false);
    assert.equal(failed.text.includes('"status":"approved"'), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop openai-compatible missing config fails before provider fetch", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-missing-key-"));
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called for missing desktop config");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "desktop-openai-model" },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell run with missing key.", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.error.code, "missing_api_key");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.body.summary.ai.eventCounts.requested, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop openai-compatible missing model fails before provider fetch without exposing config secret", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-missing-model-"));
  const secret = "sk-desktop-missing-model-secret";
  let fetchCalls = 0;
  const providerFetch: PanelProviderFetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not be called for missing desktop model");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Build a Desktop Shell run with missing model.", aiMode: "openai-compatible" },
    });
    const failed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "failed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(fetchCalls, 0);
    assert.equal(failed.body.error.code, "missing_model_name");
    assert.equal(failed.body.canvas, undefined);
    assert.equal(failed.text.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop canvas, tracking, transcript, and SSE expose only runtime projections", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-safe-"));
  const secret = "sk-desktop-safe-secret";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "unused-desktop-safe-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "需要 Plan 和 Fruit，但不要泄漏模型内部材料。", aiMode: "fake" },
    });
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const safeText = `${JSON.stringify({
      canvas: completed.body.canvas,
      tracking: completed.body.tracking,
      transcript: completed.body.transcript,
    })}\n${stream.text}`;

    assert.equal(stream.status, 200);
    assert.equal(stream.events.some((event) => event.type === "final.result"), true);
    assert.equal(safeText.includes(secret), false);
    assert.equal(safeText.includes("rawPrompt"), false);
    assert.equal(safeText.includes("raw_prompt"), false);
    assert.equal(safeText.includes("sanitizedMessages"), false);
    assert.equal(safeText.includes("Return JSON only"), false);
    assert.equal(safeText.includes("raw provider response"), false);
    assert.equal(safeText.includes("hidden reasoning"), false);
    assert.equal(safeText.includes("raw tool output"), false);
    assertSafePanelJsonText(safeText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop openai-compatible ordinary agent uses configured search tool before answering", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-configured-tools-"));
  const modelSecret = "sk-desktop-configured-tools-secret";
  const tavilySecret = "tvly-desktop-configured-tools-secret";
  let modelFetchCalls = 0;
  let tavilyFetchCalls = 0;
  const providerFetch: PanelProviderFetch = async (url, init) => {
    if (url === "https://api.tavily.com/search") {
      tavilyFetchCalls += 1;
      const body = JSON.parse(init.body) as { api_key?: string; max_results?: number };
      assert.equal(body.api_key, tavilySecret);
      assert.equal(body.max_results, 1);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Desktop assistant tool evidence",
              url: "https://example.test/desktop-agent",
              content: "Desktop ordinary agent configured search evidence.",
            },
          ],
        }),
      };
    }

    modelFetchCalls += 1;
    const body = parseResponsesRequestBody(init.body);
    const hasToolMessage = hasResponsesToolOutput(body);
    return hasToolMessage
      ? createOpenAiTextResponse(
          "desktop-configured-tools-model",
          "我已经结合授权搜索结果完成回答；工具输出会作为工具结果和引用进入本轮对话。"
        )
      : hasResponsesToolDefinition(body, "search")
        ? createOpenAiSearchToolCallResponse()
        : createOpenAiTextResponse("desktop-configured-tools-model", "已完成无工具回答。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "gpt-4o-mini",
        apiKey: modelSecret,
      },
    });
    await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: tavilySecret,
        maxResults: 1,
      },
    });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "Use configured tools in the Desktop assistant.", aiMode: "openai-compatible", runMode: "agent" },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );

    assert.equal(completed.body.canvas.kind, "desktop_agent_canvas");
    assert.equal(modelFetchCalls, 2);
    assert.equal(tavilyFetchCalls, 1);
    assert.equal(completed.body.canvas.agent.answer.answer.includes("授权搜索结果"), true);
    assert.equal(completed.body.canvas.agent.toolCallRefs.includes("call-panel-search"), true);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "tool.requested"), true);
    assert.equal(completed.body.transcript.events.some((event: { type: string }) => event.type === "model.output.completed"), true);
    assert.equal(completed.body.trace.events.some((event: { type: string }) => event.type === "tool.completed"), true);
    assert.equal(JSON.stringify(completed.body).includes(modelSecret), false);
    assert.equal(JSON.stringify(completed.body).includes(tavilySecret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});
