import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { SessionError } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  AgentLoopInput,
  AgentLoopToolVisibilityPlan,
} from "../../app/model-runtime/agent-loop.js";
import { canonicalToolResultMessage } from "../../app/model-runtime/tool-result-message.js";
import { withToolModelAttachments } from "../../domain/tools/index.js";
import type { ToolCallResult, ToolDefinition, ToolExecutionGateway } from "../../domain/tools/index.js";
import { createAgentSessionLoop } from "./agent-session-loop.js";
import {
  AgentSessionRepositoryError,
  FileSystemAgentSessionRepository,
} from "./file-system-agent-session-repository.js";
import { SessionGenerationError } from "./session-write-fence.js";

test("file-system agent session repository restores the active leaf through a stable ref", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const firstLease = await fixture.repository.acquire(ref);
  const userEntryId = await firstLease.session.appendMessage({
    role: "user",
    content: "hello",
    timestamp: 1,
  });
  await firstLease.release();

  const reopenedRepository = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const reopened = await reopenedRepository.acquire(ref);

  assert.equal(await reopened.session.getLeafId(), userEntryId);
  const metadata = await reopened.session.getMetadata();
  assert.equal(metadata.id, ref.sessionId);
  assert.equal(metadata.cwd, ref.sessionCwd);
  assert.equal(metadata.path, path.join(fixture.sessionsRoot, ...ref.storageKey.split("/")));
  assert.equal(metadata.createdAt, ref.createdAt);
  await reopened.release();
});

test("file-system agent session repository enforces one active writer per session", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const firstLease = await fixture.repository.acquire(ref);

  await assert.rejects(
    fixture.repository.acquire(ref),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_writer_active",
  );

  await firstLease.release();
  const nextLease = await fixture.repository.acquire(ref);
  await nextLease.release();
});

test("file-system agent session repository reads the active branch while its writer remains leased", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const writer = await fixture.repository.acquire(ref);
  const userEntryId = await writer.session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
  const assistantEntryId = await writer.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });

  assert.deepEqual(await fixture.repository.getActiveBranchEntryRefs(ref), [
    { sessionId: ref.sessionId, entryId: userEntryId },
    { sessionId: ref.sessionId, entryId: assistantEntryId },
  ]);
  assert.deepEqual(await fixture.repository.getActiveLeaf(ref), {
    sessionId: ref.sessionId,
    entryId: assistantEntryId,
  });
  assert.deepEqual(await fixture.repository.readToolCalls({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
  }), [{ callId: "call-1", toolName: "read", input: { path: "README.md" } }]);

  await writer.release();
});

test("file-system agent session repository reads exact ordered assistant entries", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-output-range", sessionCwd: fixture.workspace });
  const writer = await fixture.repository.acquire(ref);
  await writer.session.appendMessage({ role: "user", content: "inspect", timestamp: 1 });
  const firstAssistantEntryId = await writer.session.appendMessage({
    role: "assistant",
    content: [
      { type: "text", text: "我先检查文件。" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
    ],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });
  await writer.session.appendMessage({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [{ type: "text", text: "workspace" }],
    isError: false,
    timestamp: 3,
  });
  const finalAssistantEntryId = await writer.session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "检查完成，结论如下。" }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 4,
  });

  const entries = await fixture.repository.readAssistantEntries({
    sessionRef: ref,
    entryRefs: [
      { sessionId: ref.sessionId, entryId: firstAssistantEntryId },
      { sessionId: ref.sessionId, entryId: finalAssistantEntryId },
    ],
  });

  assert.deepEqual(entries.map((entry) => ({ entryId: entry.entryRef.entryId, text: entry.text })), [
    { entryId: firstAssistantEntryId, text: "我先检查文件。" },
    { entryId: finalAssistantEntryId, text: "检查完成，结论如下。" },
  ]);
  await writer.release();
});

