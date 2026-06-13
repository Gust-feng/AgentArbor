import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTaskSoil } from "../../domain/soil/index.js";
import type { ToolResultEnvelope } from "../../domain/tools/index.js";
import type { DesktopAgentSkillContext } from "../desktop-agent-prompts.js";
import type { BasicAgentContextAgentDefinition } from "./context-ledger-items.js";
import {
  appendToolEnvelopeToContextLedger,
  createBasicAgentContextLedger,
} from "./context-ledger.js";

const sourceDirectory = path.join(process.cwd(), "src", "app", "basic-agent-runtime");
const promptDirectory = path.join(process.cwd(), "src", "app", "agent-prompts");
const LEDGER_TEST_AGENT: BasicAgentContextAgentDefinition = {
  agentId: "ledger-test-agent",
  prompt: {
    promptRef: "prompt:ledger-test-agent:v1",
    version: "1",
    systemPrompt: "Ledger test agent prompt. Do not claim that a command ran without tool evidence.",
  },
};

test("context ledger keeps safe text and read model projection split from selection", async () => {
  const [ledgerSource, itemsSource, safeTextSource, readModelSource, promptSource, definitionSource] = await Promise.all([
    readFile(path.join(sourceDirectory, "context-ledger.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "context-ledger-items.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "context-ledger-safe-text.ts"), "utf8"),
    readFile(path.join(sourceDirectory, "context-ledger-read-model.ts"), "utf8"),
    readFile(path.join(promptDirectory, "desktop-root-agent-prompt.ts"), "utf8"),
    readFile(path.join(promptDirectory, "desktop-root-agent.ts"), "utf8"),
  ]);

  assert.equal(ledgerSource.includes('from "./context-ledger-items.js"'), true);
  assert.equal(ledgerSource.includes('from "./context-ledger-safe-text.js"'), false);
  assert.equal(ledgerSource.includes('from "./context-ledger-read-model.js"'), true);
  assert.equal(ledgerSource.includes("function toContextLedgerReadModel"), false);
  assert.equal(ledgerSource.includes("function contextBudgetEntries"), false);
  assert.equal(ledgerSource.includes("function contextLedgerEntryKind"), false);
  assert.equal(ledgerSource.includes("function contextUsageSummary"), false);
  assert.equal(ledgerSource.includes("function systemContextItem"), false);
  assert.equal(ledgerSource.includes("function skillContextItems"), false);
  assert.equal(ledgerSource.includes("function historyContextItems"), false);
  assert.equal(ledgerSource.includes("function currentUserMessageItem"), false);
  assert.equal(ledgerSource.includes("function taskSoilRefItems"), false);
  assert.equal(ledgerSource.includes("function toolEvidenceItems"), false);
  assert.equal(ledgerSource.includes("function contextRefPromptLine"), false);
  assert.equal(ledgerSource.includes("function safeText"), false);
  assert.equal(ledgerSource.includes("function safeUnboundedText"), false);
  assert.equal(ledgerSource.includes("function safeConversationText"), false);
  assert.equal(ledgerSource.includes("function safePlain"), false);
  assert.equal(itemsSource.includes("export function buildContextLedgerDraftItems"), true);
  assert.equal(itemsSource.includes("export function toolEvidenceItems"), true);
  assert.equal(itemsSource.includes("DESKTOP_ROOT_AGENT"), false);
  assert.equal(itemsSource.includes("desktop-root-agent"), false);
  assert.equal(itemsSource.includes("BasicAgentContextAgentDefinition"), true);
  assert.equal(itemsSource.includes("You are AgentArbor Desktop Agent"), false);
  assert.equal(promptSource.includes("DESKTOP_ROOT_AGENT_PROMPT"), true);
  assert.equal(promptSource.includes("prompt:desktop-root-agent:v1"), true);
  assert.equal(promptSource.includes("You are AgentArbor Desktop Agent"), true);
  assert.equal(definitionSource.includes('from "./desktop-root-agent-prompt.js"'), true);
  assert.equal(definitionSource.includes("You are AgentArbor Desktop Agent"), false);
  assert.equal(definitionSource.includes("export const DESKTOP_ROOT_AGENT: AgentDefinition ="), true);
  assert.equal(itemsSource.includes("function systemContextItem"), true);
  assert.equal(itemsSource.includes("function skillContextItems"), true);
  assert.equal(itemsSource.includes("function historyContextItems"), true);
  assert.equal(itemsSource.includes("function currentUserMessageItem"), true);
  assert.equal(itemsSource.includes("function contextRefPromptLine"), true);
  assert.equal(itemsSource.includes('from "./context-ledger-safe-text.js"'), true);
  assert.equal(safeTextSource.includes("export function safeContextText"), true);
  assert.equal(safeTextSource.includes("export function safeUnboundedContextText"), true);
  assert.equal(safeTextSource.includes("export function safeConversationContextText"), true);
  assert.equal(safeTextSource.includes("export function safePlainContextText"), true);
  assert.equal(readModelSource.includes("export function toContextLedgerReadModel"), true);
  assert.equal(readModelSource.includes("function contextBudgetEntries"), true);
  assert.equal(readModelSource.includes("function contextLedgerEntryKind"), true);
  assert.equal(readModelSource.includes("function contextUsageSummary"), true);
});

