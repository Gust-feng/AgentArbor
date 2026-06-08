import assert from "node:assert/strict";
import test from "node:test";
import {
  basicConfirmationDecisionSummary,
  cleanConfirmationSummary,
  confirmationActionSummaryText,
  isGenericApprovalDecisionText,
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

test("confirmation copy removes generic waiting prompts", () => {
  assert.equal(cleanConfirmationSummary("等待你判断后继续。"), "");
  assert.equal(cleanConfirmationSummary("需要你补充材料后继续。"), "");
  assert.equal(cleanConfirmationSummary("需要你判断：删除文件：C:\\repo\\old.txt"), "删除文件：C:\\repo\\old.txt");
});

test("confirmation decision copy is shared and redacts guidance", () => {
  assert.equal(basicConfirmationDecisionSummary({ decision: "approve_once" }), "已继续。");
  assert.equal(basicConfirmationDecisionSummary({ decision: "deny" }), "已不执行。");
  assert.equal(
    basicConfirmationDecisionSummary({
      decision: "guidance",
      guidance: "继续，但不要删除文件",
    }),
    "继续，但不要删除文件"
  );
  assert.equal(
    basicConfirmationDecisionSummary({
      decision: "guidance",
      guidance: "继续，但不要暴露 token=sk-test-token-1234567890",
    }).includes("sk-test-token"),
    false
  );
});

test("generic approval copy is treated as low-value projection text", () => {
  assert.equal(cleanConfirmationSummary("已继续。"), "");
  assert.equal(cleanConfirmationSummary("用户反馈已收到，工作继续推进。"), "");
  assert.equal(isGenericApprovalDecisionText("继续处理。"), true);
  assert.equal(isGenericApprovalDecisionText("已不执行。"), false);
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
