import assert from "node:assert/strict";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("panel model options do not infer capabilities from model names", async () => {
  const modelOptions = await readPanelUiSource("model-options.ts");

  assert.equal(modelOptions.includes("export function modelOptionSupportsReasoningEffort"), true);
  assert.equal(modelOptions.includes("supportsCurrentModel"), true);
  assert.equal(modelOptions.includes("config?.capabilities?.modelCapabilities?.supportsReasoningEffort === true"), true);
  assert.equal(modelOptions.includes("config?.config?.profileId === parsed.profileId"), true);
  assert.equal(modelOptions.includes("config.config.model === parsed.modelId"), true);
  assert.equal(modelOptions.includes("modelLooksReasoningEffortCapable"), false);
  assert.equal(modelOptions.includes("deepseek-v4"), false);
  assert.equal(modelOptions.includes("gpt-5"), false);
  assert.equal(modelOptions.includes("o3"), false);
  assert.equal(modelOptions.includes("o4"), false);
});