test("context ledger records goal, history, attachments, skills, budget, and refs without redaction", () => {
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
    agentDefinition: LEDGER_TEST_AGENT,
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
  const systemItem = ledger.items.find((item) => item.sourceKind === "system");
  assert.notEqual(systemItem, undefined);
  assert.equal(systemItem?.itemId, "context:system:ledger-test-agent");
  assert.equal(systemItem?.refs.some((ref) => ref.id === "prompt:ledger-test-agent:v1"), true);
  assert.equal(systemItem?.summary.includes("Do not claim that a command"), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "conversation_recent_turn"), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "task_soil_ref"), true);
  assert.equal(ledger.items.some((item) => item.sourceKind === "skill"), true);
  assert.equal(ledger.budget.budgetSource, "model_capabilities");
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "attachment"), true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "budget" && entry.status === "used"), true);
  const systemReadModelEntry = ledger.readModel.entries.find((entry) => entry.entryId === "context:system:ledger-test-agent");
  assert.equal(systemReadModelEntry?.summary, "当前任务的系统指令。");
  assert.equal(JSON.stringify(ledger.readModel).includes(LEDGER_TEST_AGENT.prompt.systemPrompt), false);
  assert.match(ledger.readModel.summary, /最近对话/);
  const json = JSON.stringify(ledger);
  assert.equal(json.includes("sk-context-secret"), true);
  assert.equal(json.includes("sk-user-secret"), true);
  assert.equal(json.includes("runtime:"), false);
  assert.equal(json.includes("store:"), false);
});

