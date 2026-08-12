import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySessionRepo, type CompactionSettings } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { compactSessionContextIfNeeded } from "./session-context-compaction.js";

const TEST_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 100,
  keepRecentTokens: 300,
};

test("session context compaction persists a compaction entry and rebuilds provider context", async () => {
  const session = await new InMemorySessionRepo().create({ id: "session-one" });
  for (let index = 0; index < 30; index += 1) {
    await session.appendMessage({
      role: "user",
      content: `old context ${index} `.repeat(50),
      timestamp: index * 2 + 1,
    });
    await session.appendMessage(fauxAssistantMessage(`old answer ${index}`));
  }
  await session.appendMessage({ role: "user", content: "current request", timestamp: 100 });
  const faux = fauxProvider({ models: [{ id: "small-model", contextWindow: 3_000, maxTokens: 500 }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("summary of old context")]);
  const model = faux.getModel();

  const result = await compactSessionContextIfNeeded({
    agentSession: session,
    activeContextMessages: (await session.buildContext()).messages,
    modelRegistry: models,
    selectedModel: model,
    abortSignal: new AbortController().signal,
    compactionSettings: TEST_SETTINGS,
  });

  assert.equal(result.status, "compacted", result.status === "failed" ? result.error : undefined);
  if (result.status !== "compacted") return;
  assert.equal((await session.getEntry(result.compactionEntryRef.entryId))?.type, "compaction");
  assert.equal(result.compactionEntryRef.sessionId, "session-one");
  assert.equal(result.compactedContextMessages[0]?.role, "compactionSummary");
  assert.equal(result.compactedContextMessages.at(-1)?.role, "user");
  assert.equal(faux.state.callCount, 1);
});

test("session context compaction leaves a small context unchanged without a summary request", async () => {
  const session = await new InMemorySessionRepo().create({ id: "session-one" });
  await session.appendMessage({ role: "user", content: "small request", timestamp: 1 });
  const faux = fauxProvider({ models: [{ id: "large-model", contextWindow: 100_000, maxTokens: 1_000 }] });
  const models = createModels();
  models.setProvider(faux.provider);

  const result = await compactSessionContextIfNeeded({
    agentSession: session,
    activeContextMessages: (await session.buildContext()).messages,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    abortSignal: new AbortController().signal,
    compactionSettings: TEST_SETTINGS,
  });

  assert.deepEqual(result, { status: "unchanged" });
  assert.equal(faux.state.callCount, 0);
  assert.equal((await session.getEntries()).some((entry) => entry.type === "compaction"), false);
});

test("session context compaction reports overflow when one retained turn still exceeds the window", async () => {
  const session = await new InMemorySessionRepo().create({ id: "session-one" });
  await session.appendMessage({ role: "user", content: "oversized turn ".repeat(2_000), timestamp: 1 });
  await session.appendMessage(fauxAssistantMessage("old answer"));
  await session.appendMessage({ role: "user", content: "current request", timestamp: 2 });
  const faux = fauxProvider({ models: [{ id: "small-model", contextWindow: 3_000, maxTokens: 500 }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("summary")]);

  const result = await compactSessionContextIfNeeded({
    agentSession: session,
    activeContextMessages: (await session.buildContext()).messages,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    abortSignal: new AbortController().signal,
    compactionSettings: TEST_SETTINGS,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.code : undefined, "context_overflow");
  assert.equal(faux.state.callCount, 1);
});

test("session context compaction substitutes a text notice for image content when the model is text-only", async () => {
  const session = await new InMemorySessionRepo().create({ id: "session-one" });
  await session.appendMessage({
    role: "user",
    content: [
      { type: "text", text: "old image context" },
      { type: "image", mimeType: "image/png", data: Buffer.from("image").toString("base64") },
    ],
    timestamp: 1,
  });
  for (let index = 0; index < 30; index += 1) {
    await session.appendMessage({ role: "user", content: `old context ${index} `.repeat(50), timestamp: index * 2 + 3 });
    await session.appendMessage(fauxAssistantMessage(`old answer ${index}`));
  }
  await session.appendMessage({ role: "user", content: "current request", timestamp: 100 });
  const faux = fauxProvider({ models: [{ id: "text-only-model", contextWindow: 3_000, maxTokens: 500, input: ["text"] }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("summary of old context")]);

  const result = await compactSessionContextIfNeeded({
    agentSession: session,
    activeContextMessages: (await session.buildContext()).messages,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    abortSignal: new AbortController().signal,
    compactionSettings: TEST_SETTINGS,
  });

  assert.equal(result.status, "compacted", result.status === "failed" ? result.error : undefined);
  if (result.status !== "compacted") return;
  assert.equal((await session.getEntry(result.compactionEntryRef.entryId))?.type, "compaction");
  assert.equal(faux.state.callCount, 1);
});

test("session context compaction still refuses image summarization for vision-capable models", async () => {
  const session = await new InMemorySessionRepo().create({ id: "session-one" });
  await session.appendMessage({
    role: "user",
    content: [
      { type: "text", text: "old image context" },
      { type: "image", mimeType: "image/png", data: Buffer.from("image").toString("base64") },
    ],
    timestamp: 1,
  });
  for (let index = 0; index < 30; index += 1) {
    await session.appendMessage({ role: "user", content: `old context ${index} `.repeat(50), timestamp: index * 2 + 3 });
    await session.appendMessage(fauxAssistantMessage(`old answer ${index}`));
  }
  await session.appendMessage({ role: "user", content: "current request", timestamp: 100 });
  const faux = fauxProvider({ models: [{ id: "small-model", contextWindow: 3_000, maxTokens: 500 }] });
  const models = createModels();
  models.setProvider(faux.provider);

  const result = await compactSessionContextIfNeeded({
    agentSession: session,
    activeContextMessages: (await session.buildContext()).messages,
    modelRegistry: models,
    selectedModel: faux.getModel(),
    abortSignal: new AbortController().signal,
    compactionSettings: TEST_SETTINGS,
  });

  assert.deepEqual(result, {
    status: "failed",
    code: "context_compaction_images_unsupported",
    error: "The active Session contains image content in the compaction prefix; Pi image-aware request-boundary compaction is required.",
  });
  assert.equal(faux.state.callCount, 0);
  assert.equal((await session.getEntries()).some((entry) => entry.type === "compaction"), false);
});