import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/index.js";
import { desktopAgentContextPack, type DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { buildBasicAgentContextPack } from "./context-pack.js";
import type { BasicAgentContextAgentDefinition } from "./context-ledger-items.js";

const CONTEXT_PACK_TEST_AGENT: BasicAgentContextAgentDefinition = {
  agentId: "context-pack-test-agent",
  prompt: {
    promptRef: "prompt:context-pack-test-agent:v1",
    version: "1",
    systemPrompt: "Context pack test agent prompt.",
  },
};

test("Desktop Agent context pack uses the default AgentDefinition when none is injected", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "answer with the default ordinary agent",
    goalId: "goal-default-agent-definition",
    traceId: "trace-default-agent-definition",
  });

  const pack = desktopAgentContextPack({
    goal: "answer with the default ordinary agent",
    taskSoil,
    conversationHistory: [],
  });

  assert.equal(pack.messages[0]?.content, DESKTOP_ROOT_AGENT.prompt.systemPrompt);
  assert.equal(pack.items[0]?.itemId, `context:system:${DESKTOP_ROOT_AGENT.agentId}`);
  assert.equal(pack.inputRefs.some((ref) => ref.kind === "event" && ref.id === DESKTOP_ROOT_AGENT.prompt.promptRef), true);
});

test("Basic Agent context pack includes history, task refs, readonly previews, and skills without redaction", () => {
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
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "please review this project without exposing api_key=sk-context-secret",
    taskSoil,
    skillContexts: [skill],
    conversationHistory: [
      { role: "user", content: "previous user message", ref: "conversation:user:1" },
      { role: "assistant", content: "previous assistant reply", ref: "conversation:assistant:1" },
    ],
  });

  assert.deepEqual(pack.messages.map((message) => message.role), ["system", "system", "user", "assistant", "user"]);
  assert.equal(pack.messages[0]?.content, CONTEXT_PACK_TEST_AGENT.prompt.systemPrompt);
  assert.equal(pack.inputRefs.some((ref) => ref.kind === "trace" && ref.id === "trace-test"), true);
  assert.equal(pack.items.some((item) => item.sourceKind === "task_soil_ref" && item.visibility === "diagnostic"), true);
  assert.match(pack.usageSummary, /技能 1/);
  assert.equal(pack.truncationReport.truncated, true);
  assert.equal(pack.truncated, true);
  const text = JSON.stringify(pack);
  assert.equal(text.includes("previous assistant reply"), true);
  assert.equal(text.includes("README.md"), true);
  assert.equal(text.includes("context-token-value"), true);
  assert.equal(text.includes("api_key=sk-context-secret"), true);
  assert.equal(text.includes("[redacted-secret]"), false);
  assert.equal(text.includes("[redacted-token]"), false);
});

test("Basic Agent context pack does not expose run facts or tool visibility metadata", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "answer using available context",
    goalId: "goal-no-run-facts",
    traceId: "trace-no-run-facts",
    contextRefs: [
      {
        ref: "workspace:README.md",
        kind: "file",
        summary: "README context",
      },
    ],
  });

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "answer using available context",
    taskSoil,
    conversationHistory: [
      { role: "user", content: "previous question", ref: "conversation:no-facts:user" },
      { role: "assistant", content: "previous answer", ref: "conversation:no-facts:assistant" },
    ],
  });
  const text = JSON.stringify(pack);

  for (const runFactField of [
    "allowedTools",
    "toolExposures",
    "capabilityResolution",
    "capabilitySnapshot",
    "agentDefinitionRef",
    "toolVisibilityProfile",
    "outputContractId",
    "defaultMaxOutputTokens",
  ]) {
    assert.equal(text.includes(runFactField), false, `context pack must not expose ${runFactField}`);
  }
});

test("Basic Agent context pack marks budget truncation instead of overfilling messages", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "summarize",
    goalId: "goal-budget",
    traceId: "trace-budget",
  });

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
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
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
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
  assert.equal(lastMessage?.content, "this is the current user instruction");
  assert.equal(pack.items.some((item) => item.sourceKind === "conversation_summary"), false);
  assert.equal(pack.truncated, true);
});

test("Basic Agent context pack preserves history roles without pre-threshold deterministic compaction", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue",
    goalId: "goal-pack-history",
    traceId: "trace-pack-history",
  });

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
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

  assert.equal(pack.items.some((item) => item.sourceKind === "conversation_summary"), false);
  assert.deepEqual(pack.messages.map((message) => message.role), [
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
    "assistant",
    "user",
    "assistant",
    "user",
  ]);
  assert.equal(pack.messages.at(-1)?.content, "continue");
});

test("Basic Agent context pack keeps recent role turns before bulky skill instructions", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue",
    goalId: "goal-pack-history-priority",
    traceId: "trace-pack-history-priority",
  });
  const skill: DesktopAgentSkillContext = {
    skill: {
      id: "bulky-skill",
      name: "Bulky Skill",
      description: "Large optional guidance.",
      enabled: true,
      sourcePath: "Z:/AgentArbor/.agents/skills/bulky/SKILL.md",
      triggers: ["continue"],
    },
    body: `Optional skill instructions ${"x".repeat(3_000)}`,
    triggerReason: "matched goal",
  };

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "continue",
    taskSoil,
    skillContexts: [skill],
    conversationHistory: [
      { role: "user", content: "recent user context", ref: "conversation:pack-priority:user" },
      { role: "assistant", content: "recent assistant context", ref: "conversation:pack-priority:assistant" },
    ],
    maxMessages: 4,
    maxChars: 2_000,
  });

  assert.deepEqual(pack.messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.equal(pack.messages[1]?.content.includes("recent user context"), true);
  assert.equal(pack.messages[2]?.content.includes("recent assistant context"), true);
  assert.equal(pack.messages.some((message) => message.content.includes("Optional skill instructions")), false);
  assert.equal(pack.truncated, true);
});

test("Basic Agent context pack derives token budget from model capabilities", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "answer",
    goalId: "goal-model-budget",
    traceId: "trace-model-budget",
  });

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
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
  assert.equal(pack.budget.inputTokenBudget, 8_000);
  assert.equal(typeof pack.budget.usedInputTokens, "number");
  assert.equal(pack.budget.tokenCountSource, "openai_tiktoken");
});
