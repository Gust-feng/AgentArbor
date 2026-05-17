import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/index.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import { buildBasicAgentContextPack } from "./context-pack.js";

test("Basic Agent context pack includes history, task refs, readonly previews, and skills safely", () => {
  const skill: DesktopAgentSkillContext = {
    skill: {
      id: "repo-review",
      name: "Repo Review",
      description: "Review repositories.",
      enabled: true,
      sourcePath: "Z:/AgentArbor/.agents/skills/repo-review/SKILL.md",
      triggers: ["review"],
    },
    body: `Use repo review steps. Do not leak sk-skill-secret-token. ${"x".repeat(6_000)}`,
    triggerReason: "触发词：review",
  };
  const taskSoil = createTaskSoil({
    rawGoal: "review this project",
    goalId: "goal-test",
    traceId: "trace-test",
    contextRefs: [
      {
        ref: "workspace:README.md",
        kind: "file",
        summary: "README context",
        readonlyPreview: {
          title: "README.md",
          text: `Preview with Bearer context-token-value ${"y".repeat(1_000)}`,
          truncated: true,
        },
      },
    ],
    permissionBoundaryRefs: ["read:workspace:current-task"],
  });

  const pack = buildBasicAgentContextPack({
    goal: "please review this project without exposing api_key=sk-context-secret",
    taskSoil,
    skillContexts: [skill],
    conversationHistory: [
      { role: "user", content: "previous user message", ref: "conversation:user:1" },
      { role: "assistant", content: "previous assistant reply", ref: "conversation:assistant:1" },
    ],
  });

  assert.deepEqual(pack.messages.map((message) => message.role), ["system", "system", "user", "assistant", "user"]);
  assert.equal(pack.inputRefs.some((ref) => ref.kind === "trace" && ref.id === "trace-test"), true);
  assert.equal(pack.items.some((item) => item.sourceKind === "task_soil_ref" && item.visibility === "diagnostic"), true);
  assert.match(pack.usageSummary, /技能 1/);
  assert.equal(pack.truncationReport.truncated, true);
  assert.equal(pack.truncated, true);
  const text = JSON.stringify(pack);
  assert.equal(text.includes("previous assistant reply"), true);
  assert.equal(text.includes("README.md"), true);
  assert.equal(text.includes("sk-skill-secret-token"), false);
  assert.equal(text.includes("context-token-value"), false);
  assert.equal(text.includes("api_key"), false);
});

test("Basic Agent context pack marks budget truncation instead of overfilling messages", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "summarize",
    goalId: "goal-budget",
    traceId: "trace-budget",
  });

  const pack = buildBasicAgentContextPack({
    goal: "summarize",
    taskSoil,
    conversationHistory: Array.from({ length: 10 }, (_, index) => ({
      role: "user" as const,
      content: `history ${index} ${"z".repeat(400)}`,
    })),
    maxMessages: 5,
    maxChars: 3_000,
  });

  assert.equal(pack.messages.length <= 5, true);
  assert.equal(pack.truncated, true);
  assert.equal(pack.truncationReport.omittedItemCount > 0, true);
});

test("Basic Agent context pack keeps current user message last under tight budget", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "this is the current user instruction",
    goalId: "goal-current-last",
    traceId: "trace-current-last",
  });

  const pack = buildBasicAgentContextPack({
    goal: "this is the current user instruction",
    taskSoil,
    conversationHistory: Array.from({ length: 16 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `long previous turn ${index} ${"x".repeat(300)}`,
      ref: `conversation:current-last:${index}`,
    })),
    maxMessages: 3,
    maxChars: 2_000,
  });

  const lastMessage = pack.messages.at(-1);
  assert.equal(lastMessage?.role, "user");
  assert.equal(lastMessage?.content.includes("Current user message: this is the current user instruction"), true);
  assert.equal(pack.items.some((item) => item.sourceKind === "conversation_summary"), false);
  assert.equal(pack.truncated, true);
});

test("Basic Agent context pack emits older history as summary and recent history with original roles", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue",
    goalId: "goal-pack-history",
    traceId: "trace-pack-history",
  });

  const pack = buildBasicAgentContextPack({
    goal: "continue",
    taskSoil,
    conversationHistory: Array.from({ length: 6 }, (_, index) => ([
      {
        role: "user" as const,
        content: `history user ${index}`,
        ref: `conversation:pack:user:${index}`,
      },
      {
        role: "assistant" as const,
        content: `history assistant ${index}`,
        ref: `conversation:pack:assistant:${index}`,
      },
    ])).flat(),
  });

  assert.equal(pack.items.some((item) => item.sourceKind === "conversation_summary"), true);
  assert.deepEqual(pack.messages.map((message) => message.role), [
    "system",
    "system",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
  ]);
  assert.equal(pack.messages.at(-1)?.content.includes("Current user message: continue"), true);
});

test("Basic Agent context pack derives token budget from model capabilities", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "answer",
    goalId: "goal-model-budget",
    traceId: "trace-model-budget",
  });

  const pack = buildBasicAgentContextPack({
    goal: "answer",
    taskSoil,
    conversationHistory: [],
    modelCapabilities: {
      contextWindowTokens: 8_000,
      maxOutputTokens: 2_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutputs: false,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "openai_compatible",
      stability: "unknown",
    },
  });

  assert.equal(pack.budget.budgetSource, "model_capabilities");
  assert.equal(pack.budget.reservedOutputTokens, 2_000);
  assert.equal(pack.budget.inputTokenBudget, 5_488);
  assert.equal(typeof pack.budget.estimatedInputTokens, "number");
});
