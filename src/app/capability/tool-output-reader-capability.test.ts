import assert from "node:assert/strict";
import test from "node:test";
import { inheritToolOutputReader } from "./tool-output-reader-capability.js";

test("inheritToolOutputReader cannot bypass frozen parent authority or executable availability", () => {
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read_file", "read_tool_output"],
      parentAllowedTools: ["read_file"],
      readerExecutable: true,
    }),
    ["read_file"],
  );
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read_file", "read_tool_output"],
      parentAllowedTools: ["read_file", "read_tool_output"],
      readerExecutable: false,
    }),
    ["read_file"],
  );
});

test("inheritToolOutputReader adds one transport companion only when both gates pass", () => {
  assert.deepEqual(
    inheritToolOutputReader({
      businessAllowedTools: ["read_file", "read_tool_output", "read_file"],
      parentAllowedTools: ["read_file", "read_tool_output"],
      readerExecutable: true,
    }),
    ["read_file", "read_tool_output"],
  );
});