test("file-system agent session repository moves the active leaf without deleting the abandoned branch", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const initial = await fixture.repository.acquire(ref);
  const firstEntryId = await initial.session.appendMessage({ role: "user", content: "one", timestamp: 1 });
  const abandonedEntryId = await initial.session.appendMessage({ role: "user", content: "two", timestamp: 2 });
  await initial.release();

  const moved = await fixture.repository.moveActiveLeaf(ref, { sessionId: ref.sessionId, entryId: firstEntryId });
  assert.deepEqual(moved, { sessionId: ref.sessionId, entryId: firstEntryId });
  assert.deepEqual(await fixture.repository.getActiveLeaf(ref), moved);

  const branch = await fixture.repository.acquire(ref);
  const replacementEntryId = await branch.session.appendMessage({ role: "user", content: "branch", timestamp: 3 });
  assert.equal((await branch.session.getEntry(abandonedEntryId))?.type, "message");
  assert.equal((await branch.session.getEntry(replacementEntryId))?.parentId, firstEntryId);
  await branch.release();
});

test("file-system agent session repository reopens the restored branch for a successor generation", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const oldLease = await fixture.repository.acquire(ref);
  const safeLeafId = await oldLease.session.appendCustomEntry("safe");
  const abandonedLeafId = await oldLease.session.appendCustomEntry("abandoned");

  await oldLease.revokeTo({ sessionId: ref.sessionId, entryId: safeLeafId });
  const nextLease = await fixture.repository.acquire(ref);
  assert.notEqual(nextLease.session.getStorage(), oldLease.session.getStorage());
  assert.equal(await nextLease.session.getLeafId(), safeLeafId);
  const successorLeafId = await nextLease.session.appendCustomEntry("successor");
  assert.equal((await nextLease.session.getEntry(successorLeafId))?.parentId, safeLeafId);
  assert.equal((await nextLease.session.getEntry(abandonedLeafId))?.type, "custom");

  await assert.rejects(
    oldLease.session.appendCustomEntry("late-old-write"),
    (error: unknown) => error instanceof SessionGenerationError && error.code === "generation_revoked",
  );
  await oldLease.release();
  assert.equal(await nextLease.session.getLeafId(), successorLeafId);
  await nextLease.release();
});

test("file-system agent session repository rejects a revoke target from another session", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);

  await assert.rejects(
    lease.revokeTo({ sessionId: "another-session", entryId: "entry" }),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_ref_invalid",
  );
  await lease.release();
});

test("file-system agent session repository reads active tool calls and reconciles missing results idempotently", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
      { type: "toolCall", id: "call-2", name: "list", arguments: { path: "." } },
    ],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  await lease.release();
  const assistantEntryRef = { sessionId: ref.sessionId, entryId: assistantEntryId };

  assert.deepEqual(await fixture.repository.readToolCalls({ sessionRef: ref, assistantEntryRef }), [
    { callId: "call-1", toolName: "read", input: { path: "README.md" } },
    { callId: "call-2", toolName: "list", input: { path: "." } },
  ]);
  const orderedResults = [
    { callId: "call-1", toolName: "read", input: { path: "README.md" }, output: { content: "read" }, status: "completed" as const, durationMs: 1 },
    { callId: "call-2", toolName: "list", input: { path: "." }, output: ["src"], status: "completed" as const, durationMs: 1 },
  ];
  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef,
      orderedResults: [orderedResults[0]!, orderedResults[0]!],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /unique root tool results/u.test(error.message),
  );
  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef,
      orderedResults: [orderedResults[0]!],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /tool-call order/u.test(error.message),
  );
  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef,
      orderedResults: [orderedResults[1]!, orderedResults[0]!],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /tool-call order/u.test(error.message),
  );
  const reconciled = await fixture.repository.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef,
    orderedResults,
  });
  const firstBranch = await fixture.repository.getActiveBranchEntryRefs(ref);
  assert.equal(firstBranch.at(-1)?.entryId, reconciled.entryId);
  assert.equal(firstBranch.length, 3);

  const repeated = await fixture.repository.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef,
    orderedResults,
  });
  assert.deepEqual(repeated, reconciled);
  assert.deepEqual(await fixture.repository.getActiveBranchEntryRefs(ref), firstBranch);
});

