import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentTurnPolicyFromDefinition,
  runAgentDefinitionRef,
} from "./agent-definition-runtime.js";
import { DESKTOP_ROOT_AGENT } from "./agent-prompts/desktop-root-agent.js";

test("AgentDefinition runtime creates ordinary turn policy without round limits", () => {
  const allowedTools = ["read_file", "web_search"] as const;
  const policy = createAgentTurnPolicyFromDefinition({
    agentDefinition: DESKTOP_ROOT_AGENT,
    traceId: "trace-test",
    goalId: "goal-test",
    allowedTools,
  });

  assert.equal(policy.allowModel, true);
  assert.equal(policy.fallback, "disabled");
  assert.equal(policy.callerAgentId, DESKTOP_ROOT_AGENT.agentId);
  assert.equal(policy.purpose, DESKTOP_ROOT_AGENT.turnPolicy.purpose);
  assert.equal(policy.sensitivity, DESKTOP_ROOT_AGENT.turnPolicy.sensitivity);
  assert.deepEqual(policy.allowedTools, allowedTools);
  assert.equal(policy.budget.maxOutputTokens, DESKTOP_ROOT_AGENT.turnPolicy.defaultMaxOutputTokens);
  assert.equal(Object.hasOwn(policy, "maxModelRounds"), false);
  assert.equal(Object.hasOwn(policy, "maxToolRounds"), false);
});

test("AgentDefinition runtime prefers model capability output budget over default prompt policy", () => {
  const policy = createAgentTurnPolicyFromDefinition({
    agentDefinition: DESKTOP_ROOT_AGENT,
    traceId: "trace-capability-budget",
    goalId: "goal-capability-budget",
    allowedTools: [],
    modelCapabilities: {
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_000,
      supportsToolCalling: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreaming: true,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      preferredApiStyle: "responses",
      stability: "stable",
    },
  });

  assert.equal(policy.budget.maxOutputTokens, 16_000);
  assert.notEqual(policy.budget.maxOutputTokens, DESKTOP_ROOT_AGENT.turnPolicy.defaultMaxOutputTokens);
  assert.equal(Object.hasOwn(policy.budget, "maxLatencyMs"), false);
});

test("AgentDefinition safe run ref excludes prompt bodies and turn policy internals", () => {
  const ref = runAgentDefinitionRef(DESKTOP_ROOT_AGENT);
  const serialized = JSON.stringify(ref);

  assert.equal(serialized.includes(DESKTOP_ROOT_AGENT.prompt.systemPrompt), false);
  assert.equal(serialized.includes("systemPrompt"), false);
  assert.equal(serialized.includes("turnPolicy"), false);
  assert.equal(serialized.includes("defaultMaxOutputTokens"), false);
  assert.equal(serialized.includes("maxModelRounds"), false);
  assert.equal(serialized.includes("maxToolRounds"), false);
});
