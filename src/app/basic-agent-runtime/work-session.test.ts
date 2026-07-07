import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopWorkSessionReadModel } from "./work-session.js";
import { createDesktopWorkViewReadModel } from "./work-view.js";

test("legacy work-session read model module only re-exports the work-view implementation", () => {
  assert.equal(createDesktopWorkSessionReadModel, createDesktopWorkViewReadModel);
});
