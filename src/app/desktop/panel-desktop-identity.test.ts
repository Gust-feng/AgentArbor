import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTARBOR_APP_ID,
  AGENTARBOR_DEV_APP_ID,
  desktopAppUserModelId,
} from "./panel-desktop-identity.js";

test("packaged desktop uses the stable Windows app identity", () => {
  assert.equal(desktopAppUserModelId(true), AGENTARBOR_APP_ID);
});

test("unpackaged desktop uses an isolated Windows app identity", () => {
  assert.equal(desktopAppUserModelId(false), AGENTARBOR_DEV_APP_ID);
  assert.notEqual(AGENTARBOR_DEV_APP_ID, AGENTARBOR_APP_ID);
});
