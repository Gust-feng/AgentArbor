import assert from "node:assert/strict";
import test from "node:test";
import { pathMemoryIdForSource, type PathMemory } from "./contracts.js";
import { searchPathMemories } from "./search.js";

function memoryFixture(
  runId: string,
  overrides: {
    readonly userRequest?: string;
    readonly toolNames?: readonly string[];
    readonly workspaceRoot?: string;
    readonly conversationId?: string;
    readonly terminalAt?: string;
    readonly terminalStatus?: "completed" | "failed";
  } = {},
): PathMemory {
  const source = {
    feature: "ordinary",
    runId,
  } as const;
  const toolNames = overrides.toolNames ?? ["run_command"];
  return {
    id: pathMemoryIdForSource(source),
    source: {
      ...source,
      sourceRevision: 2,
      conversationId: overrides.conversationId ?? `conversation-${runId}`,
      userTurnId: `${runId}-user`,
      assistantTurnId: `${runId}-assistant`,
      runCreatedAt: "2026-07-26T09:00:00.000Z",
      terminalAt: overrides.terminalAt ?? "2026-07-26T09:00:04.000Z",
    },
    scope: {
      workspaceRoot: overrides.workspaceRoot ?? "C:/workspace/demo",
      workspaceSelection: "default",
    },
    goal: { userRequest: overrides.userRequest ?? "检查构建产物", taskContextRefs: [] },
    path: {
      executionStarted: true,
      toolSteps: toolNames.map((toolName, index) => ({
        ordinal: index + 1,
        toolFactId: `${runId}-tool-${index + 1}`,
        toolName,
        status: "completed" as const,
        durationMs: 40,
        resultRef: `ordinary-run:${runId}#tool:${runId}-tool-${index + 1}`,
      })),
    },
    outcome: (overrides.terminalStatus ?? "completed") === "completed"
      ? { terminalStatus: "completed", answerRef: `ordinary-run:${runId}#answer` }
      : { terminalStatus: "failed", error: { code: "run_failed", message: "boom" } },
    verification: { status: "not_recorded", evidenceRefs: [] },
    evidenceRefs: [`ordinary-run:${runId}`],
    capturedAt: "2026-07-26T09:00:05.000Z",
  };
}

test("multi-token queries accumulate score across fields", () => {
  const memory = memoryFixture("run-1", {
    userRequest: "build the panel bundle",
    toolNames: ["run_command", "read_file"],
  });
  // "build" hits userRequest (+3); "run_command" hits toolName (+2).
  const results = searchPathMemories([memory], { text: "build run_command" });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 5);
  assert.deepEqual(results[0]?.matchedFields, ["userRequest", "toolName"]);
});

test("a short Chinese term still matches as a single token", () => {
  const memory = memoryFixture("run-cn", { userRequest: "检查构建产物" });
  const results = searchPathMemories([memory], { text: "构建" });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 3);
  assert.deepEqual(results[0]?.matchedFields, ["userRequest"]);
});

test("a Chinese phrase matches reordered wording through bigrams", () => {
  const memory = memoryFixture("run-cn-reorder", { userRequest: "登录超时的修复" });
  // Whitespace-only splitting produced one probe that this record cannot contain.
  const results = searchPathMemories([memory], { text: "修复登录超时" });
  assert.equal(results.length, 1);
  // Bigrams 修复/登录/录超/超时 hit userRequest; 复登 does not.
  assert.equal(results[0]?.score, 12);
  assert.deepEqual(results[0]?.matchedFields, ["userRequest"]);
});

test("a single Chinese character is kept as its own token", () => {
  const memory = memoryFixture("run-cn-single", { userRequest: "检查构建产物" });
  assert.equal(searchPathMemories([memory], { text: "建" })[0]?.score, 3);
});

test("mixed Chinese and Latin runs segment independently", () => {
  const memory = memoryFixture("run-mixed", {
    userRequest: "修复 panel 构建失败",
    toolNames: ["run_command"],
  });
  const results = searchPathMemories([memory], { text: "panel构建" });
  assert.equal(results.length, 1);
  // "panel" stays one word (+3) and 构建 stays one bigram (+3).
  assert.equal(results[0]?.score, 6);
});

