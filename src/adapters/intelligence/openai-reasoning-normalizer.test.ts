import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeOpenAICompatibleChatMessage,
  OpenAIReasoningStreamNormalizer,
  reasoningTextFromRecord,
} from "./openai-reasoning-normalizer.js";

test("compatible reasoning aliases normalize without provider-specific consumers", () => {
  assert.equal(reasoningTextFromRecord({ reasoning_content: "DeepSeek / Kimi / GLM" }), "DeepSeek / Kimi / GLM");
  assert.equal(reasoningTextFromRecord({ reasoning: "SDK-compatible alias" }), "SDK-compatible alias");
  assert.equal(reasoningTextFromRecord({
    reasoning_details: [{ text: "MiniMax first" }, { text: "MiniMax second" }],
  }), "MiniMax first\n\nMiniMax second");
  assert.equal(reasoningTextFromRecord({
    reasoning: "Same MiniMax reasoning.",
    reasoning_details: [{ text: "Same MiniMax reasoning." }],
  }), "Same MiniMax reasoning.");
});

test("compatible message decoding separates explicit and tagged reasoning from the answer", () => {
  const decoded = decodeOpenAICompatibleChatMessage({
    reasoning_details: [{ text: "Inspect the constraints." }],
    content: "<think>Compare the candidates.</think>Choose the stable option.",
  });

  assert.equal(decoded.textContent, "Choose the stable option.");
  assert.equal(decoded.reasoningContent, "Inspect the constraints.\n\nCompare the candidates.");
  assert.equal(decoded.reasoningSource, "openai_chat_reasoning_content");
});

test("Chat stream normalization handles reasoning fields and think tags across chunks", () => {
  const normalizer = new OpenAIReasoningStreamNormalizer("openai_compatible_chat_completions");
  const observations = [
    normalizer.push({ choices: [{ delta: { reasoning_content: "First inspect." }, finish_reason: null }] }),
    normalizer.push({ choices: [{ delta: { content: "<thi" }, finish_reason: null }] }),
    normalizer.push({ choices: [{ delta: { content: "nk>Then compare.</think>Final" }, finish_reason: null }] }),
    normalizer.push({ choices: [{ delta: { content: " answer." }, finish_reason: "stop" }] }),
  ];

  assert.equal(observations.map((item) => item.reasoningDelta).join(""), "First inspect.Then compare.");
  assert.equal(observations.map((item) => item.textDelta).join(""), "Final answer.");
});

test("Chat stream normalization preserves reasoning delta boundary whitespace", () => {
  const normalizer = new OpenAIReasoningStreamNormalizer("openai_compatible_chat_completions");
  const observations = [
    normalizer.push({ choices: [{ delta: { reasoning_content: "The" }, finish_reason: null }] }),
    normalizer.push({ choices: [{ delta: { reasoning_content: " user" }, finish_reason: null }] }),
  ];

  assert.equal(observations.map((item) => item.reasoningDelta).join(""), "The user");
});

test("Responses stream normalization exposes summary and answer as separate facts", () => {
  const normalizer = new OpenAIReasoningStreamNormalizer("openai_responses");
  assert.deepEqual(normalizer.push({
    type: "response.reasoning_summary_text.delta",
    delta: "Check the evidence.",
  }), { reasoningDelta: "Check the evidence.", textDelta: "" });
  assert.deepEqual(normalizer.push({
    type: "response.output_text.delta",
    delta: "The evidence is sufficient.",
  }), { reasoningDelta: "", textDelta: "The evidence is sufficient." });
});