test("file-system agent session repository replaces a non-canonical fallback result on restart", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-fallback", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "write", arguments: { path: "a.txt" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 1,
  });
  const fallbackEntryId = await lease.session.appendMessage({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "write",
    content: [{ type: "text", text: "tool_result_acceptance_failed" }],
    isError: false,
    timestamp: 2,
  });
  await lease.release();

  const restarted = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const assistantEntryRef = { sessionId: ref.sessionId, entryId: assistantEntryId };
  const orderedResults: readonly ToolCallResult[] = [{
    callId: "call-1",
    toolName: "write",
    input: { path: "a.txt" },
    output: undefined,
    status: "failed",
    error: "Execution outcome is unknown after restart.",
    errorFacts: { code: "tool_execution_outcome_unknown" },
    durationMs: 0,
  }];
  const reconciled = await restarted.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef,
    orderedResults,
  });
  const firstBranch = await restarted.getActiveBranchEntryRefs(ref);
  assert.deepEqual(firstBranch, [assistantEntryRef, reconciled]);
  assert.equal(firstBranch.some((entry) => entry.entryId === fallbackEntryId), false);

  const reopened = await restarted.acquire(ref);
  const canonicalEntry = await reopened.session.getEntry(reconciled.entryId);
  const abandonedFallback = await reopened.session.getEntry(fallbackEntryId);
  await reopened.release();
  assert.equal(canonicalEntry?.type, "message");
  if (canonicalEntry?.type !== "message" || canonicalEntry.message.role !== "toolResult") {
    assert.fail("Expected the reconciled leaf to be a canonical tool result message.");
  }
  assert.deepEqual(canonicalEntry.message.content, [{
    type: "text",
    text: canonicalToolResultMessage(orderedResults[0]!).content,
  }]);
  assert.equal(canonicalEntry.message.isError, true);
  assert.equal(abandonedFallback?.type, "message");

  const repeated = await restarted.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef,
    orderedResults,
  });
  assert.deepEqual(repeated, reconciled);
  assert.deepEqual(await restarted.getActiveBranchEntryRefs(ref), firstBranch);
});

test("file-system agent session repository preserves Pi durable tool-result images during restart reconciliation", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-image-recovery", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-image", name: "capture", arguments: {} }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 1,
  });
  await lease.release();

  const image = {
    kind: "image" as const,
    attachmentId: "capture-image",
    source: { kind: "data" as const, mimeType: "image/png", data: "aW1hZ2U=" },
  };
  const resultWithImage: ToolCallResult = {
    callId: "call-image",
    toolName: "capture",
    input: {},
    output: withToolModelAttachments({ captured: true }, [image]),
    modelAttachmentRefs: [{
      kind: "image",
      attachmentId: image.attachmentId,
      mimeType: image.source.mimeType,
      sha256: createHash("sha256").update(Buffer.from(image.source.data, "base64")).digest("hex"),
    }],
    status: "completed",
    durationMs: 1,
  };
  const firstLeaf = await fixture.repository.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
    orderedResults: [resultWithImage],
  });

  const restarted = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const resultAfterRestart = { ...resultWithImage, output: { captured: true } };
  const recoveredLeaf = await restarted.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
    orderedResults: [resultAfterRestart],
  });
  assert.deepEqual(recoveredLeaf, firstLeaf);

  const reopened = await restarted.acquire(ref);
  const recovered = await reopened.session.getEntry(recoveredLeaf.entryId);
  await reopened.release();
  assert.equal(recovered?.type, "message");
  if (recovered?.type !== "message" || recovered.message.role !== "toolResult") {
    assert.fail("Expected the recovered Pi tool result to remain a tool-result message.");
  }
  assert.deepEqual(recovered.message.content, [
    { type: "text", text: canonicalToolResultMessage(resultAfterRestart).content },
    { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
  ]);
});

test("file-system agent session repository rejects a durable image without a persisted attachment fact", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-image-mismatch", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-image", name: "capture", arguments: {} }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 1,
  });
  await lease.session.appendMessage({
    role: "toolResult",
    toolCallId: "call-image",
    toolName: "capture",
    content: [{ type: "text", text: "captured" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }],
    isError: false,
    timestamp: 2,
  });
  await lease.release();

  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
      orderedResults: [{
        callId: "call-image",
        toolName: "capture",
        input: {},
        output: { captured: true },
        status: "completed",
        durationMs: 1,
      }],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_attachment_mismatch",
  );
});

