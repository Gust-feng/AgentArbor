import assert from "node:assert/strict";
import test from "node:test";
import {
  modelCatalogDisplayNameFromId,
  normalizeModelCatalogDisplayName,
} from "./model-catalog-display-name.js";

test("model catalog display name uses maintained static parts", () => {
  assert.equal(modelCatalogDisplayNameFromId("gpt-5.5"), "GPT-5.5");
  assert.equal(modelCatalogDisplayNameFromId("gpt-3.5-turbo"), "GPT-3.5-Turbo");
  assert.equal(modelCatalogDisplayNameFromId("gpt-5.3-codex-spark"), "GPT-5.3-Codex-Spark");
  assert.equal(modelCatalogDisplayNameFromId("chatgpt-image-latest"), "ChatGPT-image-latest");
  assert.equal(modelCatalogDisplayNameFromId("deepseek-chat"), "DeepSeek-Chat");
  assert.equal(modelCatalogDisplayNameFromId("deepseek-v4-pro"), "DeepSeek-V4-Pro");
  assert.equal(modelCatalogDisplayNameFromId("deepseekv4pro"), "DeepSeekV4Pro");
  assert.equal(modelCatalogDisplayNameFromId("kimi-k2.6"), "Kimi-k2.6");
  assert.equal(modelCatalogDisplayNameFromId("glm-5.1"), "GLM-5.1");
  assert.equal(modelCatalogDisplayNameFromId("glm5.1"), "GLM5.1");
  assert.equal(modelCatalogDisplayNameFromId("gpt-5-mini"), "GPT-5-Mini");
});

test("model catalog display name keeps unknown ids unchanged", () => {
  assert.equal(modelCatalogDisplayNameFromId("MiniMax-M3"), "MiniMax-M3");
  assert.equal(modelCatalogDisplayNameFromId("MiniMax-M2.1-highspeed"), "MiniMax-M2.1-highspeed");
  assert.equal(modelCatalogDisplayNameFromId("plain-model"), "plain-model");
  assert.equal(modelCatalogDisplayNameFromId("provider-model"), "provider-model");
  assert.equal(modelCatalogDisplayNameFromId("text-embedding-ada-002"), "text-embedding-ada-002");
});

test("model catalog display name repairs cosmetic legacy generated names", () => {
  assert.equal(normalizeModelCatalogDisplayName("Mini Max M3", "MiniMax-M3"), "MiniMax-M3");
  assert.equal(
    normalizeModelCatalogDisplayName("Mini Max M2.1 highspeed", "MiniMax-M2.1-highspeed"),
    "MiniMax-M2.1-highspeed"
  );
  assert.equal(normalizeModelCatalogDisplayName("GPT 5.5", "gpt-5.5"), "GPT-5.5");
  assert.equal(normalizeModelCatalogDisplayName("Chat GPT-image-latest", "chatgpt-image-latest"), "ChatGPT-image-latest");
  assert.equal(normalizeModelCatalogDisplayName("DeepSeek V4 Pro", "deepseekv4pro"), "DeepSeekV4Pro");
  assert.equal(normalizeModelCatalogDisplayName("Provider Plain Model", "plain-model"), "Provider Plain Model");
});