test("punctuation-only runs never become tokens", () => {
  const memory = memoryFixture("run-punct", { userRequest: "检查构建产物" });
  // A bare separator must not match every record.
  assert.deepEqual(searchPathMemories([memory], { text: "，。！" }), []);
});

test("repeated terms score their fields once", () => {
  const memory = memoryFixture("run-repeat", { userRequest: "登录登录问题" });
  // Overlapping bigrams repeat 登录; deduplication keeps scoring stable.
  const results = searchPathMemories([memory], { text: "登录" });
  assert.equal(results[0]?.score, 3);
});

test("a token hitting multiple tool steps scores only once", () => {
  const memory = memoryFixture("run-steps", {
    userRequest: "irrelevant",
    toolNames: ["run_command", "run_command", "run_script"],
  });
  const results = searchPathMemories([memory], { text: "run_" });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, 2);
  assert.deepEqual(results[0]?.matchedFields, ["toolName"]);
});

test("zero-score memories are excluded", () => {
  const memory = memoryFixture("run-miss", { userRequest: "something else" });
  assert.deepEqual(searchPathMemories([memory], { text: "nomatchtoken" }), []);
});

test("ordering is fully deterministic across three tiers", () => {
  // Different scores: higher first.
  const highScore = memoryFixture("run-a", { userRequest: "deploy panel", toolNames: ["deploy_tool"] });
  const lowScore = memoryFixture("run-b", { userRequest: "deploy docs" });
  // Same score, different terminalAt: newer first.
  const older = memoryFixture("run-c", { userRequest: "deploy site", terminalAt: "2026-07-25T09:00:00.000Z" });
  // Same score and terminalAt as lowScore: id ascending breaks the tie.
  const sameAsLow = memoryFixture("run-0", { userRequest: "deploy app" });

  const results = searchPathMemories([lowScore, older, highScore, sameAsLow], { text: "deploy" });
  assert.deepEqual(
    results.map((match) => match.memory.source.runId),
    ["run-a", "run-0", "run-b", "run-c"],
  );
  assert.equal(results[0]?.score, 5);
});

test("matchedFields are deduplicated and follow the fixed field order", () => {
  const memory = memoryFixture("run-fields", {
    userRequest: "shared token demo",
    toolNames: ["demo_tool"],
    workspaceRoot: "C:/workspace/demo",
    conversationId: "conversation-demo",
  });
  const results = searchPathMemories([memory], { text: "demo demo" });
  assert.equal(results.length, 1);
  // The repeated token is deduplicated, so all four fields score once: 3 + 2 + 1 + 1.
  assert.equal(results[0]?.score, 7);
  assert.deepEqual(results[0]?.matchedFields, ["userRequest", "toolName", "workspaceRoot", "conversationId"]);
});

test("limit truncates after sorting", () => {
  const memories = [
    memoryFixture("run-1", { userRequest: "limit case" }),
    memoryFixture("run-2", { userRequest: "limit case" }),
    memoryFixture("run-3", { userRequest: "limit case" }),
  ];
  const results = searchPathMemories(memories, { text: "limit", limit: 2 });
  assert.deepEqual(
    results.map((match) => match.memory.source.runId),
    ["run-1", "run-2"],
  );
});

test("scope filters apply before scoring", () => {
  const memories = [
    memoryFixture("run-a", { userRequest: "scoped", workspaceRoot: "C:/workspace/one" }),
    memoryFixture("run-b", { userRequest: "scoped", workspaceRoot: "C:/workspace/two" }),
    memoryFixture("run-c", { userRequest: "scoped", workspaceRoot: "C:/workspace/one", conversationId: "conversation-x" }),
    memoryFixture("run-d", { userRequest: "scoped", workspaceRoot: "C:/workspace/one", terminalStatus: "failed" }),
  ];

  const byWorkspace = searchPathMemories(memories, { text: "scoped", workspaceRoot: "C:/workspace/one" });
  assert.deepEqual(byWorkspace.map((match) => match.memory.source.runId), ["run-a", "run-c", "run-d"]);

  const byConversation = searchPathMemories(memories, { text: "scoped", conversationId: "conversation-x" });
  assert.deepEqual(byConversation.map((match) => match.memory.source.runId), ["run-c"]);

  const byStatus = searchPathMemories(memories, { text: "scoped", terminalStatus: "failed" });
  assert.deepEqual(byStatus.map((match) => match.memory.source.runId), ["run-d"]);
});