test("file-system agent session repository rejects image manifests when restart recovery has no payload", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-image-missing-payload", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-image", name: "capture", arguments: {} }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 1,
  });
  await lease.release();

  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
      orderedResults: [{
        callId: "call-image",
        toolName: "capture",
        input: {},
        output: { captured: true },
        modelAttachmentRefs: [{
          kind: "image",
          attachmentId: "capture-image",
          mimeType: "image/png",
          byteLength: 5,
          sha256: "a".repeat(64),
        }],
        status: "completed",
        durationMs: 1,
      }],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_attachment_mismatch" &&
      /no recoverable image payload/u.test(error.message),
  );
});

test("file-system agent session recovery does not infer protocol activation markers from public tool output", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "deferred-session", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "load-call",
      name: "mcp_load",
      arguments: { tool_names: ["mcp_search", "mcp_fetch"] },
    }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  await lease.release();

  await fixture.repository.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
    orderedResults: [{
      callId: "load-call",
      toolName: "mcp_load",
      input: { tool_names: ["mcp_search", "mcp_fetch"] },
      output: {
        kind: "tool_visibility_activation",
        activatedToolNames: ["mcp_search", "mcp_fetch"],
        alreadyLoaded: [],
        remainingDeferredToolCount: 0,
        availableFrom: "next_model_request",
      },
      status: "completed",
      durationMs: 1,
    }],
  });

  const restored = await fixture.repository.acquire(ref);
  const toolResultEntry = (await restored.session.getBranch()).at(-1);
  await restored.release();
  assert.equal(toolResultEntry?.type, "message");
  if (toolResultEntry?.type !== "message" || toolResultEntry.message.role !== "toolResult") {
    assert.fail("Expected the reconciled leaf to be a tool result message.");
  }
  assert.equal(toolResultEntry.message.addedToolNames, undefined);
});

test("file-system agent session reopens with a fresh MCP active set while retaining the durable activation marker", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "progressive-session", sessionCwd: fixture.workspace });
  const definition = fileSystemMcpToolDefinition("docs__lookup");
  const gateway: ToolExecutionGateway = {
    list: () => [globalThis.structuredClone(definition)],
    has: (name) => name === definition.name,
    preflight: (request) => ({ status: "ready", request }),
    execute: async () => { throw new Error("The deferred MCP executor must not run in this lifecycle test."); },
  };
  const visibilityPlan = fileSystemProgressiveVisibilityPlan(definition);
  const inputFor = (userMessage: string, runId: string): AgentLoopInput => ({
    instructions: "You are the Ordinary Agent.",
    messages: [
      { role: "system", content: "You are the Ordinary Agent." },
      { role: "user", content: userMessage },
    ],
    tools: {
      definitions: [globalThis.structuredClone(definition)],
      gateway,
      context: { callerAgentId: "ordinary", traceId: runId, goalId: runId },
      permission: { callerAgentId: "ordinary", allowedTools: [definition.name] },
    },
    toolVisibilityPlan: visibilityPlan,
    abortSignal: new AbortController().signal,
  });
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("mcp_load", { tool_names: [definition.name] }, { id: "load-first" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("first run complete"),
  ]);
  const firstLease = await fixture.repository.acquire(ref);
  const firstLoop = createAgentSessionLoop({
    executionEnvironment: fixture.fileSystem,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    agentSession: firstLease.session,
  });
  try {
    const first = await firstLoop.execute(inputFor("load the documentation tool", "first-run"));
    assert.equal(first.status, "completed", first.status === "failed" ? first.error : undefined);
    assert.equal(first.toolResults.find((result) => result.toolName === "mcp_load")?.status, "completed");
  } finally {
    await firstLoop.release();
    await firstLease.release();
  }

  const reopenedRepository = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const secondLease = await reopenedRepository.acquire(ref);
  let secondRequest: {
    readonly toolNames: readonly string[];
    readonly historicalLoadFound: boolean;
    readonly historicalAddedToolNames?: readonly string[];
  } | undefined;
  faux.setResponses([(context) => {
    const historicalLoad = context.messages.find((message) =>
      message.role === "toolResult" && message.toolName === "mcp_load");
    const historicalAddedToolNames = historicalLoad?.role === "toolResult"
      ? historicalLoad.addedToolNames
      : undefined;
    secondRequest = {
      toolNames: (context.tools ?? []).map((tool) => tool.name),
      historicalLoadFound: historicalLoad !== undefined,
      ...(historicalAddedToolNames === undefined
        ? {}
        : { historicalAddedToolNames: [...historicalAddedToolNames] }),
    };
    return fauxAssistantMessage("second run complete");
  }]);
  const secondLoop = createAgentSessionLoop({
    executionEnvironment: fixture.fileSystem,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    agentSession: secondLease.session,
  });
  try {
    const second = await secondLoop.execute(inputFor("continue with a fresh run", "second-run"));
    assert.equal(second.status, "completed", second.status === "failed" ? second.error : undefined);
  } finally {
    await secondLoop.release();
    await secondLease.release();
  }

  assert.deepEqual(secondRequest, {
    toolNames: ["mcp_search", "mcp_load"],
    historicalLoadFound: true,
  });
  const sessionPath = path.join(fixture.sessionsRoot, ...ref.storageKey.split("/"));
  assert.deepEqual(durableToolActivationMarkers(await readFile(sessionPath, "utf8"), "mcp_load"), [
    [definition.name],
  ]);
});

