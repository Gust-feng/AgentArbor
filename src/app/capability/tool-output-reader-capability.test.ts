import assert from "node:assert/strict";
import test from "node:test";
import { inheritToolOutputReader } from "./tool-output-reader-capability.js";

test("inheritToolOutputReader cannot bypass frozen parent authority or executable availability", () => {
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read", "read_output"],
      parentAllowedTools: ["read"],
      readerExecutable: true,
    }),
    ["read"],
  );
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read", "read_output"],
      parentAllowedTools: ["read", "read_output"],
      readerExecutable: false,
    }),
    ["read"],
  );
});

test("inheritToolOutputReader adds one transport companion only when both gates pass", () => {
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read", "read_output", "read"],
      parentAllowedTools: ["read", "read_output"],
      readerExecutable: true,
    }),
    ["read", "read_output"],
  );
});
