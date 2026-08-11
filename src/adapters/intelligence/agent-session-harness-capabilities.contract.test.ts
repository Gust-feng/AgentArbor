import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  Agent,
  AgentHarness,
  InMemorySessionRepo,
  JsonlSessionRepo,
  NodeExecutionEnv,
  type AgentTool,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";

test("agent session tree moves the active branch without deleting abandoned entries", async () => {
  const repository = new InMemorySessionRepo();
  const session = await repository.create({ id: "ordinary-session" });
  await session.appendMessage(userMessage("first"));
  const firstAnswerId = await session.appendMessage(fauxAssistantMessage("answer:first"));
  const abandonedId = await session.appendMessage(userMessage("abandoned"));

  await session.moveTo(firstAnswerId);
  const branchId = await session.appendMessage(userMessage("branch"));

  assert.equal(await session.getLeafId(), branchId);
  assert.deepEqual((await session.getBranch()).flatMap(messageText), [
    "first",
    "answer:first",
    "branch",
  ]);
  assert.equal((await session.getEntries()).some((entry) => entry.id === abandonedId), true);

  const fork = await repository.fork(await session.getMetadata(), {
    id: "ordinary-session-fork",
    entryId: firstAnswerId,
    position: "at",
  });
  assert.deepEqual((await fork.getBranch()).flatMap(messageText), ["first", "answer:first"]);
});

test("JSONL agent session repository restores the active branch after reopening", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-session-"));
  const environment = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await environment.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const repository = new JsonlSessionRepo({ fs: environment, sessionsRoot: "sessions" });
  const session = await repository.create({
    id: "persisted",
    cwd: root,
    metadata: { owner: "ordinary" },
  });
  await session.appendMessage(userMessage("one"));
  const answerId = await session.appendMessage(fauxAssistantMessage("answer:one"));
  await session.appendMessage(userMessage("discarded"));
  await session.moveTo(answerId);
  const replacementId = await session.appendMessage(userMessage("replacement"));

  const sourceMetadata = await session.getMetadata();
  const reopened = await repository.open(sourceMetadata);

  assert.deepEqual((await reopened.getBranch()).flatMap(messageText), [
    "one",
    "answer:one",
    "replacement",
  ]);
  const beforeFork = await repository.fork(sourceMetadata, {
    id: "persisted-before-fork",
    cwd: root,
    entryId: replacementId,
    position: "before",
  });
  const atFork = await repository.fork(sourceMetadata, {
    id: "persisted-at-fork",
    cwd: root,
    entryId: replacementId,
    position: "at",
  });
  assert.deepEqual((await beforeFork.getBranch()).flatMap(messageText), ["one", "answer:one"]);
  assert.deepEqual((await atFork.getBranch()).flatMap(messageText), ["one", "answer:one", "replacement"]);
  for (const fork of [beforeFork, atFork]) {
    const metadata = await fork.getMetadata();
    assert.equal(metadata.parentSessionPath, sourceMetadata.path);
    assert.deepEqual(metadata.metadata, { owner: "ordinary" });
  }
});

test("agent session harness persists one prompt and answer through its session", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-harness-"));
  const environment = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await environment.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const repository = new InMemorySessionRepo();
  const session = await repository.create({ id: "harness-session" });
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("harness answer")]);
  const harness = new AgentHarness({
    env: environment,
    session,
    models,
    model: faux.getModel(),
    systemPrompt: "You are the Ordinary Agent.",
  });

  const answer = await harness.prompt("hello");

  assert.deepEqual(answer.content.flatMap((block) => block.type === "text" ? [block.text] : []), [
    "harness answer",
  ]);
  assert.deepEqual((await session.getBranch()).flatMap(messageText), ["hello", "harness answer"]);
});

test("agent session harness can pause a tool call for external confirmation and resume it once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-confirmation-"));
  const environment = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await environment.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const session = await new InMemorySessionRepo().create({ id: "confirmation-session" });
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", {}, { id: "write-file" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("write approved"),
  ]);
  let executeCount = 0;
  let signalConfirmationRequested!: () => void;
  const confirmationRequested = new Promise<void>((resolve) => { signalConfirmationRequested = resolve; });
  let approve!: () => void;
  const approved = new Promise<void>((resolve) => { approve = resolve; });
  const parameters = Type.Object({}, { additionalProperties: false });
  const harness = new AgentHarness({
    env: environment,
    session,
    models,
    model: faux.getModel(),
    tools: [{
      name: "write",
      label: "write",
      description: "Write a file after AgentArbor confirmation.",
      parameters,
      executionMode: "sequential",
      async execute() {
        signalConfirmationRequested();
        await approved;
        executeCount += 1;
        return { content: [{ type: "text", text: "written" }], details: {} };
      },
    }],
  });

  const run = harness.prompt("write");
  await confirmationRequested;
  assert.equal(executeCount, 0);

  approve();
  const answer = await run;

  assert.equal(executeCount, 1);
  assert.deepEqual(answer.content.flatMap((block) => block.type === "text" ? [block.text] : []), [
    "write approved",
  ]);
});

