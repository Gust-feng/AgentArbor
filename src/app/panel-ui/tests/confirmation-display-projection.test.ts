import assert from "node:assert/strict";
import test from "node:test";
import { projectConfirmationDisplay } from "../src/confirmation-display-projection.js";

test("confirmation display projection keeps only concrete action copy", () => {
  const view = projectConfirmationDisplay({
    title: "需要你判断",
    actionSummary: "运行命令：pnpm test",
    riskLevel: "high",
  });

  assert.equal(view.title, "运行命令：pnpm test");
  assert.equal(view.actionPreview, "pnpm test");
  assert.equal(view.showActionPreview, true);
  assert.equal(view.riskLevel, "high");
});

test("confirmation display projection keeps shell command preview concrete without duplicating the title", () => {
  const view = projectConfirmationDisplay({
    title: "Shell 命令",
    actionSummary: "Shell 命令：python -c print('ok')",
    riskLevel: "medium",
  });

  assert.equal(view.title, "Shell 命令");
  assert.equal(view.actionPreview, "python -c print('ok')");
  assert.equal(view.showActionPreview, true);
});

test("confirmation display projection filters internal resources and resume loss", () => {
  const view = projectConfirmationDisplay({
    title: "删除文件",
    actionSummary: "删除文件：old.txt",
    affectedResources: [
      "old.txt",
      "new.txt",
      "README.md",
      "package.json",
      "src/app/index.ts",
      "docs/guide.md",
      "hidden-by-limit.txt",
      "tool:call-delete",
      "model_call:model-1",
      "call_delete_123456789",
    ],
    riskLevel: "unknown",
    resumeAvailability: "lost_after_restart",
  });

  assert.deepEqual(view.resources, [
    "old.txt",
    "new.txt",
    "README.md",
    "package.json",
    "src/app/index.ts",
    "docs/guide.md",
  ]);
  assert.equal(view.riskLevel, "medium");
  assert.equal(view.resumeLost, true);
  assert.equal(view.resumeLostSummary, "这次操作无法原地继续。发送新消息即可基于当前上下文继续。");
});