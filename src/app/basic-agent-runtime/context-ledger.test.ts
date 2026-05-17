import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import {
  appendToolEnvelopeToContextLedger,
  createBasicAgentContextLedger,
} from "./context-ledger.js";

test("context ledger records goal, history, attachments, skills, budget, and safe refs", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "summarize attached project",
    goalId: "goal-ledger",
    traceId: "trace-ledger",
    contextRefs: [
      {
        ref: "file:README.md",
        kind: "file",
        summary: "README only",
        readonlyPreview: {
          title: "README.md",
          text: "Project preview with Bearer sk-context-secret",
          truncated: true,
        },
      },
    ],
    permissionBoundaryRefs: ["read:file:README.md"],
  });

  const ledger = createBasicAgentContextLedger({
    runId: "run-ledger",
    goal: "summarize attached project without leaking api_key=sk-user-secret",
    taskSoil,
    conversationHistory: [
      { role: "user", content: "previous question", ref: "turn:user:1" },
      { role: "assistant", content: "previous answer", ref: "turn:assistant:1" },
    ],
    skillContexts: [skillContext()],
    modelCapabilities: {
      contextWindowTokens: 4_000,
      maxOutputTokens: 1_000,
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

  assert.equal(ledger.runId, "run-ledger");
  assert.equal(ledger.items.some((item) => item.sourceKind === "system"), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "system" && item.summary.includes("Do not write shell commands")), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "conversation_recent_turn"), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "task_soil_ref"), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "skill"), true);
  assert.equal(ledger.budget.budgetSource, "model_capabilities");
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "attachment"), true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "budget" && entry.status === "used"), true);
  assert.match(ledger.readModel.summary, /最近对话/);
  const json = JSON.stringify(ledger);
  assert.equal(json.includes("sk-context-secret"), false);
  assert.equal(json.includes("sk-user-secret"), false);
  assert.equal(json.includes("runtime:"), false);
  assert.equal(json.includes("store:"), false);
});

test("context ledger append preserves existing context and adds only safe tool evidence", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "answer with evidence",
    goalId: "goal-append",
    traceId: "trace-append",
  });
  const ledger = createBasicAgentContextLedger({
    runId: "run-append",
    goal: "answer with evidence",
    taskSoil,
    conversationHistory: [{ role: "user", content: "history survives", ref: "turn:user:1" }],
  });

  const appended = appendToolEnvelopeToContextLedger(ledger, toolEnvelope());

  assert.equal(appended.items.some((item) => item.sourceKind === "user_message"), true);
  assert.equal(appended.items.some((item) => item.sourceKind === "conversation_recent_turn" && item.summary.includes("history survives")), true);
  assert.equal(appended.items.some((item) => item.sourceKind === "tool_evidence"), true);
  assert.equal(appended.evidenceRefs.includes("web:https://example.test"), true);
  const json = JSON.stringify(appended);
  assert.equal(json.includes("raw stdout body"), false);
  assert.equal(json.includes("sk-tool-secret"), false);
});

test("context ledger reports truncation when messages or chars exceed budget", () => {
  const taskSoil = createTaskSoil({ rawGoal: "trim", goalId: "goal-trim", traceId: "trace-trim" });
  const ledger = createBasicAgentContextLedger({
    runId: "run-trim",
    goal: "trim",
    taskSoil,
    conversationHistory: Array.from({ length: 12 }, (_, index) => ({
      role: "user" as const,
      content: `history ${index} ${"x".repeat(500)}`,
    })),
    maxMessages: 4,
    maxChars: 2_000,
  });

  assert.equal(ledger.truncationReport.truncated, true);
  assert.equal(ledger.truncationReport.omittedItemCount > 0, true);
  assert.equal(ledger.budget.estimatedInputTokens !== undefined, true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.status === "omitted"), true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "truncation" && entry.status === "omitted"), true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "budget" && entry.status === "truncated"), true);
});

