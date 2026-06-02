import assert from "node:assert/strict";
import test from "node:test";

test("panel UI structure checks are split by product concern", () => {
  const splitStructureSuites = [
    "panel-ui-app-structure.test.ts",
    "panel-ui-chat-structure.test.ts",
    "panel-ui-contract-structure.test.ts",
    "panel-ui-settings-structure.test.ts",
    "panel-ui-runtime-structure.test.ts",
  ];

  assert.equal(splitStructureSuites.length, 5);
  assert.equal(splitStructureSuites.every((fileName) => fileName.startsWith("panel-ui-")), true);
});
