import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSystemLocalDevSecretStore, FileSystemNormalSettingsStore } from "../../../adapters/config/index.js";
import {
  FileSystemRuntimeDatabase,
  resolveAgentArborRuntimeDatabasePaths,
} from "../../../adapters/runtime-database/index.js";
import type { RuntimeDatabase } from "../../../domain/runtime-database/index.js";
import { ConfigCenter } from "../../config-center.js";
import { startLocalPanelServer, type PanelProviderFetch } from "../../panel-server.js";
import {
  assertSafePanelJsonText,
  removeTemporaryTree,
  readSseUntil,
  requestJson,
  type RequestJsonResult,
  waitForRun,
} from "./panel-server-test-utils.js";
import {
  createOpenAiReadFileToolCallResponse,
  createOpenAiTextResponse,
  extractResponsesMessages,
  hasResponsesToolDefinition,
  parseResponsesRequestBody,
  responsesRequestText,
  type ResponsesRequestBody,
} from "../../testing/openai-test-fixtures.js";
import { runAgentDefinitionRef } from "../../agent-definition-runtime.js";
import { DESKTOP_ROOT_AGENT } from "../../agent-prompts/desktop-root-agent.js";
import type { AgentDefinition } from "../../agent-prompts/contracts.js";

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

test("conversation message attaches the run before slow initial persistence starts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-slow-persistence-"));
  let releasePersistence: (() => void) | undefined;
  let saveRunSnapshotStarted = false;
  let saveRunSnapshotCompleted = false;
  let persistedConversationBeforeRun: Awaited<ReturnType<RuntimeDatabase["upsertConversation"]>> | undefined;
  let latestPersistedConversation: Awaited<ReturnType<RuntimeDatabase["upsertConversation"]>> | undefined;
  const persistenceGate = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });
  const runtimeDatabase = delayedRuntimeDatabase({
    async upsertConversation(record) {
      latestPersistedConversation = record;
      return record;
    },
    async saveRunSnapshot(content) {
      saveRunSnapshotStarted = true;
      persistedConversationBeforeRun = latestPersistedConversation;
      await persistenceGate;
      saveRunSnapshotCompleted = true;
      return content;
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
    await waitForCondition(() => saveRunSnapshotStarted, 2_000);

    assert.equal(start.status, 202);
    assert.equal(typeof start.body.run.runId, "string");
    assert.equal(elapsedMs < 2_000, true);
    assert.equal(saveRunSnapshotStarted, true);
    assert.equal(saveRunSnapshotCompleted, false);
    assert.equal(persistedConversationBeforeRun?.activeRunId, start.body.run.runId);
    assert.equal(persistedConversationBeforeRun?.turns[1]?.runId, start.body.run.runId);
    assert.equal(persistedConversationBeforeRun?.turns[1]?.status, "running");
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
    const defaultAgentRef = runAgentDefinitionRef(DESKTOP_ROOT_AGENT);
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
    const basicView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/view?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const currentRun = conversation.body.conversation.currentRun;

    assert.equal(start.status, 202);
    assert.equal(start.body.conversation.turns.length, 2);
    assert.equal(start.body.conversation.turns[0].role, "user");
    assert.equal(start.body.conversation.turns[1].role, "assistant");
    assert.equal(start.body.run.runKind, "desktop");
    assert.equal(start.body.run.runMode, "agent");
    assert.deepEqual(start.body.run.agentDefinitionRef, defaultAgentRef);
    assert.equal(completed.body.conversation.conversationId, conversationId);
    assert.equal(completed.body.runMode, "agent");
    assert.deepEqual(completed.body.agentDefinitionRef, start.body.run.agentDefinitionRef);
    assert.deepEqual(completed.body.capabilityResolution.agentId, defaultAgentRef.agentId);
    assert.equal(completed.body.capabilityResolution.toolVisibilityProfileId, defaultAgentRef.toolVisibilityProfileId);
    assert.equal(conversation.body.conversation.turns.length, 2);
    assert.equal(conversation.body.conversation.turns[1].runId, runId);
    assert.equal(conversation.body.conversation.turns[1].content.includes("我可以直接回答问题"), true);
    assert.equal(currentRun.run.runId, runId);
    assert.equal(currentRun.run.conversationId, conversationId);
    assert.equal(currentRun.run.status, "completed");
    assert.equal(currentRun.workView.stage, "completed");
    assert.equal(currentRun.workView.answer.content.includes("我可以直接回答问题"), true);
    assert.equal(JSON.stringify(currentRun.workView.answer).includes("replay"), false);
    assert.equal(JSON.stringify(currentRun.workView.answer).includes("transcript"), false);
    assert.equal(JSON.stringify(currentRun.workView.answer).includes("events"), false);
    assert.equal(JSON.stringify(currentRun.workView.answer).includes("systemPrompt"), false);
    assert.equal(currentRun.workView.run.runId, runId);
    assert.equal(currentRun.workView.run.runId, runId);
    assert.equal("workSession" in currentRun, false);
    assert.equal(currentRun.detail.runId, runId);
    assert.deepEqual(currentRun.agentDefinitionRef, start.body.run.agentDefinitionRef);
    assert.deepEqual(currentRun.capabilityResolution, completed.body.capabilityResolution);
    assert.equal(currentRun.replay.events.some((event: { runId: string }) => event.runId === runId), true);
    assert.equal(basicView.body.view.run.runId, runId);
    assert.deepEqual(basicView.body.view.agentDefinitionRef, start.body.run.agentDefinitionRef);
    assert.deepEqual(basicView.body.view.capabilityResolution, completed.body.capabilityResolution);
    assert.equal(basicView.body.view.workView.run.runId, runId);
    assert.equal(basicView.body.view.workView.run.runId, runId);
    assert.equal("workSession" in basicView.body.view, false);
    assert.deepEqual(runtimeRun.body.agentDefinitionRef, start.body.run.agentDefinitionRef);
    assert.deepEqual(runtimeRun.body.snapshot.run.agentDefinitionRef, start.body.run.agentDefinitionRef);
    assert.deepEqual(runtimeRun.body.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.deepEqual(runtimeRun.body.snapshot.run.capabilityResolution, completed.body.capabilityResolution);
    assert.equal(JSON.stringify(currentRun).includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
    assert.equal(JSON.stringify(runtimeRun.body).includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
    assertSafePanelJsonText(`${conversation.text}\n${basicView.text}\n${runtimeRun.text}`);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation provider tools come from backend AgentDefinition instead of request fields", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-agent-tools-"));
  const modelSecret = "sk-conversation-agent-tools-secret";
  const webSecret = "tvly-conversation-agent-tools-secret";
  const providerRequests: ResponsesRequestBody[] = [];
  const agentDefinition: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "conversation-hidden-search-agent",
    displayName: "Conversation Hidden Search Agent",
    toolVisibilityProfile: {
      ...DESKTOP_ROOT_AGENT.toolVisibilityProfile,
      profileId: "conversation-hidden-search-agent:ordinary-visible-tools:v1",
      hiddenToolNames: [
        ...(DESKTOP_ROOT_AGENT.toolVisibilityProfile.hiddenToolNames ?? []),
        "search",
      ],
    },
  };
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    providerRequests.push(parseResponsesRequestBody(init.body));
    return createOpenAiTextResponse("conversation-agent-tools-model", "我会只使用后端允许的工具集合。");
  };
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    desktopAgentDefinition: agentDefinition,
    providerFetch,
  });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "conversation-agent-tools-model",
        apiKey: modelSecret,
      },
    });
    await requestJson(server.url, "/api/config/tools/web-search", {
      method: "POST",
      body: {
        provider: "tavily",
        apiKey: webSecret,
        maxResults: 1,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "前端请求里夹带 search 工具也不能改变后端工具边界",
        aiMode: "openai-compatible",
        requestedTools: ["search"],
        toolVisibilityProfileId: DESKTOP_ROOT_AGENT.toolVisibilityProfile.profileId,
      },
    });
    const completed = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.status === "completed",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(start.body.conversation.conversationId)}`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.run.runId)}`);
    const visibleText = `${completed.text}\n${conversation.text}\n${runtimeRun.text}`;

    assert.equal(start.status, 202);
    assert.equal(providerRequests.length, 1);
    assert.equal(hasResponsesToolDefinition(providerRequests[0], "search"), false);
    assert.equal(completed.body.capabilityResolution.allowedTools.includes("search"), false);
    assert.equal(
      completed.body.capabilityResolution.toolExposures.some(
        (tool: { readonly name?: string; readonly modelVisible?: boolean }) =>
          tool.name === "search" && tool.modelVisible === false
      ),
      true
    );
    assert.deepEqual(conversation.body.conversation.currentRun.capabilityResolution, completed.body.capabilityResolution);
    assert.deepEqual(runtimeRun.body.snapshot.run.capabilityResolution, completed.body.capabilityResolution);
    assert.equal(visibleText.includes(modelSecret), false);
    assert.equal(visibleText.includes(webSecret), false);
    assertSafePanelJsonText(visibleText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("context attachment preview feeds the Basic Agent work view read model with original text", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-work-view-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-workspace-"));
  const fileBody = "private body with sk-work-view-secret";
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
            readonlyPreview: preview.body.attachment.readonlyPreview,
          }],
          permissionBoundaryRefs: preview.body.attachment.permissionRefs,
        },
      },
    });
    const runId = start.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const workView = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/work-view`);

    assert.equal(preview.status, 200);
    assert.equal(preview.body.attachment.ref, "file:notes.md");
    assert.equal(preview.text.includes(fileBody), true);
    assert.equal(invalidKind.status, 400);
    assert.equal(invalidKind.body.error.code, "invalid_context_attachment_kind");
    assert.equal(workView.status, 200);
    assert.equal(workView.body.workView.stage, "completed");
    assert.equal(workView.body.workView.contextAttachments.some((item: { ref?: string }) => item.ref === "file:notes.md"), true);
    assert.equal(typeof workView.body.workView.answer?.content, "string");
    assert.equal(workView.body.workView.deliverable, undefined);
    assert.equal("workSession" in workView.body, false);
    assertSafePanelJsonText(workView.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("conversation runs can use a transient workspace without updating the default workspace", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-task-workspace-"));
  const defaultWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-default-workspace-"));
  const runWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-run-workspace-"));
  const followUpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-follow-up-workspace-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    await requestJson(server.url, "/api/config/workspace", {
      method: "POST",
      body: { workspaceDirectory: defaultWorkspace },
    });
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "使用本次工作区启动普通任务",
        aiMode: "fake",
        workspaceDirectory: runWorkspace,
      },
    });
    const runId = start.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const conversationId = start.body.conversation.conversationId;
    const followUp = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: {
        goal: "继续使用另一个本次工作区",
        aiMode: "fake",
        workspaceDirectory: followUpWorkspace,
      },
    });
    const followUpRunId = followUp.body.run.runId;
    await waitForRun(server.url, followUpRunId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const persistedRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const persistedFollowUpRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(followUpRunId)}`);
    const conversation = await requestJson(server.url, `/api/conversations/${encodeURIComponent(conversationId)}`);
    const conversations = await requestJson(server.url, "/api/conversations");
    const config = await requestJson(server.url, "/api/config");

    assert.equal(start.status, 202);
    assert.equal(followUp.status, 202);
    assert.equal(persistedRun.status, 200);
    assert.equal(persistedFollowUpRun.status, 200);
    assert.equal(persistedRun.body.snapshot.run.workspacePath, path.resolve(runWorkspace));
    assert.equal(persistedFollowUpRun.body.snapshot.run.workspacePath, path.resolve(followUpWorkspace));
    assert.equal(
      persistedRun.body.snapshot.run.capabilitySnapshot.workspace.workspaceDirectory,
      path.resolve(runWorkspace)
    );
    assert.equal(conversation.body.conversation.workspaceFolder.label, path.basename(followUpWorkspace));
    assert.equal(conversation.body.conversation.workspaceFolder.path, path.resolve(followUpWorkspace));
    const listed = conversations.body.conversations.find((item: { conversationId: string }) =>
      item.conversationId === conversationId
    );
    assert.equal(listed.workspaceFolder.label, path.basename(followUpWorkspace));
    assert.equal(listed.workspaceFolder.path, path.resolve(followUpWorkspace));
    assert.equal(config.body.workspace.workspaceDirectory, path.resolve(defaultWorkspace));
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(defaultWorkspace);
    await removeTemporaryTree(runWorkspace);
    await removeTemporaryTree(followUpWorkspace);
  }
});

