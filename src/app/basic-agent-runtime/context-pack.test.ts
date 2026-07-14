import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/index.js";
import { desktopAgentContextPack, type DesktopAgentSkillContext } from "../desktop-agent/desktop-agent-prompts.js";
import { DESKTOP_ROOT_AGENT } from "../agent-prompts/desktop-root-agent.js";
import { safeDesktopAgentContextPack } from "../desktop-agent/desktop-agent-session-projection.js";
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
        attachmentId: "ctx-readme",
        title: "README.md",
        summary: "README context",
        metadata: {
          byteLength: 2048,
          mimeType: "text/markdown",
          available: true,
          truncated: true,
        },
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

  assert.deepEqual(pack.messages.map((message) => message.role), ["system", "system", "user", "assistant", "system", "user"]);
  assert.equal(pack.messages[0]?.content, CONTEXT_PACK_TEST_AGENT.prompt.systemPrompt);
  const attachmentMessage = pack.messages.find((message) => message.ref === "context:task-soil:0");
  assert.match(attachmentMessage?.content ?? "", /attachment_id=ctx-readme/);
  assert.match(attachmentMessage?.content ?? "", /mime=text\/markdown/);
  assert.match(attachmentMessage?.content ?? "", /authorized for this run/);
  assert.equal((attachmentMessage?.content ?? "").includes("available by reference only"), false);
  assert.equal(attachmentMessage?.content.includes("context-token-value"), false);
  assert.equal(pack.inputRefs.some((ref) => ref.kind === "trace" && ref.id === "trace-test"), true);
  assert.equal(pack.items.some((item) => item.sourceKind === "task_soil_ref" && item.visibility === "model"), true);
  assert.match(pack.usageSummary, /技能 1/);
  assert.equal(pack.truncationReport.truncated, false);
  assert.equal(pack.truncated, false);
  const text = JSON.stringify(pack);
  assert.equal(text.includes("previous assistant reply"), true);
  assert.equal(text.includes("README.md"), true);
  assert.equal(text.includes("context-token-value"), true);
  assert.equal(text.includes("api_key=sk-context-secret"), true);
  assert.equal(text.includes("[redacted-secret]"), false);
  assert.equal(text.includes("[redacted-token]"), false);
});

test("safe Desktop Agent context pack projection omits full skill body while model messages keep it", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "review this project",
    goalId: "goal-skill-safe-projection",
    traceId: "trace-skill-safe-projection",
  });
  const skill: DesktopAgentSkillContext = {
    skill: {
      id: "safe-projection-review",
      name: "Safe Projection Review",
      description: "Review repositories.",
      enabled: true,
      sourcePath: "Z:/AgentArbor/.agents/skills/safe-projection/SKILL.md",
      triggers: ["review"],
    },
    body: "FULL PRIVATE SKILL BODY SHOULD ONLY BE MODEL CONTEXT",
    triggerReason: "触发词：review",
    selectedAt: "2026-06-05T00:00:00.000Z",
    loadStatus: "loaded",
    loadedAt: "2026-06-05T00:00:00.000Z",
    bodyHash: "sha256:test-skill-body",
    contentHash: "sha256:test-skill-body",
    bodyCharCount: 53,
    truncated: false,
    omitted: false,
    summary: "技能：Safe Projection Review\n触发原因：触发词：review\n加载状态：已加载",
  };

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "please review this project",
    taskSoil,
    conversationHistory: [],
    skillContexts: [skill],
  });
  const safe = safeDesktopAgentContextPack(pack);

  assert.equal(pack.messages.some((message) => message.content.includes("FULL PRIVATE SKILL BODY")), true);
  assert.equal(JSON.stringify(safe).includes("FULL PRIVATE SKILL BODY"), false);
  assert.equal(JSON.stringify(safe).includes("sha256:test-skill-body"), true);
});

test("Basic Agent context pack preserves conversation history indentation and blank lines for the model", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "keep history formatting",
    goalId: "goal-history-fidelity",
    traceId: "trace-history-fidelity",
  });
  const codeHistory = [
    "I ran the command, the output was:",
    "```",
    "name    status",
    "alpha   ok",
    "beta    pending",
    "```",
  ].join("\n");

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "continue",
    taskSoil,
    conversationHistory: [
      { role: "user", content: codeHistory, ref: "conversation:fidelity:user" },
      { role: "assistant", content: "understood", ref: "conversation:fidelity:assistant" },
    ],
  });

  const historyMessage = pack.messages.find((message) => message.ref === "conversation:fidelity:user");
  assert.notEqual(historyMessage, undefined);
  // Model-facing history must keep internal whitespace, blank lines, and column
  // alignment exactly as written (no whitespace collapsing), so code/stdout/JSON
  // structure the model needs to continue the task is preserved.
  assert.equal(historyMessage?.content, codeHistory);
});

