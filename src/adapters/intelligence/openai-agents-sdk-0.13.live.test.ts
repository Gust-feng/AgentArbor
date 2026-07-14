import assert from "node:assert/strict";
import test from "node:test";
import { Agent, OpenAIProvider, Runner, setTracingDisabled } from "@openai/agents";

const LIVE_MODE = process.env.AGENTARBOR_AGENTS_SDK_LIVE?.trim().toLowerCase();
const OFFICIAL_OPENAI_BASE_URL = "https://api.openai.com/v1";
const LIVE_REQUEST_TIMEOUT_MS = 90_000;
const LIVE_TEST_TIMEOUT_MS = 100_000;

// SDK 0.13.3 still creates an outer workflow trace when only Runner.tracingDisabled is set.
// Keep the live probe isolated from hosted tracing with the SDK-wide guard as well.
setTracingDisabled(true);

test("OpenAI Agents SDK 0.13.3 live mode is either responses or chat", { timeout: 5_000 }, () => {
  if (LIVE_MODE === undefined || LIVE_MODE.length === 0) {
    return;
  }
  assert.equal(
    LIVE_MODE === "responses" || LIVE_MODE === "chat",
    true,
    "AGENTARBOR_AGENTS_SDK_LIVE must be responses or chat.",
  );
});

test("OpenAI Agents SDK 0.13.3 official Responses live probe", {
  skip: LIVE_MODE !== "responses",
  timeout: LIVE_TEST_TIMEOUT_MS,
}, async () => {
  const apiKey = requiredEnvironment("AGENTARBOR_MODEL_API_KEY", "OPENAI_API_KEY");
  const model = requiredEnvironment("AGENTARBOR_MODEL_NAME");
  const configuredBaseUrl = process.env.AGENTARBOR_MODEL_BASE_URL?.trim() || OFFICIAL_OPENAI_BASE_URL;
  assert.equal(
    trimTrailingSlashes(configuredBaseUrl),
    OFFICIAL_OPENAI_BASE_URL,
    "The official Responses live probe must target https://api.openai.com/v1.",
  );

  const provider = new OpenAIProvider({
    apiKey,
    baseURL: OFFICIAL_OPENAI_BASE_URL,
    useResponses: true,
    strictFeatureValidation: true,
    cacheResponsesWebSocketModels: false,
  });
  const runner = new Runner({
    modelProvider: provider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });
  const agent = new Agent({
    name: "AgentsSdkOfficialResponsesLiveProbe",
    instructions: "Reply with one short sentence confirming the request was received.",
    model,
  });

  try {
    const result = await runner.run(agent, "Confirm this official Responses API probe.", {
      maxTurns: null,
      signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS),
    });
    const finalOutput = result.finalOutput;
    assert.equal(typeof finalOutput, "string");
    assert.notEqual(finalOutput?.trim(), "");
    assert.equal(typeof result.lastResponseId, "string");
    assert.notEqual(result.lastResponseId, "");
  } finally {
    await provider.close();
  }
});

test("OpenAI Agents SDK 0.13.3 compatible Chat live probe", {
  skip: LIVE_MODE !== "chat",
  timeout: LIVE_TEST_TIMEOUT_MS,
}, async () => {
  const apiKey = requiredEnvironment("AGENTARBOR_MODEL_API_KEY", "OPENAI_API_KEY");
  const model = requiredEnvironment("AGENTARBOR_MODEL_NAME");
  const baseUrl = requiredEnvironment("AGENTARBOR_MODEL_BASE_URL");
  const provider = new OpenAIProvider({
    apiKey,
    baseURL: baseUrl,
    useResponses: false,
    strictFeatureValidation: true,
    cacheResponsesWebSocketModels: false,
  });
  const runner = new Runner({
    modelProvider: provider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });
  const agent = new Agent({
    name: "AgentsSdkCompatibleChatLiveProbe",
    instructions: "Reply with one short sentence confirming the request was received.",
    model,
  });

  try {
    const result = await runner.run(agent, "Confirm this compatible Chat API probe.", {
      maxTurns: null,
      signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS),
    });
    const finalOutput = result.finalOutput;
    assert.equal(typeof finalOutput, "string");
    assert.notEqual(finalOutput?.trim(), "");
  } finally {
    await provider.close();
  }
});

function requiredEnvironment(...names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  throw new Error(`Live probe requires ${names.join(" or ")}.`);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}