test("file-system agent session repository surfaces malformed JSONL instead of opening a partial session", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const filePath = path.join(fixture.sessionsRoot, ...ref.storageKey.split("/"));
  const appendResult = await fixture.fileSystem.appendFile(filePath, "not-json\n");
  assert.equal(appendResult.ok, true);

  await assert.rejects(
    fixture.repository.acquire(ref),
    (error: unknown) => error instanceof SessionError && error.code === "invalid_entry",
  );
});

test("file-system agent session repository rejects a JSONL branch with a missing parent", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const filePath = path.join(fixture.sessionsRoot, ...ref.storageKey.split("/"));
  const appendResult = await fixture.fileSystem.appendFile(filePath, `${JSON.stringify({
    type: "custom",
    id: "orphan-entry",
    parentId: "missing-parent",
    timestamp: new Date().toISOString(),
    customType: "test",
  })}\n`);
  assert.equal(appendResult.ok, true);

  const lease = await fixture.repository.acquire(ref);
  await assert.rejects(
    lease.session.getBranch(),
    (error: unknown) => error instanceof SessionError && error.code === "invalid_session" &&
      /missing-parent/u.test(error.message),
  );
  await lease.release();
});

test("file-system agent session repository restores a pending tool branch after rollback", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const safeEntryId = await lease.session.appendMessage({ role: "user", content: "write", timestamp: 1 });
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "write", arguments: { path: "a.txt" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });
  await lease.revokeTo({ sessionId: ref.sessionId, entryId: safeEntryId });
  await lease.release();

  const restarted = new FileSystemAgentSessionRepository({
    fileSystem: fixture.fileSystem,
    sessionsRoot: fixture.sessionsRoot,
  });
  const reconciled = await restarted.reconcileToolResultEntries({
    sessionRef: ref,
    assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
    recoveryLeafRef: { sessionId: ref.sessionId, entryId: safeEntryId },
    orderedResults: [{
      callId: "call-1",
      toolName: "write",
      input: { path: "a.txt" },
      output: undefined,
      status: "failed",
      error: "Execution outcome is unknown after restart.",
      errorFacts: { code: "tool_execution_outcome_unknown" },
      durationMs: 0,
    }],
  });

  assert.deepEqual(await restarted.getActiveBranchEntryRefs(ref), [
    { sessionId: ref.sessionId, entryId: safeEntryId },
    { sessionId: ref.sessionId, entryId: assistantEntryId },
    reconciled,
  ]);
});

test("file-system agent session repository refuses to revive a stale tool branch", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);
  const safeEntryId = await lease.session.appendMessage({ role: "user", content: "write", timestamp: 1 });
  const assistantEntryId = await lease.session.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: "write", arguments: { path: "a.txt" } }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 2,
  });
  await lease.revokeTo({ sessionId: ref.sessionId, entryId: safeEntryId });
  await lease.release();
  const successor = await fixture.repository.acquire(ref);
  await successor.session.appendMessage({ role: "user", content: "new branch", timestamp: 3 });
  await successor.release();

  await assert.rejects(
    fixture.repository.reconcileToolResultEntries({
      sessionRef: ref,
      assistantEntryRef: { sessionId: ref.sessionId, entryId: assistantEntryId },
      recoveryLeafRef: { sessionId: ref.sessionId, entryId: safeEntryId },
      orderedResults: [{
        callId: "call-1",
        toolName: "write",
        input: { path: "a.txt" },
        output: undefined,
        status: "failed",
        durationMs: 0,
      }],
    }),
    (error: unknown) => error instanceof AgentSessionRepositoryError &&
      error.code === "agent_session_ref_invalid" &&
      /recovery leaf does not match/u.test(error.message),
  );
});

