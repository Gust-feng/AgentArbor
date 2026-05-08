import assert from "node:assert/strict";
import test from "node:test";
import { runDesktopChatSession } from "./desktop-chat-session.js";

test("Desktop Chat Session answers ordinary questions without entering Work Session", async () => {
  const result = await runDesktopChatSession("你是什么模型？", { aiMode: "fake" });

  assert.equal(result.status, "answered");
  assert.equal(result.answer?.answer.includes("AgentArbor 桌面助手"), true);
  assert.equal(result.upgradeRequest, undefined);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});

test("Desktop Chat Session lets the model request Work Session upgrade for real tasks", async () => {
  const result = await runDesktopChatSession("分析当前仓库的问题并给我优化建议", { aiMode: "fake" });

  assert.equal(result.status, "upgrade_requested");
  assert.equal(result.answer, undefined);
  assert.equal(result.upgradeRequest?.goal.includes("分析当前仓库"), true);
  assert.equal(result.upgradeRequest?.reason.includes("升级为工作会话"), true);
  assert.deepEqual(result.eventTypes, ["goal.received", "model.requested", "model.completed"]);
  assert.equal(result.runtime.eventLog.types().includes("agent.delegation.planned"), false);
  assert.equal(result.runtime.eventLog.types().includes("artifact.produced"), false);
});