test("conversation workspace projection rejects an invalid Ordinary snapshot after the conversation is loaded", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-invalid-workspace-snapshot-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-invalid-workspace-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "验证会话工作区读取契约",
        aiMode: "fake",
        workspaceDirectory: workspace,
      },
    });
    const runId = started.body.run.runId;
    const conversationId = started.body.conversation.conversationId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const loaded = await requestJson(server.url, "/api/conversations");
    assert.equal(loaded.status, 200);
    assert.equal(
      loaded.body.conversations.some((conversation: { conversationId: string }) =>
        conversation.conversationId === conversationId
      ),
      true
    );

    const runtimePaths = resolveAgentArborRuntimeDatabasePaths(directory);
    const runPath = path.join(runtimePaths.runtimeHome, "runs", encodeURIComponent(runId), "run.json");
    const manifest = JSON.parse(await fs.readFile(runPath, "utf8")) as { snapshotRef: string };
    const snapshotPath = path.join(path.dirname(runPath), manifest.snapshotRef);
    const document = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      content: { run: { capabilitySnapshot?: unknown } };
    };
    delete document.content.run.capabilitySnapshot;
    await fs.writeFile(snapshotPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    const invalidWorkspaceProjection = await requestJson(server.url, "/api/conversations");
    assert.equal(invalidWorkspaceProjection.status, 410);
    assert.equal(invalidWorkspaceProjection.body.error.code, "ordinary_runtime_snapshot_invalid");
    assert.equal(invalidWorkspaceProjection.body.error.message.includes("capabilitySnapshot"), true);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
  }
});

