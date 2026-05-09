import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider, ModelRequest, ModelResponse } from "../domain/intelligence/index.js";
import { NativeIntelligenceChannel } from "../kernel/intelligence/channel.js";
import { createMinimalRuntime } from "./runtime.js";
import { createTaskSoilFromDesktopInput } from "./task-soil-workspace.js";
import { decideDesktopIntentWithModel } from "./desktop-intent-router.js";

test("legacy desktop intent gate asks the model before keeping ordinary questions in direct chat", async () => {
  const { decision, eventTypes } = await decideWithFakeModel("你是什么模型？");

  assert.equal(decision.route, "chat_direct");
  assert.equal(decision.source, "ai");
  assert.equal(decision.reason.length > 0, true);
  assert.deepEqual(eventTypes, ["model.requested", "model.completed"]);
});

test("legacy desktop intent gate lets the model route project analysis into a work session", async () => {
  const { decision } = await decideWithFakeModel("分析当前仓库的问题并给我优化建议");

  assert.equal(decision.route, "task_work_session");
  assert.equal(decision.source, "ai");
  assert.equal(decision.modelCallRefs.length, 2);
});

test("legacy desktop intent gate lets the model route lightweight context requests into tool chat", async () => {
  const { decision } = await decideWithFakeModel("帮我读这个网页并总结三点重点");

  assert.equal(decision.route, "chat_plus_tools");
  assert.equal(decision.source, "ai");
});

async function decideWithFakeModel(goal: string) {
  const runtime = createMinimalRuntime();
  const traceId = "trace-intent-gate-test";
  const goalId = "goal-intent-gate-test";
  const taskSoil = createTaskSoilFromDesktopInput({
    goal,
    goalId,
    traceId,
    aiMode: "fake",
    constraints: runtime.constraints,
    soilStore: runtime.soilStore,
    createdAt: new Date(0).toISOString(),
  });
  const channel = new NativeIntelligenceChannel({
    provider: createDesktopIntentGateStubProvider(routeForGoal(goal)),
    bus: runtime.bus,
  });

  const decision = await decideDesktopIntentWithModel({
    goal,
    taskSoil,
    traceId,
    goalId,
    intelligenceChannel: channel,
  });
  return { decision, eventTypes: runtime.eventLog.types() };
}

function createDesktopIntentGateStubProvider(route: "chat_direct" | "chat_plus_tools" | "task_work_session"): ModelProvider {
  return {
    providerId: "desktop-intent-gate-stub-provider",
    providerKind: "fake",
    protocolKind: "openai_compatible_chat_completions",
    model: "desktop-intent-gate-stub-model",
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return {
        responseId: "model-response-intent-gate",
        requestId: request.requestId,
        providerId: "desktop-intent-gate-stub-provider",
        providerKind: "fake",
        protocolKind: "openai_compatible_chat_completions",
        model: "desktop-intent-gate-stub-model",
        status: "completed",
        outputKind: request.outputContract.outputKind,
        structuredOutput: {
          route,
          reason: `Stub model selected ${route}.`,
          confidence: 0.8,
        },
        validation: { status: "pending", checkedAt: new Date(0).toISOString(), issues: [] },
        completedAt: new Date(0).toISOString(),
      };
    },
  };
}

function routeForGoal(goal: string): "chat_direct" | "chat_plus_tools" | "task_work_session" {
  if (goal.includes("网页")) {
    return "chat_plus_tools";
  }
  if (goal.includes("仓库")) {
    return "task_work_session";
  }
  return "chat_direct";
}