test("agent session harness returns one denied tool call to the model and continues the loop", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentarbor-confirmation-deny-"));
  const environment = new NodeExecutionEnv({ cwd: root });
  t.after(async () => {
    await environment.cleanup();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const session = await new InMemorySessionRepo().create({ id: "denied-confirmation-session" });
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", {}, { id: "denied-write" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("continued after denial"),
  ]);
  let executeCount = 0;
  let signalConfirmationRequested!: () => void;
  const confirmationRequested = new Promise<void>((resolve) => { signalConfirmationRequested = resolve; });
  let deny!: () => void;
  const denied = new Promise<void>((resolve) => { deny = resolve; });
  const parameters = Type.Object({}, { additionalProperties: false });
  const harness = new AgentHarness({
    env: environment,
    session,
    models,
    model: faux.getModel(),
    tools: [{
      name: "write",
      label: "write",
      description: "Write a file after AgentArbor confirmation.",
      parameters,
      executionMode: "sequential",
      async execute() {
        signalConfirmationRequested();
        await denied;
        return {
          content: [{ type: "text", text: "User rejected this tool call." }],
          details: { status: "denied" },
        };
      },
    }],
  });
  harness.on("tool_result", ({ details }) => {
    if (typeof details === "object" && details !== null && "status" in details && details.status === "denied") {
      return { isError: true };
    }
    return undefined;
  });

  const run = harness.prompt("write");
  await confirmationRequested;
  deny();
  const answer = await run;

  assert.equal(executeCount, 0);
  assert.equal(faux.state.callCount, 2);
  assert.deepEqual(answer.content.flatMap((block) => block.type === "text" ? [block.text] : []), [
    "continued after denial",
  ]);
  const toolResults = (await session.getBranch()).flatMap((entry) =>
    entry.type === "message" && entry.message.role === "toolResult" ? [entry.message] : []);
  assert.equal(toolResults.length, 1);
  assert.equal(toolResults[0]?.toolCallId, "denied-write");
  assert.equal(toolResults[0]?.isError, true);
});

test("agent session harness runs pure reads concurrently and serializes a batch containing a write", async () => {
  const parameters = Type.Object({}, { additionalProperties: false });
  let activeReads = 0;
  let maxActiveReads = 0;
  let releaseReads!: () => void;
  const readsReleased = new Promise<void>((resolve) => { releaseReads = resolve; });
  let resolveBothReads!: () => void;
  const bothReadsStarted = new Promise<void>((resolve) => { resolveBothReads = resolve; });
  const readTool = (name: string): AgentTool<typeof parameters, { readonly name: string }> => ({
    name,
    label: name,
    description: `Read through ${name}.`,
    parameters,
    executionMode: "parallel",
    async execute() {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      if (activeReads === 2) resolveBothReads();
      await readsReleased;
      activeReads -= 1;
      return { content: [{ type: "text", text: name }], details: { name } };
    },
  });
  const readA = readTool("read_a");
  const readB = readTool("read_b");
  const parallelFaux = fauxProvider();
  parallelFaux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("read_a", {}, { id: "read-a" }),
      fauxToolCall("read_b", {}, { id: "read-b" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("reads complete"),
  ]);
  const parallelAgent = new Agent({
    initialState: {
      systemPrompt: "Read in parallel.",
      model: parallelFaux.getModel(),
      tools: [readA, readB],
    },
    streamFn: parallelFaux.provider.streamSimple.bind(parallelFaux.provider),
    toolExecution: "parallel",
  });

  const parallelRun = parallelAgent.prompt("read");
  await Promise.race([
    bothReadsStarted,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Agent harness did not start both reads")), 1_000)),
  ]);
  releaseReads();
  await parallelRun;
  assert.equal(maxActiveReads, 2);

  const executionOrder: string[] = [];
  let activeMixed = 0;
  let maxActiveMixed = 0;
  const mixedTool = (
    name: string,
    executionMode: "parallel" | "sequential",
  ): AgentTool<typeof parameters, { readonly name: string }> => ({
    name,
    label: name,
    description: `Execute ${name}.`,
    parameters,
    executionMode,
    async execute() {
      executionOrder.push(`start:${name}`);
      activeMixed += 1;
      maxActiveMixed = Math.max(maxActiveMixed, activeMixed);
      await Promise.resolve();
      activeMixed -= 1;
      executionOrder.push(`end:${name}`);
      return { content: [{ type: "text", text: name }], details: { name } };
    },
  });
  const mixedFaux = fauxProvider();
  mixedFaux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("read_before", {}, { id: "read-before" }),
      fauxToolCall("write_middle", {}, { id: "write-middle" }),
      fauxToolCall("read_after", {}, { id: "read-after" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("mixed complete"),
  ]);
  const mixedAgent = new Agent({
    initialState: {
      systemPrompt: "Preserve mixed tool order.",
      model: mixedFaux.getModel(),
      tools: [
        mixedTool("read_before", "parallel"),
        mixedTool("write_middle", "sequential"),
        mixedTool("read_after", "parallel"),
      ],
    },
    streamFn: mixedFaux.provider.streamSimple.bind(mixedFaux.provider),
    toolExecution: "parallel",
  });

  await mixedAgent.prompt("execute mixed batch");

  assert.equal(maxActiveMixed, 1);
  assert.deepEqual(executionOrder, [
    "start:read_before",
    "end:read_before",
    "start:write_middle",
    "end:write_middle",
    "start:read_after",
    "end:read_after",
  ]);
});

function userMessage(content: string) {
  return { role: "user" as const, content, timestamp: Date.now() };
}

function messageText(entry: SessionTreeEntry): readonly string[] {
  if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) return [];
  const message = entry.message as {
    readonly role?: string;
    readonly content?: unknown;
  };
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((block) =>
    typeof block === "object" && block !== null && "type" in block && "text" in block &&
        block.type === "text" && typeof block.text === "string"
      ? [block.text]
      : []);
}
