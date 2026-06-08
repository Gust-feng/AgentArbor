import assert from "node:assert/strict";
import test from "node:test";
import {
  basicConfirmationDecisionSummary,
  cleanConfirmationSummary,
  confirmationActionSummaryText,
} from "./confirmation-copy.js";

test("confirmation copy keeps concrete action text without tool internals", () => {
  assert.equal(
    cleanConfirmationSummary("需要确认：删除文件：C:\\repo\\old.txt。 tool:call-delete"),
    "删除文件：C:\\repo\\old.txt。"
  );
  assert.equal(
    cleanConfirmationSummary("删除文件：C:\\repo\\old.txt"),
    "删除文件：C:\\repo\\old.txt"
  );
  assert.equal(
    cleanConfirmationSummary("Approval required. 执行 Shell：pnpm test"),
    "执行 Shell：pnpm test"
  );
});

test("confirmation decision copy is shared and redacts guidance", () => {
  assert.equal(basicConfirmationDecisionSummary({ decision: "approve_once" }), "已批准本次操作。");
  assert.equal(basicConfirmationDecisionSummary({ decision: "deny" }), "已拒绝本次操作。");
  assert.equal(
    basicConfirmationDecisionSummary({
      decision: "guidance",
      guidance: "继续，但不要暴露 token=sk-test-token-1234567890",
    }).includes("sk-test-token"),
    false
  );
});

test("confirmation action summary prefers concrete action over explanatory consequence", () => {
  assert.equal(
    confirmationActionSummaryText({
      question: "是否删除文件？",
      consequence: "会移除工作区文件。",
    }),
    "是否删除文件？"
  );
  assert.equal(
    confirmationActionSummaryText({
      question: "是否继续？",
      consequence: "会运行 pnpm test。",
    }),
    "会运行 pnpm test。"
  );
  assert.equal(
    confirmationActionSummaryText({
      question: "需要确认：编辑 README.md",
      consequence: "会写入工作区文件。",
    }),
    "编辑 README.md"
  );
});
