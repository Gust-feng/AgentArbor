import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRequest } from "../../domain/intelligence/index.js";
import { InMemoryEventLog } from "../../kernel/events/in-memory-event-log.js";
import { NativeIntelligenceChannel } from "../../kernel/intelligence/channel.js";
import { InMemoryMessageBus } from "../../kernel/messages/in-memory-message-bus.js";
import { FakeModelProvider } from "./fake-model-provider.js";

test("FakeModelProvider completed path emits model.requested then model.completed", async () => {
  const { channel, eventLog } = createFakeProviderChannel({
    output: { summary: "Candidate advice from fake provider." },
  });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal(response.usage, undefined);
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed"]);
});

test("FakeModelProvider failed path emits model.requested then model.failed", async () => {
  const { channel, eventLog } = createFakeProviderChannel({ fail: true });

  const response = await channel.request(createValidModelRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.failure?.kind, "provider_response");
  assert.deepEqual(eventLog.types(), ["model.requested", "model.failed"]);
});

test("FakeModelProvider can emit a deterministic tool call fixture", async () => {
  const { channel, eventLog } = createFakeProviderChannel({
    toolCalls: [{ callId: "call-search", toolName: "web_search", input: { query: "AgentArbor tools" } }],
  });

  const response = await channel.request(
    createValidModelRequest({
      tools: [
        {
          name: "web_search",
          description: "Search the web.",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      ],
      toolChoice: "auto",
    })
  );

  assert.equal(response.status, "completed");
  assert.equal(response.finishReason, "tool_call");
  assert.deepEqual(response.toolCalls, [
    { callId: "call-search", toolName: "web_search", input: { query: "AgentArbor tools" } },
  ]);
  assert.deepEqual(eventLog.types(), ["model.requested", "model.completed"]);
});

test("FakeModelProvider default output satisfies underground intent profile contract", async () => {
  const { channel } = createFakeProviderChannel();

  const response = await channel.request(
    createValidModelRequest({
      purpose: "intent_profile",
      sanitizedMessages: [{ role: "user", content: "Raw goal: Build a governed research agent." }],
      outputContract: {
        contractId: "underground.intent_profile.v1",
        outputKind: "explanation",
        format: "json_object",
        requiredFields: [
          "goalStatement",
          "keyConcepts",
          "domainConcepts",
          "nonGoals",
          "acceptanceCriteria",
          "assumptions",
          "riskHints",
          "constraintHints",
          "unknowns",
          "decisionSummary",
          "uncertainty",
          "confidence",
        ],
        requiredStringFields: ["goalStatement", "decisionSummary", "uncertainty"],
      },
    })
  );

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.match((response.structuredOutput as { goalStatement: string }).goalStatement, /governed research agent/);
});

test("FakeModelProvider default output satisfies underground growth governor contract", async () => {
  const { channel } = createFakeProviderChannel();

  const response = await channel.request(
    createValidModelRequest({
      purpose: "growth_governance",
      sanitizedMessages: [
        {
          role: "user",
          content: [
            "Raw goal: Build a governed research agent.",
            "Available rootlet kinds: option, risk, evidence",
          ].join("\n"),
        },
      ],
      outputContract: {
        contractId: "underground.growth_governor.v1",
        outputKind: "explanation",
        format: "json_object",
        requiredFields: [
          "rootletKinds",
          "budget",
          "dispatchDecision",
          "decisionSummary",
          "uncertainty",
          "confidence",
        ],
        requiredStringFields: ["dispatchDecision", "decisionSummary", "uncertainty"],
      },
    })
  );

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.deepEqual((response.structuredOutput as { rootletKinds: string[] }).rootletKinds, [
    "option",
    "risk",
    "evidence",
  ]);
});

test("FakeModelProvider default output satisfies underground convergence judgment contract", async () => {
  const { channel } = createFakeProviderChannel();

  const response = await channel.request(
    createValidModelRequest({
      purpose: "convergence_judgment",
      sanitizedMessages: [
        {
          role: "user",
          content: [
            "Raw goal: Build a governed research agent.",
            "Candidates:",
            "- [option] candidateId=candidate-option-1 outputId=rootlet-output-option-1",
            "  summary: governed research agent option",
          ].join("\n"),
        },
      ],
      outputContract: {
        contractId: "underground.convergence_judgment.v1",
        outputKind: "explanation",
        format: "json_object",
        requiredFields: [
          "candidateDecisions",
          "nextAction",
          "overallDirectionSummary",
          "decisionSummary",
          "uncertainty",
          "confidence",
        ],
        requiredStringFields: ["nextAction", "overallDirectionSummary", "decisionSummary", "uncertainty"],
      },
    })
  );

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal((response.structuredOutput as { nextAction: string }).nextAction, "approve_handoff");
  assert.deepEqual(
    (response.structuredOutput as { candidateDecisions: { candidateId: string; status: string }[] }).candidateDecisions,
    [{ candidateId: "candidate-option-1", status: "accepted", reason: "Candidate candidate-option-1 is the retained option direction for Build a governed research agent.", evidenceRefs: ["rootlet-output-option-1"], contentDifference: "Fake Convergence Judge differentiated option candidate candidate-option-1.", whyPreferred: "Fake Convergence Judge selected candidate-option-1 as the retained option.", conflictWith: [] }]
  );
});

test("FakeModelProvider default output satisfies underground handoff narrative contract", async () => {
  const { channel } = createFakeProviderChannel();

  const response = await channel.request(
    createValidModelRequest({
      purpose: "handoff_narrative",
      sanitizedMessages: [
        {
          role: "user",
          content: [
            "Raw goal: Build a governed research agent.",
            "Convergence outcome: approved",
            "Handoff candidate refs:",
            "- candidateId=candidate-option-1",
            "  status=accepted",
            "  summary=governed research agent option",
          ].join("\n"),
        },
      ],
      outputContract: {
        contractId: "underground.handoff_narrative.v1",
        outputKind: "draft",
        format: "json_object",
        requiredFields: [
          "status",
          "clarifiedGoal",
          "optionNarratives",
          "nonGoals",
          "assumptions",
          "missingInformation",
          "risks",
          "evidenceBoundary",
          "growthEntry",
          "decisionSummary",
          "uncertainty",
          "confidence",
        ],
        requiredStringFields: ["status", "clarifiedGoal", "evidenceBoundary", "decisionSummary", "uncertainty"],
      },
    })
  );

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal((response.structuredOutput as { status: string }).status, "approved");
  assert.deepEqual(
    (response.structuredOutput as { optionNarratives: { candidateId: string }[] }).optionNarratives.map(
      (narrative) => narrative.candidateId
    ),
    ["candidate-option-1"]
  );
});

test("FakeModelProvider default output satisfies work session direct answer text contract", async () => {
  const { channel } = createFakeProviderChannel();

  const response = await channel.request(
    createValidModelRequest({
      purpose: "work_session_direct_answer",
      sanitizedMessages: [
        {
          role: "user",
          content: "Raw user question: 你是什么模型？",
        },
      ],
      outputContract: {
        contractId: "work_session.direct_answer.v1",
        outputKind: "explanation",
        format: "text",
        minTextLength: 1,
        maxTextLength: 128_000,
        visibleOutput: {
          fields: ["text"],
          maxFieldLength: 128_000,
        },
      },
    })
  );

  assert.equal(response.status, "completed");
  assert.equal(response.validation.status, "passed");
  assert.equal(response.structuredOutput, undefined);
  assert.equal(response.textOutput?.includes("AgentArbor 桌面助手"), true);
});

test("FakeModelProvider desktop agent answers directly and can request authorized tools", async () => {
  const { channel } = createFakeProviderChannel();

  const answer = await channel.request(
    createValidModelRequest({
      purpose: "desktop_agent",
      sanitizedMessages: [{ role: "user", content: "User message: 你是什么模型？" }],
      outputContract: {
        contractId: "desktop.agent_response.v1",
        outputKind: "explanation",
        format: "text",
        minTextLength: 1,
        maxTextLength: 128_000,
      },
      tools: [],
      toolChoice: "auto",
    })
  );
  const ordinaryComplex = await channel.request(
    createValidModelRequest({
      purpose: "desktop_agent",
      sanitizedMessages: [{ role: "user", content: "User message: 分析当前仓库的问题并给出优化建议" }],
      outputContract: {
        contractId: "desktop.agent_response.v1",
        outputKind: "explanation",
        format: "text",
        minTextLength: 1,
        maxTextLength: 128_000,
      },
      tools: [
        {
          name: "research_search",
          description: "Search authorized sources.",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        },
      ],
      toolChoice: "auto",
    })
  );
  const ordinaryWithoutTools = await channel.request(
    createValidModelRequest({
      purpose: "desktop_agent",
      sanitizedMessages: [{ role: "user", content: "User message: 分析当前仓库的问题并给出优化建议" }],
      outputContract: {
        contractId: "desktop.agent_response.v1",
        outputKind: "explanation",
        format: "text",
        minTextLength: 1,
        maxTextLength: 128_000,
      },
      tools: [],
      toolChoice: "none",
    })
  );

  assert.equal(answer.status, "completed");
  assert.equal(answer.textOutput?.includes("AgentArbor 桌面助手"), true);
  assert.equal(ordinaryComplex.status, "completed");
  assert.equal(ordinaryComplex.finishReason, "tool_call");
  assert.equal(ordinaryComplex.toolCalls?.[0]?.toolName, "research_search");
  assert.equal(ordinaryWithoutTools.status, "completed");
  assert.equal(ordinaryWithoutTools.finishReason, "stop");
  assert.equal(ordinaryWithoutTools.textOutput?.includes("桌面任务处理"), true);
  assert.equal(ordinaryWithoutTools.textOutput?.includes("深度模式"), false);
});

test("FakeModelProvider output deltas carry request purpose", async () => {
  const deltas: Array<{ purpose: string | undefined; delta: string }> = [];
  const { channel } = createFakeProviderChannel({
    textOutput: "Visible desktop answer.",
    onOutputDelta: (delta) => {
      deltas.push({ purpose: delta.purpose, delta: delta.delta });
    },
  });

  const response = await channel.request(
    createValidModelRequest({
      purpose: "desktop_agent",
      outputContract: {
        contractId: "desktop.agent_response.v1",
        outputKind: "explanation",
        format: "text",
        minTextLength: 1,
        maxTextLength: 128_000,
      },
    })
  );

  assert.equal(response.status, "completed");
  assert.deepEqual(deltas, [{ purpose: "desktop_agent", delta: "Visible desktop answer." }]);
});

function createFakeProviderChannel(options: ConstructorParameters<typeof FakeModelProvider>[0] = {}) {
  const eventLog = new InMemoryEventLog();
  const bus = new InMemoryMessageBus(eventLog);
  const provider = new FakeModelProvider(options);
  const channel = new NativeIntelligenceChannel({ provider, bus });
  return { channel, eventLog };
}

function createValidModelRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    requestId: "model-request-test",
    traceId: "trace-test",
    callerRef: { kind: "goal", id: "goal-test" },
    purpose: "rootlet_candidate",
    inputRefs: [{ kind: "goal", id: "goal-test" }],
    sanitizedMessages: [{ role: "user", content: "Build a helper.", ref: "goal-test" }],
    outputContract: {
      contractId: "test.candidate.v1",
      outputKind: "candidate",
      format: "json_object",
      requiredFields: ["summary"],
      requiredStringFields: ["summary"],
    },
    constraintRefs: [],
    budget: { maxOutputTokens: 128 },
    sensitivity: "internal",
    requestedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}
