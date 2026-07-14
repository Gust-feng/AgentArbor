import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
} from "../../../adapters/runtime-database/index.js";
import { startLocalPanelServer, type PanelProviderFetch } from "../../panel-server.js";
import {
  assertSafePanelJsonText,
  openAndAbortSse,
  removeTemporaryTree,
  readSseUntil,
  requestJson,
  requestSse,
  waitForRun,
} from "./panel-server-test-utils.js";
import {
  createOpenAiReadFileToolCallResponse,
  createOpenAiChatStreamTextResponse,
  createOpenAiStreamReasoningTextResponse,
  createOpenAiStreamTextResponse,
  createOpenAiTextResponse,
  createStubOpenAiResponse,
} from "../../testing/openai-test-fixtures.js";

test("desktop live model stream preserves markdown structure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-markdown-stream-"));
  const secret = "sk-markdown-stream-secret";
  const providerFetch: PanelProviderFetch = async () =>
    createOpenAiStreamTextResponse("markdown-stream-model", [
      "可以：",
      "\n\n",
      "- **第一项**：保留列表",
      "\n",
      "- **第二项**：保留加粗",
    ]);
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "markdown-stream-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "用 Markdown 回答", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    const conversationId = start.body.conversation.conversationId;
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(runId)}/stream?cursor=0`);
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const joinedDeltas = stream.events
      .filter((event) => event.type === "model.output.delta" && event.agentLabel === "助手")
      .map((event) => event.delta ?? "")
      .join("");
    const assistantTurn = conversation.body.conversation.turns[1];

    assert.equal(joinedDeltas.includes("\n\n- **第一项**：保留列表\n- **第二项**：保留加粗"), true);
    assert.equal(assistantTurn.content.includes("\n\n- **第一项**：保留列表\n- **第二项**：保留加粗"), true);
    assert.equal(stream.text.includes(secret), false);
    assertSafePanelJsonText(`${stream.text}\n${conversation.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop live model stream does not repeat markdown blocks from cumulative snapshots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-cumulative-chat-stream-"));
  const secret = "sk-cumulative-chat-stream-secret";
  const snapshots = [
    "## 能力演示总结\n\n刚才",
    "## 能力演示总结\n\n刚才我实时展示",
    "## 能力演示总结\n\n刚才我实时展示了以下 5 项能力：\n\n| # | 能力 | 做了什么 |\n| - | - | - |\n| 1 | 浏览目录 | 查看项目结构 |",
  ];
  const providerFetch: PanelProviderFetch = async () =>
    createOpenAiChatStreamTextResponse("cumulative-chat-stream-model", snapshots);
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "cumulative-chat-stream-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "实时展示能力", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    const conversationId = start.body.conversation.conversationId;
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(runId)}/stream?cursor=0`);
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const assistantTurn = conversation.body.conversation.turns[1];
    const joinedDeltas = stream.events
      .filter((event) => event.type === "model.output.delta" && event.agentLabel === "助手")
      .map((event) => event.delta ?? "")
      .join("");

    assert.equal(assistantTurn.content, snapshots.at(-1));
    assert.equal(joinedDeltas, snapshots.at(-1));
    assert.equal(assistantTurn.content.split("## 能力演示总结").length - 1, 1);
    assert.equal(joinedDeltas.split("## 能力演示总结").length - 1, 1);
    assert.equal(stream.text.includes(secret), false);
    assertSafePanelJsonText(`${stream.text}\n${conversation.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop work view completes streamed reasoning without replaying it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-reasoning-stream-"));
  const secret = "sk-reasoning-stream-secret";
  const reasoningText = "先确认问题";
  const answerText = "答案已经整理完成。";
  const providerFetch: PanelProviderFetch = async () =>
    createOpenAiStreamReasoningTextResponse("reasoning-stream-model", [
      { kind: "reasoning", delta: reasoningText },
      { kind: "output", delta: answerText },
    ]);
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "reasoning-stream-model",
        apiKey: secret,
      },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "请先思考再回答", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    const completed = await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const workView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/work-view`
    );
    const events = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/events?cursor=0`
    );
    const thinkingNodes = workView.body.workView.transcriptNodes.filter(
      (node: { kind?: string; eventType?: string }) =>
        node.kind === "thinking" && node.eventType?.startsWith("model.reasoning") === true
    );
    const completedTranscriptThinkingNodes = completed.body.transcript.transcriptNodes.filter(
      (node: { kind?: string; eventType?: string }) =>
        node.kind === "thinking" && node.eventType?.startsWith("model.reasoning") === true
    );

    assert.equal(
      events.body.events.some((event: { type?: string }) => event.type === "model.reasoning.delta"),
      true
    );
    assert.equal(
      events.body.events.some((event: { type?: string }) => event.type === "model.output.delta"),
      true
    );
    assert.equal(
      events.body.events.some((event: { type?: string }) => event.type === "model.reasoning.completed"),
      true
    );
    assert.equal(thinkingNodes.length, 1);
    assert.equal(thinkingNodes[0]?.eventType, "model.reasoning.completed");
    assert.equal(thinkingNodes[0]?.phase, "completed");
    assert.equal(thinkingNodes[0]?.text, reasoningText);
    assert.equal(completedTranscriptThinkingNodes.length, 1);
    assert.equal(completedTranscriptThinkingNodes[0]?.eventType, "model.reasoning.completed");
    assert.equal(JSON.stringify(workView.body.workView.transcriptNodes).includes(`${reasoningText}${reasoningText}`), false);
    assert.equal("workSession" in workView.body, false);
    assertSafePanelJsonText(`${completed.text}\n${workView.text}\n${events.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation stream stays live even when profile saved openAI.stream false", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-force-live-stream-"));
  const secret = "sk-force-live-stream-secret";
  const requestedStreams: boolean[] = [];
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    requestedStreams.push((JSON.parse(init.body ?? "{}") as { readonly stream?: boolean }).stream === true);
    return createOpenAiStreamTextResponse("force-live-model", [
      "第一段实时输出",
      "，随后继续补充。",
    ]);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "force-live-model",
        apiKey: secret,
        openAI: {
          stream: false,
        },
      },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "请实时回答", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    const earlyStream = await readSseUntil(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/stream?cursor=0`,
      (events) => events.some((event) => event.type === "model.output.delta")
    );

    assert.equal(requestedStreams.includes(true), true);
    assert.equal(earlyStream.events.some((event) => event.type === "model.output.delta"), true);
    assert.equal(earlyStream.events.some((event) => event.type === "final.result"), false);

    const completed = await waitForRun(
      server.url,
      runId,
      (body) => body.run.status === "completed",
      4_000,
      "/api/basic-agent/runs"
    );
    assert.equal(completed.body.run.status, "completed");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("desktop run stream carries safe tool detail through runtime persistence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-tool-detail-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-desktop-tool-detail-workspace-"));
  const secret = "sk-tool-detail-secret";
  const rawToolOutput = "RAW_TOOL_OUTPUT_SENTINEL must not reach panel stream or runtime persistence.";
  await fs.writeFile(path.join(workspace, "notes.md"), rawToolOutput, "utf8");
  let desktopAgentProviderCalls = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const requestText = init.body ?? "";
    if (!requestText.includes("read_file")) {
      return createOpenAiTextResponse("desktop-tool-detail-model", "无需工具的辅助请求。");
    }
    desktopAgentProviderCalls += 1;
    return desktopAgentProviderCalls === 1
      ? createOpenAiReadFileToolCallResponse("notes.md")
      : createOpenAiTextResponse("desktop-tool-detail-model", "已读取授权文件并形成摘要。");
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
      body: { goal: "读取 notes.md 并总结", aiMode: "openai-compatible" },
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
        Array.isArray(body.snapshot?.toolCalls) &&
        body.snapshot.toolCalls.some((call: { toolName?: string }) => call.toolName === "read_file"),
      4_000,
      "/api/runtime/runs"
    );
    const readEvent = completed.body.transcript.events.find(
      (event: { type: string; toolName?: string }) => event.type === "tool.completed" && event.toolName === "read_file"
    );
    const persistedCall = runtimeRun.body.snapshot.toolCalls.find(
      (call: { toolName?: string }) => call.toolName === "read_file"
    );

    assert.notEqual(readEvent, undefined);
    assert.notEqual(persistedCall, undefined);
    assert.equal(readEvent.detail?.kind, "tool");
    assert.equal(readEvent.detail?.path, "notes.md");
    assert.equal(readEvent.detail?.display?.kind, "read_result");
    assert.equal(typeof readEvent.detail?.preview, "string");
    assert.equal((readEvent.detail?.preview ?? "").length > 0, true);
    assert.equal(readEvent.detail?.preview?.includes("notes.md"), true);
    assert.equal(readEvent.detail?.preview?.includes("文件正文只进入本轮工具上下文"), false);
    assert.equal(readEvent.detail?.preview?.includes(rawToolOutput), false);
    assert.equal(persistedCall.status, "completed");
    assert.equal("path" in persistedCall, false);
    assert.equal("preview" in persistedCall, false);
    assert.equal("display" in persistedCall, false);
    assert.equal(JSON.stringify(readEvent).includes("raw provider payload"), false);
    assert.equal(completed.text.includes(rawToolOutput), false);
    assert.equal(runtimeRun.text.includes(rawToolOutput), false);
    const basicEvents = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.runId)}/events?cursor=0`
    );
    assert.equal(
      basicEvents.body.events.some((event: { type: string; summary?: string }) =>
        event.type === "tool.completed" && (event.summary ?? "").includes("notes.md")
      ),
      true
    );
    assert.equal(JSON.stringify(basicEvents.body.events).includes(rawToolOutput), false);
    assertSafePanelJsonText(completed.text);
    assertSafePanelJsonText(runtimeRun.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("panel stream ends completed runs with final result and no run failed event", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-completed-stream-terminal-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const stream = await requestSse(server.url, `/api/desktop/runs/${encodeURIComponent(start.body.runId)}/stream?cursor=0`);
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const eventTypes = stream.events.map((event) => event.type);

    assert.equal(completed.body.status, "completed");
    assert.equal(eventTypes.at(-1), "final.result");
    assert.equal(eventTypes.includes("run.failed"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("panel persists completed Desktop Agent runs to the local RuntimeDatabase projection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-runtime-db-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-runtime-workspace-"));
  const secret = "sk-runtime-db-secret";
  const bearer = "runtime-db-token-value";
  const password = "runtime-db-password-value";
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        model: "runtime-db-model",
        defaultAiMode: "fake",
        apiKey: secret,
      },
    });
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });

    const start = await requestJson(server.url, "/api/desktop/runs", {
      method: "POST",
      body: {
        goal: `总结当前工作区。Authorization: Bearer ${bearer} password=${password} ${secret}`,
        aiMode: "fake",
        runMode: "agent",
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const paths = resolveAgentArborRuntimeDatabasePaths(directory);
    const database = new FileSystemRuntimeDatabase(paths);
    const snapshot = await database.getRun(start.body.runId);
    const persistedText = JSON.stringify(snapshot);

    assert.equal(start.status, 202);
    assert.equal(completed.body.status, "completed");
    assert.equal(server.runtimeDirectory, paths.runtimeHome);
    assert.equal(snapshot?.run.runKind, "desktop");
    assert.equal(snapshot?.run.runMode, "agent");
    assert.equal(snapshot?.run.status, "completed");
    assert.equal(snapshot?.run.workspacePath, path.resolve(workspace));
    assert.equal(snapshot?.workspace?.path, path.resolve(workspace));
    assert.equal(path.resolve(snapshot?.run.runHome ?? "").startsWith(path.resolve(paths.runtimeHome)), true);
    assert.equal(path.resolve(snapshot?.run.runHome ?? "").startsWith(path.resolve(workspace)), false);
    assert.equal(snapshot?.events.some((event) => event.type === "goal.received"), true);
    assert.equal(snapshot?.events.some((event) => event.type === "model.requested"), true);
    assert.equal((snapshot?.modelCalls.length ?? 0) > 0, true);
    assert.equal(persistedText.includes(secret), true);
    assert.equal(persistedText.includes(bearer), true);
    assert.equal(persistedText.includes(password), true);
    assert.equal(persistedText.includes("[redacted-secret]"), false);
    assert.equal(persistedText.includes("sanitizedMessages"), false);
    assert.equal(persistedText.includes("raw provider response"), false);
    assert.equal(persistedText.includes("raw tool output"), false);
    assertSafePanelJsonText(persistedText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});
