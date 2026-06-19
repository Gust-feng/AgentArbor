import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchOpenAICompatibleModelCatalog,
  type ModelCatalogFetchLike,
} from "./openai-compatible-model-catalog.js";

test("OpenAI-compatible model catalog fetches sanitized models from provider /models endpoint", async () => {
  const calls: Array<{ url: string; authorization?: string; method: string }> = [];
  const fetch: ModelCatalogFetchLike = async (url, init) => {
    calls.push({
      url,
      authorization: init.headers.authorization,
      method: init.method,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "z-model", owned_by: "provider", created: 1_700_000_000 },
          { id: "a-model", owned_by: "provider" },
          { owned_by: "ignored" },
        ],
      }),
    };
  };

  const catalog = await fetchOpenAICompatibleModelCatalog({
    profile: {
      profileId: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/",
    },
    apiKey: "sk-catalog-secret",
    fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.deepseek.com/models");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.authorization, "Bearer sk-catalog-secret");
  assert.deepEqual(catalog.models.map((model) => model.id), ["a-model", "z-model"]);
  assert.equal(catalog.models[1]?.createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(JSON.stringify(catalog).includes("sk-catalog-secret"), false);
});

test("OpenAI-compatible model catalog derives display names from maintained model id rules", async () => {
  const fetch: ModelCatalogFetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: "plain-model", display_name: "Provider Plain Model" },
        { id: "chatgpt-image-latest" },
        { id: "gpt-5.5" },
        { id: "gpt-5.3-codex-spark" },
        { id: "deepseek-v4-pro" },
      ],
    }),
  });

  const catalog = await fetchOpenAICompatibleModelCatalog({
    profile: {
      profileId: "custom",
      label: "Custom",
      baseUrl: "https://api.example.com/v1",
    },
    apiKey: "sk-catalog-secret",
    fetch,
  });

  assert.deepEqual(catalog.models.map((model) => [model.id, model.displayName]), [
    ["chatgpt-image-latest", "ChatGPT-image-latest"],
    ["deepseek-v4-pro", "DeepSeek-V4-Pro"],
    ["gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark"],
    ["gpt-5.5", "GPT-5.5"],
    ["plain-model", "plain-model"],
  ]);
});

test("OpenAI-compatible model catalog normalizes bare OpenAI base URL to /v1/models", async () => {
  const urls: string[] = [];
  const fetch: ModelCatalogFetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gpt-test" }] }),
    };
  };

  await fetchOpenAICompatibleModelCatalog({
    profile: {
      profileId: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/",
    },
    apiKey: "sk-catalog-secret",
    fetch,
  });

  assert.equal(urls[0], "https://api.openai.com/v1/models");
});