test("context ledger summarizes older history and keeps the latest four pairs as turns", () => {
  const taskSoil = createTaskSoil({ rawGoal: "continue", goalId: "goal-history", traceId: "trace-history" });
  const conversationHistory = Array.from({ length: 6 }, (_, index) => ([
    {
      role: "user" as const,
      content: `older user ${index}`,
      ref: `conversation:history:user:${index}`,
    },
    {
      role: "assistant" as const,
      content: `older assistant ${index}`,
      ref: `conversation:history:assistant:${index}`,
    },
  ])).flat();

  const ledger = createBasicAgentContextLedger({
    runId: "run-history",
    goal: "continue from previous work",
    taskSoil,
    conversationHistory,
  });

  const summary = ledger.items.find((item) => item.sourceKind === "conversation_summary");
  const recentTurns = ledger.items.filter((item) => item.sourceKind === "conversation_recent_turn");

  assert.notEqual(summary, undefined);
  assert.equal(summary?.summary.includes("older user 0"), true);
  assert.equal(summary?.summary.includes("older assistant 1"), true);
  assert.equal(summary?.summary.includes("older user 2"), false);
  assert.equal(recentTurns.length, 8);
  assert.deepEqual(recentTurns.map((item) => item.role), [
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
  ]);
  assert.equal(recentTurns.at(-1)?.summary.includes("older assistant 5"), true);
});

test("context ledger conversation summary redacts secrets and internal raw fragments", () => {
  const taskSoil = createTaskSoil({ rawGoal: "continue safely", goalId: "goal-safe-history", traceId: "trace-safe-history" });
  const ledger = createBasicAgentContextLedger({
    runId: "run-safe-history",
    goal: "continue safely",
    taskSoil,
    conversationHistory: [
      {
        role: "user",
        content: "safe older request\nraw prompt: do not show\napi_key=sk-history-secret\ninternal loop state",
        ref: "conversation:history:user:0",
      },
      {
        role: "assistant",
        content: "safe older answer\nraw provider response: private\nraw tool output: private\nhidden reasoning: private",
        ref: "conversation:history:assistant:0",
      },
      ...Array.from({ length: 4 }, (_, index) => ([
        {
          role: "user" as const,
          content: `recent user ${index}`,
          ref: `conversation:history:user:${index + 1}`,
        },
        {
          role: "assistant" as const,
          content: `recent assistant ${index}`,
          ref: `conversation:history:assistant:${index + 1}`,
        },
      ])).flat(),
    ],
  });

  const summary = ledger.items.find((item) => item.sourceKind === "conversation_summary");
  const text = JSON.stringify(summary);

  assert.notEqual(summary, undefined);
  assert.equal(text.includes("safe older request"), true);
  assert.equal(text.includes("safe older answer"), true);
  assert.equal(text.includes("sk-history-secret"), false);
  assert.equal(text.includes("raw prompt"), false);
  assert.equal(text.includes("raw provider response"), false);
  assert.equal(text.includes("raw tool output"), false);
  assert.equal(text.includes("hidden reasoning"), false);
  assert.equal(text.includes("internal loop"), false);
});

function skillContext(): DesktopAgentSkillContext {
  return {
    skill: {
      id: "summarize",
      name: "Summarize",
      description: "Summarize project materials.",
      enabled: true,
      sourcePath: "Z:/AgentArbor/.agents/skills/summarize/SKILL.md",
      triggers: ["summarize"],
    },
    body: "Use concise summaries. Do not read resource files unless asked. sk-skill-secret",
    triggerReason: "goal contains summarize",
  };
}

function toolEnvelope(): ToolResultEnvelope {
  return {
    agentSummary: "Search found a safe project reference. sk-tool-secret",
    evidenceRefs: ["web:https://example.test"],
    tokenEstimate: 12,
    truncated: false,
    redacted: true,
    diagnosticRef: "tool:search:1",
    rawRetention: "diagnostic_ref_only",
    uiDisplay: {
      kind: "generic_tool_summary",
      action: "search",
      summary: "safe summary",
      items: ["result one"],
    },
  };
}
