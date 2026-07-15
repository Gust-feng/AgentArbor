import assert from "node:assert/strict";
import test from "node:test";
import {
  modelRequestedSummary,
  restoredModelRequestedSummary,
  visibleModelProgressSummary,
} from "./panel-model-progress-copy.js";

test("model progress copy keeps real summaries and drops template placeholders", () => {
  assert.equal(modelRequestedSummary({ purpose: "desktop_agent" }), undefined);
  assert.equal(modelRequestedSummary({ summary: " 正在检查授权文件 " }), "正在检查授权文件");
  assert.equal(modelRequestedSummary({ summary: "正在判断下一步。" }), undefined);
  assert.equal(restoredModelRequestedSummary("正在判断下一步"), undefined);
  assert.equal(visibleModelProgressSummary("等待模型输出。"), undefined);
});