test("Basic Agent context pack lets the model token budget govern long history and skill bodies", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue with complete context",
    goalId: "goal-long-context-fidelity",
    traceId: "trace-long-context-fidelity",
  });
  const historySentinel = "SENTINEL_AFTER_OLD_HISTORY_CHARACTER_LIMIT";
  const skillSentinel = "SENTINEL_AFTER_OLD_SKILL_CHARACTER_LIMIT";
  const skill: DesktopAgentSkillContext = {
    skill: {
      id: "long-context-skill",
      name: "Long Context Skill",
      description: "A complete instruction body used to verify token-budget ownership.",
      enabled: true,
      sourcePath: "Z:/AgentArbor/.agents/skills/long-context/SKILL.md",
      triggers: ["complete context"],
    },
    body: `${"skill instruction ".repeat(360)}\n${skillSentinel}`,
    triggerReason: "explicit test selection",
  };

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "continue with complete context",
    taskSoil,
    conversationHistory: [{
      role: "assistant",
      content: `${"earlier answer ".repeat(180)}\n${historySentinel}`,
      ref: "conversation:long-context:assistant",
    }],
    skillContexts: [skill],
    maxInputTokens: 20_000,
  });

  const history = pack.messages.find((message) => message.ref === "conversation:long-context:assistant");
  const injectedSkill = pack.messages.find((message) => message.ref === "context:skill:long-context-skill");
  assert.equal(history?.content.includes(historySentinel), true);
  assert.equal(injectedSkill?.content.includes(skillSentinel), true);
  assert.equal(pack.items.find((item) => item.itemId === history?.ref)?.truncated, false);
  assert.equal(pack.items.find((item) => item.itemId === injectedSkill?.ref)?.truncated, false);
});

test("Basic Agent context pack keeps the complete model-compacted history summary within the token budget", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue from the compacted history",
    goalId: "goal-long-history-summary",
    traceId: "trace-long-history-summary",
  });
  const summarySentinel = "SENTINEL_AFTER_OLD_HISTORY_SUMMARY_CHARACTER_LIMIT";

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "continue from the compacted history",
    taskSoil,
    conversationHistory: Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `history ${index}`,
      ref: `conversation:long-summary:${index}`,
    })),
    conversationSummary: {
      summaryId: "conversation-summary:long",
      summary: `${"preserved decision ".repeat(180)}\n${summarySentinel}`,
      coveredRefs: ["conversation:long-summary:0"],
      modelRequestId: "model-request:long-summary",
    },
    maxInputTokens: 20_000,
  });

  const summary = pack.messages.find((message) => message.ref === "conversation-summary:long");
  assert.equal(summary?.content.includes(summarySentinel), true);
  assert.equal(pack.items.find((item) => item.itemId === summary?.ref)?.truncated, false);
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

test("Basic Agent context pack injects interrupted run context as system continuity facts", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue the blocked run",
    goalId: "goal-interrupted-run",
    traceId: "trace-interrupted-run",
  });
  const longPartialOutput = `partial ${"x".repeat(1_200)} SENTINEL_AFTER_INTERRUPTION_PREVIEW`;

  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "continue the blocked run",
    taskSoil,
    conversationHistory: [
      { role: "user", content: "previous user request", ref: "conversation:interrupted:user" },
    ],
    interruptedRunContexts: [{
      runId: "run-interrupted-context",
      turnStatus: "blocked",
      stopReason: "out_of_fuel",
      continuationAvailability: "new_turn",
      message: "达到轮次边界，需要继续。",
      partialOutput: longPartialOutput,
      refs: ["conversation:conv-1:turn:assistant-1", "run:run-interrupted-context"],
    }],
  });

  const interruptionMessage = pack.messages.find((message) => message.ref?.startsWith("context:run-interruption:"));
  const interruptionItem = pack.items.find((item) => item.sourceKind === "run_interruption");

  assert.equal(interruptionMessage?.role, "system");
  assert.match(interruptionMessage?.content ?? "", /Previous ordinary agent run did not complete/);
  assert.match(interruptionMessage?.content ?? "", /run_id=run-interrupted-context/);
  assert.match(interruptionMessage?.content ?? "", /stop_reason=out_of_fuel/);
  assert.match(interruptionMessage?.content ?? "", /continuation_availability=new_turn/);
  assert.equal((interruptionMessage?.content ?? "").includes("SENTINEL_AFTER_INTERRUPTION_PREVIEW"), false);
  assert.equal(interruptionItem?.truncated, true);
  assert.equal(pack.truncationReport.truncatedItemIds.includes(interruptionItem?.itemId ?? ""), true);
});

test("Basic Agent context pack injects prior tool execution facts without replacing their output", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "continue from the previous tool result",
    goalId: "goal-prior-tool-context",
    traceId: "trace-prior-tool-context",
  });
  const pack = buildBasicAgentContextPack({
    agentDefinition: CONTEXT_PACK_TEST_AGENT,
    goal: "continue from the previous tool result",
    taskSoil,
    conversationHistory: [],
    priorToolCallContexts: [{
      runId: "run-prior-tool",
      callId: "call-prior-read",
      toolName: "read_file",
      status: "completed",
      input: { path: "src/config.ts" },
      output: {
        path: "src/config.ts",
        content: "export const enabled = true;",
      },
      refs: ["run-prior-tool:event:1", "run-prior-tool:event:2"],
    }],
  });

  const toolFact = pack.items.find((item) => item.sourceKind === "run_tool_fact");
  assert.ok(toolFact);
  assert.equal(toolFact.summary.includes('"path": "src/config.ts"'), true);
  assert.equal(toolFact.summary.includes("export const enabled = true;"), true);
  const toolFactMessage = pack.messages.find((message) => message.ref === toolFact.itemId);
  assert.equal(toolFactMessage?.role, "system");
  assert.equal(toolFactMessage?.content.includes("status=completed"), true);
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