test("context ledger append preserves existing context and adds tool evidence without redaction", () => {
  const taskSoil = createTaskSoil({
    rawGoal: "answer with evidence",
    goalId: "goal-append",
    traceId: "trace-append",
  });
  const ledger = createBasicAgentContextLedger({
    agentDefinition: LEDGER_TEST_AGENT,
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
  assert.equal(json.includes("sk-tool-secret"), true);
});

test("context ledger reports truncation when messages or chars exceed budget", () => {
  const taskSoil = createTaskSoil({ rawGoal: "trim", goalId: "goal-trim", traceId: "trace-trim" });
  const ledger = createBasicAgentContextLedger({
    agentDefinition: LEDGER_TEST_AGENT,
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
  assert.equal(ledger.budget.usedInputTokens > 0, true);
  assert.equal(ledger.budget.tokenCountSource, "openai_tiktoken");
  assert.equal(ledger.readModel.entries.some((entry) => entry.status === "omitted"), true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "truncation" && entry.status === "omitted"), true);
  assert.equal(ledger.readModel.entries.some((entry) => entry.kind === "budget" && entry.status === "truncated"), true);
  const text = JSON.stringify(ledger.readModel);
  assert.equal(text.includes("maxInputTokens="), false);
  assert.equal(text.includes("tokenCountSource="), false);
  assert.equal(text.includes("模型输入"), false);
  assert.equal(text.includes("普通视图"), false);
});

test("context ledger preserves older history until a model-compacted summary is provided", () => {
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
    agentDefinition: LEDGER_TEST_AGENT,
    runId: "run-history",
    goal: "continue from previous work",
    taskSoil,
    conversationHistory,
  });

  const olderTurns = ledger.items.filter((item) => item.sourceKind === "conversation");
  const recentTurns = ledger.items.filter((item) => item.sourceKind === "conversation_recent_turn");

  assert.equal(ledger.items.some((item) => item.sourceKind === "conversation_summary"), false);
  assert.equal(olderTurns.length, 4);
  assert.equal(olderTurns[0]?.summary.includes("older user 0"), true);
  assert.equal(olderTurns[3]?.summary.includes("older assistant 1"), true);
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

test("context ledger uses model-compacted conversation summary when provided", () => {
  const taskSoil = createTaskSoil({ rawGoal: "continue", goalId: "goal-ai-history", traceId: "trace-ai-history" });
  const conversationHistory = Array.from({ length: 6 }, (_, index) => ([
    {
      role: "user" as const,
      content: `older user ${index}`,
      ref: `conversation:ai-history:user:${index}`,
    },
    {
      role: "assistant" as const,
      content: `older assistant ${index}`,
      ref: `conversation:ai-history:assistant:${index}`,
    },
  ])).flat();

  const ledger = createBasicAgentContextLedger({
    agentDefinition: LEDGER_TEST_AGENT,
    runId: "run-ai-history",
    goal: "continue from previous work",
    taskSoil,
    conversationHistory: conversationHistory.slice(-8),
    conversationSummary: {
      summaryId: "context:conversation-summary:ai",
      summary: "AI summary of older user and assistant decisions.",
      coveredRefs: conversationHistory.slice(0, 4).map((message) => message.ref ?? "missing"),
      modelRequestId: "model-request-summary",
      modelResponseId: "model-response-summary",
    },
  });

  const summary = ledger.items.find((item) => item.sourceKind === "conversation_summary");
  const recentTurns = ledger.items.filter((item) => item.sourceKind === "conversation_recent_turn");

  assert.notEqual(summary, undefined);
  assert.equal(summary?.summary.includes("AI summary"), true);
  assert.equal(recentTurns.length, 8);
});

test("context ledger keeps recent role history ahead of bulky skills under budget", () => {
  const taskSoil = createTaskSoil({ rawGoal: "continue", goalId: "goal-history-priority", traceId: "trace-history-priority" });
  const conversationHistory = [
    { role: "user" as const, content: "recent user should stay", ref: "conversation:priority:user" },
    { role: "assistant" as const, content: "recent assistant should stay", ref: "conversation:priority:assistant" },
  ];

  const ledger = createBasicAgentContextLedger({
    agentDefinition: LEDGER_TEST_AGENT,
    runId: "run-history-priority",
    goal: "current message should stay",
    taskSoil,
    conversationHistory,
    skillContexts: [{
      ...skillContext(),
      body: `Bulky skill body ${"x".repeat(3_000)}`,
    }],
    maxMessages: 4,
    maxChars: 2_000,
  });

  assert.equal(ledger.items.some((item) => item.sourceKind === "user_message"), true);
  assert.deepEqual(
    ledger.items
      .filter((item) => item.sourceKind === "conversation_recent_turn")
      .map((item) => item.role),
    ["user", "assistant"]
  );
  assert.equal(ledger.items.some((item) => item.sourceKind === "skill"), false);
  assert.equal(ledger.truncationReport.truncated, true);
});

test("context ledger conversation history preserves prior conversation text", () => {
  const taskSoil = createTaskSoil({ rawGoal: "continue safely", goalId: "goal-safe-history", traceId: "trace-safe-history" });
  const ledger = createBasicAgentContextLedger({
    agentDefinition: LEDGER_TEST_AGENT,
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

  const text = JSON.stringify(
    ledger.items.filter((item) => item.sourceKind === "conversation" || item.sourceKind === "conversation_recent_turn")
  );

  assert.equal(text.includes("safe older request"), true);
  assert.equal(text.includes("safe older answer"), true);
  assert.equal(text.includes("sk-history-secret"), true);
  assert.equal(text.includes("raw prompt"), true);
  assert.equal(text.includes("raw provider response"), true);
  assert.equal(text.includes("raw tool output"), true);
  assert.equal(text.includes("hidden reasoning"), true);
  assert.equal(text.includes("internal loop"), true);
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
    redacted: false,
    diagnosticRef: "tool:search:1",
    rawRetention: "none",
    uiDisplay: {
      kind: "generic_tool_summary",
      action: "search",
      summary: "safe summary",
      items: ["result one"],
    },
  };
}