test("context attachment upload stores multipart files as refs for conversation context", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-upload-"));
  const uploadSecret = "sk-uploaded-file-secret";
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const upload = await requestMultipartJson(server.url, "/api/context/attachments/upload", [
      {
        fieldName: "files",
        filename: "notes.md",
        contentType: "text/markdown",
        body: Buffer.from(`uploaded markdown ${uploadSecret}\n`, "utf8"),
      },
      {
        fieldName: "files",
        filename: "screen.png",
        contentType: "image/png",
        body: imageBytes,
      },
    ]);
    const attachments = upload.body.attachments as readonly {
      readonly attachmentId: string;
      readonly kind: string;
      readonly ref: string;
      readonly title: string;
      readonly summary: string;
      readonly permissionRefs: readonly string[];
      readonly readonlyPreview?: { readonly text: string; readonly truncated: boolean };
      readonly readonlyPreviewMeta: {
        readonly available: boolean;
        readonly byteLength?: number;
        readonly mimeType?: string;
        readonly truncated?: boolean;
      };
      readonly mediaPreview?: {
        readonly kind: "image";
        readonly url: string;
        readonly mimeType: string;
        readonly byteLength?: number;
      };
      readonly status: string;
    }[];
    const textAttachment = attachments[0];
    const imageAttachment = attachments[1];
    assert.equal(upload.status, 200);
    assert.equal(attachments.length, 2);
    assert.equal(textAttachment.title, "notes.md");
    assert.equal(textAttachment.kind, "file");
    assert.equal(textAttachment.status, "ready");
    assert.equal(textAttachment.readonlyPreviewMeta.mimeType, "text/markdown");
    assert.equal(textAttachment.readonlyPreviewMeta.byteLength, Buffer.byteLength(`uploaded markdown ${uploadSecret}\n`));
    assert.equal(textAttachment.summary.includes(directory), false);
    assert.equal(textAttachment.ref.startsWith("local-file:"), true);
    assert.equal(textAttachment.permissionRefs.length, 1);
    assert.equal(textAttachment.permissionRefs[0]?.startsWith("read:local-file:"), true);
    assert.equal(imageAttachment.title, "screen.png");
    assert.equal(imageAttachment.readonlyPreviewMeta.mimeType, "image/png");
    assert.equal(imageAttachment.readonlyPreview?.text, "[binary file preview omitted]");
    assert.equal(imageAttachment.mediaPreview?.kind, "image");
    assert.equal(imageAttachment.mediaPreview?.mimeType, "image/png");
    assert.equal(imageAttachment.mediaPreview?.byteLength, imageBytes.length);
    assert.equal(
      imageAttachment.mediaPreview?.url,
      `/api/context/attachments/media/${encodeURIComponent(imageAttachment.attachmentId)}`
    );

    const media = await requestBytes(server.url, imageAttachment.mediaPreview?.url ?? "");
    assert.equal(media.status, 200);
    assert.equal(media.headers["content-type"], "image/png");
    assert.deepEqual(media.body, imageBytes);

    const savedTextPath = textAttachment.ref.slice("local-file:".length);
    assert.equal(savedTextPath.startsWith(path.join(directory, "attachments")), true);
    assert.equal(await fs.readFile(savedTextPath, "utf8"), `uploaded markdown ${uploadSecret}\n`);

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: {
        goal: "请基于刚上传的附件回答。",
        aiMode: "fake",
        taskSoilInput: {
          contextRefs: attachments.map((attachment) => ({
            attachmentId: attachment.attachmentId,
            ref: attachment.ref,
            kind: attachment.kind,
            title: attachment.title,
            summary: attachment.summary,
            metadata: {
              byteLength: attachment.readonlyPreviewMeta.byteLength,
              mimeType: attachment.readonlyPreviewMeta.mimeType,
              available: attachment.readonlyPreviewMeta.available,
              truncated: attachment.readonlyPreviewMeta.truncated,
            },
          })),
          permissionBoundaryRefs: Array.from(new Set(attachments.flatMap((attachment) => attachment.permissionRefs))),
        },
      },
    });
    assert.equal(start.status, 202);
    assert.equal(start.body.conversation.turns[0].content.includes(uploadSecret), false);
    assert.equal(start.body.conversation.turns[0].content, "请基于刚上传的附件回答。");
    assert.equal(start.body.conversation.turns[0].attachments.length, 2);
    assert.equal(start.body.conversation.turns[0].attachments[0].title, "notes.md");
    assert.equal(start.body.conversation.turns[0].attachments[0].mediaPreview, undefined);
    assert.equal(start.body.conversation.turns[0].attachments[1].attachmentId, imageAttachment.attachmentId);
    assert.equal(start.body.conversation.turns[0].attachments[1].mediaPreview.kind, "image");
    assert.equal(start.body.conversation.turns[0].attachments[1].mediaPreview.url, imageAttachment.mediaPreview?.url);
    assert.equal(start.body.conversation.turns[0].attachments[1].readonlyPreviewMeta.mimeType, "image/png");
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("context attachment picker returns local image media previews", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-context-select-image-"));
  const imagePath = path.join(directory, "local-screen.png");
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await fs.writeFile(imagePath, imageBytes);
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    contextAttachmentPicker: async () => ({ kind: "file", path: imagePath }),
  });
  try {
    const selected = await requestJson(server.url, "/api/context/attachments/select-local", {
      method: "POST",
      body: {},
    });
    const attachment = selected.body.attachment as {
      readonly attachmentId: string;
      readonly ref: string;
      readonly readonlyPreviewMeta: { readonly mimeType?: string; readonly byteLength?: number };
      readonly mediaPreview?: {
        readonly kind: "image";
        readonly url: string;
        readonly mimeType: string;
        readonly byteLength?: number;
      };
    };

    assert.equal(selected.status, 200);
    assert.equal(selected.body.status, "completed");
    assert.equal(attachment.ref, `local-file:${imagePath}`);
    assert.equal(attachment.readonlyPreviewMeta.mimeType, "image/png");
    assert.equal(attachment.readonlyPreviewMeta.byteLength, imageBytes.length);
    assert.equal(attachment.mediaPreview?.kind, "image");
    assert.equal(attachment.mediaPreview?.url, `/api/context/attachments/media/${encodeURIComponent(attachment.attachmentId)}`);

    const media = await requestBytes(server.url, attachment.mediaPreview?.url ?? "");
    assert.equal(media.status, 200);
    assert.equal(media.headers["content-type"], "image/png");
    assert.deepEqual(media.body, imageBytes);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
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

test("conversation API renames, pins, unpins, and deletes persisted conversations", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-manage-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第一条会话", aiMode: "fake" },
    });
    const second = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "第二条会话", aiMode: "fake" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await waitForRun(server.url, second.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    const firstConversationId = first.body.conversation.conversationId;
    const secondConversationId = second.body.conversation.conversationId;

    const renamed = await requestJson(server.url, `/api/conversations/${encodeURIComponent(firstConversationId)}/rename`, {
      method: "POST",
      body: { title: "项目梳理" },
    });
    const pinned = await requestJson(server.url, `/api/conversations/${encodeURIComponent(firstConversationId)}/pin`, {
      method: "POST",
      body: { pinned: true },
    });
    const listed = await requestJson(server.url, "/api/conversations");
    const unpinned = await requestJson(server.url, `/api/conversations/${encodeURIComponent(firstConversationId)}/pin`, {
      method: "POST",
      body: { pinned: false },
    });
    const deleted = await requestJson(server.url, `/api/conversations/${encodeURIComponent(secondConversationId)}`, {
      method: "DELETE",
    });
    const deletedRead = await requestJson(server.url, `/api/conversations/${encodeURIComponent(secondConversationId)}`);
    const afterDelete = await requestJson(server.url, "/api/conversations");

    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.conversation.title, "项目梳理");
    assert.equal(typeof renamed.body.conversation.titleEditedAt, "string");
    assert.equal(pinned.status, 200);
    assert.equal(typeof pinned.body.conversation.pinnedAt, "string");
    assert.equal(listed.body.conversations[0].conversationId, firstConversationId);
    assert.equal(unpinned.status, 200);
    assert.equal(unpinned.body.conversation.pinnedAt, undefined);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deletedConversationId, secondConversationId);
    assert.equal(deletedRead.status, 404);
    assert.equal(deletedRead.body.error.code, "conversation_not_found");
    assert.equal(deletedRead.text.includes("未找到面板路由"), false);
    assert.equal(
      afterDelete.body.conversations.some((item: { conversationId: string }) => item.conversationId === secondConversationId),
      false
    );
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
    assert.equal(latestMessages.at(-1)?.content, "回退后继续");
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
    assert.equal(secondMessages[3]?.content, "那你能继续解释一下吗？");
    assert.equal(secondMessages[3]?.content?.includes("你好，你能做什么"), false);
    assert.equal(JSON.stringify(secondMessages).includes("workspace:conversation-history"), false);
    assert.equal(requests.at(-1)?.max_output_tokens ?? requests.at(-1)?.max_completion_tokens ?? requests.at(-1)?.max_tokens, 4000);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation API rejects deep mode selection and keeps default agent boundary", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-latest-run-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "分析当前仓库的问题并给我优化建议", aiMode: "fake", runMode: "deep" },
    });

    const runs = await requestJson(server.url, "/api/runtime/runs");

    assert.equal(started.status, 400);
    assert.equal(started.body.ok, false);
    assert.equal(started.body.error.code, "conversation_run_mode_not_supported");
    assert.equal(runs.body.runs.length, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation follow-up rejects deep mode and does not enqueue a run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-follow-up-deep-"));
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const first = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "先建立普通会话", aiMode: "fake" },
    });
    await waitForRun(server.url, first.body.run.runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");

    const rejected = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}/messages`,
      {
        method: "POST",
        body: { goal: "把后续消息升级为 deep", aiMode: "fake", runMode: "deep" },
      }
    );
    const runs = await requestJson(server.url, "/api/runtime/runs");
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(first.body.conversation.conversationId)}`
    );

    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.error.code, "conversation_run_mode_not_supported");
    assert.equal(runs.body.runs.length, 1);
    assert.equal(runs.body.runs[0].runId, first.body.run.runId);
    assert.equal(conversation.body.conversation.turns.length, 2);
    assert.equal(conversation.body.conversation.queuedRunCount, 0);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation and desktop run APIs restore complete new-contract history after restart", async () => {
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
    const persistedConversationText = await fs.readFile(conversationPath, "utf8");
    const persistedConversation = JSON.parse(persistedConversationText) as { turns?: Array<{ role?: string; responseModel?: unknown }> };
    assert.equal(
      persistedConversation.turns?.filter((turn) => turn.role === "assistant").every((turn) => turn.responseModel !== undefined),
      true
    );

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
      profileId: "fake",
      label: "Fake",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "fake-deterministic-model",
    });
    assert.equal(run.status, 200);
    assert.equal(run.body.restoredFromSnapshot, true);
    assert.equal(run.body.restoredResult.summary.includes("我可以直接回答问题"), true);
    assert.equal(run.body.transcript.events.some((event: { type: string }) => event.type === "agent.note.delta"), false);
    assert.equal(run.body.transcript.events.some((event: { type: string }) => event.type === "model.output.completed"), false);
    assert.equal(run.body.conversation.conversationId, conversationId);
    assert.equal(runtimeRun.body.snapshot.run.runId, runId);
    assert.equal(await fs.readFile(conversationPath, "utf8"), persistedConversationText);
    assertSafePanelJsonText(run.text);
    assertSafePanelJsonText(conversation.text);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("persisted Ordinary APIs reject pre-contract snapshots instead of using current Host configuration", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-ordinary-snapshot-clean-break-"));
  let server = await startLocalPanelServer({ port: 0, configDirectory: directory });
  try {
    const started = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "验证持久化契约", aiMode: "fake" },
    });
    const runId = started.body.run.runId;
    await waitForRun(server.url, runId, (body) => body.status === "completed", 4_000, "/api/desktop/runs");
    await server.close();

    const runtimePaths = resolveAgentArborRuntimeDatabasePaths(directory);
    const runPath = path.join(runtimePaths.runtimeHome, "runs", encodeURIComponent(runId), "run.json");
    const manifest = JSON.parse(await fs.readFile(runPath, "utf8")) as { snapshotRef: string };
    const snapshotPath = path.join(path.dirname(runPath), manifest.snapshotRef);
    const document = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      content: { run: {
        capabilitySnapshot?: unknown;
        informationAccess?: unknown;
      } };
    };
    delete document.content.run.capabilitySnapshot;
    delete document.content.run.informationAccess;
    await fs.writeFile(snapshotPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    server = await startLocalPanelServer({ port: 0, configDirectory: directory });
    const desktopRun = await requestJson(server.url, `/api/desktop/runs/${encodeURIComponent(runId)}`);
    const basicView = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/view`);
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);

    for (const response of [desktopRun, basicView, runtimeRun]) {
      assert.equal(response.status, 410);
      assert.equal(response.body.error.code, "ordinary_runtime_snapshot_invalid");
      assert.equal(response.body.error.message.includes("开发期失效数据"), true);
      assert.equal(response.body.error.message.includes("capabilitySnapshot"), true);
      assert.equal(response.body.error.message.includes("informationAccess"), true);
    }
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
    assert.equal(secondMessages[3]?.content, "第二轮问题");
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

test("conversation provider network failure stays failed across run views and runtime snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-network-failure-"));
  const secret = "sk-network-failure-secret";
  const providerFetch: PanelProviderFetch = async () => {
    throw new Error(`fetch failed ECONNRESET apiKey=${secret}`);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "network-failure-model",
        apiKey: secret,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试网络失败不能完成", aiMode: "openai-compatible" },
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
    const basicView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.run.runId)}/view?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.run.runId)}`);
    const visibleText = `${failed.text}\n${conversation.text}\n${basicView.text}\n${runtimeRun.text}`;

    assert.equal(start.status, 202);
    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.code, "desktop_agent_failed");
    assert.equal(failed.body.error.message, "模型服务连接失败。");
    assert.equal(failed.body.error.message.includes("fetch failed ECONNRESET"), false);
    assert.equal(failed.body.error.message.includes(secret), false);
    assert.equal(conversation.body.conversation.currentRun.run.status, "failed");
    assert.equal(conversation.body.conversation.currentRun.workView.stage, "failed");
    assert.equal(conversation.body.conversation.currentRun.detail.status, "failed");
    assert.equal(basicView.body.view.run.status, "failed");
    assert.equal(basicView.body.view.workView.stage, "failed");
    assert.equal(basicView.body.view.detail.status, "failed");
    assert.equal(runtimeRun.body.snapshot.run.status, "failed");
    assert.equal(runtimeRun.body.snapshot.run.error.code, "desktop_agent_failed");
    assert.deepEqual(basicView.body.view.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(visibleText.includes(secret), false);
    assert.equal(visibleText.includes("[redacted-secret]"), false);
    assertSafePanelJsonText(visibleText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation model output contract failure stays failed across run views and runtime snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-output-validation-"));
  const secret = "sk-output-validation-secret";
  const providerFetch: PanelProviderFetch = async () =>
    createOpenAiTextResponse("output-validation-model", "");
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "output-validation-model",
        apiKey: secret,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试输出契约失败不能完成", aiMode: "openai-compatible" },
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
    const basicView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.run.runId)}/view?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.run.runId)}`);
    const visibleText = `${failed.text}\n${conversation.text}\n${basicView.text}\n${runtimeRun.text}`;

    assert.equal(start.status, 202);
    assert.equal(failed.body.status, "failed");
    assert.equal(failed.body.error.code, "desktop_agent_failed");
    assert.equal(failed.body.error.message, "模型输出校验失败。");
    assert.equal(failed.body.trace.currentStage, "model_failed");
    assert.equal(failed.body.trace.events.some((event: { type: string }) => event.type === "model.failed"), true);
    assert.equal(failed.body.transcript.events.some((event: { type: string }) => event.type === "final.result"), false);
    assert.equal(conversation.body.conversation.currentRun.run.status, "failed");
    assert.equal(conversation.body.conversation.currentRun.workView.stage, "failed");
    assert.equal(conversation.body.conversation.currentRun.detail.status, "failed");
    assert.equal(basicView.body.view.run.status, "failed");
    assert.equal(basicView.body.view.workView.stage, "failed");
    assert.equal(basicView.body.view.detail.status, "failed");
    assert.equal(runtimeRun.body.snapshot.run.status, "failed");
    assert.equal(runtimeRun.body.snapshot.run.error.code, "desktop_agent_failed");
    assert.equal(runtimeRun.body.snapshot.run.error.message, "模型输出校验失败。");
    assert.deepEqual(basicView.body.view.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(visibleText.includes("正在处理"), false);
    assert.equal(visibleText.includes(secret), false);
    assertSafePanelJsonText(visibleText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation cancellation stays cancelled across run views and runtime snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-cancel-"));
  const secret = "sk-cancel-secret";
  let markProviderStarted: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve;
  });
  const providerFetch: PanelProviderFetch = async (_url, init) => {
    markProviderStarted?.();
    return await new Promise<Awaited<ReturnType<PanelProviderFetch>>>((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => reject(new Error(`provider aborted after user cancellation apiKey=${secret}`)),
        { once: true }
      );
    });
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, providerFetch });
  try {
    await requestJson(server.url, "/api/config/model-provider", {
      method: "POST",
      body: {
        baseUrl: "https://provider.example",
        model: "cancel-model",
        apiKey: secret,
      },
    });

    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试取消不能变成完成", aiMode: "openai-compatible" },
    });
    const runId = start.body.run.runId;
    await providerStarted;

    const cancel = await requestJson(server.url, `/api/basic-agent/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: {},
    });
    const cancelled = await waitForRun(
      server.url,
      runId,
      (body) => body.status === "cancelled",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(start.body.conversation.conversationId)}`
    );
    const basicView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(runId)}/view?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(runId)}`);
    const visibleText = `${cancel.text}\n${cancelled.text}\n${conversation.text}\n${basicView.text}\n${runtimeRun.text}`;

    assert.equal(start.status, 202);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.run.status, "cancelled");
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(cancelled.body.error.code, "run_cancelled");
    assert.equal(conversation.body.conversation.currentRun.run.status, "cancelled");
    assert.equal(conversation.body.conversation.currentRun.workView.stage, "cancelled");
    assert.equal(conversation.body.conversation.currentRun.detail.status, "cancelled");
    assert.equal(basicView.body.view.run.status, "cancelled");
    assert.equal(basicView.body.view.workView.stage, "cancelled");
    assert.equal(basicView.body.view.detail.status, "cancelled");
    assert.equal(runtimeRun.body.snapshot.run.status, "cancelled");
    assert.equal(runtimeRun.body.snapshot.run.error.code, "run_cancelled");
    assert.deepEqual(basicView.body.view.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(visibleText.includes(secret), false);
    assert.equal(visibleText.includes("provider aborted after user cancellation"), false);
    assertSafePanelJsonText(visibleText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation AgentDefinition model round limit stays blocked across run views and runtime snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-round-limit-"));
  const agentDefinition: AgentDefinition = {
    ...DESKTOP_ROOT_AGENT,
    agentId: "round-limited-desktop-agent",
    displayName: "Round Limited Desktop Agent",
    turnPolicy: {
      ...DESKTOP_ROOT_AGENT.turnPolicy,
      maxModelRounds: 0,
    },
    toolVisibilityProfile: {
      ...DESKTOP_ROOT_AGENT.toolVisibilityProfile,
      profileId: "round-limited-desktop-agent:ordinary-visible-tools:v1",
    },
  };
  const expectedAgentRef = runAgentDefinitionRef(agentDefinition);
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    desktopAgentDefinition: agentDefinition,
  });
  try {
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "测试 AgentDefinition 轮次限制不能变成完成", aiMode: "fake" },
    });
    const blocked = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.status === "blocked",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(start.body.conversation.conversationId)}`
    );
    const basicView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.run.runId)}/view?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.run.runId)}`);
    const currentRun = conversation.body.conversation.currentRun;
    const visibleText = `${blocked.text}\n${conversation.text}\n${basicView.text}\n${runtimeRun.text}`;

    assert.equal(start.status, 202);
    assert.deepEqual(start.body.run.agentDefinitionRef, expectedAgentRef);
    assert.equal(blocked.body.status, "blocked");
    assert.equal(blocked.body.error.code, "out_of_fuel");
    assert.deepEqual(blocked.body.agentDefinitionRef, expectedAgentRef);
    assert.equal(currentRun.run.status, "blocked");
    assert.equal(currentRun.workView.stage, "blocked");
    assert.equal(currentRun.detail.status, "blocked");
    assert.deepEqual(currentRun.agentDefinitionRef, expectedAgentRef);
    assert.equal(basicView.body.view.run.status, "blocked");
    assert.equal(basicView.body.view.workView.stage, "blocked");
    assert.equal(basicView.body.view.detail.status, "blocked");
    assert.deepEqual(basicView.body.view.agentDefinitionRef, expectedAgentRef);
    assert.equal(runtimeRun.body.snapshot.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.run.error.code, "out_of_fuel");
    assert.deepEqual(runtimeRun.body.snapshot.run.agentDefinitionRef, expectedAgentRef);
    assert.equal(visibleText.includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
    assertSafePanelJsonText(visibleText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation context overflow stays blocked across run views and runtime snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-context-overflow-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-conversation-context-overflow-workspace-"));
  const configCenter = new ConfigCenter({
    settingsStore: new FileSystemNormalSettingsStore(directory),
    secretStore: new FileSystemLocalDevSecretStore(directory),
  });
  const model = "conversation-context-overflow-model";
  const secret = "sk-conversation-context-overflow-secret";
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
    const body = JSON.parse(init.body ?? "{}") as { messages?: readonly { role?: string; content?: string }[] };
    const compactionRequest = body.messages?.some((message) =>
      String(message.content ?? "").includes("Context to compact:")
    ) === true;
    return compactionRequest
      ? createOpenAiTextResponse(model, "")
      : createOpenAiReadFileToolCallResponse("huge.md", `call-conversation-context-overflow-${providerCalls}`);
  };
  const server = await startLocalPanelServer({ port: 0, configDirectory: directory, configCenter, providerFetch });
  try {
    const start = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: { goal: "持续读取大量材料直到可以回答", aiMode: "openai-compatible" },
    });
    const blocked = await waitForRun(
      server.url,
      start.body.run.runId,
      (body) => body.status === "blocked",
      4_000,
      "/api/desktop/runs"
    );
    const conversation = await requestJson(
      server.url,
      `/api/conversations/${encodeURIComponent(start.body.conversation.conversationId)}`
    );
    const basicView = await requestJson(
      server.url,
      `/api/basic-agent/runs/${encodeURIComponent(start.body.run.runId)}/view?cursor=0`
    );
    const runtimeRun = await requestJson(server.url, `/api/runtime/runs/${encodeURIComponent(start.body.run.runId)}`);
    const currentRun = conversation.body.conversation.currentRun;
    const visibleText = `${blocked.text}\n${conversation.text}\n${basicView.text}\n${runtimeRun.text}`;

    assert.equal(start.status, 202);
    assert.equal(providerCalls >= 2, true);
    assert.equal(blocked.body.status, "blocked");
    assert.equal(blocked.body.error.code, "context_overflow");
    assert.equal(blocked.body.transcript.events.some((event: { type: string }) => event.type === "final.result"), false);
    assert.equal(currentRun.run.status, "blocked");
    assert.equal(currentRun.workView.stage, "blocked");
    assert.equal(currentRun.workView.pendingConfirmation, undefined);
    assert.equal(currentRun.detail.status, "blocked");
    assert.equal(basicView.body.view.run.status, "blocked");
    assert.equal(basicView.body.view.workView.stage, "blocked");
    assert.equal(basicView.body.view.workView.pendingConfirmation, undefined);
    assert.equal(basicView.body.view.detail.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.run.status, "blocked");
    assert.equal(runtimeRun.body.snapshot.run.error.code, "context_overflow");
    assert.deepEqual(basicView.body.view.capabilityResolution, runtimeRun.body.snapshot.run.capabilityResolution);
    assert.equal(visibleText.includes("正在处理"), false);
    assert.equal(visibleText.includes(secret), false);
    assertSafePanelJsonText(visibleText);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
    await removeTemporaryTree(workspace);
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

