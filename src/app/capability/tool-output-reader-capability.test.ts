import assert from "node:assert/strict";
import test from "node:test";
import { inheritToolOutputReader } from "./tool-output-reader-capability.js";

test("inheritToolOutputReader cannot bypass frozen parent authority or executable availability", () => {
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read", "ReadOutput"],
      parentAllowedTools: ["read"],
      readerExecutable: true,
    }),
    ["read"],
  );
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read", "ReadOutput"],
      parentAllowedTools: ["read", "ReadOutput"],
      readerExecutable: false,
    }),
    ["read"],
  );
});

test("inheritToolOutputReader adds one transport companion only when both gates pass", () => {
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read", "ReadOutput", "read"],
      parentAllowedTools: ["read", "ReadOutput"],
      readerExecutable: true,
    }),
    ["read", "ReadOutput"],
  );
});
