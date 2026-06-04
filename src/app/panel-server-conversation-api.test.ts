import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
} from "../adapters/runtime-database/index.js";
import type { RuntimeDatabase } from "../domain/runtime-database/index.js";
import { startLocalPanelServer, type PanelProviderFetch } from "./panel-server.js";
import {
  assertSafePanelJsonText,
  removeTemporaryTree,
  readSseUntil,
  requestJson,
  waitForRun,
} from "./panel-server-test-utils.js";
import {
  createOpenAiTextResponse,
  extractResponsesMessages,
  parseResponsesRequestBody,
  responsesRequestText,
  type ResponsesRequestBody,
} from "./panel-openai-test-fixtures.js";

test("conversation message returns before provider completion so the UI can subscribe before output", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-early-stream-"));
  const secret = "sk-conversation-early-stream-secret";
  let releaseProvider: (() => void) | undefined;
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    await providerGate;
    return createOpenAiTextResponse("conversation-early-stream-model", "稍后返回的完整答案。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-early-stream-model",
        apiKey: secret,
      },
    });

    const startedAt = Date.now();
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试对话流式启动", aiMode: "openai-compatible" },
    });
    const elapsedMs = Date.now() - startedAt;
    const runId = start.body.run.runId;
    const earlyStream = await readSseUntil(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/stream?cursor=0`,
      (events) => events.some((event) => event.type === "run.started"),
      2_000
    );

    assert.equal(start.status, 202);
    assert.equal(elapsedMs < 1_000, true);
    assert.equal(start.body.conversation.turns[1].status, "running");
    assert.equal(start.body.conversation.turns[1].runId, runId);
    assert.equal(earlyStream.status, 200);
    assert.equal(earlyStream.events.some((event) => event.type === "run.started"), true);

    releaseProvider?.();
    const completed = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    assert.equal(completed.body.status, "completed");
    assertSafePanelJsonText(`${start.text}\n${earlyStream.text}\n${completed.text}`);
  } finally {
    releaseProvider?.();
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation message returns before slow initial persistence settles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-slow-persistence-"));
  let releasePersistence: (() => void) | undefined;
  let upsertRunStarted = false;
  let upsertRunCompleted = false;
  const persistenceGate = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });
  const runtimeDatabase = delayedRuntimeDatabase({
    async upsertRun(record) {
      upsertRunStarted = true;
      await persistenceGate;
      upsertRunCompleted = true;
      return record;
    },
  });
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, runtimeDatabase });
  try {
    const startedAt = Date.now();
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试慢持久化不阻塞首字", aiMode: "fake" },
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(start.status, 202);
    assert.equal(typeof start.body.run.runId, "string");
    assert.equal(elapsedMs < 500, true);
    assert.equal(upsertRunStarted, true);
    assert.equal(upsertRunCompleted, false);
  } finally {
    releasePersistence?.();
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API creates a conversation and attaches the desktop run to assistant turn", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-create-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const runId = start.body.run.runId;
    const conversationId = start.body.conversation.conversationId;
    const completed = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);

    assert.equal(start.status, 202);
    assert.equal(start.body.conversation.turns.length, 2);
    assert.equal(start.body.conversation.turns[0].role, "user");
    assert.equal(start.body.conversation.turns[1].role, "assistant");
    assert.equal(start.body.run.runKind, "desktop");
    assert.equal(completed.body.conversation.conversationId, conversationId);
    assert.equal(conversation.body.conversation.turns.length, 2);
    assert.equal(conversation.body.conversation.turns[1].runId, runId);
    assert.equal(conversation.body.conversation.turns[1].content.includes("我可以直接回答问题"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("context attachment preview feeds the Basic Agent work session read model safely", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-work-session-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-workspace-"));
  const fileBody = "private body with sk-work-session-secret";
  await fs.writeFile(path.join(workspace, "notes.md"), fileBody, "utf8");
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: workspace },
    });
    const preview = await requestJson(server.url, "/api/context/attachments/preview", {
      method: "POST",
      body: { kind: "file", value: "notes.md" },
    });
    const invalidKind = await requestJson(server.url, "/api/context/attachments/preview", {
      method: "POST",
      body: { kind: "runtime", value: "notes.md" },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "请基于附件做一个简短总结",
        aiMode: "fake",
        taskSoilInput: {
          contextRefs: [{
            ref: preview.body.attachment.ref,
            kind: preview.body.attachment.kind,
            summary: preview.body.attachment.summary,
          }],
          permissionBoundaryRefs: preview.body.attachment.permissionRefs,
        },
      },
    });
    const runId = start.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const workSession = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/work-session`);

    assert.equal(preview.status, 200);
    assert.equal(preview.body.attachment.ref, "file:notes.md");
    assert.equal(preview.text.includes(fileBody), false);
    assert.equal(invalidKind.status, 400);
    assert.equal(invalidKind.body.error.code, "invalid_context_attachment_kind");
    assert.equal(workSession.status, 200);
    assert.equal(workSession.body.workSession.stage, "completed");
    assert.equal(workSession.body.workSession.contextAttachments.some((item: { ref?: string }) => item.ref === "file:notes.md"), true);
    assert.equal(typeof workSession.body.workSession.answer?.content, "string");
    assert.equal(workSession.body.workSession.deliverable, undefined);
    assert.equal(workSession.text.includes(fileBody), false);
    assertSafePanelJsonText(workSession.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("conversation summaries do not turn missing local context into synthetic confirmation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-confirmation-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "帮我看看桌面文件", aiMode: "fake" },
    });
    const runId = start.body.run.runId;
    const conversationId = start.body.conversation.conversationId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversations = await requestJson(server.url, "/api/conversations");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const summary = conversations.body.conversations.find(
      (item: { conversationId: string }) => item.conversationId === conversationId
    );

    assert.equal(conversation.body.conversation.requiresUserAction, false);
    assert.equal(summary?.requiresUserAction, false);
    assert.equal(conversation.body.conversation.turns[1].title, "已完成");
    assert.equal(conversation.body.conversation.turns[1].content.includes("文件或文件夹"), true);
    assert.deepEqual(runtimeRun.body.snapshot.confirmations, []);
    assert.equal(JSON.stringify(runtimeRun.body.snapshot.confirmations).includes("sk-"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API keeps follow-up messages in the same conversation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-follow-up-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "那你能继续解释一下吗？", aiMode: "fake" },
      }
    );
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(second.status, 202);
    assert.equal(second.body.conversation.conversationId, first.body.conversation.conversationId);
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.equal(conversation.body.conversation.turns[2].role, "user");
    assert.equal(conversation.body.conversation.turns[2].content.includes("继续解释"), true);
    assert.equal(conversation.body.conversation.turns[3].role, "assistant");
    assert.equal(conversation.body.conversation.turns[3].content.includes("继续"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API rolls back completed turns before continuing the same conversation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-rollback-"));
  const requests: ResponsesRequestBody[] = [];
  let callIndex = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    callIndex += 1;
    const body = parseResponsesRequestBody(init.body);
    requests.push(body);
    return createOpenAiTextResponse("conversation-rollback-model", `第 ${callIndex} 轮安全回答。`);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-rollback-model",
        apiKey: "sk-conversation-rollback-secret",
      },
    });
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第一轮", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversationId = first.body.conversation.conversationId;

    const second = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: { goal: "第二轮", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const third = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: { goal: "第三轮需要回退", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, third.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const rolledBack = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/rollback`, {
      method: "POST",
      body: { stepsBack: 1 },
    });
    assert.equal(rolledBack.status, 200);
    assert.equal(rolledBack.body.conversation.turns.length, 4);
    assert.equal(JSON.stringify(rolledBack.body.conversation).includes("第三轮需要回退"), false);

    const fourth = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: { goal: "回退后继续", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, fourth.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const after = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const latestMessages = extractResponsesMessages(requests.at(-1));
    const latestText = JSON.stringify(latestMessages);

    assert.equal(after.body.conversation.turns.length, 6);
    assert.equal(latestText.includes("第一轮"), true);
    assert.equal(latestText.includes("第二轮"), true);
    assert.equal(latestText.includes("第三轮需要回退"), false);
    assert.equal(latestText.includes("Current user message: 回退后继续"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API sends follow-up history as role-separated model messages", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-structured-history-"));
  const secret = "sk-conversation-structured-history-secret";
  const requests: ResponsesRequestBody[] = [];
  let callIndex = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    callIndex += 1;
    const body = parseResponsesRequestBody(init.body);
    requests.push(body);
    return createOpenAiTextResponse(
      "conversation-structured-history-model",
      callIndex === 1
        ? "我可以直接回答问题，也可以在授权范围内读取文件或网页。"
        : "可以继续。我会按前文说明继续回答，不把这轮追问包装成深度模式。"
    );
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-structured-history-model",
        apiKey: secret,
      },
    });
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "那你能继续解释一下吗？", aiMode: "openai-compatible" },
      }
    );
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const secondMessages = extractResponsesMessages(requests.at(-1));
    assert.deepEqual(secondMessages.map((message) => message.role), ["system", "user", "assistant", "user"]);
    assert.equal(secondMessages[1]?.content?.includes("你好，你能做什么"), true);
    assert.equal(secondMessages[2]?.content?.includes("我可以直接回答问题"), true);
    assert.equal(secondMessages[3]?.content?.includes("Current user message: 那你能继续解释一下吗？"), true);
    assert.equal(secondMessages[3]?.content?.includes("你好，你能做什么"), false);
    assert.equal(JSON.stringify(secondMessages).includes("workspace:conversation-history"), false);
    assert.equal(requests.at(-1)?.max_output_tokens ?? requests.at(-1)?.max_completion_tokens ?? requests.at(-1)?.max_tokens, 4000);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API exposes latest desktop run so completed result can be restored on reopen", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-latest-run-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake", runMode: "deep" },
    });
    const conversationId = started.body.conversation.conversationId;
    const runId = started.body.run.runId;
    const completed = await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(conversationId)}`
    );
    const latestRun = await requestJson(
      server.url,
      `/api/desktop/runs/${encodeURIComponent(conversation.body.conversation.latestRunId)}`
    );

    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.conversation.latestRunId, runId);
    assert.equal(conversation.body.conversation.activeRunId, undefined);
    assert.equal(latestRun.status, 200);
    assert.equal(latestRun.body.runId, runId);
    assert.equal(latestRun.body.runMode, "deep");
    assert.equal(latestRun.body.canvas.kind, "underground_deep_canvas");
    assert.equal(typeof latestRun.body.canvas.underground.recommendedDirection.summary, "string");
    assert.equal(latestRun.body.canvas.underground.recommendedDirection.summary.length > 0, true);
    assert.equal(completed.body.canvas.kind, "underground_deep_canvas");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation and desktop run APIs recover safe history from RuntimeDatabase after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-runtime-recover-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
      },
    });
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "你好，你能做什么？", aiMode: "fake" },
    });
    const conversationId = started.body.conversation.conversationId;
    const runId = started.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();
    const runtimePaths = resolveAgentArborRuntimeDatabasePaths(directory);
    const conversationPath = path.join(runtimePaths.runtimeHome, "conversations", `${encodeURIComponent(conversationId)}.json`);
    const legacyConversation = JSON.parse(await fs.readFile(conversationPath, "utf8")) as { turns?: Array<{ responseModel?: unknown }> };
    for (const turn of legacyConversation.turns ?? []) {
      delete turn.responseModel;
    }
    await fs.writeFile(conversationPath, `${JSON.stringify(legacyConversation, null, 2)}\n`, "utf8");

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const conversations = await requestJson(server.url, "/api/conversations");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const run = await requestJson(server.url, `/api/desktop/runs/${encodeURIComponent(runId)}`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);

    assert.equal(conversations.status, 200);
    assert.equal(conversations.body.conversations.some((item: { conversationId: string }) => item.conversationId === conversationId), true);
    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.conversation.latestRunId, runId);
    assert.equal(conversation.body.conversation.turns.length, 2);
    assert.equal(conversation.body.conversation.turns[1].content.includes("我可以直接回答问题"), true);
    assert.deepEqual(conversation.body.conversation.turns[1].responseModel, {
      profileId: "default",
      label: "OpenAI",
      providerKind: "openai_compatible",
      protocolKind: "openai_responses",
      baseUrl: "https://api.openai.com/v1",
      model: "fake-deterministic-model",
    });
    assert.equal(run.status, 200);
    assert.equal(run.body.restoredFromSnapshot, true);
    assert.equal(run.body.restoredResult.summary.includes("我可以直接回答问题"), true);
    assert.equal(run.body.transcript.events.some((event: { type: string }) => event.type === "agent.note.delta"), false);
    assert.equal(run.body.transcript.events.some((event: { type: string }) => event.type === "model.output.completed"), false);
    assert.equal(run.body.conversation.conversationId, conversationId);
    assert.equal(runtimeRun.body.snapshot.run.runId, runId);
    assertSafePanelJsonText(run.text);
    assertSafePanelJsonText(conversation.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation message POST restores persisted conversation after restart and sends safe prior turn history", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-post-recover-"));
  const secret = "sk-conversation-post-recover-secret";
  const providerRequests: ResponsesRequestBody[] = [];
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const body = parseResponsesRequestBody(init.body);
    providerRequests.push(body);
    return providerRequests.length === 1
      ? createOpenAiTextResponse("conversation-post-recover-model", "第一轮安全回答。")
      : createOpenAiTextResponse("conversation-post-recover-model", "第二轮安全回答。");
  };
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-post-recover-model",
        apiKey: secret,
      },
    });

    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第一轮问题", aiMode: "openai-compatible" },
    });
    const conversationId = first.body.conversation.conversationId;
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();

    server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "第二轮问题", aiMode: "openai-compatible" },
      }
    );
    const completed = await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const secondMessages = extractResponsesMessages(providerRequests[1]);

    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(completed.body.status, "completed");
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.deepEqual(secondMessages.map((message) => message.role), ["system", "user", "assistant", "user"]);
    assert.equal(secondMessages[1]?.content?.includes("第一轮问题"), true);
    assert.equal(secondMessages[2]?.content?.includes("第一轮安全回答"), true);
    assert.equal(secondMessages[3]?.content?.includes("Current user message: 第二轮问题"), true);
    assert.equal(JSON.stringify(secondMessages).includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation restore trims interrupted tail before appending the next message", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-tail-trim-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第一轮完整问题", aiMode: "fake" },
    });
    const conversationId = first.body.conversation.conversationId;
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();

    const database = new FileSystemRuntimeDatabase(resolveAgentArborRuntimeDatabasePaths(directory));
    const persisted = await database.getConversation(conversationId);
    assert.notEqual(persisted, undefined);
    const interruptedAt = "2026-05-17T00:00:00.000Z";
    await database.upsertConversation({
      ...persisted!,
      status: "running",
      activeRunId: "run-interrupted-tail",
      latestRunId: "run-interrupted-tail",
      queuedRunIds: ["run-queued-after-interrupt"],
      queuedRunCount: 1,
      updatedAt: interruptedAt,
      turns: [
        ...persisted!.turns,
        {
          turnId: "turn-interrupted-user",
          role: "user",
          title: "你的消息",
          content: "断开的用户消息",
          status: "completed",
          createdAt: interruptedAt,
          updatedAt: interruptedAt,
        },
        {
          turnId: "turn-interrupted-assistant",
          role: "assistant",
          title: "助手",
          content: "断开的助手回复",
          status: "running",
          runId: "run-interrupted-tail",
          createdAt: interruptedAt,
          updatedAt: interruptedAt,
        },
      ],
    });

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "恢复后继续", aiMode: "fake" },
      }
    );
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const persistedAfter = await database.getConversation(conversationId);
    const visibleText = JSON.stringify(conversation.body.conversation);

    assert.equal(second.status, 202);
    assert.equal(second.body.conversation.turns.length, 4);
    assert.equal(second.body.conversation.turns[2].content, "恢复后继续");
    assert.equal(JSON.stringify(second.body.conversation).includes("断开的用户消息"), false);
    assert.equal(JSON.stringify(second.body.conversation).includes("断开的助手回复"), false);
    assert.equal(conversation.body.conversation.activeRunId, undefined);
    assert.equal(conversation.body.conversation.queuedRunCount, 0);
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.equal(conversation.body.conversation.turns[2].content, "恢复后继续");
    assert.equal(visibleText.includes("断开的用户消息"), false);
    assert.equal(visibleText.includes("断开的助手回复"), false);
    assert.equal(persistedAfter?.turns.length, 4);
    assert.equal(JSON.stringify(persistedAfter).includes("断开的助手回复"), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API queues follow-up while the same conversation is still running", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-queue-"));
  const secret = "sk-conversation-queue-secret";
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    await fetchGate;
    return createOpenAiTextResponse("conversation-queue-model", "第一轮已经完成。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-queue-model",
        apiKey: secret,
      },
    });
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "先回答第一轮", aiMode: "openai-compatible" },
    });
    await waitForRun(
      server.url,
      first.body.run.runId,
      (body) => body.status === "running" && body.trace.events.some((event: { type: string }) => event.type === "model.requested"),
      4_000,
      "/api/desktop/runs"
    );
    const queued = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "继续", aiMode: "fake" },
      }
    );
    const duringFirst = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(first.status, 202);
    assert.equal(queued.status, 202);
    assert.equal(queued.body.run.status, "pending");
    assert.equal(queued.body.conversation.queuedRunIds.includes(queued.body.run.runId), true);
    assert.equal(duringFirst.body.conversation.turns.length, 4);
    assert.equal(duringFirst.body.conversation.turns[2].status, "pending");
    assert.equal(duringFirst.body.conversation.turns[3].status, "pending");

    releaseFetch?.();
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const completedQueued = await waitForRun(
      server.url,
      queued.body.run.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(completedQueued.body.status, "completed");
    assert.equal(conversation.body.conversation.activeRunId, undefined);
    assert.equal(conversation.body.conversation.queuedRunCount, 0);
    assert.equal(conversation.body.conversation.turns.length, 4);
    assert.equal(conversation.body.conversation.turns[2].status, "completed");
    assert.equal(conversation.body.conversation.turns[3].status, "completed");
  } finally {
    releaseFetch?.();
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API refreshes active task summaries while a run is still running", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-running-summary-"));
  const secret = "sk-conversation-running-summary-secret";
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const providerFetch: PanelProviderFetch = async () => {
    await fetchGate;
    return createOpenAiTextResponse("conversation-running-summary-model", "运行完成后的安全回答。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-running-summary-model",
        apiKey: secret,
      },
    });
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "请先分析一下当前任务", aiMode: "openai-compatible" },
    });
    await waitForRun(
      server.url,
      started.body.run.runId,
      (body) => body.status === "running" && body.trace.events.some((event: { type: string }) => event.type === "model.requested"),
      4_000,
      "/api/desktop/runs"
    );
    const conversations = await requestJson(server.url, "/api/conversations");
    const summary = conversations.body.conversations.find(
      (item: { conversationId: string }) => item.conversationId === started.body.conversation.conversationId
    );

    assert.equal(started.status, 202);
    assert.equal(summary?.status, "running");
    assert.equal(summary?.currentAction.includes("桌面助手已接手"), false);
    assert.equal(summary?.currentAction.includes("等待模型输出"), false);
    assert.equal(summary?.currentAction.includes(secret), false);
    assertSafePanelJsonText(conversations.text);
  } finally {
    releaseFetch?.();
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation follow-up after a provider failure does not feed internal ids back to the model", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-failure-followup-"));
  const secret = "sk-failure-followup-secret";
  const prompts: string[] = [];
  let callIndex = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    callIndex += 1;
    const body = parseResponsesRequestBody(init.body);
    prompts.push(responsesRequestText(body));
    if (callIndex === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad request" } }),
      };
    }
    return createOpenAiTextResponse(
      "failure-followup-model",
      "刚才模型服务没有返回可用结果。对于桌面文件，我需要你选择具体文件或给出只读引用，然后我才能继续看。"
    );
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "failure-followup-model",
        apiKey: secret,
      },
    });

    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "桌面文件，你看看", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "failed", 4_000, "/api/desktop/runs");

    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "?", aiMode: "openai-compatible" },
      }
    );
    const completed = await waitForRun(
      server.url,
      second.body.run.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const followupPrompt = prompts.at(-1) ?? "";
    const visibleConversation = JSON.stringify(completed.body.conversation);

    assert.equal(completed.body.status, "completed");
    assert.equal(completed.body.canvas.agent.answer.answer.includes("桌面文件"), true);
    assert.equal(followupPrompt.includes("桌面文件，你看看"), true);
    assert.equal(followupPrompt.includes("系统错误："), false);
    assert.equal(followupPrompt.includes("上一轮未生成助手回复"), false);
    assert.equal(followupPrompt.includes("不是助手输出"), false);
    assert.equal(followupPrompt.includes("bad request"), false);
    assert.equal(followupPrompt.includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(/\bgoal-\d+\b/.test(followupPrompt), false);
    assert.equal(/\bmodel-request-\d+\b/.test(followupPrompt), false);
    assert.equal(followupPrompt.includes("当前任务"), false);
    assert.equal(visibleConversation.includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(visibleConversation.includes("bad request"), true);
    assert.equal(/\bgoal-\d+\b/.test(visibleConversation), false);
    assert.equal(visibleConversation.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation history keeps safe failed turns and later completed turns after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-failed-history-"));
  const secret = "sk-failed-history-secret";
  const providerRequests: ResponsesRequestBody[] = [];
  let callIndex = 0;
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    callIndex += 1;
    const body = parseResponsesRequestBody(init.body);
    providerRequests.push(body);
    if (callIndex === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "first turn provider error" } }),
      };
    }
    return createOpenAiTextResponse(
      "failed-history-model",
      callIndex === 2 ? "第二轮安全回答。" : "第三轮安全回答。"
    );
  };
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "failed-history-model",
        apiKey: secret,
      },
    });

    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第一轮会失败", aiMode: "openai-compatible" },
    });
    const conversationId = first.body.conversation.conversationId;
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "failed", 4_000, "/api/desktop/runs");

    const second = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: { goal: "第二轮成功", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();

    server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
    const third = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: { goal: "第三轮应该知道前文", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, third.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const thirdMessages = extractResponsesMessages(providerRequests.at(-1));
    const thirdPrompt = JSON.stringify(thirdMessages);

    assert.equal(conversation.body.conversation.turns.length, 6);
    assert.equal(conversation.body.conversation.turns[1].status, "failed");
    assert.deepEqual(thirdMessages.map((message) => message.role), ["system", "user", "user", "assistant", "user"]);
    assert.equal(thirdPrompt.includes("第一轮会失败"), true);
    assert.equal(thirdPrompt.includes("系统错误："), false);
    assert.equal(thirdPrompt.includes("上一轮未生成助手回复"), false);
    assert.equal(thirdPrompt.includes("不是助手输出"), false);
    assert.equal(thirdPrompt.includes("first turn provider error"), false);
    assert.equal(thirdPrompt.includes("第二轮成功"), true);
    assert.equal(thirdPrompt.includes("第二轮安全回答"), true);
    assert.equal(thirdPrompt.includes("OpenAI-compatible provider returned HTTP 400"), false);
    assert.equal(thirdPrompt.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation follow-up labels missing-key failure history as a system error", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-missing-key-history-"));
  const secret = "sk-missing-key-history-secret";
  const providerRequests: ResponsesRequestBody[] = [];
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    const body = parseResponsesRequestBody(init.body);
    providerRequests.push(body);
    return createOpenAiTextResponse("missing-key-history-model", "我看到了上一轮是系统侧模型配置失败，不是我之前的回答。");
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { model: "missing-key-history-model" },
    });
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第一轮缺少密钥", aiMode: "openai-compatible" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "failed", 4_000, "/api/desktop/runs");

    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: { apiKey: secret, model: "missing-key-history-model" },
    });
    const second = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "现在继续", aiMode: "openai-compatible" },
      }
    );
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const prompt = JSON.stringify(extractResponsesMessages(providerRequests.at(-1)));

    assert.equal(providerRequests.length, 1);
    assert.equal(prompt.includes("第一轮缺少密钥"), true);
    assert.equal(prompt.includes("系统错误："), false);
    assert.equal(prompt.includes("上一轮未生成助手回复"), false);
    assert.equal(prompt.includes("不是助手输出"), false);
    assert.equal(prompt.includes("模型密钥未配置"), false);
    assert.equal(prompt.includes(secret), false);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

function delayedRuntimeDatabase(
  overrides: Partial<RuntimeDatabase>
): RuntimeDatabase {
  return {
    async upsertWorkspace(record) {
      return record;
    },
    async upsertConversation(record) {
      return record;
    },
    async getConversation() {
      return undefined;
    },
    async listConversations() {
      return [];
    },
    async upsertRun(record) {
      return record;
    },
    async upsertBasicRun(record) {
      return record;
    },
    async replaceBasicRunEvents(_runId, events) {
      return events;
    },
    async replaceRunEvents(_runId, events) {
      return events;
    },
    async replaceModelCalls(_runId, calls) {
      return calls;
    },
    async replaceToolCalls(_runId, calls) {
      return calls;
    },
    async replaceArtifacts(_runId, artifacts) {
      return artifacts;
    },
    async replaceConfirmations(_runId, confirmations) {
      return confirmations;
    },
    async getRun() {
      return undefined;
    },
    async listRuns() {
      return [];
    },
    ...overrides,
  };
}