test("file-system agent session repository rejects traversal and forged metadata", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });

  await assert.rejects(
    fixture.repository.acquire({ ...ref, storageKey: "../outside.jsonl" }),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_ref_invalid",
  );
  await assert.rejects(
    fixture.repository.acquire({ ...ref, sessionId: "forged-session" }),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_metadata_mismatch",
  );
});

test("file-system agent session repository delete is idempotent and refuses an active writer", async (t) => {
  const fixture = await repositoryFixture(t);
  const ref = await fixture.repository.create({ sessionId: "session-one", sessionCwd: fixture.workspace });
  const lease = await fixture.repository.acquire(ref);

  await assert.rejects(
    fixture.repository.delete(ref),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_writer_active",
  );
  await lease.release();
  await fixture.repository.delete(ref);
  await fixture.repository.delete(ref);
  await assert.rejects(
    fixture.repository.acquire(ref),
    (error: unknown) => error instanceof AgentSessionRepositoryError && error.code === "agent_session_not_found",
  );
});

function fileSystemMcpToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Execute frozen MCP tool ${name}.`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
    metadata: {
      category: "mcp",
      riskLevel: "low",
      operationType: "read-only",
      requiresConfirmation: false,
    },
  };
}

function fileSystemProgressiveVisibilityPlan(definition: ToolDefinition): AgentLoopToolVisibilityPlan {
  return {
    policyId: "mcp-progressive/v1",
    snapshotId: "file-system-progressive-session",
    costGate: {
      minimumDeferredDefinitionTokens: 1,
      minimumNetDefinitionSavingsTokens: 1,
      definitionSerialization: { api: "openai-responses", includeStrict: true },
    },
    initiallyVisibleToolNames: [],
    deferredTools: [{
      name: definition.name,
      displayName: definition.name,
      description: definition.description,
      source: { kind: "mcp", id: "docs", label: "Documentation" },
      definitionHash: `sha256:${definition.name}`,
    }],
    controls: {
      search: {
        name: "mcp_search",
        description: "Search the frozen MCP tool catalog without loading or executing tools.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 1, maxLength: 200 },
            server_id: { type: "string", minLength: 1, maxLength: 128 },
            cursor: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
          },
          additionalProperties: false,
        },
        metadata: {
          category: "mcp",
          riskLevel: "low",
          operationType: "read-only",
          requiresConfirmation: false,
        },
      },
      load: {
        name: "mcp_load",
        description: "Expose authorized frozen MCP definitions from the next model request.",
        inputSchema: {
          type: "object",
          properties: {
            tool_names: {
              type: "array",
              minItems: 1,
              maxItems: 16,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 128 },
            },
          },
          required: ["tool_names"],
          additionalProperties: false,
        },
        metadata: {
          category: "mcp",
          riskLevel: "low",
          operationType: "read-write",
          requiresConfirmation: false,
        },
      },
    },
  };
}

function durableToolActivationMarkers(serializedSession: string, toolName: string): readonly unknown[] {
  return serializedSession
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
    .flatMap((entry) => {
      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return [];
      if (entry.message.role !== "toolResult" || entry.message.toolName !== toolName) return [];
      return [entry.message.addedToolNames];
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function repositoryFixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-session-repository-"));
  const sessionsRoot = path.join(root, "sessions");
  const workspace = path.join(root, "workspace");
  const fileSystem = new NodeExecutionEnv({ cwd: root });
  const repository = new FileSystemAgentSessionRepository({ fileSystem, sessionsRoot });
  t.after(async () => {
    await fileSystem.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { fileSystem, repository, sessionsRoot, workspace };
}