type MultipartTestFile = {
  readonly fieldName: string;
  readonly filename: string;
  readonly contentType?: string;
  readonly body: Buffer;
};

type RequestBytesResult = {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
};

function requestBytes(baseUrl: string, pathname: string): Promise<RequestBytesResult> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "binary"));
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function requestMultipartJson(
  baseUrl: string,
  pathname: string,
  files: readonly MultipartTestFile[]
): Promise<RequestJsonResult> {
  const url = new URL(pathname, baseUrl);
  const boundary = `----agentarbor-test-${Date.now().toString(16)}`;
  const body = multipartBody(boundary, files);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": body.length,
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            text,
            body: JSON.parse(text),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function multipartBody(boundary: string, files: readonly MultipartTestFile[]): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, "utf8"));
    chunks.push(Buffer.from(
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`,
      "utf8"
    ));
    if (file.contentType !== undefined) {
      chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n`, "utf8"));
    }
    chunks.push(Buffer.from("\r\n", "utf8"));
    chunks.push(file.body);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function delayedRuntimeDatabase(
  overrides: Partial<RuntimeDatabase>
): RuntimeDatabase {
  const base: RuntimeDatabase = {
    async upsertConversation(record) {
      return record;
    },
    async getConversation() {
      return undefined;
    },
    async listConversations() {
      return [];
    },
    async deleteConversation() {
      return undefined;
    },
    async saveRunSnapshot(content) {
      return content;
    },
    async getRun() {
      return undefined;
    },
    async listRuns() {
      return [];
    },
  };
  return {
    ...base,
    ...definedRuntimeDatabaseOverrides(overrides),
  };
}

function definedRuntimeDatabaseOverrides(
  overrides: Partial<RuntimeDatabase>
): Partial<RuntimeDatabase> {
  return Object.fromEntries(
    Object.entries(overrides).filter((entry): entry is [
      keyof RuntimeDatabase,
      NonNullable<RuntimeDatabase[keyof RuntimeDatabase]>
    ] => entry[1] !== undefined)
  ) as Partial<RuntimeDatabase>;
}
