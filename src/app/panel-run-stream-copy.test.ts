import assert from "node:assert/strict";
import test from "node:test";
import type { ModelVisibleOutputProjection } from "../domain/intelligence/index.js";
import { chunkText, visibleOutputText } from "./panel-run-stream-copy.js";

test("panel stream copy preserves visible output whitespace", () => {
  assert.equal(
    visibleOutputText(visibleTextOutput("\n\n- 第一项\n- 第二项\n")),
    "\n\n- 第一项\n- 第二项\n"
  );
});

test("panel stream chunking preserves outer whitespace", () => {
  assert.deepEqual(chunkText("\n\n开始回答。", 90), ["\n\n开始回答。"]);
});

function visibleTextOutput(value: string): ModelVisibleOutputProjection {
  return {
    source: "text_output",
    contractId: "test.visible_text.v1",
    outputKind: "explanation",
    validationStatus: "passed",
    items: [
      {
        itemId: "text:1",
        fields: [
          {
            name: "text",
            value,
            truncated: false,
          },
        ],
      },
    ],
    truncated: false,
  };
}
