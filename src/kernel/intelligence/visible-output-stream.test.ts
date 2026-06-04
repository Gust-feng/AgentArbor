import assert from "node:assert/strict";
import test from "node:test";
import { createVisibleOutputStreamProjector, visibleStructuredOutputText } from "./visible-output-stream.js";
import type { ModelOutputContract, ModelVisibleOutputFieldType } from "../../domain/intelligence/index.js";

test("visible output stream projects JSON string fields without raw braces", () => {
  const projector = createVisibleOutputStreamProjector(contract(["summary"]));

  assert.equal(projector.push("{\"summary\":\""), "");
  assert.equal(projector.push("Streamed"), "Streamed");
  assert.equal(projector.push(" response.\"}"), " response.");
});

test("visible output stream preserves string field whitespace", () => {
  const text = visibleStructuredOutputText(
    contract(["summary"]),
    "{\"summary\":\"\\n\\n- 第一项\\n- 第二项\\n\"}"
  );

  assert.equal(text, "\n\n- 第一项\n- 第二项\n");
});

test("visible output stream projects arrays in contract order", () => {
  const outputContract = contract(["title", "findings"], { findings: "string_array" });
  const text = visibleStructuredOutputText(
    outputContract,
    "{\"title\":\"Report\",\"findings\":[\"One\",\"Two\"],\"secret\":\"must not show\"}"
  );

  assert.equal(text, "Report\n\nOne; Two");
  assert.equal(text.includes("secret"), false);
});

test("visible output stream ignores field-looking text inside string values", () => {
  const outputContract = contract(["summary"]);
  const text = visibleStructuredOutputText(
    outputContract,
    "{\"note\":\"\\\"summary\\\":\\\"wrong\\\"\",\"summary\":\"right\"}"
  );

  assert.equal(text, "right");
});

test("visible output stream only reads top-level string array items", () => {
  const outputContract = contract(["findings"], { findings: "string_array" });
  const text = visibleStructuredOutputText(
    outputContract,
    "{\"findings\":[\"One\",{\"secret\":\"must not leak\",\"label\":\"nested\"},\"Two\"]}"
  );

  assert.equal(text, "One; Two");
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("nested"), false);
});

test("visible output stream decodes unicode escapes during partial JSON streaming", () => {
  const projector = createVisibleOutputStreamProjector(contract(["summary"]));

  assert.equal(projector.push("{\"summary\":\"\\u4f60"), "你");
  assert.equal(projector.push("\\u597d"), "好");
  assert.equal(projector.push("，\\ud83d\\ude0a\"}"), "，😊");
});

test("visible output stream waits for incomplete unicode escapes", () => {
  const projector = createVisibleOutputStreamProjector(contract(["summary"]));

  assert.equal(projector.push("{\"summary\":\"\\u4f"), "");
  assert.equal(projector.push("60"), "你");
});

test("visible output stream appends later visible fields without rewriting earlier text", () => {
  const projector = createVisibleOutputStreamProjector(contract(["title", "summary"]));

  assert.equal(projector.push("{\"title\":\"A\""), "A");
  assert.equal(projector.push(",\"summary\":\"B"), "\n\nB");
  assert.equal(projector.push("C\"}"), "C");
});

test("visible output stream filters sensitive contract fields", () => {
  const text = visibleStructuredOutputText(
    contract(["summary", "rawPrompt", "api_key"]),
    "{\"summary\":\"safe\",\"rawPrompt\":\"hidden\",\"api_key\":\"sk-hidden\"}"
  );

  assert.equal(text, "safe");
});

function contract(
  fields: readonly string[],
  fieldTypes?: Readonly<Record<string, ModelVisibleOutputFieldType>>
): ModelOutputContract {
  return {
    contractId: "test.visible_stream.v1",
    outputKind: "explanation",
    format: "json_object",
    requiredFields: [...fields],
    requiredStringFields: [...fields],
    visibleOutput: {
      fields,
      fieldTypes,
      maxFieldLength: 220,
    },
  };
}
