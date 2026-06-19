import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readPanelUiSource } from "./panel-structure-test-utils.js";

test("configured builtin providers do not repopulate cleared models from preset defaults", async () => {
  const projection = await readPanelUiSource(path.join("components", "model-settings-projection.ts"));

  assert.equal(projection.includes('profile === undefined ? preset.defaultModel ?? "" : profile.model ?? ""'), true);
  assert.equal(projection.includes("profile?.model ?? preset.defaultModel"), false);
});
